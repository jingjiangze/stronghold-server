// @icebreaker/mode-regular: 常规项目: the projects of team play, the allocation's times and lineup size, the temporary
// recruits and the playing styles (docs/spec/room.md), from the game's activity table (data/act1multi.json, made by
// tools/extract-activity.js). The battle rules of the mode — objectives, the two stages, the stamps — are the engine's (合作-6…8).
import data from '../data/act1multi.json' with { type: 'json' };

export { SQUAD, squadProblem, entryProblem, buildOf } from './squads.js';
export { MARKS, MARK_TYPES, markAllowed, signalRule } from './signals.js';
/** @typedef {import('./squads.js').BoxEntry} BoxEntry @typedef {import('./squads.js').Squad} Squad */

/** The activity's data as extracted, with its source. */
export const ACTIVITY = data;

/**
 * A project of team play (房间-2): its stage (the activity's id), its mode (常规项目 NORMAL, 堡垒守御 DEFENCE), the level
 * it plays, the difficulty its content is assembled at, its class (初级赛, 特级赛…).
 * @typedef {{ stage: string, mode: 'NORMAL' | 'DEFENCE', level: string, difficulty: 'NORMAL' | 'FOUR_STAR', class: string, className: string }} Project
 */

/** 堡垒守御's stages (房间-2) as the activity has them: each its level, class, code, name, picture, description and missions. */
const DEFENCE_STAGES = /** @type {Record<string, { level: string, class: string, code: string, name: string, picture: string, detail: string, missions: string[] }>} */ (data.defence.stages);

/** 常规项目's stages (房间-2) as the stage table has them: each its level, code and name. */
const NORMAL_STAGES = /** @type {Record<string, { level: string, code: string, name: string }>} */ (data.names);

/**
 * A project of a mode at a stage, in the class the activity puts it: a 高级赛 stage plays its level at the harder
 * difficulty (房间-2, 房间-13). @param {'NORMAL' | 'DEFENCE'} mode @param {string} stage
 */
function project(mode, stage) {
  const cls = mode === 'DEFENCE' ? DEFENCE_STAGES[stage].class : /** @type {Record<string, string>} */ (data.stages)[stage];
  const level = mode === 'DEFENCE' ? DEFENCE_STAGES[stage].level : NORMAL_STAGES[stage].level;
  const difficulty = /** @type {'NORMAL' | 'FOUR_STAR'} */ (cls === 'DIFFICULTY' ? 'FOUR_STAR' : 'NORMAL');
  return Object.freeze({ stage, mode, level, difficulty, class: cls, className: /** @type {Record<string, string>} */ (data.classes)[cls] });
}

/**
 * The projects played here (房间-2): the 常规项目 stages whose levels the engine plays in full — IG-1, IG-10, IG-14 and
 * the 高级赛 IG-EX-1, IG-EX-10, IG-S-2 —; 堡垒守御's IG-DF-1, IG-DF-4 and IG-S-5, being tested (the engine's 关卡-8).
 * @type {readonly Project[]}
 */
export const PROJECTS = Object.freeze([
  ...['act1multi_01', 'act1multi_06', 'act1multi_rm07', 'act1multi_ex01', 'act1multi_ex06', 'act1multi_hard-02'].map((stage) => project('NORMAL', stage)),
  ...['act1multi_fortress-rm01', 'act1multi_fortress-ex-rm01', 'act1multi_fortress-hard-01'].map((stage) => project('DEFENCE', stage)),
]);

/** 堡垒守御's mode as the projects show it (页面-5): its type, name, icon id and colour. */
export const DEFENCE_MODE = Object.freeze({ ...data.defence.mode });

/** A stage's code and name (stage_table, 关卡-4): IG-EX-1 for 高级赛's IG-1; null for a stage the activity has not. @param {string} stage */
export function stageName(stage) {
  const s = Object.hasOwn(DEFENCE_STAGES, stage) ? DEFENCE_STAGES[stage] : Object.hasOwn(NORMAL_STAGES, stage) ? NORMAL_STAGES[stage] : null;
  return s ? { code: s.code, name: s.name } : null;
}

/** The activity's classes by type (训练场, 初级赛, 高级赛, 特级赛). @type {Readonly<Record<string, string>>} */
export const CLASS_NAMES = Object.freeze({ ...data.classes });

/** Each step's time in milliseconds (房间-2, 房间-4, 房间-5). */
export const STEP_MS = Object.freeze({
  confirm: data.steps.ENTRANCE.seconds * 1000, pick: data.steps.CHAR_PICK.seconds * 1000, lineup: data.steps.SQUAD_CHECK.seconds * 1000,
});

/** From how many milliseconds left a step's countdown shows its warning (the activity's `hintTime`; 页面-6). */
export const STEP_HINT_MS = Object.freeze({
  confirm: data.steps.ENTRANCE.hint * 1000, pick: data.steps.CHAR_PICK.hint * 1000, lineup: data.steps.SQUAD_CHECK.hint * 1000,
});

/** Each 常规项目 and 堡垒守御 stage's preview picture (the activity's `previewIconId`; 页面-6). @type {Readonly<Record<string, string>>} */
export const PICTURES = Object.freeze({ ...data.pictures, ...Object.fromEntries(Object.entries(DEFENCE_STAGES).map(([k, s]) => [k, s.picture])) });

/** Each stage's description as Unity rich text (stage_table's `description`; 页面-6). @type {Readonly<Record<string, string>>} */
export const DETAILS = Object.freeze({ ...data.details, ...Object.fromEntries(Object.entries(DEFENCE_STAGES).map(([k, s]) => [k, s.detail])) });

/** Each stage's missions in their order (the activity's `missionIdList` descriptions; 页面-6). @type {Readonly<Record<string, readonly string[]>>} */
export const MISSIONS = Object.freeze({ ...data.missions, ...Object.fromEntries(Object.entries(DEFENCE_STAGES).map(([k, s]) => [k, s.missions])) });

/** The activity's toasts of the room flow (页面-6). @type {Readonly<Record<string, string>>} */
export const TOASTS = Object.freeze({ ...data.toasts });

/**
 * The emotes (房间-7): the enabled themes, each scene's emotes in order (room: 项目调整, pick: the allocation, battle:
 * the match), their texts, the seconds between two of a player's emotes (cd) and the seconds one shows (time).
 * @type {Readonly<{ themes: readonly string[], scenes: Readonly<Record<'room' | 'pick' | 'battle', readonly string[]>>, text: Readonly<Record<string, string>>, cd: number, time: number }>}
 */
export const EMOTES = Object.freeze({ ...data.emotes, themes: Object.freeze([...data.emotes.themes]), scenes: Object.freeze({ ...data.emotes.scenes }), text: Object.freeze({ ...data.emotes.text }) });

/** 互选模式 (房间-8): whether a room starts with it on and the hint the screens show while it is on. @type {Readonly<{ on: boolean, hint: string }>} */
export const INVERSE = Object.freeze({ ...data.inverse });

/**
 * 快速匹配 (房间-9): how long a match is looked for (seconds), the classes of 常规项目 one may match for (and whether each
 * is selected at first), the match positions (常规选手, 学员, 教练) with their texts and whether they need an unlock.
 * The activity's modes in the match page's order (only 常规项目 is played here).
 * @type {Readonly<{ seconds: number, modes: readonly { type: string, name: string }[], classes: readonly { class: string, first: boolean }[],
 *   positions: readonly { id: string, name: string, desc: string, toast: string, found: string, locked: boolean, hint: string }[] }>}
 */
export const MATCH = Object.freeze({ ...data.match });

/**
 * The training levels (房间-11): the training modes in the activity's order (常规项目, 阵地足球, 堡垒守御; only 常规项目's is
 * played here) with their names, icons, levels and the hint while locked, and the tutorial scripts its levels' waves
 * tell, by name: each command with its arguments and its text as rich text; the story variables (`$name`) they use.
 * @type {Readonly<{ modes: readonly { id: string, mode: string, name: string, icon: string, levels: readonly string[], hint: string }[],
 *   stories: Readonly<Record<string, readonly { cmd: string, args: Record<string, string | number | boolean>, text?: string }[]>>, vars: Readonly<Record<string, string | number>> }>}
 */
export const TRAINING = Object.freeze({ .../** @type {any} */ (data.training) });

/** The training levels the platform plays (房间-11): those of 常规项目's training mode. */
export const TRAINING_LEVELS = Object.freeze(data.training.modes.filter((m) => m.mode === 'NORMAL').flatMap((m) => m.levels));

/**
 * The scene of the emotes a room phase allows (房间-7, INF-0019): the room's at 项目调整, the allocation's from the
 * coordination to 准备就绪, none at 项目确认 or in the match. @param {string | null | undefined} phase @returns {'room' | 'pick' | null}
 */
export const emoteSceneOf = (phase) => (phase === 'setup' ? 'room' : phase === 'pick' || phase === 'lineup' ? 'pick' : null);

/** The name cards' title of a player who chose none (页面-6). */
export const PLAYER_TITLE = data.title;

/** The invitation a host copies (房间-1): `{0}` the room code, `{1}` the host's name, `{2}` its 代号. */
export const INVITE = data.invite;

/** The latency texts (页面-6): each from its threshold in ms, `{0}` the latency, in the game's colours as rich text. */
export const PINGS = Object.freeze(data.pings.map((p) => Object.freeze({ ...p })));

/** The fewest and most operators of a lineup (房间-5). */
export const LINEUP = Object.freeze({ ...data.lineup });

/**
 * The temporary recruits as box entries (房间-5): their training, every skill they have at the recruit's skill level.
 * @param {(id: string) => number} skillCount how many skills an operator has
 * @returns {import('./squads.js').BoxEntry[]}
 */
export const recruitEntries = (skillCount) => data.recruits.map((r) => ({
  id: r.id, elite: r.elite, level: r.level, potential: r.potential, trust: r.trust, skills: Array.from({ length: skillCount(r.id) }, () => r.skillLevel), modules: [],
}));

/** @typedef {{ key: string, professions: number, board: [string, number | string][] }} SeatRune */
/**
 * A play style (房间-3): its id, name, icon (the atlas sprite's name, 页面-5), colour, what it gives and costs, its
 * carried unit (name, what it does, its unit id) and its runes as a match carries them (engine 符文-1…6).
 * @typedef {{ id: string, name: string, icon: string, color: string, buff: string, debuff: string, device: { name: string, desc: string, key: string }, runes: SeatRune[] }} Style
 */

/** The play styles of team play, in the activity's order (房间-3). @type {readonly Style[]} */
export const STYLES = Object.freeze(data.styles.map((s) => {
  const card = s.runes.find((r) => r.key === 'insert_token_card'), key = card?.board.find(([k]) => k === 'token_key')?.[1];
  return Object.freeze({ ...s, device: { ...s.device, key: String(key ?? '') }, runes: /** @type {SeatRune[]} */ (s.runes) });
}));

/** The mode of team play's projects (页面-5): its type, name, icon id and colour, as the activity has them. */
export const MODE = Object.freeze({ ...data.mode });

/** The modes the projects are of (页面-5), by type: 常规项目 and 堡垒守御. */
export const MODES = Object.freeze({ NORMAL: MODE, DEFENCE: DEFENCE_MODE });

/** A project's mode (页面-5); 常规项目 for one that names none. @param {{ mode?: string } | null | undefined} p */
export const modeOf = (p) => (p?.mode === 'DEFENCE' ? DEFENCE_MODE : MODE);

/** The style a player brings when it has chosen none (房间-3): the first, 基础. */
export const DEFAULT_STYLE = STYLES[0].id;

/** A style's runes for the match (房间-6), or null for an id that is not a style. @param {string} id @returns {SeatRune[] | null} */
export const styleRunes = (id) => STYLES.find((s) => s.id === id)?.runes ?? null;
