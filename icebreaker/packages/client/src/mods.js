// The host's mods on the page (docs/spec/page.md 页面-10, the engine's mod-10, mod-11): the content source made from the
// host's list before the page draws anything — the operators to choose from with their records — and the look of an
// operator a mod adds, for its pictures, figure and voice. When the list cannot be read the page goes on with the
// official content; a battle then refuses a host whose content differs (the engine's 同步-10).
import { OFFICIAL_SOURCE, hostedSource } from '@aue/content';
import { modsUrl } from './site.js';

/** @param {string} url @returns {Promise<string>} */
const text = (url) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
});

/** The content source of the host's mods. @type {import('@aue/content').ContentSource} */
export const SOURCE = await hostedSource(modsUrl().href, text).catch((e) => {
  console.warn(`the host's mods: ${e.message}; the official content instead`);
  return OFFICIAL_SOURCE;
});

/** The operators to choose from, the mods' among them. */
export const ROSTER = SOURCE.roster;

/** An operator's record, a mod's too. @param {string} id */
export const loadTraining = (id) => SOURCE.training(id);

/** The id whose pictures, figure and voice an operator has: the official one an added operator looks like, else its own. @param {string} id */
export const lookOf = (id) => SOURCE.roster[id]?.look ?? id;

/** The mods the host has, in load order (none: the official content). */
export const MODS = SOURCE.mods;

/** The line telling a player the host's mods, or null for none: "装了 mod：甲 1.0.0、乙 2.1.0". */
export const moddedText = () => (MODS.length > 0 ? `装了 mod：${MODS.map((m) => `${m.id} ${m.version}`).join('、')}` : null);
