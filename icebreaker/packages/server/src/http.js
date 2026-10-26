// The HTTP server: the pages, their static files, the modules, the pinned kits, the asset directory, the host's mods
// (站点-7) and a health check.
// The pages: the battle at /play, the lobby and its rooms at /room (docs/spec/room.md), and one of them at / .
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assetBase, assetVersion, createAssetHandler } from './assets.js';
import { createModuleHandler } from './modules.js';
import { createKitHandler, kitDir } from './kits.js';
import { createModsHandler, NO_MODS } from './mods.js';
import { rawPathname } from './paths.js';
import { allowReadOnly, sendBody, sendText } from './respond.js';
import { createStaticHandler, publicDir, serveFixedFile } from './static.js';
import { readWorkspace } from './workspace.js';

/**
 * @typedef {object} HttpOptions
 * @property {import('./modManager.js').HostModManager} [modManager] the /mod page + API; when given, /mods/ serves its live set
 * @property {string} rootDir the repository root
 * @property {string} [host] bind address for startHttpServer, default 127.0.0.1 (never 0.0.0.0 unless asked)
 * @property {number} [port] port for startHttpServer (0 picks a free one)
 * @property {string} [assetsDir] the asset directory; default env AUE_ASSETS_DIR, none means /assets/* is 404
 * @property {string[]} [browserPackages] workspace packages the browser runs; default the client
 * @property {string | null} [kitsDir] the pinned kits' commit (engine ADR 0058); default kitDir(rootDir), null: /k/ is 404
 * @property {(req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void} [onUpgrade]
 *   WEBSOCKET_UPGRADE_HOOK: the WebSocket upgrades (the lobby's /lobby, the battles' /battle)
 * @property {'play' | 'room'} [home] the page at / : the battle (default: a server of one match) or the lobby
 * @property {import('./mods.js').HostMods} [mods] the host's mods (站点-7); default none: an empty list
 */

/** @typedef {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean} Handler */

/** The pages' meta naming the asset base (站点-3), as the page files have it. */
const ASSET_META = '<meta name="ig-assets" content="assets/skeleton/">';

/**
 * The page files' handler, and the asset directory's with its version (站点-3) when there is one.
 * @param {string} rootDir @param {string | undefined} assetsDir @returns {{ handlers: Handler[], version: string | null }}
 */
function staticHandlers(rootDir, assetsDir) {
  const handlers = [createStaticHandler(join(publicDir(rootDir)), '/static/')];
  if (assetsDir === undefined || assetsDir === '' || !existsSync(assetsDir)) return { handlers, version: null };
  const version = assetVersion(assetsDir);
  handlers.push(createAssetHandler(assetsDir, version));
  return { handlers, version };
}

/**
 * A page as the server sends it (站点-4): its module scripts under the code's version, and before them a preload link
 * for every module they import statically, so the browser asks for all of them at once instead of one import level
 * after another.
 * @param {string} html @param {ReturnType<typeof createModuleHandler>} modules
 */
async function pageWithModules(html, modules) {
  const v = `~${modules.version()}/`, entries = [...html.matchAll(/<script type="module" src="m\/([^"]+)"><\/script>/g)].map((m) => `/m/${m[1]}`);
  const graphs = await Promise.all(entries.map((e) => modules.graph(e)));
  const links = [...new Set(graphs.flat())].filter((p) => p.endsWith('.js')).map((p) => `<link rel="modulepreload" href="m/${v}${p.slice(3)}">`);
  return html.replace(/(<script type="module" src="m\/)/g, `$1${v}`).replace('</head>', `${links.join('\n')}\n</head>`);
}

/**
 * A page with its loading screen's style and script written into it (站点-4, 页面-8), so the screen shows at the first
 * paint without waiting for any other request; a page without them, as it is.
 * @param {string} html @param {string} dir the pages' directory
 */
async function withBoot(html, dir) {
  const [css, js] = await Promise.all(['boot.css', 'boot.js'].map((f) => readFile(join(dir, f), 'utf8').catch(() => null)));
  let out = html;
  if (css !== null) out = out.replace('<link rel="stylesheet" href="static/boot.css">', () => `<style>${css}</style>`);
  if (js !== null && !js.includes('</script')) out = out.replace('<script src="static/boot.js"></script>', () => `<script>${js}</script>`);
  return out;
}

/**
 * Creates the server without listening.
 * @param {HttpOptions} options
 * @returns {import('node:http').Server}
 */
export function createHttpServer(options) {
  const { rootDir } = options;
  const browserPackages = options.browserPackages ?? ['@icebreaker/client'];
  const modules = createModuleHandler({ workspace: readWorkspace(rootDir, browserPackages), browserPackages });
  const kits = createKitHandler(options.kitsDir === undefined ? kitDir(rootDir) : options.kitsDir, modules.version);
  // the mod manager (optional): its page + API, and the live mod set its reload swaps in
  const manager = options.modManager ?? null;
  const mods = createModsHandler(manager ? () => manager.current() : (options.mods ?? NO_MODS));
  const files = staticHandlers(rootDir, options.assetsDir ?? process.env['AUE_ASSETS_DIR']);
  // the manager is async (it writes files); `some()` needs a synchronous verdict, so its OWN paths are claimed here
  // and everything else falls through to the other handlers unchanged
  const claimManager = (/** @type {import('node:http').IncomingMessage} */ req, /** @type {import('node:http').ServerResponse} */ res) => (manager && manager.handles(rawPathname(req.url ?? '')) ? (void manager.handler(req, res), true) : false);
  const handlers = [claimManager, modules, kits, mods, ...files.handlers];
  const meta = ASSET_META.replace('assets/skeleton/', assetBase(files.version));
  const withBase = async (/** @type {string} */ html) => pageWithModules(await withBoot(html.replace(ASSET_META, meta), publicDir(rootDir)), modules);
  const pages = { '/play': join(publicDir(rootDir), 'index.html'), '/room': join(publicDir(rootDir), 'room.html') };
  const home = pages[`/${options.home ?? 'play'}`];

  const server = createServer((req, res) => {
    const path = rawPathname(req.url);
    const page = path === '/' ? home : Object.hasOwn(pages, path) ? pages[/** @type {keyof typeof pages} */ (path)] : null;
    if (page) {
      serveFixedFile(req, res, page, 'text/html; charset=utf-8', withBase).catch(() => sendText(res, 500, 'internal error'));
    } else if (path === '/healthz') {
      if (allowReadOnly(req, res)) sendBody(req, res, { body: Buffer.from('{"ok":true}'), type: 'application/json; charset=utf-8' });
    } else if (!handlers.some((h) => h(req, res))) {
      sendText(res, 404, 'not found');
    }
  });
  if (options.onUpgrade !== undefined) server.on('upgrade', options.onUpgrade); // WEBSOCKET_UPGRADE_HOOK
  return server;
}

/**
 * Creates the server and listens on host:port (default 127.0.0.1).
 * @param {HttpOptions} options
 * @returns {Promise<import('node:http').Server>}
 */
export function startHttpServer(options) {
  const server = createHttpServer(options);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve(server));
  });
}
