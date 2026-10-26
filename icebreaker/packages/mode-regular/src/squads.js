// The squads a player brings to a room (docs/spec/room.md 房间-3): operators from the player's box, each with its
// training as the box holds it — one level per skill, one stage per module —, in a high-priority and a low-priority
// list. From the network they are untrusted: squadProblem checks them. buildOf turns a box entry into the training a
// match takes (engine spec 同步-9) once its skill and module are chosen (房间-5).
import { buildProblem } from '@aue/schema';

/** The most operators the high-priority list holds; the low-priority list; the fewest a squad needs (房间-3). */
export const SQUAD = Object.freeze({ high: 10, low: 20, min: 20 });

/** @param {string} a @param {string} b */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** An operator id as the game data writes it (char_<n>_<name>). */
const CHAR_ID = /^char_\d{3,4}_[a-z0-9]{1,16}$/;

/**
 * An operator as a player's box holds it: its training but for the skill and module it takes into a match — the level
 * of each of its skills in slot order (1–7, 8–10 the masteries), the stage of each of its modules (0: not unlocked).
 * @typedef {{ id: string, elite: number, level: number, potential: number, trust: number, skills: number[], modules: number[] }} BoxEntry
 */
/** @typedef {{ high: BoxEntry[], low: BoxEntry[] }} Squad */
/** @typedef {import('@aue/schema').Build} Build */

/** @param {unknown} x @param {number} lo @param {number} hi */
const intIn = (x, lo, hi) => Number.isInteger(x) && /** @type {number} */ (x) >= lo && /** @type {number} */ (x) <= hi;

/** @param {unknown} x @returns {x is Record<string, unknown>} */
const isRecord = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

/** @param {unknown} list @param {number} max @param {number} lo @param {number} hi */
const levelsOk = (list, max, lo, hi) => Array.isArray(list) && list.length <= max && list.every((v) => intIn(v, lo, hi));

/** @param {unknown} e @returns {string | null} why a box entry is malformed, or null */
export function entryProblem(e) {
  if (!isRecord(e)) return 'an operator is not an object';
  const keys = Object.keys(e).sort(byText).join();
  if (keys !== 'elite,id,level,modules,potential,skills,trust') return 'an operator has other fields than id, elite, level, potential, trust, skills, modules';
  if (typeof e.id !== 'string' || !CHAR_ID.test(e.id)) return 'an operator id is not a character id';
  if (!levelsOk(e.skills, 3, 1, 10)) return `${e.id}: skills are not up to 3 levels of 1–10`;
  if (!levelsOk(e.modules, 3, 0, 3)) return `${e.id}: modules are not up to 3 stages of 0–3`;
  return buildProblem(buildOf(/** @type {BoxEntry} */ (e), -1, -1));
}

/**
 * Why a squad cannot be brought to a room, or null (房间-3): at most 10 high and 20 low, at least 20 in all, every
 * operator once, every entry well formed.
 * @param {unknown} s @returns {string | null}
 */
export function squadProblem(s) {
  if (!isRecord(s) || Object.keys(s).sort(byText).join() !== 'high,low') return 'a squad is not { high, low }';
  if (!Array.isArray(s.high) || s.high.length > SQUAD.high) return `the high-priority list is not a list of at most ${SQUAD.high}`;
  if (!Array.isArray(s.low) || s.low.length > SQUAD.low) return `the low-priority list is not a list of at most ${SQUAD.low}`;
  if (s.high.length + s.low.length < SQUAD.min) return `a squad needs at least ${SQUAD.min} operators`;
  const seen = new Set();
  for (const e of [...s.high, ...s.low]) {
    const why = entryProblem(e);
    if (why) return why;
    const id = /** @type {BoxEntry} */ (e).id;
    if (seen.has(id)) return `${id} twice in one squad`;
    seen.add(id);
  }
  return null;
}

/**
 * The training a match takes of a box entry with skill slot `skill` (−1: none) and module `module` (−1: none): the
 * skill's level, the module's stage; a skill or module the entry does not have is none.
 * @param {BoxEntry} e @param {number} skill @param {number} module @returns {Build}
 */
export function buildOf(e, skill, module) {
  const s = skill >= 0 && skill < e.skills.length ? skill : -1, m = module >= 0 && (e.modules[module] ?? 0) > 0 ? module : -1;
  return {
    elite: e.elite, level: e.level, potential: e.potential, trust: e.trust, skill: s, skillLevel: s >= 0 ? e.skills[s] : 1,
    ...(m >= 0 ? { module: m, moduleLevel: e.modules[m] } : {}),
  };
}
