import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpServer, startHttpServer } from '../src/http.js';

/** @typedef {{ status: number, headers: import('node:http').IncomingHttpHeaders, body: string }} Reply */

/** Sends the path exactly as given (no URL normalisation). @returns {Promise<Reply>} */
function send(/** @type {number} */ port, /** @type {string} */ path, /** @type {string} */ method = 'GET', /** @type {Record<string, string>} */ headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** @param {string} file @param {string} text */
function write(file, text) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

/** @param {string} root @param {string} dir @param {unknown} json */
function pkg(root, dir, json) {
  write(join(root, dir, 'package.json'), JSON.stringify(json));
}

/** @param {string} root */
function buildFixture(root) {
  write(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  write(join(root, 'secret.js'), 'export const secret = 1;\n');
  pkg(root, 'packages/sim', { name: '@aue/sim', exports: { '.': './src/index.js' } });
  write(join(root, 'packages/sim/src/index.js'), [
    "import { d } from '@aue/data';",
    "import table from '@aue/data/table.json' with { type: 'json' };",
    "import { u } from './util.js';",
    "export const lazy = () => import('@aue/data');",
    "// import nothing from 'nowhere'",
    'export { d, table, u };',
    '',
  ].join('\n'));
  write(join(root, 'packages/sim/src/util.js'), 'export const u = 1;\n');
  write(join(root, 'packages/sim/src/broken.js'), "import x from 'not-installed';\n");
  write(join(root, 'packages/sim/notes.txt'), 'notes\n');
  pkg(root, 'packages/data', { name: '@aue/data', exports: { '.': './index.js', './table.json': './table.json', './style.css': './style.css' } });
  write(join(root, 'packages/data/index.js'), 'export const d = 2;\n');
  write(join(root, 'packages/data/table.json'), '{"rows":[1,2]}\n');
  write(join(root, 'packages/data/style.css'), 'body{}\n');
  pkg(root, 'packages/server', { name: '@icebreaker/server' });
  write(join(root, 'packages/server/index.js'), 'export {};\n');
  pkg(root, 'packages/client', { name: '@icebreaker/client', dependencies: { '@aue/sim': 'workspace:*', '@aue/data': 'workspace:*' } });
  write(join(root, 'packages/client/public/index.html'), '<!doctype html><title>x</title>\n');
  write(join(root, 'packages/client/public/app.css'), 'a{}\n');
  write(join(root, 'packages/client/public/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  write(join(root, 'assets/pic.webp'), 'webp');
}

/** @type {string} */
let root;
/** @type {import('node:http').Server} */
let server;
/** @type {number} */
let port;
/** @type {import('node:http').Server} */
let withAssets;
/** @type {number} */
let assetsPort;

/** @param {import('node:http').Server} s */
const portOf = (s) => /** @type {import('node:net').AddressInfo} */ (s.address()).port;

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'http-'));
  buildFixture(root);
  const base = { rootDir: root, browserPackages: ['@icebreaker/client'] };
  server = await startHttpServer({ ...base, port: 0, assetsDir: '' });
  port = portOf(server);
  withAssets = await startHttpServer({ ...base, port: 0, assetsDir: join(root, 'assets') });
  assetsPort = portOf(withAssets);
});

after(() => {
  server.close();
  withAssets.close();
  server.closeAllConnections();
  withAssets.closeAllConnections();
  rmSync(root, { recursive: true, force: true });
});

test('[站点-1] a module is served with its bare specifiers rewritten relative to it and relative ones kept', async () => {
  const r = await send(port, '/m/@aue/sim/src/index.js');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.match(r.body, /from '\.\.\/\.\.\/data\/index\.js';/);
  assert.match(r.body, /from '\.\.\/\.\.\/data\/table\.json\.js';/, 'a JSON import is the import of its script, without attributes (站点-4)');
  assert.match(r.body, /from '\.\/util\.js'/);
  assert.match(r.body, /import\("\.\.\/\.\.\/data\/index\.js"\)/);
  assert.match(r.body, /\/\/ import nothing from 'nowhere'/);
});

test('json and css modules get their content types and the fixed headers', async () => {
  const json = await send(port, '/m/@aue/data/table.json');
  assert.equal(json.headers['content-type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(json.body), { rows: [1, 2] });
  const css = await send(port, '/m/@aue/data/style.css');
  assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal(css.headers['cache-control'], 'no-cache');
  assert.equal(css.headers['x-content-type-options'], 'nosniff');
  assert.match(String(css.headers['etag']), /^"[0-9a-f]{64}"$/);
});

test('[站点-4] a JSON file is also served as a script: export default of its data, for engines without import attributes', async () => {
  const r = await send(port, '/m/@aue/data/table.json.js');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/javascript; charset=utf-8');
  const mod = await import(`data:text/javascript,${encodeURIComponent(r.body)}`);
  assert.deepEqual(mod.default, { rows: [1, 2] });
  assert.equal((await send(port, '/m/@aue/data/missing.json.js')).status, 404);
});

test('If-None-Match with the ETag gives 304 and HEAD has no body', async () => {
  const first = await send(port, '/m/@aue/sim/src/index.js');
  const etag = String(first.headers['etag']);
  const again = await send(port, '/m/@aue/sim/src/index.js', 'GET', { 'If-None-Match': etag });
  assert.equal(again.status, 304);
  assert.equal(again.body, '');
  const other = await send(port, '/m/@aue/sim/src/index.js', 'GET', { 'If-None-Match': '"nope", W/"x"' });
  assert.equal(other.status, 200);
  const head = await send(port, '/m/@aue/sim/src/index.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['etag'], etag);
  assert.equal((await send(port, '/m/@aue/sim/src/index.js', 'GET', { 'If-None-Match': '*' })).status, 304);
});

test('a changed file is served again with a new ETag', async () => {
  const file = join(root, 'packages/data/index.js');
  const a = await send(port, '/m/@aue/data/index.js');
  writeFileSync(file, 'export const d = 3;\n');
  const future = new Date(Date.now() + 60_000);
  utimesSync(file, future, future);
  const b = await send(port, '/m/@aue/data/index.js');
  assert.notEqual(a.headers['etag'], b.headers['etag']);
  assert.match(b.body, /d = 3/);
});

test('methods other than GET and HEAD are 405', async () => {
  const r = await send(port, '/m/@aue/sim/src/index.js', 'POST');
  assert.equal(r.status, 405);
  assert.equal(r.headers['allow'], 'GET, HEAD');
  assert.equal((await send(port, '/static/app.css', 'DELETE')).status, 405);
  assert.equal((await send(port, '/healthz', 'POST')).status, 405);
});

const refused = [
  ['/m/@aue/sim/../../secret.js', 400],
  ['/m/@aue/sim/%2e%2e/x.js', 400],
  ['/m/@aue/sim/src/..%2fx.js', 400],
  ['/m/@aue/sim/src/%2e%2e%2fx.js', 400],
  ['/m/@aue/sim/src%5cx.js', 400],
  ['/m/@aue/sim/src\\x.js', 400],
  ['/m/@aue/sim/src/x%00.js', 400],
  ['/m/@aue/sim/src/%zz.js', 400],
  ['/m/@aue/sim/src//index.js', 400],
  ['/m/@aue/sim/C:/x.js', 400],
  ['/m/nope/x.js', 404],
  ['/m/@aue/nope/x.js', 404],
  ['/m/@aue', 404],
  ['/m/@aue/sim', 404],
  ['/m/@aue/sim/src/', 404],
  ['/m/@aue/sim/src', 404],
  ['/m/@aue/sim/notes.txt', 404],
  ['/m/@aue/sim/src/missing.js', 404],
  ['/m/@icebreaker/server/index.js', 404],
];

for (const [path, status] of refused) {
  test(`the module path ${JSON.stringify(path)} is refused with ${status}`, async () => {
    assert.equal((await send(port, String(path))).status, status);
  });
}

test('a symlink that leads outside the package is refused', async (t) => {
  try {
    symlinkSync(join(root, 'secret.js'), join(root, 'packages/sim/src/link.js'));
  } catch {
    t.skip('cannot create symlinks here');
    return;
  }
  assert.equal((await send(port, '/m/@aue/sim/src/link.js')).status, 400);
});

test('a module with an unresolvable import is a server error naming the specifier', async () => {
  const r = await send(port, '/m/@aue/sim/src/broken.js');
  assert.equal(r.status, 500);
  assert.match(r.body, /not-installed/);
});

test('the page, its static files and the health check', async () => {
  const index = await send(port, '/');
  assert.equal(index.status, 200);
  assert.equal(index.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(index.body, /<title>x<\/title>/);
  assert.equal((await send(port, '/static/app.css')).headers['content-type'], 'text/css; charset=utf-8');
  assert.equal((await send(port, '/static/logo.svg')).headers['content-type'], 'image/svg+xml');
  assert.equal((await send(port, '/static/missing.png')).status, 404);
  assert.equal((await send(port, '/static/../../secret.js')).status, 400);
  assert.equal((await send(port, '/static/')).status, 404);
  const health = await send(port, '/healthz');
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { ok: true });
  assert.equal((await send(port, '/nothing')).status, 404);
});

test('the asset directory is served only when configured', async () => {
  assert.equal((await send(port, '/assets/pic.webp')).status, 404);
  const r = await send(assetsPort, '/assets/pic.webp');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'image/webp');
  assert.equal((await send(assetsPort, '/assets/../secret.js')).status, 400);
});

test('the server binds to loopback by default and creating it does not listen', async () => {
  assert.equal(/** @type {import('node:net').AddressInfo} */ (server.address()).address, '127.0.0.1');
  const idle = createHttpServer({ rootDir: root, browserPackages: ['@icebreaker/client'] });
  assert.equal(idle.listening, false);
  assert.equal(idle.listenerCount('upgrade'), 0);
  const hooked = createHttpServer({ rootDir: root, onUpgrade: () => {} });
  assert.equal(hooked.listenerCount('upgrade'), 1);
});
