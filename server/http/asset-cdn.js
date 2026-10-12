// server/http/asset-cdn.js — where the fonts live for an install that has them on a CDN instead of on disk.
//
// The image ships no art: `data/assets.json` is the pinned manifest of a public mirror, and its URLs are absolute
// (tools/fetch-assets.mjs writes root-relative ones for a self-contained install, which is the other case). The
// fonts are the one tree that both lives on that mirror and is *addressed by path* from a fixed place — the
// stylesheet <link> in public/index.html and the url() rules inside fonts.css itself — so an install without
// public/fonts/ answers 404 for /fonts/fonts.css and the game silently falls back to the system fonts.
//
// This module answers one question for static.js: the request path is under /fonts/ and the file is not on disk —
// what absolute URL serves it? It reads the pinned manifest, and derives the base from the manifest's own fonts.css
// URL rather than from a hardcoded host, so a mirror move or a future path prefix (the CDN serves the app under
// /app/<tag>/…) carries over: the faces are resolved next to the stylesheet that references them.
//
// Only the manifest's `fonts` sub-object is read into the map; the file is 5+ MB and is parsed once per change
// (size + mtime), not once per request.
//
//   const cdn = createAssetCdn({ manifestPath });
//   cdn.fontUrl('/fonts/bender-regular.woff2', '')  // → 'https://…/fonts/bender-regular.woff2?v=…' | null
import fsp from 'node:fs/promises';
import { noopLog } from './config.js';

/** The manifest key holding the font stylesheet + faces (tools/fetch-assets.mjs). */
const FONTS_KEY = 'fonts';
/** The mount point this module serves; everything else on the mirror is addressed absolutely by the manifest. */
export const FONTS_PREFIX = '/fonts/';

const isAbsoluteHttp = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);

/**
 * The absolute URLs a manifest maps for /fonts/… — path → URL, plus the base the faces resolve against.
 * @param {any} manifest parsed data/assets.json (anything else is tolerated)
 * @returns {{ byPath: Map<string, string>, base: URL | null }}
 */
export function fontUrlsFrom(manifest) {
  const byPath = new Map();
  let base = null;
  const fonts = manifest && typeof manifest === 'object' ? manifest[FONTS_KEY] : null;
  if (!fonts || typeof fonts !== 'object') return { byPath, base };

  const remember = (pathname, url) => {
    if (!isAbsoluteHttp(url)) return;
    byPath.set(pathname, url);
    if (pathname.endsWith('/fonts.css')) {
      try { base = new URL('.', url); } catch { /* keep the previous base */ }
    }
  };
  if (isAbsoluteHttp(fonts.css)) remember(`${FONTS_PREFIX}fonts.css`, fonts.css);
  const faces = fonts.faces && typeof fonts.faces === 'object' ? fonts.faces : {};
  for (const face of Object.values(faces)) {
    if (!face || typeof face !== 'object') continue;
    for (const url of Object.values(face)) {
      if (!isAbsoluteHttp(url)) continue;
      const name = url.split('?')[0].split('/').pop();
      if (name) remember(`${FONTS_PREFIX}${name}`, url);
    }
  }
  if (!base && byPath.size) {
    // A manifest with faces but no fonts.css still names the mirror: take any face's directory as the base.
    try { base = new URL('.', byPath.values().next().value); } catch { base = null; }
  }
  return { byPath, base };
}

/**
 * @param {{ manifestPath: string, log?: { debug?: Function, error?: Function } }} options
 * @returns {{ fontUrl: (decodedPath: string, query?: string) => Promise<string | null> }}
 */
export function createAssetCdn({ manifestPath, log = noopLog }) {
  /** @type {{ size: number, mtimeMs: number, urls: ReturnType<typeof fontUrlsFrom> } | null} */
  let memo = null;

  async function load() {
    const stat = await fsp.stat(manifestPath).catch(() => null);
    if (!stat) { memo = null; return null; }
    if (memo && memo.size === stat.size && memo.mtimeMs === stat.mtimeMs) return memo.urls;
    let parsed;
    try { parsed = JSON.parse(await fsp.readFile(manifestPath, 'utf8')); } catch (e) {
      log.error?.('[asset-cdn] manifest unreadable', e.message);
      memo = null;
      return null;
    }
    const urls = fontUrlsFrom(parsed);
    memo = { size: stat.size, mtimeMs: stat.mtimeMs, urls };
    return urls;
  }

  return {
    /**
     * The absolute CDN URL for a missing /fonts/… request, or null when this install has no CDN to point at
     * (no manifest, or a self-contained one whose font URLs are root-relative).
     * @param {string} decodedPath decoded request path (e.g. '/fonts/fonts.css')
     * @param {string} [query] the request's query string, kept only when the manifest has no URL of its own
     */
    async fontUrl(decodedPath, query = '') {
      if (!decodedPath.startsWith(FONTS_PREFIX) || decodedPath.endsWith('/')) return null;
      const urls = await load();
      if (!urls) return null;
      const exact = urls.byPath.get(decodedPath);
      if (exact) return exact;
      if (!urls.base) return null;
      let url;
      try { url = new URL(decodedPath.slice(FONTS_PREFIX.length), urls.base).href; } catch { return null; }
      return query ? `${url}?${query}` : url;
    },
  };
}
