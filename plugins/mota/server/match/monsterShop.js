// plugins/mota/server/match/monsterShop.js — 攻方的怪物商店：每回合一张，5 格，可刷新/冻结/购买。
//
// 形态照「卫戍协议干员卡池」：卡有阶（tier）、有份数（MonsterPool 的 cap/left）、可刷新、可冻结、买走就少。
// 用途不同：买到的卡进「投放草稿」（ps.monsterDraft.picks），**不直接投放** —— 最终仍由既有的
// `submitConfront`（g.confront）校验并提交，预算 / 只数上限 / 合法怪集合全部复用现成逻辑。
//
// 钱的量纲：刷新价 MONSTER_REFRESH_PRICE 以 confrontValue 为单位（与卡面价格、回合预算同一量纲）。
// 刷新花掉的钱记在 ps.monsterShop.spent 里，只**收紧**本回合还能买多少（buyMonster 的余额 = 预算 − 已买 − 刷新）；
// 它不进提交的 picks，所以 submitConfront 的预算判据仍只看 picks —— 刷新只会让玩家买得更少，绝不会让提交被拒。
//
// 守卫：m.monsterShopOn 为假（opts.monsterShop === false / 非对抗局）时，所有方法直接返回 ERR.WRONG_PHASE，
// 旧行为完全不受影响。购买 / 刷新 / 冻结 / 撤回草稿还要求阶段是 PHASE.CONFRONT 且 confrontStage === 'monster'。
//
// 回合闸门（2026-11-04 复验修复 1）：合法怪物集合**按回合变**（confrontGroups()：非 R13 每回合抽 4 个类型组，
// R13 全类型），所以卡池必须每回合重建（match/match/confront.js 的 enterConfront 不再「已有就跳过」），
// 商店发牌 / 购买再各过一道 `legalKeys(m)` —— 上一回合口径下建出来的卡不会混进本回合的商店或草稿。
// 进草稿后仍可能因为口径变动变成死卡，`dropMonster` 提供撤回入口（库存退回本队的池）。

import { PHASE, ERR } from '../../shared/constants.js';
import { OK, fail } from './match/common.js';
import { createRng, deriveSeed } from '../sim/rng.js';
import { buildMonsterPool } from './monsterPool.js';

/** 商店格数（业主口径：5 格，与干员商店同宽）。 */
export const MONSTER_SHOP_SLOTS = 5;
/** 刷新价，以 confrontValue 为单位（与卡面价格同量纲）。 */
export const MONSTER_REFRESH_PRICE = 2;
/** 每回合附赠的免费刷新次数（开局的那次发牌不计）。 */
export const MONSTER_FREE_REFRESHES = 1;
/** 每回合最多自费刷新几次（免费次数另算）。人类与 AI 同一上限，由 rollMonsterShop 记账（复验修复 2）。 */
export const MONSTER_MAX_PAID_REFRESHES = 2;

/** 商店关着 / 不在投放阶段：统一给 WRONG_PHASE（旧行为不产生任何副作用）。 */
const off = () => fail(ERR.WRONG_PHASE, 'monster shop off'); // i18n-ignore: 服务端内部 detail

/** 本局是否真的开着怪物商店（Match.monsterShopOn 由 match/match/confront.js 提供）。 */
function shopEnabled(m) { return !!(m && m.monsterShopOn === true); }

/** 是否处在投放阶段（购买 / 刷新 / 冻结只在这个窗口里合法）。 */
function inMonsterStage(m) { return !!m && m.phase === PHASE.CONFRONT && m.confrontStage === 'monster'; }

/** 只有攻方才能买 / 投放（守方本回合只防守，与 submitConfront 的判据一致）。 */
function isAttacker(m, ps) {
  if (!ps) return false;
  if (ps.alive === false || ps.left === true) return false;
  if (m.attackingTeam == null || typeof m.teamIdOf !== 'function') return true;
  return m.teamIdOf(ps) === m.attackingTeam;
}

/** 该玩家所属队的池（同队共用一个池：买走就少）。惰性建，不依赖 Match 构造函数。 */
export function monsterPoolFor(m, ps) {
  const team = (m && typeof m.teamIdOf === 'function' && ps) ? m.teamIdOf(ps) : 0;
  if (!m.monsterPools) m.monsterPools = new Map();
  if (!m.monsterPools.has(team)) m.monsterPools.set(team, buildMonsterPool(m));
  return m.monsterPools.get(team);
}

/** 商店自己的随机流（与波次 / 布阵的流分开，回放时不会互相扰动）。 */
export function monsterShopRng(m) {
  if (typeof m.rngMonsterShop === 'function') return m.rngMonsterShop;
  m.rngMonsterShop = createRng(deriveSeed((Number(m.seed) >>> 0) || 1, 'monster-shop'));
  return m.rngMonsterShop;
}

/**
 * 本回合**合法可投放**的 key 集合 = `confrontGroups()` 所有 `rows[].key` 的并集。
 * 与 `submitConfront` 的 `_confrontMember` 同一判据（只认 groups 的并集），所以商店不会发出提交必被拒的卡。
 * 取不到 groups（match 上没有这个方法 / 它抛异常）→ `null` = 不做闸门（非对抗档的旧行为不受影响）。
 * 缓存挂在 match 上、以 groups 数组的**引用**为键：`confrontGroups()` 按「回合|倍率」重算时会换一个新数组，
 * 引用一变缓存自动失效，不需要另记 round。
 * @param {object} m
 * @returns {Set<string>|null}
 */
export function legalKeys(m) {
  if (!m || typeof m.confrontGroups !== 'function') return null;
  let groups;
  try { groups = m.confrontGroups(); } catch { return null; }
  const cache = m._monsterLegalKeys;
  if (cache && cache.groups === groups) return cache.keys;
  const keys = new Set();
  for (const g of Array.isArray(groups) ? groups : []) {
    for (const r of (g && g.rows) || []) if (r && typeof r.key === 'string' && r.key) keys.add(r.key);
  }
  m._monsterLegalKeys = { groups, keys };
  return keys;
}

/** 一只怪在本回合的价格（confrontValue 量纲；取不到 → 0）。 */
export function monsterPriceOf(m, key) {
  if (!m || typeof m.confrontValueOf !== 'function' || typeof key !== 'string' || !key) return 0;
  const v = Number(m.confrontValueOf(key));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 本回合这个玩家还能花多少（= 回合预算 − 已买卡的价 − 刷新花掉的钱）。
 * @returns {{ budget: number, picks: number, refresh: number, left: number }}
 */
export function monsterBudgetLeft(m, ps) {
  const budget = Number(m && typeof m.confrontBudget === 'function' ? m.confrontBudget() : 0) || 0;
  const picks = (ps && ps.monsterDraft && Array.isArray(ps.monsterDraft.picks)) ? ps.monsterDraft.picks : [];
  const pickSpent = Number(m && typeof m.confrontSpent === 'function' ? m.confrontSpent(picks) : 0) || 0;
  const refreshSpent = Number(ps && ps.monsterShop ? ps.monsterShop.spent : 0) || 0;
  return { budget, picks: pickSpent, refresh: refreshSpent, left: Math.max(0, budget - pickSpent - refreshSpent) };
}

/** 商店快照（客户端报价用；public views 不带商店，所以由意图成功时私有推送）。 */
export function monsterShopFrame(m, ps) {
  const shop = ps && ps.monsterShop;
  const left = shop ? monsterBudgetLeft(m, ps) : { budget: 0, picks: 0, refresh: 0, left: 0 };
  if (!shop) return { t: 'm.monsterShop', open: false, round: m ? m.round : null, slots: [], draft: { picks: [], position: 'mid' } };
  const pool = monsterPoolFor(m, ps);
  const nameOf = (key) => {
    try {
      const rec = m && m.gd && typeof m.gd.enemy === 'function' ? m.gd.enemy(key) : null;
      return (rec && rec.name) || key;
    } catch { return key; }
  };
  return {
    t: 'm.monsterShop',
    open: true,
    round: m ? m.round : null,
    refreshPrice: MONSTER_REFRESH_PRICE,
    freeRefreshes: Math.max(0, Number(shop.freeRefreshes) || 0),
    refreshes: Math.max(0, Number(shop.refreshes) || 0),
    budget: left.budget,
    spent: left.picks + left.refresh,
    left: left.left,
    slots: (shop.slots || []).map((s, index) => (s ? {
      index,
      key: s.key,
      name: nameOf(s.key),
      tier: s.tier,
      price: s.price,
      frozen: s.frozen === true,
      sold: s.sold === true,
      left: pool.left(s.key),
      cap: pool.cap(s.key),
    } : null)),
    draft: {
      picks: ((ps.monsterDraft && ps.monsterDraft.picks) || []).map((p) => ({ enemyKey: p.enemyKey, gate: p.gate })),
      position: (ps.monsterDraft && ps.monsterDraft.position) || 'mid',
    },
  };
}

/**
 * 发一手牌：冻结格保留，其余重抽（同一次发牌内不重复；池里没货 / 不合本回合口径就留空格 null）。
 * 只从「本回合合法集合 ∩ 池里有货」抽：卡池若是在别的回合口径下建的（或池里混进了不在 groups 里的怪），
 * 也不会把死卡发到货架上（复验修复 1.3）。冻结格同样要过闸门 —— 不合法的冻结格按未冻结处理、直接重抽。
 * 不检查阶段、不扣钱 —— 只给 openMonsterShop 与 rollMonsterShop 用。
 */
function dealSlots(m, ps) {
  const pool = monsterPoolFor(m, ps);
  const rng = monsterShopRng(m);
  const slots = ps.monsterShop.slots;
  const legal = legalKeys(m);
  /** 冻结且未售出、且（若本回合有闸门）仍合法的格 = 保留；其余重抽。 */
  const keep = (s) => !!s && s.frozen === true && s.sold !== true && (!legal || legal.has(s.key));
  const taken = new Set();
  for (const s of slots) if (keep(s)) taken.add(s.key);
  // 池里不在本回合合法集合内的 key 一律排除（pool.roll 只认 exclude，不认 allow —— 这里换算成 exclude）
  const excludeSet = () => {
    if (!legal) return taken;
    const ex = new Set(taken);
    for (const key of Object.keys(pool.snapshot())) if (!legal.has(key)) ex.add(key);
    return ex;
  };
  for (let i = 0; i < slots.length; i++) {
    const cur = slots[i];
    if (keep(cur)) continue;
    const key = pool.roll(rng, { exclude: excludeSet() });
    if (key == null) { slots[i] = null; continue; }
    taken.add(key);
    slots[i] = {
      key,
      tier: pool.tier(key) || 1,
      price: monsterPriceOf(m, key),
      frozen: false,
      sold: false,
    };
  }
  return slots;
}

/**
 * 开（或重置）本回合的商店，并把投放草稿清空。
 * 只要求商店开着（阶段由调用方保证：enterConfront 在 step 1 就开，让 AI 也有商店可用）。
 * @param {object} m @param {object} ps
 * @returns {{ ok: true, shop: object } | { error: string, detail?: string }}
 */
export function openMonsterShop(m, ps) {
  if (!shopEnabled(m)) return off();
  if (!ps) return fail(ERR.BAD_TARGET);
  ps.monsterShop = {
    slots: new Array(MONSTER_SHOP_SLOTS).fill(null),
    freeRefreshes: MONSTER_FREE_REFRESHES,
    paidRefreshes: 0,
    spent: 0,
    refreshes: 0,
    round: Number(m.round) || 0,
  };
  ps.monsterDraft = { picks: [], position: 'mid' };
  dealSlots(m, ps);
  return { ok: true, shop: ps.monsterShop };
}

/**
 * 刷新：冻结（未售出且本回合合法）的格保留，其余重抽。
 * `free: true` 是开局发牌（不扣钱、不消耗免费次数）；否则**每次玩家发起**的刷新先抵扣免费次数，
 * 免费次数用完后按 MONSTER_REFRESH_PRICE 自费，且自费次数封顶 MONSTER_MAX_PAID_REFRESHES —— 人类与 AI 同一口径
 * （复验修复 2：此前上限只写在 AI 策略里，玩家可以无限自费刷）。超出上限 → WRONG_PHASE，且不扣钱、不重抽。
 * @param {object} m @param {object} ps @param {{ free?: boolean }} [opts]
 * @returns {{ ok: true, price: number, free: boolean, shop: object } | { error: string, detail?: string }}
 */
export function rollMonsterShop(m, ps, { free = false } = {}) {
  if (!shopEnabled(m)) return off();
  if (!ps || !ps.monsterShop) return fail(ERR.WRONG_PHASE, 'monster shop not open'); // i18n-ignore
  if (!free) {
    if (!inMonsterStage(m)) return fail(ERR.WRONG_PHASE);
    if (!isAttacker(m, ps)) return fail(ERR.WRONG_PHASE, 'the defending team cannot place monsters'); // i18n-ignore
  }
  const shop = ps.monsterShop;
  // 免费次数先抵；只有免费次数用完的那几次才算「自费」
  const useFree = !free && (Number(shop.freeRefreshes) || 0) > 0;
  if (!free && !useFree && (Number(shop.paidRefreshes) || 0) >= MONSTER_MAX_PAID_REFRESHES) {
    return fail(ERR.WRONG_PHASE, 'no refreshes left this round'); // i18n-ignore
  }
  const price = free || useFree ? 0 : MONSTER_REFRESH_PRICE;
  if (price > 0) {
    const { left } = monsterBudgetLeft(m, ps);
    if (price > left) return fail(ERR.CONFRONT_BUDGET, 'refresh price over the round budget'); // i18n-ignore
  }
  if (useFree) shop.freeRefreshes = Math.max(0, (Number(shop.freeRefreshes) || 0) - 1);
  if (price > 0) shop.paidRefreshes = Math.max(0, Number(shop.paidRefreshes) || 0) + 1;
  shop.spent = Math.max(0, Number(shop.spent) || 0) + price;
  if (!free) shop.refreshes = Math.max(0, Number(shop.refreshes) || 0) + 1;
  dealSlots(m, ps);
  return { ok: true, price, free: free || useFree, shop };
}

/**
 * 买一格：从本队的池里取走 1 份库存，把卡放进投放草稿（不直接投放 —— 仍由 g.confront 提交）。
 * 判据顺序与 PlayerState.buy 一致：阶段/身份 → 索引 → 该格 → **本回合合法性** → 售出 → 库存 → 预算。
 * 复验修复 1.2：不在本回合合法集合里的卡一律 BAD_TARGET 且不扣库存（否则买到手也提交不了，
 * 提交时只会得到 `illegal 对抗期 pick`）。
 * @param {object} m @param {object} ps @param {number} idx
 * @returns {{ ok: true, index: number, key: string, price: number, left: number, picks: number }
 *   | { error: string, detail?: string }}
 */
export function buyMonster(m, ps, idx) {
  if (!shopEnabled(m)) return off();
  if (!inMonsterStage(m)) return fail(ERR.WRONG_PHASE);
  if (!isAttacker(m, ps)) return fail(ERR.WRONG_PHASE, 'the defending team cannot place monsters'); // i18n-ignore
  const shop = ps && ps.monsterShop;
  if (!shop) return fail(ERR.WRONG_PHASE, 'monster shop not open'); // i18n-ignore
  if (!Number.isInteger(idx) || idx < 0 || idx >= shop.slots.length) return fail(ERR.BAD_TARGET);
  const slot = shop.slots[idx];
  if (!slot) return fail(ERR.BAD_TARGET);
  const legal = legalKeys(m);
  if (legal && !legal.has(slot.key)) return fail(ERR.BAD_TARGET, 'this monster is not open this round'); // i18n-ignore
  if (slot.sold === true) return fail(ERR.SOLD_OUT);
  const pool = monsterPoolFor(m, ps);
  if (pool.left(slot.key) <= 0) return fail(ERR.SOLD_OUT, 'stock empty'); // i18n-ignore
  const price = monsterPriceOf(m, slot.key);
  if (!(price > 0)) return fail(ERR.BAD_TARGET, 'unknown monster'); // i18n-ignore
  const { left } = monsterBudgetLeft(m, ps);
  if (price > left) return fail(ERR.CONFRONT_BUDGET, 'price over the round budget'); // i18n-ignore
  const taken = pool.take(slot.key, 1);
  if (taken < 1) return fail(ERR.SOLD_OUT, 'stock empty'); // i18n-ignore
  slot.sold = true;
  if (!ps.monsterDraft) ps.monsterDraft = { picks: [], position: 'mid' };
  if (!Array.isArray(ps.monsterDraft.picks)) ps.monsterDraft.picks = [];
  // 业主口径：买到就进草稿；投放时刻 / 门由 submitConfront（或 AI 的 _botConfrontPlan）再定
  ps.monsterDraft.picks.push({ enemyKey: slot.key, gate: 'lower', time: null });
  return { ok: true, index: idx, key: slot.key, price, left: monsterBudgetLeft(m, ps).left, picks: ps.monsterDraft.picks.length };
}

/**
 * 冻结 / 解冻一格（已售出的格没有意义 → SOLD_OUT）。
 * @param {object} m @param {object} ps @param {number} idx
 * @returns {{ ok: true, index: number, frozen: boolean } | { error: string, detail?: string }}
 */
export function freezeMonster(m, ps, idx) {
  if (!shopEnabled(m)) return off();
  if (!inMonsterStage(m)) return fail(ERR.WRONG_PHASE);
  if (!isAttacker(m, ps)) return fail(ERR.WRONG_PHASE, 'the defending team cannot place monsters'); // i18n-ignore
  const shop = ps && ps.monsterShop;
  if (!shop) return fail(ERR.WRONG_PHASE, 'monster shop not open'); // i18n-ignore
  if (!Number.isInteger(idx) || idx < 0 || idx >= shop.slots.length) return fail(ERR.BAD_TARGET);
  const slot = shop.slots[idx];
  if (!slot) return fail(ERR.BAD_TARGET);
  if (slot.sold === true) return fail(ERR.SOLD_OUT);
  slot.frozen = slot.frozen !== true;
  return { ok: true, index: idx, frozen: slot.frozen };
}

/**
 * 撤回一张投放草稿（复验修复 1.4）：`g.monsterDrop { index }` → 把 picks[index] 摘掉，并把那一份库存还给本队的池。
 * 存在的理由：卡池按回合重建 / 合法集合按回合变，草稿里若留着一张已不合法的死卡，玩家既提交不了也删不掉，
 * 整个投放窗口就废了。已售出的商店格不回滚（卡已经从货架上消失），退回去的只是库存份数。
 * @param {object} m @param {object} ps @param {number} index
 * @returns {{ ok: true, index: number, key: string|null, left: number, picks: number } | { error: string, detail?: string }}
 */
export function dropMonster(m, ps, index) {
  if (!shopEnabled(m)) return off();
  if (!inMonsterStage(m)) return fail(ERR.WRONG_PHASE);
  if (!isAttacker(m, ps)) return fail(ERR.WRONG_PHASE, 'the defending team cannot place monsters'); // i18n-ignore
  const picks = ps && ps.monsterDraft && Array.isArray(ps.monsterDraft.picks) ? ps.monsterDraft.picks : null;
  if (!picks) return fail(ERR.WRONG_PHASE, 'monster shop not open'); // i18n-ignore
  if (!Number.isInteger(index) || index < 0 || index >= picks.length) return fail(ERR.BAD_TARGET);
  const [removed] = picks.splice(index, 1);
  const key = removed && typeof removed.enemyKey === 'string' && removed.enemyKey ? removed.enemyKey : null;
  const pool = monsterPoolFor(m, ps);
  if (key) pool.give(key, 1);
  return { ok: true, index, key, left: key ? pool.left(key) : 0, picks: picks.length };
}

/**
 * 收尾：finishConfront 之后把商店与草稿从 PlayerState 上摘掉（picks 已经在 this.confrontSubs / this.confront 里）。
 * 没什么可清的时候是 no-op。
 * @param {object} m @param {object} ps
 * @returns {{ ok: true }}
 */
export function closeMonsterShop(m, ps) {
  void m;
  if (!ps) return OK;
  if (ps.monsterShop) delete ps.monsterShop;
  if (ps.monsterDraft) delete ps.monsterDraft;
  return OK;
}
