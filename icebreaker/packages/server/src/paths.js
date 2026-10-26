// Safe mapping of a raw URL path onto files inside a directory. Everything that reaches the disk goes through here:
// the path is split BEFORE any normalisation (a client can send "/../" literally), each segment is decoded and judged on
// its own, and the final real path (symlinks followed) must stay inside the real base directory.
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative } from 'node:path';

/** @typedef {{ status: number, message: string }} Rejection */

/** The raw request path without the query string (never normalised, never decoded). @param {string | undefined} url */
export function rawPathname(url) {
  const u = url ?? '/';
  const cut = u.search(/[?#]/);
  return cut < 0 ? u : u.slice(0, cut);
}

/** @param {string} segment @returns {string | Rejection} the decoded segment or why it is refused */
function decodeSegment(segment) {
  let s;
  try {
    s = decodeURIComponent(segment);
  } catch {
    return { status: 400, message: 'bad percent-encoding' };
  }
  // ':' also shuts out drive letters and NTFS alternate streams.
  if (/[/\\\0:]/.test(s) || s === '.' || s === '..') return { status: 400, message: 'forbidden path segment' };
  return s;
}

/**
 * Splits the part of the path after a prefix into decoded segments.
 * An empty last segment ("dir/") names a directory: 404. An empty inner segment is malformed: 400.
 * @param {string} rest
 * @returns {string[] | Rejection}
 */
export function splitPath(rest) {
  const parts = rest.split('/');
  /** @type {string[]} */
  const out = [];
  for (const [i, part] of parts.entries()) {
    if (part === '') return i === parts.length - 1 ? { status: 404, message: 'not a file' } : { status: 400, message: 'empty segment' };
    const s = decodeSegment(part);
    if (typeof s !== 'string') return s;
    out.push(s);
  }
  return out;
}

/** @param {unknown} v @returns {v is Rejection} */
export function isRejection(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'status' in v;
}

/**
 * Finds the file for decoded segments inside baseDir.
 * @param {string} baseDir
 * @param {string[]} segments
 * @param {ReadonlyMap<string, string>} types extension (lower case, with the dot) to Content-Type; others are 404
 * @returns {Promise<{ file: string, mtimeMs: number, type: string } | Rejection>}
 */
export async function locateFile(baseDir, segments, types) {
  const type = types.get(extname(segments.at(-1) ?? '').toLowerCase());
  if (type === undefined) return { status: 404, message: 'not found' };
  try {
    const base = await realpath(baseDir);
    const file = await realpath(join(base, ...segments));
    const rel = relative(base, file);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { status: 400, message: 'outside the directory' };
    const st = await stat(file);
    return st.isFile() ? { file, mtimeMs: st.mtimeMs, type } : { status: 404, message: 'not found' };
  } catch {
    return { status: 404, message: 'not found' };
  }
}
