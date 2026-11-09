// End to end in a real browser with the original battle UI (the engine's 召唤-4, 界面-23; runs only when AUE_ASSETS_DIR
// has the battle UI pack): 深海色 deployed, her 触手 card comes into the deck with the copies her talent gives; a 触手
// deployed from it stands as her summon and the card shows one copy less. E2E_SHOTS=<dir> keeps a screenshot of each.
// Run with `pnpm run e2e`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { command, launch, openSeat, startStack, until } from './helpers.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_UI = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'ui', 'battle.json'));
const SHOTS = process.env['E2E_SHOTS'] ?? '';
const BUILD = { elite: 1, level: 50, potential: 1, trust: 0, skill: 0, skillLevel: 1 };
const MATCH = { level: 'act1multi_01', difficulty: /** @type {const} */ ('NORMAL'), seed: 7, decks: [[{ id: 'char_110_deepcl', build: BUILD }], [{ id: 'char_123_fang', build: BUILD }]] };
const OWNER = 'char_110_deepcl#0', TENTACLE = 'token_10001_deepcl_tentac#0';

describe('summon cards in the browser', { skip: HAS_UI ? false : 'no battle UI pack in AUE_ASSETS_DIR' }, () => {
  /** @type {Awaited<ReturnType<typeof startStack>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {Awaited<ReturnType<typeof openSeat>>[]} */ const seats = [];

  before(async () => { stack = await startStack(/** @type {any} */ (MATCH)); browser = await launch(); });
  after(async () => {
    for (const s of seats) await s.context.close().catch(() => {});
    await browser?.close();
    await stack?.stop();
  });

  /**
   * Once seat 0 has the cost for a record, the first free tile it fits (the engine's 部署-1; 全部位 on either kind).
   * @param {string} op
   */
  const tileFor = (op) => {
    const host = stack.room.host, c = /** @type {any} */ (host.o.content), d = c.operators[op];
    if (host.world.players[0].cost < d.cost) return undefined;
    const fits = d.position === 'ALL' ? ['MELEE', 'RANGED', 'ALL'] : [d.position, 'ALL'];
    for (let row = 0; row < c.level.height; row++) {
      for (let col = 0; col < c.level.width; col++) {
        const free = !host.world.units.some((/** @type {any} */ u) => u.owner >= 0 && u.x === col && u.y === row);
        if (free && fits.includes(c.level.tiles[row][col].buildable)) return { type: 'deploy', op, row, col, dir: 0 };
      }
    }
    return undefined;
  };

  test('deploy 深海色: her 触手 card with 3 copies; deploy one: her summon on the field, 2 left', { timeout: 120000 }, async () => {
    seats.push(await openSeat(browser, stack.port, 0), await openSeat(browser, stack.port, 1));
    const [{ page, errors }] = seats, host = stack.room.host;
    await until('the battle begun', () => (host.begun ? true : undefined), 20000);
    const count = page.locator('.aue-n[data-name="text_remaining_cnt"]:visible');
    assert.equal(await count.count(), 0, 'no summon card before its owner is on the field');
    await command(page, await until('a tile for 深海色', () => tileFor(OWNER), 40000));
    await until('深海色 on the field', () => (host.world.units.some((/** @type {any} */ u) => u.key === OWNER) ? true : undefined), 10000);
    await until('the 触手 card showing 3', async () => ((await count.count()) === 1 && (await count.innerText()).trim() === '3' ? true : undefined), 10000);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'summon-card.png') });
    await command(page, await until('a tile and the cost for a 触手', () => tileFor(TENTACLE), 40000));
    const owner = host.world.units.find((/** @type {any} */ u) => u.key === OWNER);
    const tentacle = await until('the 触手 on the field', () => host.world.units.find((/** @type {any} */ u) => u.key === TENTACLE), 10000);
    assert.equal(tentacle.summoner, owner?.id, 'her summon');
    await until('the card showing 2', async () => ((await count.innerText()).trim() === '2' ? true : undefined), 10000);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'summon-deployed.png') });
    assert.deepEqual(errors, []);
  });
});
