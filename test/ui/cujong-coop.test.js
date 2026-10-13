// 促融共竞 合作交互 (P6), pure helpers of ui/matchStatus.js (no DOM): the pair speed switch, the pause request state,
// its availability rule, the 费用请求 view and the marks split (ui/matchStatus.js coopSpeed / coopPause /
// coopPauseAvailable / coopFund / markSides).
import test from 'node:test';
import assert from 'node:assert/strict';
import { coopSpeed, coopPause, coopPauseAvailable, coopFund, markSides } from '../../public/js/ui/matchStatus.js';
import { PHASE } from '../../shared/constants.js';

const pub = (o = {}) => ({
  players: [
    { playerId: 'p_0', name: 'A', speed2: false },
    { playerId: 'p_1', name: 'B', speed2: false },
  ],
  ...o,
});

test('coopSpeed: per-side lamps; `on` only when both are on; a left partner lights nothing', () => {
  assert.deepEqual(coopSpeed(pub(), 'p_0'), { mine: false, theirs: false, on: false });
  const both = pub();
  both.players[0].speed2 = true;
  both.players[1].speed2 = true;
  assert.deepEqual(coopSpeed(both, 'p_0'), { mine: true, theirs: true, on: true });
  assert.deepEqual(coopSpeed(both, 'p_1'), { mine: true, theirs: true, on: true }, 'symmetric');
  const mine = pub();
  mine.players[0].speed2 = true;
  assert.deepEqual(coopSpeed(mine, 'p_0'), { mine: true, theirs: false, on: false });
  const left = pub();
  left.players[1].left = true;
  left.players[1].speed2 = true;
  assert.equal(coopSpeed(left, 'p_0').theirs, false, 'a left partner leaves the pair incomplete');
  assert.equal(coopSpeed({}, 'p_0'), null);
});

test('coopPause: the pending request and whose it is, the active pause, the release cooldown', () => {
  assert.deepEqual(coopPause(pub(), 'p_0'), { paused: false, releasing: false, request: null });
  assert.deepEqual(coopPause(pub({ pauseRequest: { id: 3, proposerId: 'p_1' } }), 'p_0').request, { id: 3, mine: false });
  assert.equal(coopPause(pub({ pauseRequest: { id: 3, proposerId: 'p_0' } }), 'p_0').request.mine, true);
  assert.deepEqual(coopPause(pub({ paused: true, pauseRelease: true }), 'p_0'), { paused: true, releasing: true, request: null });
  assert.equal(coopPause(null, 'p_0'), null);
});

test('coopPauseAvailable: battle phases only; kept while a request is pending or paused; not while downed', () => {
  assert.equal(coopPauseAvailable({ phase: PHASE.PREP }, {}), false);
  assert.equal(coopPauseAvailable({ phase: PHASE.COMBAT }, {}), true);
  assert.equal(coopPauseAvailable({ phase: PHASE.UNITE }, {}), false, 'the server refuses a pause in 联防 (battle phases only)');
  assert.equal(coopPauseAvailable({ phase: PHASE.FINAL_ASSAULT }, {}), true);
  assert.equal(coopPauseAvailable({ phase: PHASE.COMBAT }, { done: true }), false, 'over once the own battle settled');
  assert.equal(coopPauseAvailable({ phase: PHASE.SETTLE, pauseRequest: { id: 1, proposerId: 'p_1' } }, {}), true, 'answerable until answered');
  assert.equal(coopPauseAvailable({ phase: PHASE.PREP, paused: true }, {}), true, 'the lift stays offered while paused');
  assert.equal(coopPauseAvailable({ phase: PHASE.COMBAT }, { alive: false }), false);
});

test('coopFund + markSides: the request from this side; marks split by side with junk dropped', () => {
  assert.deepEqual(coopFund({ fundAsk: { id: 7, fromId: 'p_0' } }, 'p_0'), { id: 7, mine: true });
  assert.deepEqual(coopFund({ fundAsk: { id: 7, fromId: 'p_0' } }, 'p_1'), { id: 7, mine: false });
  assert.equal(coopFund({}, 'p_0'), null);
  const s = markSides({ marks: [
    { playerId: 'p_0', row: 9, col: 5, kind: 'note' },
    { playerId: 'p_1', row: 1, col: 2, kind: 'retreat' },
    { playerId: 'p_0', row: 9.5, col: 5 }, // malformed: dropped
    null,
  ] }, 'p_0');
  assert.equal(s.mine.length, 1);
  assert.equal(s.theirs.length, 1);
  assert.equal(s.theirs[0].kind, 'retreat');
  assert.deepEqual(markSides({}, 'p_0'), { mine: [], theirs: [] });
});
