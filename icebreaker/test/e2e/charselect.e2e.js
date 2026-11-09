// The operator select page on the original lobby screens (docs/spec/page.md 页面-9; runs only when AUE_ASSETS_DIR has
// a lobby UI pack with it): a player with a filled 常规队 opens it from the squad page's 快捷编队 for the high-priority
// list — its operators first and numbered, only the columns in view built —, empties the choice, filters by a
// profession and taps two of them, which become the list on 确认 (the low-priority list letting go of them). Run with
// `pnpm run e2e`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, sleep, startLobby, until } from './helpers.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const PACK = join(ASSETS, 'skeleton', 'ui', 'lobby.json');
const HAS_SELECT = ASSETS !== '' && existsSync(PACK) && readFileSync(PACK, 'utf8').includes('"charselect/dyn_char_select_state"');
/** Every operator's roster entry (the engine's operator index). */
const ROSTER = JSON.parse(readFileSync(new URL('../../engine/packages/content/data/operators/index.json', import.meta.url), 'utf8')).operators;

/** @typedef {import('playwright').Page} Page */
/** A shown node named `name` under one named `parent`. @param {Page} page @param {string} parent @param {string} [name] */
const hot = (page, parent, name = 'hotspot') => page.locator(`#lobby .aue-n[data-name="${parent}"] .aue-n[data-name="${name}"]:visible`).first();
/** A node of the select page by its name. @param {Page} page @param {string} name */
const shown = (page, name) => page.locator(`#lobby .aue-n[data-name="${name}"]:visible`);
/** The save's 常规队. @param {Page} page @returns {Promise<{ high: string[], low: string[] }>} */
const squadOf = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__room.save().squad);

describe('the operator select page', { skip: HAS_SELECT ? false : 'no lobby UI pack with the select page in AUE_ASSETS_DIR' }, () => {
  /** @type {Awaited<ReturnType<typeof startLobby>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;

  before(async () => { stack = await startLobby(); browser = await launch(); });
  after(async () => { await browser?.close(); await stack?.stop(); });

  test('[页面-9] 快捷编队 opens it for its list; filtered by profession, the operators tapped become the list', { timeout: 120000 }, async () => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage(), errors = /** @type {string[]} */ ([]);
    collectErrors(page, errors);
    await page.goto(`http://127.0.0.1:${stack.port}/`);
    await until('the lobby screens', async () => ((await page.evaluate(() => /** @type {any} */ (globalThis).__room.lobby()))?.page === 'entry' ? true : undefined), 30000);
    await page.locator('#boxbtn').click();
    await page.getByRole('button', { name: '随机填满常规队' }).click();
    await page.locator('.squad.ok').waitFor({ timeout: 30000 });
    await page.locator('#boxclose').click();
    const before = await squadOf(page);
    await hot(page, 'btn_formation').click();
    await hot(page, 'btn_high_pri_edit', 'click_area').click();
    const cards = shown(page, 'panel_char_card');
    await cards.first().waitFor({ timeout: 10000 });
    assert.ok(await cards.count() < 60, `only the columns in view are built: ${await cards.count()}`);
    assert.deepEqual((await shown(page, 'label_select_order').allTextContents()).slice(0, 3), ['1', '2', '3'], 'the list first, numbered');
    await page.locator('#lobby .aue-n[data-name="btn_clear"] .aue-n[data-name="panel_hotspot"]:visible').first().click();
    await sleep(300);
    assert.equal(await shown(page, 'panel_selection').count(), 0, '清空选择');
    // 近卫 on the profession bar (its branch list opens; a tap beside it folds it), then two of them
    await shown(page, 'prof_item').nth(1).locator('.aue-n[data-name="hotspot"]').click();
    await shown(page, 'subprof_item').first().waitFor();
    await sleep(300);
    await page.mouse.click(640, 400);
    await sleep(500);
    for (const k of [0, 1]) { await cards.nth(k).click(); await sleep(200); }
    assert.deepEqual(await shown(page, 'label_select_order').allTextContents(), ['1', '2']);
    await page.locator('#lobby .aue-n[data-name="btn_confirm"] .aue-n[data-name="panel_hotspot"]:visible').first().click();
    const after = await until('the list kept', async () => { const q = await squadOf(page); return q.high.length === 2 ? q : undefined; });
    assert.deepEqual(after.high.map((id) => ROSTER[id]?.profession), ['WARRIOR', 'WARRIOR']);
    assert.deepEqual(after.low, before.low.filter((id) => !after.high.includes(id)), 'the other list lets go of the ones chosen');
    await until('back on the squad page', async () => ((await cards.count()) === 0 ? true : undefined));
    assert.deepEqual(errors, []);
  });
});
