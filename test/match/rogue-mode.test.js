// 肉鸽模式的三大随机元素 + 紧急作战 + 幂等聚合（业主 2026-11-01「完成完整肉鸽模式」）。
// 直接调实现（不复制逻辑）：这些函数都在 MatchMeltdown.prototype 上，用一个最小 `this` 就能跑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MatchMeltdown, relicEffectApplied } from '../../plugins/mota/server/match/match/meltdown.js';

const RELICS = JSON.parse(fs.readFileSync(new URL('../../plugins/relics-87/data/relics.json', import.meta.url), 'utf8'));

/** 只够这些纯函数跑起来的最小 self。 */
function fakeMatch({ isRogue = true, round = 1, seed = 20261101, relics = [], modeId = 'mode_multi_normal' } = {}) {
  const ps = { playerId: 'p_0', alive: true, relics: relics.slice(), rogueAffixBonus: null };
  return {
    ps,
    self: {
      modeId, isRogue, round, seed,
      gd: { raw: { relics: RELICS } },
      players: new Map([[ps.playerId, ps]]),
      alivePlayers: () => [ps],
      // 纯函数借过来
      relicPool: MatchMeltdown.prototype.relicPool,
      relicDraftRound: MatchMeltdown.prototype.relicDraftRound,
      relicEnemyMul: MatchMeltdown.prototype.relicEnemyMul,
      relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
      activeBondsOf: MatchMeltdown.prototype.activeBondsOf,
      rogueEventRound: MatchMeltdown.prototype.rogueEventRound,
      rogueRoundAffix: MatchMeltdown.prototype.rogueRoundAffix,
      rogueEmergencyRound: MatchMeltdown.prototype.rogueEmergencyRound,
    },
  };
}

test('藏品节奏：肉鸽 = 开局 + 每 2 回合；协同共竞 = R4/R8/R12', () => {
  const rogue = (r) => MatchMeltdown.prototype.relicDraftRound.call({ isRogue: true }, r);
  const xie = (r) => MatchMeltdown.prototype.relicDraftRound.call({ isRogue: false }, r);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(rogue), [true, true, false, true, false, true]);
  assert.deepEqual([1, 2, 3, 4, 8, 12, 13].map(xie), [false, false, false, true, true, true, false]);
});

test('不期而遇：回合表是 R3 / R6 / R9', () => {
  // 注意：`rogueEventRound(r)` 本身只看回合（不判 isRogue），"只有肉鸽才有"这道门在 phases.js 的调用点
  // （`if (this.isRogue === true && ... rogueEventRound(r))`）—— 测试按实现如实断言，避免把调用点的门写进纯函数测试。
  const at = (r) => MatchMeltdown.prototype.rogueEventRound.call({ isRogue: true }, r);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(at),
    [false, false, true, false, false, true, false, false, true, false]);
});

test('紧急作战：只在 R5 / R9（肉鸽专属）', () => {
  const at = (r, isRogue = true) => MatchMeltdown.prototype.rogueEmergencyRound.call({ isRogue }, r);
  assert.deepEqual([4, 5, 6, 8, 9, 10].map((r) => at(r)), [false, true, false, false, true, false]);
  assert.equal(at(5, false), false);
});

test('每回合词缀：确定性（同 seed 同回合恒定）、三档之一、协同/普通房没有', () => {
  const aff = (round, seed = 7) => MatchMeltdown.prototype.rogueRoundAffix.call({ isRogue: true, seed }, round);
  const a1 = aff(4), a2 = aff(4);
  assert.deepEqual(a1, a2, '同 seed 同回合必须一致');
  for (const r of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const a = aff(r);
    assert.ok(['hp', 'atk', 'speed'].includes(a.kind), `R${r} 的词缀种类异常：${a && a.kind}`);
    assert.ok(Number.isFinite(a.mul) && a.mul > 0 && a.mul < 1, '倍率应是 0~1 的小数');
    assert.ok(typeof a.label === 'string' && a.label.length > 0);
  }
  assert.equal(MatchMeltdown.prototype.rogueRoundAffix.call({ isRogue: false, seed: 7 }, 4), null);
});

test('敌人修正聚合：词缀 + 紧急作战都进同一个 acc（幂等由 combat.js 的 relicApplied 保证）', () => {
  // R5 是紧急作战：hp +0.25 / atk +0.2；词缀另加一档
  const { self } = fakeMatch({ round: 5 });
  const mul = self.relicEnemyMul();
  const aff = self.rogueRoundAffix(5);
  const expectHp = 0.25 + (aff.kind === 'hp' ? aff.mul : 0);
  const expectAtk = 0.2 + (aff.kind === 'atk' ? aff.mul : 0);
  assert.ok(Math.abs(mul.hp - expectHp) < 1e-9, `hp=${mul.hp} != ${expectHp}`);
  assert.ok(Math.abs(mul.atk - expectAtk) < 1e-9, `atk=${mul.atk} != ${expectAtk}`);
  // R4 没有紧急作战
  const r4 = fakeMatch({ round: 4 }).self.relicEnemyMul();
  assert.ok(r4.hp < 0.25 + 1e-9, 'R4 不该吃到紧急作战的 +25%');
});

test('藏品里的 enemy/enemyRank 会累加进敌人修正；非肉鸽房没有词缀/紧急作战', () => {
  // n06（莱塔尼亚权杖·重铸）带 effect.enemy —— p40/p45 是 rule/allyPerBench 类，不参与敌人乘区
  const withRelic = fakeMatch({ isRogue: false, relics: ['n06'] }).self.relicEnemyMul();
  const without = fakeMatch({ isRogue: false, relics: [] }).self.relicEnemyMul();
  assert.notDeepEqual(withRelic, without, '带 enemy 类藏品的敌人修正应不同（n06）');
  // 非肉鸽：没有词缀与紧急作战，回合不改变结果
  const a = fakeMatch({ isRogue: false, round: 5 }).self.relicEnemyMul();
  const b = fakeMatch({ isRogue: false, round: 4 }).self.relicEnemyMul();
  assert.deepEqual(a, b, '非肉鸽房不该因回合变化而改变敌人修正');
});

test('藏品池：87 条、按 id 去重、排除已拥有', () => {
  const { self } = fakeMatch();
  const pool = self.relicPool();
  assert.equal(pool.length, 87, 'relics-87 应提供 87 条');
  assert.equal(new Set(pool.map((r) => r.id)).size, pool.length, 'id 不许重复');
  assert.ok(pool.every((r) => typeof r.id === 'string' && r.id));
});

test('藏品的「本局是否真生效」标记：enemy/immediate/deployCap/lpCap 算生效，rule 类不算', () => {
  assert.equal(relicEffectApplied({ enemy: { atk: 0.1 } }), true);
  assert.equal(relicEffectApplied({ enemyRank: { BOSS: { hp: 0.1 } } }), true);
  assert.equal(relicEffectApplied({ immediate: { funds: 3 } }), true);
  assert.equal(relicEffectApplied({ deployCap: 1 }), true);
  assert.equal(relicEffectApplied({ lpCap: 2 }), true);
  assert.equal(relicEffectApplied({ rule: { id: 'neuralDps' } }), false, '战斗内机制类 rule 尚未接入');
  assert.equal(relicEffectApplied({ rule: { id: 'fundsDrain' } }), true, '经济类 rule 已接入');
  assert.equal(relicEffectApplied({ ally: { atk: 0.1 } }), false, 'ally 类尚未接入');
  assert.equal(relicEffectApplied(null), false);
  // 数据侧盘点：87 条里「有已实现效果」的那批要够用，且 rule 类一律标未生效（诚实暴露给 HUD）
  const relics = RELICS.relics;
  const applied = relics.filter((r) => relicEffectApplied(r.effect)).length;
  const ruleInert = relics.filter((r) => { const e = r.effect || {}; return !!e.rule && !relicEffectApplied(e); }).length;
  assert.ok(applied >= 30, `有实现效果的藏品过少：${applied}/${relics.length}`);
  assert.ok(ruleInert >= 30, `rule 类藏品应仍有一批（≥30 条）未实装：${ruleInert}`);
  assert.equal(applied + relics.filter((r) => !relicEffectApplied(r.effect)).length, relics.length, '未生效 = 总数 - 已生效');
});

test('抽卡池只发「效果已接实现」的藏品（死牌不进三选一），且数据异常时兜底回全池', () => {
  const { self } = fakeMatch();
  self.relicDraftPool = MatchMeltdown.prototype.relicDraftPool;
  const pool = self.relicDraftPool();
  assert.ok(pool.length > 0);
  assert.ok(pool.every((r) => relicEffectApplied(r.effect)), '池子里不许有未实装的藏品');
  assert.ok(pool.length < self.relicPool().length, '这是过滤后的子集（全池 87 条里应更少）');
  // 兜底：数据里一条已实现的都没有时，退回全池而不是空池
  const noLive = { gd: { raw: { relics: { relics: [{ id: 'x1', effect: { rule: { id: 'whatever' } } }] } } },
    relicPool: MatchMeltdown.prototype.relicPool, relicDraftPool: MatchMeltdown.prototype.relicDraftPool };
  assert.equal(noLive.relicDraftPool().length, 1, '没有已实现藏品时退回全池');
});

test('rule 类藏品：ussuri / leaderHalve / enemyDmgTaken / enemyCount 已接实现（语义照官方 desc）', () => {
  const { self } = fakeMatch({ isRogue: false, relics: ['n04'] }); // n04 = 乌萨斯弯刀（ussuri）
  const withUssuri = self.relicEnemyMul();
  // desc：「敌方攻击/防御/生命 +35%，每进入新回合额外 +10%」—— fake 的 round=1 ⇒ 至少 +35%
  assert.ok(withUssuri.hp >= 0.35 - 1e-9, `ussuri 至少要 +35%，实际 ${withUssuri.hp}`);
  assert.ok(withUssuri.atk >= 0.35 - 1e-9);
  // 第 3 回合应更高（+35% + 2×10%）
  const r3 = fakeMatch({ isRogue: false, round: 3, relics: ['n04'] }).self.relicEnemyMul();
  assert.ok(r3.hp > withUssuri.hp + 0.1, 'ussuri 每回合递增');

  // enemyDmgTaken：敌人受伤 −20% ⇒ 等效生命 +25%（近似）
  const dmg = fakeMatch({ isRogue: false, relics: ['n26'] }).self.relicEnemyMul();
  assert.ok(Math.abs(dmg.hp - (1 / 0.8 - 1)) < 1e-9, `enemyDmgTaken 近似应为 +25%，实际 ${dmg.hp}`);

  // 三条 rule 现在都算「已实现」⇒ 会进抽卡池
  for (const id of ['n04', 'n05', 'n26', 'n35']) {
    const def = RELICS.relics.find((r) => r.id === id);
    assert.equal(relicEffectApplied(def.effect), true, `${id} 应算已实现`);
  }
});

test('rule 收集器：同一件藏品只算一次、跨玩家去重', () => {
  const raw = { gd: { raw: { relics: RELICS } }, round: 1, isRogue: false,
    players: new Map([['a', { playerId: 'a', relics: ['n04', 'n04'] }], ['b', { playerId: 'b', relics: ['n04'] }]]),
    relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
    activeBondsOf: MatchMeltdown.prototype.activeBondsOf };
  assert.equal(raw.relicRuleParams('ussuri').length, 1, '同一件藏品只算一次');
});

test('rule 经济：fundsDrain 每回合 −1、最多 5 次；kingCrystal 休整期资金 +5；loseAllFunds 入手清零', () => {
  const mkPs = (relics, funds = 10) => ({ playerId: 'p0', relics: relics.slice(), funds,
    addFunds(n) { this.funds += n; }, dirty() {} });
  const mkSelf = (ps) => ({ gd: { raw: { relics: RELICS } }, players: new Map([[ps.playerId, ps]]),
    relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
    applyRelicRoundEconomy: MatchMeltdown.prototype.applyRelicRoundEconomy,
    relicGrantInstant: MatchMeltdown.prototype.relicGrantInstant });

  const drainPs = mkPs(['n03'], 10);
  const drainSelf = mkSelf(drainPs);
  for (let i = 0; i < 8; i++) drainSelf.applyRelicRoundEconomy();
  assert.equal(drainPs.funds, 5, '8 个回合也只失去 5 点（max=5）');

  const kingPs = mkPs(['p21'], 0);
  mkSelf(kingPs).applyRelicRoundEconomy();
  assert.equal(kingPs.funds, 5, 'kingCrystal：休整期资金 +5');

  const losePs = mkPs(['n34'], 12);
  const loseSelf = mkSelf(losePs);
  const def = RELICS.relics.find((r) => r.id === 'n34');
  loseSelf.relicGrantInstant(losePs, def);
  assert.equal(losePs.funds, 0, 'loseAllFunds：入手清空资金');

  for (const id of ['n03', 'p21', 'n34']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('rule 第三组：postBattleFunds 每战 +1、choiceFunds 每次选择 +8、enemyRamp 开局 +step', () => {
  const mkPs = (relics, funds = 0) => ({ playerId: 'p0', relics: relics.slice(), funds,
    addFunds(n) { this.funds += n; }, dirty() {} });
  const mkSelf = (ps) => ({ gd: { raw: { relics: RELICS } }, round: 1, isRogue: false,
    players: new Map([[ps.playerId, ps]]),
    relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
    applyRelicPostBattle: MatchMeltdown.prototype.applyRelicPostBattle,
    applyRelicChoiceFunds: MatchMeltdown.prototype.applyRelicChoiceFunds,
    relicEnemyMul: MatchMeltdown.prototype.relicEnemyMul,
    activeBondsOf: MatchMeltdown.prototype.activeBondsOf });

  const battlePs = mkPs(['p07'], 0);
  const battleSelf = mkSelf(battlePs);
  battleSelf.applyRelicPostBattle();
  battleSelf.applyRelicPostBattle();
  assert.equal(battlePs.funds, 2, '每场战斗 +1（两次 = 2）');

  const choicePs = mkPs(['p28'], 0);
  mkSelf(choicePs).applyRelicChoiceFunds(choicePs);
  assert.equal(choicePs.funds, 8, '每次选择 +8');

  const ramp = mkSelf(mkPs(['n40'], 0)).relicEnemyMul();
  assert.ok(ramp.hp >= 0.1 - 1e-9 && ramp.atk >= 0.1 - 1e-9, `enemyRamp 开局那一档应 ≥ +10%，实际 ${ramp.hp}`);

  for (const id of ['p07', 'p28', 'n40']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('己方属性通道：atkPerBond 按激活盟约数、atkPerRound 按已过回合（封顶 10）', () => {
  const mk = (relics, { round = 1, bonds = 0 } = {}) => {
    const ps = { playerId: 'p0', relics: relics.slice(), bonds: Object.fromEntries(
      Array.from({ length: bonds }, (_, i) => ['b' + i, { active: true }])) };
    const self = { gd: { raw: { relics: RELICS } }, round, isRogue: false,
      players: new Map([['p0', ps]]),
      relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
      activeBondsOf: MatchMeltdown.prototype.activeBondsOf,
      relicAllyMul: MatchMeltdown.prototype.relicAllyMul };
    return self.relicAllyMul(ps);
  };
  assert.equal(mk(['p16'], { bonds: 0 }), null, '没有激活盟约就没有加成');
  assert.ok(Math.abs(mk(['p16'], { bonds: 3 }).atkMul - 1.3) < 1e-9, '每 1 个盟约 +10% → 3 个 = 1.3');
  assert.ok(Math.abs(mk(['p34'], { round: 5 }).atkMul - 1.6) < 1e-9, '4 个已过回合 × 15% = 1.6');
  assert.ok(Math.abs(mk(['p34'], { round: 20 }).atkMul - (1 + 0.15 * 10)) < 1e-9, '最多叠 10 次');
  for (const id of ['p16', 'p34']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});
