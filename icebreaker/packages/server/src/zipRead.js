// Reads a .zip a host uploads through /mod (modManager.js). The engine's SDK ships a zip WRITER only
// (engine/packages/sdk/src/zip.js); an upload needs the other direction, so this is the smallest reader the mod
// manager accepts: the end-of-central-directory record, then every entry's central-directory record, then its
// local header and data. Stored (method 0) and deflated (method 8) entries only — the two every archiver writes for
// these small JSON packs; anything else (zip64, encryption, bzip2/lzma) is refused with a reason the page shows.
//
// Paths are checked here, never trusted: a zip is an untrusted archive, so `..`, absolute paths, drive letters,
// backslashes and NUL bytes are refused before anything touches the disk (modManager.js writes what lands here).
import { inflateRawSync } from 'node:zlib';

/** The most entries one upload may hold. */
export const MAX_ENTRIES = 512;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const U32_MAX = 0xffffffff;

/** @param {Buffer} buf @param {number} at @returns {number} */
const u16 = (buf, at) => buf.readUInt16LE(at);
/** @param {Buffer} buf @param {number} at @returns {number} */
const u32 = (buf, at) => buf.readUInt32LE(at);

/**
 * A safe relative path for one entry, or null: no leading `/` or `\`, no drive letter, no `..` segment, no
 * backslash, no NUL, and something after trimming. The manager refuses the WHOLE archive when one entry is bad.
 * @param {string} name @returns {string | null}
 */
export function safeEntryPath(name) {
  const raw = String(name);
  if (raw.length === 0 || raw.length > 512) return null;
  if (raw.includes('\u0000') || raw.includes('\\')) return null;
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null;
  const parts = raw.split('/');
  if (parts.some((p) => p === '..')) return null;
  const out = parts.filter((p) => p !== '' && p !== '.').join('/');
  return out === '' ? null : out;
}

/**
 * The end-of-directory record: it sits at the end, followed by at most a 64 KiB comment.
 * @param {Buffer} buf @returns {{ count: number, size: number, at: number } | null}
 */
function findEnd(buf) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (u32(buf, i) === EOCD && i + 22 + u16(buf, i + 20) <= buf.length) {
      return { count: u16(buf, i + 10), size: u32(buf, i + 12), at: u32(buf, i + 16) };
    }
  }
  return null;
}

/**
 * One central-directory record at `p`.
 * @param {Buffer} buf @param {number} p
 * @returns {{ name: string, method: number, comp: number, size: number, local: number, next: number } | null}
 */
function centralAt(buf, p) {
  if (p + 46 > buf.length || u32(buf, p) !== CENTRAL) return null;
  const nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), commentLen = u16(buf, p + 32);
  const rec = {
    name: buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
    method: u16(buf, p + 10), comp: u32(buf, p + 20), size: u32(buf, p + 24), local: u32(buf, p + 42),
    next: p + 46 + nameLen + extraLen + commentLen,
  };
  return rec.comp === U32_MAX || rec.size === U32_MAX || rec.local === U32_MAX ? null : rec;
}

/**
 * The bytes of one entry, decompressed.
 * @param {Buffer} buf @param {{ name: string, method: number, comp: number, size: number, local: number }} rec
 * @returns {{ data: Buffer, error: null } | { data: null, error: string }}
 */
function entryData(buf, rec) {
  if (rec.local + 30 > buf.length || u32(buf, rec.local) !== LOCAL) return { data: null, error: `the entry ${rec.name} has no local header` };
  const at = rec.local + 30 + u16(buf, rec.local + 26) + u16(buf, rec.local + 28);
  if (at + rec.comp > buf.length) return { data: null, error: `the entry ${rec.name} runs past the end of the file` };
  const raw = buf.subarray(at, at + rec.comp);
  let data;
  if (rec.method === 0) data = Buffer.from(raw);
  else if (rec.method === 8) {
    try { data = inflateRawSync(raw); } catch { return { data: null, error: `the entry ${rec.name} does not inflate` }; }
  } else return { data: null, error: `the entry ${rec.name} uses compression method ${rec.method} (only stored / deflate)` };
  if (data.length !== rec.size) return { data: null, error: `the entry ${rec.name} is ${data.length} bytes, not the ${rec.size} it declares` };
  return { data, error: null };
}

/**
 * Reads a zip into its entries. Directories are dropped (their paths end with `/`); the files come back in the
 * archive's order with their bytes decompressed.
 * @param {Buffer} buf
 * @returns {{ entries: { path: string, data: Buffer }[], error: null } | { entries: [], error: string }}
 */
export function readZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return { entries: [], error: 'not a zip file' };
  const end = findEnd(buf);
  if (!end) return { entries: [], error: 'the zip has no end-of-directory record' };
  if (end.count > MAX_ENTRIES) return { entries: [], error: `the zip holds more than ${MAX_ENTRIES} entries` };
  if (end.at + end.size > buf.length) return { entries: [], error: 'the zip central directory is out of bounds' };
  /** @type {{ path: string, data: Buffer }[]} */
  const entries = [];
  let p = end.at;
  for (let i = 0; i < end.count; i++) {
    const rec = centralAt(buf, p);
    if (!rec) return { entries: [], error: 'a central directory record is malformed (or the zip is zip64)' };
    p = rec.next;
    if (rec.name.endsWith('/')) continue; // a directory entry: nothing to write
    const safe = safeEntryPath(rec.name);
    if (safe === null) return { entries: [], error: `the zip holds an unsafe path: ${JSON.stringify(rec.name).slice(0, 80)}` };
    const got = entryData(buf, rec);
    if (got.data === null) return { entries: [], error: got.error };
    entries.push({ path: safe, data: got.data });
  }
  return { entries, error: null };
}
