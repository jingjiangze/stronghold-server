// The rooms of team play (docs/spec/room.md): a room code, a host and a guest, the project, the confirmation with the
// squads, the coordination of shared operators, each seat's lineup, and the match they start. Pure state over the
// lobby's sessions: messages come in already checked (lobby.js lobbyMessageProblem), what goes out goes through
// `send`, time through `now`, chance through `random`, and a match is started through `startMatch`.
import { STEP_MS, LINEUP, TOASTS, EMOTES, INVERSE, emoteSceneOf, squadProblem, buildOf, styleRunes } from '@icebreaker/mode-regular';
import { coordinate, pick, handOver, offer } from './allocation.js';
import { newCode, elsewhere } from './nodes.js';

/**
 * How long a room lives without starting a match (房间-1), each step's time (房间-2, 房间-4, 房间-5), and how long the
 * players of a matched match have to choose 继续一起玩 (房间-10, INF-0021), in ms.
 */
export const TIMES = Object.freeze({ room: 15 * 60_000, ...STEP_MS, together: 60_000 });

/**
 * The most seats one room takes (房间-1). 上游的合作是两人；这个 fork 支持到四人 —— 每人一份阵容，
 * 关卡的一侧由两个座位共守（见 engine 的 coop.goalSeats）。
 */
export const SEATS_MAX = 4;

/** @typedef {import('@icebreaker/mode-regular').Squad} Squad @typedef {import('@icebreaker/mode-regular').BoxEntry} BoxEntry */
/** @typedef {import('./allocation.js').Picking} Picking @typedef {import('./allocation.js').Coordination} Coordination */
/** @typedef {{ level: string, difficulty: 'NORMAL' | 'FOUR_STAR' }} Project */
/**
 * A player's name card (房间-1): its 代号 (four digits after its name), its avatar (an operator's; '' none) and its
 * assistant — the operator its start show draws, at an art (1: elite 1, 2: elite 2), or none.
 * @typedef {{ tag: string, avatar: string, assist: { id: string, art: 1 | 2 } | null }} Profile
 */
/** @typedef {{ id: number, key: string, name: string, online: boolean, profile: Profile }} Member */
/** @typedef {{ kept: string[], drawn: string[], extra: string[] }} Options */
/** @typedef {{ id: string, skill: number, module: number }} Pick */
/**
 * @typedef {object} Room
 * @property {string} code
 * @property {Member[]} members the host first
 * @property {'setup' | 'confirm' | 'pick' | 'lineup' | 'battle' | 'together'} phase `together`: after a matched match (房间-10)
 * @property {number} project the project's index
 * @property {boolean} inverse 互选模式 (房间-8): the seats swap their lineups and styles when the match starts
 * @property {boolean} prepared every seat but the host has 准备参赛 (with two seats that is the one guest)
 * @property {Set<number>} [preparedSeats] the seats that did — the host never counts
 * @property {number} expires @property {number} due the current step's end (0: none)
 * @property {(Squad | null)[]} squads @property {string[]} styles each seat's play style (房间-3) @property {Coordination | null} coord
 * @property {Options[]} options @property {(Pick[] | null)[]} lineups @property {boolean[]} ready
 * @property {string | null} match
 * @property {boolean[] | null} likes after a match, whether each seat liked the other on the result (房间-6); null before one
 * @property {boolean} [matched] made by 快速匹配 (房间-9): it starts at 项目确认 and goes after its match (房间-10)
 * @property {({ squad: Squad, style: string } | null)[] | null} [auto] a matched room's 常规队 and style each seat confirms with when its time runs out
 * @property {boolean[] | null} [together] after a matched match, which seats chose 继续一起玩
 */
/**
 * @typedef {object} RoomsOptions
 * @property {() => number} now @property {() => number} random
 * @property {(session: number, msg: Record<string, unknown>) => void} send
 * @property {(match: import('@aue/schema').Match, keys: string[]) => Promise<string> | string} startMatch the match's id
 * @property {Project[]} projects @property {BoxEntry[]} recruits the temporary recruits (房间-5)
 * @property {number} [maxRooms] how many rooms the server holds at most (站点-2); none: no limit
 * @property {number} [seats] how many seats a room takes (房间-1): 2 by default — 上游的合作人数 — up to SEATS_MAX;
 *   the server's `--seats 4` opens four-seat rooms
 * @property {(session: number) => void} [wrongCode] a session tried a room code no room has (站点-2)
 * @property {import('./nodes.js').Node | null} [node] this server as one node of several (站点-6): its rooms' codes begin with its digit
 */
/** @typedef {{ key: string, name: string, room: string | null, profile: Profile, chatAt?: number }} Session */
/** A name card before the page sent its own. @type {Profile} */
const NO_PROFILE = Object.freeze({ tag: '', avatar: '', assist: null });
/** @typedef {{ o: RoomsOptions, rooms: Map<string, Room>, sessions: Map<number, Session>, recruitIds: string[] }} Lobby */

/** @param {Room} r @param {number} id */
const seatOf = (r, id) => r.members.findIndex((m) => m.id === id);
/** @param {Lobby} L @param {number} id */
const roomOf = (L, id) => { const s = L.sessions.get(id); return s?.room ? L.rooms.get(s.room) ?? null : null; };
/** @param {Lobby} L @param {number} id @param {string} msg */
const fail = (L, id, msg) => L.o.send(id, { t: 'error', msg });
/** The time left until a moment, never below 0. @param {Lobby} L @param {number} at */
const until = (L, at) => Math.max(0, at - L.o.now());

/**
 * A room as a seat sees it: both players' names and name cards (房间-1), the other seat's style once both have
 * confirmed (房间-3), the squads and options only once the lineups are being set (房间-5).
 * @param {Lobby} L @param {Room} r @param {number} seat
 */
function view(L, r, seat) {
  const p = r.phase === 'pick' ? r.coord?.picking ?? null : null, shown = r.phase === 'pick' || r.phase === 'lineup' || r.phase === 'battle';
  return {
    t: 'room', code: r.code, you: seat, phase: r.phase, project: r.project, inverse: r.inverse, prepared: r.prepared,
    members: r.members.map((m) => ({ name: m.name, online: m.online, ...m.profile })), left: until(L, r.expires), step: r.due ? until(L, r.due) : 0,
    confirmed: r.squads.map((s) => s !== null),
    picking: p ? { left: p.left, by: p.by, yielded: p.yielded, won: p.won } : null,
    options: r.phase === 'lineup' ? r.options : null, squads: r.phase === 'lineup' ? r.squads : null,
    styles: shown ? r.styles : r.styles.map((s, i) => (i === seat ? s : '')),
    lineups: r.lineups.map((l) => (l ? l.map((x) => x.id) : null)), ready: r.ready,
    // each seat's skill and module for its lineup's operators, in their order (房间-6: both lineups shown in full)
    choices: r.lineups.map((l) => (l ? l.map((x) => ({ skill: x.skill, module: x.module })) : null)),
    likes: r.likes ?? r.members.map(() => false),
    matched: !!r.matched, together: r.together ?? null,
  };
}
/** @param {Lobby} L @param {Room} r */
const push = (L, r) => r.members.forEach((m, i) => { if (m.online) L.o.send(m.id, view(L, r, i)); });

/** Back to 项目调整 with nothing of the allocation left (房间-2, 房间-6). Every per-seat list has one entry per seat of
 *  the room as it stands now (two at the least), so a four-seat room keeps four. @param {Room} r */
function toSetup(r) {
  const n = Math.max(2, Math.min(SEATS_MAX, r.members.length)), fill = (/** @type {any} */ v) => Array.from({ length: n }, () => v);
  Object.assign(r, { phase: 'setup', prepared: false, preparedSeats: new Set(), due: 0, squads: fill(null), styles: fill(''), coord: null, options: [], lineups: fill(null), ready: fill(false), match: null });
}

/** @param {Lobby} L @param {Room} r @param {string} why */
function close(L, r, why) {
  L.rooms.delete(r.code);
  for (const m of r.members) {
    const s = L.sessions.get(m.id);
    if (s) s.room = null;
    if (m.online) L.o.send(m.id, { t: 'closed', why });
  }
}

/** A new room: a 6-digit code none uses (房间-1; a node's begins with its digit, 站点-6), the session its host. @param {Lobby} L @param {number} id */
function create(L, id) {
  const s = /** @type {Session} */ (L.sessions.get(id));
  if (L.rooms.size >= (L.o.maxRooms ?? Infinity)) { fail(L, id, TOASTS['serverOverload'] ?? ''); return; }
  if (s.room) leave(L, id);
  const code = newCode(L.o.node, L.o.random, (c) => L.rooms.has(c));
  const r = /** @type {Room} */ ({ code, members: [{ id, key: s.key, name: s.name, online: true, profile: s.profile }], project: 0, inverse: INVERSE.on, expires: L.o.now() + TIMES.room, likes: null });
  toSetup(r);
  L.rooms.set(code, r);
  s.room = code;
  push(L, r);
}

/**
 * Joins the room whose code a player typed: the digits in [brackets] when there are any (房间-1). A code of another node
 * is no wrong code: the page is told that node's host and the code, and joins there (站点-6).
 * @param {Lobby} L @param {number} id @param {string} text
 */
function join(L, id, text) {
  const code = /\[(\d{6})\]/.exec(text)?.[1] ?? text.trim(), r = L.rooms.get(code), s = /** @type {Session} */ (L.sessions.get(id));
  const host = r ? null : elsewhere(L.o.node, code);
  if (host) { L.o.send(id, { t: 'elsewhere', code, host }); return; }
  if (!r) { L.o.wrongCode?.(id); fail(L, id, '没有这个房间编号'); return; }
  if (s.room === r.code) { push(L, r); return; }
  if (r.members.length >= (L.o.seats ?? 2)) { fail(L, id, '房间已满'); return; }
  if (r.phase !== 'setup') { fail(L, id, '房间已经开始分配干员'); return; }
  if (s.room) leave(L, id);
  r.members.push({ id, key: s.key, name: s.name, online: true, profile: s.profile });
  s.room = r.code;
  // 人数变了，每个座位一份的列表要跟着变长（座位号 = members 下标，所以重建后仍然对齐）。
  toSetup(r);
  push(L, r);
}

/**
 * The host leaving closes the room; the guest leaving frees the seat (房间-1); either leaving a matched room closes it
 * (房间-10). @param {Lobby} L @param {number} id
 */
function leave(L, id) {
  const r = roomOf(L, id);
  if (!r) return;
  /** @type {Session} */ (L.sessions.get(id)).room = null;
  if (r.matched) { close(L, r, 'dissolved'); return; }
  if (seatOf(r, id) === 0) { close(L, r, 'host left'); return; }
  r.members = r.members.filter((m) => m.id !== id);
  if (r.phase !== 'battle') toSetup(r);
  push(L, r);
}

/** 项目确认 (房间-2): the host goes on once the guest prepared. @param {Lobby} L @param {Room} r @param {number} id */
function go(L, r, id) {
  if (seatOf(r, id) !== 0 || r.phase !== 'setup' || r.members.length < 2 || !r.prepared) return;
  Object.assign(r, { phase: 'confirm', due: L.o.now() + TIMES.confirm, squads: r.members.map(() => null) });
  push(L, r);
}

/**
 * 确认参赛 with the seat's 常规队 and play style (房间-2, 房间-3); both confirmed: the allocation (房间-4).
 * @param {Lobby} L @param {Room} r @param {number} id @param {unknown} squad @param {string} style
 */
function confirm(L, r, id, squad, style) {
  if (r.phase !== 'confirm') return;
  const why = squadProblem(squad) ?? (styleRunes(style) ? null : `没有这种比赛风格 ${style}`);
  if (why) { fail(L, id, `常规队不符合要求：${why}`); return; }
  r.squads[seatOf(r, id)] = /** @type {Squad} */ (squad);
  r.styles[seatOf(r, id)] = style;
  allocate(L, r);
  push(L, r);
}

/** Both seats confirmed: the coordination, or straight the lineups (房间-4). @param {Lobby} L @param {Room} r */
function allocate(L, r) {
  // 每个座位都要确认过（四人间就是四份），不是只看前两个。
  if (r.squads.slice(0, r.members.length).some((s) => !s)) return;
  r.coord = coordinate(/** @type {Squad[]} */ (r.squads), L.o.random);
  if (r.coord.picking) Object.assign(r, { phase: 'pick', due: L.o.now() + TIMES.pick });
  else startLineups(L, r);
}

/**
 * A matched pair's room (房间-9, 房间-10): the one who waited longer is the host, the project the matcher chose, 互选模式
 * as both asked; it starts at 项目确认 and keeps each seat's 常规队 and style for its time running out.
 * @param {Lobby} L @param {[{ id: number, inverse: boolean, squad: Squad, style: string }, { id: number, squad: Squad, style: string }]} pair @param {number} project
 */
function openMatched(L, pair, project) {
  const code = newCode(L.o.node, L.o.random, (c) => L.rooms.has(c));
  const members = pair.map((p) => { const s = /** @type {Session} */ (L.sessions.get(p.id)); s.room = code; return { id: p.id, key: s.key, name: s.name, online: true, profile: s.profile }; });
  const r = /** @type {Room} */ ({ code, members, project, inverse: pair[0].inverse, expires: L.o.now() + TIMES.room, likes: null, matched: true,
    auto: pair.map((p) => ({ squad: p.squad, style: p.style })), together: null });
  toSetup(r);
  Object.assign(r, { phase: 'confirm', due: L.o.now() + TIMES.confirm });
  L.rooms.set(code, r);
  push(L, r);
}

/** 继续一起玩 (房间-10): once both seats chose it, the matched room becomes a team room at 项目调整. @param {Lobby} L @param {Room} r @param {number} id */
function together(L, r, id) {
  if (r.phase !== 'together' || !r.together) return;
  r.together[seatOf(r, id)] = true;
  if (r.together.every(Boolean)) {
    toSetup(r);
    Object.assign(r, { matched: false, auto: null, together: null, expires: L.o.now() + TIMES.room });
  }
  push(L, r);
}

/** 组建上场阵容 (房间-5): each seat's kept, drawn and extra operators. @param {Lobby} L @param {Room} r */
function startLineups(L, r) {
  const c = /** @type {Coordination} */ (r.coord), won = c.picking?.won ?? [];
  r.options = r.members.map((_, seat) => ({ kept: [...(c.kept[seat] ?? []), ...(won[seat] ?? [])], ...offer(c.pools[seat] ?? [], L.recruitIds, L.o.random) }));
  Object.assign(r, { phase: 'lineup', due: L.o.now() + TIMES.lineup, lineups: r.members.map(() => null), ready: r.members.map(() => false) });
}

/** A pick or a handing over that was allowed (allocation.js: null when not); none left: the lineups (房间-4). @param {Lobby} L @param {Room} r @param {Picking | null} next */
function afterPick(L, r, next) {
  if (!next) return;
  /** @type {Coordination} */ (r.coord).picking = next;
  if (next.left.length === 0) startLineups(L, r);
  else r.due = L.o.now() + TIMES.pick;
  push(L, r);
}

/**
 * A box entry by id: the seat's own squad first, then any other seat's, then a temporary recruit.
 *
 * With two seats every entry a seat may field comes from its own squad, so the second step never mattered. A contested
 * operator belongs to whoever holds it high — with four seats one operator can sit in three squads' high lists and be
 * picked by a seat that never had it — so the search has to cover the room, not just the seat.
 * @param {Lobby} L @param {Room} r @param {number} seat @param {unknown} id
 */
function entryOf(L, r, seat, id) {
  const own = /** @type {Squad} */ (r.squads[seat]);
  const ownHit = [...own.high, ...own.low].find((e) => e.id === id);
  if (ownHit) return ownHit;
  for (const s of r.squads) {
    if (!s || s === own) continue;
    const hit = [...s.high, ...s.low].find((e) => e.id === id);
    if (hit) return hit;
  }
  return L.o.recruits.find((e) => e.id === id) ?? null;
}

/** Why one operator of a lineup may not field as chosen, or null (房间-5). @param {BoxEntry | null} e @param {Set<string>} allowed @param {any} x */
function pickProblem(e, allowed, x) {
  if (!e || !allowed.has(x.id)) return `${String(x.id)} 不能上场`;
  if (!Number.isInteger(x.skill) || x.skill < -1 || x.skill >= e.skills.length) return `${x.id} 没有这个技能`;
  if (!Number.isInteger(x.module) || x.module < -1 || (x.module >= 0 && !(e.modules[x.module] > 0))) return `${x.id} 没有这个模组`;
  return null;
}

/** Why a lineup is not one the seat may field, or null (房间-5). @param {Lobby} L @param {Room} r @param {number} seat @param {any[]} list */
function lineupProblem(L, r, seat, list) {
  if (list.length < LINEUP.min || list.length > LINEUP.max) return `上场阵容需要 ${LINEUP.min}–${LINEUP.max} 名干员`;
  const o = r.options[seat], allowed = new Set([...o.kept, ...o.drawn, ...o.extra]);
  for (const x of list) {
    const why = pickProblem(entryOf(L, r, seat, x.id), allowed, x);
    if (why) return why;
    allowed.delete(x.id);
  }
  return null;
}

/** @param {Lobby} L @param {Room} r @param {number} id @param {any[]} list */
function setLineup(L, r, id, list) {
  const seat = seatOf(r, id);
  if (r.phase !== 'lineup') return;
  const why = lineupProblem(L, r, seat, list);
  if (why) { fail(L, id, why); return; }
  r.lineups[seat] = list.map((x) => ({ id: x.id, skill: x.skill, module: x.module }));
  r.ready[seat] = false;
  push(L, r);
}

/** 准备就绪 (房间-6); both ready: the match. @param {Lobby} L @param {Room} r @param {number} id @param {boolean} on */
function setReady(L, r, id, on) {
  const seat = seatOf(r, id);
  if (r.phase !== 'lineup' || !r.lineups[seat]) return;
  r.ready[seat] = on;
  // 每个座位都就绪才开赛（四人间是四份）。
  if (r.ready.slice(0, r.members.length).every(Boolean)) void start(L, r);
  else push(L, r);
}

/**
 * A seat's lineup when it set none in time (房间-5, INF-0004): its kept operators (the first 10), then its other options
 * up to 6, each with its first skill and no module. @param {Lobby} L @param {Room} r @param {number} seat @returns {Pick[]}
 */
function autoLineup(L, r, seat) {
  const o = r.options[seat], ids = [...o.kept, ...o.drawn, ...o.extra].slice(0, Math.max(LINEUP.min, Math.min(LINEUP.max, o.kept.length)));
  return ids.map((x) => ({ id: x, skill: /** @type {BoxEntry} */ (entryOf(L, r, seat, x)).skills.length > 0 ? 0 : -1, module: -1 }));
}

/**
 * The match of a room's lineups (房间-6, engine 同步-9), started; the room waits in battle. In 互选模式 each seat fights
 * with the other's lineup and style (房间-8). @param {Lobby} L @param {Room} r
 */
async function start(L, r) {
  const project = L.o.projects[r.project];
  const own = r.lineups.map((l, seat) => /** @type {Pick[]} */ (l).map((x) => ({ id: x.id, build: buildOf(/** @type {BoxEntry} */ (entryOf(L, r, seat, x.id)), x.skill, x.module) })));
  const styles = r.styles.map((s) => /** @type {NonNullable<ReturnType<typeof styleRunes>>} */ (styleRunes(s)));
  const decks = r.inverse ? [...own].reverse() : own, runes = r.inverse ? [...styles].reverse() : styles;
  const match = { level: project.level, difficulty: project.difficulty, seed: Math.floor(L.o.random() * 0x7fffffff), decks, runes };
  Object.assign(r, { phase: 'battle', due: 0 });
  push(L, r);
  try {
    r.match = await L.o.startMatch(match, r.members.map((m) => m.key));
  } catch (e) {
    toSetup(r);
    for (const m of r.members) if (m.online) fail(L, m.id, `比赛没能开始：${/** @type {Error} */ (e).message}`);
    push(L, r);
    return;
  }
  r.members.forEach((m, seat) => { if (m.online) L.o.send(m.id, { t: 'start', match: r.match, seat }); });
}

/** The step whose time ran out (房间-2, 房间-4, 房间-5; INF-0002…0004). @param {Lobby} L @param {Room} r */
function stepTimedOut(L, r) {
  if (r.phase === 'together') { close(L, r, 'dissolved'); return; }
  // a matched room confirms with what each seat came with (房间-10); a team room goes back to 项目调整
  if (r.phase === 'confirm' && r.matched) {
    r.auto?.forEach((a, seat) => { if (!r.squads[seat] && a) { r.squads[seat] = a.squad; r.styles[seat] = a.style; } });
    allocate(L, r);
    push(L, r);
    return;
  }
  if (r.phase === 'confirm') { toSetup(r); push(L, r); return; }
  if (r.phase === 'pick') { const p = /** @type {Picking} */ (r.coord?.picking); afterPick(L, r, pick(p, p.by, p.left[0])); return; }
  r.lineups = r.lineups.map((l, seat) => l ?? autoLineup(L, r, seat));
  void start(L, r);
}

/**
 * 表情交流 (房间-7): an emote of the phase's scene in an enabled theme goes to both seats with the sender's seat; one
 * within `cd` seconds of the sender's last is dropped. @param {Lobby} L @param {Room} r @param {number} id @param {string} emote @param {string} theme
 */
function sendEmote(L, r, id, emote, theme) {
  const s = /** @type {Session} */ (L.sessions.get(id)), now = L.o.now();
  const scene = emoteSceneOf(r.phase);
  if (!scene || !EMOTES.scenes[scene].includes(emote) || !EMOTES.themes.includes(theme)) return;
  if (s.chatAt !== undefined && now - s.chatAt < EMOTES.cd * 1000) return;
  s.chatAt = now;
  const seat = seatOf(r, id);
  for (const m of r.members) if (m.online) L.o.send(m.id, { t: 'emote', seat, id: emote, theme });
}

/** The host asks the guest to leave, at 项目调整 (房间-1). @param {Lobby} L @param {Room} r @param {number} id */
function kick(L, r, id) {
  const guest = r.members[1];
  if (seatOf(r, id) !== 0 || r.phase !== 'setup' || !guest || r.matched) return;
  leave(L, guest.id);
  if (guest.online) L.o.send(guest.id, { t: 'closed', why: 'kicked' });
}

/** The messages of a room's members. @type {Record<string, (L: Lobby, r: Room, id: number, m: any) => void>} */
const IN_ROOM = {
  kick: (L, r, id) => kick(L, r, id),
  project: (L, r, id, m) => {
    if (seatOf(r, id) !== 0 || r.phase !== 'setup' || m.index < 0 || m.index >= L.o.projects.length) return;
    Object.assign(r, { project: m.index, prepared: false });
    push(L, r);
  },
  prepare: (L, r, id, m) => {
    // 任何非房主都可以准备（不只座位 1）；房主「项目确认」要求所有非房主都准备好了。
    const seat = seatOf(r, id);
    if (seat <= 0 || r.phase !== 'setup') return;
    const seats = /** @type {Set<number>} */ (r.preparedSeats ??= new Set());
    if (m.on) seats.add(seat); else seats.delete(seat);
    r.prepared = r.members.every((x, i) => i === 0 || seats.has(i) || !x.online);
    push(L, r);
  },
  // 互选模式 (房间-8): the host turns it on or off at 项目调整; a change undoes the guest's 准备参赛
  inverse: (L, r, id, m) => {
    if (seatOf(r, id) !== 0 || r.phase !== 'setup' || r.inverse === m.on) return;
    Object.assign(r, { inverse: m.on, prepared: false });
    push(L, r);
  },
  go: (L, r, id) => go(L, r, id),
  confirm: (L, r, id, m) => confirm(L, r, id, m.squad, m.style),
  pick: (L, r, id, m) => { if (r.phase === 'pick') afterPick(L, r, pick(/** @type {Picking} */ (r.coord?.picking), seatOf(r, id), m.id)); },
  handover: (L, r, id) => { if (r.phase === 'pick') afterPick(L, r, handOver(/** @type {Picking} */ (r.coord?.picking), seatOf(r, id))); },
  lineup: (L, r, id, m) => setLineup(L, r, id, m.lineup),
  emote: (L, r, id, m) => sendEmote(L, r, id, m.id, m.theme),
  together: (L, r, id) => together(L, r, id),
  ready: (L, r, id, m) => setReady(L, r, id, m.on),
  // a like for the other seat on the last match's result, once each (房间-6)
  like: (L, r, id) => {
    const seat = seatOf(r, id);
    if (!r.likes || r.likes[seat] || r.members.length < 2) return;
    r.likes[seat] = true;
    push(L, r);
  },
};

/**
 * A session says who it is: its key — a later connection with the same key takes its place in a room (房间-1) — and
 * its name (said again: the new name). @param {Lobby} L @param {number} id @param {string} key @param {string} name
 */
function hello(L, id, key, name) {
  const old = [...L.sessions.entries()].find(([sid, s]) => s.key === key && sid !== id), was = old?.[1] ?? L.sessions.get(id);
  L.sessions.set(id, { key, name, room: was?.room ?? null, profile: was?.profile ?? NO_PROFILE, ...(was?.chatAt !== undefined ? { chatAt: was.chatAt } : {}) });
  if (old) L.sessions.delete(old[0]);
  const r = roomOf(L, id), m = r?.members.find((x) => x.key === key);
  if (r && m) { Object.assign(m, { id, name, online: true }); push(L, r); }
  L.o.send(id, { t: 'lobby', name, projects: L.o.projects, recruits: L.o.recruits });
}

/**
 * A session's name card (房间-1), as its page sends it after hello and when it changes; the room it is in shows it.
 * @param {Lobby} L @param {number} id @param {Profile} p
 */
function profile(L, id, p) {
  const s = L.sessions.get(id);
  if (!s) return;
  s.profile = { tag: p.tag, avatar: p.avatar, assist: p.assist ? { id: p.assist.id, art: p.assist.art } : null };
  const r = roomOf(L, id), m = r?.members.find((x) => x.id === id);
  if (r && m) { m.profile = s.profile; push(L, r); }
}

/** A checked message of a session that said hello. @param {Lobby} L @param {number} id @param {Record<string, any>} m */
function message(L, id, m) {
  if (m.t === 'create') create(L, id);
  else if (m.t === 'join') join(L, id, m.code);
  else if (m.t === 'leave') leave(L, id);
  else {
    const r = roomOf(L, id);
    if (r && Object.hasOwn(IN_ROOM, m.t)) IN_ROOM[m.t](L, r, id, m);
  }
}

/**
 * A room's match ended: back to 项目调整 with a new 15 minutes (房间-1, 房间-6); a matched room waits for 继续一起玩
 * (房间-10). @param {Lobby} L @param {string} match
 */
function ended(L, match) {
  const r = [...L.rooms.values()].find((x) => x.match === match);
  if (!r) return;
  toSetup(r);
  r.expires = L.o.now() + TIMES.room;
  r.likes = r.members.map(() => false);
  if (r.matched) Object.assign(r, { phase: 'together', together: r.members.map(() => false), due: L.o.now() + TIMES.together });
  push(L, r);
}

/** Time: rooms that ran out close, steps that ran out move on. @param {Lobby} L */
function tick(L) {
  const now = L.o.now();
  for (const r of [...L.rooms.values()]) {
    if (r.phase !== 'battle' && now >= r.expires) close(L, r, 'time');
    else if (r.due && now >= r.due) stepTimedOut(L, r);
  }
}

/** @param {RoomsOptions} o */
export function createRooms(o) {
  /** @type {Lobby} */
  const L = { o, rooms: new Map(), sessions: new Map(), recruitIds: o.recruits.map((e) => e.id) };
  return {
    rooms: L.rooms,
    /** @param {number} id @param {string} key @param {string} name */
    hello: (id, key, name) => hello(L, id, key, name),
    /** @param {number} id @param {Profile} p */
    profile: (id, p) => profile(L, id, p),
    /** @param {number} id @param {Record<string, any>} m */
    message: (id, m) => { if (L.sessions.has(id)) message(L, id, m); },
    /** A session's connection closed: its seat waits for it (房间-1). @param {number} id */
    gone: (id) => {
      const r = roomOf(L, id), m = r?.members.find((x) => x.id === id);
      if (r && m) { m.online = false; push(L, r); }
    },
    /** @param {string} match */
    ended: (match) => ended(L, match),
    tick: () => tick(L),
    /** Whether a session is in a room. @param {number} id */
    inRoom: (id) => !!roomOf(L, id),
    /** A matched pair's room (房间-9). @param {any} pair @param {number} project */
    openMatched: (pair, project) => openMatched(L, pair, project),
  };
}
