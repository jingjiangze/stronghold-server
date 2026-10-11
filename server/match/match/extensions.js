// Server-authoritative Worker transport and the damage ledger.
import { PHASE } from '../../../shared/constants.js';
import { createDamageBoard } from '../damageBoard.js';
import { emptyDamageRows } from '../../sim/damageBoard.js';
import { buildBattleSpec } from '../../sim/spec.js';
import { RemoteBattle } from '../combat/runner.js';

const DAMAGE_PUBLIC_MS = 1000;

export class MatchExtensions {
  poolFor(player) {
    const id = typeof player === 'string' ? player : player?.playerId;
    if (this.capacityExperiment && !this.players.has(id)) throw new TypeError('player card pool required');
    if (!this.playerPools) return this.pool;
    const pool = this.playerPools.get(id);
    if (!pool) throw new TypeError('player card pool required');
    return pool;
  }

  sendEncoded(playerId, type, data) {
    if (this.disposed || !['m.field', 'b.snap', 'b.ev', 'b.damage', 'm.damage'].includes(type) || typeof data !== 'string') return false;
    const ps = this.players.get(playerId) || this.spectators.get(playerId);
    if (!ps || ps.isBot || ps.left) return false;
    try {
      if (typeof this.opts.sendEncoded === 'function') return !!this.opts.sendEncoded(playerId, type, data);
      return this.sendTo(playerId, JSON.parse(data)); // capture-only fixtures / embedding without an encoded transport
    } catch (e) { this.reportError('send encoded', e); return false; }
  }

  _beginDamage(phase) {
    this.cancel(this._damageTimer);
    this._damageTimer = null;
    // A forced phase replacement may reuse the same round/field ids; only its new field objects may write scores.
    if (phase !== 'unite' && this.damageBoard.round === this.round && this.damageBoard.phase === phase) {
      const previous = this.damageBoard.freeze();
      this.damageBoard = createDamageBoard(this.battlePrefix);
      this.damageBoard.previousRound = previous;
    }
    this.damageBoard.startCombat(this.round, phase, this.order);
    this._damageSampleAt = -Infinity;
    this._damageSent.clear();
    this._damageDirty = true;
    if (!this.clientCombat) for (const f of this.fields) {
      this._onDamageRows(f, emptyDamageRows(f.spec || f.battle?.opts || { players: f.players.map((playerId) => ({ playerId })) }));
    }
    this._sampleDamage(true);
  }

  _onDamageRows(f, rows, { final = null } = {}) {
    if (this.clientCombat || this.disposed || this.ended || !this.fields.includes(f)
      || f.kind !== this.damageBoard.phase || this.round !== this.damageBoard.round) return false;
    if (this.damageBoard.replaceField({ matchId: this.battlePrefix, round: this.round, phase: f.kind,
      kind: f.kind, fieldId: f.fieldId, gt: f.remote ? f.battle._damageGt ?? f.battle.time : f.battle.time || 0,
      owners: rows?.owners, final: final ?? (!f.live || !!f.battle.finished) })) this._damageDirty = true;
    return false; // Match sends the complete permitted round ledger, not per-field raw-score broadcasts.
  }

  _sampleDamage(force = false, final = false) {
    if (this.clientCombat || this.damageBoard.status !== 'live') return;
    const now = this.sched.now();
    if (!force && (this.paused || now - this._damageSampleAt < DAMAGE_PUBLIC_MS)) return;
    this._damageSampleAt = now;
    for (const f of this.fields) {
      if (!force && f.remote) continue;
      if (typeof f.battle?.damageRows !== 'function') continue;
      try { this._onDamageRows(f, f.battle.damageRows(), { final: final ? true : null }); }
      catch (e) { this.reportError('damage rows', e); }
    }
  }

  _damagePacket() {
    const packet = this.damageBoard.packet();
    // Browser-authoritative results are not a trusted operator meter. Preserve their existing combat authority.
    return packet && this.clientCombat ? { ...packet, owners: [], available: false } : packet;
  }

  _damageView(ps, packet) {
    // Same restriction as watch(): fighting boss players may never see the other group's operator statistics.
    // A frozen score remains restricted while boss fields are displayed; no-field PREP follows prep scouting rules.
    if (ps.alive && (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE)) {
      const own = this.fields.find((f) => f.players.includes(ps.playerId));
      if (own) return { ...packet, owners: packet.owners.filter((row) => own.players.includes(row.playerId)) };
    }
    return packet;
  }

  _sendDamageTo(playerId) {
    const ps = this.players.get(playerId) || this.spectators.get(playerId);
    const packet = this._damagePacket();
    if (!ps?.connected || ps.left || !packet) return;
    const wire = JSON.stringify(this._damageView(ps, packet));
    if (this.sendEncoded(playerId, 'm.damage', wire)) this._damageSent.set(playerId, wire);
  }

  _flushDamage(force = false) {
    if (this.disposed || (!force && !this._damageDirty)) return;
    const now = this.sched.now();
    if (!force && now - this._damageAt < DAMAGE_PUBLIC_MS) {
      if (!this._damageTimer) this._damageTimer = this.later(Math.max(1, DAMAGE_PUBLIC_MS - (now - this._damageAt)), () => {
        this._damageTimer = null;
        this._flushDamage();
      });
      return;
    }
    this.cancel(this._damageTimer);
    this._damageTimer = null;
    this._damageDirty = false;
    this._damageAt = now;
    const packet = this._damagePacket();
    if (!packet) return;
    const wires = new Map();
    for (const ps of this._viewers()) {
      if (!ps.connected) continue;
      const own = ps.alive && (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE) ? this.fieldOf(ps) : null;
      const key = own || 'all';
      let wire = wires.get(key);
      if (!wire) { wire = JSON.stringify(this._damageView(ps, packet)); wires.set(key, wire); }
      if (!force && this._damageSent.get(ps.playerId) === wire) continue;
      if (this.sendEncoded(ps.playerId, 'm.damage', wire)) this._damageSent.set(ps.playerId, wire);
    }
  }

  _freezeDamage(send = true) {
    this._sampleDamage(true, true);
    if (this.damageBoard.freeze()) this._damageDirty = true;
    this.cancel(this._damageTimer);
    this._damageTimer = null;
    if (send) this._flushDamage(true);
  }

  _cancelBotPrep(ps) {
    ps._botPrepToken = (ps._botPrepToken || 0) + 1;
    ps._botPrepWork?.cancel();
  }

  _remoteField(opts, players) {
    const spec = buildBattleSpec({ ...opts, content: this.battleContent,
      boss: this.bossPool ? { poolHp: this.bossPool.hp, poolMax: this.bossPool.maxHp } : null });
    return { remote: true, fieldId: spec.fieldId, kind: spec.kind, players, spec, battle: new RemoteBattle(spec), live: true };
  }

}
