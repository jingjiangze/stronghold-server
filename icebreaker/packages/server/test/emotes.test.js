// 表情交流 in the room (docs/spec/room.md 房间-7): the room's emotes at 项目调整, the allocation's from the coordination
// to 准备就绪, none at 项目确认; an enabled theme; one emote a second per player; both seats get it with the sender's seat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMOTES } from '@icebreaker/mode-regular';
import { createRooms, lobbyMessageProblem } from '../src/index.js';
import { entry, squadOf } from './fixtures.js';

/** Two sessions in one room on a hand clock, and what each got. */
function rig() {
  const t = { now: 0 }, got = /** @type {Map<number, any[]>} */ (new Map());
  const rooms = createRooms({
    now: () => t.now, random: () => 0.5,
    send: (id, msg) => { if (!got.has(id)) got.set(id, []); /** @type {any[]} */ (got.get(id)).push(msg); },
    startMatch: () => 'm1', projects: [{ level: 'act1multi_01', difficulty: 'NORMAL' }], recruits: [50, 51, 52, 53, 54].map((n) => entry(n, { skills: [10], modules: [] })),
  });
  rooms.hello(1, 'ka', 'A');
  rooms.hello(2, 'kb', 'B');
  rooms.message(1, { t: 'create' });
  rooms.message(2, { t: 'join', code: (got.get(1) ?? []).filter((m) => m.t === 'room').at(-1).code });
  /** The emotes a session got. @param {number} id */
  const emotes = (id) => (got.get(id) ?? []).filter((m) => m.t === 'emote');
  return { t, rooms, emotes };
}

const [BASIC, SLUG] = EMOTES.themes;
const ROOM = EMOTES.scenes.room[0], PICK = EMOTES.scenes.pick[0];

test('[房间-7] the emote data: two themes, 10 room, 10 allocation and 3 battle emotes, 1 s apart, shown 3 s', () => {
  assert.deepEqual(EMOTES.themes, ['emoticon_basic', 'emoticon_originium_slug']);
  assert.deepEqual([EMOTES.scenes.room.length, EMOTES.scenes.pick.length, EMOTES.scenes.battle.length], [10, 10, 3]);
  assert.deepEqual([EMOTES.cd, EMOTES.time], [1, 3]);
  assert.equal(EMOTES.text['multiv3_room_exchange_project'], '换换项目！');
  assert.equal(lobbyMessageProblem({ t: 'emote', id: ROOM, theme: BASIC }), null);
  assert.match(String(lobbyMessageProblem({ t: 'emote', id: ROOM })), /fields/);
});

test('[房间-7] at 项目调整 a room emote of an enabled theme goes to both seats with the sender\'s seat; others do not go', () => {
  const g = rig();
  g.rooms.message(2, { t: 'emote', id: ROOM, theme: SLUG });
  assert.deepEqual(g.emotes(1), [{ t: 'emote', seat: 1, id: ROOM, theme: SLUG }]);
  assert.deepEqual(g.emotes(2), g.emotes(1), 'the sender gets it too');
  g.t.now += 1000;
  g.rooms.message(1, { t: 'emote', id: PICK, theme: BASIC });
  g.rooms.message(1, { t: 'emote', id: ROOM, theme: 'emoticon_autochess_basic' });
  g.rooms.message(1, { t: 'emote', id: 'multiv3_battle_thanks', theme: BASIC });
  assert.equal(g.emotes(1).length, 1, 'an allocation emote, a theme not enabled, a battle emote: none goes');
});

test('[房间-7] one emote a second per player: an earlier one is dropped, the other player is not held up', () => {
  const g = rig();
  g.rooms.message(1, { t: 'emote', id: ROOM, theme: BASIC });
  g.t.now += 999;
  g.rooms.message(1, { t: 'emote', id: ROOM, theme: BASIC });
  g.rooms.message(2, { t: 'emote', id: ROOM, theme: BASIC });
  assert.deepEqual(g.emotes(1).map((m) => m.seat), [0, 1]);
  g.t.now += 1;
  g.rooms.message(1, { t: 'emote', id: ROOM, theme: BASIC });
  assert.deepEqual(g.emotes(2).map((m) => m.seat), [0, 1, 0]);
});

test('[房间-7] none at 项目确认; the allocation\'s emotes while the lineups are set', () => {
  const g = rig();
  g.rooms.message(2, { t: 'prepare', on: true });
  g.rooms.message(1, { t: 'go' });
  g.rooms.message(1, { t: 'emote', id: ROOM, theme: BASIC });
  g.rooms.message(1, { t: 'emote', id: PICK, theme: BASIC });
  assert.equal(g.emotes(1).length, 0, '项目确认');
  g.rooms.message(1, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 0) });
  g.rooms.message(2, { t: 'confirm', style: 'buff_1', squad: squadOf(10, 10, 20) });
  g.rooms.message(2, { t: 'emote', id: ROOM, theme: BASIC });
  g.rooms.message(2, { t: 'emote', id: PICK, theme: BASIC });
  assert.deepEqual(g.emotes(1).map((m) => m.id), [PICK], 'the lineup step: the allocation emotes only');
});
