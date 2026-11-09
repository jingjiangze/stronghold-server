// The server against this repository's own workspace (the engine submodule included).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { get } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHttpServer } from '../src/http.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** @type {import('node:http').Server} */
let server;
/** @type {number} */
let port;

before(async () => {
  server = await startHttpServer({ rootDir, port: 0, assetsDir: '', browserPackages: ['@aue/sim', '@aue/content', '@aue/math'] });
  port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
});

after(() => {
  server.close();
  server.closeAllConnections();
});

/** @param {string} path @returns {Promise<{ status: number, type: string, body: string }>} */
function fetchText(path) {
  return new Promise((resolveReply, reject) => {
    get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolveReply({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), body }));
    }).on('error', reject);
  });
}

/**
 * Every specifier written after `from` or in a dynamic import, outside comments (JSDoc types such as
 * `import('@aue/schema').Command` are not imports). @param {string} source
 */
function specifiers(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/(?:from\s+|import\s*\(\s*)(['"])([^'"]+)\1/g)].map((m) => m[2] ?? '');
}

test('the engine simulation module is served and none of its specifiers is bare', async () => {
  const r = await fetchText('/m/@aue/sim/src/index.js');
  assert.equal(r.status, 200);
  assert.equal(r.type, 'text/javascript; charset=utf-8');
  for (const spec of specifiers(r.body)) assert.match(spec, /^(\/m\/|\.\.?\/)/, `bare specifier left: ${spec}`);
});

test('another workspace package imports through its own exports', async () => {
  const r = await fetchText('/m/@aue/math/src/index.js');
  assert.equal(r.status, 200);
  for (const spec of specifiers(r.body)) assert.match(spec, /^(\/m\/|\.\.?\/)/, `bare specifier left: ${spec}`);
});

test('the content skeleton data is served as JSON', async (t) => {
  // The data lands with the content milestone; until then there is nothing to serve.
  if (!existsSync(join(rootDir, 'engine', 'packages', 'content', 'data', 'skeleton.json'))) {
    t.skip('engine/packages/content/data/skeleton.json does not exist yet');
    return;
  }
  const r = await fetchText('/m/@aue/content/data/skeleton.json');
  assert.equal(r.status, 200);
  assert.equal(r.type, 'application/json; charset=utf-8');
  assert.doesNotThrow(() => JSON.parse(r.body));
});

test('the content package manifest is served as JSON', async () => {
  const r = await fetchText('/m/@aue/content/package.json');
  assert.equal(r.status, 200);
  assert.equal(r.type, 'application/json; charset=utf-8');
  assert.equal(JSON.parse(r.body).name, '@aue/content');
});
