// server/match/match/meltdown.js — 海克斯熔毁协议 (this fork): the endless-mode shop that opens after a 隐秘 Boss.
//
// 流程：无尽模式下 `_finalDone(hidden=true)` 不再直接结束对局，而是 `meltdownOpen(cb)` 开商店；
// 每个存活玩家拿到 4 个栏位（① 主盟约专属 6 阶装备、② 炫彩、③ 黄金、④ 白银海克斯），各自限购 1 件、
// 可以一件都不买直接关闭；所有真人关闭后执行 cb（`startRound(round + 1)`）。
//
// 代价（本局永久累计，写进 `this.meltDebt`）：
//   · 装备：`allStats` 敌方全属性 +10%（本局剩余回合）
//   · 海克斯：每波从 dmg(受伤减免) / round(每回合全属性) / deploy(部署回复) 里随机一种，数值按品阶：
//       炫彩 10 / 3 / 10，黄金 7 / 2 / 7，白银 4 / 1 / 4
//   · `dmg` 折算成敌人的等效生命（1/(1-r)）挂在 hpMul 上；`round` 每回合往 `growth` 里加一次；
//     `allStats` 直接进 `meltMul()`。三者在 `_sanitizeSpawns` 里与 endlessMul 相乘 —— 那个函数是敌人属性的咽喉。
//
// 海克斯卡池：只取 `category === 'combat'`，并剔除 `tianxuan_*` / `bx_*`（羁绊专属）、名称含「增援 / 凭证 / 天选」。
// 每个品阶的池在本局内逐波消耗，抽空后该栏 `exhausted: true`（客户端画「海克斯等阶达到极限」）。

import { createRng, deriveSeed } from '../../sim/rng.js';
import { PHASE, ERR } from '../../../shared/constants.js';
import { HEXES, hexById } from '../../../shared/hexes.js';
import { OK, fail } from './common.js';
import { freeSlot } from '../board.js';

/** 三种代价 × 三档数值：品阶 → 数值 */
const COST_VALUE = {
  prismatic: { dmg: 10, round: 3, deploy: 10 },
  gold: { dmg: 7, round: 2, deploy: 7 },
  silver: { dmg: 4, round: 1, deploy: 4 },
};
const HEX_GRADES = ['prismatic', 'gold', 'silver'];
const COST_KEYS = ['dmg', 'round', 'deploy'];
const GEAR_PENALTY = 10;

/** 0..n-1 洗牌（用调用方给的 rng，保证可复现） */
function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class MatchMeltdown {
  /** 惰性建状态（老对局 / 非无尽对局永远不会碰它）。 */
  _melt() {
    if (!this.melt) {
      this.melt = {
        open: false,
        cb: null,
        wave: 0,
        pool: this._meltItemPool(),
        debt: { dmg: 0, round: 0, deploy: 0, allStats: 0 },
        growth: 0,        // 「每回合全属性」的累计（每次 startRound 加一次 debt.round）
        offers: new Map(),
        closed: new Set(),
      };
    }
    return this.melt;
  }

  /**
   * 本局的卡池：只留战斗类，剔掉经济 / 增援 / 羁绊专属，并**按对局模式过滤 `requires.mode`** ——
   * 单人局绝不出现联机专属（协防协议 / 我来兜底 系列），联机局也不出现仅单人可用的条目。
   */
  /**
   * 本局的**装备**卡池（业主 2026-10-26：商店不卖海克斯，改卖装备）：按 tier 分三档
   *   prismatic = tier 6 / gold = tier 4-5 / silver = tier 2-3
   * 剔除：盟约专属（requiresBondId，需对应盟约才合理）、商店隐藏/排除、金色变体。
   */
  _meltItemPool() {
    const pool = { prismatic: [], gold: [], silver: [] };
    const items = (this.gd && this.gd.raw && this.gd.raw.items) || {};
    const gradeOf = (tier) => (tier >= 6 ? "prismatic" : tier >= 4 ? "gold" : tier >= 2 ? "silver" : null);
    for (const [id, rec] of Object.entries(items)) {
      if (!rec) continue;
      if (rec.requiresBondId) continue;
      if (rec.hideInShop || rec.shopExcluded) continue;
      if (rec.isGolden) continue;
      const grade = gradeOf(Number(rec.tier) || 0);
      if (!grade) continue;
      pool[grade].push(id);
    }
    return pool;
  }
  /** 玩家已激活的主盟约里层数最高的一个（只认 isCore）。 */
  _meltMainBond(ps) {
    let best = null;
    const bonds = ps && ps.bonds ? ps.bonds : {};
    for (const [id, st] of Object.entries(bonds)) {
      if (!st || !st.active) continue;
      const rec = this.gd.raw && this.gd.raw.bonds ? this.gd.raw.bonds[id] : null;
      if (!rec || !rec.isCore) continue;
      const layers = Number(st.layers ?? st.stacks ?? st.count ?? 0) || 0;
      if (!best || layers > best.layers) best = { id, layers, rec };
    }
    return best;
  }

  /** 该盟约的专属 6 阶装备（items.json 里 requiresBondId === bondId 且 tier 6）。 */
  _meltBondGear(bondId) {
    const items = this.gd.raw && this.gd.raw.items ? this.gd.raw.items : {};
    for (const rec of Object.values(items)) {
      if (rec && rec.tier === 6 && rec.requiresBondId === bondId) return rec;
    }
    return null;
  }

  /** 开商店：给每个存活玩家发 4 张卡，等他们买完 / 关闭。 */
  /**
   * 开商店：给每个存活玩家发 4 张卡，等他们买完 / 关闭。
   * `opts.resume = true`：由玩家按钮主动打开 —— 关店时**恢复进入前的阶段/截止时间**，而不是推进回合。
   */
  meltdownOpen(cb, opts = {}) {
    const st = this._melt();
    if (!st.open && opts && opts.resume) {
      st.resumePhase = this.phase;
      st.resumeDeadline = this.deadline;
    }
    st.open = true;
    st.cb = typeof cb === 'function' ? cb : null;
    st.wave += 1;
    st.closed.clear();
    st.offers.clear();

    const rng = createRng(deriveSeed(this.seed, `melt:${this.round}:${st.wave}`));
    for (const ps of this.alivePlayers()) {
      st.offers.set(ps.playerId, this._meltDeal(ps, rng));
      ps.dirty();
      this.markPrivate(ps);
    }
    // 停在「结算」：玩家既不能准备也不能出门，只有商店上的两个动作有效。
    this.phase = PHASE.SETTLE;
    this.deadline = 0;
    this.markPublic();
    this.tickerText('海克斯熔毁协议 · 四栏各限购一件', 60);
  }

  _meltDeal(ps, rng) {
    const st = this._melt();
    const cards = [];

    // ① 主盟约专属装备
    const main = this._meltMainBond(ps);
    const gear = main ? this._meltBondGear(main.id) : null;
    cards.push(gear ? {
      kind: 'gear',
      slot: 0,
      itemId: gear.id,
      name: gear.name,
      desc: String(gear.desc || gear.descRaw || '').replace(/\n/g, ' '),
      iconId: gear.iconId || gear.trapId || '',
      tier: 6,
      owner: main ? `${main.rec.name} · ${main.layers} 层` : '',
      cost: { type: 'allStats', value: GEAR_PENALTY },
      sold: false,
    } : { kind: 'gear', slot: 0, exhausted: true, name: '', desc: '', cost: null });

    // ②③④ 装备：每品阶从本局池里抽 1 件，抽空即「达到极限」
    const types = shuffled(COST_KEYS, rng);
    HEX_GRADES.forEach((grade, i) => {
      const pool = st.pool[grade];
      if (!pool || !pool.length) {
        cards.push({ kind: 'item', slot: i + 1, grade, exhausted: true, cost: null });
        return;
      }
      const idx = Math.floor(rng() * pool.length);
      const itemId = pool.splice(idx, 1)[0];
      const rec = this.gd.item(itemId) || {};
      const type = types[i % types.length];
      cards.push({
        kind: 'item',
        slot: i + 1,
        grade,
        itemId,
        name: rec.name || itemId,
        desc: String(rec.desc || rec.descRaw || '').replace(/\n/g, ' '),
        iconId: rec.iconId || rec.trapId || '',
        tier: Number(rec.tier) || 0,
        cost: { type, value: COST_VALUE[grade][type] },
        sold: false,
      });
    });
    return { cards, sold: cards.map(() => false) };
  }

  /** g.meltOpen：玩家主动开商店（协同共竞；同一时间只开一次，幂等）。 */
  meltdownRequest(ps) {
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (!String(this.modeId || '').startsWith('mode_xie_')) return fail(ERR.WRONG_PHASE, 'only 协同共竞 has the shop'); // i18n-ignore
    if (![PHASE.PREP, PHASE.ROUND_START, PHASE.SETTLE].includes(this.phase)) return fail(ERR.WRONG_PHASE, 'the shop opens in prep / settle'); // i18n-ignore
    const st = this._melt();
    if (st.open) return OK;
    this.meltdownOpen(null, { resume: true });
    return OK;
  }

  /** g.meltPick { slot }：买下某一栏（每栏 1 件，买过即售罄）。 */
  meltPick(ps, slot) {
    const st = this.melt;
    if (!st || !st.open) return fail(ERR.WRONG_PHASE, '商店没有开启'); // i18n-ignore: developer error detail
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const offer = st.offers.get(ps.playerId);
    if (!offer) return fail(ERR.BAD_TARGET, '没有你的栏位'); // i18n-ignore: developer error detail
    if (!Number.isInteger(slot) || slot < 0 || slot >= offer.cards.length) return fail(ERR.BAD_TARGET);
    const card = offer.cards[slot];
    if (!card || card.exhausted) return fail(ERR.BAD_TARGET, '这一栏已经到了极限'); // i18n-ignore
    if (offer.sold[slot]) return fail(ERR.ALREADY, '该栏已售罄'); // i18n-ignore: developer error detail

    offer.sold[slot] = true;
    card.sold = true;

    if ((card.kind === 'gear' || card.kind === 'item') && card.itemId) {
      // 手牌满就不成交（卡片保持未售，避免「付了代价却拿不到东西」）
      if (typeof freeSlot === 'function' && freeSlot(ps.hand) < 0) { offer.sold[slot] = false; card.sold = false; return fail(ERR.HAND_FULL); }
      try { ps.acquireItem(card.itemId, { source: 'melt' }); }
      catch (e) { this.reportError('melt item', e); }
    }
    if (card.cost) {
      const key = card.cost.type;
      st.debt[key] = (Number(st.debt[key]) || 0) + card.cost.value;
    }

    ps.recompute();
    ps.dirty();
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /** g.meltClose：不买 / 买完离开。所有人都关掉之后才继续下一关。 */
  meltClose(ps) {
    const st = this.melt;
    if (!st || !st.open) return fail(ERR.WRONG_PHASE, '商店没有开启'); // i18n-ignore
    if (!st.offers.has(ps.playerId)) return fail(ERR.BAD_TARGET);
    st.closed.add(ps.playerId);
    this.markPrivate(ps);
    this.markPublic();
    const humans = this.alivePlayers().filter((p) => !p.isBot);
    if (humans.every((p) => st.closed.has(p.playerId))) this._meltFinish();
    return OK;
  }

  _meltFinish() {
    const st = this.melt;
    if (!st || !st.open) return;
    st.open = false;
    const cb = st.cb;
    st.cb = null;
    // 玩家按钮打开的商店：关店后回到进入前的阶段（不推进回合）
    if (!cb && st.resumePhase) {
      this.phase = st.resumePhase;
      this.deadline = st.resumeDeadline || 0;
      st.resumePhase = null;
      st.resumeDeadline = null;
    }
    for (const ps of this.players.values()) {
      ps.dirty();
      this.markPrivate(ps);
    }
    this.markPublic();
    if (typeof cb === 'function') cb();
  }

  /** 超时兜底：所有人自动关店（防挂机卡住整局）。 */
  meltTimeout() {
    const st = this.melt;
    if (!st || !st.open) return;
    this._meltFinish();
  }

  /** 代价倍率（与 endlessMul 相乘）。 */
  meltMul() {
    const st = this.melt;
    if (!st) return 1;
    const extra = (Number(st.debt.allStats) || 0) + (Number(st.growth) || 0);
    return extra > 0 ? 1 + extra / 100 : 1;
  }

  /** `dmg` 折算成等效生命倍率（10% 减伤 ≈ ×1.111 血量）。 */
  meltHpMul() {
    const st = this.melt;
    if (!st) return 1;
    const r = Math.max(0, Math.min(0.8, (Number(st.debt.dmg) || 0) / 100));
    return r > 0 ? 1 / (1 - r) : 1;
  }

  /** m.private.meltdown：只发给本人。 */
  meltdownView(ps) {
    const st = this.melt;
    if (!st || !st.open) return null;
    const offer = st.offers.get(ps.playerId);
    if (!offer) return null;
    return {
      wave: st.wave,
      cards: offer.cards.map((c, i) => ({ ...c, sold: !!offer.sold[i] })),
      sold: offer.sold.slice(),
      debt: { ...st.debt },
      growth: st.growth,
      closed: st.closed.has(ps.playerId),
      pool: { prismatic: st.pool.prismatic.length, gold: st.pool.gold.length, silver: st.pool.silver.length },
    };
  }
}
