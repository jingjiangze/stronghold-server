// An operator's training limits for entering a box by hand (docs/spec/room.md 房间-3), from its training data
// (@aue/content loadTraining): how far it promotes and levels, which skills each promotion opens and how far they go,
// which modules open at which promotion and level. Pure; the box editor (boxview.js) keeps its entries within them.

/** @typedef {import('@icebreaker/mode-regular').BoxEntry} BoxEntry */
/**
 * What of an operator's training data the limits take.
 * @typedef {{ phases: { maxLevel: number }[], skills: ({ phase: number, levels: unknown[] } | null)[], modules: { phase: number, level: number, levels: unknown[], type?: string }[], potentials?: unknown[] }} Training
 */

/** The highest skill level at each promotion: 4 before the first, 7 after it, mastery (8–10) after the second. */
const SKILL_CAP = [4, 7, 10];

/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Number.isInteger(x) ? x : lo));

/** The highest level of a skill with `levels` levels at a promotion. @param {number} elite @param {number} levels */
export const skillCap = (elite, levels) => Math.min(levels, SKILL_CAP[elite]);

/** The skills open at a promotion (the data's empty slots are none). @param {Training} t @param {number} elite */
export const openSkills = (t, elite) => t.skills.filter(/** @returns {s is { phase: number, levels: unknown[] }} */ (s) => s !== null && s.phase <= elite);

/** Whether a module opens at a promotion and level. @param {Training['modules'][number]} m @param {number} elite @param {number} level */
export const moduleOpen = (m, elite, level) => elite >= m.phase && level >= m.level;

/** The highest potential: one more than the potential steps the data has. @param {Training} t */
export const maxPotential = (t) => 1 + (t.potentials?.length ?? 0);

/**
 * A new box entry: the operator fully promoted and levelled, its open skills and modules at their highest, potential
 * 1, trust 100%. @param {string} id @param {Training} t @returns {BoxEntry}
 */
export function fullEntry(id, t) {
  const elite = t.phases.length - 1, level = t.phases[elite].maxLevel;
  return {
    id, elite, level, potential: 1, trust: 100, skills: openSkills(t, elite).map((s) => skillCap(elite, s.levels.length)),
    modules: t.modules.map((m) => (moduleOpen(m, elite, level) ? m.levels.length : 0)),
  };
}

/** An entry brought within its operator's limits (after a change of promotion or level, or from an old save). @param {BoxEntry} e @param {Training} t @returns {BoxEntry} */
export function clampEntry(e, t) {
  const elite = clamp(e.elite, 0, t.phases.length - 1), level = clamp(e.level, 1, t.phases[elite].maxLevel);
  return {
    id: e.id, elite, level, potential: clamp(e.potential, 1, maxPotential(t)), trust: clamp(e.trust, 0, 200),
    skills: openSkills(t, elite).map((s, i) => clamp(e.skills[i] ?? 1, 1, skillCap(elite, s.levels.length))),
    modules: t.modules.map((m, i) => (moduleOpen(m, elite, level) ? clamp(e.modules[i] ?? 0, 0, m.levels.length) : 0)),
  };
}

/** A skill level as the game writes it: 1–7, then 专精 1–3. @param {number} lv */
export const skillLevelText = (lv) => (lv <= 7 ? `${lv}级` : `专精${lv - 7}`);

/** A promotion and level as the game writes it. @param {BoxEntry} e */
export const trainingText = (e) => `${e.elite > 0 ? `精${e.elite} ` : ''}${e.level}级`;
