// server/http/announcements.js — the lobby notice board, sourced from outside this install.
//
// WHY THIS EXISTS: `data/announcements.json` is baked into the image (Dockerfile `COPY … /app/data`), so
// editing a notice meant a commit, a push and a redeploy — on ModelScope studios that is a console click, not
// a push (README §5: push ≠ deploy). This module lets an operator point ONE environment variable at a URL the
// server fetches, so publishing a notice stops being a deploy.
//
// WHY IT PROXIES INSTEAD OF LETTING THE BROWSER FETCH: the client reads the board through its own data store
// (public/js/data.js → `/data/announcements.json`), which is same-origin and has no notion of a second host.
// Answering that path from a fetched body keeps the client untouched — no CORS, no second origin, no client
// build to ship. It also keeps the editor's host out of the page.
//
// THE ONE INVARIANT: **with `SP_ANNOUNCEMENTS_URL` unset, nothing is different from a plain install.** No
// fetch at boot, no timer, no header, no log line, and the on-disk file is served byte for byte as before.
// A server that never heard of this module must stay indistinguishable from one that has it and does not use it.
//
// FAILURE IS SILENT BY DESIGN, AND HAS A FLOOR: a notice is optional decoration, never part of readiness
// (public/js/data.js: the lobby renders 暂无公告 when the file is absent). So a source that is down, slow or
// malformed must not fail the request, must not delay it, and must NOT be cached — the on-disk copy is the
// fallback for exactly as long as the source is unusable, and a source that recovers is picked up on the next
// poll without a restart.

import { noopLog } from '../../server/http/config.js';

/** The path this module answers (the client's data name is `announcements`, → /data/announcements.json). */
export const ANNOUNCEMENTS_PATH = '/data/announcements.json';
/** The startServer() option / environment variable naming the external source. */
export const ANNOUNCEMENTS_URL_OPT = 'announcementsUrl';
export const ANNOUNCEMENTS_URL_ENV = 'SP_ANNOUNCEMENTS_URL';

/** An answer too big to be a notice board. parseAnnouncements() (public/js/ui/announcements.js) caps content at 200k chars. */
const MAX_BYTES = 2 * 1024 * 1024;
/** How long one fetch may hang before we give up and serve the disk copy. */
const FETCH_TIMEOUT_MS = 8000;
/** Re-check the source this often. The lobby polls the server every 60s, so this bounds how stale a notice is. */
const POLL_MS = 60_000;
/** A source this slow is not "down", it is slow: serve the disk copy, keep the last good body until it answers. */
const STALE_GRACE_MULTIPLIER = 6;

const isAbsoluteHttp = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);

/**
 * Read the configured source URL (startServer() option wins, then the environment).
 * Anything that is not an absolute http(s) URL — unset, empty, a relative path, a `file:` URL — reads as
 * "not configured", so a typo can never turn into a request the operator did not intend.
 * @param {{ announcementsUrl?: string }} [opts]
 * @returns {string | null}
 */
export function announcementsUrlFrom(opts = {}) {
  // An empty option or environment value reads as unset (the same rule as PORT in config.js: listenAddress
  // treats `PORT=""` as absent), so a script that passes an empty string does not silently switch the feature off.
  const pick = (v) => (v == null || v === '' ? undefined : v);
  const raw = pick(opts[ANNOUNCEMENTS_URL_OPT]) ?? pick(process.env[ANNOUNCEMENTS_URL_ENV]);
  const v = typeof raw === 'string' ? raw.trim() : '';
  return isAbsoluteHttp(v) ? v : null;
}

/**
 * The external notice board: the body of the last successful fetch, or null while none has succeeded.
 *
 * The body is kept as TEXT, not parsed: this layer does not own the schema (public/js/ui/announcements.js
 * does, and it rejects malformed content itself). Handing back bytes also means a source that serves valid
 * JSON with fields this server has never heard of still works. The one check made here is content-type,
 * because serving an HTML error page as application/json would make the board unreadable in a way that
 * looks like a code bug rather than a source problem.
 * @param {{ url: string, fetch?: typeof fetch, setTimeout?: typeof setTimeout, log?: object }} opts
 */
export function createAnnouncementSource({ url, fetch: doFetch, setTimeout: armTimer, log = noopLog }) {
  const load = doFetch || ((...a) => globalThis.fetch(...a));
  const timer = armTimer || ((fn, ms) => setTimeout(fn, ms));
  /** @type {string | null} */
  let body = null;
  let lastOkAt = 0;
  let inFlight = null;
  let failures = 0;
  let staleSince = 0;
  let stopHandle = null;

  async function refresh() {
    if (inFlight) return inFlight;
    const controller = new AbortController();
    let handle = null;
    // The deadline is a RACE, not just the signal: a fetch that ignores `signal` (a proxy, a stub, a badly
    // behaved source) must still not hold a refresh open forever. The signal is passed too, so a well-behaved
    // source releases its socket instead of leaving it to time out on its own.
    let onTimeout;
    const deadline = new Promise((_, reject) => {
      onTimeout = () => reject(Object.assign(new Error('source timed out'), { timedOut: true }));
    });
    handle = timer(onTimeout, FETCH_TIMEOUT_MS);
    // The timer MUST be cleared on the success path too: a pending setTimeout keeps the Node event loop
    // alive (and would fire `onTimeout` into an already-settled promise), which shows up as the process
    // hanging for the full timeout after every refresh.
    inFlight = (async () => {
      try {
        const res = await Promise.race([
          load(url, { signal: controller.signal, headers: { accept: 'application/json' }, redirect: 'follow' }),
          deadline,
        ]);
        if (!res.ok) throw new Error(`source answered ${res.status}`);
        // A JSON content-type is required; a bare one (`text/plain`) is tolerated because a static host may
        // not map .json. Anything else (an HTML error page, a directory listing) is refused.
        const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (type && type !== 'application/json' && type !== 'text/json' && type !== 'text/plain') {
          throw new Error(`source content-type "${type}" is not JSON`);
        }
        const text = await res.text();
        if (text.length > MAX_BYTES) throw new Error(`source body too large (${text.length} bytes)`);
        JSON.parse(text); // Refuse a body the browser would fail to parse: fail here, not in every client.
        body = text;
        lastOkAt = Date.now();
        staleSince = 0;
        if (failures) log.warn(`[announcements] source recovered after ${failures} failure(s)`);
        failures = 0;
      } catch (err) {
        failures += 1;
        if (!staleSince) staleSince = Date.now();
        // The first failure is worth a line (a wrong URL is a configuration mistake); a source that stays
        // down must not log on every poll, or the log becomes the outage.
        if (failures === 1 || failures % 10 === 0) log.warn(`[announcements] source unreachable: ${err?.message || err}`);
      } finally {
        clearTimer(handle);
        controller.abort(); // a race the fetch lost must not keep its socket
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    /** The last good body, or null when the source has never answered (→ serve the on-disk copy). */
    body: () => body,
    /** Whether the last good body is still fresh enough to prefer over the disk copy. */
    fresh: () => body !== null && (Date.now() - lastOkAt) < POLL_MS * STALE_GRACE_MULTIPLIER,
    refresh,
    /** Start polling. Returns this source, so the caller keeps the handle it then passes to the static mount. */
    start() {
      refresh();
      const handle = timer(() => { refresh(); }, POLL_MS);
      handle?.unref?.();
      stopHandle = handle;
      return this;
    },
    /** Stop polling (a boot that failed after this point must not leave a timer behind). */
    stop() {
      if (stopHandle != null) { clearTimer(stopHandle); stopHandle = null; }
    },
    /** Test seam: what the last attempt did. */
    stats: () => ({ url, failures, lastOkAt, hasBody: body !== null }),
  };
}

/** clearTimeout on whatever the injected timer returned; an injected timer that cannot be cleared is the caller's. */
function clearTimer(handle) {
  if (handle == null) return;
  try { clearTimeout(handle); } catch { /* nothing to clear */ }
}
