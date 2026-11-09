// The controls bar and the match line of the HUD, as pure functions of the state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlButtons, costAskerAfter } from '../src/controls.js';
import { matchText } from '../src/stage.js';

const ids = (/** @type {{ id: string }[]} */ b) => b.map((x) => x.id);

test('the controls: 2× with the mate\'s state, pause or resume, answering the mate\'s pause and cost requests', () => {
  const base = { control: { fast: [0, 0], held: 0, asker: -1, resuming: 0 }, costAsker: -1, seat: 0, mate: 1 };
  assert.deepEqual(ids(controlButtons(base)), ['speed', 'pause', 'ask']);
  assert.equal(controlButtons({ ...base, control: { ...base.control, fast: [0, 1] } })[0].label, '2倍速（协作者已开启）');
  assert.deepEqual(controlButtons({ ...base, control: { ...base.control, fast: [1, 0] } })[0], { id: 'speed', label: '2倍速', act: 'speed-off', on: true });
  assert.deepEqual(ids(controlButtons({ ...base, control: { ...base.control, asker: 1 } })), ['speed', 'pause-yes', 'pause-no', 'ask']);
  assert.equal(controlButtons({ ...base, control: { ...base.control, asker: 0 } })[1].disabled, true, 'own request pending');
  assert.deepEqual(controlButtons({ ...base, control: { ...base.control, held: 1, resuming: 1 } })[1], { id: 'resume', label: '即将继续…', act: 'resume', disabled: true });
  assert.deepEqual(ids(controlButtons({ ...base, costAsker: 1 })), ['speed', 'pause', 'cost-yes', 'cost-no']);
  assert.equal(controlButtons({ ...base, costAsker: 0 })[2].disabled, true);
  assert.deepEqual(ids(controlButtons({ ...base, mate: -1, control: null })), ['speed', 'pause'], 'alone: no cost requests');
  assert.deepEqual(controlButtons({ ...base, control: { ...base.control, held: 1 } })[1], { id: 'resume', label: '继续', act: 'resume', disabled: false });
});

test('a cost request opens with ask and closes with its answer', () => {
  assert.equal(costAskerAfter(-1, [{ type: 'ask', owner: 1 }]), 1);
  assert.equal(costAskerAfter(1, [{ type: 'answer', owner: 1, accept: 1, amount: 5 }]), -1);
  assert.equal(costAskerAfter(1, [{ type: 'answer', owner: 0, accept: 1, amount: 5 }]), 1);
});

test('the match line: stage, objective, rest and time left, stamps, the result', () => {
  const stages = [{ objective: 'protect', goal: 4, time: 150, rest: 0 }, { objective: 'protect', goal: 3, advanced: 5, time: 210, rest: 10 }];
  const status = (/** @type {Partial<import('../src/stage.js').Status>} */ s) => ({ wave: 0, stage: -1, start: 0, stamps: 0, passed: 0, result: -1, ...s });
  assert.equal(matchText(null, stages, 0), '');
  assert.equal(matchText(status({}), stages, 0), '比赛即将开始');
  assert.equal(matchText(status({ stage: 0 }), stages, 30), '第 1 阶段 · 营救 4 · 剩余 149 秒 · 印章 0');
  assert.equal(matchText(status({ stage: 0, passed: 1, stamps: 1 }), stages, 4500), '第 1 阶段完成 · 印章 1');
  assert.equal(matchText(status({ stage: 1, start: 4800, passed: 1, stamps: 1 }), stages, 4530), '第 2 阶段 · 中场休整 9 秒 · 营救 3 → 5');
  assert.equal(matchText(status({ stage: 1, start: 4800, passed: 1, stamps: 1 }), stages, 4800), '第 2 阶段 · 营救 3 → 5 · 剩余 210 秒 · 印章 1', 'the clock starts after the 10 s rest');
  assert.equal(matchText(status({ stage: 1, start: 4800, passed: 1, stamps: 1 }), stages, 5100), '第 2 阶段 · 营救 3 → 5 · 剩余 200 秒 · 印章 1');
  assert.equal(matchText(status({ stage: 1, stamps: 3, passed: 2, result: 1 }), stages, 11101), '比赛胜利 · 嘉奖印章 3');
  assert.equal(matchText(status({ stamps: 1, result: 0 }), stages, 0), '比赛结束 · 嘉奖印章 1');
});
