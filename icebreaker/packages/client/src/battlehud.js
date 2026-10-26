// The original battle UI (the engine's docs/spec/ui.md 界面-10…14, ADR 0021): when the assets have the battle UI pack,
// @aue/ui draws it over the field — the deploy cards, the cost, the top bar (the co-op one in a match of two), the
// direction selector and the operator menu. What it shows is worked out here from each frame's view, the match status
// and the server's control state.
import { secondsToFrames } from '@aue/math';
import { ROSTER } from '@aue/content';
import { KIND, NO_SKILL, SKILL_STATE } from '@aue/schema';
import { costAsk, placeSummons } from '@aue/ui';

const FPS = 30;
/** How long a cost or pause request stays open (合作-5, 同步-8), in seconds. */
const OPEN = 15;
/** The most cost an accepted request moves when the level gives no cap (合作-5). */
const TRANSFER = 15;

/** @typedef {{ fast: number[], held: number, asker: number, resuming: number }} Control */
/** @typedef {import('@aue/worker').Status} Status */

/**
 * The battle UI pack and the skill icons of the assets (ui/battle.json, ui/skills/index.json), or null without them.
 * @param {URL} assets the assets' base URL
 */
export async function loadUiPack(assets) {
  const res = await fetch(new URL('ui/battle.json', assets)).catch(() => null);
  if (!res?.ok) return null;
  const icons = await fetch(new URL('ui/skills/index.json', assets)).then((r) => (r.ok ? r.json() : null), () => null);
  return { pack: await res.json(), icons: /** @type {Record<string, string>} */ (icons?.icons ?? {}) };
}

/**
 * The seat's deck as cards: avatar, profession, rarity, elite phase and 再部署时间 of each operator — 堡垒守御's builders
 * as counted cards (the engine's 界面-39) —; then the summon cards of its operators (the engine's 界面-23), put in by cost
 * and id.
 * @param {import('@aue/schema').Match} match @param {any} content @param {number} seat @param {(char: string) => string | null} avatar
 * @param {Readonly<Record<string, { profession: string, rarity: number }>>} [roster] the operators to choose from: the host's mods' among them (页面-10)
 * @returns {import('@aue/ui').DeckCard[]}
 */
export function deckCards(match, content, seat, avatar, roster = ROSTER) {
  const builds = new Map((match.decks?.[seat] ?? []).map((d) => [d.id, d.build])), keys = /** @type {string[]} */ (content.decks?.[seat] ?? []);
  const ops = keys.map((k) => {
    const op = content.operators[k], char = op.char ?? k, r = roster[char];
    return { id: k, avatar: avatar(char), profession: op.profession ?? r?.profession ?? '', rarity: r?.rarity ?? 1, phase: builds.get(k)?.elite ?? 0, respawn: op.respawnTime ?? 60,
      ...(op.builder ? { pool: true } : {}) };
  });
  const summons = Object.entries(content.operators).filter(([, o]) => ((o.summon?.supply ?? 0) > 0 || (o.summon?.grant?.n ?? 0) > 0) && keys.includes(o.summoner))
    .map(([k, o]) => ({ id: k, avatar: avatar(o.char ?? k), profession: o.profession ?? '', rarity: 1, phase: 0, respawn: o.respawnTime ?? 0, summon: true }));
  return placeSummons(ops, summons, (id) => content.operators[id].cost ?? 0);
}

/** The speed the battle runs at (同步-7): 2× only when every seat has its switch on. @param {Control | null} c */
export const battleSpeed = (c) => (c && c.fast.length > 0 && c.fast.every((f) => f === 1) ? 2 : 1);

/**
 * What the page remembers between frames for the requests: the last answer to this seat's cost request (its frame),
 * and since when (page milliseconds) the current pause request has been open.
 * @typedef {{ answer: { accept: number, amount: number, frame: number } | null, pauseSince: number, now: number }} Requests
 */

/**
 * The requests remembered after a frame's events and the control state: an `answer` to this seat's request is kept;
 * a pause request's start is the first moment it was seen open.
 * @param {Requests} r
 * @param {{ events: Record<string, string | number>[], control: Control | null, seat: number, frame: number, now: number }} f
 * @returns {Requests}
 */
export function requestsAfter(r, f) {
  const { events, control, seat, frame, now } = f;
  let answer = r.answer;
  for (const e of events) if (e.type === 'answer' && Number(e.owner) === seat) answer = { accept: Number(e.accept), amount: Number(e.amount), frame };
  const open = control !== null && control.asker >= 0 && !control.held;
  return { answer, pauseSince: open ? (r.pauseSince >= 0 ? r.pauseSince : now) : -1, now };
}

/**
 * What the HUD shows of a frame; in 堡垒守御 the builders' cards left and whether they may be deployed (a rest).
 * @param {{ view: import('@aue/schema').View, status: Status, control: Control | null, seat: number, options: any, selected: string | null,
 *   stages?: any[], waves?: number, requests?: Requests, offline?: boolean, training?: boolean }} o
 * @returns {import('@aue/ui').HudState}
 */
export function hudState(o) {
  const { view, status, control, seat } = o, p = view.players[seat], ps = status.players[seat], speed = battleSpeed(control), paused = !!control?.held, f = status.fortress;
  return {
    frame: view.frame, fps: FPS, cost: p.cost, cards: ps.cards, deployed: ps.deployed, slots: ps.slots, summons: ps.summons,
    ...(f ? { counts: f.pools[seat] ?? {}, building: f.phase === 'rest' } : {}),
    costTimer: ps.costTimer, costPeriod: secondsToFrames(o.options.costIncreaseTime), maxCost: o.options.maxCost, selected: o.selected,
    life: p.life, speed, paused, coop: view.players.length === 2 ? coopState(o, speed, paused) : undefined,
    states: { result: status.result, down: ps.revive >= 0, offline: !!o.offline },
    stageStart: stageStartOf(status, o.stages ?? [], view.frame, { training: !!o.training, waves: o.waves ?? 0 }),
  };
}

/**
 * A stage that has just begun (the engine's 界面-22, 界面-40): within a second of its start, its number and its task's
 * texts (关卡-5), in a training or not; in 堡垒守御 a wave whose defence has just begun, its number of the level's
 * waves; else, or without texts, null.
 * @param {Status} s @param {any[]} stages @param {number} frame @param {{ training: boolean, waves: number }} o
 * @returns {import('@aue/ui').StageStart | null}
 */
export function stageStartOf(s, stages, frame, o = { training: false, waves: 0 }) {
  const f = s.fortress, training = o.training ? { training: true } : {};
  if (f) {
    if (f.phase !== 'defend' || frame < f.start || frame - f.start >= FPS) return null;
    return { stage: f.wave + 1, title: '', basic: '', defence: { wave: f.wave + 1, waves: o.waves, last: f.wave === o.waves - 1 }, ...training };
  }
  const task = stages[s.stage]?.task;
  if (!task || frame < s.start || frame - s.start >= FPS) return null;
  return { stage: s.stage + 1, title: task.title, basic: task.basic, ...(task.advanced !== undefined ? { advanced: task.advanced } : {}), ...training };
}

/**
 * The co-op top bar's and the cost request's state (界面-12, 界面-15–17), 堡垒守御's (界面-39).
 * @param {{ view: import('@aue/schema').View, status: Status, control: Control | null, seat: number, options: any, stages?: any[], waves?: number, requests?: Requests }} o
 * @param {number} speed @param {boolean} paused
 */
function coopState(o, speed, paused) {
  const side = (/** @type {number} */ i) => ({ life: o.view.players[i].life, fast: o.control?.fast[i] === 1, revive: o.status.players[i].revive >= 0 ? o.status.players[i].revive / FPS : -1 });
  const r = o.requests, c = o.control, mate = 1 - o.seat;
  const left = r && r.pauseSince >= 0 ? Math.max(0, 1 - (r.now - r.pauseSince) / (OPEN * 1000)) : 0;
  return { me: side(o.seat), mate: side(mate), speed, paused, asking: c?.asker === o.seat && r ? left : -1, confirm: c?.asker === mate && r ? left : -1,
    task: taskOf(o.status, o.stages ?? [], o.view.frame), cost: costAsk(costInput(o)), ...fortressOf(o.status, o.waves ?? 0, o.view.frame, o.seat) };
}

/**
 * 堡垒守御 on the co-op top bar and the rest panel (the engine's 界面-39): the wave (1-based; in a rest the one to come)
 * of the level's, the wave's enemies gone of its own, the seconds left of its defence or of the rest, the last wave's
 * damage; in a rest each side's 「休整完毕」. Nothing in another level.
 * @param {Status} s @param {number} waves @param {number} frame @param {number} seat
 * @returns {{ fortress?: import('@aue/ui').FortressTask, resting?: import('@aue/ui').Resting | null }}
 */
export function fortressOf(s, waves, frame, seat) {
  const f = s.fortress;
  if (!f) return {};
  const left = Math.max(0, (f.until - frame) / FPS), rest = f.phase === 'rest';
  return {
    // the status's wave is the one defended last, so in a rest the one to come is the next
    fortress: { wave: f.wave + (rest ? 2 : 1), waves, out: rest ? 0 : f.out, total: rest ? 0 : f.total, left, last: f.wave === waves - 1 && !rest, damage: f.damage },
    resting: rest ? { left, me: !!f.ready[seat], mate: !!f.ready[1 - seat] } : null,
  };
}

/**
 * The stage's task (界面-16, 合作-6): its number, objective, count, goals and the seconds left of its time — of its rest
 * while that runs; none before the first stage.
 * @param {Status} s @param {any[]} stages @param {number} frame @returns {import('@aue/ui').Task | null}
 */
export function taskOf(s, stages, frame) {
  const st = stages[s.stage];
  if (!st) return null;
  const left = frame < s.start ? (s.start - frame) / FPS : Math.max(0, (s.start + secondsToFrames(st.time) - frame) / FPS);
  return { stage: s.stage + 1, objective: st.objective, count: s.count, goal: st.goal, ...(st.advanced !== undefined ? { advanced: st.advanced } : {}), left };
}

/**
 * The cost request's inputs (合作-5): each side's open request, this seat's wait, whether it may ask (a mate, neither
 * side down, its cost under the cap, no open request), the last answer, the cap and what the mate's request would take.
 * @param {{ view: import('@aue/schema').View, status: Status, seat: number, options: any, requests?: Requests }} o
 * @returns {import('@aue/ui').CostAskInput}
 */
export function costInput(o) {
  const mate = 1 - o.seat, me = o.status.players[o.seat], them = o.status.players[mate], max = o.options.maxCost, cap = o.options.costTransfer ?? TRANSFER;
  const mine = o.view.players[o.seat], theirs = o.view.players[mate], a = o.requests?.answer ?? null;
  const canAsk = me.revive < 0 && them.revive < 0 && mine.cost < max && me.ask < 0 && them.ask < 0 && me.askCd <= 0;
  return { mine: me.ask, mates: them.ask, cooldown: me.askCd, canAsk, cap, give: Math.max(0, Math.min(cap, mine.cost, max - theirs.cost)),
    answer: a ? { accept: a.accept, amount: a.amount, ago: (o.view.frame - a.frame) / FPS } : null, fps: FPS, open: OPEN * FPS };
}

/**
 * The operator menu's skill of a unit: its icon, how it starts, its state and share (SP gathered, or time left of its
 * run), whether it may be stopped, whether a status keeps the operator from starting it (the engine's 界面-14); null
 * without a skill.
 * @param {import('@aue/schema').ViewUnit} u @param {any} op the operator's content @param {Record<string, string>} icons @param {string} base the icons' URL
 * @returns {import('@aue/ui').MenuSkill | null}
 */
export function menuSkill(u, op, icons, base) {
  const sk = op?.skill;
  if (!sk || u.skill === SKILL_STATE.NONE) return null;
  const icon = icons[sk.id] ? new URL(icons[sk.id], base).href : null, run = sk.duration > 0 ? secondsToFrames(sk.duration) : 0;
  const state = u.skill === SKILL_STATE.RUNNING ? 'running' : u.skill === SKILL_STATE.READY ? 'ready' : 'charging';
  const share = state === 'running' ? (run > 0 && u.skillLeft >= 0 ? Math.min(1, u.skillLeft / run) : 1) : state === 'ready' ? 1 : u.spCost > 0 ? Math.min(1, u.sp / u.spCost) : 0;
  return { icon, manual: sk.type === 'MANUAL', state, share, stoppable: !!sk.stoppable, blocked: (u.status & NO_SKILL) !== 0 };
}

/**
 * The units' bars (the engine's 界面-19, 界面-20): each drawn unit with where its feet are on the canvas, its kind (an
 * operator or a device on our side, an enemy or a device on theirs, a leader), its HP share, an operator's skill (state and share) and its element;
 * an operator of this seat its skill mark: ready when its manual skill can start, stop while a skill that may be stopped runs (neither while a
 * status keeps it from its skill).
 * @param {import('@aue/schema').View} view
 * @param {{ leaders: Set<string>, foeDevices?: Set<string>, keyOf: (id: number) => string | undefined, shows: (id: number) => boolean, at: (u: import('@aue/schema').ViewUnit) => number[],
 *   operators: Record<string, any>, unitKey: (id: number) => string | undefined, seat?: number }} o
 * @returns {import('@aue/ui').UnitBar[]}
 */
export function unitBars(view, o) {
  return view.units.filter((u) => o.shows(u.id)).map((u) => {
    const op = u.kind === KIND.OPERATOR, s = op ? menuSkill(u, o.operators[o.unitKey(u.id) ?? ''], {}, 'http://x/') : null, key = o.keyOf(u.id) ?? '';
    const ours = op || (u.kind === KIND.DEVICE && !o.foeDevices?.has(key));
    return {
      id: u.id, at: o.at(u), kind: ours ? 'char' : o.leaders.has(key) ? 'boss' : 'enemy',
      hp: u.maxHp > 0 ? Math.max(0, Math.min(1, u.hp / u.maxHp)) : 0,
      sp: s ? { state: s.state, share: s.share } : null,
      el: u.element > 0 ? { element: u.element, share: u.ep, burst: u.burst === 1 } : null,
      mark: s && u.owner === o.seat ? skillMark(s) : null,
    };
  });
}

/** An operator's skill mark (the engine's 界面-19) from its menu skill. @param {import('@aue/ui').MenuSkill} s @returns {'ready' | 'stop' | null} */
const skillMark = (s) => (s.blocked ? null : s.state === 'ready' && s.manual ? 'ready' : s.state === 'running' && s.stoppable ? 'stop' : null);

/** This seat's operator standing on a tile, or null. @param {import('@aue/schema').View} view @param {number} seat @param {{ row: number, col: number }} t */
export const ownUnitAt = (view, seat, t) => view.units.find((u) => u.kind === KIND.OPERATOR && u.owner === seat && Math.round(u.x) === t.col && Math.round(u.y) === t.row) ?? null;
