// server/modBridge.js — the ADAPTER between this server's own pack registry (server/packs.js) and the vendored
// mod-manager (Forge) server-side payload layer (server/modDispatch.js, server/modModules.js, server/modGate.js —
// see MOD-BRIDGE.SOURCE.md; never edit those three to change behaviour, edit this file).
//
// What a pack may declare (DESIGN §28.13 / §28.14 of the Forge contract):
//   server.preDispatch  { module (.mjs), policy (.json), intercepts: message types }  a per-connection gate called
//                       from Network.onFrame, after protocol validation and before `ping` / `hello` / the
//                       "hello required" check (see server/net.js for why the order matters);
//   server.modules      [{ id, entry (.mjs), uses ⊆ { boot, shutdown, matchClass, healthz }, write? }]  process-level
//                       hooks: run once after listen, once on shutdown, contribute fields to /healthz, or wrap Match.
//
// Two rules this file exists to hold:
//
//   1. **Fail by naming the pack, never by pretending it loaded.** Every failure below — a module that will not import,
//      a factory that is missing, a policy the module's own `validatePolicy` refuses, an `intercepts` entry this server
//      has no message type for — removes the WHOLE pack from the loaded set rather than letting it load without the
//      thing it declared. A pack whose gate is not installed while its content is merged is exactly the failure the
//      contract calls out: the operator believes a gate is shut while every entry message reaches the lobby.
//   2. **With no pack declaring any of this, nothing is installed and nothing changes.** `loadWorkshopServer` returns
//      `null`-ish semantics: `preDispatch` and `onConnection` stay `undefined` (so Network's `onFrame` does not enter
//      the branch at all — no object created, no log line, no second `socket.on('message')`), `boot` / `shutdown` are
//      no-ops, `/healthz` gains no `modHealth` key, and `MatchClass` stays the class the caller passed in.
//
// The injection surface a hook gets is the vendored one (server/modDispatch.js): `pack`, `policy`, `policyFile`,
// `intercepts`, `c2s`, `log`, `now`, `send`. It deliberately has no `data`, no `lobby`, no `Match` — a pack that does
// not declare `combat: true` cannot change a battle result, structurally rather than by author discipline.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { C2S } from '../shared/protocol.js';
import { SERVER_MODULE_USES, HEALTHZ_LIMITS } from '../shared/forgeContract.js';
import { preDispatchIssues, validateHookPolicy } from './modGate.js';
import { createModDispatch } from './modDispatch.js';
import { loadServerModules, mountServerModules, stateRootFor } from './modModules.js';

/** @typedef {{ id: string, dir: string, hash?: string, manifest?: any, server?: any }} ScannedPack */

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** Pack id order (the same rule everywhere in this contract): a result must not depend on directory read order. */
const byPackId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

/** A pack's directory on disk: the registry's `where` is `packs/<id>/`, an absolute path is already one. */
function packDirOf(pack) {
  if (typeof pack.dir === 'string' && pack.dir) return path.resolve(pack.dir);
  if (typeof pack.where === 'string' && pack.where) return path.resolve(pack.where);
  return null;
}

/**
 * The load-time gate for one pack's `server.preDispatch`: the vendored `preDispatchIssues` (files) plus the two
 * judgements only a dynamic import can make (does it import, does it export a factory), plus the module's own verdict
 * on its policy file. Same order and same codes as upstream's `loadWorkshopHooks`.
 * @param {ScannedPack} pack
 * @param {{ c2s?: Record<string, any> }} opts
 * @returns {Promise<{ hook?: object, error?: { pack: string, code: string, reason: string } }>}
 */
async function loadPreDispatch(pack, { c2s }) {
  const decl = pack.server?.preDispatch;
  if (!decl) return {};
  const dir = packDirOf(pack);
  if (!dir) return { error: { pack: pack.id, code: 'PREDISPATCH_BAD_PATH', reason: 'the pack has no directory on disk' } };
  const issues = preDispatchIssues(pack, dir, { c2s });
  if (issues.length) return { error: { pack: pack.id, code: issues[0].code, reason: issues[0].reason } };

  const moduleAbs = path.join(dir, ...String(decl.module).split('/'));
  const policyAbs = path.join(dir, ...String(decl.policy).split('/'));
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(policyAbs, 'utf8'));
  } catch (e) {
    return { error: { pack: pack.id, code: 'PREDISPATCH_BAD_POLICY', reason: `server.preDispatch.policy "${decl.policy}" is not readable JSON: ${e?.message || e}` } };
  }
  let mod;
  try {
    // The mtime both defeats Node's ESM cache and makes two versions of one module two URLs (same reason as upstream).
    const v = Math.round(fs.statSync(moduleAbs).mtimeMs);
    mod = await import(`${pathToFileURL(moduleAbs).href}?v=${v}`);
  } catch (e) {
    return { error: { pack: pack.id, code: 'PREDISPATCH_BAD_MODULE', reason: `server.preDispatch.module "${decl.module}" failed to import: ${e?.message || e}` } };
  }
  const create = typeof mod.createPreDispatch === 'function' ? mod.createPreDispatch
    : (typeof mod.default === 'function' ? mod.default : null);
  if (!create) {
    return { error: { pack: pack.id, code: 'PREDISPATCH_BAD_MODULE', reason: `server.preDispatch.module "${decl.module}" must export createPreDispatch(deps) (or default-export that function)` } };
  }
  const refusal = validateHookPolicy(mod, policy);
  if (refusal) {
    return { error: { pack: pack.id, code: 'PREDISPATCH_BAD_POLICY', reason: `server.preDispatch.module "${decl.module}" refused its own policy "${decl.policy}": ${refusal}` } };
  }
  return { hook: { pack: pack.id, module: decl.module, policyFile: decl.policy, policy, intercepts: [...decl.intercepts], create } };
}

/**
 * Load every pack's declared server-side payload and assemble it into the five things the server consumes.
 *
 * @param {ScannedPack[] | { packs: ScannedPack[] } | null} loaded this server's scanned packs (server/packs.js)
 * @param {{ log?: any, stateRoot?: string | null, c2s?: Record<string, any>, repoRoot?: string,
 *           send?: (conn: any, msg: object) => unknown }} [opts]
 *   `send` must be the framework's own send helper (`(conn, msg) => network.reply(conn, msg)`): it carries the
 *   backpressure guard, and a pack writing to the socket itself would be a second write path.
 * @returns {Promise<{
 *   preDispatch?: (conn: any, msg: object) => boolean,
 *   onConnection?: (conn: any) => void,
 *   boot: () => void,
 *   shutdown: () => void,
 *   healthz: () => Record<string, Record<string, any>>,
 *   matchClassFor: (base: Function) => Function,
 *   packs: string[], intercepts: string[], removed: { pack: string, code: string, reason: string }[],
 *   errors: { pack: string, code: string, reason: string }[] }>}
 */
/**
 * The view of a scanned pack the vendored loaders expect.
 *
 * The registry (server/packs.js) puts the normalized manifest — the one carrying `server` — under `pack.manifest`,
 * while the vendored `loadServerModules` (upstream, unedited) reads `pack.server` / `pack.dir` / `pack.hash`. Rather
 * than editing the vendored file, the adapter hands it this projection; it is also the one place that decides which
 * packs have a server-side payload at all.
 * @param {ScannedPack} p
 */
function asLoaderPack(p) {
  const server = p.server ?? p.manifest?.server ?? null;
  const dir = packDirOf(p);
  return { id: p.id, dir: dir ?? '', hash: p.hash ?? p.manifest?.hash ?? '', server };
}

export async function loadWorkshopServer(loaded, { log = noopLog, stateRoot = null, c2s = C2S, repoRoot = null, send = null } = {}) {
  const logger = log || noopLog;
  const packs = ((Array.isArray(loaded) ? loaded : loaded?.packs) || [])
    .map(asLoaderPack)
    .filter((p) => p && typeof p.id === 'string' && p.server && p.dir)
    .slice()
    .sort(byPackId);
  const errors = [];
  const hooks = [];
  for (const pack of packs) {
    const r = await loadPreDispatch(pack, { c2s });
    if (r.error) { errors.push(r.error); continue; }
    if (r.hook) hooks.push(r.hook);
  }
  // server/modules: the vendored loader reads `pack.dir` and `pack.server.modules`, both of which the scan provides.
  const root = stateRoot ?? (repoRoot ? stateRootFor(repoRoot) : null);
  const modulesResult = await loadServerModules({ packs }, { log: logger, stateRoot: root });
  for (const e of modulesResult.errors) errors.push(e);

  // One prune point for every declared server-side payload (upstream's `dropUnavailablePreDispatchPacks`): a pack that
  // was dropped for its module must not keep its hook either, and vice versa.
  const failing = new Set(errors.map((e) => e.pack));
  const removed = [];
  const survivors = [];
  for (const p of packs) {
    if (!failing.has(p.id)) { survivors.push(p); continue; }
    const e = errors.find((x) => x.pack === p.id);
    removed.push({ pack: p.id, code: e.code, reason: e.reason });
  }
  if (removed.length) {
    logger.warn?.(`[workshop] dropped ${removed.length} pack(s) whose declared server-side payload cannot be installed: `
      + removed.map((r) => `"${r.pack}" (${r.code})`).join(', '));
  }
  for (const e of errors) logger.warn?.(`[workshop] ${e.pack}: ${e.code}: ${e.reason}`);

  const liveHooks = hooks.filter((h) => !failing.has(h.pack)).sort((a, b) => byPackId({ id: a.pack }, { id: b.pack }));
  const liveModules = modulesResult.modules.filter((m) => !failing.has(m.pack));
  const mount = mountServerModules(liveModules, { log: logger });

  // With no hooks at all `createModDispatch` returns null: Network then gets neither option and `onFrame` does not
  // enter the branch (the vendored file's own invariant, and the reason `send` may be null only in that case).
  const dispatch = liveHooks.length ? createModDispatch({ hooks: liveHooks, send, log: logger, c2s }) : null;
  if (!dispatch && liveHooks.length && typeof send !== 'function') {
    throw new TypeError('loadWorkshopServer needs a send(conn, msg) function when a pack declares server.preDispatch');
  }

  return {
    // `undefined` (not a no-op function) when nothing is installed: server/net.js tests `typeof === 'function'`.
    preDispatch: dispatch?.preDispatch,
    onConnection: dispatch?.onConnection,
    /** After listen; a throwing module is logged and must not stop the server. */
    boot: () => mount.boot(),
    /** During close; a throwing module is logged and must not block shutdown. */
    shutdown: () => mount.shutdown(),
    /** `/healthz` contributions grouped by pack id; an empty object means the caller adds no key at all. */
    healthz: () => mount.healthz(),
    /** `MatchClass` wrappers, applied in pack-id order (the first pack's wrapper innermost), as upstream does. */
    matchClassFor: (base) => {
      let out = base;
      for (const w of mount.matchClassWrappers()) out = w.fn(out);
      return out;
    },
    packs: liveHooks.map((h) => h.pack),
    intercepts: dispatch?.intercepts || [],
    removed,
    errors,
  };
}

export { SERVER_MODULE_USES, HEALTHZ_LIMITS };
