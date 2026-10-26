// The release bundles (docs/deploy.md), which the maintainer attaches to a GitHub release:
//   Icebreaker-Games-v<version>.zip         → Icebreaker-Games/: the platform and the engine as committed (their runtime
//       packages), the third-party packages they run with (plain folders), the assets (assets/skeleton/), the files of
//       the pinned kits the server runs (kits/stronghold-<sha12>/), the start scripts and MANIFEST.json: download,
//       unzip, start.
//   Icebreaker-Games-v<version>-assets.zip  → Icebreaker-Games-assets/: the assets alone, NOTICE.md and MANIFEST.json,
//       for a source install (AUE_ASSETS_DIR=<that folder>/assets).
// Usage: node tools/package.js --version 0.1.0 --assets <asset repository> --kits <Stronghold Protocol checkout at the
//   pinned commit> [--out <folder outside the repository>] [--force] [--keep-stage]
// A bundle is the commit (HEAD and the engine commit it pins), never the working tree. Before it is zipped, each stage
// passes the checks of release/checks.js (refused paths, links, case clashes, anything personal); a hit stops the
// build and says where.
import { cpSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, writeManifest, zipFolder } from './release/archive.js';
import { problems, refused, scanNames } from './release/checks.js';
import { ENGINE_FILES, ROOT_FILES, copyPackages, fromCommit, git, inCommit, posixRel, runtimePackages, thirdParty } from './release/select.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FOLDER = 'Icebreaker-Games', ASSETS_FOLDER = 'Icebreaker-Games-assets';
const KITS_REPO = 'https://github.com/sganggs/Stronghold-Protocol';
/** The kits' files the server runs: served to the page under /k/ and loaded under Node (packages/server/src/kits.js). */
const KIT_FILES = ['server/sim/content', 'package.json', 'LICENSE', 'NOTICE.md'];

/** @typedef {{ version: string, assets: string, kits: string, out: string, force: boolean, keepStage: boolean }} Options */

/** @param {string[]} argv @param {string} name */
const option = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

/** Whether `p` lies inside `dir` (or is it). @param {string} dir @param {string} p */
const inside = (dir, p) => { const r = relative(dir, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

/** The options, checked. @param {string[]} argv @returns {Options} */
function parseOptions(argv) {
  const version = option(argv, '--version') ?? '', assets = option(argv, '--assets'), kits = option(argv, '--kits');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version)) throw new Error('--version <x.y.z> is needed');
  if (!assets || !existsSync(join(assets, 'skeleton'))) throw new Error('--assets <the asset repository, holding skeleton/> is needed');
  if (!kits || !existsSync(join(kits, 'server', 'sim', 'content'))) throw new Error('--kits <a Stronghold Protocol checkout> is needed');
  const out = resolve(option(argv, '--out') ?? join(tmpdir(), 'icebreaker-games-release'));
  if (inside(REPO, out)) throw new Error('--out must be outside the repository');
  return { version, assets: resolve(assets), kits: resolve(kits), out, force: argv.includes('--force'), keepStage: argv.includes('--keep-stage') };
}

/** Logs a step with the seconds since the start. @param {number} t0 @param {string} what */
const step = (t0, what) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${what}`);

/**
 * The platform and the engine as committed: the root files, the runtime packages without their tests, the
 * third-party packages they need. @param {string} stage @param {string} tmp @returns {{ commit: string, engine: string }}
 */
function stageCode(stage, tmp) {
  const commit = git(REPO, ['rev-parse', 'HEAD']).toString().trim(), engine = git(REPO, ['rev-parse', 'HEAD:engine']).toString().trim();
  const packages = runtimePackages(REPO), engineDir = join(REPO, 'engine');
  const dirs = [...packages.values()].map((d) => posixRel(REPO, d));
  const own = dirs.filter((d) => !d.startsWith('engine/')), theirs = dirs.filter((d) => d.startsWith('engine/')).map((d) => d.slice('engine/'.length));
  fromCommit(REPO, commit, inCommit(REPO, commit, [...ROOT_FILES, ...own]), stage, tmp);
  fromCommit(engineDir, engine, inCommit(engineDir, engine, [...ENGINE_FILES, ...theirs]), join(stage, 'engine'), tmp);
  for (const d of dirs) rmSync(join(stage, d, 'test'), { recursive: true, force: true });
  copyPackages(thirdParty(packages.values()), stage);
  return { commit, engine };
}

/**
 * Copies a folder, leaving out what the refusal list names; returns what was left out.
 * @param {string} from @param {string} to @param {string} prefix the copy's path in the bundle, for the list
 */
function copyKept(from, to, prefix) {
  /** @type {string[]} */
  const left = [];
  cpSync(from, to, { recursive: true, filter: (src) => {
    const rel = `${prefix}/${posixRel(from, src)}`.replace(/\/$/, '');
    if (src !== from && refused(rel)) { left.push(rel); return false; }
    return true;
  } });
  return left;
}

/**
 * The pinned kits' runtime files under kits/stronghold-<sha12>/ with where their source is; the checkout must be at
 * the commit the engine pins. @param {string} kits @param {string} stage @returns {string} the commit
 */
function stageKits(kits, stage) {
  const sha = JSON.parse(readFileSync(join(stage, 'engine', 'packages', 'content', 'data', 'kits.json'), 'utf8')).source.sha;
  const at = git(kits, ['rev-parse', 'HEAD']).toString().trim();
  if (at !== sha) throw new Error(`--kits is at ${at}, the engine pins ${sha}`);
  const dir = join(stage, 'kits', `stronghold-${sha.slice(0, 12)}`);
  for (const f of KIT_FILES) copyKept(join(kits, f), join(dir, f), posixRel(stage, join(dir, f)));
  writeFileSync(join(dir, 'SOURCE.md'), `# Stronghold Protocol（GPL-3.0-or-later）\n\n这里只有对局运行的干员 kit 所需的文件（\`server/sim/content/\`）。完整源代码：${KITS_REPO}/tree/${sha}\n\nOnly the files the operator kits run with in matches. The full source: ${KITS_REPO}/tree/${sha}\n`);
  return sha;
}

/** The commit of a checkout, or null when it is none. @param {string} dir */
function commitOf(dir) {
  try { return git(dir, ['rev-parse', 'HEAD']).toString().trim(); } catch { return null; }
}

/** Checks a stage, writes its manifest, zips it. @param {string} parent @param {string} folder @param {Record<string, unknown>} meta @param {string} zip */
function finish(parent, folder, meta, zip) {
  const root = join(parent, folder), files = listFiles(root);
  const found = problems(root, files, scanNames());
  if (found.length) throw new Error(`the bundle ${folder} is refused:\n  ${found.slice(0, 50).join('\n  ')}${found.length > 50 ? `\n  … ${found.length - 50} more` : ''}`);
  const bytes = writeManifest(root, files, meta);
  zipFolder(parent, folder, zip);
  return { files: files.length + 1, bytes };
}

/**
 * The assets bundle beside the full one: its assets/ hard-linked from the full stage (copied where links fail), the
 * notice. @param {string} full the full stage @param {string} root the assets stage
 */
function stageAssetsOnly(full, root) {
  for (const f of listFiles(join(full, 'assets'))) {
    const to = join(root, 'assets', f);
    mkdirSync(dirname(to), { recursive: true });
    try { linkSync(join(full, 'assets', f), to); } catch { cpSync(join(full, 'assets', f), to); }
  }
  cpSync(join(full, 'NOTICE.md'), join(root, 'NOTICE.md'));
}

/** @param {Options} o @param {number} t0 */
function build(o, t0) {
  const zips = { full: join(o.out, `${FOLDER}-v${o.version}.zip`), assets: join(o.out, `${FOLDER}-v${o.version}-assets.zip`) };
  for (const z of Object.values(zips)) if (existsSync(z) && !o.force) throw new Error(`${z} exists (--force replaces it)`);
  const stages = join(o.out, `stage-${o.version}`);
  rmSync(stages, { recursive: true, force: true });
  for (const z of Object.values(zips)) rmSync(z, { force: true });
  const full = join(stages, 'full'), root = join(full, FOLDER), assetsParent = join(stages, 'assets');
  mkdirSync(root, { recursive: true });
  const code = stageCode(root, join(stages, 'code.tar'));
  step(t0, `code: platform ${code.commit.slice(0, 7)}, engine ${code.engine.slice(0, 7)}`);
  const left = copyKept(join(o.assets, 'skeleton'), join(root, 'assets', 'skeleton'), 'assets/skeleton');
  const kits = stageKits(o.kits, root);
  step(t0, `assets and kits ${kits.slice(0, 7)} staged${left.length ? `; left out: ${left.join(', ')}` : ''}`);
  const meta = { name: FOLDER, version: o.version, commit: code.commit, engine: code.engine, kits, assets: commitOf(o.assets) };
  stageAssetsOnly(root, join(assetsParent, ASSETS_FOLDER));
  const a = finish(full, FOLDER, meta, zips.full);
  step(t0, `${zips.full}: ${a.files} files, ${(a.bytes / 2 ** 20).toFixed(1)} MiB unzipped`);
  const b = finish(assetsParent, ASSETS_FOLDER, { ...meta, name: ASSETS_FOLDER }, zips.assets);
  step(t0, `${zips.assets}: ${b.files} files, ${(b.bytes / 2 ** 20).toFixed(1)} MiB unzipped`);
  if (!o.keepStage) rmSync(stages, { recursive: true, force: true });
}

try {
  build(parseOptions(process.argv.slice(2)), Date.now());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
