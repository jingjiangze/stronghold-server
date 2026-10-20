// server/wsCompression.js — the server's binding of the vendored upstream transport-compression module.
//
// The option set, the compressible-type whitelist, the send-path counters and the read-only status routes
// are the upstream source of truth: `server/ws-compression/*` (jingjiangze/stronghold-ws-compression, MIT —
// see server/ws-compression/SOURCE.md). This file binds them to THIS server and nothing else:
//
//   * the environment variable names — `WS_COMPRESSION` / `WS_COMPRESS_EXTRA` are the upstream names, and the
//     server also accepts its historical `SP_WS_COMPRESSION` / `SP_WS_COMPRESS_EXTRA`, so a deployment that
//     still sets the old names keeps working through the switch;
//   * the process's single `TransportStats`, fed by `sendRaw` (server/net.js) and read by the status routes.
//
// Do not re-declare the option set here. The upstream module's whole argument (why `on` declares neither
// `serverNoContextTakeover` nor `serverMaxWindowBits`, why `threshold` is a hard switch) lives in its header;
// a second copy is a second thing to get wrong.

import {
  resolveWsCompression as upstreamResolve,
  createCompressFilter,
  describeWsCompression as upstreamDescribe,
  parseExtraCompressibleTypes,
  DEFAULT_EXTRA_COMPRESSIBLE_TYPES,
  STRONGHOLD_COMPRESSIBLE_TYPES,
  WS_COMPRESSION_MODES,
} from './wsCompression.mjs';
import { TransportStats, sendFrame } from './plumbing.mjs';
import { createReadonlyRouter, READONLY_ROUTES, cacheControlFor } from './readonlyRoutes.mjs';

export {
  parseExtraCompressibleTypes, DEFAULT_EXTRA_COMPRESSIBLE_TYPES, WS_COMPRESSION_MODES,
  READONLY_ROUTES, cacheControlFor, createReadonlyRouter, sendFrame, TransportStats,
};

/** The upstream base whitelist (the fork's own `m.damage` entry went away with the damage board). */
export const BASE_COMPRESSIBLE_TYPES = STRONGHOLD_COMPRESSIBLE_TYPES;

/** The mode: an explicit option first, then `WS_COMPRESSION`, then the historical `SP_WS_COMPRESSION`. */
export function wsCompressionMode(env = process.env, override) {
  if (override != null) return override;
  return env.WS_COMPRESSION ?? env.SP_WS_COMPRESSION ?? 'off';
}

/** The `perMessageDeflate` value for a mode — the upstream option set, unchanged.
 *  The refusal is the server's own: it names the accepted modes and does NOT echo the value it was given
 *  (the value comes from configuration, and an error line is a log line). */
export function resolveWsCompression(mode = 'off') {
  if (!WS_COMPRESSION_MODES.includes(mode)) throw new TypeError('WS compression mode must be off, on or safe');
  return upstreamResolve(mode);
}

/** What will actually reach the wire, including the two undeclared options (logs + the status route). */
export function describeWsCompression(mode) {
  return upstreamDescribe(mode);
}

/** The extra-type spec under either name. */
const extraSpec = (env) => env.WS_COMPRESS_EXTRA ?? env.SP_WS_COMPRESS_EXTRA;

/** The resolved type list: the upstream base set ∪ the configured extras. */
function resolvedTypeList(env = process.env) {
  return [...STRONGHOLD_COMPRESSIBLE_TYPES, ...parseExtraCompressibleTypes(extraSpec(env))];
}

/** The resolved list for the current process, observably (not inferred). */
export function compressibleTypes() {
  return resolvedTypeList();
}

/** The process's transport counters — one instance, read by the read-only status routes. */
export const transportStats = new TransportStats();

/** True for the message types this process compresses: the upstream base set ∪ the extras. */
export const isCompressibleType = createCompressFilter(resolvedTypeList());

/**
 * The read-only transport surface (`/ws-compression/status`, `/ws-compression/stats`), wired into the HTTP
 * request handler ahead of the static mount. `sockets` is injected so this module never learns about `ws`.
 */
export function createTransportRoutes({ mode, sockets = () => 0, startedAt = Date.now() } = {}) {
  return createReadonlyRouter({
    mode, sockets, stats: transportStats, compressibleTypes: resolvedTypeList(),
    describe: upstreamDescribe, startedAt,
  });
}
