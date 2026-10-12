// Module specifiers in the browser-served trees must be prefix-safe.
//
// Why: public/js, public/dev, shared and server/sim are all handed to the browser, and the whole tree can be served
// from a CDN under a path prefix (e.g. /app/<tag>/js/main.js) instead of the site root. A relative specifier
// ('../x.js') resolves against the importing module's URL and therefore keeps the prefix; a root-absolute one
// ('/x.js') resolves against the *origin* and leaves it — silently breaking the module graph, which is the one
// failure mode this project has already paid for once (the /vendor/preact split).
//
// The extractor is tools/check-imports.mjs: it masks comments first, so a specifier quoted inside a comment is not
// an import. It cannot see a specifier held in a variable (board3d/load.js hands `THREE_URL` to a dynamic import) —
// that case is covered by its own test below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSpecifiers } from '../tools/check-imports.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The browser-served first-party trees. public/vendor is generated from node_modules (third-party) — not here. */
const TREES = ['public/js', 'public/dev', 'shared', 'server/sim'];

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...jsFiles(abs));
    else if (/\.(?:js|mjs)$/.test(name)) out.push(abs);
  }
  return out;
}

/** Root-absolute module specifiers under a tree, as `relpath:line: spec`. */
function rootAbsoluteSpecifiers(root, trees = TREES) {
  const found = [];
  for (const tree of trees) {
    let files;
    try { files = jsFiles(join(root, tree)); } catch { continue; }
    for (const abs of files) {
      const src = readFileSync(abs, 'utf8');
      for (const hit of findSpecifiers(src)) {
        if (hit.spec.startsWith('/')) {
          const rel = abs.slice(root.length + 1).split('\\').join('/');
          found.push(`${rel}:${hit.line}: ${hit.spec}`);
        }
      }
    }
  }
  return found.sort();
}

test('the checker reports a root-absolute specifier (so a broken walk cannot pass silently)', () => {
  const root = mkdtempSync(join(tmpdir(), 'sp-spec-'));
  try {
    mkdirSync(join(root, 'public', 'js'), { recursive: true });
    mkdirSync(join(root, 'shared'), { recursive: true });
    writeFileSync(join(root, 'public', 'js', 'bad.js'), "import '/js/other.js';\nimport './ok.js';\n");
    writeFileSync(join(root, 'shared', 'ok.js'), "export { a } from './tier1.js';\n");
    assert.deepEqual(rootAbsoluteSpecifiers(root, ['public/js', 'shared']), [
      'public/js/bad.js:1: /js/other.js',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the walk really reaches the trees (a missing directory would look clean)', () => {
  const files = TREES.flatMap((tree) => jsFiles(join(ROOT, tree)));
  assert.ok(files.length > 100, `expected the browser trees to hold many modules, walked ${files.length}`);
  const specs = files.flatMap((abs) => findSpecifiers(readFileSync(abs, 'utf8')));
  assert.ok(specs.length > 500, `expected many specifiers, found ${specs.length}`);
});

test('this repo: no browser-served module uses a root-absolute specifier', () => {
  assert.deepEqual(rootAbsoluteSpecifiers(ROOT), []);
});

test('the vendored three.js URL handed to a dynamic import is prefix-safe', async () => {
  const { THREE_URL } = await import('../public/js/render/board3d/load.js');
  assert.ok(!THREE_URL.startsWith('/'), `THREE_URL must not be root-absolute: ${THREE_URL}`);
  assert.match(THREE_URL, /^\.\.\//, `THREE_URL must be relative to load.js: ${THREE_URL}`);
});
