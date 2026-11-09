// End to end with a pinned kit (engine ADR 0058, compat 兼容-6): the page's Worker loads 推进之王's kit from the server's
// /k/ route, the arbiter loads it under Node, and the two stay in step with her kit's talents on the field. Skipped
// when the pinned commit is not installed (AUE_KITS_DIR, or the engine's oracle cache). Run with `pnpm run e2e`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { kitDir } from '@icebreaker/server';
import { command, launch, matchesArbiter, openSeat, pastFrame, startStack, until } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUILD = { elite: 2, level: 90, potential: 6, trust: 100, skill: 2, skillLevel: 10, module: 0, moduleLevel: 3 };
const MATCH = { level: 'act1multi_01', difficulty: /** @type {const} */ ('NORMAL'), seed: 11, decks: [[{ id: 'char_112_siege', build: BUILD }]] };
const DEPLOY = { type: 'deploy', op: 'char_112_siege#0', row: 4, col: 5, dir: 2 };

describe('a kit in the browser', { skip: kitDir(ROOT) === null ? 'the pinned commit is not installed' : false }, () => {
  /** @type {Awaited<ReturnType<typeof startStack>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {Awaited<ReturnType<typeof openSeat>>} */ let seat;

  before(async () => { stack = await startStack(MATCH); browser = await launch(); });
  after(async () => {
    await seat?.context.close().catch(() => {});
    await browser?.close();
    await stack?.stop();
  });

  test('both sides run her kit: her talents on the field, the page in step with the arbiter', async () => {
    seat = await openSeat(browser, stack.port, 0);
    await pastFrame(seat.page, 10);
    const world = stack.room.host.world;
    const siege = () => world.units.find((u) => u.key === 'char_112_siege#0');
    await until('her deployment', async () => { if (siege()) return true; await command(seat.page, DEPLOY); return undefined; }, 30000);
    const at = world.frame;
    await pastFrame(seat.page, at + 45);
    assert.deepEqual(siege()?.buffs.map((b) => b.key).sort(), ['talent:siege:pioneers', 'talent:siege:self']);
    const { d, theirs } = await matchesArbiter(seat.page, stack.room);
    assert.equal(d.hash, theirs, `hash at frame ${d.frame}`);
    assert.equal(d.stats.resyncs, 0);
    assert.deepEqual(stack.lines.filter((l) => l.startsWith('desync') || l.startsWith('kits not loaded')), []);
    assert.deepEqual(seat.errors, []);
  });
});
