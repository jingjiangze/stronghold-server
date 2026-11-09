// 互选模式 (docs/spec/room.md 房间-8): on the page's HTML room the host's switch turns it on for both and its hint shows;
// with the lobby UI pack the host's mode toggle on the stage panel does it and both stage panels show its highlight.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, startLobby, until } from './helpers.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_LOBBY = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'lobby.json'));

/** @typedef {import('playwright').Page} Page */
/** @param {Page} page */
const view = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__room.state().view);
/** @param {Page} page */
const lobby = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__room.lobby());
/** A shown node named `name` under one named `parent`. @param {Page} page @param {string} parent @param {string} [name] */
const hot = (page, parent, name = 'hotspot') => page.locator(`#lobby .aue-n[data-name="${parent}"] .aue-n[data-name="${name}"]:visible`).first();

describe('互选模式 in the room', () => {
  /** @type {Awaited<ReturnType<typeof startLobby>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  before(async () => { stack = await startLobby(); browser = await launch(); });
  after(async () => { await browser?.close(); await stack?.stop(); });

  /** @param {string} query */
  async function player(query) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage(), errors = /** @type {string[]} */ ([]);
    collectErrors(page, errors);
    await page.goto(`http://127.0.0.1:${stack.port}/${query}`);
    await page.locator('#conn', { hasText: '已连接' }).waitFor();
    return { page, errors };
  }

  test('[房间-8] on the HTML room: the host turns it on, the guest sees it and its 准备参赛 is undone', async () => {
    const [a, b] = [await player('?html'), await player('?html')];
    await a.page.getByRole('button', { name: '创建房间' }).click();
    const code = await until('a room', async () => (await view(a.page))?.code, 10000);
    await b.page.getByLabel('房间编号').fill(code);
    await b.page.getByRole('button', { name: '加入房间' }).click();
    await until('joined', async () => ((await view(a.page))?.members.length === 2 ? true : undefined), 10000);
    await b.page.getByRole('button', { name: '准备参赛' }).click();
    await until('prepared', async () => ((await view(a.page))?.prepared ? true : undefined));
    assert.equal(await b.page.getByLabel('互选模式').isDisabled(), true, 'only the host turns it');
    await a.page.getByLabel('互选模式').check();
    await b.page.locator('.inverse.on', { hasText: '交换编队及比赛风格' }).waitFor({ timeout: 5000 });
    assert.deepEqual([(await view(b.page)).inverse, (await view(b.page)).prepared], [true, false]);
    for (const p of [a, b]) assert.deepEqual(p.errors, []);
  });

  test('[房间-8] on the lobby screens: the owner\'s mode toggle, the highlight on both stage panels', { skip: HAS_LOBBY ? false : 'no lobby UI pack in AUE_ASSETS_DIR' }, async () => {
    const [a, b] = [await player(''), await player('')];
    for (const p of [a, b]) await until('the entry page', async () => ((await lobby(p.page))?.page === 'entry' ? true : undefined), 30000);
    for (const p of [a, b]) await hot(p.page, 'btn_team_up').click();
    await hot(a.page, 'btn_strat_room').click();
    const code = await until('a room', async () => (await view(a.page))?.code, 10000);
    await b.page.locator('#lobby').getByLabel('房间编号').fill(code);
    await b.page.locator('#lobby').getByLabel('房间编号').press('Enter');
    await until('joined', async () => ((await view(a.page))?.members.length === 2 ? true : undefined), 10000);
    const highlight = (/** @type {Page} */ p) => p.locator('#lobby .aue-n[data-name="group_top_deco"] .aue-n[data-name="group_invert"]:visible').count();
    assert.equal(await highlight(a.page), 0, 'off at first');
    await hot(a.page, 'act_multi_v3_reverse_mode_toggle').click();
    await until('on for both', async () => ((await view(b.page))?.inverse ? true : undefined), 5000);
    for (const p of [a, b]) await until('the highlight', async () => ((await highlight(p.page)) > 0 ? true : undefined), 5000);
    assert.ok(await b.page.locator('#lobby .aue-n[data-name="text_tip"]:visible', { hasText: '交换编队及比赛风格' }).count() >= 1, 'its hint');
    await hot(a.page, 'act_multi_v3_reverse_mode_toggle').click();
    await until('off again', async () => ((await view(b.page))?.inverse === false ? true : undefined), 5000);
    for (const p of [a, b]) assert.deepEqual(p.errors, []);
  });
});
