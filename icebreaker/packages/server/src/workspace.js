// Which packages the browser may import: the workspace packages (from pnpm-workspace.yaml) and the third-party packages
// the browser packages depend on (resolved the way Node would, through pnpm's symlinks).
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** @typedef {Record<string, unknown>} PackageJson */

/** Reads and parses a package.json in dir; null when missing or broken. @param {string} dir @returns {PackageJson | null} */
export function readPackageJson(dir) {
  try {
    const v = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The `packages:` globs of pnpm-workspace.yaml. Only the tiny subset this repository uses: a block list of plain
 * (optionally quoted) entries under `packages:`.
 * @param {string} yaml
 * @returns {string[]}
 */
export function parseWorkspaceGlobs(yaml) {
  /** @type {string[]} */
  const globs = [];
  let inPackages = false;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^\S/.test(line)) {
      inPackages = /^packages:\s*$/.test(line);
      continue;
    }
    const m = /^\s+-\s+(['"]?)(.+?)\1$/.exec(line);
    if (inPackages && m?.[2] !== undefined) globs.push(m[2]);
  }
  return globs;
}

/**
 * The package directories a glob names: `dir/*` (each child that has a package.json) or a plain `dir`.
 * @param {string} rootDir
 * @param {string} glob
 * @returns {string[]}
 */
function expandGlob(rootDir, glob) {
  const g = glob.replace(/^\.\//, '').replace(/\/$/, '');
  if (!g.endsWith('/*')) return [resolve(rootDir, g)];
  const base = resolve(rootDir, g.slice(0, -2));
  try {
    return readdirNames(base).map((n) => join(base, n));
  } catch {
    return [];
  }
}

/** @param {string} dir @returns {string[]} the child directory names (symlinks to directories included), sorted */
function readdirNames(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => e.name)
    .sort();
}

/** @param {PackageJson} json @returns {string[]} the dependencies a browser would need at run time */
export function runtimeDependencies(json) {
  /** @type {string[]} */
  const names = [];
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = json[field];
    if (typeof deps === 'object' && deps !== null) names.push(...Object.keys(deps));
  }
  return names;
}

/** Finds node_modules/<name> from dir upward. @param {string} name @param {string} fromDir @returns {string | null} */
function findInstalled(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Walks the dependency graph from the roots over the packages known in `known`.
 * @param {Iterable<string>} roots
 * @param {Map<string, string>} known package name to directory; `discover` may add to it
 * @param {(name: string, fromDir: string) => string | null} discover where a package missing from `known` lives
 * @returns {Set<string>} the reachable package names that are in `known`
 */
function walk(roots, known, discover) {
  /** @type {Set<string>} */
  const seen = new Set();
  const queue = [...roots];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    if (seen.has(name)) continue;
    const dir = known.get(name);
    if (dir === undefined) continue;
    seen.add(name);
    for (const dep of runtimeDependencies(readPackageJson(dir) ?? {})) {
      if (!known.has(dep)) {
        const found = discover(dep, dir);
        if (found !== null) known.set(dep, found);
      }
      queue.push(dep);
    }
  }
  return seen;
}

/**
 * The packages the browser can reach from the given browser packages (themselves included), over the workspace map.
 * @param {Map<string, string>} workspace
 * @param {Iterable<string>} browserPackages
 * @returns {Set<string>}
 */
export function reachablePackages(workspace, browserPackages) {
  return walk(browserPackages, new Map(workspace), () => null);
}

/**
 * @param {string} rootDir the repository root (holds pnpm-workspace.yaml)
 * @param {Iterable<string>} [browserPackages] workspace packages whose third-party dependencies are added
 * @returns {Map<string, string>} package name to absolute (real) directory
 */
export function readWorkspace(rootDir, browserPackages = []) {
  const yaml = readFileSync(join(rootDir, 'pnpm-workspace.yaml'), 'utf8');
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const glob of parseWorkspaceGlobs(yaml)) {
    for (const dir of expandGlob(rootDir, glob)) {
      const name = readPackageJson(dir)?.name;
      if (typeof name === 'string') map.set(name, realpathSync(dir));
    }
  }
  walk(browserPackages, map, findInstalled);
  return map;
}
