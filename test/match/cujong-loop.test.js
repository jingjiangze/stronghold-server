// 促融共竞 (P2) main loop on the engine harness: the target-point life (targetLp) charging — a side's own leaks, a
// 共同敌手 leaking on the other side's field charging BOTH —, the death → 30 s revive state machine (a leak on the
// downed side's own field resets it), the both-down wipe, 中场休整 (restore / auto-revive / withdraw), the 嘉奖印章
// tally, the 比赛风格 pick (INFO_CHECK) and its sim buffs, and the invariants at every step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { PHASE, ERR, MATCH_STYLES } from '../../shared/constants.js';

const cujong = (o = {}) => makeMatch({ mode: 'cujong', difficulty: 'football', humans: 2, ...o });
const leak = (n, common = 0) => ({
  leaked: [...Array(n).fill({ counted: true }), ...Array(common).fill({ counted: true, common: true })],
  perfect: n + common === 0, coins: 0, layerGains: {}, killed: 0, damageDealt: 0,
});
/** Drive both humans through INFO_CHECK / BAND_DRAFT / the prep of round 1. */
const toPrep1 = (h) => { h.autoHumans(); h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 1); return h; };

test('a cujong match starts with the config targetLp; the 比赛风格 pick is INFO_CHECK-only and lands with the band', () => {
  const h = cujong({ seed: 5 }).start();
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  assert.equal(m.isCujong, true);
  assert.equal(m.gd.cujongTargetLp, 10);
  assert.equal(m.gd.halftimeRound, 7);
  assert.equal(m.mode, 'coop', 'the engine still runs the match as a co-op (Match.js normalises the mode)');
  assert.equal(a.targetLp, 10, 'the target-point life exists from INFO_CHECK on');
  // the pick: unknown ids refused; a valid id sticks before the band init
  assert.equal(m._handle(a, { t: 'g.matchStyle', styleId: 'bogus' }).error, ERR.BAD_TARGET);
  assert.deepEqual(m._handle(a, { t: 'g.matchStyle', styleId: 'roaming' }), { ok: true });
  assert.equal(a.styleId, 'roaming');
  toPrep1(h);
  assert.equal(a.targetLp, 10);
  assert.equal(a.targetLpMax, 10);
  assert.equal(b.targetLp, 10);
  assert.equal(a.styleId, 'roaming', 'the picked style survives the band init');
  assert.equal(b.styleId, 'basic', 'an unpicked side gets the official default');
  assert.equal(a.deployCapBonus, -1, '游走 pays one deploy slot');
  assert.equal(b.deployCapBonus, 0);
  // locked once INFO_CHECK ends
  assert.equal(m._handle(a, { t: 'g.matchStyle', styleId: 'basic' }).error, ERR.WRONG_PHASE);
  h.invariants();
});

test('leaks charge targetLp: the own side pays its field, a 共同敌手 pays both, the in-battle lp is untouched', () => {
  const h = toPrep1(cujong({ seed: 11 }).start());
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  const cap = m.gd.lpCapPerRound;
  const lpStart = a.lp;
  m.lastResults.set('p_0', leak(2, 1)); // A's field: 2 own + 1 共同敌手
  m.lastResults.set('p_1', leak(0));
  m.settle(null, null);
  assert.equal(a.targetLp, 10 - Math.min(cap, 3), 'A pays its own 3');
  assert.equal(b.targetLp, 10 - Math.min(cap, 1), 'the 共同敌手 charges B once');
  assert.equal(a.lp, lpStart, 'the in-battle lp is not the cujong life');
  assert.equal(a.reviving, false);
  h.invariants();
});

test('targetLp 0 falls into the reviving state: 30 s countdown, a leak resets it, the timer revives full', () => {
  const h = toPrep1(cujong({ seed: 13 }).start());
  const m = h.m, a = h.ps('p_0');
  a.targetLp = 1;
  m.lastResults.set('p_0', leak(2));
  m.lastResults.set('p_1', leak(0));
  m.settle(null, null);
  assert.equal(a.targetLp, 0);
  assert.equal(a.reviving, true);
  assert.equal(a.deaths, 1);
  assert.equal(a.ready, true, 'the round never waits for a downed side');
  assert.equal(m.statusOf(a), 'reviving');
  assert.equal(a.reviveAt, m.sched.now() + m.scaled(30000), 'thirty (scaled) seconds');
  // a downed side acts nothing; emotes / watching stay open
  assert.equal(m._handle(a, { t: 'g.buy', slot: 0 }).error, ERR.REVIVING);
  assert.equal(m._handle(a, { t: 'g.ready', ready: false }).error, ERR.REVIVING);
  // park the match in SETTLE so only the countdown drives, then let 5 s pass and leak ON A's OWN field: reset
  m.cancel(m._phaseTimer);
  m._phaseTimer = null;
  h.sched.advance(5000);
  assert.equal(a.reviving, true);
  const t1 = a.reviveAt;
  m.phase = PHASE.COMBAT; // re-open the settle path (the guard only refuses a second SETTLE)
  m.lastResults.set('p_0', leak(1));
  m.settle(null, null);
  assert.ok(a.reviveAt > t1, 'the leak restarted the countdown');
  assert.equal(a.targetLp, 0);
  m.cancel(m._phaseTimer);
  m._phaseTimer = null;
  // countdown to just before the deadline, then past it
  h.sched.advance(Math.max(0, a.reviveAt - m.sched.now() - 1));
  assert.equal(a.reviving, true);
  h.sched.advance(2);
  assert.equal(a.reviving, false);
  assert.equal(a.targetLp, 10, 'the revive restores the full target-point life');
  assert.equal(a.reviveAt, 0);
  assert.equal(m.statusOf(a) !== 'reviving', true);
  h.invariants();
});

test('both sides downed at once: the match is lost (wipe)', () => {
  const h = toPrep1(cujong({ seed: 17 }).start());
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  a.targetLp = 1;
  b.targetLp = 1;
  m.lastResults.set('p_0', leak(1));
  m.lastResults.set('p_1', leak(1));
  m.settle(null, null);
  assert.equal(a.reviving, true);
  assert.equal(b.reviving, true);
  h.runToEnd();
  assert.equal(h.ended.victory, false);
  assert.equal(h.ended.reason, 'wipe');
  assert.equal(h.ended.cujong.stamps, 0);
});

test('stage 1 clears into 中场休整: targetLp restored, the fallen auto-revive, operators withdraw, stage 2 runs', () => {
  const h = toPrep1(cujong({ seed: 23 }).start());
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  for (const ps of [a, b]) { ps.targetLpMax = 99; ps.targetLp = 99; } // headroom: nothing may be lost before round 7
  h.runToPhase(PHASE.PREP, 5);
  // A falls during round 5 (no timer armed: the halftime restore is what must bring it back)
  a.reviving = true;
  a.reviveAt = m.sched.now() + m.scaled(30000);
  a.targetLp = 0;
  a.ready = true;
  h.runToPhase(PHASE.PREP, 8);
  assert.equal(m.cujongStage, 2);
  assert.equal(m.cujongStamps.stage1, true);
  assert.equal(a.reviving, false, '中场休整 auto-revives the fallen');
  assert.equal(a.reviveAt, 0);
  assert.equal(a.targetLp, 99);
  assert.equal(b.targetLp, 99);
  assert.equal(a.board.size, 0, '干员撤退: every deployed operator withdrew');
  h.invariants();
});

test('嘉奖印章 tally: stages + advanced − the ≥ 2-death penalty, floored at zero', () => {
  const h = cujong({ seed: 29 }).start();
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  m.cujongStamps = { stage1: false, stage2: false, advanced: false };
  assert.equal(m.cujongStampsTotal(), 0);
  m.cujongStamps.stage1 = true;
  assert.equal(m.cujongStampsTotal(), 1, 'stage 1 +1');
  m.cujongStamps.stage2 = true;
  assert.equal(m.cujongStampsTotal(), 2, 'stage 2 +1');
  m.cujongStamps.advanced = true;
  assert.equal(m.cujongStampsTotal(), 3, 'the advanced goal +1 (max 3)');
  a.deaths = 2;
  assert.equal(m.cujongStampsTotal(), 2, 'dying ≥ 2 times −1');
  m.cujongStamps = { stage1: true, stage2: false, advanced: false };
  b.deaths = 1;
  assert.equal(m.cujongStampsTotal(), 0, 'never below zero');
});

test('a full cujong match runs to the result: the cujong block, per-side rows and the invariants hold', () => {
  const h = cujong({ seed: 31 }).start();
  h.autoHumans();
  let mid = null;
  h.onBroadcast.push((msg) => { if (msg.t === 'm.public' && !mid && msg.round === 1 && msg.phase === PHASE.PREP) mid = msg; });
  const summary = h.runToEnd();
  assert.ok(mid, 'a round-1 PREP m.public was seen');
  const row = mid.players.find((p) => p.playerId === 'p_0');
  assert.equal(row.targetLp, 10, 'the public row carries the target-point life');
  assert.ok(MATCH_STYLES.includes(row.styleId), 'and the style');
  assert.ok(summary.cujong && Number.isInteger(summary.cujong.stamps), 'the result carries the 嘉奖印章 block');
  assert.ok(summary.cujong.stamps >= 0 && summary.cujong.stamps <= 3);
  for (const p of summary.players) {
    assert.ok(Number.isInteger(p.targetLp) && p.targetLp >= 0 && p.targetLp <= 10, `${p.playerId} targetLp`);
    assert.ok(Number.isInteger(p.deaths) && p.deaths >= 0, `${p.playerId} deaths`);
  }
  h.invariants();
});

test('styles buff the owner in the sim: 基础 +10 % ATK, 攻坚 +20 ASPD, 控制 ×2.5 status duration', () => {
  const defs = { chess: { t_a: chessRec({ id: 't_a', stats: { atk: 500, aspd: 100, maxHp: 2000, def: 0, res: 0 } }) } };
  const players = (styleId) => [{
    playerId: 'p_0', seat: 0, side: 'L', bonds: {}, bandId: null, styleId: styleId ?? null,
    units: [{ uid: 1, kind: 'chess', chessId: 't_a', row: 10, col: 5, skillIndex: 0, moduleId: null }],
  }];
  const build = (styleId, extra = {}) => makeBattle({ defs, players: players(styleId), content: 'full', seed: 7, ...extra });
  const plain = build(null);
  const basic = build('basic');
  assert.ok(Math.abs(basic.unit(1).s.atk / plain.unit(1).s.atk - 1.1) < 0.005, '基础: +10 % ATK');
  const off = build('offensive');
  assert.equal(off.unit(1).s.aspd - plain.unit(1).s.aspd, 20, '攻坚: +20 ASPD');
  // 控制: a status applied by the owner's operator lasts ×2.5
  const dis = makeBattle({
    defs: { ...defs, enemies: { enemy_styleprobe: enemyRec({ key: 'enemy_styleprobe', hp: 1e7, speed: 0 }) } },
    players: players('disabling'),
    enemies: [{ key: 'enemy_styleprobe', pos: [11, 8] }],
    content: 'full', seed: 7,
  });
  dis.step(); // one step: the t=0 spawn lands (the core harness pattern)
  const enemy = dis.enemy('enemy_styleprobe');
  assert.ok(enemy, 'the dummy enemy spawned');
  assert.equal(dis.battle.applyStatus(enemy, 'stun', { duration: 1, source: dis.unit(1) }), true);
  const left = enemy.findBuff('stun')?.timeLeft;
  assert.ok(left >= 2.4 && left <= 2.6, `控制: stun lasts ${left} (expect ≈ 2.5)`);
});
