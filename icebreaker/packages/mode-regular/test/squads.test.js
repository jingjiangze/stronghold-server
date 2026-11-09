// The squads a player brings to a room (docs/spec/room.md 房间-3) and the training a box entry gives a match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squadProblem, entryProblem, buildOf, SQUAD } from '../src/index.js';

/** A box entry numbered `n`. @param {number} n */
const entry = (n) => ({ id: `char_${String(100 + n).padStart(3, '0')}_op${n}`, elite: 2, level: 60, potential: 1, trust: 100, skills: [7, 10], modules: [0, 3] });
/** A squad of `high` and `low` entries. */
const squadOf = (high = 10, low = 10) => ({ high: Array.from({ length: high }, (_, i) => entry(i)), low: Array.from({ length: low }, (_, i) => entry(high + i)) });

test('[房间-3] a 常规队: at most 10 high and 20 low, at least 20 in all, each operator once, each entry well formed', () => {
  assert.deepEqual(SQUAD, { high: 10, low: 20, min: 20 });
  assert.equal(squadProblem(squadOf(10, 10)), null);
  assert.equal(squadProblem(squadOf(0, 20)), null);
  assert.equal(squadProblem(squadOf(10, 20)), null, '30 in all');
  assert.match(String(squadProblem(squadOf(10, 9))), /at least 20/);
  assert.match(String(squadProblem(squadOf(11, 10))), /high-priority/);
  assert.match(String(squadProblem(squadOf(0, 21))), /low-priority/);
  const twice = squadOf(10, 10);
  twice.low[0] = twice.high[0];
  assert.match(String(squadProblem(twice)), /twice/);
  assert.match(String(squadProblem({ high: [], low: [], extra: 1 })), /\{ high, low \}/);
});

test('[房间-3] a box entry: a character id, its training, up to 3 skill levels of 1–10 and 3 module stages of 0–3', () => {
  assert.equal(entryProblem(entry(1)), null);
  assert.match(String(entryProblem({ ...entry(1), id: 'trap_001_x' })), /character id/);
  assert.match(String(entryProblem({ ...entry(1), skills: [11] })), /skills/);
  assert.match(String(entryProblem({ ...entry(1), modules: [0, 0, 0, 1] })), /modules/);
  assert.match(String(entryProblem({ ...entry(1), elite: 3 })), /elite/);
  assert.match(String(entryProblem({ ...entry(1), note: 'x' })), /other fields/);
});

test('[房间-5] the training a match takes: the chosen skill at its level, the chosen module at its stage; one it lacks is none', () => {
  const e = entry(1);
  assert.deepEqual(buildOf(e, 1, 1), { elite: 2, level: 60, potential: 1, trust: 100, skill: 1, skillLevel: 10, module: 1, moduleLevel: 3 });
  assert.deepEqual(buildOf(e, 0, 0), { elite: 2, level: 60, potential: 1, trust: 100, skill: 0, skillLevel: 7 }, 'module stage 0: not unlocked');
  assert.deepEqual(buildOf(e, 2, -1), { elite: 2, level: 60, potential: 1, trust: 100, skill: -1, skillLevel: 1 });
});
