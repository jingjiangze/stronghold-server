// The signals of a match of 常规项目 (docs/spec/room.md 房间-12, engine 同步-13): what the server lets through between
// the seats — a mark on a tile of the level (just the tile, 注意 or 撤退) within the marks' limits, a battle emote of
// the activity's enabled themes at most once a cool-down —; anything else is dropped. Pure.
import data from '../data/act1multi.json' with { type: 'json' };
import { EMOTES } from './index.js';

/**
 * The marks' limits (房间-12, INF-0024): after a mark the next waits `cd` seconds, and a seat places at most `count`
 * marks in any `window` seconds; a mark shows for `shown` seconds.
 */
export const MARKS = Object.freeze({ cd: data.marks.markCd, window: data.marks.markCond1, count: data.marks.markCond2, shown: data.marks.markCond1 });
/** A mark's kinds (房间-12): the tile alone, 注意！, 撤退干员. */
export const MARK_TYPES = Object.freeze([0, 1, 2]);

/**
 * Whether a seat may mark now (房间-12, INF-0024), by the times (ms) of its marks so far, latest last; and when it may
 * next (ms, `now` when it may).
 * @param {readonly number[]} times @param {number} now @returns {{ ok: boolean, next: number }}
 */
export function markAllowed(times, now) {
  const last = times.length ? times[times.length - 1] : -Infinity, recent = times.filter((t) => now - t < MARKS.window * 1000);
  const next = Math.max(last + MARKS.cd * 1000, recent.length >= MARKS.count ? recent[recent.length - MARKS.count] + MARKS.window * 1000 : -Infinity, now);
  return { ok: next <= now, next };
}

/**
 * The rule for a match's signals (engine 同步-13): a mark on a tile of a level `width` × `height` of a known kind,
 * allowed by the limits; a battle emote of an enabled theme at most once every `EMOTES.cd` seconds a seat.
 * @param {{ width: number, height: number }} level @returns {(seat: number, s: Record<string, string | number>, now: number) => boolean}
 */
export function signalRule(level) {
  /** @type {Map<number, number[]>} */
  const marks = new Map();
  /** @type {Map<number, number>} */
  const emotes = new Map();
  return (seat, s, now) => {
    if (s.kind === 'mark') {
      const row = Number(s.row), col = Number(s.col), times = marks.get(seat) ?? [];
      if (Object.keys(s).length !== 4 || !(row < level.height && col < level.width) || !MARK_TYPES.includes(Number(s.type)) || !markAllowed(times, now).ok) return false;
      marks.set(seat, [...times.slice(-MARKS.count), now]);
      return true;
    }
    if (s.kind === 'emote') {
      if (Object.keys(s).length !== 3 || !EMOTES.scenes.battle.includes(String(s.id)) || !EMOTES.themes.includes(String(s.theme))) return false;
      if (now - (emotes.get(seat) ?? -Infinity) < EMOTES.cd * 1000) return false;
      emotes.set(seat, now);
      return true;
    }
    return false;
  };
}
