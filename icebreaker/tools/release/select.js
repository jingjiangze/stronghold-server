// What a release bundle ships from the repositories (docs/deploy.md): the runtime packages of the platform and of the
// engine as committed, and the third-party packages they need at run time, copied in as plain folders (a zip holds no
// links, so pnpm's linked node_modules cannot go in as it is).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { readPackageJson, readWorkspace, runtimeDependencies } from '../../packages/server/src/workspace.js';

/** The platform's root files a bundle ships, those the commit has. */
export const ROOT_FILES = ['package.json', 'pnpm-workspace.yaml', 'LICENSE', 'NOTICE.md', 'README.md', 'CHANGELOG.md', 'docs/deploy.md', 'scripts', 'mods/README.md'];
/** The engine's root files. */
export const ENGINE_FILES = ['LICENSE', 'NOTICE.md', 'README.md'];
/** What the server and the page run: their workspace dependencies follow. */
export const ROOTS = ['@icebreaker/server', '@icebreaker/client'];
/** Workspace package scopes: linked at the bundle's first start, never copied into node_modules. */
const WORKSPACE_SCOPES = ['@aue/', '@icebreaker/'];

/**
 * Runs git in a directory; its output as a Buffer, or an error with its message.
 * @param {string} dir @param {string[]} args @returns {Buffer}
 */
export function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr?.toString().trim() || r.error?.message}`);
  return r.stdout;
}

/** The tar that reads and writes zips too: Windows' own bsdtar, elsewhere `tar` (bsdtar on macOS). */
export const TAR = process.platform === 'win32' ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

/**
 * Runs a command; throws with its output when it fails.
 * @param {string} cmd @param {string[]} args @param {{ cwd?: string }} [o]
 */
export function run(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { cwd: o.cwd, maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr?.toString().trim() || r.error?.message}`);
  return r.stdout;
}

/**
 * The paths among `paths` that a commit's tree has (files or folders), so a bundle of an older commit skips what it
 * lacks. @param {string} dir @param {string} rev @param {string[]} paths
 */
export function inCommit(dir, rev, paths) {
  return paths.filter((p) => git(dir, ['ls-tree', '--name-only', rev, '--', p]).length > 0);
}

/**
 * Writes the given paths of a commit into a folder, through git archive (its eol attributes applied, as a checkout
 * would): `dest/<path>`. @param {string} dir @param {string} rev @param {string[]} paths @param {string} dest @param {string} tmp a scratch file
 */
export function fromCommit(dir, rev, paths, dest, tmp) {
  if (paths.length === 0) return;
  mkdirSync(dest, { recursive: true });
  git(dir, ['archive', '--format=tar', '-o', tmp, rev, '--', ...paths]);
  run(TAR, ['-x', '-f', tmp, '-C', dest]);
  rmSync(tmp);
}

/**
 * The workspace packages the server and the page run, by name with their folders: the roots and their workspace
 * dependencies (not the dev ones), transitively. @param {string} repo the platform checkout
 * @returns {Map<string, string>}
 */
export function runtimePackages(repo) {
  const workspace = readWorkspace(repo), out = new Map();
  const queue = [...ROOTS];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    const dir = workspace.get(name);
    if (dir === undefined || out.has(name)) continue;
    out.set(name, dir);
    queue.push(...runtimeDependencies(readPackageJson(dir) ?? {}).filter((d) => workspace.has(d)));
  }
  return out;
}

/** A path relative to a base, with / separators. @param {string} base @param {string} p */
export const posixRel = (base, p) => relative(base, p).split(sep).join('/');

/** Finds node_modules/<name> from a folder upward, the way Node does; its real folder or null. @param {string} name @param {string} from */
function installed(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}

/**
 * The third-party packages the given packages need at run time (their `dependencies`, transitively), as they are
 * installed in the checkout: name to real folder. Two versions of one name are refused (a flat node_modules holds one).
 * @param {Iterable<string>} dirs @returns {Map<string, string>}
 */
export function thirdParty(dirs) {
  /** @type {Map<string, string>} */
  const found = new Map();
  const queue = [...dirs];
  for (let dir = queue.pop(); dir !== undefined; dir = queue.pop()) {
    const deps = Object.keys(/** @type {Record<string, string>} */ (readPackageJson(dir)?.['dependencies'] ?? {}));
    for (const dep of deps.filter((d) => !WORKSPACE_SCOPES.some((s) => d.startsWith(s)))) {
      const at = installed(dep, dir);
      if (at === null) throw new Error(`${dep} (needed by ${dir}) is not installed: run pnpm install first`);
      if (found.has(dep) && found.get(dep) !== at) throw new Error(`two versions of ${dep}: ${found.get(dep)} and ${at}`);
      if (!found.has(dep)) { found.set(dep, at); queue.push(at); }
    }
  }
  return found;
}

/**
 * Copies third-party packages into dest/node_modules/<name> as plain folders (links followed, their own node_modules
 * left out). @param {Map<string, string>} packages @param {string} dest
 */
export function copyPackages(packages, dest) {
  for (const [name, from] of packages) {
    cpSync(from, join(dest, 'node_modules', name), { recursive: true, dereference: true, filter: (src) => !relative(from, src).split(sep).includes('node_modules') });
  }
}
