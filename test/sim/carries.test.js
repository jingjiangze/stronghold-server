// 促融共竞 风格携带物 (P6), sim side: the six carries of server/sim/content/styles.js — the both-sides 30 s window
// buffs (啦啦队 / 护具 / 能量饮料), the 烟花箱's opening burst (battleStart fires BEFORE the first tick's spawns, so the
// enemySpawn window is what catches the opening wave — a battleStart-only sweep would read as a dead carry), the
// 汽水机's deterministic SP gift and the 反射镜's stun (its 5 s stretched to 12.5 s by the SAME style's ×2.5) — plus
// the per-STYLE dedupe: both players on one style carry ONE item, never two (a double 汽水机 would gift +6 per window).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const PROBE = 'enemy_carryprobe';
const defs = {
  chess: {
    t_a: chessRec({ id: 't_a', stats: { atk: 500, aspd: 100, maxHp: 2000, def: 200, res: 10, spRecovery: 0 } }),
    t_b: chessRec({ id: 't_b', stats: { atk: 500, aspd: 100, maxHp: 2000, def: 200, res: 10, spRecovery: 0 } }),
  },
  enemies: { [PROBE]: enemyRec({ key: PROBE, hp: 1e8, speed: 0 }) },
};
const players = (styleA, styleB) => [
  { playerId: 'p_0', seat: 0, side: 'L', bonds: {}, bandId: null, styleId: styleA ?? null,
    units: [{ uid: 1, kind: 'chess', chessId: 't_a', row: 10, col: 5, skillIndex: 0, moduleId: null }] },
  { playerId: 'p_1', seat: 1, side: 'R', bonds: {}, bandId: null, styleId: styleB ?? null,
    units: [{ uid: 2, kind: 'chess', chessId: 't_b', row: 10, col: 8, skillIndex: 0, moduleId: null }] }, // board cols 2–10; side R mirrors at deploy
];
const build = (styleA, styleB, opts = {}) => makeBattle({ defs, players: players(styleA, styleB), content: 'full', seed: 7, ...opts });

test('基础 → 赛场啦啦队: +20 % ATK on BOTH sides for the 30 s window, then it lapses', () => {
  const plain = build(null, null);
  const h = build('basic', null);
  const ratio = (uid) => h.unit(uid).s.atk / plain.unit(uid).s.atk;
  // the own side stacks 基础 style (+10 %) with its carry (+20 %): additive atkPct keys → 1.3
  assert.ok(Math.abs(ratio(1) - 1.3) < 0.005, `own side style + carry (${ratio(1)})`);
  assert.ok(Math.abs(ratio(2) - 1.2) < 0.005, `the PARTNER's side +20 % only (${ratio(2)})`);
  h.run(31);
  assert.ok(Math.abs(h.unit(1).s.atk / plain.unit(1).s.atk - 1.1) < 0.005, 'carry lapsed after 30 s (the style stays)');
  assert.ok(Math.abs(h.unit(2).s.atk / plain.unit(2).s.atk - 1) < 0.005, 'the partner is back to plain');
});

test('驻场 → 护具分发员: one 6000 shield per side for the window, absorbing untyped damage (no shieldType)', () => {
  const h = build('anchoring', null);
  for (const uid of [1, 2]) {
    const b = h.unit(uid).findBuff('carry:gear:shield');
    assert.ok(b, `unit ${uid} carries the shield`);
    assert.equal(b.shield, 6000);
    assert.ok(b.timeLeft > 29 && b.timeLeft <= 30, `30 s window (${b.timeLeft})`);
  }
  // 全种类: a sourceless true hit of 800 is absorbed by the shield, the HP stays (damage.js absorbShields)
  const u = h.unit(1);
  h.step(); // the battle-start deployment (damage needs a deployed target)
  h.b.dealDamage(null, u, { amount: 800, type: 'true', canDodge: false, sourceless: true });
  assert.equal(u.hp, u.s.maxHp, 'no HP lost');
  assert.equal(u.findBuff('carry:gear:shield').shield, 5200, 'the shield took the hit');
});

test('游走 → 混乱烟花箱: 3000 true damage to the opening wave, once — the window catches the first spawns', () => {
  const h = build('roaming', null, { enemies: [{ key: PROBE, pos: [11, 8] }] });
  h.step(); // the t=0 spawn lands
  const e = h.enemy(PROBE);
  assert.ok(e, 'the probe spawned');
  assert.equal(Math.round(1e8 - e.hp), 3000, 'the opening burst hit');
  h.run(3); // past the window: no repeats
  assert.equal(Math.round(1e8 - e.hp), 3000, 'a one-shot burst, not a duration');
});

test('攻坚 → 猛兽能量饮料: +100 ASPD with 防御/法抗 at 0 on both sides', () => {
  const plain = build(null, null);
  const h = build('offensive', null);
  // the own side stacks the 攻坚 style (+20 ASPD) with its carry (+100); the partner takes the carry only
  assert.equal(h.unit(1).s.aspd - plain.unit(1).s.aspd, 120, 'own side style + carry');
  assert.equal(h.unit(2).s.aspd - plain.unit(2).s.aspd, 100, 'the partner +100');
  for (const uid of [1, 2]) {
    assert.equal(h.unit(uid).s.def, 0, `unit ${uid} def → 0`);
    assert.equal(h.unit(uid).s.res, 0, `unit ${uid} res → 0`);
  }
});

test('支援 → 喷射汽水机: one +3 SP gift each 4 s — and ONE install shared by two 支援 players', () => {
  const h = build('supportive', 'supportive'); // both sides pick 支援: the SAME carry must not install twice
  const spOf = () => (h.unit(1).skill?.sp ?? 0) + (h.unit(2).skill?.sp ?? 0);
  assert.equal(spOf(), 0);
  h.run(4.5);
  assert.equal(spOf(), 3, 'one gift in the first window (a double install would read 6)');
  h.run(4.5);
  assert.equal(spOf(), 6, 'the second window gifts again');
});

test('控制 → 迷幻反射镜: 每 10 s stuns in-range enemies — composed with its own style (5 s × 2.5 = 12.5 s)', () => {
  const ranged = chessRec({ id: 't_a', stats: { atk: 500, aspd: 100, maxHp: 2000, def: 200, res: 10, spRecovery: 0 }, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]] });
  const h = makeBattle({
    defs: { chess: { t_a: ranged, t_b: defs.chess.t_b }, enemies: defs.enemies },
    players: players('disabling', null),
    enemies: [{ key: PROBE, pos: [10, 8] }], // inside the operator's 4-tile east range
    content: 'full', seed: 7,
  });
  h.step();
  const e = h.enemy(PROBE);
  assert.ok(e, 'the probe spawned');
  assert.equal(e.findBuff('stun'), null, 'nothing before the 10 s mark');
  h.run(10.2);
  const st = e.findBuff('stun');
  assert.ok(st, 'stunned at the 10 s mark');
  assert.ok(st.timeLeft > 12.1 && st.timeLeft <= 12.5, `5 s stretched by the 控制 style ×2.5 (${st.timeLeft})`);
  h.run(0.6); // the amplifier refreshes on its own 0.5 s cadence, one tick after the stun lands
  assert.ok(e.findBuff('carry:mirror:amp'), 'the +40 % taken-damage amplifier rides the abnormal state');
});
