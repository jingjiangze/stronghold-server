// Static files: the page's own files (index.html, css, images) and the asset directory.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRejection, locateFile, rawPathname, splitPath } from './paths.js';
import { allowReadOnly, etagOf, sendBody, sendRejection, sendText } from './respond.js';

/** Each served file's ETag while its modification time and size hold: a large asset is hashed once, not per request. @type {Map<string, { key: string, etag: string }>} */
const ETAGS = new Map();

/** @param {string} file @param {number} mtimeMs @param {Buffer} body */
function etagOfFile(file, mtimeMs, body) {
  const key = `${mtimeMs}:${body.length}`, hit = ETAGS.get(file);
  if (hit?.key === key) return hit.etag;
  const etag = etagOf(body);
  ETAGS.set(file, { key, etag });
  return etag;
}

/** @type {ReadonlyMap<string, string>} */
export const STATIC_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  // Asset packs also carry these (spine data, audio, fonts).
  ['.atlas', 'text/plain; charset=utf-8'],
  ['.skel', 'application/octet-stream'],
  ['.ogg', 'audio/ogg'],
  ['.mp3', 'audio/mpeg'],
  ['.woff2', 'font/woff2'],
]);

/**
 * Serves one file the caller already trusts (a fixed path, not taken from the request), through `edit` when given.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} file
 * @param {string} type
 * @param {(text: string) => string | Promise<string>} [edit]
 */
export async function serveFixedFile(req, res, file, type, edit) {
  if (!allowReadOnly(req, res)) return;
  /** @type {Buffer} */
  let raw;
  try {
    raw = await readFile(file);
  } catch {
    sendText(res, 404, 'not found');
    return;
  }
  sendBody(req, res, { body: edit ? Buffer.from(await edit(raw.toString('utf8'))) : raw, type });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} dir
 * @param {string} rest
 * @param {string} [cache] the Cache-Control (default no-cache)
 */
async function serveFrom(req, res, dir, rest, cache) {
  if (!allowReadOnly(req, res)) return;
  const segments = splitPath(rest);
  if (isRejection(segments)) return sendRejection(res, segments);
  const found = await locateFile(dir, segments, STATIC_TYPES);
  if (isRejection(found)) return sendRejection(res, found);
  const body = await readFile(found.file);
  sendBody(req, res, { body, type: found.type, etag: etagOfFile(found.file, found.mtimeMs, body), ...(cache ? { cache } : {}) });
}

/**
 * Handler for the URLs under `prefix` (for example "/static/"), serving files from dir.
 * @param {string} dir
 * @param {string} prefix
 * @param {string} [cache] the Cache-Control of what it serves (default no-cache)
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean}
 */
export function createStaticHandler(dir, prefix, cache) {
  return (req, res) => {
    const path = rawPathname(req.url);
    if (!path.startsWith(prefix)) return false;
    serveFrom(req, res, dir, path.slice(prefix.length), cache).catch(() => {
      if (!res.headersSent) sendText(res, 500, 'internal error');
      else res.destroy();
    });
    return true;
  };
}

/** Where the page's files live in a checkout. @param {string} rootDir */
export function publicDir(rootDir) {
  return join(rootDir, 'packages', 'client', 'public');
}
