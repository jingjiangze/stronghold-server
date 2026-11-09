// End to end in a real browser with the original battle UI (the engine's 界面-10…22; runs only when AUE_ASSETS_DIR has
// the battle UI pack): the start panel shows the stage while the battle waits for the mate's page to load (同步-11)
// and goes once it begins, the first stage's banner shows its task; a card dragged onto a tile opens the direction selector, a drag north deploys the operator
// facing up through the server; a tap on it opens its menu and the retreat button takes it off the field. The mate
// asks for cost and to pause through its page; this page answers both. Run with `pnpm run e2e`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openSeat, sleep, startStack, until } from './helpers.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_UI = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'battle.json'));

/** A voice the page said: a character's line of a type (页面-4). @param {import('playwright').Page} page @param {string} char @param {string} type */
const said = async (page, char, type) => {
  /** @type {{ char: string, type: string, file: string, length: number }[]} */
  let s = [];
  try {
    return await until(`${char}'s ${type} line`, async () => {
      s = await page.evaluate(() => /** @type {any} */ (globalThis).__battle.sound().said);
      return s.find((v) => v.char === char && v.type === type);
    }, 5000);
  } catch (e) {
    throw new Error(`${/** @type {Error} */ (e).message}; said: ${JSON.stringify(s)}`, { cause: e });
  }
};

/**
 * The battle's start said by the deck's leader, its first operator with the line (页面-4, the engine's 音频-5); waits
 * until it has been said, since nothing of a lower priority takes over from it (音频-6). @param {import('playwright').Page} page @param {string[]} deck
 */
async function startSaid(page, deck) {
  const voices = JSON.parse(readFileSync(join(ASSETS, 'skeleton', 'voice', 'index.json'), 'utf8'));
  const leader = deck.map((k) => k.split('#')[0]).find((ch) => voices.chars[ch]?.lines.BATTLE_START?.length);
  const start = /** @type {{ length: number }} */ (/** @type {unknown} */ (await said(page, /** @type {string} */ (leader), 'BATTLE_START')));
  await sleep(start.length * 1000 + 300);
}

describe('the original battle UI in the browser', { skip: HAS_UI ? false : 'no battle UI pack in AUE_ASSETS_DIR' }, () => {
  /** @type {Awaited<ReturnType<typeof startStack>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {Awaited<ReturnType<typeof openSeat>> | undefined} */ let seat;
  /** @type {Awaited<ReturnType<typeof openSeat>> | undefined} */ let mate;

  before(async () => { stack = await startStack(); browser = await launch(); });
  after(async () => {
    await seat?.context.close().catch(() => {});
    await mate?.context.close().catch(() => {});
    await browser?.close();
    await stack?.stop();
  });

  test('the start panel while the mate loads; then drag a card, point north, deploy; tap the operator, retreat it', { timeout: 120000 }, async () => {
    seat = await openSeat(browser, stack.port, 0);
    const { page } = seat;
    assert.equal(await page.evaluate(() => /** @type {any} */ (globalThis).__battle.ui()), 'original');
    const c = /** @type {any} */ (stack.room.host.o.content), deck = /** @type {string[]} */ (c.decks[0]);
    const panel = page.locator('.aue-n[data-name="cooperate_battle_ui_battle_start_panel"]');
    await until('the start panel', async () => ((await panel.isVisible()) ? true : undefined), 10000);
    assert.ok((await panel.innerText()).includes(c.level.code), `the stage code ${c.level.code}`);
    await sleep(1500);
    assert.equal(stack.room.host.begun, false, 'no battle before the mate has loaded');
    const waiting = await Promise.all([0, 1, 2, 3].map((i) => page.locator(`.aue-n[data-name="text_waiting_${i}"]`).isVisible()));
    assert.ok(waiting.includes(true), 'waiting for the mate (its dots coming one by one)');
    mate = await openSeat(browser, stack.port, 1);
    await until('the battle begun', () => (stack.room.host.begun ? true : undefined), 20000);
    await until('the start panel gone', async () => ((await panel.isVisible()) ? undefined : true), 10000);
    // the first stage's banner (the engine's 界面-22): its task from the level data
    const banner = page.locator('.aue-n[data-name="container_conventional_mode"]');
    await until('the stage banner', async () => ((await banner.isVisible()) ? true : undefined), 5000);
    assert.ok((await banner.innerText()).includes(c.level.stages[0].task.basic), 'the first stage\'s basic task');
    // the page's sound (页面-4): the assets' audio index, the level's music from the battle's first frame
    const sound = await until('the music', async () => {
      const s = await page.evaluate(() => /** @type {any} */ (globalThis).__battle.sound());
      return s.music ? s : undefined;
    }, 10000);
    assert.ok(sound.banks > 1000, `${sound.banks} sound banks`);
    if (sound.voices > 0) await startSaid(page, deck);
    const op = deck.slice().sort((a, b) => c.operators[a].cost - c.operators[b].cost)[0], d = c.operators[op];
    const want = d.position === 'MELEE' ? ['MELEE', 'ALL'] : ['RANGED', 'ALL'];
    /** @type {{ row: number, col: number, h: number } | null} */
    let tile = null;
    c.level.tiles.forEach((/** @type {any[]} */ cells, /** @type {number} */ row) => cells.forEach((t, col) => {
      if (!tile && want.includes(t.buildable) && row >= 3 && row <= 4) tile = { row, col, h: t.height === 'HIGHLAND' ? 1 : 0 };
    }));
    assert.ok(tile, 'a tile the operator fits');
    const t = /** @type {{ row: number, col: number, h: number }} */ (tile);
    await until('cost for it', () => (stack.room.host.world.players[0].cost > d.cost ? true : undefined), 40000);
    /** @param {number} col @param {number} row */
    const pageOf = (col, row) => page.evaluate(([x, y, h]) => /** @type {number[]} */ (/** @type {any} */ (globalThis).__battle.pageOf(x, y, h)), [col, row, t.h]);

    // the cards in the deck's order: the operator's is its index among them
    const cards = page.locator('.aue-n[data-name="card_character"] .aue-n[data-name="image_underframe"]');
    await until('the cards', async () => ((await cards.count()) === deck.length ? true : undefined));
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await cards.nth(deck.indexOf(op)).boundingBox());
    const at = await pageOf(t.col, t.row);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(at[0], at[1], { steps: 8 });
    await sleep(300);
    await page.mouse.up();
    // the battle screen holds a hidden copy of the perspective canvas: the menus are the last ones
    const selector = page.locator('.aue-n[data-name="panel_direction_selector"]').last();
    await until('the direction selector', async () => ((await selector.isVisible()) ? true : undefined));

    const north = await pageOf(t.col, t.row + 1.5);
    await page.mouse.move(at[0], at[1]);
    await page.mouse.down();
    await page.mouse.move(north[0], north[1], { steps: 6 });
    await sleep(200);
    await page.mouse.up();
    await until('deployed facing up', () => (stack.room.host.world.units.find((u) => u.key === op)?.dir === 'UP' ? true : undefined), 10000);
    // its voice (页面-4, the engine's 音频-5): a deployment line in its dub, when the assets have voices
    if (sound.voices > 0) assert.match((await said(page, op.split('#')[0], 'PLACE_CHAR')).file, new RegExp(`^(CN_MANDARIN|JP|EN|KR|LINKAGE)/${op.split('#')[0]}/cn_\\d{3}\\.mp3$`));
    await until('the selector gone', async () => ((await selector.isVisible()) ? undefined : true));

    // its bars at its feet (the engine's 界面-19), then its menu, then retreat
    await sleep(1000);
    const u = /** @type {any} */ (stack.room.host.world.units.find((x) => x.key === op));
    const feet = await pageOf(u.x, u.y), hp = page.locator('.aue-n[data-name="char_hp_slider"]');
    await until('its HP bar', async () => ((await hp.count()) === 1 && (await hp.isVisible()) ? true : undefined), 5000);
    const bar = /** @type {{ x: number, width: number }} */ (await hp.boundingBox());
    assert.ok(Math.abs(bar.x + bar.width / 2 - feet[0]) < 40, `the bar under its feet: ${bar.x + bar.width / 2} vs ${feet[0]}`);
    await page.mouse.click(feet[0], feet[1] - 10);
    const withdraw = page.locator('.aue-n[data-name="btn_withdraw"]').last();
    await until('the operator menu', async () => ((await withdraw.isVisible()) ? true : undefined));
    await withdraw.click();
    await until('retreated', () => (stack.room.host.world.units.some((x) => x.key === op) ? undefined : true), 10000);
    assert.deepEqual(seat.errors, []);
  });

  test('the mate asks for cost and to pause through the UI; the answers go through the UI', { timeout: 120000 }, async () => {
    const a = /** @type {NonNullable<typeof seat>} */ (seat), m = /** @type {NonNullable<typeof mate>} */ (mate);
    const host = /** @type {any} */ (stack.room.host);
    const ask = m.page.locator('.aue-n[data-name="state_none_button"] .aue-n[data-name="collider"]');
    await until('the request button', async () => ((await ask.isVisible()) ? true : undefined), 20000);
    await ask.click();
    const accept = a.page.locator('.aue-n[data-name="state_response_accept"] .aue-n[data-name="hotspot"]');
    await until('the mate’s request on this page', async () => ((await accept.isVisible()) ? true : undefined), 10000);
    await accept.click();
    await until('the request answered', () => (host.world.players[1].ask < 0 && host.world.players[1].askCd > 0 ? true : undefined), 10000);
    await until('the mate sees the cost come', async () => ((await m.page.locator('.aue-n[data-name="state_accept"]').isVisible()) ? true : undefined), 5000);

    await m.page.locator('.aue-n[data-name="btn_multiplayer_pause"] .aue-n[data-name="collider"]').click();
    await until('the pause request open', () => (host.asker === 1 ? true : undefined), 10000);
    const confirm = a.page.locator('.aue-n[data-name="btn_confirm"]');
    await until('the request on this page', async () => ((await confirm.isVisible()) ? true : undefined), 10000);
    await confirm.click();
    await until('paused', () => (host.held ? true : undefined), 10000);
    await until('the pause mask', async () => ((await a.page.locator('.aue-n[data-name="mask_pause"]').isVisible()) ? true : undefined), 5000);
    assert.deepEqual([a.errors, m.errors], [[], []]);
  });
});
