// The files of a staged bundle, its MANIFEST.json (every file's size and sha256, docs/deploy.md) and the zip.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TAR, run } from './select.js';

/** The manifest's name at a bundle's root. */
export const MANIFEST = 'MANIFEST.json';

/**
 * Every file under a folder as sorted posix paths; links are refused (a zip would lose them or carry them broken).
 * @param {string} root @returns {string[]}
 */
export function listFiles(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir @param {string} rel */
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name, abs = join(dir, e.name);
      if (lstatSync(abs).isSymbolicLink()) throw new Error(`${child}: a link (a bundle holds plain files only)`);
      if (e.isDirectory()) walk(abs, child);
      else if (e.isFile()) out.push(child);
    }
  };
  walk(root, '');
  return out.sort();
}

/**
 * Writes MANIFEST.json: what the bundle is (meta) and each file's size and sha256, the manifest itself left out.
 * @param {string} root @param {readonly string[]} files @param {Record<string, unknown>} meta @returns {number} the bytes listed
 */
export function writeManifest(root, files, meta) {
  /** @type {Record<string, { size: number, sha256: string }>} */
  const listed = {};
  let bytes = 0;
  for (const f of files.filter((x) => x !== MANIFEST)) {
    const data = readFileSync(join(root, f));
    listed[f] = { size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    bytes += data.length;
  }
  writeFileSync(join(root, MANIFEST), `${JSON.stringify({ ...meta, files: listed }, null, 1)}\n`);
  return bytes;
}

/** Whether a command runs (the flag exits 0). @param {string} cmd @param {string} flag */
const has = (cmd, flag) => spawnSync(cmd, [flag]).status === 0;

/**
 * Zips one folder of `parent` into `zip`, the folder at the zip's root: bsdtar (Windows 10+, macOS), else zip.
 * @param {string} parent @param {string} folder @param {string} zip
 */
export function zipFolder(parent, folder, zip) {
  const bsdtar = has(TAR, '--version') && /bsdtar/.test(run(TAR, ['--version']).toString());
  if (bsdtar) run(TAR, ['-a', '-c', '-f', zip, '-C', parent, folder]);
  else if (has('zip', '-h')) run('zip', ['-r', '-q', '-X', zip, folder], { cwd: parent });
  else throw new Error('zipping needs bsdtar (tar -a) or zip');
}
