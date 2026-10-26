// The operator cards of the lobby screens (docs/spec/page.md 页面-6): a card prefab of the pack (the large or the mini
// card) showing an operator of a box — its avatar for the portrait, its name, level, elite phase, profession and
// rarity, its colour by where it comes from, its skill and module — with the battle UI pack's icons for profession,
// elite phase and rarity (the lobby pack has none of its own).
/** @typedef {import('@icebreaker/mode-regular').BoxEntry} BoxEntry @typedef {import('./lobbykit.js').Part} Part */
/**
 * The pictures the cards take from elsewhere: an operator's avatar URL, a profession's icon URL and colour, an elite
 * phase's icon URL, a rarity's URL, a potential's mark URL (by the potential, 1–6), a skill's icon URL, its half-length
 * portrait's URL at an elite phase, a module's type icon URL by its type (uniequip_table's typeName1-typeName2, e.g.
 * EXE-Y) and the mark of its extra type (its typeName2: X, Y, D…), its illustration at an art (1 elite 1, 2 elite 2)
 * with the rect it takes in an illust loader (each null when there is none).
 * @typedef {{ avatar: (id: string) => string | null, portrait: (id: string, elite: number) => string | null,
 *   profession: (p: string) => { url: string | null, color: number[] } | null,
 *   elite: (phase: number) => string | null, rarity: (r: number) => string | null, potential: (p: number) => string | null,
 *   skill: (skillId: string) => string | null, equip: (type: string) => string | null, equipMark: (mark: string) => string | null,
 *   illust: (id: string, art: number) => { url: string, pos: number[], size: number[] } | null }} CardArt
 */
/**
 * A card to show: the operator, its box entry (null: unknown), its name, rarity and profession, where it comes from
 * (its colour: kept high-priority, drawn low-priority, a temporary recruit, other), its chosen skill and module (with
 * the module's type).
 * @typedef {{ id: string, entry: BoxEntry | null, name: string, rarity: number, profession: string, from?: 'kept' | 'drawn' | 'recruit' | 'extra',
 *   skill?: number, skillId?: string | null, module?: number, moduleType?: string | null }} CardData
 */

/** The cards' colour config id by where an operator comes from (the cards' `colorConfigs`: 1 red, 2 grey, 3 blue, 0 light). */
export const FROM_COLOR = Object.freeze({ kept: 1, drawn: 2, recruit: 3, extra: 0 });

/** A card's colour for an id type from its controller's configs. @param {Record<string, any>} f @param {number} id */
const colorOf = (f, id) => (f.colorConfigs ?? []).find((/** @type {any} */ c) => c.idType === id)?.color ?? null;

/**
 * Shows an operator on a card prefab (charcard/char_card_large or char_card_mini) by its controller's references.
 * @param {Part} card @param {CardData} d @param {CardArt} art
 */
export function fillCard(card, d, art) {
  const f = card.view();
  card.show(f.emptyPartGO, false);
  card.show(f.normalPartGO, true);
  // the portrait slot is made for the half-length portrait (taller than the window its mask shows); without one the
  // square avatar fills the window instead, so the face shows (INF-0008)
  const portrait = art.portrait(d.id, d.entry?.elite ?? 0);
  card.picture(f.imgCharPortrait, portrait ?? art.avatar(d.id));
  if (!portrait) card.fillParent(f.imgCharPortrait);
  card.text(f.textLv, d.entry ? String(d.entry.level) : '');
  if (f.textName) card.text(f.textName, d.name);
  const prof = art.profession(d.profession);
  card.picture(f.imgProfession, prof?.url ?? null);
  card.show(f.imgProfession, !!prof?.url);
  card.picture(f.imgElite, d.entry ? art.elite(d.entry.elite) : null);
  card.show(f.imgElite, !!(d.entry && art.elite(d.entry.elite)));
  if (f.imgRarity) card.picture(f.imgRarity, art.rarity(d.rarity));
  fillMarks(card, f, d, art);
  if (f.skillEquipPanelGO) fillSkill(card, f, d, art);
}

/**
 * A card's marks: its potential from the second potential on (INF-0012), its colour by where it comes from, its
 * priority icon. @param {Part} card @param {Record<string, any>} f @param {CardData} d @param {CardArt} art
 */
function fillMarks(card, f, d, art) {
  const pot = d.entry && d.entry.potential >= 2 ? art.potential(d.entry.potential) : null;
  card.show(f.potentialGO, !!pot);
  if (pot) card.picture(f.iconPotential, pot);
  const c = colorOf(f, FROM_COLOR[d.from ?? 'extra']);
  if (c) card.color(f.colorGraphic, c);
  if (f.iconPriGO) {
    card.show(f.iconPriGO, d.from === 'kept' || d.from === 'drawn');
    card.show(f.iconPriHighGO, d.from === 'kept');
    card.show(f.iconPriLowGO, d.from === 'drawn');
  }
}

/** A large card's skill and module panel. @param {Part} card @param {Record<string, any>} f @param {CardData} d @param {CardArt} art */
function fillSkill(card, f, d, art) {
  const skill = d.skill ?? -1, module = d.module ?? -1, lv = d.entry && skill >= 0 ? d.entry.skills[skill] : 0;
  card.show(f.emptySkillPanelGO, skill < 0);
  card.show(f.normalSkillPanelGO, skill >= 0);
  if (skill >= 0) {
    card.picture(f.imgSkillIcon, d.skillId ? art.skill(d.skillId) : null);
    card.text(f.textSkillLv, lv > 7 ? '' : String(lv));
    // a mastered skill shows its mastery mark (the pack's small mastery icons, as the skill items use) in place of its level
    card.show(f.imgSkillSpecLv, lv > 7);
    if (lv > 7) card.sprite(f.imgSkillSpecLv, `sprite/evolve_small_icon_${Math.min(3, lv - 7)}`);
  }
  card.show(f.emptyEquipPanelGO, module < 0);
  card.show(f.normalEquipPanelGO, module >= 0);
  if (module >= 0) card.picture(f.imgEquipIcon, d.moduleType ? art.equip(d.moduleType) : null);
  if (module >= 0 && d.entry) card.text(f.textEquipLv, String(d.entry.modules[module] ?? ''));
}

/**
 * A step's card holder (a prefab whose controller names a card prefab and its container: the pick's large card, the
 * lineup's small card, the reserve card holding a small card) with its card placed and shown, through as many
 * holders as there are.
 * A tap on the card (`onTap`) goes to every holder's button on the way (the innermost one with a hit area is where
 * the pointer lands).
 * @param {Part} holder @param {(p: Part, at: string, prefab: string) => Part | null} place @param {CardData} d @param {CardArt} art
 * @param {() => void} [onTap]
 * @returns {Part | null} the card
 */
export function holderCard(holder, place, d, art, onTap) {
  const f = holder.view(), inner = f.cardPrefab && f.container ? place(holder, f.container, f.cardPrefab) : null;
  if (f.teampTag) holder.show(f.teampTag, d.from === 'recruit');
  if (onTap && f.btnGraphic) holder.tap(f.btnGraphic, onTap);
  if (!inner) return null;
  const g = inner.view();
  if (g.cardPrefab && g.container) return holderCard(inner, place, d, art, onTap);
  fillCard(inner, d, art);
  return inner;
}
