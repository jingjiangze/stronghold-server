// 局内标记与局内表情 (docs/spec/room.md 房间-12) in a real browser with the original battle UI (runs only when
// AUE_ASSETS_DIR has the battle UI pack): seat 0 drags the mark card onto a tile, both pages show the mark and the card
// cools down; seat 1 sends a battle emote from the panel, seat 0's page pops it on the mate's side.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openSeat, startStack, until } from './helpers.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_UI = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'battle.json'));

/** @param {import('playwright').Page} page */
const signals = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__battle.signals?.());

describe('marks and battle emotes in the browser', { skip: HAS_UI ? false : 'no battle UI pack in AUE_ASSETS_DIR' }, () => {
  /** @type {Awaited<ReturnType<typeof startStack>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {Awaited<ReturnType<typeof openSeat>>[]} */ const seats = [];
  before(async () => { stack = await startStack(); browser = await launch(); });
  after(async () => {
    for (const s of seats) await s.context.close().catch(() => {});
    await browser?.close();
    await stack?.stop();
  });

  test('[房间-12] a mark dragged onto a tile shows on both pages, the card cools down; an emote pops on the mate\'s page', { timeout: 120000 }, async () => {
    seats.push(await openSeat(browser, stack.port, 0), await openSeat(browser, stack.port, 1));
    const [a, b] = seats.map((s) => s.page);
    await until('the battle begun', () => (stack.room.host.begun ? true : undefined), 30000);
    for (const p of [a, b]) await until('the signals', async () => ((await signals(p))?.card ? true : undefined), 20000);
    const level = /** @type {any} */ (stack.room.host.o.content).level, row = Math.floor(level.height / 2), col = Math.floor(level.width / 2);
    const card = a.locator('.aue-n[data-name="btn_display_mark"] .aue-n[data-name="collider"]').first(), box = await card.boundingBox();
    assert.ok(box, 'the mark card');
    const to = await a.evaluate(([c, r]) => /** @type {any} */ (globalThis).__battle.pageOf(c, r, 0), [col, row]);
    await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await a.mouse.down();
    await a.mouse.move(to[0], to[1], { steps: 8 });
    await a.mouse.up();
    for (const p of [a, b]) {
      const s = await until('the mark', async () => { const x = await signals(p); return x?.marks.length ? x : undefined; }, 5000);
      assert.deepEqual(s.marks, [{ seat: 0, row, col, type: 0 }]);
    }
    assert.equal(await a.locator('.aue-n[data-name="btn_display_mark"] .aue-n[data-name="cool_down"]').first().isVisible(), true, 'the card cools down');
    await b.locator('.aue-n[data-name="btn_normal"] .aue-n[data-name="hotspot"]').first().click();
    await b.locator('.aue-n[data-name="multiv3_emoji_item_battle"] .aue-n[data-name="hotspot"]:visible').first().click();
    await until('the pop on the mate\'s page', async () => ((await a.locator('.aue-n[data-name="emoji_send_mate"]:visible').count()) > 0 ? true : undefined), 5000);
    await until('the pop on the sender\'s page', async () => ((await b.locator('.aue-n[data-name="emoji_send_me"]:visible').count()) > 0 ? true : undefined), 5000);
    for (const s of seats) assert.deepEqual(s.errors, []);
  });
});
