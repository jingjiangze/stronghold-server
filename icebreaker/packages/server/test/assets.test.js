// The asset directory's version and its caching (docs/spec/site.md 站点-3).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { assetVersion, IMMUTABLE } from '../src/assets.js';
import { createHttpServer } from '../src/index.js';

const root = mkdtempSync(join(tmpdir(), 'ig-assets-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** @param {string} rel @param {string} text */
const write = (rel, text) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };

/** @param {number} port @param {string} path @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: string }>} */
function get(port, path) {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path }, (res) => {
      const chunks = /** @type {Buffer[]} */ ([]);
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', fail);
    req.end();
  });
}

test('[站点-3] the version follows every file\'s path, size and time, and nothing else', () => {
  write('assets/skeleton/a.json', '{"a":1}');
  write('assets/skeleton/ui/b.webp', 'bb');
  const dir = join(root, 'assets'), v = assetVersion(dir);
  assert.match(v, /^[0-9a-f]{12}$/);
  assert.equal(assetVersion(dir), v, 'the same directory, the same version');
  write('assets/skeleton/ui/b.webp', 'bbb');
  const v2 = assetVersion(dir);
  assert.notEqual(v2, v, 'a size changed');
  utimesSync(join(dir, 'skeleton/a.json'), new Date(2020, 0, 1), new Date(2020, 0, 1));
  assert.notEqual(assetVersion(dir), v2, 'a time changed');
});

test('[站点-3] pages name the versioned base; versioned assets are kept a year, others revalidate', async () => {
  write('site/pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  write('site/packages/client/public/room.html', '<head><meta name="ig-assets" content="assets/skeleton/"></head>');
  write('site/packages/client/public/index.html', '<head><meta name="ig-assets" content="assets/skeleton/"></head>');
  write('assets/skeleton/c.json', '{"c":1}');
  const dir = join(root, 'assets'), v = assetVersion(dir);
  const server = createHttpServer({ rootDir: join(root, 'site'), assetsDir: dir, kitsDir: null, home: 'room', browserPackages: [] });
  const bare = createHttpServer({ rootDir: join(root, 'site'), assetsDir: '', kitsDir: null, browserPackages: [] });
  await Promise.all([server, bare].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(undefined)))));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port, barePort = /** @type {import('node:net').AddressInfo} */ (bare.address()).port;
  try {
    assert.match((await get(port, '/')).body, new RegExp(`content="assets/~${v}/skeleton/"`));
    assert.match((await get(port, '/play')).body, new RegExp(`content="assets/~${v}/skeleton/"`));
    assert.match((await get(barePort, '/')).body, /content="assets\/skeleton\/"/, 'no assets: the plain base');
    const kept = await get(port, `/assets/~${v}/skeleton/c.json`);
    assert.equal(kept.status, 200);
    assert.equal(kept.body, '{"c":1}');
    assert.equal(kept.headers['cache-control'], IMMUTABLE);
    const old = await get(port, '/assets/~000000000000/skeleton/c.json');
    assert.equal(old.body, '{"c":1}', 'an old version gets today\'s file');
    assert.equal(old.headers['cache-control'], 'no-cache');
    assert.equal((await get(port, '/assets/skeleton/c.json')).headers['cache-control'], 'no-cache');
    assert.equal((await get(port, `/assets/~${v}/skeleton/../../x.json`)).status, 400, 'the same path checks');
    // the ETag is kept per file while its time and size hold, and follows a change of the same size
    const before = (await get(port, '/assets/skeleton/c.json')).headers['etag'];
    assert.equal((await get(port, '/assets/skeleton/c.json')).headers['etag'], before);
    write('assets/skeleton/c.json', '{"c":2}');
    utimesSync(join(dir, 'skeleton/c.json'), new Date(2021, 0, 1), new Date(2021, 0, 1));
    const changed = await get(port, '/assets/skeleton/c.json');
    assert.equal(changed.body, '{"c":2}');
    assert.notEqual(changed.headers['etag'], before);
  } finally {
    server.close();
    bare.close();
  }
});
