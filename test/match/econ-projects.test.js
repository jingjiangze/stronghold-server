// test/match/econ-projects.test.js — 商店设施三项（商店等级 / 协同资金获取 / 装备造价）的效果与上限。
// 实现在 plugins/mota/server/match/match/projectEffects.js；本测试与实现 import 同一份代码，避免复刻版漂移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_MAX_LEVEL, shopLevelOf, equipPriceOf, teamIncomeCapOf } from '../../plugins/mota/server/match/match/projectEffects.js';

test('三项的最大级数是 4 / 3 / 2（与 DEFAULTS 的 costs 长度一致）', () => {
  assert.deepEqual(PROJECT_MAX_LEVEL, { shopLevel: 4, teamIncome: 3, equipCost: 2 });
});

test('商店等级：每级 +1，且不会低于 1、不会超过 20', () => {
  assert.equal(shopLevelOf(3, 0), 3);
  assert.equal(shopLevelOf(3, 1), 4);
  assert.equal(shopLevelOf(6, 4), 10);
  assert.equal(shopLevelOf(0, 0), 1, '空输入也不返回 0 级商店');
  assert.equal(shopLevelOf(19, 4), 20, '上限夹到 20');
  assert.equal(shopLevelOf(3, -5), 3, '负数级数按 0 处理');
});

test('装备造价：每级 -1，但下限 2（装备永远不会免费）', () => {
  assert.equal(equipPriceOf(12, 0), 12);
  assert.equal(equipPriceOf(12, 2), 10);
  assert.equal(equipPriceOf(3, 2), 2, '3-2=1 被下限抬回 2');
  assert.equal(equipPriceOf(2, 2), 2);
  assert.equal(equipPriceOf(12, 9), 3, '超过最大级数时仍只按级数扣（不越界成负数）');
  assert.equal(equipPriceOf(12, 99), 2, '再多的级数也只到下限');
});

test('协同资金获取：每级 +1（加到每回合收入上限上）', () => {
  assert.equal(teamIncomeCapOf(1, 0), 1);
  assert.equal(teamIncomeCapOf(1, 1), 2);
  assert.equal(teamIncomeCapOf(1, 3), 4);
  assert.equal(teamIncomeCapOf(1, -2), 1, '负数按 0 处理');
});

test('三项互不影响：各自只读自己那一级', () => {
  const lv = { shopLevel: 2, teamIncome: 3, equipCost: 1 };
  assert.equal(shopLevelOf(4, lv.shopLevel), 6);
  assert.equal(teamIncomeCapOf(1, lv.teamIncome), 4);
  assert.equal(equipPriceOf(10, lv.equipCost), 9);
});
