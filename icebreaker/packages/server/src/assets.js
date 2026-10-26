// The asset directory with a version (docs/spec/site.md 站点-3): the version is taken once from every file's path,
// size and modification time; assets/~<version>/… is the same file as assets/… but may be cached for a year, so a
// browser or a proxy keeps the large assets until the directory changes. A page names the versioned base in its
// <meta name="ig-assets">.
import { readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createStaticHandler } from './static.js';
import { rawPathname } from './paths.js';
import { EFFECT_PACK, createEffectSubsets, effectKeys } from './effects.js';
import { sendBody, sendText } from './respond.js';

/** How long a versioned asset may be kept: a year, never revalidated. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * The version of a directory: 12 hex digits of a hash over every file's path, size and modification time (sorted).
 * @param {string} dir
 */
export function assetVersion(dir) {
  const h = createHash('sha256');
  /** @param {string} rel */
  const walk = (rel) => {
    const entries = readdirSync(join(dir, rel), { withFileTypes: true }).map((e) => e.name).sort();
    for (const name of entries) {
      const path = rel ? `${rel}/${name}` : name, st = statSync(join(dir, path));
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) h.update(`${path}\0${st.size}\0${Math.floor(st.mtimeMs)}\n`);
    }
  };
  walk('');
  return h.digest('hex').slice(0, 12);
}

/**
 * The handler of /assets/ (no-cache, as every static file) and /assets/~<version>/ (a year when the version is the
 * directory's, else no-cache: an old page's request gets today's file without it being kept); the effect pack with
 * `?for=` the cut-down pack of those units (站点-5).
 * @param {string} dir @param {string} version
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean}
 */
export function createAssetHandler(dir, version) {
  const plain = createStaticHandler(dir, '/assets/'), kept = createStaticHandler(dir, '/assets/', IMMUTABLE), fx = createEffectSubsets(dir);
  return (req, res) => {
    const path = rawPathname(req.url), query = req.url?.slice(path.length) ?? '';
    const m = /^\/assets\/~([0-9a-f]{1,32})\//.exec(path), inner = m ? `/assets/${path.slice(m[0].length)}` : path, cache = m?.[1] === version ? IMMUTABLE : undefined;
    const keys = inner === `/assets/${EFFECT_PACK}` ? effectKeys(req.url) : null;
    if (keys !== null) {
      if (typeof keys === 'string') sendText(res, 400, keys);
      else fx.answer(keys).then((a) => (a ? sendBody(req, res, { body: a.body, etag: a.etag, type: 'application/json; charset=utf-8', ...(cache ? { cache } : {}) }) : sendText(res, 404, 'not found')),
        () => sendText(res, 500, 'internal error'));
      return true;
    }
    if (!m) return plain(req, res);
    req.url = inner + query;
    return (cache ? kept : plain)(req, res);
  };
}

/** The pages' asset base: assets/~<version>/skeleton/, or assets/skeleton/ without assets. @param {string | null} version */
export const assetBase = (version) => (version ? `assets/~${version}/skeleton/` : 'assets/skeleton/');
