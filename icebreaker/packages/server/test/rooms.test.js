// The rooms of team play (docs/spec/room.md): codes, joining, the countdown, the project, the confirmation with the
// squads, the allocation, the lineups and the match they start; leaving, kicking, resuming, the steps' time limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRooms, TIMES } from '../src/index.js';
import { entry, squadOf } from './fixtures.js';

const RECRUITS = [50, 51, 52, 53, 54].map((n) => entry(n, { skills: [10], modules: [] }));

/** A rooms instance on a hand clock, with what each session got and the matches started. */
function rig() {
  const t = { now: 0 }, got = /** @type {Map<number, any[]>} */ (new Map()), started = /** @type {any[]} */ ([]);
  let r = 0.37;
  const rooms = createRooms({
    now: () => t.now, random: () => { r = (r * 9301 + 0.49297) % 1; return r; },
    send: (id, msg) => { if (!got.has(id)) got.set(id, []); /** @type {any[]} */ (got.get(id)).push(msg); },
    startMatch: (match, keys) => { started.push({ match, keys }); return `m${started.length}`; },
    projects: [{ level: 'act1multi_01', difficulty: 'NORMAL' }, { level: 'act1multi_06', difficulty: 'NORMAL' }], recruits: RECRUITS,
  });
  /** The last message of a type a session got. @param {number} id @param {string} type */
  const last = (id, type) => (got.get(id) ?? []).filter((m) => m.t === type).at(-1);
  return { t, rooms, got, started, last };
}

/** Lets a started match's promise settle. */
const settle = () => new Promise((r) => setImmediate(r));

/** Two sessions in one room, the guest prepared and the host gone on to 项目确认. @param {ReturnType<typeof rig>} g */
function twoConfirming(g) {
  g.rooms.hello(1, 'ka', 'A');
  g.rooms.hello(2, 'kb', 'B');
  g.rooms.message(1, { t: 'create' });
  g.rooms.message(2, { t: 'join', code: `房间编号[${g.last(1, 'room').code}],Dr.A 邀请您加入赛事` });
  g.rooms.message(2, { t: 'prepare', on: true });
  g.rooms.message(1, { t: 'go' });
}

test('[房间-1] a room: a 6-digit code, the host and a guest who joins by the code in brackets, no third; the host is seat 0', () => {
  const g = rig();
  g.rooms.hello(1, 'ka', 'A');
  g.rooms.message(1, { t: 'create' });
  const code = g.last(1, 'room').code;
  assert.match(code, /^\d{6}$/);
  g.rooms.hello(2, 'kb', 'B');
  g.rooms.message(2, { t: 'join', code: '[999999]' });
  assert.equal(g.last(2, 'error').msg, '没有这个房间编号');
  g.rooms.message(2, { t: 'join', code: `房间编号[${code}],Dr.A#1234 邀请您加入赛事` });
  assert.deepEqual(g.last(2, 'room').members.map((/** @type {any} */ m) => m.name), ['A', 'B']);
  assert.deepEqual([g.last(1, 'room').you, g.last(2, 'room').you], [0, 1]);
  g.rooms.hello(3, 'kc', 'C');
  g.rooms.message(3, { t: 'join', code });
  assert.equal(g.last(3, 'error').msg, '房间已满');
});

test('[房间-1] the room closes 15 minutes after it was made unless a match started; the host leaving closes it, the guest leaving frees the seat', () => {
  const g = rig();
  g.rooms.hello(1, 'ka', 'A');
  g.rooms.message(1, { t: 'create' });
  g.t.now = TIMES.room - 1;
  g.rooms.tick();
  assert.equal(g.rooms.rooms.size, 1);
  g.t.now = TIMES.room;
  g.rooms.tick();
  assert.deepEqual([g.rooms.rooms.size, g.last(1, 'closed').why], [0, 'time']);
  g.rooms.message(1, { t: 'create' });
  g.rooms.hello(2, 'kb', 'B');
  g.rooms.message(2, { t: 'join', code: g.last(1, 'room').code });
  g.rooms.message(2, { t: 'leave' });
  assert.equal(g.last(1, 'room').members.length, 1, 'the guest left: one seat');
  g.rooms.message(1, { t: 'leave' });
  assert.equal(g.rooms.rooms.size, 0, 'the host left: closed');
});

test('[房间-1] the host may ask the guest to leave at 项目调整; a session that comes back with its key takes its seat again', () => {
  const g = rig();
  g.rooms.hello(1, 'ka', 'A');
  g.rooms.message(1, { t: 'create' });
  const code = g.last(1, 'room').code;
  g.rooms.hello(2, 'kb', 'B');
  g.rooms.message(2, { t: 'join', code });
  g.rooms.gone(2);
  assert.deepEqual(g.last(1, 'room').members.map((/** @type {any} */ m) => m.online), [true, false]);
  g.rooms.hello(7, 'kb', 'B');
  assert.deepEqual([g.last(7, 'room').you, g.last(1, 'room').members[1].online], [1, true], 'back in seat 1');
  g.rooms.message(1, { t: 'kick' });
  assert.equal(g.last(7, 'closed').why, 'kicked');
  assert.equal(g.last(1, 'room').members.length, 1);
});

test('[房间-2] 项目调整: the host sets the project, the guest prepares (undone by a new project), the host goes on; 项目确认 runs out back to 项目调整', () => {
  const g = rig();
  g.rooms.hello(1, 'ka', 'A');
  g.rooms.hello(2, 'kb', 'B');
  g.rooms.message(1, { t: 'create' });
  g.rooms.message(1, { t: 'go' });
  assert.equal(g.last(1, 'room').phase, 'setup', 'alone: no going on');
  g.rooms.message(2, { t: 'join', code: g.last(1, 'room').code });
  g.rooms.message(2, { t: 'prepare', on: true });
  g.rooms.message(1, { t: 'project', index: 1 });
  assert.deepEqual([g.last(1, 'room').project, g.last(1, 'room').prepared], [1, false]);
  g.rooms.message(2, { t: 'project', index: 0 });
  assert.equal(g.last(1, 'room').project, 1, 'only the host sets it');
  g.rooms.message(1, { t: 'go' });
  assert.equal(g.last(1, 'room').phase, 'setup', 'the guest not prepared');
  g.rooms.message(2, { t: 'prepare', on: true });
  g.rooms.message(1, { t: 'go' });
  assert.equal(g.last(1, 'room').phase, 'confirm');
  g.t.now += TIMES.confirm;
  g.rooms.tick();
  assert.equal(g.last(2, 'room').phase, 'setup');
});

test('[房间-3] [房间-5] confirming takes a 常规队 that keeps the rules; with both, no shared high-priority operator: straight to the lineups', () => {
  const g = rig();
  twoConfirming(g);
  g.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 9) });
  assert.match(g.last(1, 'error').msg, /at least 20/);
  g.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 0) });
  g.rooms.message(2, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 20) });
  const v = g.last(1, 'room');
  assert.equal(v.phase, 'lineup');
  assert.equal(v.options[0].kept.length, 10, 'its high-priority operators');
  assert.equal(v.options[0].drawn.length, 5, 'half of its 10 low-priority ones');
  assert.ok(v.squads[1], 'the squads are public now');
});

test('[房间-4] shared high-priority operators are picked in turns before the lineups; a pick out of turn does nothing; one runs out: the first left', () => {
  const g = rig();
  twoConfirming(g);
  g.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 0) });
  g.rooms.message(2, { t: 'confirm', style: 'buff_3', squad: { high: squadOf(10, 10, 0).high.slice(0, 2).concat(squadOf(8, 0, 30).high), low: squadOf(0, 10, 50).low } });
  const p = g.last(1, 'room').picking;
  assert.equal(g.last(1, 'room').phase, 'pick');
  assert.deepEqual(g.last(1, 'room').styles, ['buff_1', 'buff_3'], 'the styles are public once both have confirmed (房间-3)');
  assert.equal(g.last(1, 'room').squads, null, 'the squads not yet');
  assert.equal(p.left.length, 2);
  g.rooms.message(p.by === 0 ? 2 : 1, { t: 'pick', id: p.left[0] });
  assert.equal(g.last(1, 'room').picking.left.length, 2, 'not its turn');
  g.t.now += TIMES.pick;
  g.rooms.tick();
  assert.equal(g.last(1, 'room').picking.left.length, 1, 'ran out: the first left was taken');
  const q = g.last(1, 'room').picking;
  g.rooms.message(q.by === 0 ? 1 : 2, { t: 'pick', id: q.left[0] });
  assert.equal(g.last(1, 'room').phase, 'lineup');
});

test('[房间-5] [房间-6] a lineup of 6–10 from the seat\'s options, then 准备就绪 by both: the match of both lineups, the host seat 0', async () => {
  const g = rig();
  twoConfirming(g);
  g.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 0) });
  g.rooms.message(2, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 20) });
  const opts = g.last(1, 'room').options;
  const lineup = (/** @type {number} */ seat, /** @type {number} */ n) => opts[seat].kept.slice(0, n).map((/** @type {string} */ id) => ({ id, skill: 1, module: 1 }));
  g.rooms.message(1, { t: 'lineup', lineup: lineup(0, 5) });
  assert.match(g.last(1, 'error').msg, /6–10/);
  g.rooms.message(1, { t: 'lineup', lineup: [...lineup(0, 5), { id: opts[1].kept[0], skill: 0, module: -1 }] });
  assert.match(g.last(1, 'error').msg, /不能上场/, 'not one of its options');
  g.rooms.message(1, { t: 'lineup', lineup: lineup(0, 6) });
  g.rooms.message(1, { t: 'ready', on: true });
  g.rooms.message(2, { t: 'lineup', lineup: lineup(1, 8) });
  assert.deepEqual(g.last(1, 'room').choices[1]?.[0], { skill: 1, module: 1 }, 'the other seat\'s skills and modules are shown with its lineup');
  g.rooms.message(2, { t: 'ready', on: true });
  assert.equal(g.last(1, 'room').phase, 'battle', 'at once: the match is starting');
  await settle();
  assert.equal(g.started.length, 1);
  const { match, keys } = g.started[0];
  assert.deepEqual([match.level, match.difficulty, match.decks.map((/** @type {any[]} */ d) => d.length), keys], ['act1multi_01', 'NORMAL', [6, 8], ['ka', 'kb']]);
  assert.deepEqual(match.decks[0][0].build, { elite: 2, level: 60, potential: 1, trust: 100, skill: 1, skillLevel: 10, module: 1, moduleLevel: 3 });
  assert.deepEqual(g.last(2, 'start'), { t: 'start', match: 'm1', seat: 1 });
});

test('[房间-5] [房间-6] the lineup step runs out: a seat without a lineup gets its kept operators and the match starts; it ends: back to 项目调整 with 15 minutes', async () => {
  const g = rig();
  twoConfirming(g);
  g.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 0) });
  g.rooms.message(2, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 20) });
  g.t.now += TIMES.lineup;
  g.rooms.tick();
  await settle();
  assert.deepEqual(g.started[0].match.decks.map((/** @type {any[]} */ d) => d.length), [10, 10]);
  assert.equal(g.last(1, 'room').phase, 'battle');
  g.t.now += 3 * TIMES.room;
  g.rooms.tick();
  assert.equal(g.rooms.rooms.size, 1, 'no countdown in battle');
  g.rooms.message(1, { t: 'like' });
  assert.deepEqual(g.last(1, 'room').likes, [false, false], 'no like before a match has ended');
  g.rooms.ended('m1');
  const v = g.last(1, 'room');
  assert.deepEqual([v.phase, v.left], ['setup', TIMES.room]);
  // 房间-6: each seat may like the other once on the result
  g.rooms.message(2, { t: 'like' });
  g.rooms.message(2, { t: 'like' });
  assert.deepEqual(g.last(1, 'room').likes, [false, true], 'the guest liked the host, once');
});

test('[房间-1] joining: a full room or one past 项目调整 takes nobody; the own room again changes nothing; another room leaves the first', async () => {
  const g = rig();
  twoConfirming(g);
  const code = g.last(1, 'room').code;
  g.rooms.hello(3, 'kc', 'C');
  g.rooms.message(3, { t: 'join', code });
  assert.equal(g.last(3, 'error').msg, '房间已满');
  g.rooms.message(2, { t: 'leave' });
  assert.equal(g.last(1, 'room').phase, 'setup', 'the guest left: back to 项目调整');
  g.rooms.message(1, { t: 'go' });
  g.rooms.message(1, { t: 'join', code });
  assert.equal(g.last(1, 'room').members.length, 1, 'its own room: still there');
  g.rooms.message(3, { t: 'create' });
  g.rooms.message(1, { t: 'join', code: g.last(3, 'room').code });
  assert.equal(g.last(1, 'closed').why, 'host left', 'joining elsewhere closes the room it hosted');
  assert.equal(g.last(3, 'room').members.length, 2);
  g.rooms.message(1, { t: 'create' });
  assert.equal(g.last(3, 'room').members.length, 1, 'making a room leaves the one it was in');

  const h = rig();
  twoConfirming(h);
  h.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 0) });
  h.rooms.message(2, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 20) });
  h.t.now += TIMES.lineup;
  h.rooms.tick();
  await settle();
  h.rooms.message(2, { t: 'leave' });
  assert.equal(h.last(1, 'room').phase, 'battle', 'the guest left a match: the match goes on');
  h.rooms.hello(5, 'ke', 'E');
  h.rooms.message(5, { t: 'join', code: h.last(1, 'room').code });
  assert.equal(h.last(5, 'error').msg, '房间已经开始分配干员');
});

test('[房间-1] what is not the host\'s or the guest\'s to do does nothing; messages before hello and of no room are ignored', () => {
  const g = rig();
  g.rooms.message(9, { t: 'create' });
  assert.equal(g.rooms.rooms.size, 0, 'no hello');
  g.rooms.hello(1, 'ka', 'A');
  g.rooms.message(1, { t: 'go' });
  g.rooms.gone(1);
  g.rooms.hello(1, 'ka', 'A');
  g.rooms.message(1, { t: 'create' });
  g.rooms.hello(2, 'kb', 'B');
  g.rooms.message(2, { t: 'join', code: g.last(1, 'room').code });
  const before = g.got.get(1)?.length;
  g.rooms.message(2, { t: 'kick' });
  g.rooms.message(2, { t: 'go' });
  g.rooms.message(1, { t: 'prepare', on: true });
  g.rooms.message(1, { t: 'project', index: 5 });
  g.rooms.message(1, { t: 'project', index: -1 });
  g.rooms.message(2, { t: 'confirm', style: 'buff_1', squad: squadOf() });
  g.rooms.message(1, { t: 'pick', id: 'x' });
  g.rooms.message(1, { t: 'handover' });
  g.rooms.message(1, { t: 'lineup', lineup: [] });
  g.rooms.message(1, { t: 'ready', on: true });
  g.rooms.message(1, { t: 'shout' });
  g.rooms.ended('nothing');
  assert.equal(g.got.get(1)?.length, before, 'nothing changed');
  g.rooms.gone(2);
  g.rooms.message(1, { t: 'kick' });
  assert.equal(g.last(1, 'room').members.length, 1, 'an offline guest can be asked to leave too');
  g.rooms.message(2, { t: 'create' });
  g.rooms.gone(2);
  g.t.now = TIMES.room;
  g.rooms.tick();
  assert.equal(g.rooms.rooms.size, 0, 'both rooms ran out, an offline host told nothing');
});

test('[房间-4] a turn handed over is the other seat\'s; the lineups follow the last pick', () => {
  const g = rig();
  twoConfirming(g);
  const shared = squadOf(3, 0, 0).high, own = squadOf(7, 10, 40);
  g.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: { high: shared.concat(own.high), low: own.low } });
  g.rooms.message(2, { t: 'confirm', style: 'buff_1', squad: { high: shared, low: squadOf(0, 17, 70).low } });
  const by = g.last(1, 'room').picking.by;
  g.rooms.message(by + 1, { t: 'handover' });
  assert.deepEqual([g.last(1, 'room').picking.by, g.last(1, 'room').picking.yielded], [1 - by, true]);
  for (let i = 0; i < 3; i++) { const q = g.last(1, 'room').picking; g.rooms.message(q.by + 1, { t: 'pick', id: q.left[0] }); }
  const v = g.last(1, 'room');
  assert.deepEqual([v.phase, v.picking], ['lineup', null]);
  assert.equal(v.options[0].kept.length + v.options[1].kept.length, 7 + 3, 'its own high-priority ones, and the picked ones');
});

test('[房间-5] a lineup names skills and modules the entry has; one set again must be readied again; readiness can be taken back', () => {
  const g = rig();
  twoConfirming(g);
  const a = squadOf(10, 10, 0);
  a.high[0] = { ...a.high[0], modules: [0] };
  g.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: a });
  g.rooms.message(2, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 20) });
  const kept = g.last(1, 'room').options[0].kept;
  assert.equal(kept[0], a.high[0].id);
  const six = (/** @type {any} */ first) => [first, ...kept.slice(1, 6).map((/** @type {string} */ id) => ({ id, skill: 0, module: -1 }))];
  g.rooms.message(1, { t: 'ready', on: true });
  assert.deepEqual(g.last(1, 'room').ready, [false, false], 'no lineup: no readiness');
  g.rooms.message(1, { t: 'lineup', lineup: six({ id: kept[0], skill: 2, module: -1 }) });
  assert.match(g.last(1, 'error').msg, /没有这个技能/);
  g.rooms.message(1, { t: 'lineup', lineup: six({ id: kept[0], skill: 0, module: 0 }) });
  assert.match(g.last(1, 'error').msg, /没有这个模组/, 'module stage 0: not unlocked');
  g.rooms.message(1, { t: 'lineup', lineup: six({ id: kept[0], skill: 0.5, module: -1 }) });
  assert.match(g.last(1, 'error').msg, /没有这个技能/);
  g.rooms.message(1, { t: 'lineup', lineup: six({ id: kept[0], skill: 0, module: 'x' }) });
  assert.match(g.last(1, 'error').msg, /没有这个模组/);
  g.rooms.message(1, { t: 'lineup', lineup: six({ id: kept[1], skill: 0, module: -1 }) });
  assert.match(g.last(1, 'error').msg, /不能上场/, 'twice');
  g.rooms.message(1, { t: 'lineup', lineup: six({ id: kept[0], skill: -1, module: -1 }) });
  g.rooms.message(1, { t: 'ready', on: true });
  assert.deepEqual(g.last(1, 'room').ready, [true, false]);
  g.rooms.message(1, { t: 'lineup', lineup: six({ id: kept[0], skill: 1, module: -1 }) });
  assert.deepEqual(g.last(1, 'room').ready, [false, false], 'a new lineup: not ready');
  g.rooms.message(1, { t: 'ready', on: true });
  g.rooms.message(1, { t: 'ready', on: false });
  assert.deepEqual(g.last(1, 'room').ready, [false, false]);
});

test('[房间-5] the lineup step runs out: a seat that set its lineup fields it; one with few kept operators is filled up to 6, a skill-less one with no skill', async () => {
  const g = rig();
  twoConfirming(g);
  const b = squadOf(2, 18, 20);
  b.high[0] = { ...b.high[0], skills: [] };
  g.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 0) });
  g.rooms.message(2, { t: 'confirm', style: 'buff_1', squad: b });
  const kept = g.last(1, 'room').options[0].kept;
  g.rooms.message(1, { t: 'lineup', lineup: kept.slice(0, 7).map((/** @type {string} */ id) => ({ id, skill: 1, module: -1 })) });
  g.t.now += TIMES.lineup;
  g.rooms.tick();
  await settle();
  const decks = g.started[0].match.decks;
  assert.deepEqual(decks.map((/** @type {any[]} */ d) => d.length), [7, 6]);
  assert.deepEqual([decks[1][0].build.skill, decks[1][1].build.skill], [-1, 0]);
});

test('[房间-6] a match that cannot start sends them back to 项目调整 with the reason', async () => {
  const g = rig();
  g.rooms = createRooms({
    now: () => g.t.now, random: () => 0.5, send: (id, msg) => { if (!g.got.has(id)) g.got.set(id, []); /** @type {any[]} */ (g.got.get(id)).push(msg); },
    startMatch: async () => { throw new Error('服务器的对局已满'); },
    projects: [{ level: 'act1multi_01', difficulty: 'NORMAL' }], recruits: RECRUITS,
  });
  twoConfirming(g);
  g.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 0) });
  g.rooms.message(2, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 20) });
  g.rooms.gone(2);
  g.t.now += TIMES.lineup;
  g.rooms.tick();
  assert.equal(g.last(1, 'room').phase, 'battle');
  await settle();
  assert.equal(g.last(1, 'error').msg, '比赛没能开始：服务器的对局已满');
  assert.equal(g.last(1, 'room').phase, 'setup');
});

test("[房间-1] each player's name card — 代号, avatar, assistant and its art — shows in the room as its page last sent it; a new hello keeps it", () => {
  const g = rig();
  g.rooms.hello(1, 'ka', 'A');
  g.rooms.profile(1, { tag: '9414', avatar: 'char_102_texas', assist: { id: 'char_1044_hsgma2', art: 1 } });
  g.rooms.message(1, { t: 'create' });
  assert.deepEqual(g.last(1, 'room').members, [{ name: 'A', online: true, tag: '9414', avatar: 'char_102_texas', assist: { id: 'char_1044_hsgma2', art: 1 } }]);
  g.rooms.hello(2, 'kb', 'B');
  g.rooms.message(2, { t: 'join', code: g.last(1, 'room').code });
  assert.deepEqual(g.last(1, 'room').members[1], { name: 'B', online: true, tag: '', avatar: '', assist: null }, 'none sent yet');
  g.rooms.profile(2, { tag: '0007', avatar: '', assist: { id: 'char_002_amiya', art: 2 } });
  assert.deepEqual(g.last(1, 'room').members[1], { name: 'B', online: true, tag: '0007', avatar: '', assist: { id: 'char_002_amiya', art: 2 } }, 'the other seat sees it at once');
  g.rooms.hello(3, 'kb', 'B2');
  assert.deepEqual(g.last(3, 'room').members[1], { name: 'B2', online: true, tag: '0007', avatar: '', assist: { id: 'char_002_amiya', art: 2 } }, 'the same key again: the card stays');
});

test('[房间-1] a session that says hello again with a new name keeps its seat under that name', () => {
  const g = rig();
  g.rooms.hello(1, 'ka', 'A');
  g.rooms.message(1, { t: 'create' });
  g.rooms.hello(1, 'ka', 'A2');
  assert.deepEqual(g.last(1, 'room').members.map((/** @type {any} */ m) => m.name), ['A2']);
  assert.equal(g.rooms.rooms.size, 1);
});

test('[房间-3] [房间-6] each seat confirms with a play style, hidden from the other seat until both have confirmed; the match carries each seat\'s style runes', async () => {
  const g = rig();
  twoConfirming(g);
  g.rooms.message(1, { t: 'confirm', style: 'nope', squad: squadOf(10, 10, 0) });
  assert.match(g.last(1, 'error').msg, /没有这种比赛风格/);
  g.rooms.message(1, { t: 'confirm', style: 'buff_5', squad: squadOf(10, 10, 0) });
  assert.deepEqual(g.last(2, 'room').styles, ['', ''], 'not shown to the other seat yet');
  assert.deepEqual(g.last(1, 'room').styles, ['buff_5', '']);
  g.rooms.message(2, { t: 'confirm', style: 'buff_3', squad: squadOf(10, 10, 20) });
  assert.deepEqual(g.last(2, 'room').styles, ['buff_5', 'buff_3'], 'public once both have confirmed');
  g.t.now += TIMES.lineup;
  g.rooms.tick();
  await settle();
  const runes = g.started[0].match.runes;
  assert.deepEqual(runes.map((/** @type {any[]} */ l) => l.map((x) => x.key).join()), [
    'insert_token_card,char_dynamic_ability_new,env_gbuff_new,env_gbuff_new',
    'char_respawntime_mul,env_gbuff_new,insert_token_card,env_gbuff_new,global_deck_placeable_char_num_add',
  ]);
});
