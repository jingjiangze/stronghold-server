// The version of the code the pages run (docs/spec/site.md 站点-4): a hash over every file of the packages the server
// serves under /m/ — their path, size and modification time — so it changes whenever any of them changes. Taken again
// at most every two seconds; a release's files never change, so its version stays.
import { readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** How long a version taken is reused, in milliseconds. */
const REUSE_MS = 2000;

/**
 * 12 hex digits over the files under some directories (sorted by directory, then path; node_modules and dot entries
 * left out) and some single files (installed packages: their package.json).
 * @param {Iterable<string>} dirs @param {Iterable<string>} [files]
 */
export function filesVersion(dirs, files = []) {
  const h = createHash('sha256');
  for (const f of [...files].sort()) { const st = statSync(f); h.update(`${f}\0${st.size}\0${Math.floor(st.mtimeMs)}\n`); }
  /** @param {string} root @param {string} rel */
  const walk = (root, rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(root, path);
      else if (e.isFile()) { const st = statSync(join(root, path)); h.update(`${path}\0${st.size}\0${Math.floor(st.mtimeMs)}\n`); }
    }
  };
  for (const dir of [...dirs].sort()) { h.update(`${dir}\n`); walk(dir, ''); }
  return h.digest('hex').slice(0, 12);
}

/**
 * The version of some directories and files, taken again when the last one is older than two seconds.
 * @param {Iterable<string>} dirs @param {Iterable<string>} [files] @param {() => number} [now]
 * @returns {() => string}
 */
export function versionOf(dirs, files = [], now = Date.now) {
  const d = [...dirs], f = [...files];
  let at = -Infinity, v = '';
  return () => {
    if (now() - at >= REUSE_MS) { v = filesVersion(d, f); at = now(); }
    return v;
  };
}
