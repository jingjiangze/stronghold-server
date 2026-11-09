// The loading screen and the fast loading in a browser (docs/spec/page.md 页面-8, docs/spec/site.md 站点-4, 站点-5; the
// screen with the activity's art runs only when AUE_ASSETS_DIR has the lobby pack): the room page paints the screen at
// once from the page itself, its progress only goes up, and it is gone once the lobby's entry screen is there; loaded
// again, no module is asked for; the battle page asks for the effect pack of its match's units only and hands over.
// Run with `pnpm run e2e`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openSeat, startLobby, startStack, until } from './helpers.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_LOBBY = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'lobby.json'));

describe('the loading screen', { skip: HAS_LOBBY ? false : 'no lobby pack in AUE_ASSETS_DIR' }, () => {
  /** @type {any} */ let lobby;
  /** @type {any} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  before(async () => { lobby = await startLobby(); stack = await startStack(); browser = await launch(); });
  after(async () => { await browser?.close(); await lobby?.stop(); await stack?.stop(); });

  test('[页面-8] [站点-4] the room page: the screen at once, its progress going up, gone at the entry screen; loaded again from the cache', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }), page = await context.newPage();
    /** @type {string[]} */
    const asked = [];
    page.on('request', (r) => asked.push(new URL(r.url()).pathname));
    // the progress as the screen shows it, sampled from its first paint
    await page.addInitScript(() => {
      const g = /** @type {any} */ (globalThis);
      g.__seen = [];
      const look = () => { const b = document.querySelector('.boot'); if (b) g.__seen.push(Number(getComputedStyle(b).getPropertyValue('--boot-progress') || 0)); requestAnimationFrame(look); };
      requestAnimationFrame(look);
    });
    await page.goto(`http://127.0.0.1:${lobby.port}/`);
    await until('the lobby screens', async () => (await page.evaluate(() => /** @type {any} */ (globalThis).__room?.lobby()?.page === 'entry') ? true : undefined), 60000);
    await until('the screen gone', async () => ((await page.locator('.boot').count()) === 0 ? true : undefined), 5000);
    const seen = /** @type {number[]} */ (await page.evaluate(() => /** @type {any} */ (globalThis).__seen));
    assert.ok(seen.length > 0, 'the screen was up');
    assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'never going back');
    assert.ok(Math.max(...seen) >= 0.55, `it went on to the lobby's sprites (${Math.max(...seen)})`);
    assert.ok(!asked.some((p) => p.includes('/static/boot.')), 'written into the page, not asked for');
    assert.ok(asked.some((p) => /^\/m\/~[0-9a-f]{12}\//.test(p)), 'the modules under the code\'s version');
    const again = await context.newPage(), cdp = await context.newCDPSession(again);
    await cdp.send('Network.enable');
    /** @type {string[]} */
    const onWire = [];
    cdp.on('Network.responseReceived', (e) => {
      const r = /** @type {any} */ (e.response);
      if (new URL(r.url).pathname.startsWith('/m/') && !r.fromDiskCache && !r.fromMemoryCache) onWire.push(r.url);
    });
    await again.goto(`http://127.0.0.1:${lobby.port}/`);
    await until('the lobby screens again', async () => (await again.evaluate(() => /** @type {any} */ (globalThis).__room?.lobby()?.page === 'entry') ? true : undefined), 60000);
    assert.deepEqual(onWire, [], 'every module from the cache');
    await context.close();
  });

  test('[站点-5] [页面-8] the battle page: the effect pack of its match\'s units only; the screen hands over', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }), page = await context.newPage();
    /** @type {string[]} */
    const fx = [];
    page.on('request', (r) => { if (r.url().includes('fx/units.json')) fx.push(r.url()); });
    await page.goto(`http://127.0.0.1:${stack.port}/?seat=0`);
    await page.waitForFunction(() => /** @type {any} */ (globalThis).__battle?.ready(), null, { timeout: 60000 });
    const mate = await openSeat(browser, stack.port, 1);
    await until('the screen gone', async () => ((await page.locator('.boot').count()) === 0 ? true : undefined), 30000);
    assert.equal(fx.length, 1);
    const units = new URL(fx[0]).searchParams.get('for')?.split(',') ?? [];
    const c = stack.room.host.o.content;
    assert.ok(Object.keys(c.enemies).every((k) => units.includes(k)), 'every enemy of the level');
    assert.ok(units.length < 60, `${units.length} units, not every one`);
    await mate.context.close();
    await context.close();
  });
});

describe('a page whose code cannot start', () => {
  /** @type {any} */ let lobby;
  /** @type {import('playwright').Browser} */ let browser;
  before(async () => { lobby = await startLobby(); browser = await launch(); });
  after(async () => { await browser?.close(); await lobby?.stop(); });

  test('[页面-8] [站点-4] a syntax its engine does not read: the warning and what to do, not 30% for ever', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }), page = await context.newPage();
    // what an engine older than the page's code meets (Chromium before 123 met `with { type: 'json' }`)
    await page.route(/\/m\/~[0-9a-f]+\/@icebreaker\/client\/src\/room\.js$/, (r) => r.fulfill({ contentType: 'text/javascript', body: 'let let = 1;' }));
    await page.goto(`http://127.0.0.1:${lobby.port}/`);
    await until('the warning', async () => ((await page.locator('.boot.failed').count()) === 1 ? true : undefined), 20000);
    assert.match(await page.locator('.boot-text').innerText(), /浏览器版本太旧/);
    await context.close();
  });

  test('[站点-4] no module the page loads carries import attributes: JSON comes as a script', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }), page = await context.newPage();
    /** @type {string[]} */
    const json = [];
    page.on('response', (r) => { if (/\.json\.js$/.test(new URL(r.url()).pathname) && /javascript/.test(r.headers()['content-type'] ?? '')) json.push(r.url()); });
    await page.goto(`http://127.0.0.1:${lobby.port}/`);
    await until('the page started', async () => ((await page.evaluate(() => typeof (/** @type {any} */ (globalThis).__room) === 'object')) ? true : undefined), 60000);
    assert.ok(json.length > 0, 'the content\'s data as scripts');
    await context.close();
  });
});
