// The mod manager (/mod): the owner key, the list, upload / enable / disable, and a reload that reaches the next
// battle. The zip side (path safety, stored + deflate, refusals) is covered too — an upload is untrusted input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zip } from '@aue/sdk';
import { createHttpServer } from '../src/http.js';
import { loadHostMods } from '../src/mods.js';
import { createModManager, loadOwnerKey } from '../src/modManager.js';
import { readZip, safeEntryPath } from '../src/zipRead.js';

const KEY = 'test-owner-key';

/** A valid data mod folder on disk. @param {string} root @param {string} id @param {unknown} [data] @param {Record<string, unknown>} [extra] */
function modFolder(root, id, data = { operators: {} }, extra = {}) {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, 'pack.json'), JSON.stringify({ type: 'data', version: '1.0.0', app: '*', name: id, files: { data: 'data.json' }, ...extra }));
  writeFileSync(join(root, id, 'data.json'), JSON.stringify(data));
  return join(root, id);
}

/** A mod archive: pack.json + its data file, at the top or inside one folder. @param {string} id @param {{ wrap?: boolean }} [o] */
function modZip(id, { wrap = false } = {}) {
  const prefix = wrap ? `${id}/` : '';
  return zip([
    { name: `${prefix}pack.json`, data: Buffer.from(JSON.stringify({ id, type: 'data', version: '1.0.0', app: '*', name: id, files: { data: 'data.json' } })) },
    { name: `${prefix}data.json`, data: Buffer.from(JSON.stringify({ operators: {} })) },
  ]);
}

/** An HTTP server over the manager, listening on a random port. @param {string} root */
async function managerServer(root) {
  const mods = await loadHostMods(root);
  const manager = createModManager({ modsDir: root, key: KEY, initial: mods });
  const server = createHttpServer({ rootDir: process.cwd(), kitsDir: null, modManager: manager });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {any} */ (server.address()).port;
  const at = (/** @type {string} */ path, /** @type {any} */ init = undefined) => fetch(`http://127.0.0.1:${port}${path}`, init);
  return { manager, server, at };
}

test('zip: the engine writer round-trips; unsafe paths and garbage are refused', () => {
  const buf = zip([{ name: 'a/pack.json', data: Buffer.from('{"x":1}') }, { name: 'a/data.json', data: Buffer.from('[]') }]);
  const read = readZip(buf);
  assert.equal(read.error, null);
  assert.deepEqual(read.entries.map((e) => e.path), ['a/pack.json', 'a/data.json']);
  assert.equal(read.entries[1].data.toString('utf8'), '[]');
  assert.match(readZip(Buffer.from('not a zip at all')).error ?? '', /zip/);
  assert.match(readZip(Buffer.alloc(0)).error ?? '', /zip/);
  // path safety: the whole archive is refused when one entry escapes
  for (const bad of ['../x.json', '/etc/passwd', 'a\\b.json', 'C:/x.json']) assert.equal(safeEntryPath(bad), null, bad);
  assert.equal(safeEntryPath('a/./b.json'), 'a/b.json');
  assert.equal(safeEntryPath('a//b.json'), 'a/b.json');
});

test('mod manager: the key comes from --mod-key, else AUE_MOD_KEY, else the file the first start writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'ig-mmk-'));
  const mods = join(root, 'mods');
  mkdirSync(mods);
  /** @type {string[]} */
  const lines = [];
  const first = loadOwnerKey({ rootDir: root, modsDir: mods, argv: [], env: {}, log: (l) => lines.push(l) });
  assert.equal(first.length, 32, 'a generated key');
  assert.ok(lines.some((l) => l.includes(first)), 'logged once, so the host can copy it');
  assert.equal(readFileSync(join(mods, '.mod-key'), 'utf8').trim(), first);
  assert.equal(loadOwnerKey({ rootDir: root, modsDir: mods, argv: [], env: {} }), first, 'the file keeps it across starts');
  assert.equal(loadOwnerKey({ rootDir: root, modsDir: mods, argv: [], env: { AUE_MOD_KEY: 'from-env' } }), 'from-env');
  assert.equal(loadOwnerKey({ rootDir: root, modsDir: mods, argv: ['--mod-key', 'from-arg'], env: { AUE_MOD_KEY: 'from-env' } }), 'from-arg');
  rmSync(root, { recursive: true });
});

test('mod manager: list is public; toggle / upload / reload need the key and move real folders', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ig-mm-'));
  modFolder(root, 'alpha');
  const { manager, server, at } = await managerServer(root);
  try {
    // the page and the list need no key
    const page = await at('/mod');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await page.text(), /mod 管理器/);
    const list = await (await at('/mod/api/list.json')).json();
    assert.deepEqual(list.mods.map((/** @type {any} */ m) => m.id), ['alpha']);
    assert.equal(list.dir, root);

    // writes without the key are refused
    assert.equal((await at('/mod/api/toggle', { method: 'POST', body: JSON.stringify({ id: 'alpha', enabled: false }) })).status, 401);
    assert.equal((await at('/mod/api/reload', { method: 'POST' })).status, 401);
    assert.equal((await at('/mod/api/upload', { method: 'POST', body: modZip('beta') })).status, 401);

    /** @param {string} path @param {any} body @param {string} [key] */
    const post = (path, body, key = KEY) => at(path, {
      method: 'POST',
      headers: { 'x-mod-key': key, ...(typeof body === 'string' ? { 'content-type': 'application/json' } : { 'content-type': 'application/zip' }) },
      body: typeof body === 'string' ? body : new Uint8Array(body),
    });

    // disable → the folder parks under .disabled and the reload drops it from the live set
    assert.equal((await post('/mod/api/toggle', JSON.stringify({ id: 'alpha', enabled: false }))).status, 200);
    assert.equal(existsSync(join(root, 'alpha')), false);
    assert.equal(existsSync(join(root, '.disabled', 'alpha')), true);
    assert.deepEqual(manager.current().index.mods.map((m) => m.id), []);
    const afterOff = await (await at('/mod/api/list.json')).json();
    assert.deepEqual([afterOff.mods.length, afterOff.disabled], [0, ['alpha']]);

    // enable → back
    assert.equal((await post('/mod/api/toggle', JSON.stringify({ id: 'alpha', enabled: true }))).status, 200);
    assert.deepEqual(manager.current().index.mods.map((m) => m.id), ['alpha']);

    // upload a zip whose pack.json sits in one folder → written as mods/<id>/
    const up1 = await post('/mod/api/upload', modZip('beta', { wrap: true }));
    assert.equal(up1.status, 200, await up1.clone().text());
    assert.ok(existsSync(join(root, 'beta', 'pack.json')));
    assert.ok(manager.current().index.mods.some((m) => m.id === 'beta'));

    // the same id again is a conflict unless replace=1
    assert.equal((await post('/mod/api/upload', modZip('beta'))).status, 409);
    assert.equal((await post('/mod/api/upload?replace=1', modZip('beta'))).status, 200);

    // refusals: no pack.json, an unsafe path, a broken manifest
    assert.equal((await post('/mod/api/upload', zip([{ name: 'x.json', data: Buffer.from('{}') }]))).status, 400);
    assert.match(await (await post('/mod/api/upload', zip([{ name: '../escape.json', data: Buffer.from('{}') }]))).text(), /unsafe path/);
    const broken = zip([{ name: 'pack.json', data: Buffer.from(JSON.stringify({ type: 'data', version: 'nope', name: 'x', files: { data: 'd.json' } })) }]);
    assert.equal((await post('/mod/api/upload', broken)).status, 400);

    // reload sees a folder added outside the manager
    modFolder(root, 'gamma');
    assert.equal((await post('/mod/api/reload', '')).status, 200);
    assert.deepEqual(manager.current().index.mods.map((/** @type {any} */ m) => m.id).sort(), ['alpha', 'beta', 'gamma']);

    // /mods/ serves the live set: the reloaded index and a new mod's file
    const listed = await (await at('/mods/index.json')).json();
    assert.deepEqual(listed.mods.map((/** @type {any} */ m) => m.id).sort(), ['alpha', 'beta', 'gamma']);
    assert.equal((await at('/mods/gamma/data.json')).status, 200);
  } finally {
    server.close();
    rmSync(root, { recursive: true });
  }
});

test('mod manager: a server without a mods folder keeps the page and refuses writes', async () => {
  const mods = await loadHostMods(null);
  const manager = createModManager({ modsDir: null, key: KEY, initial: mods });
  const server = createHttpServer({ rootDir: process.cwd(), kitsDir: null, modManager: manager });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {any} */ (server.address()).port;
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/mod`)).status, 200);
    const up = await fetch(`http://127.0.0.1:${port}/mod/api/upload`, { method: 'POST', headers: { 'x-mod-key': KEY }, body: new Uint8Array(modZip('nope')) });
    assert.equal(up.status, 409, 'no mods folder to write into');
  } finally { server.close(); }
});
