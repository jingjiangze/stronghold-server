// 集成战略 run 规则的单元测试：地图生成、资源、奖励、商店、藏品→战斗。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/index.js';

const TOPICS = ['rogue_1', 'rogue_2', 'rogue_3', 'rogue_4', 'rogue_5', 'rogue_6'];

test('主题一览：六个主题，主区域数 6/7/7/8/8/7', () => {
  const list = R.topicList();
  assert.deepEqual(list.map((t) => t.id), TOPICS);
  assert.deepEqual(list.map((t) => t.zones), [6, 7, 7, 8, 8, 7]);
});

test('地图生成：同一 seed 完全一致，列 4–8、每列 2–4', () => {
  const t = R.topicData('rogue_1');
  const a = R.generateMap(t, 1234), b = R.generateMap(t, 1234);
  assert.deepEqual(a, b);
  for (const zone of a) {
    assert.ok(zone.columns.length >= 4 && zone.columns.length <= 8);
    for (const col of zone.columns) assert.ok(col.length >= 2 && col.length <= 4);
  }
});

test('地图生成：第一列必为作战，最后一层最后一列为首领', () => {
  const t = R.topicData('rogue_1');
  const map = R.generateMap(t, 99);
  for (const zone of map) assert.ok(zone.columns[0].every((n) => n.node === 'BATTLE_NORMAL'));
  const last = map.at(-1).columns.at(-1);
  assert.ok(last.some((n) => n.node === 'BATTLE_BOSS'));
});

test('战斗关卡来自对应区域池，非战斗节点没有关卡', () => {
  const t = R.topicData('rogue_1');
  const map = R.generateMap(t, 7);
  for (const [zi, zone] of map.entries()) {
    for (const col of zone.columns) {
      for (const n of col) {
        if (n.node.startsWith('BATTLE')) assert.ok(n.stage && n.stage.level, `${n.id} 该有图`);
        else assert.equal(n.stage, null);
      }
    }
  }
});

test('战斗回写：胜 → 奖励且进下一列；负 → 扣 1 生命留在本列', () => {
  const run = R.createRun({ topicId: 'rogue_1', seed: 5 });
  const hp0 = run.hp, col0 = run.column;
  assert.equal(R.applyBattle(run, true).next, 'reward');
  assert.equal(run.column, col0 + 1);
  assert.equal(run.hp, hp0);
  const r2 = R.createRun({ topicId: 'rogue_1', seed: 5 });
  assert.equal(R.applyBattle(r2, false).next, 'retry');
  assert.equal(r2.hp, hp0 - 1);
  assert.equal(r2.column, 0);
});

test('生命归零：探索结束', () => {
  const run = R.createRun({ topicId: 'rogue_1', seed: 5 });
  const n = run.hp;
  for (let i = 0; i < n; i++) R.applyBattle(run, false);
  assert.equal(run.status, 'lost');
});

test('奖励：三选一、不重复、领到后进藏品且局外资源结算', () => {
  const run = R.createRun({ topicId: 'rogue_1', seed: 11 });
  run.pending = 'reward';
  const choices = R.rewardChoices(run);
  assert.equal(choices.length, 3);
  assert.equal(new Set(choices.map((c) => c.id)).size, 3);
  const hp0 = run.hp;
  const got = R.takeReward(run, choices[0].id);
  assert.ok(got && run.relics.includes(got.id));
  assert.equal(run.pending, null);
  assert.ok(run.hp >= hp0);
});

test('商店：三件货、钱够成交、钱不够拒绝、售出后从货架移除', () => {
  const run = R.createRun({ topicId: 'rogue_1', seed: 42 });
  run.gold = 50;
  const offers = R.shopOffers(run);
  assert.equal(offers.length, 3);
  const first = offers[0];
  const got = R.buyOffer(run, first.id);
  assert.equal(got.id, first.id);
  assert.equal(run.gold, 50 - first.price);
  assert.ok(!run.shop.some((o) => o.id === first.id));
  const poor = { ...run, gold: 0, shop: offers };
  assert.equal(R.buyOffer(poor, offers[1].id), null);
});

test('藏品 → 战斗：属性类 buff 变成 seat runes 的乘算', () => {
  const run = R.createRun({ topicId: 'rogue_1', seed: 3 });
  run.relics.push('rogue_1_relic_a01');
  const b = R.battleFromRun(run);
  const mul = b.runes.find((r) => r.key === 'char_attribute_mul');
  assert.ok(mul, '该有一条 char_attribute_mul');
  const board = Object.fromEntries(mul.board);
  assert.equal(board.atk, 1.35);
  assert.equal(board.def, 1.35);
  assert.equal(board.max_hp, 1.45);
  assert.equal(mul.professions, 1023, '没有职业选择器 = 全职业');
});

test('难度：grade 5 敌方 ×1.25', () => {
  const run = R.createRun({ topicId: 'rogue_1', seed: 3, grade: 5 });
  const b = R.battleFromRun(run);
  assert.equal(b.scale.max_hp, 1.25);
  assert.equal(b.scale.atk, 1.25);
});

test('runView：给客户端的地图、资源与藏品详情', () => {
  const run = R.createRun({ topicId: 'rogue_1', seed: 1 });
  run.relics.push('rogue_1_relic_a01');
  const v = R.runView(run);
  assert.equal(v.graph.length, 6);
  assert.equal(v.graph[0].current, true);
  assert.equal(v.relicList[0].id, 'rogue_1_relic_a01');
  assert.ok(v.relicList[0].name.length > 0);
  assert.equal(v.hp, run.hp);
});
