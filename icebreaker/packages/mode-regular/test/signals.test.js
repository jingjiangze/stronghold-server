// The signals of a match of 常规项目 (docs/spec/room.md 房间-12): marks on the level's tiles within their limits, battle
// emotes of the enabled themes at most once a cool-down; anything else dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKS, markAllowed, signalRule, EMOTES } from '../src/index.js';

test('[房间-12] the marks\' limits: 3 s after a mark, at most 2 in any 5 s; a mark shows 5 s', () => {
  assert.deepEqual([MARKS.cd, MARKS.window, MARKS.count, MARKS.shown], [3, 5, 2, 5]);
  assert.deepEqual(markAllowed([], 0), { ok: true, next: 0 });
  assert.deepEqual(markAllowed([1000], 2000), { ok: false, next: 4000 }, 'the cool-down after a mark');
  assert.deepEqual(markAllowed([1000, 4000], 4500), { ok: false, next: 7000 });
  assert.deepEqual(markAllowed([1000, 4000], 7000), { ok: true, next: 7000 }, 'two in the window: the window must pass the first');
  assert.deepEqual(markAllowed([1000, 4000, 7000], 8000), { ok: false, next: 10000 });
});

test('[房间-12] the rule: a mark on a tile of the level of a known kind within the limits; a seat\'s limits its own', () => {
  const rule = signalRule({ width: 10, height: 8 });
  const mark = (/** @type {Record<string, number>} */ o) => ({ kind: 'mark', row: 2, col: 3, type: 0, ...o });
  assert.equal(rule(0, mark({}), 0), true);
  assert.equal(rule(0, mark({}), 1000), false, 'its cool-down');
  assert.equal(rule(1, mark({ type: 2 }), 1000), true, 'the other seat\'s own');
  assert.equal(rule(0, mark({ row: 8 }), 9000), false, 'outside the level');
  assert.equal(rule(0, mark({ type: 3 }), 9000), false, 'an unknown kind');
  assert.equal(rule(0, /** @type {any} */ ({ ...mark({}), x: 1 }), 9000), false, 'another field');
  assert.equal(rule(0, mark({ col: 9, type: 1 }), 9000), true);
  assert.equal(rule(0, { kind: 'shout' }, 9000), false);
});

test('[房间-12] the rule: a battle emote of an enabled theme, once every cool-down a seat', () => {
  const rule = signalRule({ width: 10, height: 8 }), [id] = EMOTES.scenes.battle, [theme] = EMOTES.themes;
  assert.equal(rule(0, { kind: 'emote', id, theme }, 0), true);
  assert.equal(rule(0, { kind: 'emote', id, theme }, EMOTES.cd * 1000 - 1), false);
  assert.equal(rule(0, { kind: 'emote', id, theme }, EMOTES.cd * 1000), true);
  assert.equal(rule(1, { kind: 'emote', id: 'multiv3_room_hello', theme }, 0), false, 'a room emote is not a battle one');
  assert.equal(rule(1, { kind: 'emote', id, theme: 'emoticon_foolsday' }, 0), false, 'a theme not enabled');
});
