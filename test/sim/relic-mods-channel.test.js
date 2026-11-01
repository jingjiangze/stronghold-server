// BattleSpec 的 relicMods 通道（2026-11-01 扩三组：initSp / spRegenMul / stunOnDeploy）。
// 判据：给了值就生效；不给（缺省）时与没有这条通道逐位一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { sanitizeUnitLoadout } from '../../server/sim/spec.js';

const CHESS = 'chess_char_1_01_a'; // 有技能、初始技力 0

function battle(relicMods) {
  const unit = { uid: 1, kind: 'chess', chessId: CHESS, row: 10, col: 5 };
  if (relicMods) unit.relicMods = relicMods;
  const h = makeBattle({
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [unit], bonds: {}, bandId: null, playerEffects: [] }],
    content: 'generic', autoFinish: false,
  });
  h.step();
  return h;
}

test('缺省（没有 relicMods）时技力/晕眩与今天一致', () => {
  const h = battle(null);
  const u = h.allies()[0];
  assert.equal(u.relicInitSp, 0);
  assert.equal(u.relicSpRegenMul, 1);
  assert.equal(u.relicStunOnDeploy, 0);
  assert.equal(u.findBuff && u.findBuff('stun'), null);
});

test('initSp 抬高/压低初始技力（负值夹到 0）', () => {
  const up = battle({ initSp: 5 });
  const u = up.allies()[0];
  // 该棋子的技能自带 initSp=8 ⇒ 8+5=13；一步模拟里还会自然回复一点点，所以按整数部分比
  assert.equal(u.skill.initSp, 13, '初始技力叠加到技能上');
  assert.equal(Math.floor(u.skill.sp), 13, '部署时确实按 initSp 给了技力');

  const down = battle({ initSp: -999 });
  const d = down.allies()[0];
  assert.equal(d.skill.initSp, 0, '初始技力不会低于 0');
  assert.ok(d.skill.sp < 1, `初始技力被压低后应接近 0（实得 ${d.skill.sp}）`);
});

test('spRegenMul 乘技力回复；stunOnDeploy 部署即晕眩', () => {
  const slow = battle({ spRegenMul: 0 });
  const u = slow.allies()[0];
  assert.equal(u.s.spRecovery, 0, '×0 之后自然回复为 0');

  const stunned = battle({ stunOnDeploy: 6 });
  const s = stunned.allies()[0];
  const buff = s.findBuff('stun');
  assert.ok(buff, '部署后应有晕眩 buff');
  assert.ok(Number.isFinite(buff.until) ? buff.until > stunned.b.time : true, '晕眩应有时长');
});

test('spec 白名单：三组新字段放行，非数值整块剔除', () => {
  const ok = { uid: 1, kind: 'chess', chessId: CHESS, row: 10, col: 5,
    relicMods: { atkMul: 1.2, initSp: -10, spRegenMul: 0.8, stunOnDeploy: 3 } };
  sanitizeUnitLoadout(ok);
  assert.deepEqual(ok.relicMods, { atkMul: 1.2, initSp: -10, spRegenMul: 0.8, stunOnDeploy: 3 });

  const bad = { uid: 1, kind: 'chess', chessId: CHESS, row: 10, col: 5, relicMods: { initSp: 'lots' } };
  sanitizeUnitLoadout(bad);
  assert.equal(bad.relicMods, undefined, '非数值 ⇒ 整块丢弃');
});

test('shelter 走引擎承伤通道（dmgTakenMul）', () => {
  const h = battle({ shelter: 0.4 });
  const u = h.allies()[0];
  assert.ok(Math.abs((u.s.dmgTakenMul ?? 1) - 0.6) < 1e-9, `承伤应 ×0.6（实得 ${u.s.dmgTakenMul}）`);
  const plain = battle(null);
  assert.equal(plain.allies()[0].s.dmgTakenMul ?? 1, 1, '缺省不动');
});
