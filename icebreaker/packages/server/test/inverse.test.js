// 互选模式 (docs/spec/room.md 房间-8): the host turns it on at 项目调整, which undoes the guest's 准备参赛; with it on, the
// match gives each seat the other's lineup and style; it stays on for the next match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INVERSE, styleRunes } from '@icebreaker/mode-regular';
import { createRooms, lobbyMessageProblem } from '../src/index.js';
import { entry, squadOf } from './fixtures.js';

/** Two sessions in one room on a hand clock, what each got and the matches started. */
function rig() {
  const t = { now: 0 }, got = /** @type {Map<number, any[]>} */ (new Map()), started = /** @type {any[]} */ ([]);
  const rooms = createRooms({
    now: () => t.now, random: () => 0.5,
    send: (id, msg) => { if (!got.has(id)) got.set(id, []); /** @type {any[]} */ (got.get(id)).push(msg); },
    startMatch: (match, keys) => { started.push({ match, keys }); return `m${started.length}`; },
    projects: [{ level: 'act1multi_01', difficulty: 'NORMAL' }], recruits: [50, 51, 52, 53, 54].map((n) => entry(n, { skills: [10], modules: [] })),
  });
  /** @param {number} id @param {string} type */
  const last = (id, type) => (got.get(id) ?? []).filter((m) => m.t === type).at(-1);
  rooms.hello(1, 'ka', 'A');
  rooms.hello(2, 'kb', 'B');
  rooms.message(1, { t: 'create' });
  rooms.message(2, { t: 'join', code: last(1, 'room').code });
  return { t, rooms, started, last };
}

/** From 项目调整 to the match: prepared, gone on, confirmed with distinct squads and styles, lineups of 6 and 7, ready. @param {ReturnType<typeof rig>} g */
async function playThrough(g) {
  g.rooms.message(2, { t: 'prepare', on: true });
  g.rooms.message(1, { t: 'go' });
  g.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 0) });
  g.rooms.message(2, { t: 'confirm', style: 'buff_3', squad: squadOf(10, 10, 20) });
  const opts = g.last(1, 'room').options;
  g.rooms.message(1, { t: 'lineup', lineup: opts[0].kept.slice(0, 6).map((/** @type {string} */ id) => ({ id, skill: 0, module: -1 })) });
  g.rooms.message(2, { t: 'lineup', lineup: opts[1].kept.slice(0, 7).map((/** @type {string} */ id) => ({ id, skill: 0, module: -1 })) });
  g.rooms.message(1, { t: 'ready', on: true });
  g.rooms.message(2, { t: 'ready', on: true });
  await new Promise((r) => setImmediate(r));
  return { opts, match: g.started.at(-1).match };
}

test('[房间-8] 互选模式: off at first; only the host turns it, only at 项目调整; a change undoes the guest\'s 准备参赛', () => {
  const g = rig();
  assert.equal(INVERSE.on, false);
  assert.match(INVERSE.hint, /交换编队及比赛风格/);
  assert.equal(lobbyMessageProblem({ t: 'inverse', on: true }), null);
  assert.equal(g.last(1, 'room').inverse, false);
  g.rooms.message(2, { t: 'inverse', on: true });
  assert.equal(g.last(1, 'room').inverse, false, 'the guest cannot');
  g.rooms.message(2, { t: 'prepare', on: true });
  g.rooms.message(1, { t: 'inverse', on: true });
  assert.deepEqual([g.last(2, 'room').inverse, g.last(2, 'room').prepared], [true, false]);
  g.rooms.message(2, { t: 'prepare', on: true });
  g.rooms.message(1, { t: 'go' });
  g.rooms.message(1, { t: 'inverse', on: false });
  assert.equal(g.last(1, 'room').inverse, true, 'not at 项目确认');
});

test('[房间-8] with 互选模式 on, each seat fights with the other\'s lineup and style; off, with its own', async () => {
  const g = rig();
  g.rooms.message(1, { t: 'inverse', on: true });
  const { opts, match } = await playThrough(g);
  assert.deepEqual(match.decks.map((/** @type {any[]} */ d) => d.map((x) => x.id)), [opts[1].kept.slice(0, 7), opts[0].kept.slice(0, 6)], 'seat 0 has the guest\'s lineup');
  assert.deepEqual(match.runes, [styleRunes('buff_3'), styleRunes('buff_1')], 'and the guest\'s style');
  g.rooms.ended('m1');
  assert.equal(g.last(1, 'room').inverse, true, 'it stays on for the next match');
  g.rooms.message(1, { t: 'inverse', on: false });
  const next = await playThrough(g);
  assert.deepEqual(next.match.decks.map((/** @type {any[]} */ d) => d.length), [6, 7], 'off: each its own');
  assert.deepEqual(next.match.runes, [styleRunes('buff_1'), styleRunes('buff_3')]);
});
