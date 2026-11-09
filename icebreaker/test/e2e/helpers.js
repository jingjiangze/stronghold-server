// Shared pieces of the end-to-end tests: the in-process server with one battle room, the browser, seat pages that
// collect their errors, and polling.
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createMatchRoom, createHttpServer, DEFAULT_MATCH, kitDir, nodeKits, createBattles, createLobby, projectViews, recruits } from '@icebreaker/server';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Two deploys of the default match, each from its seat's deck: a ranged tile for seat 0, a melee tile for seat 1. */
export const DEPLOY = [
  { type: 'deploy', op: 'char_503_rang#0', row: 3, col: 2, dir: 0 },
  { type: 'deploy', op: 'char_123_fang#1', row: 4, col: 5, dir: 2 },
];

/** @typedef {{ frame: number, hash: number, sealed: number, stats: { restamps: number, resyncs: number, errors: number } }} Debug */

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls `fn` until it returns something other than undefined (errors count as not yet), or throws after the timeout.
 * @template T
 * @param {string} what @param {() => T | undefined | Promise<T | undefined>} fn @param {number} [timeout]
 * @returns {Promise<T>}
 */
export async function until(what, fn, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

/**
 * The server with a room of a match (default: the default match), on a free port of 127.0.0.1; with the pinned kits
 * when they are installed (engine ADR 0058); with the host's mods when given (站点-7).
 * @param {Parameters<typeof createMatchRoom>[0]} [match] @param {{ mods?: import('@icebreaker/server').HostMods }} [o]
 */
export async function startStack(match = DEFAULT_MATCH, o = {}) {
  /** @type {string[]} */
  const lines = [];
  const kitsDir = kitDir(ROOT);
  const room = await createMatchRoom(match, { log: (l) => lines.push(l), ...(kitsDir ? { kits: (/** @type {string[]} */ ids) => nodeKits(kitsDir, ids) } : {}),
    ...(o.mods ? { source: o.mods.source } : {}) });
  const server = createHttpServer({ rootDir: ROOT, assetsDir: process.env['AUE_ASSETS_DIR'] ?? '', onUpgrade: room.upgrade, kitsDir, ...(o.mods ? { mods: o.mods } : {}) });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const stop = async () => {
    room.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  };
  return { room, port, lines, stop };
}

/**
 * The server of the lobby and its rooms' battles (docs/spec/room.md), the room page at /, on a free port of 127.0.0.1;
 * with the pinned kits when they are installed.
 */
export async function startLobby() {
  /** @type {string[]} */
  const lines = [];
  const kitsDir = kitDir(ROOT), kits = kitsDir ? { kits: (/** @type {string[]} */ ids) => nodeKits(kitsDir, ids) } : {};
  const battles = createBattles({ ...kits, log: (l) => lines.push(l), onEnd: (id) => lobby.rooms.ended(id) });
  const lobby = createLobby({ projects: projectViews(), recruits: await recruits(), startMatch: (m, keys) => battles.start(m, keys),
    startTraining: (m, key) => battles.start(m, [key], { absent: [1] }) });
  const onUpgrade = (/** @type {any} */ req, /** @type {any} */ socket, /** @type {Buffer} */ head) => { if (!lobby.upgrade(req, socket, head) && !battles.upgrade(req, socket, head)) socket.destroy(); };
  const server = createHttpServer({ rootDir: ROOT, assetsDir: process.env['AUE_ASSETS_DIR'] ?? '', onUpgrade, kitsDir, home: 'room' });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const stop = async () => {
    lobby.close();
    battles.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  };
  return { lobby, battles, port, lines, stop };
}

/**
 * A reverse proxy on a free port of 127.0.0.1 that serves the site at `port` under `prefix` (docs/spec/site.md
 * 站点-1), as nginx's `location /icebreaker/ { proxy_pass http://app/; }` does: the prefix is cut off every request and
 * WebSocket upgrade, `prefix` without its slash is redirected, and nothing outside it is served (`outside` lists what
 * was asked for there).
 * @param {number} port @param {string} prefix like "/icebreaker/"
 */
export async function startPrefixProxy(port, prefix) {
  /** @type {string[]} */
  const outside = [];
  /** The upgraded connections, which closeAllConnections does not know. @type {Set<import('node:net').Socket | import('node:stream').Duplex>} */
  const raw = new Set();
  const strip = (/** @type {string} */ url) => {
    if (url.startsWith(prefix)) return url.slice(prefix.length - 1);
    outside.push(url);
    return null;
  };
  const proxy = http.createServer((req, res) => {
    const [bare, query] = (req.url ?? '').split(/(?=\?)/);
    if (bare === prefix.slice(0, -1)) { res.writeHead(301, { Location: prefix + (query ?? '') }); res.end(); return; }
    const path = strip(req.url ?? '');
    if (path === null) { res.writeHead(404); res.end(); return; }
    const up = http.request({ host: '127.0.0.1', port, path, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on('error', () => res.destroy());
    req.pipe(up);
  });
  proxy.on('upgrade', (req, socket, head) => {
    const path = strip(req.url ?? '');
    if (path === null) { socket.destroy(); return; }
    const up = net.connect(port, '127.0.0.1', () => {
      raw.add(up).add(socket);
      const lines = [`${req.method} ${path} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', () => r(undefined)));
  const at = /** @type {import('node:net').AddressInfo} */ (proxy.address()).port;
  const stop = () => {
    for (const s of raw) s.destroy();
    proxy.closeAllConnections();
    return new Promise((r) => proxy.close(r));
  };
  return { port: at, outside, stop };
}

/** Chromium: E2E_CHROME when set, else Playwright's own. */
export function launch() {
  const executablePath = process.env['E2E_CHROME'];
  return chromium.launch(executablePath ? { executablePath } : {});
}

/** Collects page errors and console errors, except the 404 of the optional assets. @param {import('playwright').Page} page @param {string[]} errors */
export function collectErrors(page, errors) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('Failed to load resource') && m.location().url.includes('/assets/')) return;
    errors.push(`console: ${m.text()}`);
  });
}

/**
 * A seat page in its own context (a fresh session key); `errors` fills as the page misbehaves. It waits until the
 * match's content is ready, or with `started` only until the page has started (a refused seat never gets a match);
 * `query` adds to the page's query (`bars`: the page's own bars even with the original UI's assets); `prefix` is the
 * path the site is under (站点-1, default the root).
 * @param {import('playwright').Browser} browser @param {number} port @param {number} seat @param {{ started?: boolean, query?: string, prefix?: string }} [o]
 */
export async function openSeat(browser, port, seat, o = {}) {
  const base = `http://127.0.0.1:${port}${o.prefix ?? '/'}`;
  const context = await browser.newContext(), page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  collectErrors(page, errors);
  await page.goto(`${base}?seat=${seat}${o.query ? `&${o.query}` : ''}`);
  if (o.started) await page.waitForFunction(() => '__battle' in globalThis, null, { timeout: 15000 });
  else await page.waitForFunction(() => /** @type {any} */ (globalThis).__battle?.ready(), null, { timeout: 20000 });
  return { context, page, errors };
}

/** What the page's battle reports. @param {import('playwright').Page} page @returns {Promise<Debug>} */
export const debugOf = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__battle.debug());

/** Sends a command from the page. @param {import('playwright').Page} page @param {object} cmd */
export const command = (page, cmd) => page.evaluate((c) => /** @type {any} */ (globalThis).__battle.command(c), cmd);

/** Waits until the page's frame is past `frame`. @param {import('playwright').Page} page @param {number} frame */
export const pastFrame = (page, frame) => until(`frame > ${frame}`, async () => {
  const d = await debugOf(page);
  return d.frame > frame ? d : undefined;
});

/**
 * Waits until the arbiter's history has the page's frame; returns both hashes.
 * @param {import('playwright').Page} page @param {Awaited<ReturnType<typeof import('@icebreaker/server').createMatchRoom>>} room
 */
export function matchesArbiter(page, room) {
  return until('the arbiter to know the page frame', async () => {
    const d = await debugOf(page), theirs = room.host.hashes.get(d.frame);
    return theirs === undefined ? undefined : { d, theirs };
  });
}
