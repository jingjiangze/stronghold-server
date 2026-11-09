// Loading the pages fast (docs/spec/site.md 站点-4, 站点-5): the code's version and its year-long caching, the pages'
// preload links, compressed text, the kits under the same version, and the effect pack of one match's units.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createHttpServer } from '../src/http.js';
import { IMMUTABLE } from '../src/assets.js';
import { filesVersion } from '../src/build.js';
import { unversioned } from '../src/modules.js';
import { rewriteKitImports } from '../src/kits.js';
import { effectKeys } from '../src/effects.js';

/** @typedef {{ status: number, headers: import('node:http').IncomingHttpHeaders, body: Buffer }} Reply */
/** @param {number} port @param {string} path @param {Record<string, string>} [headers] @returns {Promise<Reply>} */
function get(port, path, headers = {}) {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = /** @type {Buffer[]} */ ([]);
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', fail);
    req.end();
  });
}

const root = mkdtempSync(join(tmpdir(), 'ig-loading-'));
/** @param {string} rel @param {string} text */
const write = (rel, text) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };
const BIG = `export const big = ${JSON.stringify('x'.repeat(4000))};\n`;

/** @type {import('node:http').Server} */
let server;
let port = 0;
before(async () => {
  write('site/pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  write('site/packages/client/package.json', JSON.stringify({ name: '@icebreaker/client', dependencies: { '@aue/sim': 'workspace:*' } }));
  write('site/packages/client/public/index.html', '<head><title>x</title><link rel="stylesheet" href="static/boot.css"></head>\n'
    + '<body>\n<script src="static/boot.js"></script>\n<script type="module" src="m/@icebreaker/client/src/main.js"></script></body>\n');
  write('site/packages/client/public/boot.css', '.boot { color: $1 $& red; }');
  write('site/packages/client/public/boot.js', 'globalThis.__boot = { up: true };');
  write('site/packages/client/src/main.js', "import { s } from '@aue/sim';\nimport './b.js';\nexport const later = () => import('./lazy.js');\n");
  write('site/packages/client/src/b.js', BIG);
  write('site/packages/client/src/lazy.js', 'export {};\n');
  write('site/packages/sim/package.json', JSON.stringify({ name: '@aue/sim', exports: { '.': './src/index.js' } }));
  write('site/packages/sim/src/index.js', "import t from './t.json' with { type: 'json' };\nimport { u } from './u.js';\nexport const s = [t, u];\n");
  write('site/packages/sim/src/u.js', "import './b2.js';\nexport const u = 1;\n");
  write('site/packages/sim/src/b2.js', "import { u } from './u.js';\nexport { u };\n");
  write('site/packages/sim/src/t.json', '{"t":1}');
  write('assets/skeleton/fx/units.json', JSON.stringify({ by: { char_a: { h: 'a' }, enemy_b: { h: 'b' } }, common: {}, named: { deploy: 'd' },
    fx: { a: { ps: [{ tex: 'ta' }] }, b: { ps: [{ tex: 'tb' }] }, d: { ps: [] } }, tex: { ta: 'data:a', tb: 'data:b' }, clamp: [] }));
  server = createHttpServer({ rootDir: join(root, 'site'), assetsDir: join(root, 'assets'), kitsDir: null, browserPackages: ['@icebreaker/client'] });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
});
after(() => { server.closeAllConnections(); server.close(); rmSync(root, { recursive: true, force: true }); });

/** The code's version as the page names it. @param {string} html */
const versionIn = (html) => /** @type {string} */ (/src="m\/~([0-9a-f]{12})\//.exec(html)?.[1]);

test('[站点-4] a page names its modules under the code\'s version and preloads every module they import statically', async () => {
  const html = (await get(port, '/')).body.toString('utf8'), v = versionIn(html);
  assert.match(v, /^[0-9a-f]{12}$/);
  const links = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(links, ['@icebreaker/client/src/main.js', '@aue/sim/src/index.js', '@icebreaker/client/src/b.js', '@aue/sim/src/t.json.js', '@aue/sim/src/u.js', '@aue/sim/src/b2.js']
    .map((p) => `m/~${v}/${p}`), 'breadth first, each once; a JSON file as its script; not what is imported later');
  assert.ok(html.indexOf('modulepreload') < html.indexOf('</head>'));
  assert.deepEqual(unversioned(`/m/~${v}/@aue/sim/src/u.js`), { path: '/m/@aue/sim/src/u.js', version: v });
  assert.deepEqual(unversioned('/m/@aue/sim/src/u.js'), { path: '/m/@aue/sim/src/u.js', version: null });
});

test('[站点-4] modules under today\'s version are kept a year; under an old one or none they revalidate; a change makes a new version', async () => {
  const v = versionIn((await get(port, '/')).body.toString('utf8'));
  const kept = await get(port, `/m/~${v}/@aue/sim/src/u.js`), old = await get(port, '/m/~000000000000/@aue/sim/src/u.js'), plain = await get(port, '/m/@aue/sim/src/u.js');
  assert.deepEqual([kept.headers['cache-control'], old.headers['cache-control'], plain.headers['cache-control']], [IMMUTABLE, 'no-cache', 'no-cache']);
  assert.equal(kept.body.toString('utf8'), plain.body.toString('utf8'));
  const dir = join(root, 'site/packages/sim'), before = filesVersion([dir]);
  assert.equal(filesVersion([dir]), before);
  utimesSync(join(dir, 'src/u.js'), new Date(2022, 0, 1), new Date(2022, 0, 1));
  assert.notEqual(filesVersion([dir]), before, 'a file\'s time changed');
});

test('[站点-4] text of 1 KiB or more is sent compressed to a client that accepts it, brotli before gzip; 304 for either tag', async () => {
  const br = await get(port, '/m/@icebreaker/client/src/b.js', { 'Accept-Encoding': 'gzip, deflate, br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers['vary'], 'Accept-Encoding');
  assert.equal(brotliDecompressSync(br.body).toString('utf8'), BIG);
  assert.ok(br.body.length < BIG.length / 10);
  const gz = await get(port, '/m/@icebreaker/client/src/b.js', { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(gz.body).toString('utf8'), BIG);
  const none = await get(port, '/m/@icebreaker/client/src/b.js');
  assert.equal(none.headers['content-encoding'], undefined);
  assert.equal(none.body.toString('utf8'), BIG);
  assert.notEqual(br.headers['etag'], none.headers['etag'], 'each coding its own tag');
  for (const tag of [br.headers['etag'], none.headers['etag']]) {
    assert.equal((await get(port, '/m/@icebreaker/client/src/b.js', { 'Accept-Encoding': 'br', 'If-None-Match': String(tag) })).status, 304);
  }
  assert.equal((await get(port, '/m/@aue/sim/src/u.js', { 'Accept-Encoding': 'br' })).headers['content-encoding'], undefined, 'small: as it is');
});

test('[站点-4] a kit under a version imports the compat modules under the same version', () => {
  const out = rewriteKitImports("import { absoluteRangeKeys } from '../../../targeting.js';\n", 'server/sim/content/kits/ops/op-x.js', 'abc123');
  assert.match(out, /from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/m\/~abc123\/@aue\/content\/src\/compat\/sh\/targeting\.js'/);
});

test('[站点-5] the effect pack for some units: their effects and textures only; a malformed query is refused', async () => {
  assert.deepEqual(effectKeys('/x?for=enemy_b,char_a,char_a'), ['char_a', 'enemy_b']);
  assert.equal(effectKeys('/x'), null);
  assert.equal(effectKeys('/x?for=a/b'), 'bad unit key');
  const r = await get(port, '/assets/skeleton/fx/units.json?for=char_a');
  assert.equal(r.status, 200);
  const pack = JSON.parse(r.body.toString('utf8'));
  assert.deepEqual([Object.keys(pack.by), Object.keys(pack.fx), Object.keys(pack.tex)], [['char_a'], ['a', 'd'], ['ta']]);
  const whole = JSON.parse((await get(port, '/assets/skeleton/fx/units.json')).body.toString('utf8'));
  assert.deepEqual(Object.keys(whole.fx), ['a', 'b', 'd'], 'without for: the whole pack');
  assert.equal((await get(port, '/assets/skeleton/fx/units.json?for=..%2Fx')).status, 400);
});

test('[站点-4] [页面-8] the loading screen style and script are written into the page, as they are', async () => {
  const html = (await get(port, '/')).body.toString('utf8');
  assert.ok(html.includes('<style>.boot { color: $1 $& red; }</style>'), 'replacement patterns kept as they are');
  assert.ok(html.includes('<script>globalThis.__boot = { up: true };</script>'));
  assert.ok(!html.includes('static/boot.'));
});
