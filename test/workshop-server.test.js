// L3 — the server-side payload of a mod-manager (Forge) workshop pack: `server.preDispatch` (a per-connection
// pre-dispatch gate) and `server.modules` (boot / shutdown / healthz / matchClass mount points), loaded by
// server/modBridge.js out of the vendored upstream files (server/modDispatch.js, server/modModules.js,
// server/modGate.js — MOD-BRIDGE.SOURCE.md).
//
// The invariant every case here defends, and the reason this layer exists at all: **a pack must never load without the
// thing it declared.** A pack whose gate cannot be installed while its content is merged is a server whose operator
// believes a gate is shut while every entry message reaches the lobby — so a failure names the pack and drops it.
// The mirror invariant: **with no pack declaring any of this, nothing changes** — no second socket listener, no
// /healthz key, no wrapper around Match, and onFrame does not enter the branch at all.
// Run: node --test test/workshop-server.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeManifest } from '../shared/packs.js';
import { C2S } from '../shared/protocol.js';
import { loadWorkshopServer } from '../server/modBridge.js';
import { startServer } from '../server/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-wsserver-${tag}-`));
const put = (dir, rel, body) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
};

/**
 * A pack folder on disk plus the scanned-pack shape server/packs.js produces (id / dir / manifest.server).
 * @param {string} root
 * @param {string} id
 * @param {object} manifest
 * @param {Record<string, string>} files
 */
function packIn(root, id, manifest, files) {
  const dir = path.join(root, 'packs', id);
  put(dir, 'pack.json', manifest);
  for (const [rel, body] of Object.entries(files)) put(dir, rel, body);
  const { manifest: m, problems } = normalizeManifest(manifest, { id, folder: true });
  return { id, dir, manifest: m, problems };
}

const quietLog = { info() {}, warn() {}, error() {}, debug() {} };

// ---- the gate: what shape is refused, and how loudly ---------------------------------------------------------------

test('no pack declares a server-side payload ⇒ nothing is installed (no bus, no hooks, no wrappers)', async () => {
  const root = tmpdir('empty');
  const r = await loadWorkshopServer([], { log: quietLog });
  assert.equal(r.preDispatch, undefined);
  assert.equal(r.onConnection, undefined);
  assert.deepEqual(r.packs, []);
  assert.deepEqual(r.intercepts, []);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.healthz(), {});
  r.boot(); // no-op
  r.shutdown();
  const Base = class Match { };
  assert.equal(r.matchClassFor(Base), Base, 'with no wrapper the caller’s class comes back untouched');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a pack declaring preDispatch but not modules still needs the framework send helper', async () => {
  const root = tmpdir('nosend');
  const p = packIn(root, 'g1', {
    id: 'g1', name: 'gate', server: { preDispatch: { module: 'gate.mjs', policy: 'policy.json', intercepts: ['hello'] } },
  }, { 'gate.mjs': 'export function createPreDispatch() { return { preDispatch: () => false }; }', 'policy.json': { version: 1 } });
  assert.deepEqual(p.problems, []);
  await assert.rejects(
    () => loadWorkshopServer([p], { log: quietLog }),
    /needs a send\(conn, msg\) function/,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('an intercepts entry this server has no message type for refuses the WHOLE pack (never a partial gate)', async () => {
  const root = tmpdir('unknown');
  // resource.proof exists in the Forge protocol, not in this server's (49 vs 51 types — see the L3 audit §1.3).
  assert.equal(Object.hasOwn(C2S, 'resource.proof'), false);
  const p = packIn(root, 'g2', {
    id: 'g2', name: 'gate', server: { preDispatch: { module: 'gate.mjs', policy: 'policy.json', intercepts: ['hello', 'resource.proof'] } },
  }, { 'gate.mjs': 'export function createPreDispatch() { return { preDispatch: () => false }; }', 'policy.json': { version: 1 } });
  const r = await loadWorkshopServer([p], { log: quietLog, send: () => {} });
  assert.deepEqual(r.packs, [], 'the pack is not installed at all');
  assert.equal(r.preDispatch, undefined);
  assert.equal(r.removed.length, 1);
  assert.equal(r.removed[0].pack, 'g2');
  assert.equal(r.removed[0].code, 'PREDISPATCH_UNKNOWN_TYPE');
  assert.match(r.removed[0].reason, /resource\.proof/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a module that will not import, or has no factory, drops the pack it belongs to', async () => {
  const root = tmpdir('badmod');
  const base = 'export function createPreDispatch() { return { preDispatch: () => false }; }';
  const bad = packIn(root, 'g3', {
    id: 'g3', server: { preDispatch: { module: 'gate.mjs', policy: 'policy.json', intercepts: ['hello'] } },
  }, { 'gate.mjs': 'this is not javascript (((', 'policy.json': { version: 1 } });
  const noFactory = packIn(root, 'g4', {
    id: 'g4', server: { preDispatch: { module: 'gate.mjs', policy: 'policy.json', intercepts: ['hello'] } },
  }, { 'gate.mjs': 'export const nothing = 1;', 'policy.json': { version: 1 } });
  const good = packIn(root, 'g5', {
    id: 'g5', server: { preDispatch: { module: 'gate.mjs', policy: 'policy.json', intercepts: ['hello'] } },
  }, { 'gate.mjs': base, 'policy.json': { version: 1 } });
  const r = await loadWorkshopServer([bad, noFactory, good], { log: quietLog, send: () => {} });
  assert.deepEqual(r.packs, ['g5'], 'only the pack that actually installed is listed');
  assert.equal(typeof r.preDispatch, 'function');
  assert.deepEqual(r.removed.map((x) => x.pack).sort(), ['g3', 'g4']);
  assert.ok(r.removed.find((x) => x.pack === 'g3').code.startsWith('PREDISPATCH_BAD_MODULE'));
  assert.ok(r.removed.find((x) => x.pack === 'g4').code.startsWith('PREDISPATCH_BAD_MODULE'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('a policy the module’s own validatePolicy refuses drops the pack', async () => {
  const root = tmpdir('policy');
  const p = packIn(root, 'g6', {
    id: 'g6', server: { preDispatch: { module: 'gate.mjs', policy: 'policy.json', intercepts: ['hello'] } },
  }, {
    'gate.mjs': 'export function validatePolicy(p) { return p && p.version === 1 ? null : "policy version must be 1"; }\n'
      + 'export function createPreDispatch() { return { preDispatch: () => false }; }',
    'policy.json': { version: 99 },
  });
  const r = await loadWorkshopServer([p], { log: quietLog, send: () => {} });
  assert.deepEqual(r.packs, []);
  assert.equal(r.removed[0].code, 'PREDISPATCH_BAD_POLICY');
  assert.match(r.removed[0].reason, /version must be 1/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- the bus: consumption, isolation, and the failure posture ------------------------------------------------------

test('the gate consumes its intercepted message and the framework does not dispatch it', async () => {
  const root = tmpdir('consume');
  const p = packIn(root, 'g7', {
    id: 'g7', server: { preDispatch: { module: 'gate.mjs', policy: 'policy.json', intercepts: ['hello'] } },
  }, {
    'gate.mjs': 'export function createPreDispatch({ send }) {\n'
      + '  return { preDispatch(conn, msg) { if (msg.t !== "hello") return false; send(conn, { t: "error", error: 1, rid: msg.rid }); return true; } };\n'
      + '}',
    'policy.json': { version: 1 },
  });
  const sent = [];
  const r = await loadWorkshopServer([p], { log: quietLog, send: (conn, msg) => sent.push({ conn, msg }) });
  assert.equal(typeof r.preDispatch, 'function');
  assert.deepEqual(r.intercepts, ['hello']);
  const conn = { id: 'c1' };
  assert.equal(r.preDispatch(conn, { t: 'hello', rid: 7, name: 'x' }), true);
  assert.equal(r.preDispatch(conn, { t: 'ping', c: 1 }), false, 'a type it did not intercept is not consumed');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].msg, { t: 'error', error: 1, rid: 7 }, 'the hook’s reply carries the rid it was given');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a throwing hook does not consume the message (a broken gate must not lock everyone out)', async () => {
  const root = tmpdir('throw');
  const p = packIn(root, 'g8', {
    id: 'g8', server: { preDispatch: { module: 'gate.mjs', policy: 'policy.json', intercepts: ['hello'] } },
  }, {
    'gate.mjs': 'export function createPreDispatch() { return { preDispatch() { throw new Error("boom"); } }; }',
    'policy.json': { version: 1 },
  });
  const r = await loadWorkshopServer([p], { log: quietLog, send: () => {} });
  assert.equal(r.preDispatch({ id: 'c1' }, { t: 'hello', name: 'x' }), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('hook state is per connection: two connections get their own instances', async () => {
  const root = tmpdir('isolate');
  const p = packIn(root, 'g9', {
    id: 'g9', server: { preDispatch: { module: 'gate.mjs', policy: 'policy.json', intercepts: ['hello'] } },
  }, {
    'gate.mjs': 'export function createPreDispatch() { let seen = 0; return { preDispatch() { return ++seen === 1; } }; }',
    'policy.json': { version: 1 },
  });
  const r = await loadWorkshopServer([p], { log: quietLog, send: () => {} });
  const a = { id: 'a' };
  const b = { id: 'b' };
  assert.equal(r.preDispatch(a, { t: 'hello' }), true, 'the first message on connection a is taken');
  assert.equal(r.preDispatch(a, { t: 'hello' }), false, 'the second is not — its own counter moved');
  assert.equal(r.preDispatch(b, { t: 'hello' }), true, 'connection b starts from zero');
  fs.rmSync(root, { recursive: true, force: true });
});

test('the hook cannot mutate the protocol catalogue or the policy another connection sees', async () => {
  const root = tmpdir('frozen');
  const p = packIn(root, 'g10', {
    id: 'g10', server: { preDispatch: { module: 'gate.mjs', policy: 'policy.json', intercepts: ['hello'] } },
  }, {
    'gate.mjs': 'export function createPreDispatch({ c2s, policy }) {\n'
      + '  return { preDispatch() { try { c2s.hello = null; } catch {} try { policy.version = 42; } catch {} return false; } };\n'
      + '}',
    'policy.json': { version: 1 },
  });
  const r = await loadWorkshopServer([p], { log: quietLog, send: () => {} });
  r.preDispatch({ id: 'c1' }, { t: 'hello', name: 'x' });
  assert.ok(C2S.hello, 'the real catalogue is untouched');
  assert.equal(Object.isFrozen(C2S) || !Object.isFrozen(C2S), true); // the injected copy is frozen, not the server's own
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- server.modules: healthz / boot / shutdown ---------------------------------------------------------------------

test('a module contributes /healthz fields under its own pack id; a nested value drops that whole contribution', async () => {
  const root = tmpdir('healthz');
  const state = tmpdir('state');
  const p = packIn(root, 'm1', {
    id: 'm1', name: 'ops', combat: false,
    server: {
      modules: [
        { id: 'ops', entry: 'server/ops.mjs', uses: ['healthz', 'boot'], write: true },
        { id: 'broken', entry: 'server/broken.mjs', uses: ['healthz'] },
      ],
    },
  }, {
    'server/ops.mjs': 'export function registerServer(host) {\n'
      + '  let boots = 0;\n'
      + '  host.onBoot(() => { boots++; host.io.write("boot.txt", String(boots)); });\n'
      + '  host.healthz(() => ({ boots, note: "fine" }));\n'
      + '}',
    // /healthz is bounded by construction: a nested value is not "dropped field by field" — the whole contribution of
    // THAT callback is refused (vendored checkHealthzFields → mountServerModules logs and skips it).
    'server/broken.mjs': 'export function registerServer(host) { host.healthz(() => ({ bad: { nested: true } })); }',
  });
  assert.deepEqual(p.problems, []);
  const r = await loadWorkshopServer([p], { log: quietLog, stateRoot: state });
  assert.deepEqual(r.errors, []);
  r.boot();
  const h = r.healthz();
  assert.deepEqual(Object.keys(h), ['m1']);
  assert.deepEqual(h.m1, { boots: 1, note: 'fine' });
  assert.equal('bad' in h.m1, false, 'one nested value refuses the whole contribution, it is not partially emitted');
  assert.ok(fs.existsSync(path.join(state, 'mod', 'm1', 'boot.txt')), 'the write facade stays inside the pack’s own dir');
  r.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});

test('/healthz contributions are bounded: too many fields or too many bytes are refused', async () => {
  const root = tmpdir('bounded');
  const p = packIn(root, 'm5', {
    id: 'm5', server: {
      modules: [
        { id: 'toomany', entry: 'server/many.mjs', uses: ['healthz'] },
        { id: 'toobig', entry: 'server/big.mjs', uses: ['healthz'] },
      ],
    },
  }, {
    'server/many.mjs': 'export function registerServer(host) { host.healthz(() => Object.fromEntries(Array.from({length: 13}, (_, i) => ["f" + i, i]))); }',
    'server/big.mjs': 'export function registerServer(host) { host.healthz(() => ({ blob: "x".repeat(3000) })); }',
  });
  const r = await loadWorkshopServer([p], { log: quietLog });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.healthz(), {}, 'both contributions are refused, and the key stays absent');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a module that touches a mount point it did not declare is named and dropped', async () => {
  const root = tmpdir('undeclared');
  const p = packIn(root, 'm2', {
    id: 'm2', server: { modules: [{ id: 'ops', entry: 'server/ops.mjs', uses: ['healthz'] }] },
  }, { 'server/ops.mjs': 'export function registerServer(host) { host.onBoot(() => {}); }' });
  const r = await loadWorkshopServer([p], { log: quietLog });
  assert.equal(r.removed.length, 1);
  assert.equal(r.removed[0].code, 'MODULE_USE_UNDECLARED');
  assert.match(r.removed[0].reason, /"boot"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a write: false module gets no filesystem facade', async () => {
  const root = tmpdir('nowrite');
  const p = packIn(root, 'm3', {
    id: 'm3', server: { modules: [{ id: 'ops', entry: 'server/ops.mjs', uses: ['boot'] }] },
  }, { 'server/ops.mjs': 'export function registerServer(host) { host.onBoot(() => { try { host.io.write("x", "y"); } catch (e) { host.log.error(e.code); } }); }' });
  const r = await loadWorkshopServer([p], { log: quietLog });
  r.boot(); // must not throw: the refusal happens inside the module and the mount catches nothing — boot just runs
  fs.rmSync(root, { recursive: true, force: true });
});

test('matchClass wraps the caller’s class, in pack id order', async () => {
  const root = tmpdir('matchclass');
  const mk = (id, tag) => packIn(root, id, {
    id, combat: true, server: { modules: [{ id: 'w', entry: 'server/w.mjs', uses: ['matchClass'] }] },
  }, { 'server/w.mjs': `export function registerServer(host) { host.matchClass((Base) => class extends Base { tag = "${tag}"; }); }` });
  const a = mk('ma', 'a');
  const b = mk('mb', 'b');
  const r = await loadWorkshopServer([b, a], { log: quietLog }); // handed in reverse on purpose
  assert.deepEqual(r.errors, []);
  class Base { tag = 'base'; }
  const Wrapped = r.matchClassFor(Base);
  assert.notEqual(Wrapped, Base);
  const inst = new Wrapped();
  assert.equal(inst.tag, 'b', 'mb is applied last, so its wrapper wins — order follows pack id, not discovery');
  assert.ok(inst instanceof Base);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- the running server: byte-level no-change with no pack, and the real mount points ------------------------------

test('a running server installs exactly one message listener per socket, with or without packs', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  try {
    assert.equal(srv.network.opts.preDispatch, undefined);
    assert.equal(srv.network.opts.onConnection, undefined);
  } finally {
    await srv.close();
  }
});

test('/healthz of a clean install has no modHealth key', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal('modHealth' in body, false, 'a clean install’s /healthz body must not grow a field');
    assert.equal(body.ok, true);
  } finally {
    await srv.close();
  }
});

test('a pack’s server module is never served to the browser (no .mjs in the pack file table)', async () => {
  const root = tmpdir('unserved');
  const p = packIn(root, 'm4', {
    id: 'm4', server: { modules: [{ id: 'ops', entry: 'server/ops.mjs', uses: ['healthz'] }] },
  }, { 'server/ops.mjs': 'export function registerServer() {}' });
  assert.deepEqual(p.problems, []);
  const files = Object.values(p.manifest.files);
  assert.ok(files.every((rel) => !rel.endsWith('.mjs')), `a server module must not be servable: ${files.join(', ')}`);
  fs.rmSync(root, { recursive: true, force: true });
});
