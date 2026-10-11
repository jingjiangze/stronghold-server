// Public material failover only: retry a failed same-origin asset once through the paired OpenI inventory.
// Never inspect provider redirects/signatures, replace global fetch, or change authentication/business requests.

export const MATERIAL_TIMEOUT_MS = 8000;
const EXTENSIONS = /\.(?:png|jpg|jpeg|webp|gif|atlas|skel|obj|mtl|json|mp3|m4a|aac|ogg|oga|opus|wav)$/;

/** Raw-path validation comes before URL normalization (which would hide traversal). No signed/custom queries. */
function materialUrl(value, origin = globalThis.location?.origin) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\s\\#\u0000-\u001f\u007f]/.test(value)) return null;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (value.startsWith('//') || (absolute && !origin)) return null;
  const raw = absolute ? /^https?:\/\/[^/?#]+(\/[^?#]*)/.exec(value)?.[1] : value.split('?')[0];
  if (!raw || !raw.startsWith('/') || /%(?:2f|5c)/i.test(raw)) return null;
  let path, url;
  try { path = decodeURIComponent(raw); url = new URL(value, origin || 'http://localhost'); } catch { return null; }
  if (url.origin !== (origin || 'http://localhost') || url.username || url.password) return null;
  if (!/^\/(?:assets|media)\//.test(path) || path.split('/').slice(1).some(s => !/^[A-Za-z0-9_\[\]-][A-Za-z0-9_.\[\]-]*$/.test(s) || s.endsWith('.'))) return null;
  if (path.startsWith('/assets/') && !EXTENSIONS.test(path)) return null;
  const query = [...url.searchParams];
  if (query.length && (query.length !== 1 || query[0][0] !== 'sp_source' || query[0][1] !== 'openi')) return null;
  return url;
}

export const isPublicMaterialUrl = (value, origin = globalThis.location?.origin) => !!materialUrl(value, origin);

export function openiFallbackUrl(value, origin = globalThis.location?.origin) {
  const url = materialUrl(value, origin);
  return url && !url.search ? `${url.pathname}?sp_source=openi` : null;
}

const aborted = () => Object.assign(new Error('material load aborted'), { name: 'AbortError' });

/** One bounded attempt; abort fetch/Image when possible and dispose abandoned late decoded resources. */
function attempt(url, load, { timeoutMs, signal, discard }) {
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let done = false, timer;
    const finish = (err, value) => {
      if (done) { if (!err) { try { discard?.(value); } catch { /* abandoned resource */ } } return; }
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (err) { controller.abort(); reject(err); } else resolve(value);
    };
    const cancel = () => finish(aborted());
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => finish(new Error('material load timeout')), timeoutMs);
    Promise.resolve().then(() => load(url, controller.signal)).then(v => finish(null, v), err => finish(err));
  });
}

/** Successful requests are never duplicated. An explicit OpenI attempt cannot recurse; caller cancellation cannot retry. */

/**
 * 发布排名（rank.json，speedcdn/weishucdn 同桶）：客户端**会话内只取一次**，之后按排名回退。
 * 只在浏览器里取（node 测试环境返回空数组 → 行为与"只用 OpenI"完全一致，测试不受影响）。
 */
export const RANK_URL = 'https://speedcdn.jiangjiangze.icu/cdn/v1/rank.json';
export const RANK_TTL_MS = 30 * 60 * 1000;
let rankCache = null, rankInflight = null;
export async function rankedSourceIds(fetchImpl = globalThis.fetch) {
  if (rankCache && Date.now() - rankCache.at < RANK_TTL_MS) return rankCache.ids;
  if (rankInflight) return rankInflight;
  if (typeof window === 'undefined' || typeof fetchImpl !== 'function') return [];
  rankInflight = (async () => {
    try {
      const res = await fetchImpl(RANK_URL, { cache: 'force-cache' });
      const doc = await res.json();
      const ids = (doc?.rank || [])
        .filter((r) => r && r.excluded !== true && r.down !== true && r.usable !== false)
        .map((r) => r.id).filter((id) => typeof id === 'string' && id);
      rankCache = { ids, at: Date.now() };
      return ids;
    } catch { return []; } finally { rankInflight = null; }
  })();
  return rankInflight;
}

/** 失败回退次序：排名里除当前源之外的（默认最多 2 个）+ OpenI 兜底（去重）。 */
export async function fallbackSources(value, origin, { max = 2, fetchImpl = globalThis.fetch } = {}) {
  const url = materialUrl(value, origin);
  if (!url) return [];
  const out = [];
  const ids = await rankedSourceIds(fetchImpl).catch(() => []);
  const current = url.searchParams.get('sp_source');
  for (const id of ids) { if (out.length >= max) break; if (id !== current) out.push(`${url.pathname}?sp_source=${id}`); }
  const openi = openiFallbackUrl(value, origin);
  if (openi && !out.includes(openi)) out.push(openi);
  return out;
}

export async function withMaterialFallback(url, load, options = {}) {
  if (!materialUrl(url, options.origin)) return load(url, options.signal);
  const settings = { timeoutMs: MATERIAL_TIMEOUT_MS, ...options };
  try { return await attempt(url, load, settings); }
  catch (err) {
    if (options.fallback === false || options.signal?.aborted || err?.name === 'AbortError') throw err;
    const candidates = await fallbackSources(url, options.origin, { max: options.maxFallbacks ?? 2, fetchImpl: options.rankFetch || globalThis.fetch }).catch(() => []);
    if (!candidates.length) throw err;
    let last = err;
    for (const candidate of candidates) {
      if (options.signal?.aborted) throw last;
      try { return await attempt(candidate, load, settings); }
      catch (e) { last = e; if (e?.name === 'AbortError') throw e; }
    }
    throw last;
  }
}

/** Consume inside the attempt: stalled/error bodies and invalid JSON can fail over, not just fetch() headers. */
export function fetchMaterial(url, read = r => r.arrayBuffer(), { fetch: doFetch = (...a) => globalThis.fetch(...a), ...options } = {}) {
  return withMaterialFallback(url, async (source, signal) => {
    const res = await doFetch(source, { credentials: 'omit', signal });
    if (!res?.ok || /(?:text\/html|application\/xhtml\+xml)/i.test(res.headers?.get?.('content-type') || '')) {
      try { void res?.body?.cancel?.().catch(() => {}); } catch { /* unusable response */ }
      throw Object.assign(new Error('material response unavailable'), { status: res?.status, badContentType: !!res?.ok });
    }
    return read(res);
  }, options);
}

/** CORS-safe Image for canvas/preload; cancellation releases listeners and the pending image request. */
export function loadMaterialImage(url, options) {
  return withMaterialFallback(url, (source, signal) => new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') { reject(new Error('no Image in this environment')); return; }
    const img = new Image();
    const clear = () => { img.onload = img.onerror = null; signal?.removeEventListener('abort', cancel); };
    const cancel = () => { clear(); img.src = ''; reject(aborted()); };
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    img.onload = () => { clear(); resolve(img); };
    img.onerror = () => { clear(); reject(new Error('material image unavailable')); };
    signal?.addEventListener('abort', cancel, { once: true });
    img.src = source;
  }), options);
}
