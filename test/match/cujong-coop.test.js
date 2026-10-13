// 促融共竞 合作交互 (P6) on the engine harness: the 费用请求 (0–15 on accept, 15 s cooldown, decline, a partner without
// command refused, a partner who left / an AI auto-accepts, the 30 s lapse), the 标记 (kind, 5 s cooldown, one active
// per side, both sides in m.public.marks), the 倍速 pair gate (effGameSpeed: half base until BOTH switches are on) and
// the 合作暂停 (request → the partner's vote or own press, any side lifts with the ≈1 s release, revive countdowns
// frozen / re-armed, both humans disconnected ⇒ auto-pause).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE, ERR } from '../../shared/constants.js';

const cujong = (o = {}) => makeMatch({ mode: 'cujong', difficulty: 'fortress', humans: 2, ...o });
// raw prep: humans stay unready (no autoplay timers) so the 65 s prep survives the clock advances these tests need
const toPrep1 = (h) => { h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 1); return h; };
const toCombat = (h) => { h.autoHumans(); h.drive(() => h.m.phase === PHASE.COMBAT); return h; };

test('费用请求: accept moves up to 15; the requester self-answers and stale ids are refused; 15 s cooldown', () => {
  const h = toPrep1(cujong({ seed: 31 }).start());
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  a.funds = 0; b.funds = 40;
  assert.deepEqual(m.handle('p_0', { t: 'g.fundAsk' }), { ok: true });
  const req = m.publicView().fundAsk;
  assert.ok(req && req.fromId === 'p_0', 'the partner sees the pending 费用请求');
  assert.equal(m.handle('p_0', { t: 'g.fundAnswer', askId: req.id, accept: true }).error, ERR.BAD_TARGET, 'the requester does not answer');
  assert.equal(m.handle('p_1', { t: 'g.fundAnswer', askId: req.id + 99, accept: true }).error, ERR.BAD_TARGET, 'stale id');
  assert.deepEqual(m.handle('p_1', { t: 'g.fundAnswer', askId: req.id, accept: true }), { ok: true });
  assert.equal(a.funds, 15, 'the transferred amount is capped at 15');
  assert.equal(b.funds, 25);
  assert.equal(m.publicView().fundAsk, null);
  assert.equal(m.handle('p_0', { t: 'g.fundAsk' }).error, ERR.RATE, 'the requester waits 15 (scaled) seconds');
  h.sched.advance(m.scaled(15000));
  const aBefore = a.funds, bBefore = b.funds; // the prep may have granted income meanwhile: compare around the answer
  assert.deepEqual(m.handle('p_0', { t: 'g.fundAsk' }), { ok: true });
  const req2 = m.publicView().fundAsk;
  assert.deepEqual(m.handle('p_1', { t: 'g.fundAnswer', askId: req2.id, accept: false }), { ok: true }, 'declining is an answer');
  assert.equal(a.funds, aBefore);
  assert.equal(b.funds, bBefore, 'a declined request moves nothing');
  assert.equal(m.publicView().fundAsk, null);
  h.invariants();
});

test('费用请求: a partner without command is refused; a partner who LEFT auto-accepts their wallet; an empty wallet moves nothing', () => {
  const h = toPrep1(cujong({ seed: 33 }).start());
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  a.funds = 0; b.funds = 10;
  b.reviving = true;
  assert.equal(m.handle('p_0', { t: 'g.fundAsk' }).error, ERR.REVIVING, '对方已丧失指挥权时无法执行费用请求');
  b.reviving = false;
  b.left = true;
  assert.deepEqual(m.handle('p_0', { t: 'g.fundAsk' }), { ok: true });
  assert.equal(a.funds, 10, '对方已退出时无条件接受 (their wallet moved)');
  assert.equal(b.funds, 0);
  a.lastFundAskAt = m.sched.now() - m.scaled(15000) - 1; // skip the cooldown clock (the 15 s rule is covered above)
  const aBefore = a.funds;
  assert.deepEqual(m.handle('p_0', { t: 'g.fundAsk' }), { ok: true }, 'the request itself stays legal');
  assert.equal(a.funds, aBefore, 'an empty wallet transfers nothing');
});

test('标记: a kind + tile lands for both sides; the 5 s cooldown and one-active-per-side replace', () => {
  const h = toPrep1(cujong({ seed: 35 }).start());
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.mark', row: 9, col: 5, kind: 'note' }), { ok: true });
  const pub = m.publicView();
  assert.deepEqual(pub.marks, [{ playerId: 'p_0', row: 9, col: 5, kind: 'note', seq: 1 }]);
  assert.equal(h.lastBc('m.mark')?.row, 9, 'the wire event carries the mark');
  assert.equal(m.handle('p_0', { t: 'g.mark', row: 9, col: 6 }).error, ERR.RATE, '5 s cooldown per side');
  assert.deepEqual(m.handle('p_1', { t: 'g.mark', row: 10, col: 7 }), { ok: true }, 'the partner marks too (default kind)');
  assert.equal(m.publicView().marks.length, 2, 'both sides visible');
  h.sched.advance(m.scaled(5000));
  assert.deepEqual(m.handle('p_0', { t: 'g.mark', row: 9, col: 6 }), { ok: true }, 'after the cooldown');
  const after = m.publicView().marks.filter((x) => x.playerId === 'p_0');
  assert.equal(after.length, 1, 'one active mark per side — the new one replaced');
  assert.equal(after[0].col, 6);
  h.invariants();
});

test('倍速: each side toggles its own switch; the pair gates effGameSpeed (half the base until BOTH are on)', () => {
  const h = toPrep1(cujong({ seed: 37 }).start());
  const m = h.m, a = h.ps('p_0');
  assert.equal(m.effGameSpeed, m.gameSpeed / 2, 'the classic 1× until the pair agrees');
  assert.deepEqual(m.handle('p_0', { t: 'g.speed', on: true }), { ok: true });
  assert.equal(a.speed2, true);
  assert.equal(m.effGameSpeed, m.gameSpeed / 2, 'one switch alone is not enough');
  assert.equal(m.publicView().players.find((p) => p.playerId === 'p_0').speed2, true, 'the lamp is public');
  assert.deepEqual(m.handle('p_1', { t: 'g.speed', on: true }), { ok: true });
  assert.equal(m.effGameSpeed, m.gameSpeed, 'both on ⇒ the standard speed');
  assert.deepEqual(m.handle('p_1', { t: 'g.speed', on: false }), { ok: true });
  assert.equal(m.effGameSpeed, m.gameSpeed / 2, 'either off ⇒ back to 1×');
  h.invariants();
});

test('合作暂停: request → the partner\'s vote or own press; stale ids refused; the proposer cancels; a lift needs the release', () => {
  const h = toPrep1(cujong({ seed: 39 }).start());
  const m = h.m;
  assert.equal(m.handle('p_0', { t: 'g.pause', on: true }).error, ERR.WRONG_PHASE, 'no live battle, no pause');
  toCombat(h);
  // decline path first: request by p_1, answered by p_0
  assert.deepEqual(m.handle('p_1', { t: 'g.pause', on: true }), { ok: true });
  const req = m.publicView().pauseRequest;
  assert.ok(req && req.proposerId === 'p_1', 'the request is public');
  assert.equal(m.handle('p_0', { t: 'g.pauseVote', voteId: req.id + 5, agree: true }).error, ERR.BAD_TARGET, 'stale vote id');
  assert.equal(m.handle('p_1', { t: 'g.pauseVote', voteId: req.id, agree: true }).error, ERR.BAD_TARGET, 'the proposer does not answer their own request');
  assert.deepEqual(m.handle('p_0', { t: 'g.pauseVote', voteId: req.id, agree: false }), { ok: true });
  assert.equal(m.paused, false, 'declined ⇒ not paused');
  assert.equal(m.publicView().pauseRequest, null);
  // cancel path: p_0 proposes and cancels with { on: false }
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: true }), { ok: true });
  assert.equal(m.publicView().pauseRequest?.proposerId, 'p_0');
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: false }), { ok: true });
  assert.equal(m.publicView().pauseRequest, null, 'the requester cancels');
  assert.equal(m.paused, false);
  // the partner's own press counts as approval
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: true }), { ok: true });
  assert.deepEqual(m.handle('p_1', { t: 'g.pause', on: true }), { ok: true }, "the partner's own 暂停 press approves");
  assert.equal(m.paused, true);
  assert.ok(m.publicView().pausedAt > 0);
  // any side lifts it; the ≈1 s release cooldown shows on m.public
  assert.deepEqual(m.handle('p_1', { t: 'g.pause', on: false }), { ok: true }, 'either side lifts');
  assert.equal(m.paused, true, 'still paused during the release');
  assert.equal(m.publicView().pauseRelease, true);
  h.sched.advance(m.scaled(1000) + 16);
  assert.equal(m.paused, false, 'the release completes');
  assert.equal(m.publicView().pauseRelease, false);
  h.invariants();
});

test('合作暂停: a revive countdown freezes while paused and re-arms with the carried time', () => {
  // instant:false — a fake battle that would settle through the pause (instantCombat timers ignore `paused`) must not
  // end the round mid-test; production runners hold the field while paused.
  const h = toCombat(cujong({ seed: 41, instant: false }).start());
  const m = h.m, a = h.ps('p_0');
  m._cujongDown(a);
  assert.equal(a.reviving, true);
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: true }), { ok: true });
  assert.deepEqual(m.handle('p_1', { t: 'g.pause', on: true }), { ok: true });
  assert.equal(m.paused, true);
  const left = a._reviveLeftAtPause;
  assert.ok(left > 29000 && left <= 30000, `the countdown was frozen at ${left}`);
  assert.equal(m._cujongReviveTimers.has('p_0'), false, 'the revive timer was cancelled, not left running');
  h.sched.advance(m.scaled(5000));
  assert.equal(m.paused, true, 'still paused');
  assert.equal(a._reviveLeftAtPause, left, 'five paused seconds cost nothing');
  assert.equal(a.reviving, true, 'nobody revives through a pause');
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: false }), { ok: true });
  h.sched.advance(m.scaled(1000) + 16);
  assert.equal(m.paused, false);
  // the timer re-arms at the release instant; the advance overshoots it by a few ms
  const drift = m.sched.now() - (a.reviveAt - left);
  assert.ok(drift >= 0 && drift <= 50, `re-armed with the carried time (drift ${drift} ms)`);
  // the round may settle mid-advance and its leaks reset the countdown once (P2 rule: 泄漏重置 30 s) — either way the
  // re-armed timer must land: advance, then to whatever reviveAt it now carries
  h.sched.advance(31000);
  if (a.reviving) h.sched.advance(Math.max(0, a.reviveAt - m.sched.now()) + 100);
  assert.equal(a.reviving, false, 'the countdown completes');
  assert.equal(a.targetLp, a.targetLpMax, 'full life on revival');
});

test('合作暂停: one human away changes nothing; both away auto-pauses the field', () => {
  const h = toCombat(cujong({ seed: 43 }).start());
  const m = h.m;
  m.onDisconnect('p_0');
  assert.equal(m.paused, false, 'the partner keeps playing');
  m.onDisconnect('p_1');
  assert.equal(m.paused, true, 'nobody left to hold it — the field is paused');
  h.invariants();
});
