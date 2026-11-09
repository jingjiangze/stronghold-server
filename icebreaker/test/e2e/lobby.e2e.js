// Two players through the room page (docs/spec/room.md): each fills a 常规队 in its box, one makes a room and the other
// joins it by its code, they confirm the project, coordinate shared operators, set their lineups and get ready; both
// pages go to the battle of their match, in step with its arbiter. With E2E_FULL=1 the bots play the match to its end
// at 2× (a few minutes): both pages say it ended and lead back to the room, which is at 项目调整 again (房间-6). With the
// assets' room atlas the styles carry the activity's icons (docs/spec/page.md 页面-5).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, command, launch, sleep, startLobby, until } from './helpers.js';
import { botCommands } from '../../packages/server/test/bots.js';

const FULL = process.env['E2E_FULL'] === '1';
const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_ART = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'room', 'index.json'));

describe('two players through a room into a match', () => {
  /** @type {Awaited<ReturnType<typeof startLobby>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {{ page: import('playwright').Page, errors: string[] }[]} */ const players = [];

  before(async () => { stack = await startLobby(); browser = await launch(); });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  /** A player on the room page with a filled 常规队. @param {string} name */
  async function player(name) {
    const page = await (await browser.newContext()).newPage(), errors = /** @type {string[]} */ ([]);
    collectErrors(page, errors);
    // the page's own HTML room (页面-6: the fallback, also with the assets' lobby screens)
    await page.goto(`http://127.0.0.1:${stack.port}/?html`);
    await page.locator('#conn', { hasText: '已连接' }).waitFor();
    await page.getByLabel('昵称').fill(name);
    await page.getByLabel('昵称').press('Tab');
    await page.getByRole('button', { name: '随机填满常规队' }).click();
    await page.locator('.squad.ok').waitFor({ timeout: 30000 });
    if (HAS_ART) {
      // the styles' icons (页面-5): a small one on each style's button, the chosen one's full card
      await until('the room atlas', () => page.evaluate(() => (/** @type {any} */ (globalThis).__room.art() ? true : undefined)), 10000);
      assert.equal(await page.locator('.styles button img.style-tiny').count(), 5);
      assert.equal(await page.locator('.style-chosen img.style-card').count(), 1);
    }
    return { page, errors };
  }

  /** The room phase a page shows. @param {import('playwright').Page} page @returns {Promise<string>} */
  const phaseOf = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__room.state().view?.phase ?? 'none');

  /** Picks for whichever page's turn it is until the coordination is over (房间-4). */
  async function coordinate() {
    await until('the allocation', async () => (['pick', 'lineup'].includes(await phaseOf(players[0].page)) ? true : undefined), 20000);
    while ((await phaseOf(players[0].page)) === 'pick') {
      for (const p of players) {
        const free = p.page.locator('.ops button:enabled');
        if (await free.count()) await free.first().click();
      }
      await sleep(100);
    }
  }

  test('[房间-1] [房间-2] [房间-4] [房间-5] [房间-6] a room, its project, the allocation, the lineups, and the match in both pages', { timeout: FULL ? 900000 : 180000 }, async () => {
    players.push(await player('甲'), await player('乙'));
    const [a, b] = players;
    await a.page.getByRole('button', { name: '创建房间' }).click();
    const code = await a.page.locator('.code').innerText();
    await b.page.getByLabel('房间编号').fill(await a.page.getByLabel('邀请文字').inputValue());
    await b.page.getByRole('button', { name: '加入房间' }).click();
    await b.page.getByRole('button', { name: '准备参赛' }).click();
    await a.page.getByRole('button', { name: '前往' }).click();
    for (const p of players) await p.page.getByRole('button', { name: '确认参赛' }).click();
    await coordinate();
    for (const p of players) {
      await p.page.getByRole('button', { name: '提交阵容' }).click();
      await p.page.getByRole('button', { name: '准备就绪' }).click();
    }
    for (const p of players) await p.page.waitForURL(/\/play\?match=/, { timeout: 20000 });
    for (const p of players) await p.page.waitForFunction(() => /** @type {any} */ (globalThis).__battle?.ready(), null, { timeout: 30000 });
    const [battle] = [...stack.battles.live.values()], host = battle.room.host;
    assert.equal(code.length, 6);
    assert.deepEqual((host.o.match?.decks ?? []).map((/** @type {unknown[]} */ d) => d.length >= 6 && d.length <= 10), [true, true]);
    for (const p of players) {
      const d = await until('the page to be in step with the arbiter', async () => {
        const x = await p.page.evaluate(() => /** @type {any} */ (globalThis).__battle.debug());
        return x.frame > 30 && host.hashes.get(x.frame) !== undefined ? x : undefined;
      }, 30000);
      assert.equal(d.hash, host.hashes.get(d.frame), `hash at frame ${d.frame}`);
    }
    if (FULL) await playToTheEnd(host);
    assert.deepEqual(stack.lines.filter((l) => l.includes('desync')), []);
    for (const p of players) assert.deepEqual(p.errors, []);
  });

  /** The bots play the match out; both pages say it ended and lead back to the room at 项目调整 (房间-6). @param {any} host */
  async function playToTheEnd(host) {
    for (const p of players) await p.page.evaluate(() => /** @type {any} */ (globalThis).__battle.speed(true));
    let last = -1;
    while (host.world.result < 0) {
      if (host.world.frame - last >= 10) {
        last = host.world.frame;
        for (const [seat, p] of players.entries()) for (const cmd of botCommands(host.world, host.o.content, seat)) await command(p.page, cmd);
      }
      await sleep(100);
    }
    console.log(`room match: result ${host.world.result} at frame ${host.world.frame}; stages passed ${host.world.stage.passed}`);
    for (const p of players) {
      await p.page.locator('#notice', { hasText: '比赛结束' }).waitFor({ timeout: 30000 });
      await p.page.getByRole('link', { name: '返回房间' }).click();
      await until('the room back at 项目调整', async () => ((await phaseOf(p.page)) === 'setup' ? true : undefined), 20000);
    }
  }
});
