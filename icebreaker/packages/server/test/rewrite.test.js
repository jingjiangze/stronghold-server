import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBare, relativeUrl, rewriteImports } from '../src/rewrite.js';

test('[站点-1] a site path relative to a module resolves back to the same path under any prefix', () => {
  const cases = [
    ['/m/@aue/sim/src/a.js', '/m/@aue/schema/src/index.js', '../../schema/src/index.js'],
    ['/m/@aue/sim/src/a.js', '/m/@aue/sim/src/b.js', './b.js'],
    ['/m/@aue/sim/src/deep/a.js', '/m/@aue/sim/src/b.js', '../b.js'],
    ['/m/three/build/three.module.js', '/m/@aue/sim/src/index.js', '../../@aue/sim/src/index.js'],
    ['/k/server/sim/content/kits/ops/op.js', '/m/@aue/content/src/compat/sh/x.js', '../../../../../../m/@aue/content/src/compat/sh/x.js'],
  ];
  for (const [from, to, want] of cases) {
    const rel = relativeUrl(from, to);
    assert.equal(rel, want);
    for (const prefix of ['', '/icebreaker', '/a/b']) assert.equal(new URL(rel, `https://x.test${prefix}${from}`).pathname, `${prefix}${to}`);
  }
});

/** @param {string} spec */
const toUrl = (spec) => (spec.startsWith('@aue/') ? `/m/${spec}/src/index.js` : spec === 'three' ? '/m/three/build/three.module.js' : null);

const mustNotResolve = () => {
  throw new Error('must not be called');
};

test('static imports and exports from bare specifiers are rewritten', () => {
  const out = rewriteImports("import { a } from '@aue/x';\nexport * from '@aue/x';\nexport { b } from \"three\";\nimport '@aue/side';", toUrl);
  assert.equal(
    out,
    "import { a } from '/m/@aue/x/src/index.js';\nexport * from '/m/@aue/x/src/index.js';\nexport { b } from \"/m/three/build/three.module.js\";\nimport '/m/@aue/side/src/index.js';",
  );
});

test('dynamic imports with a string literal are rewritten and others are left alone', () => {
  const out = rewriteImports("const m = await import('@aue/y');\nconst n = import(name);\nconst o = import(`@aue/${n}`);", toUrl);
  assert.equal(out, 'const m = await import("/m/@aue/y/src/index.js");\nconst n = import(name);\nconst o = import(`@aue/${n}`);');
});

test('import attributes stay intact', () => {
  const out = rewriteImports("import data from '@aue/content' with { type: 'json' };", toUrl);
  assert.equal(out, "import data from '/m/@aue/content/src/index.js' with { type: 'json' };");
});

test('[站点-4] a JSON import becomes the import of its script, without the attributes; other attributes stay', () => {
  const out = rewriteImports("import a from '../data/x.json' with { type: 'json' };\nexport { default as t } from \"./t.json\" with {type:\"json\"};\nimport c from './c.css' with { type: 'css' };", mustNotResolve);
  assert.equal(out, "import a from '../data/x.json.js';\nexport { default as t } from \"./t.json.js\";\nimport c from './c.css' with { type: 'css' };");
});

test('comments and strings that mention import are untouched', () => {
  const src = "// import x from 'y'\n/* import('q') */\nconst s = \"import('z')\";\nconst t = 'import a from \"b\"';\n";
  assert.equal(rewriteImports(src, mustNotResolve), src);
});

test('relative, absolute and URL specifiers stay', () => {
  const src = "import a from './a.js';\nimport b from '../b.js';\nimport c from '/m/c.js';\nimport d from 'https://x.test/d.js';\nimport e from 'node:fs';\nimport('./f.js');";
  assert.equal(rewriteImports(src, mustNotResolve), src);
});

test('an unresolvable bare specifier throws and names it', () => {
  assert.throws(() => rewriteImports("import x from 'left-pad';", toUrl), /left-pad/);
  assert.throws(() => rewriteImports("import('left-pad2');", toUrl), /left-pad2/);
});

test('isBare tells packages from paths and URLs', () => {
  assert.deepEqual(['a', '@s/a', 'a/b'].map(isBare), [true, true, true]);
  assert.deepEqual(['./a', '../a', '/a', 'http://a', 'data:text/javascript,1', 'node:fs'].map(isBare), [false, false, false, false, false, false]);
});
