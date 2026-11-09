// The host's data mods (docs/spec/site.md 站点-7): the folder it reads, what it logs, the list and the files it serves
// and nothing else under /mods/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OFFICIAL_SOURCE } from '@aue/content';
import { createHttpServer } from '../src/http.js';
import { loadHostMods, modsDir, NO_MODS } from '../src/mods.js';

/** @param {string} root @param {string} id @param {unknown} data @param {Record<string, unknown>} [extra] */
function mod(root, id, data, extra = {}) {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, 'pack.json'), JSON.stringify({ type: 'data', version: '1.0.0', app: '*', name: id, files: { data: 'data.json' }, ...extra }));
  writeFileSync(join(root, id, 'data.json'), JSON.stringify(data));
}

test('[站点-7] the mods folder: --mods, else AUE_MODS_DIR, else <root>/mods; none when it is not there', () => {
  const root = mkdtempSync(join(tmpdir(), 'ig-mods-'));
  assert.equal(modsDir(root, [], {}), null);
  mkdirSync(join(root, 'mods'));
  assert.equal(modsDir(root, [], {}), join(root, 'mods'));
  mkdirSync(join(root, 'other'));
  assert.equal(modsDir(root, [], { AUE_MODS_DIR: join(root, 'other') }), join(root, 'other'));
  assert.equal(modsDir(root, ['--mods', join(root, 'mods')], { AUE_MODS_DIR: join(root, 'other') }), join(root, 'mods'));
  assert.equal(modsDir(root, ['--mods', join(root, 'none')], {}), null);
  rmSync(root, { recursive: true });
});

test('[站点-7] the mods laid over the official content, and the log: loaded, skipped, not loaded and why', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ig-mods-'));
  mod(root, 'strong', { operators: { char_010_chen: { skills: { skchr_chen_2: { levels: { 9: { blackboard: { atk_scale: 6 } } } } } } } });
  mod(root, 'broken', { operators: { char_010_chen: { rarity: 9 } } });
  mkdirSync(join(root, 'unread'));
  writeFileSync(join(root, 'unread', 'pack.json'), '{');
  const mods = await loadHostMods(root);
  assert.deepEqual(mods.source.mods.map((m) => m.id), ['strong']);
  assert.deepEqual(mods.index.mods.map((m) => m.id), ['strong']);
  assert.deepEqual([...mods.files.keys()], ['/mods/strong/data.json']);
  assert.deepEqual(mods.lines.map((l) => l.split(':')[0]), ['mod unread', '  problem', 'mod broken 1.0.0', '  problem', 'mod strong 1.0.0', 'mods']);
  assert.equal(mods.lines.at(-1), `mods: strong 1.0.0 (${root})`);
  const none = await loadHostMods(null);
  assert.equal(none.source, OFFICIAL_SOURCE);
  assert.deepEqual([none.index.mods, none.lines], [[], ['mods: none']]);
  rmSync(root, { recursive: true });
});

test('[站点-7] /mods/: the list and the listed files only; read-only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ig-mods-'));
  mod(root, 'strong', { operators: { char_010_chen: { rarity: 6 } } });
  const mods = await loadHostMods(root);
  const server = createHttpServer({ rootDir: process.cwd(), kitsDir: null, mods }), bare = createHttpServer({ rootDir: process.cwd(), kitsDir: null });
  await Promise.all([server, bare].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(undefined)))));
  const at = (/** @type {import('node:http').Server} */ s, /** @type {string} */ path, method = 'GET') => fetch(`http://127.0.0.1:${/** @type {any} */ (s.address()).port}${path}`, { method });
  try {
    const list = await at(server, '/mods/index.json');
    assert.equal(list.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await list.json(), mods.index);
    assert.equal(await (await at(server, '/mods/strong/data.json')).text(), JSON.stringify({ operators: { char_010_chen: { rarity: 6 } } }));
    assert.deepEqual(await Promise.all(['/mods/strong/pack.json', '/mods/strong/', '/mods/'].map(async (p) => (await at(server, p)).status)), [404, 404, 404]);
    assert.equal((await at(server, '/mods/index.json', 'POST')).status, 405);
    assert.deepEqual(await (await at(bare, '/mods/index.json')).json(), NO_MODS.index);
  } finally {
    await Promise.all([server, bare].map((s) => { s.closeAllConnections(); return new Promise((r) => s.close(r)); }));
    rmSync(root, { recursive: true });
  }
});
