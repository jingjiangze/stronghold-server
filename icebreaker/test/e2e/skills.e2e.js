// End to end in a real browser: a seat deploys 米格鲁 (a MANUAL skill); its row shows in the operator bar with a
// disabled skill button and SP going up; at 45 SP the button is enabled, and clicking it starts the skill; its retreat
// button takes it off the field. Run with `pnpm run e2e`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openSeat, pastFrame, startStack, until } from './helpers.js';

describe('the skill bar in the browser', () => {
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

  test('a deployed 米格鲁 shows its SP and a disabled skill button; at full SP the button starts the skill', { timeout: 120000 }, async () => {
    seat = await openSeat(browser, stack.port, 0, { query: 'bars' });
    // the battle begins once both pages have loaded (the engine's 同步-11)
    mate = await openSeat(browser, stack.port, 1, { query: 'bars' });
    const { page } = seat;
    await pastFrame(page, 30);
    // a tile where melee operators can stand
    const tile = await page.evaluate(async () => {
      // the page serves its packages under /m/; the module is read there, not from this package
      const url = '/m/@aue/content/src/index.js';
      const { skeletonContent } = await import(url);
      /** @type {{ row: number, col: number } | null} */
      let found = null;
      skeletonContent.level.tiles.forEach((/** @type {{ buildable: string }[]} */ cells, /** @type {number} */ row) => cells.forEach((c, col) => {
        if (!found && (c.buildable === 'MELEE' || c.buildable === 'ALL')) found = { row, col };
      }));
      return /** @type {{ row: number, col: number } | null} */ (found);
    });
    assert.ok(tile, 'the level has a melee tile');
    assert.equal(await page.locator('#skills .skill').count(), 0, 'no skill row before the deploy');

    // the start cost is 10 and 米格鲁 costs 16: wait for it, then deploy
    await until('cost 16', async () => {
      const m = /费用 (\d+)/.exec(await page.locator('#hud .player.me').innerText());
      return m && Number(m[1]) >= 16 ? true : undefined;
    }, 20000);
    await page.evaluate((t) => /** @type {any} */ (globalThis).__battle.command({ type: 'deploy', op: 'char_122_beagle#0', row: t.row, col: t.col, dir: 0 }), tile);

    const row = page.locator('#skills .skill');
    await row.waitFor({ timeout: 15000 });
    assert.equal(await row.count(), 1);
    assert.equal(await row.locator('.name').innerText(), '米格鲁');
    const button = row.getByRole('button', { name: '发动技能' });
    assert.equal(await button.isDisabled(), true, 'not enough SP to start');

    /** @returns {Promise<number>} */
    const sp = async () => Number(/技力 (\d+) \/ 45/.exec(await row.locator('.text').innerText())?.[1] ?? NaN);
    const first = await until('the SP text', async () => { const v = await sp(); return Number.isNaN(v) ? undefined : v; });
    const later = await until('SP going up', async () => { const v = await sp(); return v > first ? v : undefined; }, 15000);
    assert.ok(later > first);
    assert.match(await row.locator('.fill').evaluate((el) => /** @type {HTMLElement} */ (el).style.width), /^\d+(\.\d+)?%$/);
    assert.equal(await button.isDisabled(), true);

    // 45 SP at 1 SP a second: the button turns on, and a click starts the skill through the server
    await until('the button enabled', async () => ((await button.isDisabled()) ? undefined : true), 70000);
    await button.click();
    await until('the skill running', async () => (/运行中/.test(await row.locator('.text').innerText()) ? true : undefined), 10000);
    assert.equal(await button.isDisabled(), true, 'running: it cannot start again');

    // the row's retreat button takes 米格鲁 off the field through the server
    await row.getByRole('button', { name: '撤退' }).click();
    await until('米格鲁 gone from the arbiter', () => (stack.room.host.world.units.some((u) => u.key === 'char_122_beagle#0') ? undefined : true), 10000);
    await until('the row gone', async () => ((await page.locator('#skills .skill').count()) === 0 ? true : undefined), 10000);
    assert.deepEqual(seat.errors, []);
  });
});
