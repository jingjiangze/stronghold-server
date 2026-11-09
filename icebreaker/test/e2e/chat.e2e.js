// 表情交流 (docs/spec/room.md 房间-7): two players in a room at 项目调整. With the lobby UI pack and the emote art, one opens
// the emote panel from the side view's chat button, switches to the second theme and sends an emote: the panel closes,
// the button is covered for the cooldown and both pages show the bubble by the sender's side. On the page's own HTML
// room, the other player's emote shows by its name.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, startLobby, until } from './helpers.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_CHAT = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'lobby.json')) && existsSync(join(ASSETS, 'skeleton', 'ui', 'emoticons', 'index.json'));

/** @typedef {import('playwright').Page} Page */
/** A shown node named `name` under one named `parent`. @param {Page} page @param {string} parent @param {string} [name] */
const hot = (page, parent, name = 'hotspot') => page.locator(`#lobby .aue-n[data-name="${parent}"] .aue-n[data-name="${name}"]:visible`).first();
/** @param {Page} page */
const view = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__room.state().view);
/** @param {Page} page */
const lobby = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__room.lobby());

describe('emotes in the room', () => {
  /** @type {Awaited<ReturnType<typeof startLobby>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  before(async () => { stack = await startLobby(); browser = await launch(); });
  after(async () => { await browser?.close(); await stack?.stop(); });

  /** A player on the room page (`query`: ?html for the HTML room). @param {string} query */
  async function player(query) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage(), errors = /** @type {string[]} */ ([]);
    collectErrors(page, errors);
    await page.goto(`http://127.0.0.1:${stack.port}/${query}`);
    await page.locator('#conn', { hasText: '已连接' }).waitFor();
    return { page, errors };
  }

  test('[房间-7] on the lobby screens: the panel from the chat button, a theme, an emote by the sender\'s side on both pages', { skip: HAS_CHAT ? false : 'no lobby UI pack or emote art in AUE_ASSETS_DIR' }, async () => {
    const [a, b] = [await player(''), await player('')];
    for (const p of [a, b]) await until('the entry page', async () => ((await lobby(p.page))?.page === 'entry' ? true : undefined), 30000);
    for (const p of [a, b]) await hot(p.page, 'btn_team_up').click();
    await hot(a.page, 'btn_strat_room').click();
    const code = await until('a room', async () => (await view(a.page))?.code, 10000);
    await b.page.locator('#lobby').getByLabel('房间编号').fill(code);
    await b.page.locator('#lobby').getByLabel('房间编号').press('Enter');
    await until('joined', async () => ((await view(a.page))?.members.length === 2 ? true : undefined), 10000);
    await until('the chat at 项目调整', async () => ((await lobby(a.page))?.chat?.scene === 'room' ? true : undefined));
    await hot(a.page, 'btn_chat').click();
    await until('the panel', async () => ((await lobby(a.page)).chat.open ? true : undefined));
    // the panel opens with its clip, from nothing: the items show from its next frame on
    const items = a.page.locator('#lobby .aue-n[data-name="multiv3_emoji_item"]:visible');
    await until('the room emotes of a theme', async () => ((await items.count()) === 10 ? true : undefined), 3000);
    await hot(a.page, 'right_arrow').click();
    await until('the second theme', async () => ((await lobby(a.page)).chat.theme === 'emoticon_originium_slug' ? true : undefined));
    await hot(a.page, 'multiv3_emoji_item').click();
    const mask = a.page.locator('#lobby .aue-n[data-name="btn_chat"] .aue-n[data-name="mask"]:visible');
    await until('the button covered for the cooldown', async () => ((await mask.count()) >= 1 ? true : undefined), 900);
    await until('the panel closed', async () => ((await lobby(a.page)).chat.open ? undefined : true));
    for (const p of [a, b]) await until('the host\'s bubble', async () => ((await lobby(p.page)).chat.bubbles[0] ? true : undefined), 5000);
    await until('the cover gone after the cooldown', async () => ((await mask.count()) === 0 ? true : undefined), 2000);
    await until('the bubble gone after its time', async () => ((await lobby(b.page)).chat.bubbles[0] ? undefined : true), 6000);
    for (const p of [a, b]) assert.deepEqual(p.errors, []);
  });

  test('[房间-7] on the HTML room: the other player\'s emote shows by its name', async () => {
    const [a, b] = [await player('?html'), await player('?html')];
    await a.page.getByRole('button', { name: '创建房间' }).click();
    const code = await until('a room', async () => (await view(a.page))?.code, 10000);
    await b.page.getByLabel('房间编号').fill(code);
    await b.page.getByRole('button', { name: '加入房间' }).click();
    await until('joined', async () => ((await view(a.page))?.members.length === 2 ? true : undefined), 10000);
    await b.page.getByRole('button', { name: '你好！' }).click();
    await a.page.locator('.members .emote', { hasText: '你好！' }).waitFor({ timeout: 5000 });
    assert.equal(await b.page.getByRole('button', { name: '你好！' }).isDisabled(), true, 'held for the cooldown');
    for (const p of [a, b]) assert.deepEqual(p.errors, []);
  });
});
