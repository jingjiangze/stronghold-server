// The checks a release bundle passes before it is zipped (docs/deploy.md): no path of the refusal list, no links, no
// two paths that differ only in case, and nothing personal — no home-folder or local drive path, no account name of
// this machine, no e-mail address but GitHub's noreply ones.
import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';

/** Folder or file names a bundle never holds: repositories, caches, work and hand-over material, local settings. */
const REFUSED_NAMES = new Set(['.git', '.cache', '.claude', '.github', 'work', 'exported', 'handover', 'scratch', 'scratchpad', 'coverage', 'logs', '.DS_Store', 'Thumbs.db', 'desktop.ini']);
/** Name patterns refused anywhere: hand-over notes, download caches, local settings, scripts that do not run here, a stray encoder page. */
const REFUSED_PATTERNS = [/^HANDOVER/i, /-downloads$/, /^\.env/, /\.py$/i, /^_enc\.html$/];
/** Refused outside node_modules: tests and their fixtures (third-party packages keep theirs). */
const REFUSED_OUTSIDE_DEPS = new Set(['test', 'tests', 'e2e']);

/** Whether a bundle path (posix, relative) is refused. @param {string} rel */
export function refused(rel) {
  const parts = rel.split('/'), deps = parts.includes('node_modules');
  return parts.some((p) => REFUSED_NAMES.has(p) || REFUSED_PATTERNS.some((r) => r.test(p)) || (!deps && REFUSED_OUTSIDE_DEPS.has(p)));
}

/** Paths that differ only in case: one file on Windows and macOS. @param {readonly string[]} files @returns {string[][]} */
export function caseClashes(files) {
  /** @type {Map<string, string[]>} */
  const by = new Map();
  for (const f of files) by.set(f.toLowerCase(), [...(by.get(f.toLowerCase()) ?? []), f]);
  return [...by.values()].filter((v) => v.length > 1);
}

/** Text files, read as text for the scan; the rest are searched as bytes for the account names only. */
const TEXT = /\.(?:js|mjs|cjs|json|md|txt|html|css|yaml|yml|bat|cmd|sh|ps1|atlas|svg|xml|map|ts)$/i;
/** Home folders: macOS, Linux, Windows (/ or \, JSON-escaped too). */
const HOME = [/\/Users\/[A-Za-z]/, /\/home\/[A-Za-z]/, /[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}[A-Za-z]/i];
/** A local drive path (D:/…, C:\…), outside node_modules. */
const DRIVE = /(?<![A-Za-z0-9_$%])[A-Za-z]:(?:\/|\\\\?)[A-Za-z]/;
/**
 * An e-mail address: its domain ends in a top-level domain mail is kept at (the game data's blackboard keys such as
 * attack@chain.atk look alike otherwise).
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|net|org|edu|gov|io|me|dev|app|cn|jp|kr|tw|hk|sg|uk|de|fr|ru|us|ca|au|co|info|xyz|top|moe|cc)\b/gi;
/** OS account names too generic to refuse. */
const GENERIC = new Set(['root', 'user', 'admin', 'node', 'runner', 'ubuntu', 'ci', 'guest', 'app', 'build']);

/** The names to refuse: this machine's account name (unless generic) and ICE_PACKAGE_SCAN_NAMES. @returns {string[]} */
export function scanNames() {
  const extra = (process.env['ICE_PACKAGE_SCAN_NAMES'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let own = '';
  try { own = userInfo().username; } catch { /* no account name to refuse */ }
  return [...new Set([...(own && !GENERIC.has(own.toLowerCase()) ? [own] : []), ...extra])];
}

/** @param {string} s @returns {string} the string as a literal part of a regular expression */
const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A text with the public places a name may stand removed: a GitHub owner (github.com/<name>, <name>/<repo>) and the
 * noreply address. @param {string} text @param {string} name
 */
function withoutPublic(text, name) {
  const n = literal(name);
  return text.replace(new RegExp(`github\\.com/${n}|\\b${n}/[A-Za-z]|\\+${n}@users\\.noreply\\.github\\.com`, 'gi'), '');
}

/**
 * What is personal in one file: home-folder and local drive paths, e-mail addresses (not in node_modules: third-party
 * packages name their authors), the account names (in node_modules too, and in binaries).
 * @param {string} rel @param {Buffer} bytes @param {readonly string[]} names @returns {string[]}
 */
export function personal(rel, bytes, names) {
  const deps = rel.split('/').includes('node_modules'), out = [];
  if (!TEXT.test(rel)) return names.filter((n) => bytes.includes(Buffer.from(n))).map((n) => `${rel}: the name ${n}`);
  const text = bytes.toString('utf8');
  for (const n of names) if (withoutPublic(text, n).toLowerCase().includes(n.toLowerCase())) out.push(`${rel}: the name ${n}`);
  if (deps) return out;
  for (const r of [...HOME, DRIVE]) { const m = r.exec(text); if (m) out.push(`${rel}: a local path near «${text.slice(Math.max(0, m.index - 20), m.index + 30)}»`); }
  for (const m of text.matchAll(EMAIL)) if (!/noreply/i.test(m[0])) out.push(`${rel}: the address ${m[0]}`);
  return out;
}

/**
 * Every problem of a staged bundle: refused paths, case clashes, personal content.
 * @param {string} root @param {readonly string[]} files posix paths under root @param {readonly string[]} names
 * @returns {string[]}
 */
export function problems(root, files, names) {
  const out = files.filter(refused).map((f) => `${f}: refused`);
  for (const c of caseClashes(files)) out.push(`differ only in case: ${c.join(', ')}`);
  for (const f of files) out.push(...personal(f, readFileSync(join(root, f)), names));
  return out;
}
