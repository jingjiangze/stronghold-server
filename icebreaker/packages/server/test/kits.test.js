// The pinned kits (engine ADR 0058, its compat spec 兼容-6): the imports of Stronghold engine modules rewritten to the
// engine's compat modules, the /k/ route over the pinned commit's content files only, and a match room using a kit.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { rewriteKitImports, kitDir, nodeKits } from '../src/kits.js';
import { startHttpServer } from '../src/http.js';
import { createMatchRoom } from '../src/battle.js';

/** @param {number} port @param {string} path @returns {Promise<{ status: number, body: string }>} */
function get(port, path) {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', fail);
    req.end();
  });
}

const OP = 'server/sim/content/kits/ops/op-x.js';
const SOURCE = [
  "import { absoluteRangeKeys } from '../../../targeting.js';",
  "import { num } from '../shared/tier1.js';",
  "const later = () => import('../../../dir.js');",
  '',
].join('\n');

test('[站点-1] engine modules a kit imports go to the compat modules, relative to the kit; content files stay; an unknown engine module is an error', () => {
  const out = rewriteKitImports(SOURCE, OP);
  assert.match(out, /from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/m\/@aue\/content\/src\/compat\/sh\/targeting\.js'/);
  assert.match(out, /from '\.\.\/shared\/tier1\.js'/);
  assert.match(out, /import\("\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/m\/@aue\/content\/src\/compat\/sh\/dir\.js"\)/);
  assert.throws(() => rewriteKitImports("import x from '../../../battle.js';\n", OP), /no mapping for the Stronghold module server\/sim\/battle\.js/);
});

/** @type {string} */
let dir;
/** @type {import('node:http').Server} */
let server;
/** @type {number} */
let port;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kits-'));
  mkdirSync(join(dir, 'server', 'sim', 'content', 'kits', 'ops'), { recursive: true });
  writeFileSync(join(dir, OP), SOURCE);
  writeFileSync(join(dir, 'server', 'sim', 'battle.js'), 'export const secret = 1;\n');
  server = await startHttpServer({ rootDir: resolve('.'), port: 0, kitsDir: dir });
  port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('/k/ serves the pinned commit’s content files rewritten, nothing else of it', async () => {
  const ok = await get(port, `/k/${OP}`);
  assert.equal(ok.status, 200);
  assert.match(ok.body, /compat\/sh\/targeting\.js/);
  assert.equal((await get(port, '/k/server/sim/battle.js')).status, 404, 'an engine module: not served');
  assert.equal((await get(port, '/k/server/sim/content/../battle.js')).status, 400);
  assert.equal((await get(port, '/k/server/sim/content/kits/ops/none.js')).status, 404);
  const bare = await startHttpServer({ rootDir: resolve('.'), port: 0, kitsDir: null });
  assert.equal((await get(/** @type {import('node:net').AddressInfo} */ (bare.address()).port, `/k/${OP}`)).status, 404, 'no pinned commit: 404');
  bare.close();
});

test('a match room with a kit: the arbiter’s content uses it', { skip: kitDir(resolve('.')) === null ? 'the pinned commit is not installed (AUE_KITS_DIR)' : false }, async () => {
  const kits = /** @type {string} */ (kitDir(resolve('.')));
  const build = { elite: 2, level: 90, potential: 6, trust: 100, skill: 2, skillLevel: 10, module: 0, moduleLevel: 3 };
  const match = { level: 'act1multi_01', difficulty: /** @type {const} */ ('NORMAL'), seed: 3, decks: [[{ id: 'char_112_siege', build }]] };
  const plain = await createMatchRoom(match), kitted = await createMatchRoom(match, { kits: (ids) => nodeKits(kits, ids) });
  const content = /** @type {any} */ (kitted.host).o.content;
  assert.deepEqual(content.kits.used, ['char_112_siege']);
  assert.equal(typeof content.behaviors.world, 'function');
  assert.notEqual(kitted.host.content, plain.host.content, 'the content hash names the kit');
  plain.close();
  kitted.close();
});
