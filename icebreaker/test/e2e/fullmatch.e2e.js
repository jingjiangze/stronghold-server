// A whole match in two browsers (run with E2E_FULL=1; it takes a few minutes): two seat pages play the level with the
// elite-2 six-star decks through the real server, workers and renderer, both at 2×. The bots (packages/server/test/
// bots.js) decide from the arbiter's world and act through each page's command. The match must pass its first stage
// and end with a result, with no desync and no page error, both pages in step with the arbiter and saying how it
// ended. With E2E_SHOTS set to a directory, each page is screenshot at every stage and at the end.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { command, launch, matchesArbiter, openSeat, sleep, startStack, until } from './helpers.js';
import { DEFAULT_MATCH } from '@icebreaker/server';
import { botCommands, STRONG_DECKS } from '../../packages/server/test/bots.js';

const FULL = process.env['E2E_FULL'] === '1', SHOTS = process.env['E2E_SHOTS'];

describe('a whole match in the browser', { skip: FULL ? false : 'E2E_FULL is not 1' }, () => {
  /** @type {Awaited<ReturnType<typeof startStack>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {Awaited<ReturnType<typeof openSeat>>[]} */ const seats = [];

  before(async () => { stack = await startStack({ ...DEFAULT_MATCH, decks: STRONG_DECKS }); browser = await launch(); });
  after(async () => {
    await Promise.all(seats.map((s) => s.context.close().catch(() => {})));
    await browser?.close();
    await stack?.stop();
  });

  /** Both pages' screenshots, named by the moment. @param {string} name */
  const shoot = async (name) => { if (SHOTS) await Promise.all(seats.map((s, i) => s.page.screenshot({ path: `${SHOTS}/${name}-seat${i}.png` }))); };

  /** One round of the bots: each seat's commands from the arbiter's world, sent from its page. */
  const botRound = async () => {
    const w = stack.room.host.world, c = /** @type {Parameters<typeof botCommands>[1]} */ (stack.room.host.o.content);
    for (const [seat, s] of seats.entries()) for (const cmd of botCommands(w, c, seat)) await command(s.page, cmd);
  };

  test('two seats play both stages to the end in step', { timeout: 900000 }, async () => {
    seats.push(await openSeat(browser, stack.port, 0), await openSeat(browser, stack.port, 1));
    for (const s of seats) await s.page.evaluate(() => /** @type {any} */ (globalThis).__battle.speed(true));
    let stage = -1, last = -1;
    while (stack.room.host.world.result < 0) {
      const w = stack.room.host.world;
      if (w.stage.index !== stage) { stage = w.stage.index; await sleep(3000); await shoot(`stage${stage + 1}`); }
      if (w.frame - last >= 10) { last = w.frame; await botRound(); }
      await sleep(100);
    }
    const w = stack.room.host.world;
    assert.ok(w.stage.passed >= 1, `the first stage is passed (passed ${w.stage.passed}, result ${w.result})`);
    for (const s of seats) {
      const { d, theirs } = await matchesArbiter(s.page, stack.room);
      assert.equal(d.hash, theirs, `hash at frame ${d.frame}`);
      await until('the page to say how the match ended', async () => ((await s.page.locator('#hud').innerText()).includes(w.result === 1 ? '比赛胜利' : '比赛结束') ? true : undefined));
    }
    await shoot('end');
    assert.deepEqual(stack.lines.filter((l) => l.startsWith('desync')), []);
    for (const s of seats) assert.deepEqual(s.errors, []);
    console.log(`whole match: result ${w.result} at frame ${w.frame}; stages passed ${w.stage.passed}; stamps ${w.stage.stamps}`);
  });
});
