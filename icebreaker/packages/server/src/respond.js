// Response helpers shared by the module and static handlers: strong ETag, 304, HEAD, the fixed headers, and text
// compressed for clients that accept it (docs/spec/site.md 站点-4).
import { createHash } from 'node:crypto';
import { brotliCompress, constants as zlib, gzip } from 'node:zlib';

/** @param {Buffer | string} body @returns {string} a strong ETag */
export function etagOf(body) {
  return `"${createHash('sha256').update(body).digest('hex')}"`;
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {string} message */
export function sendText(res, status, message) {
  const body = Buffer.from(`${message}\n`);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** @param {import('node:http').ServerResponse} res @param {import('./paths.js').Rejection} r */
export function sendRejection(res, r) {
  sendText(res, r.status, r.message);
}

/**
 * GET and HEAD only; answers 405 otherwise.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean} true when the method is allowed
 */
export function allowReadOnly(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  res.setHeader('Allow', 'GET, HEAD');
  sendText(res, 405, 'method not allowed');
  return false;
}

/** @param {string | undefined} header @param {string} etag */
function matches(header, etag) {
  if (header === undefined) return false;
  return header.split(',').some((t) => {
    const tag = t.trim().replace(/^W\//, '');
    return tag === '*' || tag === etag;
  });
}

/**
 * 200 with the body (no body for HEAD), or 304 when If-None-Match has the ETag.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ body: Buffer, type: string, etag?: string, cache?: string }} o `cache`: the Cache-Control (default no-cache)
 */
export function sendBody(req, res, o) {
  const etag = o.etag ?? etagOf(o.body), coding = req.method === 'GET' && compressible(o.type, o.body.length) ? codingOf(req) : null;
  const tag = coding ? `${etag.slice(0, -1)}-${coding}"` : etag;
  /** @type {import('node:http').OutgoingHttpHeaders} */
  const headers = { ETag: tag, 'Cache-Control': o.cache ?? 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  if (compressible(o.type, o.body.length)) headers['Vary'] = 'Accept-Encoding';
  if (matches(req.headers['if-none-match'], tag) || matches(req.headers['if-none-match'], etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  headers['Content-Type'] = o.type;
  if (!coding) {
    headers['Content-Length'] = o.body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : o.body);
    return;
  }
  packedBody(o.body, etag, coding).then((body) => {
    if (res.destroyed) return;
    res.writeHead(200, { ...headers, 'Content-Encoding': coding, 'Content-Length': body.length });
    res.end(body);
  }, () => { if (!res.headersSent) { res.writeHead(200, { ...headers, 'Content-Length': o.body.length }); res.end(o.body); } });
}

/** Whether a response is worth compressing (站点-4): text, JSON, JavaScript, SVG of 1 KiB or more. @param {string} type @param {number} size */
const compressible = (type, size) => size >= 1024 && /^(text\/|application\/(json|javascript)|image\/svg\+xml)/.test(type);

/**
 * The coding a request accepts, brotli before gzip; none.
 *
 * `AUE_NO_BROTLI=1` drops brotli: some reverse proxies in front of a deployment strip
 * `Content-Encoding: br` while passing the brotli body through, and a browser then renders the
 * compressed bytes as text (measured 2026-10-26 on the ModelScope container: direct to the server
 * the header is there, through ms.show it is gone and the 6741-byte body stays brotli).
 * @param {import('node:http').IncomingMessage} req @returns {'br' | 'gzip' | null}
 */
function codingOf(req) {
  const a = String(req.headers['accept-encoding'] ?? '');
  const br = process.env['AUE_NO_BROTLI'] !== '1' && /(^|[\s,])br([\s;,]|$)/.test(a);
  return br ? 'br' : /(^|[\s,])gzip([\s;,]|$)/.test(a) ? 'gzip' : null;
}

/** Compressed bodies by coding and ETag, the oldest dropped past PACKED_MAX bytes. @type {Map<string, Promise<Buffer>>} */
const packed = new Map(), sizes = new Map();
const PACKED_MAX = 256 * 1024 * 1024;
let packedBytes = 0;

/**
 * A body compressed (brotli at quality 5, or gzip), off the event loop, kept for the next request of the same ETag.
 * @param {Buffer} body @param {string} etag @param {'br' | 'gzip'} coding @returns {Promise<Buffer>}
 */
function packedBody(body, etag, coding) {
  const key = `${coding}${etag}`, hit = packed.get(key);
  if (hit) return hit;
  const p = new Promise((done, fail) => {
    const cb = (/** @type {Error | null} */ err, /** @type {Buffer} */ out) => (err ? fail(err) : done(out));
    if (coding === 'br') brotliCompress(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 5, [zlib.BROTLI_PARAM_SIZE_HINT]: body.length } }, cb);
    else gzip(body, { level: 6 }, cb);
  });
  packed.set(key, /** @type {Promise<Buffer>} */ (p));
  p.then((out) => {
    sizes.set(key, /** @type {Buffer} */ (out).length); packedBytes += /** @type {Buffer} */ (out).length;
    for (const [k] of packed) { if (packedBytes <= PACKED_MAX) break; packedBytes -= sizes.get(k) ?? 0; sizes.delete(k); packed.delete(k); }
  }, () => packed.delete(key));
  return /** @type {Promise<Buffer>} */ (p);
}
