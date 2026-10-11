// The "workshop" pack type — a mod-manager (Forge) 工坊包 (docs/PACKS.md; the contract layer of the audit's L1). The
// server is the LOADING end, not the authoring end: it recognises a Forge `pack.json` (which has no "type"), validates
// the shape, lists it in /packs/index.json, and serves only the read-only files it declares — it never applies game
// data (content / overrides) or runs the pack's code. The field set and face enumerations are read from the vendored
// contract (shared/forgeContract.js), never hand-copied, and a drift test keeps that copy honest against the Forge
// checkout. Run: node --test test/workshop-packs.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeManifest, readPackIndex, PACK_TYPES } from '../shared/packs.js';
import { scanPacks, packIndexOf, createPackRegistry } from '../server/packs.js';
import * as vendored from '../shared/forgeContract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORGE = path.resolve(ROOT, '..', 'Stronghold-Protocol-Forge', 'shared', 'workshop.js');
const SAMPLE_B2 = path.resolve(ROOT, '..', '_tmp', 'mod-submit-b2', 'workshop');
const SAMPLE_OLD = path.resolve(ROOT, '..', '_tmp', 'mod-submit', 'workshop');

const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-workshop-${tag}-`));
const put = (dir, rel, body) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
};
/** A checkout-shaped root: <root>/packs/<id>/pack.json + the declared files, empty public/ and data/. */
function rootWith(packs) {
  const root = tmpdir('root');
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  for (const [id, spec] of Object.entries(packs)) {
    put(root, `packs/${id}/pack.json`, spec.manifest);
    for (const [rel, body] of Object.entries(spec.files ?? {})) put(root, `packs/${id}/${rel}`, body);
  }
  return root;
}
const dirsOf = (root) => ({ publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), packsDir: path.join(root, 'packs') });
const norm = (manifest, id = 'wsdemo') => normalizeManifest(manifest, { id, folder: true });

// -------------------------------------------------------------------------------------------------------------------
// the contract

test('workshop: a folder pack that names no "type" is a workshop pack; every applied face maps to a served file', () => {
  const manifest = {
    id: 'wsdemo', name: 'WS demo', version: '1.0.0', author: 'tester', license: 'CC0-1.0',
    game: '0.2.x', api: '>=1 <2', combat: false,
    content: ['chess'],
    routes: [{ path: '/data/x.json', file: 'data/x.json', cache: 'no-cache' }],
    notices: { announcement: 'notice/a.json' },
    client: { panels: [{ id: 'p', slot: 'root.guide', module: 'ui/p.js', styles: ['ui/p.css'] }] },
    i18n: { en: 'i18n/en.json' },
  };
  const { manifest: m, problems, warnings } = norm(manifest);
  assert.deepEqual(problems, []);
  assert.equal(m.type, 'workshop');
  assert.deepEqual(m.faces, ['client', 'content', 'i18n', 'notices', 'routes']);
  assert.deepEqual(m.files, {
    'content:chess': 'chess.json',
    'route:/data/x.json': 'data/x.json',
    'notices:announcement': 'notice/a.json',
    'client:p:module': 'ui/p.js',
    'client:p:styles:0': 'ui/p.css',
    'i18n:en': 'i18n/en.json',
  });
  assert.deepEqual(m.routes, [{ path: '/data/x.json', file: 'data/x.json', cache: 'no-cache' }]);
  // `combat` is pack METADATA (Forge groups it with id/name/version under 身份与元信息), not a face to apply:
  // it is registered like any other declared field and must NOT warn on every real pack.
  assert.ok(m.declared.includes('combat'), m.declared.join(' | '));
  assert.ok(!warnings.some((w) => w.includes('"combat"')), warnings.join(' | '));
});

test('workshop: the type default is only for folder packs — an explicit type still wins, a file pack is not a workshop', () => {
  assert.equal(norm({ type: 'lang', lang: 'qaa', files: { ui: 'ui.json' } }).manifest.type, 'lang');
  assert.equal(norm({ type: 'assets' }).manifest.type, 'assets');
  // a non-folder context with no type is still "no type" (a single-file language pack always carries ctx.type='lang')
  const { problems } = normalizeManifest({}, { id: 'x' });
  assert.ok(problems.includes('no "type"'), problems.join(' | '));
});

test('workshop: an unknown top-level field and an unknown face warn — they never refuse the pack (forward compat)', () => {
  const { manifest, problems, warnings } = norm({ id: 'wsdemo', name: 'N', variants: [1, 2], server: { preDispatch: { module: 's/x.mjs' } } });
  assert.deepEqual(problems, []);
  assert.ok(manifest, 'a pack with unknown keys still loads');
  assert.ok(warnings.some((w) => w.includes('"variants"') && w.includes('PACK_UNKNOWN_FIELD')), warnings.join(' | '));
  assert.ok(warnings.some((w) => w.includes('"server" is declared but this server does not apply it')), warnings.join(' | '));
});

test('workshop: a KNOWN field with a malformed value refuses the pack (a broken pack, not a newer one)', () => {
  const bad = [
    ['id mismatch', { id: 'other', name: 'N' }, /is not the pack's folder name/],
    ['api not a range', { api: 'soon' }, /"api".*is not a version range/],
    ['game not a range', { game: 'v1 beta' }, /"game".*is not a version range/],
    ['combat not boolean', { combat: 'yes' }, /"combat" must be true or false/],
    ['content not an array', { content: 'chess' }, /"content" must be an array/],
    ['routes not an array', { routes: {} }, /"routes" must be an array/],
    ['route file not .json', { routes: [{ path: '/x', file: 'x.txt' }] }, /\.file must be a pack-relative \.json/],
    ['route file missing', { routes: [{ path: '/x' }] }, /\.file must be a pack-relative \.json/],
    ['route cache not one of three', { routes: [{ path: '/x', file: 'x.json', cache: 'sometimes' }] }, /\.cache must be one of/],
    ['route path not absolute', { routes: [{ path: 'x.json', file: 'x.json' }] }, /\.path must be an absolute HTTP path/],
    ['route path traversal', { routes: [{ path: '/a/../b', file: 'x.json' }] }, /\.path must be an absolute HTTP path/],
    ['notice path escapes', { notices: { announcement: '../a.json' } }, /notices\.announcement must be a pack-relative/],
    ['client module not .js', { client: { panels: [{ id: 'p', slot: 'root.guide', module: 'ui/p.html' }] } }, /\.module must be a pack-relative "\.js"/],
    ['client style escapes', { client: { panels: [{ id: 'p', slot: 'root.guide', module: 'ui/p.js', styles: ['../p.css'] }] } }, /styles\[0\] must be a pack-relative "\.css"/],
    ['assets container not .spresources', { assets: { container: 'c.zip', manifest: 'm.json' } }, /assets\.container must name a pack-relative/],
    ['i18n source language', { i18n: { zh: 'i18n/zh.json' } }, /source language/],
    ['i18n not a code', { i18n: { 'EN-us': 'i18n/x.json' } }, /is not a language code/],
    ['skins not an array', { skins: {} }, /"skins" must be an array/],
    ['overrides not an array', { overrides: 'bosses:x' }, /"overrides" must be an array/],
    ['support not an array', { support: 'chess_a' }, /"support" must be an array/],
  ];
  for (const [label, manifest, re] of bad) {
    const { manifest: m, problems } = norm({ id: 'wsdemo', name: 'N', ...manifest });
    assert.equal(m, null, `${label}: expected the pack to be refused`);
    assert.ok(problems.some((p) => re.test(p)), `${label}: ${problems.join(' | ')}`);
  }
});

test('workshop: paths that leave the pack are refused even in the media faces (art / skins under assets/)', () => {
  const { manifest, problems } = norm({ id: 'wsdemo', name: 'N', art: { chars: { a: { avatar: '../x.png' } } } });
  assert.equal(manifest, null);
  assert.ok(problems.some((p) => /is not a path inside the pack's assets\/ folder/.test(p)), problems.join(' | '));
});

test('workshop: an unknown face inside a known block warns, it does not refuse (e.g. a newer notices field, a new slot)', () => {
  const { manifest, problems, warnings } = norm({
    id: 'wsdemo', name: 'N', notices: { announcement: 'n/a.json', banner: 'n/b.json' },
    client: { panels: [{ id: 'p', slot: 'screen.future', module: 'ui/p.js' }] },
    art: { futureTable: {} },
  });
  assert.deepEqual(problems, []);
  assert.ok(manifest);
  assert.ok(warnings.some((w) => w.includes('notices: "banner"')), warnings.join(' | '));
  assert.ok(warnings.some((w) => w.includes('"screen.future"')), warnings.join(' | '));
  assert.ok(warnings.some((w) => w.includes('art: "futureTable"')), warnings.join(' | '));
});

// -------------------------------------------------------------------------------------------------------------------
// the registry, the index and serving (server/packs.js)

test('workshop: the registry loads a workshop folder, lists its routes in the index and serves only declared files', () => {
  const root = rootWith({
    wsdemo: {
      manifest: {
        id: 'wsdemo', name: 'WS demo', version: '1.0.0',
        routes: [{ path: '/data/x.json', file: 'data/x.json', cache: 'public' }],
        client: { panels: [{ id: 'p', slot: 'root.guide', module: 'ui/p.js' }] },
      },
      files: { 'data/x.json': { ok: true }, 'ui/p.js': 'export const x = 1;', 'secret.txt': 'no' },
    },
  });
  try {
    const scan = scanPacks(dirsOf(root));
    assert.deepEqual(scan.skipped, []);
    assert.deepEqual(scan.packs.map((p) => [p.id, p.type, p.supported]), [['wsdemo', 'workshop', true]]);
    const body = packIndexOf(scan.packs);
    const e = body.packs[0];
    assert.deepEqual(e.faces, ['client', 'routes']);
    assert.deepEqual(e.routes, [{ path: '/data/x.json', url: '/packs/wsdemo/data/x.json', cache: 'public' }]);
    assert.equal(e.files['route:/data/x.json'], '/packs/wsdemo/data/x.json');

    // readPackIndex (the browser side) keeps a workshop entry of this server
    const back = readPackIndex(JSON.parse(JSON.stringify(body)), 'workshop');
    assert.deepEqual(back.map((p) => p.id), ['wsdemo']);
    assert.deepEqual(back[0].routes, e.routes);

    // serving: only a declared file; pack.json and an undeclared file are never served
    const reg = createPackRegistry(dirsOf(root), { recheckMs: 0 });
    assert.ok(reg.servable('wsdemo', 'data/x.json'));
    assert.ok(reg.servable('wsdemo', 'ui/p.js'));
    assert.equal(reg.servable('wsdemo', 'pack.json'), null);
    assert.equal(reg.servable('wsdemo', 'secret.txt'), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('workshop: a declared file that is not on disk refuses the pack (the registry checks existence)', () => {
  const root = rootWith({ wsdemo: { manifest: { id: 'wsdemo', name: 'N', routes: [{ path: '/data/x.json', file: 'data/x.json' }] }, files: {} } });
  try {
    const scan = scanPacks(dirsOf(root));
    assert.deepEqual(scan.packs, []);
    assert.ok(scan.skipped[0].problems.some((p) => /data\/x\.json is missing/.test(p)), JSON.stringify(scan.skipped));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// -------------------------------------------------------------------------------------------------------------------
// the real Forge packs (the ones the mod manager submits)

for (const [label, dir] of [['mod-submit-b2', SAMPLE_B2], ['mod-submit', SAMPLE_OLD]]) {
  test(`workshop: every real Forge pack in ${label} is accepted (no pack refused)`, { skip: !fs.existsSync(dir) ? `${dir} not present` : false }, () => {
    const empty = tmpdir('empty');
    const scan = scanPacks({ publicDir: empty, dataDir: empty, packsDir: dir });
    assert.deepEqual(scan.skipped, [], `real packs must never be refused: ${JSON.stringify(scan.skipped)}`);
    const ids = scan.packs.map((p) => p.id).sort();
    assert.ok(ids.length > 0, 'the sample directory holds packs');
    assert.deepEqual(scan.packs.map((p) => p.type).filter((t) => t !== 'workshop'), []);
    for (const p of scan.packs) assert.ok(Array.isArray(p.manifest.faces), `${p.id} has faces`);
    // warnings are only the "known field this layer does not apply" kind (combat / overrides / server …)
    for (const w of scan.warnings) assert.match(w.warning, /is declared but this server does not apply it|is not a field of a workshop pack/, p_id(w));
  });
}

test('workshop: the two submitted packs map to the expected faces and routes', { skip: !fs.existsSync(SAMPLE_B2) ? `${SAMPLE_B2} not present` : false }, () => {
  const empty = tmpdir('empty');
  const scan = scanPacks({ publicDir: empty, dataDir: empty, packsDir: SAMPLE_B2 });
  const by = Object.fromEntries(scan.packs.map((p) => [p.id, p]));
  assert.deepEqual(by['healthz-ext'].manifest.faces, ['client', 'routes']);
  assert.deepEqual(by['healthz-ext'].manifest.routes.map((r) => r.path), ['/mod/healthz-ext.json', '/mod/client-build.json']);
  assert.deepEqual(by['capacity-panel'].manifest.faces, ['client', 'i18n']);
  const body = packIndexOf(scan.packs);
  const hz = body.packs.find((p) => p.id === 'healthz-ext');
  assert.deepEqual(hz.routes.map((r) => r.url), ['/packs/healthz-ext/data/healthz-ext.json', '/packs/healthz-ext/data/client-build.json']);
});

// -------------------------------------------------------------------------------------------------------------------
// the vendored contract stays honest (drift)

/** The literal text of `export const <name> = …` in the Forge source (comments skipped, brackets balanced), or undefined. */
function upstreamLiteral(src, name) {
  const m = new RegExp(`export const ${name}\\s*=\\s*`).exec(src);
  if (!m) return undefined;
  const start = m.index + m[0].length;
  let depth = 0; let str = null; let esc = false; let i = start;
  for (; i < src.length; i++) {
    const c = src[i];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 1; continue; }
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') { depth--; if (depth < 0) break; }
    else if (depth === 0 && (c === ';' || c === '\n')) break;
  }
  return src.slice(start, i).trim();
}

test('workshop: the vendored Forge contract matches the upstream checkout, both ways', { skip: !fs.existsSync(FORGE) ? `${FORGE} not present` : false }, () => {
  const src = fs.readFileSync(FORGE, 'utf8');
  // (a) every vendored constant still exists upstream and is byte-for-byte the same value
  for (const [name, value] of Object.entries(vendored)) {
    const literal = upstreamLiteral(src, name);
    assert.ok(literal !== undefined, `upstream no longer defines ${name} — re-extract (shared/forgeContract.SOURCE.md)`);
    const upstream = Function(`"use strict"; return (${literal});`)();
    if (value instanceof RegExp) assert.equal(String(value), String(upstream), `${name} changed upstream`);
    else assert.deepEqual(value, upstream, `${name} changed upstream — re-extract (shared/forgeContract.SOURCE.md)`);
  }
  // (b) upstream must not have grown a pure-data `export const` we do not vendor (a new contract constant to decide about)
  const names = [...src.matchAll(/^export const ([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => m[1]);
  const missing = [];
  for (const name of names) {
    if (name in vendored) continue;
    const literal = upstreamLiteral(src, name);
    if (literal === undefined || literal.includes('=>') || /\bfunction\b/.test(literal)) continue; // a function, not data
    missing.push(name);
  }
  assert.deepEqual(missing, [], `upstream has contract constants not vendored here — decide and add them: ${missing.join(', ')}`);
});

/** A readable tag for a warning line in the per-pack loop above. */
function p_id(w) { return `${w.where}: ${w.warning}`; }

test('workshop: PACK_TYPES carries the type as supported and not live (a match must run the same data everywhere)', () => {
  assert.equal(PACK_TYPES.workshop.status, 'supported');
  assert.equal(PACK_TYPES.workshop.live, false);
  assert.deepEqual(PACK_TYPES.workshop.files, {});
});
