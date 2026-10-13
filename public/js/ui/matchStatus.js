// Pure match-status helpers of the in-match HUD (no DOM, no Preact — unit-tested in test/ui/leftovers.test.js):
//
//   * Boss-round clock (最终攻势 / 隐秘核心, research 00-INDEX §5, 01 §10): m.public.deadline is the level's
//     maxPlayTime countdown (120 real s, config modes[…].rounds[r].levelMaxPlayTime) — "计时结束后战斗仍然会继续" —
//     and m.public.overtimeAt is when the overtime drain starts (bossTurnHpReduceTime, 150 real s): from then on the
//     merged team LP loses config.bossOvertimeDrainPerSec (1) per whole real second (server gamedata.js
//     bossOvertimeDue: the first point at overtimeAt + 1 s). `overtimeState` says what the red DOT warning shows.
//   * Solo pause (official 独立模拟 battles): C2S g.pause {on}; the server says so in m.public.paused (optionally
//     m.public.pausedAt, ms epoch). Only solo battles offer it (`pauseAvailable`); while paused every HUD clock is
//     frozen at the pause moment (`frozenNow`).

import { PHASE } from '../../../shared/constants.js';

const isObj = (v) => !!v && typeof v === 'object';
const BOSS_PHASES = new Set([PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);
/** Battle phases a solo player may pause (a solo run has no 联防). */
const PAUSE_PHASES = new Set([PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);

/** Level time of a boss round when the config does not say (research 01 §3: maxPlayTime 120 s). */
export const BOSS_LEVEL_SECONDS = 120;
/** The pending overtime warning shows this many seconds before the drain even while the level countdown still runs. */
export const OVERTIME_WARN_BEFORE = 30;

/**
 * The level's countdown length (s) of a boss round — the gauge total of the 120 s countdown.
 * @param {any} pub m.public
 * @param {any} config data/config.json
 * @returns {number|null} null outside boss rounds
 */
export function bossLevelSeconds(pub, config) {
  if (!isObj(pub) || !BOSS_PHASES.has(pub.phase)) return null;
  const mode = isObj(config?.modes) ? config.modes[pub.modeId] : null;
  const v = mode?.rounds?.[String(pub.round)]?.levelMaxPlayTime;
  return Number.isFinite(v) && v > 0 ? v : BOSS_LEVEL_SECONDS;
}

/** Team LP lost per real second of overtime (config.bossOvertimeDrainPerSec, default 1). */
export function overtimeDrainPerSec(config) {
  const v = config?.bossOvertimeDrainPerSec;
  return Number.isFinite(v) && v >= 0 ? v : 1;
}

/**
 * What the red overtime (DOT) warning of a boss round shows at `now` (server-corrected ms epoch):
 *   null                                  nothing (not a boss round, no overtimeAt, or the drain is still far away)
 *   { state: 'pending', secs }            the drain starts in `secs` s (shown once the level countdown ran out, or
 *                                         within OVERTIME_WARN_BEFORE s of the drain)
 *   { state: 'drain', secs, lost, perSec } draining for `secs` whole seconds: `lost` LP so far, `perSec` LP/s
 * @param {any} pub m.public
 * @param {number} now
 * @param {{ perSec?: number, warnBefore?: number }} [o]
 */
export function overtimeState(pub, now, { perSec = 1, warnBefore = OVERTIME_WARN_BEFORE } = {}) {
  if (!isObj(pub) || !BOSS_PHASES.has(pub.phase) || !Number.isFinite(now)) return null;
  const at = Number(pub.overtimeAt);
  if (!(Number.isFinite(at) && at > 0)) return null;
  if (now < at) {
    const secs = Math.ceil((at - now) / 1000);
    const levelOver = Number.isFinite(pub.deadline) && pub.deadline > 0 && now >= pub.deadline;
    if (!levelOver && secs > warnBefore) return null;
    return { state: 'pending', secs };
  }
  const secs = Math.floor((now - at) / 1000);
  const rate = Number.isFinite(perSec) && perSec >= 0 ? perSec : 1;
  return { state: 'drain', secs, lost: secs * rate, perSec: rate };
}

/**
 * Whether the solo pause control is offered: solo runs only (hidden in co-op), while the player's own battle runs
 * (server Match.setPause: WRONG_PHASE once no battle is live). While paused the control stays (to resume).
 * @param {any} pub m.public
 * @param {{ solo?: boolean, alive?: boolean, done?: boolean }} [o] done: the own battle is over
 */
export function pauseAvailable(pub, { solo = false, alive = true, done = false } = {}) {
  if (!solo || !isObj(pub) || alive === false) return false;
  if (done && !pub.paused) return false;
  return PAUSE_PHASES.has(pub.phase);
}

/** Whether m.public says the (solo) match is paused. */
export const isPaused = (pub) => isObj(pub) && !!pub.paused;

/** The pause intent (C2S g.pause {on}). */
export const pauseIntent = (on) => ({ t: 'g.pause', fields: { on: !!on } });

/**
 * The clock every HUD countdown reads: the live server time, or — while paused — the moment the pause began
 * (m.public.pausedAt when the server sends it, else the first time this client saw `paused`).
 * @param {any} pub m.public
 * @param {number} now live server-corrected ms epoch
 * @param {number|null} seenAt when this client first saw the pause (ms epoch), or null
 */
export function frozenNow(pub, now, seenAt = null) {
  if (!isPaused(pub)) return now;
  const at = Number(pub.pausedAt);
  if (Number.isFinite(at) && at > 0) return Math.min(now, at);
  return Number.isFinite(seenAt) ? Math.min(now, seenAt) : now;
}

/**
 * Seconds left on a deadline at `now` (ceil, ≥ 0), or null without a deadline.
 * @param {number|null|undefined} deadline ms epoch
 * @param {number} now ms epoch
 */
export function remainAt(deadline, now) {
  if (!(Number.isFinite(deadline) && deadline > 0) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

// ---- 促融共竞 合作交互 (P6; PRTS main.raw 694–720) --------------------------------------------------------------------

/**
 * 倍速 (PRTS main.raw 711–714): each side owns one switch (m.public players[].speed2) and the pair gates the battle
 * speed — the server runs 2× only while BOTH are on (Match.effGameSpeed), the standard rate otherwise.
 * @param {any} pub m.public
 * @param {any} myId
 * @returns {{ mine: boolean, theirs: boolean, on: boolean }|null} null without a player list
 */
export function coopSpeed(pub, myId) {
  if (!isObj(pub) || !Array.isArray(pub.players)) return null;
  const me = pub.players.find((p) => p.playerId === myId) || null;
  const partner = pub.players.find((p) => p.playerId !== myId && !p.left) || null;
  const mine = !!me?.speed2;
  const theirs = !!partner?.speed2;
  return { mine, theirs, on: mine && theirs };
}

/**
 * 合作暂停 (PRTS main.raw 717–720): the proposer sends g.pause { on: true }, the partner answers (g.pauseVote agree /
 * decline — the proposer's own second { on: true } also counts as approval), and ANY side lifts an active pause with
 * { on: false } (the server adds a ~1 s release cooldown, m.public.pauseRelease).
 * @returns {{ paused: boolean, releasing: boolean, request: { id: number, mine: boolean }|null }|null}
 */
export function coopPause(pub, myId) {
  if (!isObj(pub)) return null;
  const req = isObj(pub.pauseRequest) ? pub.pauseRequest : null;
  return {
    paused: !!pub.paused,
    releasing: !!pub.pauseRelease,
    request: req ? { id: req.id, mine: req.proposerId === myId } : null,
  };
}

/** Whether this side raises the 合作暂停 control: while a battle phase runs (the solo rule), and always while a request is pending or the match is paused (to answer / lift it). */
export function coopPauseAvailable(pub, { alive = true, done = false } = {}) {
  if (!isObj(pub) || alive === false) return false;
  if (pub.paused || isObj(pub.pauseRequest)) return true;
  if (done) return false;
  return PAUSE_PHASES.has(pub.phase);
}

/** The pending 费用请求 of m.public.fundAsk, from this side's point of view (PRTS main.raw 694–698). */
export function coopFund(pub, myId) {
  const ask = isObj(pub?.fundAsk) ? pub.fundAsk : null;
  return ask ? { id: ask.id, mine: ask.fromId === myId } : null;
}

/**
 * The 标记 entries of m.public.marks split by side (PRTS main.raw 699–703): own marks carry their kind (标记 / 注意 /
 * 撤退), the partner's render green whatever the kind (the official reading: 对方的标记显示为绿色).
 * @returns {{ mine: any[], theirs: any[] }}
 */
export function markSides(pub, myId) {
  const out = { mine: [], theirs: [] };
  for (const m of Array.isArray(pub?.marks) ? pub.marks : []) {
    if (!m || !Number.isInteger(m.row) || !Number.isInteger(m.col)) continue;
    (m.playerId === myId ? out.mine : out.theirs).push(m);
  }
  return out;
}
