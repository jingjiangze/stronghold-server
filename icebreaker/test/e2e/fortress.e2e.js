// 堡垒守御 in two browsers with the original battle UI (房间-13, the engine's 守御-1…守御-6 and 界面-39; runs only when
// AUE_ASSETS_DIR has the battle UI pack): IG-DF-1 with the elite-2 decks and the bots at 2×; the note of a level being
// tested, the wave on the top bar; after the first defence the rest panel and the builders' counted card; each seat's
// 「跳过休整」 through its page ends the rest; the pages stay in step (no desync on the server), without errors. Run with
// `pnpm run e2e`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { command, launch, openSeat, sleep, startStack, until } from './helpers.js';
import { botCommands, STRONG_DECKS } from '../../packages/server/test/bots.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '', SHOTS = process.env['E2E_SHOTS'];
const HAS_UI = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'battle.json'));
/** IG-DF-1 with the elite-2 decks. */
const MATCH = { level: 'act1multi_fortress_rm01', difficulty: /** @type {const} */ ('NORMAL'), seed: 5, decks: STRONG_DECKS };

describe('堡垒守御 in the browser', { skip: HAS_UI ? false : 'no battle UI pack in AUE_ASSETS_DIR' }, () => {
  /** @type {Awaited<ReturnType<typeof startStack>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {Awaited<ReturnType<typeof openSeat>>[]} */ const seats = [];

  before(async () => { stack = await startStack(MATCH); browser = await launch(); });
  after(async () => {
    await Promise.all(seats.map((s) => s.context.close().catch(() => {})));
    await browser?.close();
    await stack?.stop();
  });

  /** A UI node of a page by its name, under another when given. @param {import('playwright').Page} page @param {string} name @param {string} [under] */
  const node = (page, name, under) => page.locator(`${under ? `.aue-n[data-name="${under}"] ` : ''}.aue-n[data-name="${name}"]`).first();

  test('the wave on the top bar; after the first defence the rest, the builders, 「跳过休整」 from both pages', { timeout: 300000 }, async () => {
    seats.push(await openSeat(browser, stack.port, 0), await openSeat(browser, stack.port, 1));
    const [a, b] = seats, host = /** @type {any} */ (stack.room.host);
    for (const s of seats) await s.page.evaluate(() => /** @type {any} */ (globalThis).__battle.speed(true));
    assert.equal(await a.page.locator('#testing').isVisible(), true, 'the note of a level being tested');
    await until('the 堡垒守御 panel', async () => ((await node(a.page, 'fortress').isVisible()) ? true : undefined), 20000);
    assert.equal((await node(a.page, 'waveCnt').innerText()).trim(), '1');
    const waveIn = async (/** @type {string} */ n) => ((await node(a.page, 'waveCnt').innerText()).trim() === n ? true : undefined);
    let last = -1;
    while (host.world.fortress.phase !== 'rest' && host.world.result < 0) {
      if (host.world.frame - last >= 10) {
        last = host.world.frame;
        for (const [seat, s] of seats.entries()) for (const cmd of botCommands(host.world, host.o.content, seat)) await command(s.page, cmd);
      }
      await sleep(100);
    }
    assert.equal(host.world.fortress.phase, 'rest', `the first defence over (result ${host.world.result})`);
    const panel = 'cooperate_battle_ui_resting';
    await until('the rest panel', async () => ((await node(a.page, panel).isVisible()) ? true : undefined), 10000);
    const count = a.page.locator('.aue-n[data-name="text_remaining_cnt"]').filter({ visible: true });
    await until('the builders\' counted card', async () => ((await count.count()) > 0 ? true : undefined), 5000);
    if (SHOTS) await a.page.screenshot({ path: `${SHOTS}/fortress-rest.png` });
    await until('the wave to come on the top bar', () => waveIn('2'), 5000);
    await node(a.page, 'btn_skip_rest', panel).click();
    await until('this seat agreed', () => (host.world.fortress.ready[0] ? true : undefined), 10000);
    await until('the mate sees it', async () => ((await node(b.page, 'panel_skip_right', panel).evaluate((e) => getComputedStyle(e).opacity)) === '1' ? true : undefined), 5000);
    await node(b.page, 'btn_skip_rest', panel).click();
    await until('the next defence', () => (host.world.fortress.phase === 'defend' && host.world.fortress.round === 1 ? true : undefined), 10000);
    await until('the panel gone', async () => ((await node(a.page, panel).isVisible()) ? undefined : true), 5000);
    // the seats report their hashes as they go (同步-5): a page out of step would be a desync on the server
    await sleep(3000);
    assert.deepEqual(stack.lines.filter((l) => l.startsWith('desync')), []);
    assert.deepEqual([a.errors, b.errors], [[], []]);
  });
});
