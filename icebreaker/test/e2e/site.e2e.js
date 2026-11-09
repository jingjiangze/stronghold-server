// The site under a path (docs/spec/site.md 站点-1): behind a proxy that serves it at /icebreaker/ and nowhere else,
// the room page reaches its lobby, and two seat pages load their modules, kits and worker and play their match in step
// — nothing is asked for outside the prefix.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, openSeat, pastFrame, startLobby, startPrefixProxy, startStack, until } from './helpers.js';

const PREFIX = '/icebreaker/';
const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_LOBBY_UI = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'lobby.json'));

describe('the site under a sub-path', () => {
  /** @type {import('playwright').Browser} */ let browser;
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  test('[站点-1] the room page under the prefix connects to its lobby', async () => {
    const stack = await startLobby(), proxy = await startPrefixProxy(stack.port, PREFIX);
    try {
      const context = await browser.newContext(), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
      collectErrors(page, errors);
      await page.goto(`http://127.0.0.1:${proxy.port}${PREFIX.slice(0, -1)}?html`);
      assert.equal(new URL(page.url()).pathname, PREFIX, 'the prefix without its slash is redirected');
      await page.locator('#conn', { hasText: '已连接' }).waitFor({ timeout: 15000 });
      assert.deepEqual(errors, []);
      assert.deepEqual(proxy.outside, []);
      await context.close();
    } finally {
      await proxy.stop();
      await stack.stop();
    }
  });

  test('[站点-1] with the lobby UI pack the original lobby screens load under the prefix', { skip: !HAS_LOBBY_UI && 'no lobby UI pack (AUE_ASSETS_DIR)' }, async () => {
    const stack = await startLobby(), proxy = await startPrefixProxy(stack.port, PREFIX);
    try {
      const context = await browser.newContext(), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
      collectErrors(page, errors);
      const assets = /** @type {string[]} */ ([]);
      page.on('request', (q) => { const p = new URL(q.url()).pathname; if (p.includes('/assets/')) assets.push(p); });
      await page.goto(`http://127.0.0.1:${proxy.port}${PREFIX}`);
      await until('the lobby screens', () => page.evaluate(() => /** @type {any} */ (globalThis).__room.lobby() ?? undefined), 60000);
      await page.locator('#conn', { hasText: '已连接' }).waitFor({ timeout: 15000 });
      assert.deepEqual(errors, []);
      assert.deepEqual(proxy.outside, []);
      // 站点-3: the assets come from the versioned base, except the fonts the style sheet names
      assert.ok(assets.length > 10, `assets loaded: ${assets.length}`);
      assert.deepEqual(assets.filter((p) => !/^\/icebreaker\/assets\/~[0-9a-f]{12}\/skeleton\//.test(p) && !p.includes('/fonts/')), []);
      await context.close();
    } finally {
      await proxy.stop();
      await stack.stop();
    }
  });

  test('[站点-1] two seat pages under the prefix play their match through the proxied sockets', async () => {
    const stack = await startStack(), proxy = await startPrefixProxy(stack.port, PREFIX);
    try {
      const seats = await Promise.all([0, 1].map((seat) => openSeat(browser, proxy.port, seat, { prefix: PREFIX })));
      await Promise.all(seats.map((s) => pastFrame(s.page, 60)));
      for (const s of seats) assert.deepEqual(s.errors, []);
      assert.deepEqual(proxy.outside, []);
      await Promise.all(seats.map((s) => s.context.close()));
    } finally {
      await proxy.stop();
      await stack.stop();
    }
  });
});
