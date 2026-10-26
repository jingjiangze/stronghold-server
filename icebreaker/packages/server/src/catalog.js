// What the lobby tells a page about team play (docs/spec/room.md): each project with its level's code and name (engine
// 关卡-4), class, the tasks of its two stages (关卡-5), its description and the activity's missions for it (shown at 项目确认); the
// temporary recruits as box entries.
import { LEVELS, TESTING, loadTraining } from '@aue/content';
import { ACTIVITY, DETAILS, MISSIONS, PROJECTS, TRAINING_LEVELS, DEFAULT_STYLE, recruitEntries, styleRunes, stageName } from '@icebreaker/mode-regular';

/**
 * A project as the lobby shows it: its code and name, its stages' tasks (常规项目) or its waves (堡垒守御), the
 * activity's missions, its description; whether its level is being tested (the engine's 关卡-8).
 * @typedef {import('@icebreaker/mode-regular').Project & { code: string, name: string, stages: { title: string, basic: string, advanced?: string, seconds: number }[],
 *   waves: number, missions: readonly string[], detail: string, testing: boolean }} ProjectView
 */

/** The note a project being tested carries at the head of its description (房间-2, the engine's 关卡-8). */
export const TESTING_NOTE = '<color=#FF6E6E>测试中：部分敌人能力未实现</color>';

/** The projects as the lobby shows them. @returns {ProjectView[]} */
export function projectViews() {
  return PROJECTS.map((p) => {
    const lv = LEVELS[p.level].level, own = stageName(p.stage), testing = TESTING.includes(p.level), detail = DETAILS[p.stage] ?? '';
    return { ...p, code: own?.code ?? lv.code, name: own?.name ?? lv.name, stages: (lv.stages ?? []).map((/** @type {any} */ s) => ({ ...s.task, seconds: s.time })),
      waves: lv.waves.length, missions: MISSIONS[p.stage] ?? [], detail: testing ? `${TESTING_NOTE}\n${detail}` : detail, testing };
  });
}

/**
 * The match of a training level (房间-11): its own cards (engine 关卡-7) for seat 0 with 基础专项's runes, nobody for
 * seat 1 — the partner's operators are the level's (engine 波次-7); null for a level that is not a training level here.
 * @param {string} level @param {number} seed @returns {import('@aue/schema').Match | null}
 */
export function trainingMatch(level, seed) {
  const cards = TRAINING_LEVELS.includes(level) ? LEVELS[level]?.level.cards : null;
  if (!cards) return null;
  return { level, difficulty: 'NORMAL', seed, decks: [cards.operators.map((/** @type {any} */ o) => ({ id: o.key, build: o.build })), []], runes: [/** @type {any} */ (styleRunes(DEFAULT_STYLE)), []] };
}

/** The temporary recruits as box entries, each skill they have at the recruit's level. */
export async function recruits() {
  const counts = new Map();
  for (const r of ACTIVITY.recruits) counts.set(r.id, (await loadTraining(r.id)).skills.length);
  return recruitEntries((id) => counts.get(id) ?? 0);
}
