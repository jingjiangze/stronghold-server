// Phones (docs/spec/page.md 页面-7) in a real browser with a phone's touch screen held upright: the pages turn into
// landscape; the lobby's buttons take taps; on the battle page a card dragged onto a tile and a drag north deploy the
// operator facing up, and the mark card dragged onto a tile marks it — the page reading the turned frame's positions.
// The page's positions (__battle.pageOf) are the turned frame's: x down the screen, y from its right edge.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { devices } from 'playwright';
import { collectErrors, launch, openSeat, sleep, startLobby, startStack, until } from './helpers.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_UI = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'battle.json')) && existsSync(join(ASSETS, 'skeleton', 'ui', 'lobby.json'));
const PHONE = devices['Pixel 7'];

/** A point of the turned frame on the screen of width w. @param {number[]} p @param {number} w */
const onScreen = (p, w) => [w - p[1], p[0]];

describe('phones', { skip: HAS_UI ? false : 'no UI packs in AUE_ASSETS_DIR' }, () => {
  /** @type {import('playwright').Browser} */ let browser;
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  test('[页面-7] the lobby held upright: turned into landscape, its buttons take taps', async () => {
    const lobby = await startLobby();
    try {
      const ctx = await browser.newContext({ ...PHONE }), page = await ctx.newPage(), errors = /** @type {string[]} */ ([]);
      collectErrors(page, errors);
      await page.goto(`http://127.0.0.1:${lobby.port}/`);
      await until('the entry page', async () => ((await page.evaluate(() => /** @type {any} */ (globalThis).__room?.lobby()))?.page === 'entry' ? true : undefined), 40000);
      const size = await page.evaluate(() => ({ turned: document.documentElement.classList.contains('turned'), w: innerWidth, h: innerHeight }));
      assert.deepEqual(size, { turned: true, w: PHONE.viewport.height, h: PHONE.viewport.width }, 'the page measures the turned frame');
      await page.locator('#lobby .aue-n[data-name="btn_team_up"] .aue-n[data-name="hotspot"]:visible').first().click();
      await until('the room panel', async () => ((await page.evaluate(() => /** @type {any} */ (globalThis).__room.lobby()))?.local.room ? true : undefined), 10000);
      assert.deepEqual(errors, []);
      await ctx.close();
    } finally { await lobby.stop(); }
  });

  test('[页面-7] the battle held upright: a card dragged onto a tile and north deploys facing up; the mark card marks a tile', { timeout: 120000 }, async () => {
    const stack = await startStack(), seats = [];
    try {
      const ctx = await browser.newContext({ ...PHONE }), page = await ctx.newPage(), errors = /** @type {string[]} */ ([]);
      collectErrors(page, errors);
      await page.goto(`http://127.0.0.1:${stack.port}/?seat=0`);
      seats.push(await openSeat(browser, stack.port, 1));
      await until('the battle begun', () => (stack.room.host.begun ? true : undefined), 40000);
      await until('the signals', async () => ((await page.evaluate(() => /** @type {any} */ (globalThis).__battle.signals?.()))?.card ? true : undefined), 20000);
      const c = /** @type {any} */ (stack.room.host.o.content), deck = /** @type {string[]} */ (c.decks[0]), w = PHONE.viewport.width;
      const op = deck.slice().sort((a, b) => c.operators[a].cost - c.operators[b].cost)[0], d = c.operators[op];
      const want = d.position === 'MELEE' ? ['MELEE', 'ALL'] : ['RANGED', 'ALL'];
      const found = /** @type {any[][]} */ (c.level.tiles).flatMap((cells, row) => cells.map((x, col) => ({ row, col, x })))
        .find(({ row, x }) => want.includes(x.buildable) && row >= 3 && row <= 4);
      assert.ok(found, 'a tile the operator fits');
      const t = { row: found.row, col: found.col, h: found.x.height === 'HIGHLAND' ? 1 : 0 };
      await until('cost for it', () => (stack.room.host.world.players[0].cost > d.cost ? true : undefined), 40000);
      // the page's own view of the cost (it follows the server's a little later), and the stage's banner over the field
      // gone (it takes a drop while it plays, the engine's 界面-22)
      await until('the page has the cost', async () => ((await page.evaluate(() => /** @type {any} */ (globalThis).__battle.cost?.().ui ?? 0)) > d.cost ? true : undefined), 20000);
      const banner = page.locator('.aue-n[data-name="container_conventional_mode"]');
      await until('the stage banner gone', async () => ((await banner.count()) === 0 || !(await banner.first().isVisible()) ? true : undefined), 15000);
      const at = (/** @type {number} */ col, /** @type {number} */ row) => page.evaluate(([x, y, h]) => /** @type {number[]} */ (/** @type {any} */ (globalThis).__battle.pageOf(x, y, h)), [col, row, t.h])
        .then((p) => onScreen(p, w));
      const cards = page.locator('.aue-n[data-name="card_character"] .aue-n[data-name="image_underframe"]');
      await until('the cards', async () => ((await cards.count()) === deck.length ? true : undefined));
      const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await cards.nth(deck.indexOf(op)).boundingBox());
      const p = await at(t.col, t.row), north = await at(t.col, t.row + 1.5);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(p[0], p[1], { steps: 8 });
      await sleep(300);
      await page.mouse.up();
      await until('the direction selector', async () => ((await page.locator('.aue-n[data-name="panel_direction_selector"]').last().isVisible()) ? true : undefined));
      await page.mouse.move(p[0], p[1]);
      await page.mouse.down();
      await page.mouse.move(north[0], north[1], { steps: 6 });
      await sleep(200);
      await page.mouse.up();
      await until('deployed facing up', () => (stack.room.host.world.units.find((u) => u.key === op && u.x === t.col && u.y === t.row)?.dir === 'UP' ? true : undefined), 10000);
      const mark = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('.aue-n[data-name="btn_display_mark"] .aue-n[data-name="collider"]').first().boundingBox());
      const q = await at(t.col + 1, t.row - 1);
      await page.mouse.move(mark.x + mark.width / 2, mark.y + mark.height / 2);
      await page.mouse.down();
      await page.mouse.move(q[0], q[1], { steps: 8 });
      await page.mouse.up();
      const s = await until('the mark', async () => { const x = await page.evaluate(() => /** @type {any} */ (globalThis).__battle.signals?.()); return x?.marks.length ? x : undefined; }, 5000);
      assert.deepEqual(s.marks.map((/** @type {any} */ m) => [m.row, m.col]), [[t.row - 1, t.col + 1]]);
      assert.deepEqual(errors, []);
      await ctx.close();
    } finally {
      for (const s of seats) await s.context.close().catch(() => {});
      await stack.stop();
    }
  });
});
