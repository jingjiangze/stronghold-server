// Two players through the original lobby screens (docs/spec/page.md 页面-6; runs only when AUE_ASSETS_DIR has the lobby
// UI pack): each fills its 常规队 in the box editor, one makes a room on the entry page and the other joins it by the
// code typed into the join box; the guest prepares, the owner opens the stage list and goes on; both confirm the
// stage, pick in turn, choose their lineups, skills and modules and get ready; the countdown and the start play and
// both pages go to the battle of their match. A result left by the battle page shows the finish view, whose 下一步
// leads back. Run with `pnpm run e2e`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, sleep, startLobby, until } from './helpers.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_LOBBY = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'lobby.json'));

/** @typedef {import('playwright').Page} Page */
/** A shown node of the lobby screens: a node named `name` under one named `parent`. @param {Page} page @param {string} parent @param {string} [name] */
const hot = (page, parent, name = 'hotspot') => page.locator(`#lobby .aue-n[data-name="${parent}"] .aue-n[data-name="${name}"]:visible`).first();
/** The room view the page has. @param {Page} page */
const view = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__room.state().view);
/** What the lobby screens show. @param {Page} page */
const lobby = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__room.lobby());

describe('two players through the original lobby screens', { skip: HAS_LOBBY ? false : 'no lobby UI pack in AUE_ASSETS_DIR' }, () => {
  /** @type {Awaited<ReturnType<typeof startLobby>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {{ page: Page, errors: string[] }[]} */ const players = [];

  before(async () => { stack = await startLobby(); browser = await launch(); });
  after(async () => { await browser?.close(); await stack?.stop(); });

  /** A player on the room page's lobby screens with a filled 常规队 (the page's own box editor over them). @param {string} name */
  async function player(name) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage(), errors = /** @type {string[]} */ ([]);
    collectErrors(page, errors);
    await page.goto(`http://127.0.0.1:${stack.port}/`);
    await page.locator('#conn', { hasText: '已连接' }).waitFor();
    await until('the lobby screens', async () => ((await lobby(page))?.page === 'entry' ? true : undefined), 30000);
    await page.locator('#boxbtn').click();
    await page.getByLabel('昵称').fill(name);
    await page.getByLabel('昵称').press('Tab');
    await page.getByRole('button', { name: '随机填满常规队' }).click();
    await page.locator('.squad.ok').waitFor({ timeout: 30000 });
    await page.locator('#boxclose').click();
    return { page, errors };
  }

  /** Waits for a page's room phase. @param {Page} page @param {string[]} phases @param {number} [ms] */
  const phase = (page, phases, ms = 20000) => until(`phase ${phases.join('/')}`, async () => (phases.includes((await view(page))?.phase) ? true : undefined), ms);

  /** The entry page: 组队参加, then 发起！ / 加入！ with the code typed in (房间-1). @param {Page} a @param {Page} b */
  async function enter(a, b) {
    for (const p of [a, b]) await hot(p, 'btn_team_up').click();
    await hot(a, 'btn_strat_room').click();
    const code = await until('a room', async () => (await view(a))?.code, 10000);
    await b.locator('#lobby').getByLabel('房间编号').fill(code);
    await b.locator('#lobby').getByLabel('房间编号').press('Enter');
    await until('joined', async () => ((await view(b))?.code === code ? true : undefined), 10000);
    assert.equal((await lobby(a)).page, 'prepare');
  }

  /** 项目调整 and 项目确认: the guest prepares; the owner looks at the stage list and goes on; both confirm (房间-2). @param {Page} a @param {Page} b */
  async function stage(a, b) {
    await b.locator('#lobby .aue-n[data-name="has_map"]:visible').first().click();
    await until('the guest prepared', async () => ((await view(a))?.prepared ? true : undefined));
    await hot(a, 'root_switch_map').click();
    await until('the stage list', async () => ((await lobby(a)).local.list ? true : undefined));
    assert.ok(await a.locator('#lobby .aue-n[data-name="pnl_selected"]:visible').count() >= 1, 'the current project marked');
    await a.keyboard.press('Escape');
    await until('the list closed', async () => ((await lobby(a)).local.list ? undefined : true));
    await hot(a, 'prepared_avail').click();
    await phase(a, ['confirm']);
    for (const p of [a, b]) await p.locator('#lobby .aue-n[data-name="btn_certain_player"]:visible').first().click();
    await phase(a, ['pick', 'lineup']);
  }

  /** 高顺位干员协调: whoever's turn it is keeps the first card (房间-4). @param {Page[]} pages */
  async function pick(pages) {
    for (let n = 0; n < 60 && (await view(pages[0])).phase === 'pick'; n++) {
      for (const p of pages) {
        const v = await view(p), mine = v.phase === 'pick' && v.picking?.by === v.you;
        if (mine) await p.locator('#lobby .aue-n[data-name="panel_card"] .aue-n[data-name="click_hotspot"]:visible').first().click().catch(() => {});
      }
      await sleep(300);
    }
    await phase(pages[0], ['lineup']);
  }

  /** 组建上场阵容: the lineup, then skills and modules, then the check view (房间-5). @param {Page} p */
  async function lineup(p) {
    await until('the lineup view', async () => ((await p.locator('#lobby .aue-n[data-name="btn_next"] .aue-n[data-name="hot_spot"]:visible').count()) ? true : undefined), 15000);
    await hot(p, 'btn_next', 'hot_spot').click();
    await until('the skill view', async () => ((await lobby(p)).local.sub === 'skill' ? true : undefined));
    await p.locator('#lobby .aue-n[data-name="btn_next"] .aue-n[data-name="hot_spot"]:visible').last().click();
    await until('the check view', async () => ((await lobby(p)).local.sub === 'check' ? true : undefined));
  }

  test('[页面-6] [房间-1] [房间-2] [房间-4] [房间-5] [房间-6] a room on the original screens: entry, stage, confirm, pick, lineup, start', { timeout: 300000 }, async () => {
    players.push(await player('甲'), await player('乙'));
    const pages = players.map((p) => p.page), [a, b] = pages;
    await enter(a, b);
    await stage(a, b);
    await pick(pages);
    for (const p of pages) await lineup(p);
    await until('both lineups', async () => ((await view(a)).lineups.every((/** @type {unknown} */ l) => l) ? true : undefined));
    // 准备就绪 (房间-6): the countdown and the start, then the battle
    for (const p of pages) await p.locator('#lobby .aue-n[data-name="btn_check"] .aue-n[data-name="normal"] .aue-n[data-name="hot_spot"]:visible').first().click();
    for (const p of pages) await p.waitForURL(/\/play\?match=/, { timeout: 30000 });
    for (const p of pages) await p.waitForFunction(() => /** @type {any} */ (globalThis).__battle?.ready(), null, { timeout: 30000 });
    const [battle] = [...stack.battles.live.values()];
    assert.deepEqual((battle.room.host.o.match?.decks ?? []).map((/** @type {unknown[]} */ d) => d.length >= 6 && d.length <= 10), [true, true]);
    for (const p of players) assert.deepEqual(p.errors, []);
  });

  test('[页面-6] a match\'s result left by the battle page: the finish view once, 下一步 to its players, 返回房间 back to the entry page', { timeout: 60000 }, async () => {
    const page = players[0]?.page ?? (await player('丙')).page;
    await page.evaluate(() => sessionStorage.setItem('ice.result', JSON.stringify({ match: 'm', result: 1, level: 'act1multi_01', stamps: [1, 1] })));
    await page.goto(`http://127.0.0.1:${stack.port}/`);
    await until('the finish view', async () => ((await lobby(page))?.page === 'finish' ? true : undefined), 30000);
    await sleep(2500);
    assert.equal(await page.locator('#lobby .aue-n[data-name="star1"]:visible').count() + await page.locator('#lobby .aue-n[data-name="star2"]:visible').count(), 2, 'two stamps, two stars');
    await hot(page, 'btn_next').click();
    // the second part: both players, the rating of two stars (崭露头角), 返回房间
    await page.locator('#lobby .aue-n[data-name="room_btn"]:visible').first().waitFor({ timeout: 10000 });
    await sleep(1500);
    assert.equal(await page.locator('#lobby .aue-n[data-name="type_02"]:visible').count(), 1, 'two stars: 崭露头角');
    await hot(page, 'room_btn').click();
    await until('the room page again', async () => ((await lobby(page))?.page !== 'finish' ? true : undefined));
    assert.equal(await page.evaluate(() => sessionStorage.getItem('ice.result')), null, 'shown once');
  });
});
