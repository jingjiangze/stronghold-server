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
// 商店设施三项效果（业主 2026-10-30）：商店等级 / 协同资金获取 / 装备造价
import { shopLevelOf, equipPriceOf } from './projectEffects.js';
import { isShopItem } from '../../sim/simdata.js';

/** 三种代价 × 三档数值：品阶 → 数值 */
const COST_VALUE = {
  prismatic: { dmg: 10, round: 3, deploy: 10 },
  gold: { dmg: 7, round: 2, deploy: 7 },
  silver: { dmg: 4, round: 1, deploy: 4 },
};
const HEX_GRADES = ['prismatic', 'gold', 'silver'];
const COST_KEYS = ['dmg', 'round', 'deploy'];
const GEAR_PENALTY = 10;

/** 个人资金价目（业主 2026-10-26：熔毁商店也可以直接花个人资金买，不叠 debuff）。按档定价，数值可调。 */
const FUNDS_PRICE = { prismatic: 8, gold: 5, silver: 3, gear: 6 };

/**
 * 一张熔毁卡的个人资金价（0 = 不能拿钱买）。
 * 装备栏固定 gear 档；其余按 card.grade（prismatic / gold / silver）。
 * @param {any} card
 * @returns {number}
 */
/** 一件装备的资金价：跟装备自己的 items.json.price 走（×2 换到储备单位，夹 2..12）。
 *  商店设施「装备造价」每级再 −1（下限 2，业主 2026-10-30 的平衡口径）。 */
function meltItemPrice(rec, equipLevel = 0) {
  return equipPriceOf(Math.max(2, Math.min(12, Math.round((Number(rec && rec.price) || 2) * 2))), equipLevel);
}

function meltFundsPrice(card) {
  if (!card || card.exhausted) return 0;
  if (card.kind === 'gear') return FUNDS_PRICE.gear;
  // 业主 2026-10-27：商店卖的是「游戏内装备」，价格就跟装备自己的 `items.json.price` 走（×2 换算成储备单位），
  // 不再只按品阶定死。品阶价只作为兜底（老局 / 卡片缺 price 时）。
  if (Number.isFinite(card.price) && card.price > 0) return card.price;
  return FUNDS_PRICE[card.grade] || 0;
}

/**
 * 扣款（业主 2026-10-30「其他人买装备等优先消耗团队储备」）：**先扣团队储备，不够再扣本回合资金**。
 * 个人储备这一层已下线（economy.js 的 econSplitLeftover 不再往它写），所以这里完全不读它。
 * 余额不足返回 false（调用方已先判过，这里只兜底，并回滚已扣的团队池）。
 */
function es_safe_spend(ps, price) {
  const m = ps && ps.match;
  let left = Math.max(0, Math.floor(Number(price) || 0));
  if (!left) return true;
  const team = m ? Math.max(0, Math.floor(Number(m.teamReserve) || 0)) : 0;
  const fromTeam = Math.min(team, left);
  if (fromTeam > 0) { m.teamReserve = team - fromTeam; left -= fromTeam; }
  if (left <= 0) return true;
  const funds = Math.max(0, Math.floor(Number(ps.funds) || 0));
  if (funds < left) { if (fromTeam > 0) m.teamReserve = team; return false; }
  ps.funds = funds - left;
  return true;
}

/** 这一页能拿钱买装备的余额 = 团队储备 + 本回合资金。 */
function es_spendable(ps) {
  const m = ps && ps.match;
  return Math.max(0, Math.floor(Number(m && m.teamReserve) || 0)) + Math.max(0, Math.floor(Number(ps && ps.funds) || 0));
}

/** 0..n-1 洗牌（用调用方给的 rng，保证可复现） */
function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 这条藏品的效果在本局**是否真的生效**（业主 2026-11-01「完成完整肉鸽」的透明化）：
 * 目前只有 `enemy` / `enemyRank`（敌人乘区）与 `immediate` / `deployCap` / `lpCap`（入手即结算）接了实现；
 * `rule.*`（57 条，官方 DSL，需逐条语义）、`ally*`、`price`、`income`、`hand`、`enemyMove` 等**尚未接入**。
 * 返回 false 的藏品仍会进背包、仍显示在 HUD，但会标注「未实装」，避免玩家以为它已经生效。
 */
export const RELIC_APPLIED_KEYS = Object.freeze(['enemy', 'enemyRank', 'immediate', 'deployCap', 'lpCap']);
/** 已接进引擎的 rule id（语义逐条照 relics.json 的官方 desc，不要按字段名猜）。 */
export const RELIC_APPLIED_RULES = Object.freeze([
  'ussuri',        // 敌方 +35%，每回合 +10%，最低 35%（relicEnemyMul）
  'leaderHalve',   // 敌方 +35%，领袖额外 +20%/+50%，≥4 盟约减半（relicEnemyMul + activeBondsOf）
  'enemyDmgTaken', // 敌人受伤 −20% ⇒ 等效生命 +25%（hp 等价近似）
  'enemyCount',    // 敌人数量 +50%（combat.js 的 spawn count，mul 是增量）
  'fundsDrain',    // 每回合失去 1 资金，最多 5（applyRelicRoundEconomy）
  'kingCrystal',   // 休整期资金 +5（另两项 LP/价格待接，见清单）
  'loseAllFunds',  // 入手清空资金（悬赏减半待赏金钩子）
  'postBattleFunds', // 每场战斗 +1 资金（applyRelicPostBattle；悬赏 +50% 待钩子）
  'choiceFunds',   // 每次选择 +8（applyRelicChoiceFunds；入手 +3 走 immediate）
  'enemyRamp',     // 战斗开始那一档 +step（战斗内每 10 秒递增缺通道，未接）
  'atkPerBond',    // 己方攻击：每激活盟约 +10%（relicAllyMul → sim 的 relicMods 通道）
  'atkPerRound',   // 己方攻击：每过一回合 +15%，最多 10 次（同上）
  'atkPerEquip',   // 棋盘每件装备：攻击 +10% / 生命 +20%（relicAllyMul）
  'atkPerBenchItem', // 待部署区每件装备：攻击 +10%（上限 +150%）
  'homeCooked',    // 生命/攻击 +20%，每场完美作战再 +10%（ps.relicPerfectBattles）
  'atkPerSpend',   // 每花 5 资金：全队攻击 +5%（ps.totalSpent）
  'hpdefPerSpend', // 每花 3 资金：全队生命/防御 +3%
  'aspdPerSpend',  // 每花 3 资金：全队攻速 +7（加法）
  'atkPerNeighbor', // 周围 4 格每有一名干员：攻击 +20%（per-unit，见 battleInput）
  'aspdPerNeighbor', // 周围 4 格每有一名干员：攻速 +30（per-unit）
  'bountyMul',     // 悬赏资金翻倍（relicBountyMul）
  'lpDrainRest',   // 进入休整期 LP −1，最低 1（applyRelicLpDrain；低血时 SP 回复 −20% 那半句未接）
  'bountyKillDeploy', // 初始部署 −3 已由 effect.deployCap 生效（别再扣一次）；「每击杀赏金目标 +1」待击杀计数
]);
export function relicEffectApplied(effect) {
  if (!effect || typeof effect !== 'object') return false;
  if (RELIC_APPLIED_KEYS.some((k) => Object.hasOwn(effect, k))) return true;
  const ru = effect.rule;
  return !!(ru && typeof ru.id === 'string' && RELIC_APPLIED_RULES.includes(ru.id));
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
      source: String(gear.category || ''),
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
        // 出处（业主 2026-10-27：商店要备注装备出处）——取 items.json 的 category：STAT/ECONOMY/BOND/RECRUIT/ON_HIT/...
        source: String(rec.category || ''),
        // 价格取装备自己的 price（×2 换到储备单位，夹在 2..12）：1~3 块的装备 → 2~6，6 阶 4 块 → 8
        price: Math.max(2, Math.min(12, Math.round((Number(rec.price) || 2) * 2))),
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

  /**
   * g.meltPick { slot, pay? }：买下某一栏（每栏 1 件，买过即售罄）。
   * `pay='funds'` 用个人资金付（不叠 debuff）；缺省/'debuff' 走原来的敌人属性代价。
   */
  meltPick(ps, slot, pay = null) {
    const st = this.melt;
    if (!st || !st.open) return fail(ERR.WRONG_PHASE, '商店没有开启'); // i18n-ignore: developer error detail
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const offer = st.offers.get(ps.playerId);
    if (!offer) return fail(ERR.BAD_TARGET, '没有你的栏位'); // i18n-ignore: developer error detail
    if (!Number.isInteger(slot) || slot < 0 || slot >= offer.cards.length) return fail(ERR.BAD_TARGET);
    const card = offer.cards[slot];
    if (!card || card.exhausted) return fail(ERR.BAD_TARGET, '这一栏已经到了极限'); // i18n-ignore
    if (offer.sold[slot]) return fail(ERR.ALREADY, '该栏已售罄'); // i18n-ignore: developer error detail

    // 复审计 2026-10-27：先判支付能力并扣款，**再**发装备。
    // 旧顺序（先 acquireItem 再判余额）在余额不足时会把装备塞进手牌、只回滚售罄标记 ⇒ 可白嫖。
    const price0 = meltFundsPrice(card);
    if (pay === 'funds') {
      if (!(price0 > 0) || !(es_spendable(ps) >= price0)) return fail(ERR.NO_FUNDS);
      if (!es_safe_spend(ps, price0)) return fail(ERR.NO_FUNDS);
    }
    offer.sold[slot] = true;
    card.sold = true;

    if ((card.kind === 'gear' || card.kind === 'item') && card.itemId) {
      // 手牌满就不成交（卡片保持未售，避免「付了代价却拿不到东西」）
      if (typeof freeSlot === 'function' && freeSlot(ps.hand) < 0) { offer.sold[slot] = false; card.sold = false; return fail(ERR.HAND_FULL); }
      try { ps.acquireItem(card.itemId, { source: 'melt' }); }
      catch (e) { this.reportError('melt item', e); }
    }
    if (card.cost && pay !== 'funds') {
      const key = card.cost.type;
      st.debt[key] = (Number(st.debt[key]) || 0) + card.cost.value;
    }

    ps.recompute();
    ps.dirty();
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /** 商店等级（采购等阶上限）：R1-2 → 1，R3-4 → 2 …… 封顶 6（业主 2026-10-27：目录式商店） */
  meltShopLevel() {
    const base = Math.min(6, Math.max(1, Math.ceil((Number(this.round) || 1) / 2)));
    // 商店设施「商店等级」每级 +1（业主 2026-10-30「升级是提示商店等级」）；硬顶在 projectEffects 里夹住
    return shopLevelOf(base, this.teamProjects && this.teamProjects.shopLevel);
  }

  /**
   * 目录式道具商店（业主 2026-10-27）：把本局可售装备按品阶分组下发，每件带价格 / 出处 / 可买状态。
   * 盟约专属（requiresBondId）不进目录——它们仍走「主盟约专属」那栏。
   */
  meltCatalog(ps) {
    const level = this.meltShopLevel();
    const have = Math.max(0, Math.floor(Number(es_spendable(ps)) || 0));
    const groups = [];
    const byTier = (this.gd && this.gd.shopItemsByTier) || {};
    for (let t = 1; t <= 6; t++) {
      // byTier[t] 是**装备 id 字符串**数组（gamedata.js 的 shopItemsByTier），先还原成记录再判
      const rows = (byTier[t] || [])
        .map((id) => (typeof this.gd.item === 'function' ? this.gd.item(id) : (typeof id === 'object' ? id : null)))
        .filter((it) => it && !it.requiresBondId && isShopItem(it))
        .map((it) => {
          const price = meltItemPrice(it, this.teamProjects && this.teamProjects.equipCost);
          return {
            itemId: String(it.id || it.baseId || ''),
            name: String(it.name || it.id || ''),
            desc: String(it.desc || it.descRaw || '').replace(/\n/g, ' '),
            iconId: String(it.iconId || it.trapId || ''),
            tier: t,
            source: String(it.category || ''),
            price,
            unlocked: t <= level,
            affordable: have >= price,
          };
        })
        .sort((a, b) => (a.price - b.price) || a.name.localeCompare(b.name));
      if (rows.length) groups.push({ tier: t, rows });
    }
    return { level, funds: have, groups, relics: this.meltRelicRows(level, have) };
  }

  /**
   * 藏品（业主 2026-10-27）：数据来自插件的 `data/relics.json`（`{ relics: [...] }`）。
   * **当前该文件为空数组**，所以客户端不会出现「藏品」页签；把真实数据放进去即自动出现，代码不用改。
   * 条目字段：`id / name / desc / tier / set（出处）/ cost（个人储备价，缺省按 tier）`。
   */
  meltRelicRows(level, have) {
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const list = raw && Array.isArray(raw.relics) ? raw.relics : [];
    return list
      .filter((r) => r && typeof r.id === 'string' && r.id)
      .map((r) => {
        const tier = Math.max(1, Math.min(6, Number(r.tierNum) || (r.tier === 'red' ? 4 : 2)));
        const price = Math.max(2, Math.min(12, Math.round(Number(r.price) || (tier >= 4 ? 8 : 4))));
        return {
          kind: String(r.kind || ''),
          icon: String(r.icon || `/assets/relics/${r.id}.png`),
          relicId: r.id,
          name: String(r.name || r.id),
          desc: String(r.desc || '').replace(/\n/g, ' '),
          iconId: String(r.iconId || r.icon || ''),
          tier,
          source: String(r.set || r.source || ''),
          price,
          unlocked: tier <= level,
          affordable: have >= price,
        };
      });
  }

  /**
   * 藏品效果聚合（业主 2026-10-27）：把已拥有藏品的声明式效果汇总给战斗层。
   * 现状（只接引擎已有通道）：`enemy/enemyRank(BOSS/ELITE).{hp,atk}` → 敌人 hpMul/atkMul；
   * `deployCap` → ps.deployCapBonus；`lpCap` / `immediate.{funds,lp,items}` 在获得时立即结算。
   * 其余（ally / price / rule.*——57 条走 rule DSL）本局暂不生效，见交付说明。
   */
  /**
   * 收集「持有某条 rule 类藏品」的参数（同一件藏品只算一次）。语义一律以 `relics.json` 的**官方 desc** 为准，
   * 不要按字段名猜方向 —— 例如 `enemyCount.mul = 0.5` 的 desc 是「敌人数量 **+50%**」（是增量不是倍率）。
   * @param {string} ruleId @returns {object[]} 每件持有藏品的 rule 参数对象
   */
  relicRuleParams(ruleId) {
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const defs = raw && Array.isArray(raw.relics) ? raw.relics : [];
    if (!defs.length) return [];
    const byId = new Map(defs.map((r) => [r.id, r]));
    const out = [];
    const seen = new Set();
    const players = this.players && typeof this.players.values === 'function' ? this.players.values() : [];
    for (const ps of players) {
      for (const id of (ps && Array.isArray(ps.relics) ? ps.relics : [])) {
        if (seen.has(id)) continue;
        const ru = (byId.get(id) || {}).effect && byId.get(id).effect.rule;
        if (ru && ru.id === ruleId) { seen.add(id); out.push({ ...ru, ownerId: ps.playerId }); }
      }
    }
    return out;
  }

  /** 某玩家的已激活盟约数（`ps.bonds[*].active`）。 */
  activeBondsOf(playerId) {
    const ps = this.players && typeof this.players.get === 'function' ? this.players.get(playerId) : null;
    const bonds = ps && ps.bonds;
    if (!bonds || typeof bonds !== 'object') return 0;
    return Object.values(bonds).filter((b) => b && b.active === true).length;
  }

  relicEnemyMul() {
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const defs = raw && Array.isArray(raw.relics) ? raw.relics : [];
    if (!defs.length) return { hp: 0, atk: 0 };
    const idx = new Map(defs.map((r) => [r.id, r]));
    const acc = { hp: 0, atk: 0, speed: 0 };
    const add = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Number.isFinite(o.hp)) acc.hp += o.hp;
      if (Number.isFinite(o.atk)) acc.atk += o.atk;
    };
    const players = this.players && typeof this.players.values === 'function' ? this.players.values() : [];
    for (const ps of players) {
      for (const id of (ps && Array.isArray(ps.relics) ? ps.relics : [])) {
        const def = idx.get(id);
        const e = def && def.effect;
        if (!e) continue;
        add(e.enemy);
        if (e.enemyRank) { add(e.enemyRank.BOSS); add(e.enemyRank.ELITE); }
      }
    }
    // 肉鸽：本回合随机词缀 + 事件里累积的敌人修正一起算进来
    if (this.isRogue === true) {
      const aff = typeof this.rogueRoundAffix === 'function' ? this.rogueRoundAffix() : null;
      if (aff && aff.kind === 'hp') acc.hp += aff.mul;
      if (aff && aff.kind === 'atk') acc.atk += aff.mul;
      if (aff && aff.kind === 'speed') acc.speed += aff.mul;
      // 紧急作战：整波强化（与词缀/藏品共用同一幂等标记，不会重复乘）
      if (typeof this.rogueEmergencyRound === 'function' && this.rogueEmergencyRound(this.round)) {
        acc.hp += 0.25;
        acc.atk += 0.2;
      }
      for (const ps of players) {
        const b = ps && ps.rogueAffixBonus;
        if (!b) continue;
        acc.hp += Number(b.hp) || 0;
        acc.atk += Number(b.atk) || 0;
      }
    }
    // ---- rule 类藏品的敌方修正（语义逐条取自 relics.json 的官方 desc）----
    // ussuri：「敌方攻击/防御/生命 +35%，每进入新回合额外 +10%，完成悬赏和完美作战时 −5%（最低 35%）」
    //   完成悬赏/完美作战的递减需要结算侧计数，暂未接入 ⇒ 按 0 次计（只会略高，不会低于 min 夹取）。
    for (const ru of this.relicRuleParams('ussuri')) {
      const step = Number(ru.step) || 0;
      const min = Number(ru.min) || 0.35;
      const v = Math.max(min, 0.35 + step * Math.max(0, (Number(this.round) || 1) - 1));
      acc.hp += v; acc.atk += v;
    }
    // leaderHalve：「敌方 +35%，领袖额外攻击/防御 +20%、生命 +50%；激活 ≥4 盟约时领袖加成减半」
    for (const ru of this.relicRuleParams('leaderHalve')) {
      const need = Number(ru.bonds) || 4;
      const half = this.activeBondsOf(ru.ownerId) >= need ? 0.5 : 1;
      acc.hp += 0.35 + 0.5 * half;
      acc.atk += 0.35 + 0.2 * half;
    }
    // enemyRamp（谒日之祈）：「战斗开始时敌方 攻/生/防/法抗 +10%，每过 10 秒额外 +10%，最多 +50%」
    //   ⇒ 本引擎没有「战斗内按时长递增」的通道，这里只结算**战斗开始那一档**（`step`），并注明未接的部分。
    for (const ru of this.relicRuleParams('enemyRamp')) {
      const step = Number(ru.step) || 0;
      if (step > 0) { acc.hp += step; acc.atk += step; }
    }
    // enemyDmgTaken：「敌人受到的物理/法术伤害降低 20%」⇒ 等效生命 +25%（引擎没有独立受击乘区，用 hp 等价近似）
    for (const ru of this.relicRuleParams('enemyDmgTaken')) {
      const p = Math.max(Number(ru.phys) || 0, Number(ru.arts) || 0);
      if (p > 0 && p < 1) acc.hp += 1 / (1 - p) - 1;
    }
    return acc;
  }

  /** 获得藏品时结算「一次性」效果（资金 / 生命 / 装备 / 部署上限 / 生命上限）。 */
  /**
   * rule 藏品的**回合级经济**（每回合开始调用一次，语义照 relics.json 的官方 desc）：
   * - `fundsDrain`（巫王旋角）：「每进入一个新回合后，失去 1 点初始资金（最多失去 5 点）」
   * - `kingCrystal`（国王水晶）：休整期资金 +5
   * 计数挂在 `ps.relicRuleState` 上，跨回合累积（不随回合清零）。
   */
  /**
   * rule 藏品：**每场战斗结束**的资金奖励（`postBattleFunds`，至宝指环）
   * desc：「战斗结束（包括联防）额外获得 1 点资金，且悬赏获得的资金 +50%」——
   * 后半句 `effect.postBountyMul` 需要赏金发放点的倍率钩子（尚未接入），这里只接前半句。
   */
  /**
   * rule 藏品的**己方属性**聚合（语义照 relics.json 的官方 desc），返回给 BattleSpec 每个 unit 的 `relicMods`。
   * 引擎侧通道：`server/sim/battle/players.js` 的 `_makeAlly` 会把 `atkMul/hpMul/defMul/aspdMul/aspdAdd` 乘/加到单位基础属性上。
   * 当前接入：
   * - `atkPerBond`「每有一个激活的盟约，所有干员攻击力 +10%」→ 按该玩家激活盟约数累加
   * - `atkPerRound`「回合结束后所有干员攻击力 +15%（最多 10 次）」→ 按已过回合数（round-1，封顶 10）累加；
   *   完成悬赏额外 +1 次的规则未接（无悬赏完成计数）
   * 其余己方属性类（atkPerNeighbor/atkPerEquip/atkPerBenchItem/homeCooked/atkPerSpend/hpIfDp…）见覆盖清单，逐个待接。
   */
  /** 相邻类藏品的「每相邻一人」参数（`atkPerNeighbor` / `aspdPerNeighbor`）—— 需要 per-unit 计算，见 battleInput。 */
  relicNeighborRules() {
    let atkPer = 0, aspdPer = 0;
    for (const ru of this.relicRuleParams('atkPerNeighbor')) atkPer += Math.max(0, Number(ru.per) || 0);
    for (const ru of this.relicRuleParams('aspdPerNeighbor')) aspdPer += Math.max(0, Number(ru.per) || 0);
    return (atkPer || aspdPer) ? { atkPer, aspdPer } : null;
  }

  relicAllyMul(ps) {
    if (!ps || !Array.isArray(ps.relics) || !ps.relics.length) return null;
    let atk = 0, hp = 0, def = 0, aspdAdd = 0;
    for (const ru of this.relicRuleParams('atkPerBond')) {
      const per = Math.max(0, Number(ru.per) || 0);
      atk += per * this.activeBondsOf(ps.playerId);
    }
    for (const ru of this.relicRuleParams('atkPerRound')) {
      const per = Math.max(0, Number(ru.per) || 0);
      const max = Number.isFinite(Number(ru.max)) ? Number(ru.max) : 10;
      atk += per * Math.min(max, Math.max(0, (Number(this.round) || 1) - 1));
    }
    // 棋盘上已装备的件数（atkPerEquip「每装备一件：攻击 +10%、生命 +20%」）
    const boardItems = (() => {
      const b = ps.board;
      if (!b || typeof b.values !== 'function') return 0;
      let n = 0;
      for (const piece of b.values()) n += Array.isArray(piece && piece.items) ? piece.items.length : 0;
      return n;
    })();
    for (const ru of this.relicRuleParams('atkPerEquip')) {
      atk += Math.max(0, Number(ru.atk) || 0) * boardItems;
      hp += Math.max(0, Number(ru.hp) || 0) * boardItems;
    }
    // 待部署区/手牌里的装备件数（atkPerBenchItem「每有一件：攻击 +10%，最多 +150%」）
    const benchItems = (() => {
      let n = 0;
      for (const area of [ps.temp, ps.hand]) {
        if (!Array.isArray(area)) continue;
        for (const piece of area) if (piece && piece.kind === 'item') n += 1;
      }
      return n;
    })();
    for (const ru of this.relicRuleParams('atkPerBenchItem')) {
      const per = Math.max(0, Number(ru.per) || 0);
      const max = Number.isFinite(Number(ru.max)) ? Number(ru.max) : 1.5;
      atk += Math.min(max, per * benchItems);
    }
    // 消费类（desc 都是「每花费 N 点资金 → +X」）：
    //   atkPerSpend「每花 5 资金，所有干员攻击 +5%」
    //   hpdefPerSpend「每花 3 资金，所有干员最大生命 +3%、防御 +3%」
    //   aspdPerSpend「每消耗 3 点资金 +7 攻速」（攻速是加法不是乘法）
    const spent = Math.max(0, Math.floor(Number(ps.totalSpent) || 0));
    for (const ru of this.relicRuleParams('atkPerSpend')) {
      const each = Math.max(1, Number(ru.each) || 5);
      atk += (Math.floor(spent / each) * Math.max(0, Number(ru.per) || 0));
    }
    for (const ru of this.relicRuleParams('hpdefPerSpend')) {
      const each = Math.max(1, Number(ru.each) || 3);
      const gain = Math.floor(spent / each) * Math.max(0, Number(ru.per) || 0);
      hp += gain; def += gain;
    }
    for (const ru of this.relicRuleParams('aspdPerSpend')) {
      const each = Math.max(1, Number(ru.each) || 3);
      aspdAdd += Math.floor(spent / each) * Math.max(0, Number(ru.per) || 0);
    }
    // homeCooked「生命 +20%、攻击 +20%；每通过一场完美作战额外 +10%」
    const perfect = Math.max(0, Number(ps.relicPerfectBattles) || 0);
    for (const ru of this.relicRuleParams('homeCooked')) {
      const per = Math.max(0, Number(ru.per) || 0);
      hp += 0.2 + per * perfect;
      atk += 0.2 + per * perfect;
    }
    if (!atk && !hp && !def && !aspdAdd) return null;
    return { atkMul: 1 + atk, hpMul: 1 + hp, ...(def ? { defMul: 1 + def } : {}), ...(aspdAdd ? { aspdAdd } : {}) };
  }

  /**
   * rule 藏品的**赏金倍率**（照 desc 连乘）：
   * - `bountyMul`「悬赏中获得的资金奖励翻倍」(`mul`)
   * - `loseAllFunds`「使悬赏获得的资金减半」(`bountyMul`)
   * - `effect.postBountyMul`（至宝指环「悬赏获得的资金 +50%」，非 rule 键）
   */
  relicBountyMul() {
    let mul = 1;
    for (const ru of this.relicRuleParams('bountyMul')) mul *= Math.max(0, Number(ru.mul) || 1);
    for (const ru of this.relicRuleParams('loseAllFunds')) mul *= Math.max(0, Number(ru.bountyMul) || 1);
    const players = this.players && typeof this.players.values === 'function' ? this.players.values() : [];
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const defs = raw && Array.isArray(raw.relics) ? raw.relics : [];
    const byId = new Map(defs.map((r) => [r.id, r]));
    const seen = new Set();
    for (const ps of players) {
      for (const id of (ps && Array.isArray(ps.relics) ? ps.relics : [])) {
        if (seen.has(id)) continue;
        const def = byId.get(id) || {};
        const v = Number((def.effect || {}).postBountyMul);
        if (Number.isFinite(v) && v > 0) { mul *= v; seen.add(id); }
      }
    }
    return mul;
  }

  /**
   * rule 藏品的**干员价格折扣**（`kingCrystal`「购买的干员所消耗的资金 −1」）——返回给商店/刷新处叠加。
   */
  relicChessPriceDelta() {
    let d = 0;
    for (const ru of this.relicRuleParams('kingCrystal')) d += Math.trunc(Number(ru.priceChess) || 0);
    return d;
  }

  /** rule 藏品：`lpDrainRest`（进入休整期目标生命 −1，最低 1）与 `kingCrystal`（战斗结束 −2，最低 1）。 */
  applyRelicLpDrain(phase) {
    if (!this.players || typeof this.players.values !== 'function') return;
    for (const ps of this.players.values()) {
      if (!ps || ps.isBot || !Array.isArray(ps.relics) || !ps.relics.length) continue;
      const hits = phase === 'rest' ? this.relicRuleParams('lpDrainRest') : this.relicRuleParams('kingCrystal');
      for (const ru of hits) {
        const n = Math.abs(Math.trunc(Number(ru.n) || 0));
        const crystal = phase === 'rest' ? 0 : Math.abs(Math.trunc(Number(ru.lp) || 0));
        const take = phase === 'rest' ? n : crystal;
        if (take > 0) { try { ps.lp = Math.max(1, (Number(ps.lp) || 1) - take); ps.dirty && ps.dirty(); } catch { /* noop */ } }
      }
    }
  }

  applyRelicPostBattle() {
    if (!this.players || typeof this.players.values !== 'function') return;
    for (const ps of this.players.values()) {
      if (!ps || !Array.isArray(ps.relics) || !ps.relics.length) continue;
      for (const ru of this.relicRuleParams('postBattleFunds')) {
        const n = Math.max(0, Number(ru.n) || 0);
        if (n > 0) { try { ps.addFunds(n, { reason: 'relic-post-battle' }); } catch { /* noop */ } }
      }
    }
  }

  /**
   * rule 藏品：**做出一次选择**时的资金奖励（`choiceFunds`，笞心魔宝宝）
   * desc：「资金 +3，在选择决策、完成悬赏时资金额外 +8」——入手 +3 由 `effect.immediate` 结算，这里是「每次选择 +8」。
   * 「完成悬赏」那一半需要赏金完成点的钩子（尚未接入）。
   */
  applyRelicChoiceFunds(ps) {
    if (!ps || !Array.isArray(ps.relics) || !ps.relics.length) return;
    for (const ru of this.relicRuleParams('choiceFunds')) {
      const n = Math.max(0, Number(ru.n) || 0);
      if (n > 0) { try { ps.addFunds(n, { reason: 'relic-choice' }); } catch { /* noop */ } }
    }
  }

  applyRelicRoundEconomy() {
    if (!this.players || typeof this.players.values !== 'function') return;
    const players = [...this.players.values()];
    for (const ps of players) {
      if (!ps || !Array.isArray(ps.relics) || !ps.relics.length) continue;
      const st = (ps.relicRuleState ||= {});
      for (const ru of this.relicRuleParams('fundsDrain')) {
        const per = Math.max(0, Number(ru.perRound) || 0);
        const max = Math.max(0, Number(ru.max) || 0);
        const done = Number(st.fundsDrained) || 0;
        const take = Math.min(per, Math.max(0, max - done));
        if (take > 0) { st.fundsDrained = done + take; try { ps.addFunds(-take, { reason: 'relic-funds-drain' }); } catch { /* noop */ } }
      }
      for (const ru of this.relicRuleParams('kingCrystal')) {
        const inc = Math.max(0, Number(ru.income) || 0);
        if (inc > 0) { try { ps.addFunds(inc, { reason: 'relic-king-crystal' }); } catch { /* noop */ } }
      }
    }
  }

  relicGrantInstant(ps, def) {
    const e = (def && def.effect) || {};
    const im = e.immediate && typeof e.immediate === 'object' ? e.immediate : null;
    if (im) {
      if (Number.isFinite(im.funds) && im.funds) ps.addFunds(Math.trunc(im.funds), { reason: 'relic' });
      if (Number.isFinite(im.lp) && im.lp) ps.lp = Math.max(1, (Number(ps.lp) || 0) + Math.trunc(im.lp));
      if (Array.isArray(im.items)) for (const itemId of im.items) { try { ps.acquireItem(itemId, { source: 'relic' }); } catch { /* 池子/数据守卫 */ } }
    }
    if (Number.isFinite(e.deployCap) && e.deployCap) ps.deployCapBonus = (Number(ps.deployCapBonus) || 0) + Math.trunc(e.deployCap);
    // rule：loseAllFunds（追忆仪）「获得时，本次休整期失去所有的资金」（悬赏减半那半边待赏金倍率钩子，见覆盖清单）
    if (e.rule && e.rule.id === 'loseAllFunds') { try { ps.funds = 0; ps.dirty && ps.dirty(); } catch { /* noop */ } }
    if (Number.isFinite(e.lpCap) && e.lpCap) ps.lp = Math.max(1, (Number(ps.lp) || 0) + Math.trunc(e.lpCap));
  }

  // ---------------------------------------------------------------------------------------------
  // 藏品三选一（业主 2026-10-27：藏品不做商店，改成海克斯那样的随机三选一；仅协同、别太频繁）
  // 节奏：协同房 R4 / R8 / R12 各一次，每人 1 份 3 选 1，20 秒不选自动取第一张。
  // ---------------------------------------------------------------------------------------------

  // ---------------------------------------------------------------------------------------------
  // 肉鸽随机元素（业主 2026-10-27，参考明日方舟集成战略）：
  //   ① 不期而遇（随机事件，2 选 1，R3/R6/R9）
  //   ② 每回合随机词缀（敌人 +hp / +atk / +移速 之一，按 seed+回合确定，可复现）
  // ---------------------------------------------------------------------------------------------

  /** 不期而遇事件表（内联，避免再拉一个数据插件；要做成可配再挪 data/）。 */
  rogueEvents() {
    return [
      { id: 'ev_peddler', name: '拾荒者', desc: '一个拾荒者愿意用废料换你的储备。', choices: [
        { id: 'a', label: '给他 2 资金，换 1 件装备', funds: -2, item: 'random' },
        { id: 'b', label: '抢下他的货，敌人更凶（+8% 全属性）', affix: { hp: 0.08, atk: 0.08 } },
      ] },
      { id: 'ev_shrine', name: '残破的神龛', desc: '供奉着什么，靠近时有低语。', choices: [
        { id: 'a', label: '供奉 3 资金，得 2 生命上限', funds: -3, lp: 2 },
        { id: 'b', label: '无视它，白拿 2 资金', funds: 2 },
      ] },
      { id: 'ev_wounded', name: '濒死的干员', desc: '他还有一口气，身上带着部署凭证。', choices: [
        { id: 'a', label: '救他：-3 生命，+1 部署上限', lp: -3, deployCap: 1 },
        { id: 'b', label: '搜他的包：+3 资金', funds: 3 },
      ] },
      { id: 'ev_gamble', name: '赌局', desc: '一个戴兜帽的人摊开牌。', choices: [
        { id: 'a', label: '押上 4 资金，赢了翻倍（五成）', gamble: { stake: 4, win: 8 } },
        { id: 'b', label: '不赌，拿 1 资金走人', funds: 1 },
      ] },
      { id: 'ev_altar', name: '怪异的祭坛', desc: '石面上刻着看不懂的字。', choices: [
        { id: 'a', label: '献上 2 生命，本局敌人 -6% 攻击', lp: -2, affix: { atk: -0.06 } },
        { id: 'b', label: '砸了它：+2 资金，敌人 +6% 生命', funds: 2, affix: { hp: 0.06 } },
      ] },
    ];
  }

  rogueEventRound(r) { return r === 3 || r === 6 || r === 9; }

  /** 发一份不期而遇（每人独立抽一个事件；非阻塞，20s 超时取第一个选项）。 */
  rogueEventOffer() {
    if (this.isRogue !== true) return;
    const table = this.rogueEvents();
    if (!table.length) return;
    const round = Number(this.round) || 1;
    const rng = createRng(deriveSeed(this.seed, `rogue-event:${round}`));
    for (const ps of this.alivePlayers()) {
      if (!ps || (Array.isArray(ps.rogueOffer) && ps.rogueOffer)) continue;
      const ev = table[Math.floor(rng() * table.length)];
      if (!ev) continue;
      ps.rogueOffer = { round, eventId: ev.id, name: ev.name, desc: ev.desc,
        choices: ev.choices.map((c) => ({ id: c.id, label: c.label })) };
      ps.rogueOfferTable = ev;
      try { this.markPrivate(ps); } catch (e) { this.reportError('rogue offer', e); }
    }
    try { this.markPublic(); } catch { /* best effort */ }
    // 同上：`later(20, …)` 是 20 毫秒不是 20 秒 —— 随机事件弹窗同样会瞬间自动选第一个（2026-10-31 修）。
    try { this._rogueTimer = this.later(20 * 1000, () => this.rogueEventTimeout()); } catch { /* no scheduler */ }
  }

  rogueEventTimeout() {
    for (const ps of this.alivePlayers()) {
      const o = ps && ps.rogueOffer;
      if (o && o.choices && o.choices.length) { try { this.roguePick(ps, o.choices[0].id, { auto: true }); } catch { /* best effort */ } }
    }
  }

  /** 选中一个选项并立即结算（资金 / 生命 / 部署上限 / 装备 / 赌局 / 敌人词缀）。 */
  roguePick(ps, choiceId, { auto = false } = {}) {
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    const offer = ps && ps.rogueOffer;
    if (!offer || !offer.choices) return fail(ERR.BAD_TARGET, 'no rogue event'); // i18n-ignore
    const ev = ps.rogueOfferTable || null;
    const pick = ev && Array.isArray(ev.choices) ? ev.choices.find((c) => c.id === choiceId) : null;
    if (!pick) return fail(ERR.BAD_TARGET, 'bad choice'); // i18n-ignore
    ps.rogueOffer = null;
    ps.rogueOfferTable = null;
    // 结算
    if (Number.isFinite(pick.funds) && pick.funds) {
      if (pick.funds > 0) ps.addFunds(pick.funds, { reason: 'rogue' });
      else { const pay = Math.min(Math.max(0, Number(ps.funds) || 0), -pick.funds); if (pay > 0) ps.spend(pay); }
    }
    if (Number.isFinite(pick.lp) && pick.lp) ps.lp = Math.max(1, (Number(ps.lp) || 0) + pick.lp);
    if (Number.isFinite(pick.deployCap) && pick.deployCap) ps.deployCapBonus = (Number(ps.deployCapBonus) || 0) + pick.deployCap;
    if (pick.item === 'random') {
      const pool = (this.gd && this.gd.shopItemsByTier && this.gd.shopItemsByTier[2]) || [];
      const id = pool.length ? pool[Math.floor((Number(this.seed) || 1) % pool.length)] : null;
      if (id) { try { ps.acquireItem(id, { source: 'rogue' }); } catch { /* pool guard */ } }
    }
    if (pick.gamble) {
      const roll = createRng(deriveSeed(this.seed, `gamble:${this.round}:${ps.playerId}`))();
      const stake = Math.max(0, Number(pick.gamble.stake) || 0);
      const pay = Math.min(Math.max(0, Number(ps.funds) || 0), stake);
      if (pay > 0) ps.spend(pay);
      if (roll < 0.5) ps.addFunds(pick.gamble.win || 0, { reason: 'rogue-gamble' });
    }
    if (pick.affix && typeof pick.affix === 'object') {
      ps.rogueAffixBonus = ps.rogueAffixBonus || { hp: 0, atk: 0 };
      if (Number.isFinite(pick.affix.hp)) ps.rogueAffixBonus.hp += pick.affix.hp;
      if (Number.isFinite(pick.affix.atk)) ps.rogueAffixBonus.atk += pick.affix.atk;
    }
    try { ps.dirty && ps.dirty(); } catch { /* noop */ }
    try { this.recompute && this.recompute(ps); } catch { /* noop */ }
    try { this.markPrivate(ps); } catch (e) { this.reportError('rogue pick markPrivate', e); }
    try { this.markPublic(); } catch (e) { this.reportError('rogue pick markPublic', e); }
    void auto;
    return OK;
  }

  /** 紧急作战回合（肉鸽）：R5 / R9 —— 敌人更强，但回合开始给全队 +4 资金补偿。 */
  rogueEmergencyRound(r) { return this.isRogue === true && (r === 5 || r === 9); }

  /** 本回合的随机词缀（按 seed+回合确定，可复现）：敌人 +hp / +atk / +移速 之一。 */
  rogueRoundAffix(r = this.round) {
    if (this.isRogue !== true) return null;
    const p = createRng(deriveSeed(this.seed, `affix:${r}`))();
    if (p < 0.34) return { kind: 'hp', mul: 0.12, label: '敌人生命 +12%' };
    if (p < 0.67) return { kind: 'atk', mul: 0.12, label: '敌人攻击 +12%' };
    return { kind: 'speed', mul: 0.1, label: '敌人移速 +10%' };
  }

  /** 藏品候选池（来自 relics-87 插件的 data/relics.json，经 gd.raw.relics 到达）。 */
  relicPool() {
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const list = raw && Array.isArray(raw.relics) ? raw.relics : [];
    return list.filter((r) => r && typeof r.id === 'string' && r.id);
  }

  /** 藏品节奏：协同 R4/R8/R12 各一次；肉鸽（独立模式）每 2 回合一次（业主 2026-10-27：肉鸽就是靠藏品滚起来）。 */
  relicDraftRound(r) {
    if (this.isRogue === true) return r === 1 || (r >= 2 && r % 2 === 0); // 肉鸽：开局一份 + 之后每 2 回合
    return r === 4 || r === 8 || r === 12;
  }

  /** 给每名存活玩家发一份 3 选 1（独立抽，不与他人共享）。 */
  /**
   * 抽卡池：**只发效果真的接进引擎的藏品**（业主 2026-11-01「完成完整肉鸽」）。
   * 87 条里 55 条的效果尚未接入（41 条纯 `rule` 类 + ally/price/income 等）——发出去只会是「什么都不做」的死牌。
   * 兜底：若数据侧一条都没有已实现效果（老数据/裁剪包），退回全池，绝不让抽卡空转。
   */
  relicDraftPool() {
    const all = this.relicPool();
    const live = all.filter((r) => relicEffectApplied(r && r.effect));
    return live.length ? live : all;
  }

  relicOffer() {
    // 协同共竞与肉鸽都有藏品节奏（业主 2026-10-30「肉鸽并入协同」）。这里以前只认 `mode_xie_` 前缀，
    // 而肉鸽的 modeId 是 `mode_multi_*` ⇒ 肉鸽**一件藏品都发不出来**（`relicDraftRound` 每 2 回合返 true 也白搭）。
    if (!String(this.modeId || '').startsWith('mode_xie_') && this.isRogue !== true) return;
    const pool = this.relicDraftPool();
    if (!pool.length) return;
    const round = Number(this.round) || 1;
    const rng = createRng(deriveSeed(this.seed, `relic:${round}`));
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    for (const ps of this.alivePlayers()) {
      if (!ps || (Array.isArray(ps.relics) && ps.relics.length >= 3)) continue; // 每人本局最多 3 件
      if (Array.isArray(ps.relicOffer) && ps.relicOffer.length) continue;         // 已经有一份没选完
      const owned = new Set(Array.isArray(ps.relics) ? ps.relics : []);
      const take = shuffle(pool.filter((r) => !owned.has(r.id))).slice(0, 3);
      if (!take.length) continue;
      ps.relicOffer = take.map((r) => r.id);
      // 卡面数据一并带上（客户端不用自己查表）
      ps.relicOfferCards = take.map((r) => ({
        id: r.id,
        name: String(r.name || r.id),
        desc: String(r.desc || ''),
        icon: String(r.icon || `/assets/relics/${r.id}.png`),
        tier: String(r.tier || ''),
        set: String(r.set || ''),
        kind: String(r.kind || ''),
      }));
      ps.relicOfferRound = round;
      try { this.markPrivate(ps); } catch (e) { this.reportError('relic offer', e); }
    }
    try { this.markPublic(); } catch { /* best effort */ }
    // 超时兜底：不选就取第一张（与海克斯草案一致）
    // ⚠️ `later()` 的单位是**毫秒**（infra.js 的 `later(ms, fn)`）。原来写 `later(20, …)` = 20 **毫秒**
    // 后就自动取第一张 —— 弹窗几乎不可见也来不及点（2026-10-31 修成 20 秒）。
    try {
      this._relicTimer = this.later(20 * 1000, () => this.relicTimeout());
    } catch { /* 无调度器时忽略 */ }
  }

  relicTimeout() {
    for (const ps of this.alivePlayers()) {
      const offer = ps && Array.isArray(ps.relicOffer) ? ps.relicOffer : null;
      if (offer && offer.length) { try { this.relicPick(ps, offer[0], { auto: true }); } catch { /* best effort */ } }
    }
  }

  /** 选一件：只接受自己 offer 里的 id；入手后立即结算一次性效果。 */
  relicPick(ps, relicId, { auto = false } = {}) {
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    const offer = Array.isArray(ps.relicOffer) ? ps.relicOffer : null;
    if (!offer || !offer.length) return fail(ERR.BAD_TARGET, 'no relic offer'); // i18n-ignore
    if (!offer.includes(relicId)) return fail(ERR.BAD_TARGET, 'not offered'); // i18n-ignore
    const def = this.relicPool().find((r) => r.id === relicId) || null;
    ps.relicOffer = null;
    ps.relicOfferCards = null;
    if (!Array.isArray(ps.relics)) ps.relics = [];
    ps.relics.push(relicId);
    try { this.relicGrantInstant(ps, def); } catch (e) { this.reportError('relic instant', e); }
    try {
      this.toast(ps, 'info', (def && def.kind === 'negative' ? '获得负面藏品：' : '获得增益藏品：') + ((def && def.name) || relicId));
    } catch { /* toast 尽力而为 */ }
    try { ps.dirty && ps.dirty(); } catch { /* noop */ }
    try { this.markPrivate(ps); } catch (e) { this.reportError('relic pick markPrivate', e); }
    try { this.markPublic(); } catch (e) { this.reportError('relic pick markPublic', e); }
    void auto;
    return OK;
  }

  /** 按 relicId 购买藏品：校验商店等级 → 个人储备，再扣款并记入 `ps.relics`。 */
  meltBuyRelic(ps, relicId) {
    const st = this.melt;
    if (!st || !st.open) return fail(ERR.WRONG_PHASE, '商店没有开启'); // i18n-ignore
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const row = this.meltRelicRows(this.meltShopLevel(), Math.max(0, Math.floor(Number(es_spendable(ps)) || 0)))
      .find((r) => r.relicId === relicId);
    if (!row) return fail(ERR.BAD_TARGET, 'not a relic'); // i18n-ignore
    if (!row.unlocked) return fail(ERR.WRONG_PHASE, 'shop level too low'); // i18n-ignore
    if (!(es_spendable(ps) >= row.price)) return fail(ERR.NO_FUNDS);
    if (!es_safe_spend(ps, row.price)) return fail(ERR.NO_FUNDS);
    if (!Array.isArray(ps.relics)) ps.relics = [];
    ps.relics.push(relicId);
    const rawR = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const defR = rawR && Array.isArray(rawR.relics) ? rawR.relics.find((r) => r.id === relicId) : null;
    try { this.relicGrantInstant(ps, defR); } catch (e) { this.reportError('relic instant', e); }
    ps.dirty();
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /** 按 itemId 购买（目录式商店）：先判等阶/余额/手牌，再扣个人储备，最后发装备。 */
  meltBuy(ps, itemId) {
    const st = this.melt;
    if (!st || !st.open) return fail(ERR.WRONG_PHASE, '商店没有开启'); // i18n-ignore
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const rec = this.gd && typeof this.gd.item === 'function' ? this.gd.item(itemId) : null;
    if (!rec || !isShopItem(rec) || rec.requiresBondId) return fail(ERR.BAD_MSG, 'not a shop item'); // i18n-ignore
    const tier = Number(rec.tier) || 0;
    if (tier > this.meltShopLevel()) return fail(ERR.WRONG_PHASE, 'shop level too low'); // i18n-ignore
    const price = meltItemPrice(rec, this.teamProjects && this.teamProjects.equipCost);
    if (!(es_spendable(ps) >= price)) return fail(ERR.NO_FUNDS);
    if (typeof freeSlot === 'function' && freeSlot(ps.hand) < 0) return fail(ERR.HAND_FULL);
    if (!es_safe_spend(ps, price)) return fail(ERR.NO_FUNDS);
    try { ps.acquireItem(itemId, { source: 'melt' }); }
    catch (e) { this.reportError('melt buy', e); }
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
  /**
   * 「部署回复」档（业主 2026-10-26 接线 / 2026-10-27 补）：debts.deploy 每 1% 让干员 DP 回复速率降 1%，
   * 上限压到 20%（不低于 0）。乘在 battle flags 的 dpPerSec 上（sim/lifecycle.js 直接读它）。
   * @returns {number} 0..1 的乘子
   */
  meltDeployMul() {
    const st = this.melt;
    if (!st) return 1;
    const r = Math.max(0, Math.min(0.8, (Number(st.debt && st.debt.deploy) || 0) / 100));
    return r > 0 ? 1 - r : 1;
  }

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
      funds: es_spendable(ps),
      prices: offer.cards.map((c) => meltFundsPrice(c)),
      growth: st.growth,
      closed: st.closed.has(ps.playerId),
      pool: { prismatic: st.pool.prismatic.length, gold: st.pool.gold.length, silver: st.pool.silver.length },
      // 目录式商店：按品阶分组的全量可售装备（每件带价格/出处/可买状态）
      catalog: typeof this.meltCatalog === 'function' ? this.meltCatalog(ps) : null,
    };
  }
}
