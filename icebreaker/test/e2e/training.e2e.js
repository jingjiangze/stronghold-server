// 训练场 (docs/spec/room.md 房间-11): on the lobby screens the room panel's 训练场 opens the training room page; a tap on
// the chosen mode starts IG-TR-1 alone, and on the battle page its first tutorials play — the battle paused, Amiya's
// lines, a tap going on, the part a line is about lit.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, startLobby, until } from './helpers.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_LOBBY = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'lobby.json'));

/** @typedef {import('playwright').Page} Page */
/** @param {Page} page */
const lobby = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__room?.lobby());
/** A shown node named `name` under one named `parent`. @param {Page} page @param {string} parent @param {string} [name] */
const hot = (page, parent, name = 'hotspot') => page.locator(`#lobby .aue-n[data-name="${parent}"] .aue-n[data-name="${name}"]:visible`).first();
/** The tutorial's line now shown, or ''. @param {Page} page */
const line = (page) => page.evaluate(() => { const d = document.querySelector('.tut-dialog'); return d && !(/** @type {HTMLElement} */ (d)).hidden && !(/** @type {HTMLElement} */ (d.parentElement)).hidden ? d.textContent ?? '' : ''; });

describe('训练场', () => {
  /** @type {Awaited<ReturnType<typeof startLobby>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  before(async () => { stack = await startLobby(); browser = await launch(); });
  after(async () => { await browser?.close(); await stack?.stop(); });

  test('[房间-11] the training room page, IG-TR-1 alone, its first tutorials on the battle page', { skip: HAS_LOBBY ? false : 'no lobby UI pack in AUE_ASSETS_DIR' }, async () => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage(), errors = /** @type {string[]} */ ([]);
    collectErrors(page, errors);
    await page.goto(`http://127.0.0.1:${stack.port}/`);
    await page.locator('#conn', { hasText: '已连接' }).waitFor();
    await until('the entry page', async () => ((await lobby(page))?.page === 'entry' ? true : undefined), 30000);
    await hot(page, 'btn_team_up').click();
    await hot(page, 'btn_train').click();
    await until('the training room page', async () => ((await lobby(page))?.page === 'train' ? true : undefined), 10000);
    assert.equal(await page.locator('#lobby .aue-n[data-name="mode_item"]:visible').count(), 3, 'the three training modes');
    assert.equal(await page.locator('#lobby .aue-n[data-name="text_code"]:visible', { hasText: 'IG-TR-1' }).count(), 1, 'the chosen mode\'s level in its detail');
    await hot(page, 'nomal').click();
    await page.waitForURL(/\/play\?match=[0-9a-f]+&seat=0/, { timeout: 15000 });
    await until('the battle page', () => page.evaluate(() => (/** @type {any} */ (globalThis).__battle?.ready() ? true : undefined)), 60000);
    // 6 seconds in: the first story, Amiya's welcome, the battle held
    const first = await until('the first line', async () => ((await line(page)).includes('欢迎再次来到促融共竞') ? true : undefined), 30000);
    assert.equal(first, true);
    await page.waitForTimeout(600);
    await page.mouse.click(640, 360);
    await until('the second line', async () => ((await line(page)).includes('一位协作者') ? true : undefined), 5000);
    await page.waitForTimeout(600);
    await page.mouse.click(640, 360);
    // the second story's second line lights the co-op top bar's stage panel
    await until('the second story', async () => ((await line(page)).includes('每场比赛分为两个阶段') ? true : undefined), 20000);
    await page.waitForTimeout(600);
    await page.mouse.click(640, 360);
    await until('its lit part', async () => ((await line(page)).includes('生存') && (await page.locator('.tut-hole:visible').count()) === 1 ? true : undefined), 5000);
    assert.deepEqual(errors, []);
  });
});
