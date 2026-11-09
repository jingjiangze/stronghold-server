// Operator allocation (docs/spec/room.md 房间-4, 房间-5): coordination of shared operators, the picking turns, the
// operators each seat may field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinate, pick, handOver, offer } from '../src/index.js';
import { entry } from './fixtures.js';

/** Random numbers from a list, repeating. @param {number[]} xs */
const seq = (xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const ids = (/** @type {number[]} */ ns) => ns.map((n) => entry(n).id);

test('[房间-4] one side high, the other low: the high side keeps it, the low pool loses it; both low: dealt to one side', () => {
  const a = { high: [entry(1), entry(2)], low: [entry(3), entry(4)] }, b = { high: [entry(3)], low: [entry(1), entry(4), entry(5)] };
  const c = coordinate([a, b], seq([0.2]));
  assert.deepEqual(c.kept, [ids([1, 2]), ids([3])]);
  assert.equal(c.picking, null, 'no contested high: no picking');
  assert.deepEqual(c.pools[0], [], 'a lost 3 to b\'s high, and 4 to the draw (0.2: seat 0 loses it)');
  assert.deepEqual(c.pools[1], ids([4, 5]), 'b lost 1 to a\'s high, kept 4');
});

test('[房间-4] both high: picked in turns, first-second-second-first, the first at random; a pick awards it to the picker', () => {
  const a = { high: [entry(1), entry(2), entry(3), entry(4), entry(5)], low: [] }, b = { high: [entry(5), entry(4), entry(3), entry(2), entry(1)], low: [] };
  let p = /** @type {any} */ (coordinate([a, b], seq([0.7])).picking);
  assert.equal(p.first, 1);
  const order = [];
  for (const id of ids([1, 2, 3, 4, 5])) { order.push(p.by); p = pick(p, p.by, id); }
  assert.deepEqual(order, [1, 0, 0, 1, 1]);
  assert.deepEqual(p.won, [ids([2, 3]), ids([1, 4, 5])]);
  assert.equal(pick(p, 0, entry(9).id), null, 'nothing left');
});

test('[房间-4] a turn may be handed over with 2 or more left, not a turn that was handed over; only the picker picks', () => {
  const both = { high: [entry(1), entry(2)], low: [] };
  let p = /** @type {any} */ (coordinate([both, both], seq([0.2])).picking);
  assert.equal(p.by, 0);
  assert.equal(pick(p, 1, entry(1).id), null, 'not seat 1\'s turn');
  p = handOver(p, 0);
  assert.deepEqual([p.by, p.yielded], [1, true]);
  assert.equal(handOver(p, 1), null, 'a handed turn cannot be handed back');
  p = pick(p, 1, entry(1).id);
  assert.equal(handOver(p, p.by), null, 'one left: no handing over');
});

test('[房间-5] what a seat may field: half its pool drawn, then 2–6 more with at least 2 temporary recruits', () => {
  const pool = ids([1, 2, 3, 4, 5, 6, 7]), recruits = ids([50, 51, 52, 53, 54]);
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const o = offer(pool, recruits, seq([r, 0.5, 0.1, 0.9]));
    assert.equal(o.drawn.length, 3, 'half of 7, rounded down');
    assert.ok(o.drawn.every((x) => pool.includes(x)));
    assert.ok(o.extra.length >= 2 && o.extra.length <= 6, `${o.extra.length}`);
    assert.ok(o.extra.filter((x) => recruits.includes(x)).length >= 2, 'at least 2 recruits');
    assert.ok(o.extra.every((x) => !o.drawn.includes(x)), 'none twice');
  }
  assert.equal(offer(pool, recruits, seq([0.999])).extra.length, 6);
  assert.equal(offer(pool, recruits, seq([0])).extra.length, 2);
});
