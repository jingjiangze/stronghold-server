// 表情交流 on the prepare page (docs/spec/room.md 房间-7, page.md 页面-6): the side view's chat buttons (on its full
// panel and its small one) open the emote panel where the page's emote controller places it for that panel; the panel
// shows one theme's emotes of the phase at a time (its arrows and dots switch themes; the original slides between
// them); a tap sends one and closes it. For the cooldown after, the buttons are covered. Each seat's emote shows in a
// bubble beside its side of the view for its time, with the bubble's clip.
import { place, unplace, fillList, openInside, closeInside } from './lobbykit.js';
import { EMOTES, emoteSceneOf } from '@icebreaker/mode-regular';

/** @typedef {import('./lobbykit.js').Part} Part @typedef {import('./lobbystage.js').StepCtx} StepCtx */
/** The emote index and its folder's URL. @typedef {{ base: string, index: any }} EmoteArt */
/**
 * What the chat works with: the page, its emote controller's fields, the art, the context, and its state — the open
 * panel, its theme, whether the side view is small, this player's seat, the phase's scene, each seat's bubble.
 * @typedef {{ page: Part, cv: Record<string, any>, art: EmoteArt, X: StepCtx, panel: Part | null, theme: number, small: boolean, you: number,
 *   scene: 'room' | 'pick' | null, bubbles: ({ part: Part, until: number } | null)[] }} Chat
 */

const AT = '@state_engine/main_state/emoji_chat_view';
/** The controller's place kinds: the side view's full panel and its small one (INF-0019). */
const POS_FULL = 1, POS_SMALL = 2;
/** A pager dot, the current one and the others (the dot clip's end and start). */
const DOT_ON = { w: 40, color: [1, 1, 1, 1] }, DOT_OFF = { w: 16, color: [0.8157, 0.7216, 0.7216, 1] };

/** A rect placed as the controller's data gives it ({ pos, anchorsMin, anchorsMax }). @param {any} rt @param {any} at */
function placeRect(rt, at) {
  if (!rt || !at) return;
  Object.assign(rt, { pos: [at.pos.x, at.pos.y], amin: [at.anchorsMin.x, at.anchorsMin.y], amax: [at.anchorsMax.x, at.anchorsMax.y] });
}

/** The controller's place of a kind for the side view now. @param {Chat} C @param {string} list @param {number} [index] */
const placeOf = (C, list, index) => (C.cv[list] ?? []).find((/** @type {any} */ d) => d.posType === (C.small ? POS_SMALL : POS_FULL) && (index === undefined || d.index === index));

/**
 * An emote item: the theme's background, the emote's picture at its own size (INF-0019) and its text.
 * @param {Part} item @param {EmoteArt} art @param {string} theme @param {string} id
 */
function fillEmote(item, art, theme, id) {
  const f = item.view(), pic = art.index.emotes?.[id]?.pic ?? '', icon = item.node(f.emojiIcon ?? '@bg/emoji_icon');
  const size = art.index.themes.find((/** @type {any} */ t) => t.id === theme)?.sizes?.[pic];
  item.picture(f.emojiBg ?? '@bg', `${art.base}${theme}/pic_bg.webp`);
  item.picture(f.emojiIcon ?? '@bg/emoji_icon', `${art.base}${theme}/${pic}.webp`);
  if (icon && size) icon.rt.size = [size[0], size[1]];
  item.text(f.desc ?? '@emoji_text', EMOTES.text[id] ?? id);
}

/** @param {Chat} C */
function closePanel(C) {
  if (!C.panel) return;
  unplace(C.page, C.cv.panelContainer);
  C.panel = null;
}

/** The panel's theme: its name, its emotes of the phase, the dots and the arrows. @param {Chat} C */
function fillPanel(C) {
  const p = C.panel, scene = C.scene;
  if (!p || !scene) return;
  const f = p.view(), themes = C.art.index.themes, t = themes[C.theme], ids = EMOTES.scenes[scene].filter((id) => t.emotes.includes(id));
  p.text(f.themeName, t.name);
  const [grid] = fillList(p, f.emojiGroupContent, 1);
  if (grid) {
    fillList(grid, '@', ids.length, (item, i) => {
      fillEmote(item, C.art, t.id, ids[i]);
      item.tap(item.view().button ?? '@hotspot', () => { C.X.emote(ids[i], t.id); closePanel(C); });
    });
  }
  fillList(p, f.dotContent, themes.length, (dot, i) => {
    const d = i === C.theme ? DOT_ON : DOT_OFF;
    dot.root.rt.size = [d.w, dot.root.rt.size[1]];
    dot.color('@', d.color);
  });
  p.show(f.leftArrow, C.theme > 0);
  p.show(f.rightArrow, C.theme < themes.length - 1);
}

/** Opens the panel at the controller's place for the side view, on the theme last shown. @param {Chat} C */
function openPanel(C) {
  const p = place(C.page, C.cv.panelContainer, C.cv.panelViewPrefab);
  C.panel = p;
  if (!p) return;
  const f = p.view(), last = C.art.index.themes.length - 1;
  placeRect(p.node(f.rectPos)?.rt, placeOf(C, 'panelPosTypeDataList')?.panelPos);
  p.tap('@non_draw_close_area', () => closePanel(C));
  p.tap(`${f.leftArrow}/hotspot`, () => { C.theme = Math.max(0, C.theme - 1); fillPanel(C); });
  p.tap(`${f.rightArrow}/hotspot`, () => { C.theme = Math.min(last, C.theme + 1); fillPanel(C); });
  fillPanel(C);
  void p.anim(f.switchAnimLocation);
}

/** A seat's emote in its bubble beside its side (self below, the mate above). @param {Chat} C @param {number} seat @param {{ id: string, theme: string, until: number }} e */
function showBubble(C, seat, e) {
  const old = C.bubbles[seat];
  if (old) closeInside(C.page, old.part);
  const pop = openInside(C.page, C.cv.popEmojiItemContainer, C.cv.popEmojiItemViewPrefab);
  C.bubbles[seat] = pop ? { part: pop, until: e.until } : null;
  if (!pop) return;
  const f = pop.view();
  placeRect(pop.root.rt, placeOf(C, 'receiveEmojiPosDataList', seat === C.you ? 0 : 1)?.emojiItemPos);
  const item = place(pop, f.content ?? '@container', f.itemPrefab ?? 'screen:emoticon/multiv3_emoji_item');
  if (item) fillEmote(item, C.art, e.theme, e.id);
  void pop.anim(f.chatItemAnim);
}

/** The chat when it can run (inert without the emote art or the side view). @param {Part} page @param {Part} side @param {Record<string, any>} sf @param {StepCtx} X @param {EmoteArt} art */
function runChat(page, side, sf, X, art) {
  /** @type {Chat} */
  const C = { page, cv: page.view(AT), art, X, panel: null, theme: 0, small: false, you: 0, scene: null, bubbles: [null, null] };
  const toggle = () => { if (C.panel) closePanel(C); else if (C.scene) openPanel(C); };
  const [full, tiny] = sf.chatObjs ?? [];
  if (full) side.tap(side.node(`${full}/hotspot`) ? `${full}/hotspot` : full, toggle);
  if (tiny) side.tap(tiny, toggle);
  return {
    /** The phase's chat: its buttons while the phase has emotes, the panel closed on a change, a new emote's bubble. @param {any} S @param {boolean} small */
    update(S, small) {
      const was = C.scene;
      Object.assign(C, { scene: emoteSceneOf(S.view?.phase), small, you: S.view?.you ?? 0 });
      side.showAll(sf.chatObjs, !!C.scene);
      if (C.scene !== was) closePanel(C);
      for (const seat of [0, 1]) {
        const e = S.emotes?.[seat];
        if (e && e.until > performance.now() && C.bubbles[seat]?.until !== e.until) showBubble(C, seat, e);
      }
    },
    /** The cooldown's cover and the bubbles' time. @param {any} S */
    tick(S) {
      side.showAll(sf.chatCdBlockers, !!C.scene && performance.now() - S.chatAt < EMOTES.cd * 1000);
      C.bubbles.forEach((b, seat) => { if (b && b.until <= performance.now()) { closeInside(page, b.part); C.bubbles[seat] = null; } });
    },
    close() { closePanel(C); C.bubbles.forEach((b) => { if (b) closeInside(page, b.part); }); },
    /** What the chat shows, for tests. */
    state: () => ({ open: !!C.panel, theme: art.index.themes[C.theme]?.id ?? null, scene: C.scene, bubbles: C.bubbles.map((b) => !!b) }),
  };
}

/** The chat of the prepare page. @param {Part} page @param {Part | null} side @param {Record<string, any>} sf the side view's fields @param {StepCtx} X */
export function createChat(page, side, sf, X) {
  const cv = page.view(AT), art = X.emoteArt();
  const on = !!(art && side && cv.panelContainer && cv.popEmojiItemContainer);
  page.show(AT, on);
  side?.showAll(sf.chatObjs, false);
  side?.showAll(sf.chatNewPoints, false);
  if (!on || !art || !side) return { update: () => undefined, tick: () => undefined, close: () => undefined, state: () => null };
  return runChat(page, side, sf, X, art);
}
