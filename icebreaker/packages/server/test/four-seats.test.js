// 四人房（房间-1、房间-4、房间-5，这个 fork 的人数扩展）：一个房间收四个座位，争议干员由四人轮流选，
// 每人一份阵容；两座位的房间保持原样（第三人仍被拒）。
// 上游的合作是两人，所以「两座行为不变」本身就是要守住的东西。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRooms } from '../src/index.js';
import { entry, squadOf } from './fixtures.js';

const RECRUITS = [50, 51, 52, 53, 54].map((n) => entry(n, { skills: [10], modules: [] }));

/** A rooms instance of `seats` seats on a hand clock. @param {number} seats */
function rig(seats) {
  const t = { now: 0 }, got = /** @type {Map<number, any[]>} */ (new Map()), started = /** @type {any[]} */ ([]);
  let r = 0.37;
  const rooms = createRooms({
    now: () => t.now, random: () => { r = (r * 9301 + 0.49297) % 1; return r; },
    send: (id, msg) => { if (!got.has(id)) got.set(id, []); /** @type {any[]} */ (got.get(id)).push(msg); },
    startMatch: (match, keys) => { started.push({ match, keys }); return `m${started.length}`; },
    projects: [{ level: 'act1multi_01', difficulty: 'NORMAL' }], recruits: RECRUITS, seats,
  });
  const last = (/** @type {number} */ id, /** @type {string} */ type) => (got.get(id) ?? []).filter((m) => m.t === type).at(-1);
  const fails = (/** @type {number} */ id) => (got.get(id) ?? []).filter((m) => m.t === 'error').map((m) => m.msg);
  return { t, rooms, got, started, last, fails };
}

const settle = () => new Promise((r) => setImmediate(r));

/** Four sessions in one room, all prepared, the host gone on to 项目确认. @param {ReturnType<typeof rig>} g */
function fourConfirming(g) {
  for (let i = 1; i <= 4; i++) g.rooms.hello(i, `k${i}`, `P${i}`);
  g.rooms.message(1, { t: 'create' });
  const code = g.last(1, 'room').code;
  for (let i = 2; i <= 4; i++) g.rooms.message(i, { t: 'join', code });
  for (let i = 2; i <= 4; i++) g.rooms.message(i, { t: 'prepare', on: true });
  g.rooms.message(1, { t: 'go' });
  return code;
}

test('[房间-1] a four-seat room takes four and refuses the fifth; a two-seat room still refuses the third', () => {
  const g = rig(4);
  const code = fourConfirming(g);
  assert.equal(g.last(1, 'room').members.length, 4);
  assert.deepEqual(g.last(1, 'room').ready, [false, false, false, false]);
  g.rooms.hello(5, 'k5', 'P5');
  g.rooms.message(5, { t: 'join', code });
  assert.ok(g.fails(5).some((m) => m.includes('房间已满')), 'fifth refused');

  const two = rig(2);
  two.rooms.hello(1, 'a', 'A');
  two.rooms.hello(2, 'b', 'B');
  two.rooms.hello(3, 'c', 'C');
  two.rooms.message(1, { t: 'create' });
  const c2 = two.last(1, 'room').code;
  two.rooms.message(2, { t: 'join', code: c2 });
  two.rooms.message(3, { t: 'join', code: c2 });
  assert.equal(two.last(1, 'room').members.length, 2, 'unchanged with two seats');
  assert.ok(two.fails(3).some((m) => m.includes('房间已满')));
});

test('[房间-2] four seats: 准备参赛 is every seat but the host, and the host goes on only then', () => {
  const g = rig(4);
  for (let i = 1; i <= 4; i++) g.rooms.hello(i, `k${i}`, `P${i}`);
  g.rooms.message(1, { t: 'create' });
  const code = g.last(1, 'room').code;
  for (let i = 2; i <= 4; i++) g.rooms.message(i, { t: 'join', code });
  g.rooms.message(2, { t: 'prepare', on: true });
  g.rooms.message(3, { t: 'prepare', on: true });
  assert.equal(g.last(1, 'room').prepared, false, 'one of three still missing');
  g.rooms.message(1, { t: 'go' });
  assert.equal(g.last(1, 'room').phase, 'setup', 'the host cannot go on yet');
  g.rooms.message(4, { t: 'prepare', on: true });
  assert.equal(g.last(1, 'room').prepared, true);
  g.rooms.message(1, { t: 'go' });
  assert.equal(g.last(1, 'room').phase, 'confirm');
});

/** Picks every contested operator in turn, whoever's turn it is, until the room leaves 挑选. @param {ReturnType<typeof rig>} g */
function drainPicks(g) {
  for (let guard = 0; guard < 80 && g.last(1, 'room').phase === 'pick'; guard++) {
    const v = g.last(1, 'room'), by = v.picking?.by, left = v.picking?.left ?? [];
    if (by === undefined || left.length === 0) return;
    g.rooms.message(by + 1, { t: 'pick', id: left[0] });
  }
}

test('[房间-4] [房间-5] four seats: contested operators are picked in turns, each seat fields its own lineup, the match has four decks', async () => {
  const g = rig(4);
  fourConfirming(g);
  const squads = [squadOf(10, 10, 0), squadOf(10, 10, 5), squadOf(10, 10, 10), squadOf(10, 10, 15)];
  for (let i = 1; i <= 4; i++) g.rooms.message(i, { t: 'confirm', squad: squads[i - 1], style: 'buff_1' });
  assert.ok(['pick', 'lineup'].includes(g.last(1, 'room').phase));

  drainPicks(g);
  const v = g.last(1, 'room');
  assert.equal(v.phase, 'lineup');
  assert.equal(v.options.length, 4, 'one option set per seat');

  // 每个座位从自己那份 options 里取 6 个（LINEUP.min）
  for (let seat = 0; seat < 4; seat++) {
    const o = v.options[seat];
    const ids = [...o.kept, ...o.drawn, ...o.extra].slice(0, 6);
    assert.equal(ids.length, 6, `seat ${seat} has enough to field`);
    g.rooms.message(seat + 1, { t: 'lineup', lineup: ids.map((id) => ({ id, skill: -1, module: -1 })) });
    assert.deepEqual(g.fails(seat + 1), [], `seat ${seat} lineup accepted (a contested operator picked from another seat's squad still fields)`);
  }
  assert.deepEqual(g.last(1, 'room').lineups.map((/** @type {any[] | null} */ l) => (l ? l.length : null)), [6, 6, 6, 6]);

  for (let i = 1; i <= 4; i++) g.rooms.message(i, { t: 'ready', on: true });
  await settle();
  assert.equal(g.started.length, 1, 'the match starts once every seat is ready');
  assert.equal(g.started[0].match.decks.length, 4);
  assert.equal(g.started[0].match.runes.length, 4);
  assert.equal(g.started[0].keys.length, 4);
});
