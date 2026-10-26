// The operator select page's list (docs/spec/page.md 页面-9): every operator there is training data for, as the box
// has it or, not in the box yet, at the full training it would join at; filtered by profession, branch and rarity,
// sorted by level or rarity either way, and the operators chosen for a list of the 常规队 in the order they were
// tapped. Pure: the page (lobbyselect.js) draws it.

/**
 * An operator in the list: its roster entry, its training as shown (the box entry's, else the full training of its
 * rarity) and whether the box has it.
 * @typedef {{ id: string, name: string, rarity: number, profession: string, branch: string, elite: number, level: number, potential: number, inBox: boolean }} Row
 */
/** What the list shows: one profession (null: all), one of its branches (null: all), the rarities (empty: all). @typedef {{ profession: string | null, branch: string | null, rarities: number[] }} Filter */
/** How the list is sorted: by level (elite phase, then level) or rarity, from the top down or the other way. @typedef {{ by: 'level' | 'rarity', up: boolean }} Sort */

/** The professions in the game's order, with their names. */
export const PROFESSIONS = Object.freeze(/** @type {const} */ ([['PIONEER', '先锋'], ['WARRIOR', '近卫'], ['TANK', '重装'], ['SNIPER', '狙击'],
  ['CASTER', '术师'], ['MEDIC', '医疗'], ['SUPPORT', '辅助'], ['SPECIAL', '特种']]));

/** An operator's top level at each elite phase by its rarity (1–6), as the game caps them. */
export const MAX_LEVEL = Object.freeze([[30], [30], [40, 55], [45, 60, 70], [50, 70, 80], [50, 80, 90]]);

/** The top level of a rarity at an elite phase. @param {number} rarity @param {number} elite */
export const maxLevelOf = (rarity, elite) => {
  const m = MAX_LEVEL[Math.min(6, Math.max(1, rarity)) - 1];
  return m[Math.min(m.length - 1, Math.max(0, elite))];
};

/** The full training of a rarity (its last elite phase at its top level), as a new box entry gets it (页面-2). @param {number} rarity */
export function fullOf(rarity) {
  const m = MAX_LEVEL[Math.min(6, Math.max(1, rarity)) - 1];
  return { elite: m.length - 1, level: m[m.length - 1] };
}

/**
 * Every operator of the roster as a row. @param {Readonly<Record<string, { name: string, rarity: number, profession: string, branch: string }>>} roster
 * @param {(id: string) => { elite: number, level: number, potential: number } | null} entry the box's entry
 * @returns {Row[]}
 */
export function rowsOf(roster, entry) {
  return Object.entries(roster).map(([id, r]) => {
    const e = entry(id), t = e ?? { ...fullOf(r.rarity), potential: 1 };
    return { id, name: r.name, rarity: r.rarity, profession: r.profession, branch: r.branch, elite: t.elite, level: t.level, potential: t.potential, inBox: !!e };
  });
}

/** The rows a filter shows. @param {readonly Row[]} rows @param {Filter} f */
export const filtered = (rows, f) => rows.filter((r) => (!f.profession || r.profession === f.profession) && (!f.branch || r.branch === f.branch)
  && (!f.rarities.length || f.rarities.includes(r.rarity)));

/** @param {Row} a @param {Row} b */
const byLevel = (a, b) => a.elite - b.elite || a.level - b.level;
/** @param {Row} a @param {Row} b */
const byRarity = (a, b) => a.rarity - b.rarity;

/**
 * The rows sorted (a new array): by the key, then the other key, from the top down unless `up`; operators the same on
 * both keep the roster's order. @param {readonly Row[]} rows @param {Sort} s
 */
export function sorted(rows, s) {
  const [first, then] = s.by === 'level' ? [byLevel, byRarity] : [byRarity, byLevel], k = s.up ? 1 : -1;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => k * (first(a.r, b.r) || then(a.r, b.r)) || a.i - b.i).map((x) => x.r);
}

/**
 * The rows with the list's operators of when the page opened first, in the list's order (the rest as they were).
 * @param {readonly Row[]} rows @param {readonly string[]} first
 */
export function firstOf(rows, first) {
  const at = new Map(first.map((id, i) => [id, i]));
  return [...rows.filter((r) => at.has(r.id)).sort((a, b) => /** @type {number} */ (at.get(a.id)) - /** @type {number} */ (at.get(b.id))), ...rows.filter((r) => !at.has(r.id))];
}

/**
 * The branches of a profession the roster has, in the roster's order. @param {readonly Row[]} rows @param {string} profession
 * @returns {string[]}
 */
export const branchesOf = (rows, profession) => [...new Set(rows.filter((r) => r.profession === profession).map((r) => r.branch))];

/**
 * A tap on an operator: chosen ones leave the list (the ones after move up), others join at its end while it has room.
 * @param {readonly string[]} chosen @param {string} id @param {number} max
 * @returns {{ chosen: string[], full: boolean }} the list after, and whether it was full (nothing changed)
 */
export function tapped(chosen, id, max) {
  if (chosen.includes(id)) return { chosen: chosen.filter((x) => x !== id), full: false };
  if (chosen.length >= max) return { chosen: [...chosen], full: true };
  return { chosen: [...chosen, id], full: false };
}

/**
 * The game's styles of battle texts (gamedata_const.json `richTextStyles`, the ones skill, talent and trait texts use)
 * as Unity rich text.
 */
export const BATTLE_STYLES = Object.freeze(/** @type {Record<string, string>} */ ({
  'ba.vup': '<color=#0098DC>{0}</color>', 'ba.vdown': '<color=#FF6237>{0}</color>', 'ba.rem': '<color=#F49800>{0}</color>',
  'ba.kw': '<color=#00B0FF>{0}</color>', 'ba.pn': '<i>{0}</i>', 'ba.talpu': '<color=#0098DC>{0}</color>',
}));

/**
 * A game text's markup as Unity rich text: `<@style>…</>` in its style (an unknown one keeps its text), a term's
 * `<$…>…</>` its text, the written line breaks as line breaks. @param {string} s
 */
export const gameRich = (s) => s.replace(/<@([\w.]+)>([\s\S]*?)<\/>/g, (_, k, t) => (BATTLE_STYLES[k] ? BATTLE_STYLES[k].replace('{0}', t) : t))
  .replace(/<[$#][^<>]*>|<\/>/g, '').replace(/\n/g, '\n');
