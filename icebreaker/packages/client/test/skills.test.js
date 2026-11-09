import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND, SKILL_STATE } from '@aue/schema';
import { rowFill, rowText, skillRows } from '../src/skills.js';

const operators = {
  char_manual: { name: '手动', skill: { type: 'MANUAL' } },
  char_auto: { name: '自动', skill: { type: 'AUTO' } },
  char_plain: { name: '预备' },
};
const keys = new Map([[1, 'char_manual'], [2, 'char_auto'], [3, 'char_plain'], [4, 'char_manual'], [5, 'char_manual']]);

/** @param {Partial<import('@aue/schema').ViewUnit>} u @returns {import('@aue/schema').ViewUnit} */
const unit = (u) => ({ id: 1, kind: KIND.OPERATOR, owner: 0, x: 0, y: 0, z: 0, dir: 0, hp: 1, maxHp: 1, anim: 0, sp: 12, spCost: 45, skill: SKILL_STATE.CHARGING, skillLeft: -1, status: 0, element: 0, ep: 1, burst: 0, ...u });
/** @param {import('@aue/schema').ViewUnit[]} units @returns {import('@aue/schema').View} */
const view = (units) => ({ frame: 1, players: [], units });

test('a charging manual skill shows its SP and cannot start', () => {
  assert.deepEqual(skillRows(view([unit({})]), keys, 0, operators), [
    { id: 1, name: '手动', skill: true, sp: 12, cost: 45, state: SKILL_STATE.CHARGING, left: -1, manual: true, canStart: false },
  ]);
});

test('a ready manual skill can start; a running one cannot', () => {
  const [ready] = skillRows(view([unit({ sp: 45, skill: SKILL_STATE.READY })]), keys, 0, operators);
  assert.equal(ready?.canStart, true);
  const [running] = skillRows(view([unit({ sp: 0, skill: SKILL_STATE.RUNNING, skillLeft: 45 })]), keys, 0, operators);
  assert.equal(running?.canStart, false);
  assert.equal(running?.left, 45);
});

test('an AUTO skill has no button, even when ready', () => {
  const [row] = skillRows(view([unit({ id: 2, skill: SKILL_STATE.READY })]), keys, 0, operators);
  assert.equal(row?.manual, false);
  assert.equal(row?.canStart, false);
});

test('every own operator has a row (one without a skill too); enemies and the other seat are left out; view order is kept', () => {
  const rows = skillRows(view([
    unit({ id: 5 }), unit({ id: 3, sp: -1, skill: SKILL_STATE.NONE }),
    unit({ id: 1, kind: KIND.ENEMY, owner: -1 }), unit({ id: 4, owner: 1 }), unit({ id: 2 }),
  ]), keys, 0, operators);
  assert.deepEqual(rows.map((r) => [r.id, r.skill, r.manual]), [[5, true, true], [3, false, false], [2, true, false]]);
  assert.equal(rowText(/** @type {any} */ (rows[1])), '', 'no skill, no text');
  assert.deepEqual(skillRows(view([unit({ id: 4, owner: 1 })]), keys, 1, operators).map((r) => r.id), [4]);
});

test('an unknown key gets a generic name and no button', () => {
  assert.deepEqual(skillRows(view([unit({ id: 9 })]), keys, 0, operators).map((r) => [r.name, r.manual]), [['干员', false]]);
});

test('the text and the fill', () => {
  const [charging] = skillRows(view([unit({ sp: 12.6 })]), keys, 0, operators);
  assert.ok(charging);
  assert.equal(rowText(charging), '技力 12 / 45');
  assert.ok(Math.abs(rowFill(charging) - (12.6 / 45) * 100) < 1e-9);
  const [running] = skillRows(view([unit({ skill: SKILL_STATE.RUNNING, skillLeft: 45 })]), keys, 0, operators);
  assert.ok(running);
  assert.equal(rowText(running), '运行中 1.5 秒');
  assert.equal(rowFill(running), 100);
  assert.equal(rowText({ ...running, left: -1 }), '运行中');
  assert.equal(rowFill({ ...charging, sp: 99 }), 100);
  assert.equal(rowFill({ ...charging, cost: 0 }), 0);
});
