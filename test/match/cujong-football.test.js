// 促融共竞·阵地足球 (P3) match side: the seed-picked rival, the 净胜球 stamps, the settlement counters and a full run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { FOOTBALL_RIVAL_IDS } from '../../server/sim/content/football.js';

const football = (o = {}) => makeMatch({ mode: 'cujong', difficulty: 'football', humans: 2, ...o });

test('a football match picks its rival team from the seed; the public view carries the project and the counters', () => {
  const h = football({ seed: 3 }).start();
  assert.equal(h.m.cujongProject, 'football');
  assert.ok(FOOTBALL_RIVAL_IDS.includes(h.m.cujongRival));
  const h2 = football({ seed: 3 }).start();
  assert.equal(h2.m.cujongRival, h.m.cujongRival, 'deterministic from the seed');
  const pub = h.lastBc('m.public');
  assert.equal(pub.cujong.project, 'football');
  assert.deepEqual(pub.cujong.goals, { for: 0, against: 0 });
  assert.equal(pub.cujong.rivalTeam, h.m.cujongRival);
});

test('the 嘉奖印章 thresholds are the 净胜球 levels 1 / 2 / 4 (with the ≥ 2-death penalty)', () => {
  const h = football({ seed: 5 }).start();
  const m = h.m;
  m.cujongGoals = { for: 1, against: 0 };
  m.cujongFinalizeStamps(true);
  assert.deepEqual(m.cujongStamps, { stage1: true, stage2: false, advanced: false });
  assert.equal(m.cujongStampsTotal(), 1);
  m.cujongGoals = { for: 0, against: 0 };
  m.cujongFinalizeStamps(true);
  assert.equal(m.cujongStampsTotal(), 0);
  m.cujongGoals = { for: 3, against: 1 };
  m.cujongFinalizeStamps(true);
  assert.equal(m.cujongStampsTotal(), 2);
  m.cujongGoals = { for: 5, against: 1 };
  m.cujongFinalizeStamps(true);
  assert.equal(m.cujongStampsTotal(), 3, 'the max is 3');
  h.ps('p_0').deaths = 2;
  assert.equal(m.cujongStampsTotal(), 2, 'dying ≥ 2 times −1');
});

test('battle goals accumulate through settle into the match counters (public + result carry them)', () => {
  const h = football({ seed: 7 }).start();
  h.autoHumans();
  h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 1);
  const m = h.m;
  const base = (extra) => ({ leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0, ...extra });
  m.lastResults.set('p_0', base({ goalsFor: 2, goalsAgainst: 1 }));
  m.lastResults.set('p_1', base({ goalsFor: 1, goalsAgainst: 1 }));
  m.settle(null, null);
  assert.deepEqual(m.cujongGoals, { for: 3, against: 2 });
  // the public view carries them (the throttled broadcast may still be the pre-settle frame — read the builder)
  assert.deepEqual(m.publicView().cujong.goals, { for: 3, against: 2 });
  h.invariants();
});

test('a full football match runs to the end and its result carries the goals block', () => {
  const h = football({ seed: 11 }).start();
  h.autoHumans();
  const s = h.runToEnd();
  assert.ok(s.cujong && s.cujong.goals, 'the result carries the goals');
  assert.ok(Number.isInteger(s.cujong.goals.diff));
  assert.ok(s.cujong.stamps >= 0 && s.cujong.stamps <= 3);
  h.invariants();
});
