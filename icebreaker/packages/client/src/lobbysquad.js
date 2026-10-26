// The activity's squad page (docs/spec/page.md 页面-6, room.md 房间-3): the save's 常规队 — a column of its high-priority
// operators, one of its low-priority ones — with the 常规队 tab, the play style's button and the two 快捷编队 buttons,
// which open the operator select page for their list (页面-9), as a tap on a card of the list does. The style button
// opens the style select state: the five styles, the chosen one's gains, costs and carried unit, 确认修改 to keep it.
import { openPart, closePart, place, unplace, fillList, placeTopMenu } from './lobbykit.js';
import { fillCard } from './lobbycards.js';
import { createCharSelect, SELECT_STATE } from './lobbyselect.js';
import { PAGES } from './lobbymap.js';
import { STYLES, SQUAD } from '@icebreaker/mode-regular';
import { plain } from './roomtext.js';

/** @typedef {import('./lobbykit.js').Part} Part */
/**
 * @typedef {object} SquadActions
 * @property {() => import('@icebreaker/mode-regular').Squad} squad the save's 常规队
 * @property {() => string} style the save's style
 * @property {(id: string) => void} setStyle
 * @property {(id: string) => string} nameOf
 * @property {(id: string) => { rarity: number, profession: string } | null} rosterOf
 * @property {import('./lobbycards.js').CardArt} cards
 * @property {(style: string, variant: '' | '_tiny' | '_show') => string | null} styleIcon
 * @property {() => void} back the page's back (the style select first, else out of the page)
 * @property {() => void} home out of the page to the entry
 * @property {import('./lobbyselect.js').SelectOptions['roster']} roster every operator, for the select page
 * @property {(id: string) => import('@icebreaker/mode-regular').BoxEntry | null} entry the box's entry
 * @property {import('./lobbyselect.js').SelectOptions['training']} training
 * @property {any} art the lobby pack's art
 * @property {(text: string) => void} toast
 * @property {(list: 'high' | 'low', ids: string[]) => Promise<void>} setList keeps a list the select page chose
 */

const DEF = '@state_engine/default_state';

/** The squad page. @param {any} ui @param {SquadActions} A */
export function createSquad(ui, A) {
  const p = openPart(ui, PAGES.squad), f = p.view(DEF);
  p.show(`${DEF}/btn_guidebook`, false);
  placeTopMenu(p, `${DEF}/top_menu_container`, { back: A.back, home: A.home });
  /** @type {ReturnType<typeof createCharSelect> | null} */
  let select = null;
  const closeSelect = () => { select?.close(); select = null; draw(); };
  /** The operator select page for a list (页面-9). @param {'high' | 'low'} list */
  const pick = (list) => {
    if (select) return;
    if (!hasSelect(p)) { A.toast('素材的界面包里没有干员选择页，用「干员 box」编队'); return; }
    const q = A.squad(), other = list === 'high' ? 'low' : 'high';
    select = createCharSelect(p.ui, {
      list, max: SQUAD[list], chosen: q[list].map((e) => e.id), other: q[other].map((e) => e.id), roster: A.roster, entry: A.entry, training: A.training,
      cards: A.cards, art: A.art, toast: A.toast, back: closeSelect, home: () => { closeSelect(); A.home(); },
      confirm: (ids) => { A.setList(list, ids).then(closeSelect, (e) => A.toast(`保存失败：${e.message}`)); },
    });
  };
  p.tap(`${DEF}/btn_high_pri_edit/click_area`, () => pick('high'));
  p.tap(`${DEF}/btn_low_pri_edit/click_area`, () => pick('low'));
  /** @type {{ close: () => void } | null} */
  let styles = null;
  const closeStyles = () => { styles?.close(); styles = null; draw(); };
  p.tap(`${DEF}/left_part/btn_change_effect/click_area`, () => { if (!styles) styles = createStyles(p, A, closeStyles); });
  fillList(p, f.tabList, 1, (t) => {
    const tf = t.view();
    t.text(tf.textName, '常规队');
    t.show(tf.selectPartGO, true); t.show(tf.unselectPartGO, false); t.show(tf.lockIconGO, false); t.show(tf.trackPointGO, false); t.show(tf.charLackHintGO, false);
  });
  function draw() {
    const q = A.squad(), style = STYLES.find((s) => s.id === A.style());
    p.picture(f.imgEffectIcon, style ? A.styleIcon(style.id, '_tiny') : null);
    fillList(p, f.charList, 2, (col, i) => {
      const cf = col.view(), list = i === 0 ? q.high : q.low;
      col.show(cf.highPriIconGO, i === 0);
      col.show(cf.lowPriIconGO, i === 1);
      // a column is as wide as its cards need: the controller's column width for up to three card columns, one card
      // column's width more for each further one (two rows a column; INF-0010)
      col.root.rt.size[0] = Math.max(f.classColWidth ?? 474, (f.classColWidth ?? 474) + (Math.ceil(list.length / 2) - 3) * (f.charColWidth ?? 127));
      fillList(col, cf.charList, list.length, (holder, k) => {
        const hf = holder.view(), e = list[k], r = A.rosterOf(e.id);
        const card = hf.charCardRoot && hf.charCardPrefab ? place(holder, hf.charCardRoot, hf.charCardPrefab) : null;
        if (card) fillCard(card, { id: e.id, entry: e, name: A.nameOf(e.id), rarity: r?.rarity ?? 1, profession: r?.profession ?? '', from: i === 0 ? 'kept' : 'drawn' }, A.cards);
        holder.tap('@click_area', () => pick(i === 0 ? 'high' : 'low'));
      });
    }, f.classColPrefab);
  }
  draw();
  return {
    part: p, update: draw,
    /** The page's back: closes the select page (its rarity filter first) or the style select first; false when there is nothing to close. */
    back: () => {
      if (select) { if (!select.back()) closeSelect(); return true; }
      if (!styles) return false;
      closeStyles(); return true;
    },
    close: () => { select?.close(); styles?.close(); closePart(p); },
  };
}

/**
 * The style select state over the squad page (房间-3): each style's card (its name, colour, icon; the save's marked
 * 已应用, the one looked at selected), the one looked at's info, 确认修改 to keep it (已应用 when it is the save's).
 * @param {Part} page @param {SquadActions} A @param {() => void} close
 */
function createStyles(page, A, close) {
  const s = place(page, '@state_engine/effect_select_state_root', 'squad/sqaud_effect_select_state');
  if (!s) return { close: () => undefined };
  const st0 = /** @type {Part} */ (s), f = st0.view();
  // its own top menu over the squad page: back closes it, home leaves the page
  placeTopMenu(st0, '@top_menu_container', { back: close, home: A.home });
  let looked = A.style();
  st0.show('@group_title/right_info', false);
  st0.text(f.textHint, '选择比赛风格');
  function draw() {
    const chosen = A.style();
    fillList(st0, f.effectItemList, STYLES.length, (item, i) => {
      const st = STYLES[i], g = item.view();
      item.show(g.emptyPartGO, false); item.show(g.normalPartGO, true);
      item.text(g.textName, st.name);
      item.picture(g.imgEffectIcon, A.styleIcon(st.id, '_show'));
      item.color(g.imgThemeIcon, hex(st.color));
      item.show(g.equipPartGO, st.id === chosen);
      item.show(g.selectPartGO, st.id === looked);
      for (const r of [g.selfLabelPartGO, g.partnerLabelPartGO, g.lackKeyLockPartGO, g.unlockablePartGO]) item.show(r, false);
      item.tap('@container/normal/hotspot', () => { looked = st.id; draw(); });
    });
    const info = f.effectInfoViewContainer && f.effectInfoViewPrefab ? place(st0, f.effectInfoViewContainer, f.effectInfoViewPrefab) : null, st = STYLES.find((x) => x.id === looked);
    if (info && st) styleInfo(info, st, A);
    st0.show(f.btnInteractGO, looked !== chosen);
    st0.show(f.btnAlreadyEquipGO, looked === chosen);
    st0.show(f.btnKeyLackGO, false);
  }
  st0.tap('@group_button/btn_root/btn_interact/anim_root/hotspot', () => { A.setStyle(looked); draw(); });
  // every style is unlocked: the button stands as its unlock clip leaves it (确认修改 shown, the key price gone)
  void st0.play(f.animBtnUnlock?.animationWrapper ?? '@group_button/btn_root/btn_interact/anim_root', f.animBtnUnlock?.animationName ?? 'squad_effect_btn_unlock', { rate: 1e4 });
  draw();
  return { close: () => unplace(page, '@state_engine/effect_select_state_root') };
}

/** A style's info card: its name, colour, gains, costs and carried unit. @param {Part} info @param {import('@icebreaker/mode-regular').Style} st @param {SquadActions} A */
function styleInfo(info, st, A) {
  const f = info.view();
  info.color(f.imgEffectTheme, hex(st.color));
  info.text(f.textEffectName, st.name);
  info.text(f.textBuffDesc, plain(st.buff));
  info.text(f.textDebuffDesc, plain(st.debuff));
  info.text(f.textTokenName, st.device.name);
  info.text(f.textTokenDesc, plain(st.device.desc));
  info.picture(f.imgTokenIcon, A.cards.avatar(st.device.key));
  info.picture('@title/img_playingstyle', A.styleIcon(st.id, '_tiny'));
}

/** Whether the lobby pack has the operator select page (an older pack has not). @param {Part} p */
const hasSelect = (p) => Object.hasOwn(p.scr.ctx.pack.screens, SELECT_STATE);

/** A '#rrggbb' colour as 0–1 channels with full alpha. @param {string} c */
export const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).concat(1);
