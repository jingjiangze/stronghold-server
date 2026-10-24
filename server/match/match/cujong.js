// server/match/match/cujong.js — Match methods: the 促融共竞 (mode_cujong_*) co-op main loop.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated, `this` is the match).
//
// Reading of the official mode (玩法-PRTS.md §5.1–5.2, main.raw 213–251) and the remake adaptation:
//   * each side owns its own 目标点生命 (`targetLp`); an enemy reaching a side's target point debits that side, and a
//     共同敌手 (the jumping-arrow marker — the sim marks its leaked entry `common`) debits BOTH sides. The ordinary
//     in-battle `lp` is not charged in this mode: targetLp is the life the bar shows (views) and the result carries;
//   * targetLp 0 ⇒ the 死亡状态 (`reviving`): the side acts nothing while its board keeps fighting (this remake's
//     COMBAT is simulated, so "场上干员失效" adapts to "指挥失效"); the countdown is 30 REAL seconds and ANY leak on
//     that side's own field resets it to 30 s; when it expires the side revives — command and full targetLp back;
//   * both sides downed at once = the field cannot be held — the match is lost;
//   * one match = two stages (gd.halftimeRound): stage 1 clears into 中场休整 — both targetLp restored, the fallen
//     auto-revived, every operator withdrawn to the hand (the redeploy-time reset has no remake-side state to clear) —
//     then stage 2 runs on. 嘉奖印章 (placeholder objective reading until P3–P5 land the per-project goals): stage 1
//     +1, stage 2 +1, the advanced goal (stage 2 cleared with no death all match) +1, any side dying ≥ 2 times −1; ≥ 0.
import { PHASE, ERR, MATCH_STYLES } from '../../../shared/constants.js';
import { msg } from '../../../shared/i18n.js';
import { boardOrder, tileKey } from '../board.js';
import { deriveSeed } from '../../sim/rng.js';
import { FOOTBALL_RIVAL_IDS } from '../../sim/content/football.js';
import { OK, fail, FLOW_TICKER_PRIORITY } from './common.js';

/** The 30 s revive window of the official mode (main.raw 234–235), scaled like every other deadline. */
const REVIVE_MS = 30_000;

export class MatchCujong {
  /** The target-point life exists from INFO_CHECK on (the bar reads it in every phase; `lp` starts at the band pick). */
  cujongInitTargets() {
    if (!this.isCujong) return;
    for (const ps of this.order) {
      ps.targetLpMax = this.gd.cujongTargetLp;
      ps.targetLp = ps.targetLpMax;
    }
    // 阵地足球 (P3): the rival team of this match — deterministic from the seed (sim/content/football.js flavors its waves)
    if (this.cujongProject === 'football' && this.cujongRival == null) {
      this.cujongRival = FOOTBALL_RIVAL_IDS[deriveSeed(this.seed, 'cujong:rival') % FOOTBALL_RIVAL_IDS.length];
    }
  }

  /** PlayerState init at the band pick (the same moment `ps.lp` starts): the style default + 游走's deploy slot. */
  cujongInitPlayer(ps) {
    if (!this.isCujong) return;
    if (!MATCH_STYLES.includes(ps.styleId)) ps.styleId = 'basic'; // the official default style
    // 游走: 可部署人数 -1 (the sim side carries this style's redeploy / initial-SP parts; the cap is a match-side number)
    if (ps.styleId === 'roaming') ps.deployCapBonus -= 1;
  }

  /** g.matchStyle (INFO_CHECK): every player picks their own 比赛风格; INFO_CHECK itself is the freeze. */
  pickMatchStyle(ps, styleId) {
    if (!this.isCujong) return fail(ERR.WRONG_PHASE, 'match styles are a cujong feature');
    if (this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
    if (this.setupVote) return fail(ERR.WRONG_PHASE, 'setup reroll vote in progress');
    if (!MATCH_STYLES.includes(styleId)) return fail(ERR.BAD_TARGET);
    if (ps.styleId !== styleId) {
      ps.styleId = styleId;
      this.markPrivate(ps);
      this.markPublic();
    }
    return OK;
  }

  /**
   * The per-side targetLp charge of this settle. Each side pays its own counted leaks (a 联防 leaker the survivors —
   * the same reading the ordinary LP charge uses) plus one point per 共同敌手 that leaked on the OTHER side's field;
   * a side's round total stays under gd.lpCapPerRound like the ordinary charge.
   */
  cujongTargetLosses(alive, resultOf, { uniteRan = false, plan = null, survivors = null } = {}) {
    const cap = this.gd.lpCapPerRound;
    const counted = (r) => (r && Array.isArray(r.leaked) ? r.leaked.filter((l) => l && l.counted !== false) : []);
    const losses = new Map();
    for (const ps of alive) {
      const own = counted(resultOf(ps));
      const base = uniteRan && plan.leakers.includes(ps) ? Math.min(cap, survivors.get(ps.playerId) || 0) : Math.min(cap, own.length);
      let incoming = 0;
      for (const other of alive) {
        if (other === ps) continue;
        incoming += counted(resultOf(other)).filter((l) => l.common === true).length;
      }
      losses.set(ps.playerId, Math.min(cap, base + incoming));
    }
    return losses;
  }

  /** Charge the target-point lives, then run the death / countdown-reset machine (from settle, before its own loop). */
  cujongChargeTargets(alive, losses, resultOf) {
    for (const ps of alive) {
      const loss = losses.get(ps.playerId) || 0;
      if (loss > 0) {
        ps.targetLp = Math.max(0, ps.targetLp - loss);
        ps.stats.lpLost += loss;
      }
      const own = (resultOf(ps)?.leaked || []).filter((l) => l && l.counted !== false).length;
      if (ps.targetLp <= 0 && !ps.reviving) this._cujongDown(ps);
      else if (ps.reviving && own > 0) this._cujongResetCountdown(ps);
    }
  }

  _cujongDown(ps) {
    ps.reviving = true;
    ps.reviveAt = this.sched.now() + this.scaled(REVIVE_MS);
    ps.deaths += 1;
    ps.ready = true; // the round never waits for a downed side
    this.toast(ps, 'error', msg('目标生命值耗尽：进入复活等待，维持目标点 30 秒无敌人即可复活'));
    this.tickerText(msg('{name}博士的目标生命值归零，进入复活等待', { name: ps.name }), FLOW_TICKER_PRIORITY);
    this._armCujongRevive(ps);
    this.markPublic();
    this.markPrivate(ps);
  }

  /** An enemy entering the downed side's target point (a leak on its own field) resets the countdown to 30 s. */
  _cujongResetCountdown(ps) {
    ps.reviveAt = this.sched.now() + this.scaled(REVIVE_MS);
    this._armCujongRevive(ps);
    this.markPublic();
  }

  _armCujongRevive(ps) {
    const prev = this._cujongReviveTimers.get(ps.playerId);
    if (prev) this.cancel(prev);
    const left = Math.max(0, ps.reviveAt - this.sched.now());
    const h = this.later(left, () => {
      this._cujongReviveTimers.delete(ps.playerId);
      this._cujongCheckRevive(ps);
    });
    if (h) this._cujongReviveTimers.set(ps.playerId, h);
  }

  _cujongCheckRevive(ps) {
    if (this.ended || this.disposed || !ps.reviving) return;
    if (this.sched.now() < ps.reviveAt) { this._armCujongRevive(ps); return; }
    this.cujongRevive(ps);
  }

  /** Bring a downed side back: command returns, the target-point life is full again. Also used by 中场休整. */
  cujongRevive(ps) {
    const timer = this._cujongReviveTimers.get(ps.playerId);
    if (timer) { this.cancel(timer); this._cujongReviveTimers.delete(ps.playerId); }
    if (!ps.reviving) return;
    ps.reviving = false;
    ps.reviveAt = 0;
    ps.targetLp = ps.targetLpMax;
    ps.ready = false;
    this.toast(ps, 'success', msg('已复活：指挥权与目标生命值已恢复'));
    this.tickerText(msg('{name}博士已复活', { name: ps.name }), FLOW_TICKER_PRIORITY);
    this.markPublic();
    this.markPrivate(ps);
  }

  /** TRUE when every alive side is downed at once — nothing holds the field (afterSettle → defeat). */
  cujongAllDown() {
    const alive = this.alivePlayers();
    return this.isCujong && alive.length > 0 && alive.every((p) => p.reviving);
  }

  /** HALFTIME 中场休整 (afterSettle, stage 1 cleared): restore, auto-revive, withdraw every operator, then stage 2. */
  enterHalftime() {
    this.phase = PHASE.HALFTIME;
    this.cujongStage = 2;
    // the stage-1 stamp is the placeholder objective; 阵地足球's stamps award from its 净胜球 at the finish instead
    if (this.cujongProject !== 'football') this.cujongStamps.stage1 = true;
    for (const ps of this.order) {
      if (!ps.alive) continue;
      this.cujongRevive(ps); // no-op for the standing; the fallen come back with full targetLp
      this._cujongWithdrawAll(ps);
      ps.ready = false;
    }
    this.tickerText(msg('第一阶段完成 · 中场休整：目标生命值恢复，全员撤回整备'), FLOW_TICKER_PRIORITY);
    this.setDeadline(this.gd.timer('battleCheck'), () => this.startRound(this.round + 1), { silent: this.soloUntimed });
    this.markPublic();
  }

  /** 干员撤退 (中场休整): deployed operators withdraw to the hand (overflow temp), summons return to their owner. */
  _cujongWithdrawAll(ps) {
    if (typeof ps.stow !== 'function' || typeof ps._returnToken !== 'function') return;
    for (const kind of ['chess', 'token']) {
      for (const { r, c, piece } of boardOrder(ps.board)) {
        if (piece.kind !== kind) continue;
        const key = tileKey(r, c);
        ps.board.delete(key);
        const ok = kind === 'chess' ? !!ps.stow(piece, { allowTemp: true }) : !!ps._returnToken(piece);
        if (!ok) { ps.board.set(key, piece); continue; } // hand and temp full: the piece stays put (nothing is lost)
        if (kind === 'chess') ps.removeTokensOf(piece.uid);
      }
    }
    ps.recompute();
  }

  /** Stamp close-out at finish(): stage 2's clear and the advanced goal (placeholder) — or the football thresholds. */
  cujongFinalizeStamps(victory) {
    if (this.cujongProject === 'football') {
      // 阵地足球: the 嘉奖印章 thresholds are the official 净胜球 1 / 2 / 4 (main.raw; the training-stage missions),
      // earned from the match's counters whatever way it ended (比赛提前结束并结算已得印章)
      const diff = (this.cujongGoals.for || 0) - (this.cujongGoals.against || 0);
      this.cujongStamps = { stage1: diff >= 1, stage2: diff >= 2, advanced: diff >= 4 };
      return;
    }
    if (this.cujongStage === 2 && victory) {
      this.cujongStamps.stage2 = true;
      const deaths = [...this.players.values()].reduce((s, p) => s + (p.deaths || 0), 0);
      this.cujongStamps.advanced = deaths === 0;
    }
  }

  /** The 嘉奖印章 the settlement carries: stage 1 + stage 2 + advanced, −1 when any side died ≥ 2 times (≥ 0). */
  cujongStampsTotal() {
    let n = 0;
    if (this.cujongStamps.stage1) n += 1;
    if (this.cujongStamps.stage2) n += 1;
    if (this.cujongStamps.advanced) n += 1;
    const deaths = [...this.players.values()].reduce((s, p) => s + (p.deaths || 0), 0);
    if (deaths >= 2) n -= 1;
    return Math.max(0, n);
  }

  // ---- P6 合作交互 (PRTS main.raw 694–720) ---------------------------------------------------------------------

  /** 双方均断线 ⇒ the system pauses and waits for a reconnect (PRTS main.raw 738; called from onDisconnect). */
  _autoPauseBothGone() {
    if (this.paused || this.ended || this.disposed) return;
    const battlePhase = this.phase === PHASE.COMBAT || this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE;
    if (!battlePhase || this._finalEnding || !this.fields.some((f) => f.live && !f.done)) return;
    const humans = this.order.filter((p) => !p.isBot && !p.left);
    if (humans.length && humans.every((p) => p.connected === false)) {
      this.pauseRequest = null;
      this._pauseNow();
    }
  }

  /** Both sides' 倍速 switches on ⇒ the standard speed; otherwise the classic 1× (half of the engine's base). */
  get cujongSpeed2() {
    if (!this.isCujong) return false;
    const members = this.order.filter((p) => !p.isBot && !p.left);
    return members.length > 0 && members.every((p) => p.speed2 === true);
  }

  /** The battle speed the engine paces at (P6 倍速: 促融共竞 halves the standard speed until both switches are on). */
  get effGameSpeed() {
    return this.isCujong && !this.cujongSpeed2 ? this.gameSpeed / 2 : this.gameSpeed;
  }

  /** g.speed (P6 倍速, PRTS main.raw 711–714): each side toggles its own switch; the pair gates `effGameSpeed`. */
  setSpeed(ps, on) {
    if (!this.isCujong) return fail(ERR.WRONG_PHASE, 'the speed switch is a cujong feature');
    if (ps.spectator) return fail(ERR.BAD_TARGET, 'spectators do not drive the co-op features');
    if (ps.speed2 !== on) {
      ps.speed2 = on;
      this.markPublic();
    }
    return OK;
  }

  /**
   * g.fundAsk (P6 费用请求, PRTS main.raw 694–698): ask the partner to wire funds over — one approval moves up to 15
   * of THEIR holdings, with a 15 s cooldown on the requester. A partner who has left (or an AI teammate) counts as an
   * unconditional accept. Prep only: the remake's funds are the prep currency.
   */
  /**
   * 实时协防 (mode_cujong_realtime): the player deploys one of their OWN board pieces live during COMBAT. The piece
   * was created at battle start but held off the field (`Battle.flags.liveDeploy`); this hands the order to the phase's
   * runner — inline fields answer synchronously, the combat worker queues a bounded control command and answers on its
   * reply turn (`m.deploy` carries `{ ok, error?, uid?, dp? }` to the deployer only).
   *
   * Phase-gated to COMBAT (the whole point of the mode), the runner must be alive, and the seat must be a living
   * player (spectators / downed-reviving seats have no field of their own).
   */
  cujongDeploy(ps, { uid } = {}) {
    if (!this.isCujong || !this.cujongRealtime) return fail(ERR.WRONG_PHASE, 'live deploy is the realtime project');
    if (this.phase !== PHASE.COMBAT || !this.runner) return fail(ERR.WRONG_PHASE, 'live deploy runs in combat');
    if (!ps || ps.spectator || !ps.alive) return fail(ERR.ELIMINATED);
    if (ps.reviving) return fail(ERR.REVIVING);
    if (!Number.isSafeInteger(uid) || uid <= 0) return fail(ERR.BAD_TARGET, 'which unit');
    const fieldId = `n:${ps.playerId}`;
    this.runner.deploy(fieldId, { playerId: ps.playerId, uid }, (out) => {
      if (out.ok) this.cujongDp[ps.playerId] = out.dp;
      this.sendTo(ps.playerId, { t: 'm.deploy', ok: !!out.ok, ...(out.ok ? { uid: out.uid, dp: out.dp } : { error: out.error || 'unknown' }) });
      if (out.ok) this.markPublic();
    });
    return OK;
  }

  fundAsk(ps) {
    if (!this.isCujong) return fail(ERR.WRONG_PHASE, 'the fee request is a cujong feature');
    if (ps.spectator) return fail(ERR.BAD_TARGET, 'spectators do not drive the co-op features');
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE, 'the fee request lives in the prep');
    if (ps.reviving) return fail(ERR.REVIVING);
    const now = this.sched.now();
    if (now - ps.lastFundAskAt < this.scaled(15000)) return fail(ERR.RATE, 'fee request cooldown');
    // a pending request lapses after 30 s (the official flow has no cancel — a silent partner must not block the slot forever)
    if (this.fundAskReq && now - this.fundAskReq.at >= this.scaled(30000)) this.fundAskReq = null;
    if (this.fundAskReq) return fail(ERR.RATE, 'a fee request is already pending');
    const mate = this.order.find((p) => p !== ps); // the teammate seat, left or not
    // 对方已丧失指挥权时你无法执行费用请求 (PRTS main.raw 698) — while they are downed the request is refused
    if (mate && !mate.left && mate.reviving) return fail(ERR.REVIVING, 'the partner lost command');
    ps.lastFundAskAt = now;
    if (!mate || mate.left || mate.isBot) {
      // 对方已退出时，你发出的费用请求会被无条件接受 (an AI teammate counts as an unconditional accept too)
      const amount = mate ? Math.min(15, Math.max(0, mate.funds)) : 0;
      if (amount > 0 && mate) {
        mate.spend(amount);
        ps.addFunds(amount, { reason: 'cujong-fund' });
        this.toast(ps, 'success', msg('已划拨 {n} 资金', { n: amount }));
        this.toast(mate, 'success', msg('已向 {name}博士划拨 {n} 资金', { name: ps.name, n: amount }));
      } else {
        this.toast(ps, 'warn', msg('对方没有可划拨的资金'));
      }
      return OK;
    }
    this.fundAskReq = { id: ++this._fundAskSeq, fromId: ps.playerId, at: now };
    const reqId = this.fundAskReq.id;
    this.later(this.scaled(30000), () => {
      if (this.fundAskReq && this.fundAskReq.id === reqId) { this.fundAskReq = null; this.markPublic(); }
    });
    this.toast(mate, 'warn', msg('{name}博士请求费用支援', { name: ps.name }));
    this.markPublic();
    return OK;
  }

  /** g.fundAnswer (the partner, PRTS main.raw 694–698): approve moves up to 15 of THEIR funds; decline tells them. */
  fundAnswer(ps, askId, accept) {
    const ask = this.fundAskReq;
    if (!this.isCujong || ps.spectator || !ask || ask.id !== askId) return fail(ERR.BAD_TARGET, 'stale fee request');
    if (this.phase !== PHASE.PREP || this.sched.now() - ask.at >= this.scaled(30000)) {
      this.fundAskReq = null;
      this.markPublic();
      return fail(ERR.BAD_TARGET, 'stale fee request');
    }
    if (ask.fromId === ps.playerId) return fail(ERR.BAD_TARGET, 'the requester does not answer');
    const from = this.players.get(ask.fromId);
    this.fundAskReq = null;
    if (!from || from.left) { this.markPublic(); return OK; }
    if (!accept) {
      this.toast(from, 'warn', msg('{name}博士拒绝了费用请求', { name: ps.name }));
      this.markPublic();
      return OK;
    }
    const amount = Math.min(15, Math.max(0, ps.funds));
    if (amount > 0) ps.spend(amount);
    from.addFunds(amount, { reason: 'cujong-fund' });
    this.toast(from, 'success', msg('已划拨 {n} 资金', { n: amount }));
    this.toast(ps, 'success', msg('已向 {name}博士划拨 {n} 资金', { name: from.name, n: amount }));
    this.markPublic();
    return OK;
  }

  /** g.mark (P6 标记, PRTS main.raw 699–703): highlight a tile for both sides (5 s cooldown, one active per side). */
  mark(ps, { row, col, kind = 'mark' }) {
    if (!this.isCujong) return fail(ERR.WRONG_PHASE, 'the tile mark is a cujong feature');
    if (ps.spectator) return fail(ERR.BAD_TARGET, 'spectators do not drive the co-op features');
    const okPhase = this.phase === PHASE.PREP || this.phase === PHASE.COMBAT || this.phase === PHASE.UNITE
      || this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE;
    if (!okPhase) return fail(ERR.WRONG_PHASE);
    const now = this.sched.now();
    if (now - ps.lastMarkAt < this.scaled(5000)) return fail(ERR.RATE, 'mark cooldown');
    ps.lastMarkAt = now;
    const entry = { playerId: ps.playerId, row, col, kind, seq: ++this._markSeq };
    this.marks.set(ps.playerId, entry);
    this.broadcast({ t: 'm.mark', ...entry });
    this.markPublic(); // m.public.marks is what the clients render — push it (the m.mark line above is the wire event)
    return OK;
  }
}
