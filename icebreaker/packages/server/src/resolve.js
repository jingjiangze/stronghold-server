// Bare specifier to a file inside a package, following the package's own package.json "exports" (the single mapping
// source) the way a browser-targeting bundler would: conditions "browser", "import", "default" in that order, never
// "require" or "node".
import { readPackageJson } from './workspace.js';

/** Conditions we accept, most specific first. */
const CONDITIONS = ['browser', 'import', 'default'];

/** @typedef {import('./workspace.js').PackageJson} PackageJson */

/** @param {string} spec @returns {{ name: string, rest: string } | null} package name and what follows it */
export function splitSpecifier(spec) {
  const parts = spec.split('/');
  const n = spec.startsWith('@') ? 2 : 1;
  if (parts.length < n || parts.slice(0, n).some((p) => p === '')) return null;
  return { name: parts.slice(0, n).join('/'), rest: parts.slice(n).join('/') };
}

/** @param {string} target @returns {boolean} true for "./x" targets that stay inside the package */
function isSafeTarget(target) {
  if (!target.startsWith('./')) return false;
  return !target.split('/').some((s) => s === '..' || s === 'node_modules');
}

/**
 * @param {unknown} target a string, array or condition object from "exports"
 * @param {string | null} match what a "*" stood for, or null
 * @returns {string | null} the path relative to the package, without "./"
 */
function pickTarget(target, match) {
  if (typeof target === 'string') {
    const t = match === null ? target : target.replaceAll('*', match);
    return isSafeTarget(t) ? t.slice(2) : null;
  }
  if (Array.isArray(target)) {
    for (const item of target) {
      const r = pickTarget(item, match);
      if (r !== null) return r;
    }
    return null;
  }
  if (typeof target !== 'object' || target === null) return null;
  for (const cond of CONDITIONS) {
    if (!Object.hasOwn(target, cond)) continue;
    const r = pickTarget(/** @type {Record<string, unknown>} */ (target)[cond], match);
    if (r !== null) return r;
  }
  return null;
}

/** @param {unknown} exports @returns {exports is Record<string, unknown>} true when the keys are subpaths ("." and "./x") */
function isSubpathMap(exports) {
  if (typeof exports !== 'object' || exports === null || Array.isArray(exports)) return false;
  const keys = Object.keys(exports);
  return keys.length > 0 && keys.every((k) => k.startsWith('.'));
}

/**
 * The longest "./x/*" pattern key matching the subpath.
 * @param {Record<string, unknown>} map
 * @param {string} key
 * @returns {{ target: unknown, match: string } | null}
 */
function matchPattern(map, key) {
  /** @type {{ target: unknown, match: string, len: number } | null} */
  let best = null;
  for (const [pattern, target] of Object.entries(map)) {
    const star = pattern.indexOf('*');
    if (star < 0) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    const fits = key.length > prefix.length + suffix.length && key.startsWith(prefix) && key.endsWith(suffix);
    if (fits && (best === null || prefix.length > best.len)) {
      best = { target, match: key.slice(prefix.length, key.length - suffix.length), len: prefix.length };
    }
  }
  return best;
}

/** @param {unknown} exports @param {string} key "." or "./sub/path" @returns {string | null} */
function resolveExports(exports, key) {
  const map = isSubpathMap(exports) ? exports : { '.': exports };
  if (Object.hasOwn(map, key) && !key.includes('*')) return pickTarget(map[key], null);
  const hit = matchPattern(map, key);
  return hit === null ? null : pickTarget(hit.target, hit.match);
}

/**
 * Without "exports": the subpath as written, or module, main, index.js for the package itself.
 * @param {PackageJson} json @param {string} rest @returns {string | null}
 */
function resolveLegacy(json, rest) {
  if (rest !== '') return rest.split('/').includes('..') ? null : rest;
  const entry = [json['module'], json['main']].find((v) => typeof v === 'string' && v !== '');
  const path = typeof entry === 'string' ? entry.replace(/^\.\//, '') : 'index.js';
  return /\.[a-z0-9]+$/i.test(path) ? path : `${path}.js`;
}

/**
 * @param {string} spec a bare specifier such as "@aue/sim" or "@aue/content/data/skeleton.json"
 * @param {ReadonlyMap<string, string>} workspace package name to directory
 * @param {(dir: string) => PackageJson | null} [readJson] reads a package.json (injectable for tests)
 * @returns {{ pkg: string, subpath: string } | null} null when the package or the subpath is unknown
 */
export function resolveSpecifier(spec, workspace, readJson = readPackageJson) {
  const s = splitSpecifier(spec);
  const dir = s === null ? undefined : workspace.get(s.name);
  if (s === null || dir === undefined) return null;
  const json = readJson(dir);
  if (json === null) return null;
  const rest = s.rest;
  const subpath = json['exports'] === undefined ? resolveLegacy(json, rest) : resolveExports(json['exports'], rest === '' ? '.' : `./${rest}`);
  return subpath === null ? null : { pkg: s.name, subpath };
}
