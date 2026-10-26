// The seats' signals on the battle page (docs/spec/room.md 房间-12, engine 同步-13): the marks — the card dragged over
// the field, the menu on a tile of the mate's operator, the marked tiles and the mate's mark icons for their time, the
// card's cool-down — and the battle emotes — the panel, the pops by each side, the button resting for its cool-down.
// Without the original UI there is no card and no panel; marks and emotes that come still show where they can.
import { KIND } from '@aue/schema';
import { createMarks, createBattleEmotes, MARK_KIND } from '@aue/ui';
import { EMOTES, MARKS, markAllowed } from '@icebreaker/mode-regular';

/** @typedef {import('@aue/schema').View} View */
/** A mark shown: its seat, its tile, its kind, until when (page ms). @typedef {{ id: string, seat: number, row: number, col: number, type: number, until: number }} Mark */
/**
 * What the signals work with: the original UI (or none), the renderer, sending a signal, this seat, the level's width,
 * the last view, the emotes' pictures (the room's emote index and its folder) or none.
 * @typedef {{ ui: any, renderer: any, signal: (s: import('@aue/schema').Signal) => void, seat: number, width: number, view: () => View | null,
 *   emotes: { base: string, index: any } | null }} SignalsCtx
 */

/** The room's emote index and its folder, for the battle emotes' pictures, or null without it. @param {URL} assets */
export async function loadEmoteArt(assets) {
  const index = await fetch(new URL('ui/emoticons/index.json', assets)).then((r) => (r.ok ? r.json() : null), () => null);
  return index?.themes ? { base: new URL('ui/emoticons/', assets).href, index } : null;
}

/** An emote's picture: its theme's folder and the emote's picture name. @param {{ base: string, index: any } | null} art @param {string} theme @param {string} id */
export const emotePicture = (art, theme, id) => (art?.index.emotes?.[id]?.pic ? `${art.base}${theme}/${art.index.emotes[id].pic}.webp` : null);

/**
 * The mate's operator on a tile of the view, if there is one (a mark there opens the menu, 房间-12).
 * @param {View | null} view @param {number} mate @param {number} row @param {number} col
 */
export const mateOn = (view, mate, row, col) => !!view?.units.some((u) => u.kind === KIND.OPERATOR && u.owner === mate && u.hp > 0 && Math.round(u.x) === col && Math.round(u.y) === row);

/**
 * The marks shown now: those whose time has not run out, the tile being dragged over as this seat's.
 * @param {readonly Mark[]} marks @param {number} now @param {{ row: number, col: number } | null} over
 */
export const liveMarks = (marks, now, over) => [...marks.filter((m) => m.until > now), ...(over ? [{ id: 'drag', seat: -1, row: over.row, col: over.col, type: MARK_KIND.plain, until: Infinity }] : [])];

/** The drag of the mark card: the window's pointer while it lasts. @param {SignalsCtx} o @param {ReturnType<typeof createMarks>} card @param {{ over: { row: number, col: number } | null, dragging: boolean }} D @param {(row: number, col: number) => void} drop */
function dragCard(o, card, D, drop) {
  const move = (/** @type {PointerEvent} */ e) => { D.over = card.over(e.clientX, e.clientY) ? null : o.renderer.pick(e.clientX, e.clientY); };
  const up = (/** @type {PointerEvent} */ e) => {
    removeEventListener('pointermove', move);
    const tile = card.over(e.clientX, e.clientY) ? null : o.renderer.pick(e.clientX, e.clientY);
    Object.assign(D, { over: null, dragging: false });
    if (tile) drop(tile.row, tile.col);
  };
  D.dragging = true;
  addEventListener('pointermove', move);
  addEventListener('pointerup', up, { once: true });
}

/** @param {SignalsCtx} o */
export function createSignals(o) {
  /** @type {Mark[]} */
  let marks = [];
  /** this seat's marks' times (page ms), for the card's cool-down @type {number[]} */
  const mine = [];
  const D = { over: /** @type {{ row: number, col: number } | null} */ (null), dragging: false };
  let seq = 0, emoteUntil = 0;
  const send = (/** @type {number} */ row, /** @type {number} */ col, /** @type {number} */ type) => {
    if (!markAllowed(mine, performance.now()).ok) return;
    mine.push(performance.now());
    o.signal({ kind: 'mark', row, col, type });
  };
  const atTile = (/** @type {number} */ row, /** @type {number} */ col) => o.renderer.screenOf(col, row, 0).map((/** @type {number} */ v) => v / (o.ui.ctx.k ?? 1));
  const card = o.ui && o.ui.ctx.pack.screens['coop.markCard'] ? createMarks(o.ui, { press: () => {
    if (!markAllowed(mine, performance.now()).ok) return;
    card?.closeMenu();
    dragCard(o, /** @type {ReturnType<typeof createMarks>} */ (card), D, (row, col) => {
      if (mateOn(o.view(), 1 - o.seat, row, col)) card?.menu(atTile(row, col), (type) => send(row, col, type));
      else send(row, col, MARK_KIND.plain);
    });
  } }) : null;
  const emotes = o.ui && o.ui.ctx.pack.screens['coop.plugin'] && o.emotes ? createBattleEmotes(o.ui, {
    themes: EMOTES.themes, emotes: EMOTES.scenes.battle, picture: (theme, id) => emotePicture(o.emotes, theme, id),
    send: (theme, id) => o.signal({ kind: 'emote', id, theme }),
  }) : null;
  return {
    /**
     * A seat's signal (engine 同步-13): a mark shows for its time; an emote pops by its side, this seat's resting the
     * button. @param {number} from @param {Record<string, string | number>} s
     */
    onSignal(from, s) {
      if (s.kind === 'mark') marks.push({ id: `${from}:${seq++}`, seat: from, row: Number(s.row), col: Number(s.col), type: Number(s.type), until: performance.now() + MARKS.shown * 1000 });
      if (s.kind === 'emote' && emotes) {
        emotes.show(from === o.seat, String(s.theme), String(s.id));
        if (from === o.seat) { emoteUntil = performance.now() + emotes.cooldown * 1000; emotes.rest(true); }
      }
    },
    /** A frame of the page: the marked tiles, the mate's mark icons at their tiles, the card's state, the button's rest. */
    frame() {
      const now = performance.now();
      marks = marks.filter((m) => m.until > now);
      o.renderer.marks(liveMarks(marks, now, D.over).map((m) => ({ key: m.row * o.width + m.col, mate: m.seat !== o.seat && m.seat >= 0 })));
      card?.icons(marks.filter((m) => m.seat !== o.seat).map((m) => ({ id: m.id, at: atTile(m.row, m.col), kind: m.type })));
      card?.update({ dragging: D.dragging, cooldown: Math.max(0, (markAllowed(mine, now).next - now) / 1000) });
      if (emotes && emoteUntil && now >= emoteUntil) { emoteUntil = 0; emotes.rest(false); }
    },
    /** What the signals show, for tests. */
    state: () => ({ marks: marks.map((m) => ({ seat: m.seat, row: m.row, col: m.col, type: m.type })), menu: !!card?.menuOpen, emotes: !!emotes, card: !!card }),
  };
}
