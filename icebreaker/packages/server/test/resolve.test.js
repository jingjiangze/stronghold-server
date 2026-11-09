import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpecifier } from '../src/resolve.js';

/** @param {Record<string, unknown>} pkgs package name to package.json contents */
function resolver(pkgs) {
  const ws = new Map(Object.keys(pkgs).map((n) => [n, `/ws/${n}`]));
  return (/** @type {string} */ spec) => resolveSpecifier(spec, ws, (dir) => /** @type {any} */ (pkgs[dir.slice(4)] ?? null));
}

test('a string exports is the package entry', () => {
  const r = resolver({ '@aue/sim': { exports: './src/index.js' } });
  assert.deepEqual(r('@aue/sim'), { pkg: '@aue/sim', subpath: 'src/index.js' });
  assert.equal(r('@aue/sim/other'), null);
});

test('subpath exports map exact subpaths', () => {
  const r = resolver({ '@aue/content': { exports: { '.': './src/index.js', './data/skeleton.json': './data/s.json' } } });
  assert.deepEqual(r('@aue/content/data/skeleton.json'), { pkg: '@aue/content', subpath: 'data/s.json' });
  assert.equal(r('@aue/content/data/missing.json'), null);
});

test('conditions are tried in the order browser, import, default and require or node are ignored', () => {
  const exp = { '.': { node: './n.js', require: './r.js', default: './d.js', import: './i.js', browser: './b.js' } };
  assert.equal(resolver({ a: { exports: exp } })('a')?.subpath, 'b.js');
  assert.equal(resolver({ a: { exports: { '.': { node: './n.js', import: './i.js', default: './d.js' } } } })('a')?.subpath, 'i.js');
  assert.equal(resolver({ a: { exports: { '.': { require: './r.js', default: './d.js' } } } })('a')?.subpath, 'd.js');
  assert.equal(resolver({ a: { exports: { '.': { require: './r.js', node: './n.js' } } } })('a'), null);
});

test('conditions can be nested and arrays fall through to the first usable entry', () => {
  const exp = { '.': { browser: { import: './deep.js' } }, './x': [{ require: './no.js' }, './x.js'] };
  const r = resolver({ a: { exports: exp } });
  assert.equal(r('a')?.subpath, 'deep.js');
  assert.equal(r('a/x')?.subpath, 'x.js');
});

test('pattern subpaths substitute the star and the longest pattern wins', () => {
  const exp = { './lib/*': './src/*.js', './lib/deep/*': './deeper/*.mjs', './assets/*.json': './d/*.json' };
  const r = resolver({ a: { exports: exp } });
  assert.equal(r('a/lib/foo')?.subpath, 'src/foo.js');
  assert.equal(r('a/lib/deep/bar')?.subpath, 'deeper/bar.mjs');
  assert.equal(r('a/assets/k.json')?.subpath, 'd/k.json');
  assert.equal(r('a/assets/k.txt'), null);
});

test('a package without exports falls back to module, then main, then index.js', () => {
  assert.equal(resolver({ a: { module: './esm/a.js', main: './cjs/a.js' } })('a')?.subpath, 'esm/a.js');
  assert.equal(resolver({ a: { main: 'lib/a' } })('a')?.subpath, 'lib/a.js');
  assert.equal(resolver({ a: {} })('a')?.subpath, 'index.js');
  assert.equal(resolver({ a: {} })('a/sub/x.js')?.subpath, 'sub/x.js');
});

test('unknown packages, unknown subpaths and unsafe targets give null', () => {
  const r = resolver({ a: { exports: { '.': './x.js', './up': './../x.js', './nm': './node_modules/x.js', './bare': 'x.js', './off': null } } });
  assert.equal(r('nope'), null);
  assert.equal(r('a/missing'), null);
  assert.equal(r('a/up'), null);
  assert.equal(r('a/nm'), null);
  assert.equal(r('a/bare'), null);
  assert.equal(r('a/off'), null);
  assert.equal(r('@scope'), null);
  assert.equal(resolveSpecifier('a', new Map([['a', '/ws/a']]), () => null), null);
});

test('traversal in a specifier without exports is refused', () => {
  assert.equal(resolver({ a: {} })('a/../b/x.js'), null);
});
