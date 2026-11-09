import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorkspaceGlobs, reachablePackages, readPackageJson, readWorkspace, runtimeDependencies } from '../src/workspace.js';

test('the workspace file is read for its package globs only', () => {
  const yaml = "# comment\npackages:\n  - engine/packages/*  # trailing\n  - 'packages/*'\n  - \"tools\"\n\nother:\n  - nope/*\n";
  assert.deepEqual(parseWorkspaceGlobs(yaml), ['engine/packages/*', 'packages/*', 'tools']);
  assert.deepEqual(parseWorkspaceGlobs('packages:\r\n  - a/*\r\n'), ['a/*']);
  assert.deepEqual(parseWorkspaceGlobs('name: x\n'), []);
});

test('runtime dependencies cover dependencies, peers and optionals but not dev dependencies', () => {
  const json = { dependencies: { a: '1' }, peerDependencies: { b: '1' }, optionalDependencies: { c: '1' }, devDependencies: { d: '1' } };
  assert.deepEqual(runtimeDependencies(json), ['a', 'b', 'c']);
  assert.deepEqual(runtimeDependencies({}), []);
});

/** @param {string} dir @param {unknown} json */
function put(dir, json) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(json));
}

test('workspace packages and the third-party packages the browser reaches are found', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-'));
  try {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n  - solo\n  - missing/*\n');
    put(join(root, 'packages', 'client'), { name: 'c', dependencies: { three: '1', lib: '1', absent: '1' } });
    put(join(root, 'packages', 'server'), { name: 's', dependencies: { ws: '1' } });
    put(join(root, 'packages', 'broken'), {});
    put(join(root, 'solo'), { name: 'solo' });
    put(join(root, 'node_modules', 'three'), { name: 'three', dependencies: { lib: '1' } });
    put(join(root, 'node_modules', 'lib'), { name: 'lib' });
    put(join(root, 'node_modules', 'ws'), { name: 'ws' });
    const ws = readWorkspace(root, ['c']);
    const real = realpathSync(root);
    assert.equal(ws.get('c'), join(real, 'packages', 'client'));
    assert.equal(ws.get('solo'), join(real, 'solo'));
    assert.equal(ws.get('three'), join(real, 'node_modules', 'three'));
    assert.equal(ws.get('lib'), join(real, 'node_modules', 'lib'));
    assert.equal(ws.has('ws'), false);
    assert.equal(ws.has('absent'), false);
    assert.deepEqual([...reachablePackages(ws, ['c'])].sort(), ['c', 'lib', 'three']);
    assert.equal(readWorkspace(root).has('three'), false);
    assert.equal(readPackageJson(join(root, 'nothing-here')), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
