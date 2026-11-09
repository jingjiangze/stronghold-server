// Training limits for box entry (docs/spec/page.md 页面-2) and what the room page says (房间-1…5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryProblem } from '@icebreaker/mode-regular';
import { loadTraining } from '@aue/content';
import { fullEntry, clampEntry, skillCap, skillLevelText, trainingText, maxPotential } from '../src/training.js';
import { clock, inviteText, turnText, startingLineup, lineupCount, PHASE_TITLES, CLOSED, styleText } from '../src/roomtext.js';

test('[页面-2] a new six-star: E2 at its top level, its 3 skills at mastery 3, its module at stage 3, potential 1, trust 100%', async () => {
  const t = await loadTraining('char_1035_wisdel'), e = fullEntry('char_1035_wisdel', t);
  assert.deepEqual(e, { id: 'char_1035_wisdel', elite: 2, level: 90, potential: 1, trust: 100, skills: [10, 10, 10], modules: [3] });
  assert.equal(entryProblem(e), null);
  assert.equal(maxPotential(t), 6);
});

test('[页面-2] limits follow the promotion: skills open and cap with it, levels cap at its top, modules open at E2 and their level', async () => {
  const t = await loadTraining('char_1035_wisdel');
  const e1 = clampEntry({ id: 'char_1035_wisdel', elite: 1, level: 99, potential: 9, trust: 300, skills: [10, 10, 10], modules: [3] }, t);
  assert.deepEqual(e1, { id: 'char_1035_wisdel', elite: 1, level: 80, potential: 6, trust: 200, skills: [7, 7], modules: [0] });
  const e0 = clampEntry({ ...e1, elite: 0, level: 0.5, potential: 0, trust: -1 }, t);
  assert.deepEqual(e0, { id: 'char_1035_wisdel', elite: 0, level: 1, potential: 1, trust: 0, skills: [4], modules: [0] });
  assert.deepEqual(clampEntry({ ...e1, elite: 2, level: 59, modules: [3] }, t).modules, [0], 'level 59: the module is not open');
  assert.deepEqual(clampEntry({ ...e1, elite: 2, level: 60, modules: [3] }, t).modules, [3]);
  assert.deepEqual(clampEntry({ ...e1, elite: 2, level: 60, skills: [], modules: [] }, t).skills, [1, 1, 1]);
  const low = await loadTraining('char_285_medic2');
  assert.deepEqual(fullEntry('char_285_medic2', low), { id: 'char_285_medic2', elite: 0, level: 30, potential: 1, trust: 100, skills: [], modules: [] });
  assert.equal(skillCap(1, 10), 7);
});

test('[页面-2] training as the game writes it', () => {
  assert.deepEqual([skillLevelText(7), skillLevelText(8), skillLevelText(10)], ['7级', '专精1', '专精3']);
  assert.equal(trainingText({ id: 'x', elite: 2, level: 90, potential: 1, trust: 0, skills: [], modules: [] }), '精2 90级');
  assert.equal(trainingText({ id: 'x', elite: 0, level: 30, potential: 1, trust: 0, skills: [], modules: [] }), '30级');
});

test('[房间-1] [房间-4] the room page\'s words: countdowns, the invitation with the code in brackets, whose turn, why a room closed', () => {
  assert.deepEqual([clock(900_000), clock(29_001), clock(0), clock(-5)], ['15:00', '0:30', '0:00', '0:00']);
  assert.equal(inviteText('012345', 'A', '9414'), '房间编号[012345],Dr.A#9414邀请您加入赛事，【粘贴到输入框可自动识别】', "the activity's text");
  assert.equal(turnText({ by: 1, yielded: true }, 1), '轮到你选择（对方让出了这次选择）');
  assert.equal(turnText({ by: 0, yielded: false }, 1), '等待对方选择');
  assert.equal(PHASE_TITLES['pick'], '高顺位干员协调');
  assert.ok(CLOSED['host left'] && CLOSED['time'] && CLOSED['kicked']);
});

test('[房间-5] the lineup a player starts from: kept first (10 at most), filled to 6, last skill and first module; 6–10 to set', () => {
  /** @param {string} id */
  const entryOf = (id) => (id === 'none' ? null : { id, elite: 2, level: 90, potential: 1, trust: 0, skills: id === 'a' ? [7, 7] : [], modules: id === 'a' ? [0, 2] : [0] });
  const few = startingLineup({ kept: ['a'], drawn: ['b', 'c', 'd'], extra: ['e', 'none', 'f'] }, entryOf);
  assert.deepEqual(few.map((x) => x.id), ['a', 'b', 'c', 'd', 'e', 'none']);
  assert.deepEqual([few[0], few[1], few[5]], [{ id: 'a', skill: 1, module: 1 }, { id: 'b', skill: -1, module: -1 }, { id: 'none', skill: -1, module: -1 }]);
  const many = startingLineup({ kept: 'abcdefghijkl'.split(''), drawn: ['m'], extra: [] }, entryOf);
  assert.equal(many.length, 10);
  assert.equal(lineupCount(few), null);
  assert.match(String(lineupCount(few.slice(0, 5))), /6–10.*5/);
  assert.match(String(lineupCount([...many, ...few])), /16/);
});

test('[房间-3] a play style as the page names it: name, what it gives and costs, its carried unit; markup left out', () => {
  assert.equal(styleText('buff_1'), '基础（我方干员的攻击力+10%；携带物：赛场啦啦队）');
  assert.equal(styleText('buff_3'), '游走（我方干员再部署时间减少20%，初始技力提升10；我方干员可部署人数减少1；携带物：混乱烟花箱）');
  assert.equal(styleText(''), '—');
});
