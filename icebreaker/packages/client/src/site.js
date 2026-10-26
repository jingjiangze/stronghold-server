// The site's own URLs (docs/spec/site.md 站点-1): the pages sit side by side (/, play, room) and everything else is
// next to them, so every URL is made from the page's own address — the site may be served under any path behind a
// proxy (https://host/icebreaker/), never only at the root.

/** A URL of the site, from a path relative to its pages (no leading slash). @param {string} path @param {string} [page] */
export const siteUrl = (path, page = location.href) => new URL(path, page);

/**
 * The WebSocket URL of a path of the site: ws: beside http:, wss: beside https:; on another node's host when one is given
 * (站点-6: the room's node), the path the same.
 * @param {string} path @param {string} [page] @param {string | null} [host]
 */
export function socketUrl(path, page = location.href, host = null) {
  const u = siteUrl(path, page);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  if (host) u.host = host;
  return u.href;
}

/**
 * Whether a host is a node the page may connect to (站点-6): one under the page's own name — the nodes of
 * play.example.org are <node>.play.example.org — and not the page's own host (that is no other node).
 * @param {unknown} host @param {string} [page]
 */
export function nodeHost(host, page = location.href) {
  const own = new URL(page).hostname;
  return typeof host === 'string' && /^[a-z0-9.-]+$/.test(host) && host.endsWith(`.${own}`) && !host.slice(0, -own.length - 1).includes('.');
}

/** The node a page's address names (站点-6): its `server` parameter when it is one (nodeHost), else null. @param {string} [page] */
export function pageNode(page = location.href) {
  const s = new URL(page).searchParams.get('server');
  return nodeHost(s, page) ? s : null;
}

/**
 * The asset directory's URL (a local directory the server serves, AUE_ASSETS_DIR): the page's <meta name="ig-assets">
 * names it with the directory's version (站点-3), else assets/skeleton/.
 * @param {{ querySelector: (s: string) => { getAttribute: (n: string) => string | null } | null } | undefined} [doc] @param {string} [page]
 */
export function assetsUrl(doc = globalThis.document, page = location.href) {
  return siteUrl(doc?.querySelector('meta[name="ig-assets"]')?.getAttribute('content') || 'assets/skeleton/', page);
}

/**
 * The code's version in a module URL (站点-4: /m/~<version>/…), e.g. "~0123456789ab"; '' when the module was loaded
 * without one. @param {string} [url] a module's URL
 */
export const codeVersion = (url = import.meta.url) => /\/m\/(~[0-9a-f]{1,32})\//.exec(url)?.[1] ?? '';

/**
 * A module of the site under the same version as this one (站点-4), from its path under m/ ("@aue/worker/src/worker.js").
 * @param {string} path @param {string} [url] a module's URL @param {string} [page]
 */
export function moduleUrl(path, url = import.meta.url, page = location.href) {
  const v = codeVersion(url);
  return siteUrl(`m/${v ? `${v}/` : ''}${path}`, page);
}

/** Where the host serves its mods (站点-7). @param {string} [page] */
export const modsUrl = (page = location.href) => siteUrl('mods/', page);

/** The pinned kits' base under the same version as the modules (站点-4). @param {string} [url] @param {string} [page] */
export const kitsUrl = (url = import.meta.url, page = location.href) => { const v = codeVersion(url); return siteUrl(`k/${v ? `${v}/` : ''}`, page); };
