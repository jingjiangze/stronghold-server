// 快速匹配 (docs/spec/room.md 房间-9, 房间-10): two players with filled 常规队 look for a mate and are paired into a room
// at 项目确认; one leaving dissolves it. On the HTML room, and with the lobby UI pack on the original match page.
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

describe('快速匹配', () => {
  /** @type {Awaited<ReturnType<typeof startLobby>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  before(async () => { stack = await startLobby(); browser = await launch(); });
  after(async () => { await browser?.close(); await stack?.stop(); });

  /** A player with a filled 常规队. @param {string} query @param {string} name */
  async function player(query, name) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage(), errors = /** @type {string[]} */ ([]);
    collectErrors(page, errors);
    await page.goto(`http://127.0.0.1:${stack.port}/${query}`);
    await page.locator('#conn', { hasText: '已连接' }).waitFor();
    if (query === '') {
      await until('the entry page', async () => ((await lobby(page))?.page === 'entry' ? true : undefined), 30000);
      await page.locator('#boxbtn').click();
    }
    await page.getByLabel('昵称').fill(name);
    await page.getByLabel('昵称').press('Tab');
    await page.getByRole('button', { name: '随机填满常规队' }).click();
    await page.locator('.squad.ok').waitFor({ timeout: 30000 });
    if (query === '') await page.locator('#boxclose').click();
    return { page, errors };
  }

  test('[房间-9] [房间-10] on the HTML room: both look, are paired at 项目确认; one leaving dissolves the room', async () => {
    const [a, b] = [await player('?html', '甲'), await player('?html', '乙')];
    await a.page.getByRole('button', { name: '开始匹配' }).click();
    await a.page.getByRole('button', { name: '取消匹配' }).waitFor({ timeout: 5000 });
    await b.page.getByRole('button', { name: '开始匹配' }).click();
    const v = await until('paired', async () => { const x = await view(b.page); return x?.matched ? x : undefined; }, 10000);
    assert.deepEqual([v.phase, v.you, v.members.map((/** @type {any} */ m) => m.name)], ['confirm', 1, ['甲', '乙']], 'the one who waited longer is the host');
    await b.page.getByRole('button', { name: '解散房间' }).click();
    await until('dissolved for both', async () => ((await view(a.page)) === null ? true : undefined), 5000);
    for (const p of [a, b]) assert.deepEqual(p.errors, []);
  });

  test('[房间-9] on the lobby screens: 快速匹配 opens the match page; both start, the banner, then the room at 项目确认', { skip: HAS_LOBBY ? false : 'no lobby UI pack in AUE_ASSETS_DIR' }, async () => {
    const [a, b] = [await player('', '丙'), await player('', '丁')];
    for (const p of [a, b]) {
      await hot(p.page, 'btn_match').click();
      await until('the match page', async () => ((await lobby(p.page))?.page === 'match' ? true : undefined), 10000);
    }
    assert.equal(await a.page.locator('#lobby .aue-n[data-name="mode_group_item"]:visible').count(), 3, 'the three modes\' cards');
    await hot(a.page, 'btn_start_match', 'click_area').click();
    await until('the matching banner', async () => ((await a.page.evaluate(() => /** @type {any} */ (globalThis).__room.state().seeking)) ? true : undefined), 5000);
    await hot(b.page, 'btn_start_match', 'click_area').click();
    for (const p of [a, b]) await until('the room at 项目确认', async () => ((await lobby(p.page))?.page === 'prepare' && (await view(p.page))?.phase === 'confirm' ? true : undefined), 15000);
    assert.equal((await view(a.page)).matched, true);
    for (const p of [a, b]) assert.deepEqual(p.errors, []);
  });
});
