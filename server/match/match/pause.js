// server/match/match/pause.js — Match methods: the solo pause (g.pause, DESIGN §14 "Solo pause") — freeze, resume
// (every clock and deadline shifted by the pause), the drop at the battle phase's end, and the field clocks' "now".
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { msg } from '../../../shared/i18n.js';
import { BOSS_CLOCK_MS, OK, fail, FLOW_TICKER_PRIORITY } from './common.js';

export class MatchPause {
  /**
   * Solo pause (official PauseUp / ResumeUp; DESIGN §14 "Solo pause"): g.pause { on } freezes the running battle — the
   * field clock (b.start `elapsed`, the boss budgets and overtime), the result deadline / server release timers, the
   * boss clock, the HUD `deadline` / `overtimeAt` (shifted by the pause on resume) and the server-run pacers
   * (FieldRunner / HeadlessPacer skip their intervals) — and the browser's runner stops its local clock while
   * `m.public.paused` is true. Solo matches only (co-op battles never pause: WRONG_PHASE) and only while a battle runs;
   * `{ on: false }` is always accepted. A disconnect / leave, or the battle phase ending, resumes.
   */
  setPause(ps, on) {
    if (this.isCujong && ps.spectator) return fail(ERR.BAD_TARGET, 'spectators do not pause');
    if (!on) {
      if (this.isCujong && this.pauseRequest) {
        // the proposer cancels their pending request (an ACTIVE pause is lifted by any side — PRTS main.raw 717–720)
        if (this.pauseRequest.proposerId !== ps.playerId) return fail(ERR.BAD_TARGET, 'only the requester cancels the request');
        this.pauseRequest = null;
        this.markPublic();
        return OK;
      }
      if (this.isCujong && this.paused) return this._releasePause();
      this._resume();
      return OK;
    }
    if (this.paused) return OK;
    const battlePhase = this.phase === PHASE.COMBAT || this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE;
    if (!battlePhase || this._finalEnding || !this.fields.some((f) => f.live && !f.done)) return fail(ERR.WRONG_PHASE, 'no battle running');
    if (this.isCujong) {
      // 合作暂停 (PRTS main.raw 717–720): a request the partner approves; the partner's own { on: true } counts as approval
      if (this.pauseRequest) {
        if (this.pauseRequest.proposerId !== ps.playerId) return this.votePause(ps, this.pauseRequest.id, true);
        return OK;
      }
      this.pauseRequest = { id: ++this._pauseRequestSeq, proposerId: ps.playerId };
      this.markPublic();
      return OK;
    }
    if (!this.isSolo) return fail(ERR.WRONG_PHASE, 'co-op battles never pause');
    this._pauseNow();
    return OK;
  }

  /** The partner answers a 合作暂停 申请 (g.pauseVote): agreeing pauses at once, declining tells the proposer. */
  votePause(ps, voteId, agree) {
    if (!this.isCujong || ps.spectator || !this.pauseRequest || this.pauseRequest.id !== voteId) return fail(ERR.BAD_TARGET, 'stale pause request');
    if (this.pauseRequest.proposerId === ps.playerId) return fail(ERR.BAD_TARGET, 'the proposer does not answer their own request');
    if (!agree) {
      const proposer = this.players.get(this.pauseRequest.proposerId);
      this.pauseRequest = null;
      if (proposer) this.toast(proposer, 'warn', msg('{name}博士拒绝了暂停申请', { name: ps.name }));
      this.markPublic();
      return OK;
    }
    this.pauseRequest = null;
    this._pauseNow();
    return OK;
  }

  /** Freeze the running battle: field timers cancelled, every clock held at `_pausedAt`, revive countdowns frozen. */
  _pauseNow() {
    this.paused = true;
    this._pausedAt = this.sched.now();
    for (const f of this.fields) {
      if (!f.cc) continue;
      if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; f.rearmDeadline = true; }
      if (f.doneTimer) { this.cancel(f.doneTimer); f.doneTimer = null; f.rearmRelease = true; }
    }
    if (this._bossClock) { this.cancel(this._bossClock); this._bossClock = null; }
    if (this.isCujong) this._pauseCujongRevives();
    this._sampleDamage(true);
    this._flushDamage(true);
    this.markPublic();
  }

  /** The official release (main.raw 719–720): the continue click starts a ~1 s cooldown, then the pause lifts. */
  _releasePause() {
    if (this.pauseReleaseAt) return OK;
    const wait = this.scaled(1000);
    this.pauseReleaseAt = this.sched.now() + wait;
    this._pauseReleaseTimer = this.later(wait, () => {
      this._pauseReleaseTimer = null;
      this.pauseReleaseAt = 0;
      this._resume();
    });
    this.markPublic();
    return OK;
  }

  /** 促融共竞: freeze the revive countdowns (re-armed with the carried remaining time when the pause lifts). */
  _pauseCujongRevives() {
    for (const ps of this.order) {
      if (!ps.reviving || !(ps.reviveAt > 0)) continue;
      ps._reviveLeftAtPause = Math.max(0, ps.reviveAt - this._pausedAt);
      const h = this._cujongReviveTimers.get(ps.playerId);
      if (h) { this.cancel(h); this._cujongReviveTimers.delete(ps.playerId); }
    }
  }

  _resumeCujongRevives() {
    for (const ps of this.order) {
      const left = ps._reviveLeftAtPause;
      if (!ps.reviving || left == null) continue;
      ps._reviveLeftAtPause = null;
      ps.reviveAt = this.sched.now() + left;
      this._armCujongRevive(ps);
    }
  }

  /** End a solo pause: every clock and deadline moves on by the paused time (no-op when not paused). */
  _resume() {
    if (!this.paused) return;
    const d = Math.max(0, this.sched.now() - this._pausedAt);
    this.paused = false;
    this._pausedAt = 0;
    this.pausedMs += d;
    if (this.deadline) this.deadline += d;
    if (this.overtimeAt) this.overtimeAt += d;
    if (this._bossStartAt != null) this._bossStartAt += d;
    for (const f of this.fields) {
      if (!f.cc || f.done) continue;
      f.startAt += d;
      f.lastProgressAt += d;
      if (f.rearmDeadline && f.mode === 'client') this._armDeadline(f);
      if (f.rearmRelease && f.mode === 'server') this._armRelease(f);
      f.rearmDeadline = false;
      f.rearmRelease = false;
    }
    if (this._bossClockOn && !this._bossClock && (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE)) {
      this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
    }
    if (this.isCujong) this._resumeCujongRevives();
    if (this._pauseReleaseTimer) { this.cancel(this._pauseReleaseTimer); this._pauseReleaseTimer = null; }
    this.pauseReleaseAt = 0;
    if (this.runner?.remote) this.runner.resume();
    this.markPublic();
  }

  /** The battle phase is over: drop the pause without shifting anything (its timers are gone). */
  _clearPause() {
    this.pauseRequest = null;
    if (this._pauseReleaseTimer) { this.cancel(this._pauseReleaseTimer); this._pauseReleaseTimer = null; }
    this.pauseReleaseAt = 0;
    if (this.isCujong) this._resumeCujongRevives();
    if (!this.paused) return;
    this.pausedMs += Math.max(0, this.sched.now() - this._pausedAt);
    this.paused = false;
    this._pausedAt = 0;
    this.markPublic();
  }

  /** The field clocks' "now": frozen at the pause instant while paused. */
  _clockNow() { return this.paused ? this._pausedAt : this.sched.now(); }
}
