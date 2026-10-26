// What the room page says about a room (docs/spec/room.md): the steps' names, the countdowns, the invitation text, whose
// turn it is, and the lineup a player starts from. Pure; roomview.js draws it.

import { STYLES, PINGS, INVITE, TOASTS } from '@icebreaker/mode-regular';

/** @typedef {import('@icebreaker/mode-regular').BoxEntry} BoxEntry */
/** @typedef {{ kept: string[], drawn: string[], extra: string[] }} Options */
/** @typedef {{ id: string, skill: number, module: number }} Pick */

/** A text of the activity table without its markup (<@…>…</>). @param {string} s */
export const plain = (s) => s.replace(/<[^>]*>/g, '');

/** A play style as the page names it (房间-3): its name, what it gives and costs, its carried unit. @param {string} id */
export function styleText(id) {
  const s = STYLES.find((x) => x.id === id);
  if (!s) return '—';
  return `${s.name}（${plain(s.buff)}${s.debuff === '无' ? '' : `；${plain(s.debuff)}`}；携带物：${s.device.name}）`;
}

/** Each phase's name as the game shows it. @type {Record<string, string>} */
export const PHASE_TITLES = { setup: '项目调整', confirm: '项目确认', pick: '高顺位干员协调', lineup: '组建上场阵容', battle: '比赛进行中', together: '比赛结束' };

/** What the end of a search says (房间-9): found (with the mate's position's text), not found, cancelled. */
export const SOUGHT = Object.freeze({ fail: '未能匹配到合适的协作者', cancel: '取消匹配成功' });

/** Milliseconds as m:ss, rounded up. @param {number} ms */
export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The latency text (页面-6): the activity's text of the highest threshold at or under the latency, the latency in whole
 * ms (at least 1) in its colour. @param {number} ms
 */
export function pingText(ms) {
  const v = Math.max(1, Math.round(ms)), p = PINGS.filter((x) => v >= x.from).at(-1) ?? PINGS[0];
  return p ? p.text.replace('{0}', String(v)) : '';
}

/**
 * The text a host sends to invite (房间-1): the activity's, the code in brackets (so the whole text can be pasted).
 * @param {string} code @param {string} name @param {string} tag
 */
export const inviteText = (code, name, tag) => INVITE.replace('{0}', code).replace('{1}', name).replace('{2}', tag);

/** A player as its name card writes it (房间-1): 昵称#代号, the name alone without a 代号. @param {{ name: string, tag?: string } | null | undefined} m */
export const cardName = (m) => (m ? (m.tag ? `${m.name}#${m.tag}` : m.name) : '');

/** Who picks now (房间-4). @param {{ by: number, yielded: boolean }} p @param {number} you */
export const turnText = (p, you) => (p.by === you ? `轮到你选择${p.yielded ? '（对方让出了这次选择）' : ''}` : '等待对方选择');

/** Why a close of the room happened, as the page says it. @type {Record<string, string>} */
export const CLOSED = { 'host left': '房主离开了，房间已关闭', time: '房间的存在时间到了，房间已关闭', kicked: '你被请离了房间', dissolved: TOASTS['matchPrepareRoomClose'] ?? '房间已解散' };

/**
 * The lineup a player starts from (房间-5): its kept operators (at most 10), then its other options up to 6, each with
 * its last open skill and its first unlocked module. @param {Options} o @param {(id: string) => BoxEntry | null} entryOf
 * @returns {Pick[]}
 */
export function startingLineup(o, entryOf) {
  const ids = [...o.kept, ...o.drawn, ...o.extra].slice(0, Math.max(6, Math.min(10, o.kept.length)));
  return ids.map((id) => {
    const e = entryOf(id);
    return { id, skill: e ? e.skills.length - 1 : -1, module: e ? e.modules.findIndex((m) => m > 0) : -1 };
  });
}

/** Why a lineup cannot be set (房间-5), or null. @param {Pick[]} list */
export const lineupCount = (list) => (list.length < 6 || list.length > 10 ? `上场阵容需要 6–10 名干员（现在 ${list.length} 名）` : null);
