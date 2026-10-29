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
/** 一件装备的资金价：跟装备自己的 items.json.price 走（×2 换到储备单位，夹 2..12）。 */
function meltItemPrice(rec) {
  return Math.max(2, Math.min(12, Math.round((Number(rec && rec.price) || 2) * 2)));
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
 * 扣款（业主 2026-10-26 三层资金）：装备从**个人储备**买，不动每回合资金。
 * 余额不足返回 false（调用方已先判过，这里只兜底）。
 */
function es_safe_spend(ps, price) {
  const have = Math.max(0, Math.floor(Number(ps.reserve) || 0));
  if (have < price) return false;
  ps.reserve = have - price;
  return true;
}

/** 这一页能拿钱买装备的余额 = 个人储备。 */
function es_spendable(ps) { return Math.max(0, Math.floor(Number(ps.reserve) || 0)); }

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
  meltShopLevel() { return Math.min(6, Math.max(1, Math.ceil((Number(this.round) || 1) / 2))); }

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
          const price = meltItemPrice(it);
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
      for (const ps of players) {
        const b = ps && ps.rogueAffixBonus;
        if (!b) continue;
        acc.hp += Number(b.hp) || 0;
        acc.atk += Number(b.atk) || 0;
      }
    }
    return acc;
  }

  /** 获得藏品时结算「一次性」效果（资金 / 生命 / 装备 / 部署上限 / 生命上限）。 */
  relicGrantInstant(ps, def) {
    const e = (def && def.effect) || {};
    const im = e.immediate && typeof e.immediate === 'object' ? e.immediate : null;
    if (im) {
      if (Number.isFinite(im.funds) && im.funds) ps.addFunds(Math.trunc(im.funds), { reason: 'relic' });
      if (Number.isFinite(im.lp) && im.lp) ps.lp = Math.max(1, (Number(ps.lp) || 0) + Math.trunc(im.lp));
      if (Array.isArray(im.items)) for (const itemId of im.items) { try { ps.acquireItem(itemId, { source: 'relic' }); } catch { /* 池子/数据守卫 */ } }
    }
    if (Number.isFinite(e.deployCap) && e.deployCap) ps.deployCapBonus = (Number(ps.deployCapBonus) || 0) + Math.trunc(e.deployCap);
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
    try { this._rogueTimer = this.later(20, () => this.rogueEventTimeout()); } catch { /* no scheduler */ }
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
  relicOffer() {
    if (!String(this.modeId || '').startsWith('mode_xie_')) return;
    const pool = this.relicPool();
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
    try {
      this._relicTimer = this.later(20, () => this.relicTimeout());
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
    const price = meltItemPrice(rec);
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
