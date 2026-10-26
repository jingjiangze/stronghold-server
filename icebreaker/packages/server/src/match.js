// 快速匹配 (docs/spec/room.md 房间-9): the players looking for a mate — the classes of 常规项目 each would play, its
// match position, 互选模式 on or off, and the 常规队 and style it confirms with — paired as the activity's positions
// allow (常规选手 with 常规选手, 学员 with 教练), 互选模式 with 互选模式, on a project of a class both chose; a player not
// paired within the activity's time is told so. A pair gets a room straight at 项目确认 (rooms.js openMatched).
import { MATCH, TOASTS, squadProblem, styleRunes } from '@icebreaker/mode-regular';

/**
 * A player looking for a mate: the classes it would play, its position, 互选模式, its 常规队 and style, and since when.
 * @typedef {{ id: number, classes: string[], pos: string, inverse: boolean, squad: import('@icebreaker/mode-regular').Squad, style: string, since: number }} Seeker
 */

/** Which positions match which (the activity's matchPosDataDict: 学员 only with 教练 and back, 常规选手 with 常规选手). */
const MATES = Object.freeze({ NORMAL: 'NORMAL', STUDENT: 'COACH', COACH: 'STUDENT' });

/** @param {Seeker} a @param {Seeker} b */
export const mayPair = (a, b) => MATES[/** @type {keyof typeof MATES} */ (a.pos)] === b.pos && a.inverse === b.inverse && a.classes.some((c) => b.classes.includes(c));

/**
 * Why a player may not look for a mate with these settings, or null (房间-9): a class of 常规项目 the server has a
 * project of, a known position not needing an unlock (教练 needs 高级赛 stamps, which the platform does not keep:
 * INF-0021), a 常规队 that may be confirmed and a known style.
 * @param {{ classes: unknown[], pos: unknown, squad: unknown, style: unknown }} m @param {readonly { class: string }[]} projects
 */
export function seekProblem(m, projects) {
  const open = new Set(projects.filter((p) => /** @type {any} */ (p).mode !== 'DEFENCE').map((p) => p.class));
  if (!m.classes.length || !m.classes.every((c) => typeof c === 'string' && open.has(c))) return TOASTS['matchNoProject'] ?? 'no project';
  const pos = MATCH.positions.find((p) => p.id === m.pos);
  if (!pos) return `没有这种参赛身份 ${String(m.pos)}`;
  if (pos.locked) return TOASTS['mentorLockTips'] ?? pos.hint;
  const why = squadProblem(m.squad);
  if (why) return `常规队不符合要求：${why}`;
  return styleRunes(String(m.style)) ? null : `没有这种比赛风格 ${String(m.style)}`;
}

/**
 * The matcher: its queue, a tick that pairs and times out, and the hooks the lobby calls.
 * @param {{ now: () => number, random: () => number, send: (id: number, msg: Record<string, unknown>) => void,
 *   projects: readonly { class: string }[], open: (pair: [Seeker, Seeker], project: number) => void }} o
 */
export function createMatcher(o) {
  /** @type {Map<number, Seeker>} */
  const queue = new Map();
  const ms = MATCH.seconds * 1000;

  /** A pair's project: a 常规项目 one of the classes both chose, at random (快速匹配 plays 常规项目 only). @param {Seeker} a @param {Seeker} b */
  function projectOf(a, b) {
    const shared = o.projects.map((p, i) => [p, i]).filter(([p]) => /** @type {any} */ (p).mode !== 'DEFENCE' && a.classes.includes(/** @type {any} */ (p).class)
      && b.classes.includes(/** @type {any} */ (p).class));
    return /** @type {number} */ (shared[Math.floor(o.random() * shared.length)][1]);
  }

  return {
    queue,
    /**
     * A player starts looking (房间-9); a malformed or refused request is answered with why. @param {number} id
     * @param {{ classes: string[], pos: string, inverse: boolean, squad: any, style: string }} m
     */
    seek(id, m) {
      const why = seekProblem(m, o.projects);
      if (why) { o.send(id, { t: 'error', msg: why }); return; }
      const since = o.now();
      queue.set(id, { id, classes: [...new Set(m.classes)], pos: m.pos, inverse: m.inverse, squad: m.squad, style: m.style, since });
      o.send(id, { t: 'seeking', classes: [...new Set(m.classes)], pos: m.pos, inverse: m.inverse, left: ms });
    },
    /** A player stops looking. @param {number} id */
    cancel(id) { if (queue.delete(id)) o.send(id, { t: 'sought', how: 'cancel' }); },
    /** A player's connection closed, or it went into a room: it stops looking. @param {number} id */
    drop(id) { queue.delete(id); },
    /** Who waited longest is paired first, with the first who may pair with it; whoever waited the activity's time is told so. */
    tick() {
      const t = o.now(), list = [...queue.values()].sort((a, b) => a.since - b.since || a.id - b.id);
      for (const s of list) {
        if (!queue.has(s.id)) continue;
        if (t - s.since >= ms) { queue.delete(s.id); o.send(s.id, { t: 'sought', how: 'fail' }); continue; }
        const mate = list.find((b) => b !== s && queue.has(b.id) && mayPair(s, b));
        if (!mate) continue;
        queue.delete(s.id);
        queue.delete(mate.id);
        o.send(s.id, { t: 'sought', how: 'found', mate: mate.pos });
        o.send(mate.id, { t: 'sought', how: 'found', mate: s.pos });
        o.open([s, mate], projectOf(s, mate));
      }
    },
  };
}
