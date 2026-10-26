// Starts the server of a release bundle (docs/deploy.md; start-windows.bat and start.sh run this): checks Node, links
// the workspace packages into node_modules (a zip holds no links, so the bundle makes them on its first start and again
// after the folder moved), points the server at the bundle's assets and kits, says the addresses players open, then
// runs the server. The arguments go to the server; it listens on every address unless --host says otherwise. With
// --link-only it makes the links and stops (an install whose folder the server may not write: docs/deploy.md §4).
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readWorkspace } from '../packages/server/src/workspace.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The oldest Node the platform runs on (package.json engines). */
const MIN_NODE = [22, 12];

/** Whether this Node is at least MIN_NODE. */
function nodeIsNew() {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/** node_modules/<name> → the workspace package, for each one not linked right (a bundle only: it has MANIFEST.json). */
function linkWorkspace() {
  if (!existsSync(join(ROOT, 'MANIFEST.json'))) return;
  for (const [name, dir] of readWorkspace(ROOT)) {
    const link = join(ROOT, 'node_modules', name);
    let at = null;
    try { at = realpathSync(link); } catch { /* not there yet */ }
    if (at === dir) continue;
    if (existsSync(link) || isLink(link)) {
      if (!isLink(link)) throw new Error(`${link} 是一个普通文件夹，不是指向 ${dir} 的链接：请删除它后再启动`);
      rmSync(link, { force: true });
    }
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(dir, link, 'junction');
  }
}

/** @param {string} p */
function isLink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/** The bundle's assets and kits, unless the environment names others. */
function pointAtBundle() {
  if (!process.env['AUE_ASSETS_DIR'] && existsSync(join(ROOT, 'assets', 'skeleton'))) process.env['AUE_ASSETS_DIR'] = join(ROOT, 'assets');
  const kits = join(ROOT, 'kits');
  if (process.env['AUE_KITS_DIR'] || !existsSync(kits)) return;
  const pinned = readdirSync(kits).find((d) => existsSync(join(kits, d, 'server', 'sim', 'content')));
  if (pinned) process.env['AUE_KITS_DIR'] = join(kits, pinned);
}

/** The addresses other computers on the network can open. @param {number} port */
function addresses(port) {
  const ips = Object.values(networkInterfaces()).flatMap((list) => (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => a.address));
  return [`本机：http://localhost:${port}/`, ...ips.map((ip) => `局域网：http://${ip}:${port}/`)];
}

/** Starts the server with the arguments (every address unless --host). @param {string[]} argv */
async function start(argv) {
  if (argv.includes('--link-only')) { linkWorkspace(); console.log('node_modules 的链接已建立'); return; }
  const args = argv.includes('--host') ? argv : ['--host', '0.0.0.0', ...argv];
  const port = argv.includes('--port') ? Number(argv[argv.indexOf('--port') + 1]) : 8700;
  linkWorkspace();
  pointAtBundle();
  // a port the server will refuse: no addresses, the server says what is wrong
  const valid = Number.isInteger(port) && port >= 0 && port <= 65535;
  console.log(['促融共竞 · Icebreaker-Games', ...(valid ? addresses(port) : []), '按 Ctrl+C 停止。'].join('\n'));
  const main = join(ROOT, 'packages', 'server', 'src', 'main.js');
  process.argv = [process.argv[0] ?? 'node', main, ...args];
  await import(pathToFileURL(main).href);
}

if (!nodeIsNew()) {
  console.error(`需要 Node.js ${MIN_NODE.join('.')} 或更新的版本（现在是 ${process.versions.node}）：https://nodejs.org/`);
  process.exitCode = 1;
} else {
  start(process.argv.slice(2)).catch((e) => {
    console.error(`启动失败：${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
