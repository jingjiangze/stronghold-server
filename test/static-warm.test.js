// `warm`（createStaticHandler，server/http/static.js + files.js loadWarmFile）：启动读一次、之后从内存出。
// 平台的容器 FS 会把这个文件按 ~0.1MB/s 重读（2026-10-11 在创空间实测：/data/assets.json 每次整段响应
// ~27s，而更大的 chess.json/three.core.js 只要 0.3–0.7s），所以启动期把它读进内存。
// 这里验证内存路径与磁盘路径语义一致（identity/gzip/Range/304/HEAD），且确实是从内存出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../server/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const MANIFEST = JSON.stringify({ version: 1, pad: 'x'.repeat(40000) }, null, 2) + '\n';

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-warm-'));
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'assets.json'), MANIFEST);
  return { dir, dataDir };
}

function serve(dataDir, warm) {
  const handler = createStaticHandler({ publicDir: path.join(ROOT, 'public'), dataDir, sharedDir: path.join(ROOT, 'shared'), log: silent, warm });
  const srv = http.createServer((req, res) => {
    const [p, q] = req.url.split('?');
    handler(req, res, p, q || '');
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({ srv, handler }));
  });
}

function req(srv, url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

test('warm file：identity/gzip/Range/304/HEAD 与磁盘路径语义一致，且确实从内存出', async () => {
  const { dir, dataDir } = makeDir();
  const manifestPath = path.join(dataDir, 'assets.json');
  const { srv, handler } = await serve(dataDir, [manifestPath]);
  try {
    await handler.warmReady;

    const plain = await req(srv, '/data/assets.json');
    assert.equal(plain.status, 200);
    assert.equal(plain.body.toString('utf8'), MANIFEST);
    assert.equal(Number(plain.headers['content-length']), Buffer.byteLength(MANIFEST));

    const gz = await req(srv, '/data/assets.json', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gz.status, 200);
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(gz.body).toString('utf8'), MANIFEST);
    assert.match(String(gz.headers.etag), /-gz"$/);

    const range = await req(srv, '/data/assets.json', { headers: { range: 'bytes=10-19' } });
    assert.equal(range.status, 206);
    assert.equal(range.body.length, 10);
    assert.equal(range.body.toString('utf8'), MANIFEST.slice(10, 20));

    const head = await req(srv, '/data/assets.json', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(Number(head.headers['content-length']), Buffer.byteLength(MANIFEST));

    const fresh = await req(srv, '/data/assets.json', { headers: { 'if-none-match': String(plain.headers.etag) } });
    assert.equal(fresh.status, 304);

    // 从内存出的证明：换成等长的不同内容，响应仍是启动时读到的字节
    fs.writeFileSync(manifestPath, MANIFEST.replace('version', 'VERSION'));
    const after = await req(srv, '/data/assets.json');
    assert.equal(after.status, 200);
    assert.equal(after.body.toString('utf8'), MANIFEST, 'served from the boot-time copy, not from disk');
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('warm 缺失/读不到时不影响正常服务（回落到磁盘路径）', async () => {
  const { dir, dataDir } = makeDir();
  const { srv, handler } = await serve(dataDir, [path.join(dataDir, 'nope.json')]);
  try {
    await handler.warmReady;
    const r = await req(srv, '/data/assets.json');
    assert.equal(r.status, 200);
    assert.equal(r.body.toString('utf8'), MANIFEST);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
