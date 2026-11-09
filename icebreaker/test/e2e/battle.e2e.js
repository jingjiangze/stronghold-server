// End to end in a real browser: two seat pages play one battle through the real server and stay in step with the
// arbiter; a reload rejoins its seat; another key cannot take a taken seat. Run with `pnpm run e2e`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { command, DEPLOY, debugOf, launch, matchesArbiter, openSeat, pastFrame, sleep, startStack, until } from './helpers.js';

/** @typedef {Awaited<ReturnType<typeof openSeat>>} Seat */

describe('battle in the browser', () => {
  /** @type {Awaited<ReturnType<typeof startStack>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {Seat[]} */ const seats = [];

  /** @param {number} n @param {{ started?: boolean }} [o] */
  const open = async (n, o) => { const s = await openSeat(browser, stack.port, n, o); seats.push(s); return s; };
  /** @param {number} owner */
  const hasOperator = (owner) => stack.room.host.world.units.some((u) => u.kind === 0 && u.owner === owner);
  /** @param {Seat} s */
  const inStep = async (s) => {
    const { d, theirs } = await matchesArbiter(s.page, stack.room);
    assert.equal(d.hash, theirs, `hash at frame ${d.frame}`);
    assert.equal(d.stats.resyncs, 0);
  };
  const noProblems = () => {
    assert.deepEqual(stack.lines.filter((l) => l.startsWith('desync')), []);
    for (const s of seats) assert.deepEqual(s.errors, []);
  };

  before(async () => { stack = await startStack(); browser = await launch(); });
  after(async () => {
    await Promise.all(seats.map((s) => s.context.close().catch(() => {})));
    await browser?.close();
    await stack?.stop();
  });

  test('two seats play in step, and a reload rejoins its seat', async () => {
    const a = await open(0), b = await open(1);
    await Promise.all([pastFrame(a.page, 30), pastFrame(b.page, 30)]);
    await command(a.page, DEPLOY[0]);
    await command(b.page, DEPLOY[1]);
    await until('both operators in the arbiter world', () => (hasOperator(0) && hasOperator(1) ? true : undefined));
    await inStep(a);
    await inStep(b);
    noProblems();

    // b reloads: same session key, same seat, plays on in step
    const frame = (await debugOf(b.page)).frame;
    await b.page.reload();
    await pastFrame(b.page, frame);
    await inStep(b);
    assert.ok(hasOperator(1), 'seat 1 keeps its operator');
    assert.ok(hasOperator(0), 'seat 0 keeps its operator');
    noProblems();
  });

  test('another key cannot take a taken seat', async () => {
    // seat 0 is already bound to the first test's key
    const owner = seats[0];
    assert.ok(owner, 'the first test opened seat 0');
    const thief = await open(0, { started: true });
    const at = (await debugOf(owner.page)).frame;
    await sleep(2000);
    assert.equal((await debugOf(thief.page)).frame, -1, 'the thief never gets a world');
    await pastFrame(owner.page, at + 30);
    assert.deepEqual(owner.errors, []);
  });
});
