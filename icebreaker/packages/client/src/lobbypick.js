// 高顺位干员协调 on the char pick panel (docs/spec/page.md 页面-6, room.md 房间-4): on this player's turn its active
// look, the operators left as large cards (a tap keeps one) and, when it may, the card that hands the pick over; the
// turn's notice when the turn changes (the mate's handing over said); what this player has kept so far in the reserve
// view; a kept operator shown as it comes.
import { place, fillList, setSwitch, showInvert } from './lobbykit.js';
import { INVERSE } from '@icebreaker/mode-regular';
import { holderCard } from './lobbycards.js';
import { pickView } from './lobbymap.js';

/** @typedef {import('./lobbykit.js').Part} Part @typedef {import('./lobbystage.js').StepCtx} StepCtx */

/** A card of an operator a seat has in its squad. @param {StepCtx} X @param {any} S @param {number} seat @param {string} id @param {'kept' | 'drawn' | 'recruit' | 'extra'} from */
export function cardOf(X, S, seat, id, from) {
  const r = X.rosterOf(id);
  return { id, entry: X.entryOf(seat, id), name: X.nameOf(id), rarity: r?.rarity ?? 1, profession: r?.profession ?? '', from };
}

/** @param {Part} p @param {StepCtx} X */
export function createPick(p, X) {
  const f = p.view(), cv = p.view('@panel_choose_view'), rv = p.view('@panel_reverse_view'), gv = p.view('@panel_got_char_view');
  void p.anim(f.entryAnim);
  let key = '', turn = -1, kept = 0, open = false;
  /** @type {any} */
  let S0 = null;
  p.tap('@panel_choose_view/panel_close/btn_reverse_open', () => { open = true; reserve(); });
  p.tap('@panel_reverse_view/panel_open/btn_reverse_close', () => { open = false; reserve(); });
  p.tap('@panel_reverse_view/panel_open/host_spot_close', () => { open = false; reserve(); });

  function reserve() {
    setSwitch(p, rv.switcher ?? '@panel_reverse_view', open);
    if (!open || !S0) return;
    const pv = pickView(S0.view);
    p.show(rv.emptyFlag, pv.kept.length === 0);
    fillList(p, rv.charList, pv.kept.length, (item, i) => {
      setSwitch(item, '@', true);
      holderCard(item, place, cardOf(X, S0, S0.view.you, pv.kept[i], 'kept'), X.cards);
    });
  }

  return {
    /** @param {any} S */
    update(S) {
      S0 = S;
      for (const r of cv.invertTips ?? []) showInvert(p, r, !!S.view.inverse, INVERSE.hint);
      const pv = pickView(S.view), k = `${pv.mine}|${pv.yielded}|${pv.left.join(',')}`;
      setSwitch(p, '@panel_choose_view', pv.mine);
      p.text(cv.pickCnt, String(pv.left.length));
      if (S.view.picking.by !== turn) {
        turn = S.view.picking.by;
        setSwitch(p, cv.skipTextToggle, pv.mine && pv.yielded);
        void p.anim(pv.mine ? cv.myTurnAnim : cv.pTurnAnim);
        // this player's turn: after a moment the hand points at the cards
        const at = turn;
        if (pv.mine) setTimeout(() => { if (turn === at) void p.anim(cv.notiPlayerAnim); }, (cv.delayOnNotiPlayerAnim ?? 0.5) * 1000);
      }
      if (pv.kept.length > kept) got(p, gv, cardOf(X, S, S.view.you, pv.kept[pv.kept.length - 1], 'kept'), X);
      kept = pv.kept.length;
      if (k === key) return;
      key = k;
      const items = [...pv.left, ...(pv.canYield ? [''] : [])];
      fillList(p, cv.charList, items.length, (item, i) => {
        const id = items[i];
        setSwitch(item, '@', id !== '');
        if (!id) { item.tap('@panel_skip', () => X.send({ t: 'handover' })); return; }
        bare(holderCard(item, place, cardOf(X, S, S.view.you, id, 'kept'), X.cards));
        item.show(item.view().disactiveFlag, !pv.mine);
        item.tap('@panel_card/click_hotspot', () => { if (pickView(S0.view).mine) X.send({ t: 'pick', id }); });
      });
      if (open) reserve();
    },
  };
}

/**
 * A large card without its skill and module panel: the pick's grid has rows of the card's own height (cell 118 × 216,
 * spacing 22) and the panel hangs 47 below the card, so the pick shows the card only (INF-0011).
 * @param {Part | null} card
 */
function bare(card) {
  if (card) card.show(card.view().skillEquipPanelGO, false);
}

/** A kept operator shown as it comes: its card in the got view, its clip. @param {Part} p @param {Record<string, any>} gv @param {any} card @param {StepCtx} X */
function got(p, gv, card, X) {
  const c = gv.cardContainer && gv.cardPrefab ? place(p, gv.cardContainer, gv.cardPrefab) : null;
  if (!c) return;
  setSwitch(c, '@', true);
  bare(holderCard(c, place, card, X.cards));
  void p.anim(gv.anim);
}
