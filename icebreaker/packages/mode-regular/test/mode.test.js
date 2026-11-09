// What 常规项目 takes from the activity table (docs/spec/room.md): the MVP's projects and their classes, the steps'
// times, the lineup's size, the temporary recruits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY, PROJECTS, STEP_MS, LINEUP, recruitEntries, STYLES, DEFAULT_STYLE, styleRunes, MISSIONS, DETAILS, PLAYER_TITLE, PINGS, TRAINING, TRAINING_LEVELS, PICTURES,
  DEFENCE_MODE, modeOf, stageName } from '../src/index.js';
import { storyOf } from '../src/story.js';

test('[房间-2] [房间-13] the projects: IG-1, IG-10, IG-14, IG-4 and IG-6 in 初级赛, IG-S-2 in 特级赛; 堡垒守御 IG-DF-1, IG-DF-4 (the same level, harder) and IG-S-5', () => {
  assert.deepEqual(PROJECTS.map((p) => [p.stage, p.mode, p.level, p.difficulty, p.className]), [
    // 高级赛's IG-EX stages play the 初级赛 levels at the harder difficulty
    ['act1multi_01', 'NORMAL', 'act1multi_01', 'NORMAL', '初级赛'], ['act1multi_06', 'NORMAL', 'act1multi_06', 'NORMAL', '初级赛'],
    ['act1multi_rm07', 'NORMAL', 'act1multi_rm07', 'NORMAL', '初级赛'],
    // IG-4 / IG-6：关卡数据一直在磁盘上，原先没接进 LEVELS；敌人有未实现能力，走 TESTING 通道放行
    ['act1multi_07', 'NORMAL', 'act1multi_07', 'NORMAL', '初级赛'], ['act1multi_rm05', 'NORMAL', 'act1multi_rm05', 'NORMAL', '初级赛'],
    ['act1multi_ex01', 'NORMAL', 'act1multi_01', 'FOUR_STAR', '高级赛'], ['act1multi_ex06', 'NORMAL', 'act1multi_06', 'FOUR_STAR', '高级赛'],
    ['act1multi_hard-02', 'NORMAL', 'act1multi_hard-02', 'NORMAL', '特级赛'],
    ['act1multi_fortress-rm01', 'DEFENCE', 'act1multi_fortress_rm01', 'NORMAL', '初级赛'], ['act1multi_fortress-ex-rm01', 'DEFENCE', 'act1multi_fortress_rm01', 'FOUR_STAR', '高级赛'],
    ['act1multi_fortress-hard-01', 'DEFENCE', 'act1multi_fortress_hard-01', 'NORMAL', '特级赛'],
  ]);
  assert.equal(ACTIVITY.source.activity, 'MULTIPLAY_V3/act1multi');
  assert.deepEqual([DEFENCE_MODE.name, DEFENCE_MODE.icon, DEFENCE_MODE.color, modeOf(PROJECTS.find((p) => p.mode === 'DEFENCE')).name, modeOf(PROJECTS[0]).name], ['堡垒守御', 'defence', '#3cbfd0', '堡垒守御', '常规项目']);
  assert.deepEqual([stageName('act1multi_fortress-ex-rm01'), stageName('act1multi_ex01'), stageName('act1multi_99')], [{ code: 'IG-DF-4', name: '团体战竞技场' }, { code: 'IG-EX-1', name: '逃离火线' }, null]);
  assert.equal(PICTURES['act1multi_fortress-hard-01'], 'multi_v3_01-fortress-hard-01_preview');
});

test('[房间-2] [房间-4] [房间-5] the steps\' times and the lineup\'s size from the activity table', () => {
  assert.deepEqual(STEP_MS, { confirm: 30_000, pick: 20_000, lineup: 60_000 });
  assert.deepEqual(LINEUP, { min: 6, max: 10 });
});

test('[页面-6] each project\'s missions in their order and its description, the game\'s markup as rich text', () => {
  assert.deepEqual(MISSIONS['act1multi_01'], ['保护4位乌萨斯平民进入目标点', '保护3位乌萨斯平民进入目标点', '保护5位乌萨斯平民进入目标点']);
  for (const p of PROJECTS) assert.equal(MISSIONS[p.stage]?.length, 3, p.stage);
  assert.match(DETAILS['act1multi_06'], /他们人多。\n<color=#D4133C><玉门天灾工事><\/color>置于其中/);
});

test("[页面-6] the name cards' title of a player who chose none, and the latency texts by threshold in the game's colours", () => {
  assert.equal(PLAYER_TITLE, '平凡的博士');
  assert.deepEqual(PINGS.map((p) => p.from), [1, 60, 200]);
  assert.equal(PINGS[0]?.text, '当前延迟<color=#7fa826>{0}</color>ms');
});

test('[房间-5] the 5 temporary recruits: E2 level 80, potential 1, trust 200%, each skill at level 7 with mastery 3', () => {
  const e = recruitEntries((id) => (id === 'char_508_aguard' ? 2 : 1));
  assert.deepEqual(e.map((x) => x.id), ['char_508_aguard', 'char_511_asnipe', 'char_509_acast', 'char_510_amedic', 'char_513_apionr']);
  assert.deepEqual(e[0], { id: 'char_508_aguard', elite: 2, level: 80, potential: 1, trust: 200, skills: [10, 10], modules: [] });
  assert.deepEqual(e[1].skills, [10]);
});

test('[房间-3] [房间-6] the five play styles with their carried units and their runes as a match carries them; 基础 when none is chosen', () => {
  assert.deepEqual(STYLES.map((s) => [s.id, s.name, s.device.key]), [
    ['buff_1', '基础', 'trap_201_muulco'], ['buff_2', '驻场', 'trap_197_muulwr'], ['buff_3', '游走', 'trap_198_muulas'],
    ['buff_4', '攻坚', 'trap_199_muulrg'], ['buff_5', '支援', 'trap_200_muulcl'],
  ]);
  assert.equal(DEFAULT_STYLE, 'buff_1');
  assert.deepEqual(styleRunes('buff_1'), [
    { key: 'char_attribute_mul', professions: 639, board: [['atk', 1.1]] },
    { key: 'insert_token_card', professions: 384, board: [['token_key', 'trap_201_muulco'], ['level', 1], ['skill', 0], ['count', 1], ['skill_level', 1]] },
  ]);
  assert.equal(styleRunes('buff_9'), null);
});

test('[房间-11] the training modes in their order, 常规项目\'s IG-TR-1 the one played here; its seven tutorials and their variables', () => {
  assert.deepEqual(TRAINING.modes.map((m) => [m.mode, m.name, m.levels.join()]), [['NORMAL', '常规项目', 'act1multi_tr01'], ['FOOTBALL', '阵地足球', 'act1multi_tr02'], ['DEFENCE', '堡垒守御', 'act1multi_tr03']]);
  assert.deepEqual(TRAINING_LEVELS, ['act1multi_tr01']);
  assert.deepEqual(Object.keys(TRAINING.stories), ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => `training_multi_v3_01-01_${x}`));
  assert.deepEqual(TRAINING.vars, { avatar_amiya: 'char_002_amiya', f_lower_dialog_pos_x: -568, f_lower_dialog_pos_y: -217, f_tut_black: 0.6 });
  const a = TRAINING.stories['training_multi_v3_01-01_a'];
  assert.deepEqual(a.map((c) => c.cmd), ['Battle.Pause', 'InputBlocker', 'PopupDialog', 'PopupDialog']);
  assert.match(String(a[3].text), /<color=#0098DC>一位协作者<\/color>/, 'the game\'s markup as rich text');
  assert.ok(MISSIONS['act1multi_tr01']?.length === 3 && DETAILS['act1multi_tr01'] === '熟悉常规项目的比赛规则。');
});

test('[房间-11] a story script: commands with their arguments, a line going on after a backslash, the header left out', () => {
  const text = ['[HEADER(is_tutorial=true)] x', '', '[Battle.Pause]', '[Tutorial(focusX=-50, focusY=70, black=0.5, dialogHead="$avatar_amiya", \\',
    '   animStyle="Highlight")] \\', '<@k>看</>这里', '[Battle.Pause(pause=false)]', 'a line that is no command', '[Delay(time=1.5, mode=fast, on=true, x)]'].join('\r\n');
  assert.deepEqual(storyOf(text, { k: '<color=#0098DC>{0}</color>' }), [
    { cmd: 'Battle.Pause', args: {} },
    { cmd: 'Tutorial', args: { focusX: -50, focusY: 70, black: 0.5, dialogHead: '$avatar_amiya', animStyle: 'Highlight' }, text: '<color=#0098DC>看</color>这里' },
    { cmd: 'Battle.Pause', args: { pause: false } },
    { cmd: 'Delay', args: { time: 1.5, mode: 'fast', on: true } },
  ]);
});
