// Extracts what 常规项目 takes from the game's activity table (docs/spec/room.md, page.md): the steps' times and the
// lineup's size, the temporary recruits, the playing styles (with their icons, 页面-5), the emotes (房间-7, with the
// display table's emote data), the training levels with their tutorials (房间-11) and the mode of the co-op activity act1multi.
// Usage: node tools/extract-activity.js --gamedata <ArknightsGameData checkout>
// Writes packages/mode-regular/data/act1multi.json (the same input gives byte-identical output).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { richText, storyOf } from '../packages/mode-regular/src/story.js';

const ACTIVITY = 'act1multi';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'mode-regular', 'data', `${ACTIVITY}.json`);
const ELITE = Object.freeze({ PHASE_0: 0, PHASE_1: 1, PHASE_2: 2 });
/** The toasts of the activity's room flow the lobby screens show (页面-6), and the server's refusals (站点-2). */
const TOASTS = Object.freeze(['noRoom', 'fullRoom', 'roomIdFormatError', 'roomIdCopySuccess', 'roomCollaboratorJoinRoom', 'roomCollaboratorExitRoom',
  'roomOwnerReviseMap', 'roomCollaboratorReviseMap', 'matchPrepareRoomClose', 'continuousClicks', 'serverOverload', 'roomOwnerReviseMode', 'roomCollaboratorReviseMode',
  'matchNoProject', 'matchAliveFailed', 'mentorLockTips', 'noRoom']);

/** @param {string} file @returns {any} */
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** @param {string} dir */
function commitOf(dir) {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'unknown'; }
}

/** The trust percent of favour points (the favour table's frames: the last frame at or under them). @param {any} favor @param {number} points */
function trustOf(favor, points) {
  let pct = 0;
  for (const f of favor.favorFrames) if (f.data.favorPoint <= points) pct = Math.max(pct, f.data.percent);
  return pct;
}

/** A blackboard as [key, value or text] pairs in order. @param {any[]} bb */
const board = (bb) => bb.map((b) => [b.key, b.valueStr ?? b.value]);


/**
 * The title of a player who chose none (页面-6): the activity's first front part and first back part by their order
 * (平凡的 + 博士). @param {Record<string, { order: number, titleDesc: string, isBack: boolean }>} titles
 */
function defaultTitle(titles) {
  const first = (/** @type {boolean} */ back) => Object.values(titles).filter((t) => t.isBack === back).sort((x, y) => x.order - y.order)[0]?.titleDesc ?? '';
  return first(false) + first(true);
}

/** The emote scenes of 促融共竞 (display_meta_table emoticonData types; 房间-7). */
const SCENES = Object.freeze({ ACTMULTIV3_ROOM: 'room', ACTMULTIV3_PICK: 'pick', ACTMULTIV3_BATTLE: 'battle' });

/**
 * The emotes (房间-7): the activity's enabled themes, its emotes by scene in their order with their texts, the time
 * between two of a player's emotes and how long one shows, in seconds. Every enabled theme has every emote.
 * @param {any} meta display_meta_table's emoticonData @param {any} a the activity
 */
function emotesOf(meta, a) {
  const all = Object.values(meta.emojiDataDict).filter((/** @type {any} */ e) => Object.hasOwn(SCENES, e.type)).sort((/** @type {any} */ x, /** @type {any} */ y) => x.sortId - y.sortId);
  /** @type {Record<string, string[]>} */
  const scenes = { room: [], pick: [], battle: [] };
  for (const e of /** @type {any[]} */ (all)) scenes[SCENES[/** @type {keyof typeof SCENES} */ (e.type)]].push(e.id);
  for (const t of a.enabledEmoticonThemeIdList) {
    const has = new Set(meta.emoticonThemeDataDict[t]), missing = all.filter((/** @type {any} */ e) => !has.has(e.id));
    if (missing.length) throw new Error(`the theme ${t} lacks ${missing.map((/** @type {any} */ e) => e.id).join(', ')}`);
  }
  return { themes: [...a.enabledEmoticonThemeIdList], scenes, text: Object.fromEntries(all.map((/** @type {any} */ e) => [e.id, e.desc])), cd: a.constData.chatCd, time: a.constData.chatTime };
}

/**
 * The training levels (房间-11): each training mode in its levels' order — its mode, the mode's name and icon, its
 * levels, the hint while it is locked —, the stories its levels' waves tell, by their path's last part, and the story
 * variables (`$name`) their arguments use (story_variables.json).
 * @param {string} gamedata @param {any} a the activity @param {any} stageTable @param {Record<string, string>} styles
 */
function trainingOf(gamedata, a, stageTable, styles) {
  const types = Object.values(a.mapTypeDataDict).filter((/** @type {any} */ t) => t.difficulty === 'TRAINING');
  const sort = (/** @type {any} */ t) => a.mapDataDict[t.stageIdInModeList[0]]?.sortId ?? 0;
  const modes = types.sort((x, y) => sort(x) - sort(y)).map((/** @type {any} */ t) => ({
    id: t.modeId, mode: t.mode, name: a.mapModeDataDict[t.mode].name, icon: a.mapModeDataDict[t.mode].iconId, levels: [...t.stageIdInModeList], hint: richText(t.unlockHint ?? '', styles),
  }));
  /** @type {Record<string, ReturnType<typeof storyOf>>} */
  const stories = {};
  for (const m of modes.filter((x) => x.mode === 'NORMAL')) {
    for (const id of m.levels) {
      const level = readJson(join(gamedata, 'levels', `${String(stageTable[id].levelId).toLowerCase()}.json`));
      const keys = level.waves.flatMap((/** @type {any} */ w) => w.fragments.flatMap((/** @type {any} */ f) => f.actions.filter((/** @type {any} */ x) => x.actionType === 'STORY').map((/** @type {any} */ x) => x.key)));
      for (const k of keys) stories[String(k).split('/').pop() ?? k] = storyOf(readFileSync(join(gamedata, 'story', `${String(k).toLowerCase()}.txt`), 'utf8'), styles);
    }
  }
  const known = readJson(join(gamedata, 'story', 'story_variables.json'));
  const used = [...new Set(Object.values(stories).flat().flatMap((c) => Object.values(c.args)).filter((v) => typeof v === 'string' && v.startsWith('$')).map((v) => String(v).slice(1)))].sort();
  const missing = used.filter((k) => !Object.hasOwn(known, k));
  if (missing.length) throw new Error(`story variables not found: ${missing.join(', ')}`);
  return { modes, stories: Object.fromEntries(Object.entries(stories).sort((x, y) => (x[0] < y[0] ? -1 : 1))), vars: Object.fromEntries(used.map((k) => [k, known[k]])) };
}

/**
 * 堡垒守御 (房间-2): its mode as the projects show it, and each of its stages but the training one — the level it plays
 * (its level file), its class, code and name (stage_table), its preview picture, its description and its missions.
 * @param {any} a the activity @param {any} stageTable @param {Record<string, string>} styles
 */
function defenceOf(a, stageTable, styles) {
  const m = a.mapModeDataDict.DEFENCE, types = Object.values(a.mapTypeDataDict).filter((/** @type {any} */ t) => t.mode === 'DEFENCE' && t.difficulty !== 'TRAINING');
  const levelOf = (/** @type {string} */ id) => String(stageTable[id].levelId).toLowerCase().split('/level_').pop() ?? '';
  const stages = types.flatMap((/** @type {any} */ t) => t.stageIdInModeList.map((/** @type {string} */ id) => [id, {
    level: levelOf(id), class: t.difficulty, code: stageTable[id].code, name: stageTable[id].name, picture: a.mapDataDict[id]?.previewIconId ?? '',
    detail: richText(stageTable[id].description ?? '', styles), missions: (a.mapDataDict[id]?.missionIdList ?? []).map((/** @type {string} */ k) => a.targetMissionDataDict[k]?.description ?? ''),
  }]));
  return {
    mode: { type: m.modeType, name: m.name, icon: m.iconId, color: `#${m.color}` },
    stages: Object.fromEntries(stages.sort((x, y) => (x[0] < y[0] ? -1 : 1))),
  };
}

/** @param {string} root */
export function extract(root) {
  const excel = join(root, 'zh_CN', 'gamedata', 'excel');
  const a = readJson(join(excel, 'activity_table.json')).activity.MULTIPLAY_V3[ACTIVITY], favor = readJson(join(excel, 'favor_table.json'));
  const stageTable = readJson(join(excel, 'stage_table.json')).stages, styles = readJson(join(excel, 'gamedata_const.json')).richTextStyles;
  const steps = Object.fromEntries(a.selectStepDataList.map((/** @type {any} */ s) => [s.stepType, { title: s.title, seconds: s.time, hint: s.hintTime }]));
  const normal = new Set(Object.values(a.mapTypeDataDict).filter((/** @type {any} */ t) => t.mode === 'NORMAL').flatMap((/** @type {any} */ t) => t.stageIdInModeList));
  return {
    source: { repo: 'Kengxxiao/ArknightsGameData', commit: commitOf(root), file: 'zh_CN/gamedata/excel/activity_table.json', activity: `MULTIPLAY_V3/${ACTIVITY}` },
    lineup: { min: a.constData.squadMinNum, max: a.constData.squadMaxNum },
    steps,
    mode: { type: a.mapModeDataDict.NORMAL.modeType, name: a.mapModeDataDict.NORMAL.name, icon: a.mapModeDataDict.NORMAL.iconId, color: `#${a.mapModeDataDict.NORMAL.color}` },
    classes: Object.fromEntries(Object.values(a.mapDiffDataDict).map((/** @type {any} */ d) => [d.diffType, d.name])),
    stages: Object.fromEntries(Object.values(a.mapTypeDataDict).filter((/** @type {any} */ t) => t.mode === 'NORMAL')
      .flatMap((/** @type {any} */ t) => t.stageIdInModeList.map((/** @type {string} */ id) => [id, t.difficulty])).sort((x, y) => (x[0] < y[0] ? -1 : 1))),
    // the lobby screens (页面-6): each stage's preview picture, its description (stage_table, the game's markup as
    // rich text) and its missions (the detail and goal panels of 项目确认), the toasts of the room flow
    // each 常规项目 stage's level (its level file) and its code and name (stage_table): 高级赛's IG-EX stages play the
    // 初级赛 levels (房间-2)
    names: Object.fromEntries([...normal].sort().map((id) => [id, { level: String(stageTable[id].levelId).toLowerCase().split('/level_').pop() ?? '', code: stageTable[id].code, name: stageTable[id].name }])),
    pictures: Object.fromEntries(Object.values(a.mapDataDict).filter((/** @type {any} */ m) => normal.has(m.stageId))
      .map((/** @type {any} */ m) => [m.stageId, m.previewIconId]).sort((x, y) => (x[0] < y[0] ? -1 : 1))),
    details: Object.fromEntries([...normal].sort().map((id) => [id, richText(stageTable[id]?.description ?? '', styles)])),
    missions: Object.fromEntries(Object.values(a.mapDataDict).filter((/** @type {any} */ m) => normal.has(m.stageId))
      .map((/** @type {any} */ m) => [m.stageId, m.missionIdList.map((/** @type {string} */ id) => a.targetMissionDataDict[id]?.description ?? '')])
      .sort((x, y) => (x[0] < y[0] ? -1 : 1))),
    toasts: Object.fromEntries(TOASTS.map((k) => [k, a.constToastData[k]])),
    // the name cards' title of a player who chose none, and the latency texts from each threshold in ms (页面-6)
    title: defaultTitle(a.titleDataDict),
    // the invitation a host copies (房间-1): the room code, the host's name and 代号
    invite: a.constData.noMapRoomNumCopyDesc,
    pings: a.constData.pingConds.map((/** @type {any} */ p) => ({ from: p.cond, text: richText(p.txt, styles) })),
    recruits: a.tempCharDataList.map((/** @type {any} */ c) => ({
      id: c.charId, elite: ELITE[/** @type {keyof typeof ELITE} */ (c.evolvePhase)], level: c.level, potential: c.potentialRank + 1, trust: trustOf(favor, c.favorPoint),
      skillLevel: c.mainSkillLevel + c.specializeLevel,
    })),
    emotes: emotesOf(readJson(join(excel, 'display_meta_table.json')).emoticonData, a),
    // 互选模式 (房间-8): whether a room starts with it on, and its hint
    inverse: { on: a.constData.isMatchDefaultInverse, hint: a.constData.inverseModeHint },
    // 快速匹配 (房间-9): the classes of 常规项目 a player may match for (those selected at first), the match positions
    // and how long a match is looked for
    match: {
      seconds: a.constData.maxMatchTime,
      modes: Object.values(a.mapModeDataDict).sort((/** @type {any} */ x, /** @type {any} */ y) => x.quickMatchSortId - y.quickMatchSortId)
        .map((/** @type {any} */ m) => ({ type: m.modeType, name: m.name })),
      classes: Object.values(a.mapTypeDataDict).filter((/** @type {any} */ t) => t.mode === 'NORMAL' && t.difficulty !== 'TRAINING')
        .map((/** @type {any} */ t) => ({ class: t.difficulty, first: t.isDefaultSelectInQuickMatch })),
      positions: Object.values(a.matchPosDataDict).sort((/** @type {any} */ x, /** @type {any} */ y) => y.sortId - x.sortId).map((/** @type {any} */ p) => ({
        id: p.matchPos, name: p.name, desc: p.desc ?? '', toast: richText(p.posToast ?? '', styles), found: richText(p.matchDesc ?? '', styles), locked: !!p.unlockCond, hint: p.unlockCond?.unlockHint ?? '',
      })),
    },
    training: trainingOf(join(root, 'zh_CN', 'gamedata'), a, stageTable, styles),
    defence: defenceOf(a, stageTable, styles),
    // 局内标记 (房间-12): the activity's mark constants as it names them (their reading: INF-0024)
    marks: { markCd: a.constData.markCd, markCond1: a.constData.markCond1, markCond2: a.constData.markCond2 },
    styles: a.squadEffectList.map((/** @type {any} */ s) => ({
      id: s.id, name: s.name, icon: s.iconId, color: s.themeColor, buff: s.buffDesc, debuff: s.debuffDesc,
      device: { name: s.token.name, desc: s.token.desc },
      runes: s.runeData.runes.map((/** @type {any} */ r) => ({ key: r.key, professions: r.selector.professionMask, board: board(r.blackboard) })),
    })),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--gamedata'), root = i >= 0 ? process.argv[i + 1] : process.env['AUE_GAMEDATA'];
  if (!root) throw new Error('--gamedata <dir> (or AUE_GAMEDATA) is required');
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(extract(root), null, 1)}\n`);
  console.log(`wrote ${OUT}`);
}
