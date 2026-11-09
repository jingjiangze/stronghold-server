// 快速匹配 (docs/spec/room.md 房间-9, 房间-10): who may look, who pairs with whom on which project, the time limit and
// cancelling; a matched room starts at 项目确认, confirms with what each came with when time runs out, closes when one
// leaves, and after its match becomes a team room only if both choose 继续一起玩.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATCH, TOASTS } from '@icebreaker/mode-regular';
import { createRooms, createMatcher, seekProblem, mayPair, lobbyMessageProblem, TIMES } from '../src/index.js';
import { entry, squadOf } from './fixtures.js';

const PROJECTS = /** @type {any[]} */ ([{ level: 'act1multi_01', difficulty: 'NORMAL', class: 'ORDINARY' }, { level: 'act1multi_06', difficulty: 'NORMAL', class: 'ORDINARY' },
  { level: 'act1multi_hard-02', difficulty: 'NORMAL', class: 'EXTREMELY' }]);
/** A seek request. @param {Partial<Record<string, any>>} [v] */
const ask = (v = {}) => ({ classes: ['ORDINARY'], pos: 'NORMAL', inverse: false, squad: squadOf(10, 10, 0), style: 'buff_1', ...v });

/** Rooms and a matcher on a hand clock, what each session got, the matches started. */
function rig() {
  const t = { now: 0 }, got = /** @type {Map<number, any[]>} */ (new Map()), started = /** @type {any[]} */ ([]);
  let r = 0.37;
  const random = () => { r = (r * 9301 + 0.49297) % 1; return r; };
  const send = (/** @type {number} */ id, /** @type {any} */ msg) => { if (!got.has(id)) got.set(id, []); /** @type {any[]} */ (got.get(id)).push(msg); };
  const rooms = createRooms({ now: () => t.now, random, send, startMatch: (match, keys) => { started.push({ match, keys }); return `m${started.length}`; },
    projects: PROJECTS, recruits: [50, 51, 52, 53, 54].map((n) => entry(n, { skills: [10], modules: [] })) });
  const matcher = createMatcher({ now: () => t.now, random, send, projects: PROJECTS, open: (pair, project) => rooms.openMatched(pair, project) });
  /** @param {number} id @param {string} type */
  const last = (id, type) => (got.get(id) ?? []).filter((m) => m.t === type).at(-1);
  for (const [id, key] of /** @type {const} */ ([[1, 'ka'], [2, 'kb'], [3, 'kc'], [4, 'kd']])) rooms.hello(id, key, key.toUpperCase());
  return { t, rooms, matcher, started, last };
}

test('[房间-9] who may look: a class of the server\'s projects, a known position not locked, a 常规队 that may be confirmed', () => {
  assert.equal(MATCH.seconds, 120);
  assert.deepEqual(MATCH.positions.map((p) => [p.id, p.locked]), [['NORMAL', false], ['STUDENT', false], ['COACH', true]]);
  assert.equal(seekProblem(ask(), PROJECTS), null);
  assert.equal(seekProblem(ask({ classes: [] }), PROJECTS), TOASTS['matchNoProject']);
  assert.equal(seekProblem(ask({ classes: ['DIFFICULTY'] }), PROJECTS), TOASTS['matchNoProject'], 'no 高级赛 project on the server');
  assert.equal(seekProblem(ask({ pos: 'COACH' }), PROJECTS), TOASTS['mentorLockTips'], '教练 needs an unlock');
  assert.match(String(seekProblem(ask({ squad: squadOf(5, 5, 0) }), PROJECTS)), /常规队/);
  assert.match(String(seekProblem(ask({ style: 'buff_9' }), PROJECTS)), /比赛风格/);
  assert.equal(lobbyMessageProblem({ t: 'seek', ...ask() }), null);
  assert.equal(lobbyMessageProblem({ t: 'unseek' }), null);
});

test('[房间-9] who pairs: 常规选手 with 常规选手, 学员 with 教练, the same 互选模式, a class both chose', () => {
  const s = (/** @type {any} */ v) => ({ id: 1, since: 0, ...ask(), ...v });
  assert.equal(mayPair(s({}), s({})), true);
  assert.equal(mayPair(s({ pos: 'STUDENT' }), s({})), false);
  assert.equal(mayPair(s({ pos: 'STUDENT' }), s({ pos: 'COACH' })), true);
  assert.equal(mayPair(s({ inverse: true }), s({})), false);
  assert.equal(mayPair(s({ classes: ['EXTREMELY'] }), s({})), false);
  assert.equal(mayPair(s({ classes: ['EXTREMELY', 'ORDINARY'] }), s({})), true);
});

test('[房间-9] the longest waiting is paired first, on a project of a shared class; the time runs out; cancelling', () => {
  const g = rig();
  g.matcher.seek(1, ask({ classes: ['EXTREMELY'] }));
  assert.deepEqual(g.last(1, 'seeking'), { t: 'seeking', classes: ['EXTREMELY'], pos: 'NORMAL', inverse: false, left: 120_000 });
  g.t.now = 1000;
  g.matcher.seek(2, ask());
  g.matcher.seek(3, ask({ classes: ['ORDINARY', 'EXTREMELY'] }));
  g.matcher.tick();
  assert.deepEqual([g.last(1, 'sought'), g.last(3, 'sought')], [{ t: 'sought', how: 'found', mate: 'NORMAL' }, { t: 'sought', how: 'found', mate: 'NORMAL' }], '1 waited longest; 3 shares 特级赛 with it');
  const v = g.last(1, 'room');
  assert.deepEqual([v.phase, v.matched, v.you, PROJECTS[v.project].class, v.members.map((/** @type {any} */ m) => m.name)], ['confirm', true, 0, 'EXTREMELY', ['KA', 'KC']]);
  assert.equal(g.matcher.queue.has(2), true, '2 still looking');
  g.t.now = 1000 + 120_000;
  g.matcher.tick();
  assert.deepEqual(g.last(2, 'sought'), { t: 'sought', how: 'fail' });
  g.matcher.seek(4, ask());
  g.matcher.cancel(4);
  assert.deepEqual(g.last(4, 'sought'), { t: 'sought', how: 'cancel' });
});

test('[房间-10] a matched room: 项目确认 runs out into the allocation with what each came with; no kicking; leaving closes it', () => {
  const g = rig();
  g.matcher.seek(1, ask({ style: 'buff_2' }));
  g.matcher.seek(2, ask({ squad: squadOf(10, 10, 20), style: 'buff_3' }));
  g.matcher.tick();
  g.rooms.message(1, { t: 'confirm', squad: squadOf(10, 10, 40), style: 'buff_1' });
  g.rooms.message(1, { t: 'kick' });
  assert.equal(g.last(1, 'room').members.length, 2, 'no kicking in a matched room');
  g.t.now += TIMES.confirm;
  g.rooms.tick();
  const v = g.last(2, 'room');
  assert.ok(['pick', 'lineup'].includes(v.phase), 'on to the allocation, not back to 项目调整');
  assert.deepEqual(v.styles, ['buff_1', 'buff_3'], 'seat 0 its own confirmation, seat 1 what it came with');
  g.rooms.message(2, { t: 'leave' });
  assert.equal(g.last(1, 'closed').why, 'dissolved');
  assert.equal(g.rooms.inRoom(1), false);
});

test('[房间-10] after a matched match: a team room at 项目调整 only if both choose 继续一起玩; else it closes after its time', async () => {
  const g = rig();
  for (const id of [1, 2, 3, 4]) g.matcher.seek(id, ask({ squad: squadOf(10, 10, id * 20 - 20) }));
  g.matcher.tick();
  for (const id of [1, 2, 3, 4]) {
    g.rooms.message(id, { t: 'confirm', squad: squadOf(10, 10, id * 20 - 20), style: 'buff_1' });
  }
  for (const id of [1, 2, 3, 4]) {
    const o = g.last(id, 'room').options[g.last(id, 'room').you];
    g.rooms.message(id, { t: 'lineup', lineup: o.kept.slice(0, 6).map((/** @type {string} */ x) => ({ id: x, skill: 0, module: -1 })) });
    g.rooms.message(id, { t: 'ready', on: true });
  }
  await new Promise((r) => setImmediate(r));
  assert.equal(g.started.length, 2);
  g.rooms.ended('m1');
  g.rooms.ended('m2');
  assert.deepEqual([g.last(1, 'room').phase, g.last(1, 'room').together], ['together', [false, false]]);
  g.rooms.message(1, { t: 'together' });
  g.rooms.message(2, { t: 'together' });
  const v = g.last(2, 'room');
  assert.deepEqual([v.phase, v.matched, v.members.length], ['setup', false, 2], 'a team room now');
  g.rooms.message(3, { t: 'together' });
  g.t.now += TIMES.together;
  g.rooms.tick();
  assert.equal(g.last(4, 'closed').why, 'dissolved', 'only one chose it: closed');
});
