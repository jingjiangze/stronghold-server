// plugins/mota/server/match/monsterShop.js — 攻方的怪物商店：每回合一张，5 格，可刷新/冻结/购买。
//
// 形态照「卫戍协议干员卡池」：卡有阶（tier）、有份数（MonsterPool 的 cap/left）、可刷新、可冻结、买走就少。
// 用途不同：买 / 点卡进「投放草稿」（ps.monsterDraft.picks），**仍不直接写 this.confront** —— 最终由既有的
// `submitConfront`（g.confront）校验并提交，预算 / 只数上限 / 合法怪集合全部复用现成逻辑。
// 2026-11-04 业主口径「点卡即投放」：`g.monsterPlace { index, gate, count? }` 把卡直接投到上/下出怪口、
// 可选数量；`buyMonster`（旧面板）保留，等价于「投到 lower、1 只」。两者**用掉后该格立即补位**（refillSlot）。
//
// 钱的量纲：单价 = 该怪官方波次价值 × MONSTER_PRICE_FACTOR（默认 1），刷新价 MONSTER_REFRESH_PRICE 同量纲。
// 钱从哪来（业主 2026-11-04 裁决）：攻方有**独立的怪物资金账户**，来源 = 每回合军费
// （match/confront.js grantMonsterFunds）+ 击杀 / 漏过奖励（match/settle.js），**跨回合结转**；
// 买卡 / 刷新 / 投放都是**显式扣款**（`spendMonsterFundsFrom`，全有或全无），撤回草稿退款。
// 账户归属（业主 2026-11-04 裁决 2「共同出怪 = 同队一份资金」）：shared（缺省）落**队级账户**
// `m.teamMonsterFunds`（Map<teamId, number>），solo 落 `ps.monsterFunds`；读 / 写一律走
// monsterFundsOf / addMonsterFundsTo / spendMonsterFundsFrom（见下方「怪物资金账户」一节）。
// 它不进守方的 funds / 统计（`econSplitLeftover` 不会清零它）。提交时 `_confrontMember` 的预算判据读同一个账户，
// 所以「买得起 = 交得上」，而刷新只会让余额更少，绝不会让已买的卡交不上。
//
// 守卫：m.monsterShopOn 为假（opts.monsterShop === false / 非对抗局）时，所有方法直接返回 ERR.WRONG_PHASE，
// 旧行为完全不受影响。购买 / 刷新 / 冻结 / 撤回草稿要求「投放窗口开着」：PHASE.PREP、本回合是攻守回合、
// 且 confrontStage == null（目标选择已结束、投放公示未开始）。2026-11-04 起投放窗口就是本回合的 PREP（与守方同一个
// deadline），不再有 PHASE.CONFRONT + confrontStage === 'monster' 的独立窗口。
//
// 回合闸门（2026-11-04 业主新口径）：卡池来源 = **本回合的官方出怪**（match/match/phases.js 的
// `_roundOfficialSpawns` 只读快照）→ 随机；没有快照（boss 回合 / 老对局）回落 confrontGroups。
// 卡池因此仍必须每回合重建（match/match/confront.js 的 finishConfrontTargets 每回合重建，不再「已有就跳过」），
// 商店发牌 / 购买 / 投放再各过一道 `legalKeys(m)` —— 与 `_confrontMember` 同源，买得到的卡一定交得上。
// 进出草稿后仍可能因为口径变动变成死卡，`dropMonster` 提供撤回入口（库存退回本队的池）。
//
// 怪物模式（业主 2026-11-04，`m.monsterMode`，由房间选项 `opts.monsterMode` 透传）：
//   · shared（缺省）= 共有出怪：池按队共享、同队攻方共用同一个 target；
//   · solo = 单人怪物模式：池按人（playerId），只有该队第一位存活攻方开店 / 能买能投，其余攻方一律 WRONG_PHASE。
//
// 共享池留份（2026-11-04 真机 2V2 控怪档）：同队 1 人类 + 1 AI 攻方共用一池，AI 开窗瞬间把池买空，人类两张卡
// 都是 `0/N` 且 `is-disabled`。现在 shared 模式下 **bot 的购买 / 投放上限 = 池里剩余 − 同队人类攻方人数**
// （`monsterStockLeft`，下限 0），人类自己的上限仍是池里的真实剩余（可以买到最后一份）。solo / 全 AI 队不受影响。

import { PHASE, ERR } from '../../shared/constants.js';
import { OK, fail } from './match/common.js';
import { createRng, deriveSeed } from '../sim/rng.js';
import { buildMonsterPool, legalKeys } from './monsterPool.js';
// 怪物盟约（2026-11-04 业主口径：攻方只有怪物方的独立盟约）：投放 / 购买涨层，撤回退层，帧里带一份视图。
import { addMonsterBonds, dropMonsterBonds, monsterBondView } from './monsterBonds.js';

// 合法集合的唯一判据在 monsterPool.js（卡池同源）：这里只转出，避免两份实现漂移。
export { legalKeys };

/** 商店格数（业主口径：5 格，与干员商店同宽）。 */
export const MONSTER_SHOP_SLOTS = 5;
/**
 * 卡面单价的**全局系数**（业主 2026-11-04 裁决：单价 = 该怪官方波次价值 × 全局系数）。
 * 它乘在 `monsterPriceOf` 里，而 `match/confront.js` 的 `confrontSpent` / `_confrontMember` 也走同一个函数 ——
 * 所以「预算 / 价格 / 提交校验」永远同尺度，改这一个常量就整体调价（默认 1 = 与官方价值等价）。
 */
export const MONSTER_PRICE_FACTOR = 1;
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

/**
 * 人类点了准备之后不能再动投放（准备 = 本回合的操作结束）。
 * bot 不受限：`cardpoolDeployPlan` 直接调 `buyMonster`，而 bot 的 `ready` 可能是 true（托管 / 自动准备）。
 * 判定只拦**人类意图入口**，bot 的引擎回落路径全部放行。
 */
function readyLocked(ps) { return !!(ps && !ps.botControlled && ps.ready); }

/**
 * 是否处在投放窗口（购买 / 刷新 / 冻结只在投放窗口里合法）：本回合的 PREP、是攻守回合、且目标选择已结束
 * （`confrontStage == null` —— 'target' 在 PHASE.CONFRONT 里，'roster' 是投放公示，两者都关窗）。
 * 与 MatchConfront.confrontWindowOpen（g.confront / botConfront 的闸门）同一判据。
 */
function inMonsterStage(m) {
  return !!m && m.phase === PHASE.PREP && m.confrontStage == null
    && typeof m.isRoleRound === 'function' && m.isRoleRound() === true;
}

/** 只有攻方才能买 / 投放（守方本回合只防守，与 submitConfront 的判据一致）。 */
function isAttacker(m, ps) {
  if (!ps) return false;
  if (ps.alive === false || ps.left === true) return false;
  if (m.attackingTeam == null || typeof m.teamIdOf !== 'function') return true;
  return m.teamIdOf(ps) === m.attackingTeam;
}

/** 该玩家所属的池。shared = 同队共用一个池（买走就少）；solo = 每人一个池（只有该队第一位存活攻方有权投放）。 */
export function monsterPoolFor(m, ps) {
  const solo = !!(m && m.monsterMode === 'solo');
  const key = solo
    ? ((ps && ps.playerId != null) ? ps.playerId : 0)
    : ((m && typeof m.teamIdOf === 'function' && ps) ? m.teamIdOf(ps) : 0);
  if (!m.monsterPools) m.monsterPools = new Map();
  if (!m.monsterPools.has(key)) m.monsterPools.set(key, buildMonsterPool(m));
  return m.monsterPools.get(key);
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 怪物资金账户（业主 2026-11-04 裁决）：共同出怪 = 同队共用一个池 + **一份资金**。
//   · shared（缺省）→ 队级账户 `m.teamMonsterFunds`（Map<teamId, number>，惰性建表）；
//     `ps.monsterFunds` 只作**镜像**（同队每个成员写回同一个值，帧 / 旧读数照旧）；
//   · solo → 落 `ps.monsterFunds`（每人一份，与改造前逐字节一致）。
// 所有增减都必须走 monsterFundsOf / addMonsterFundsTo / spendMonsterFundsFrom —— 它们是账户的唯一入口（读 / 加 / 扣）。
// 清单外的模块（match/match/settle.js 的击杀 / 漏过奖励）不必各改一行：Match 构造期把 PlayerState 的
// addMonsterFunds / spendMonsterFunds 改道到这三个访问器（见 Match.js 构造函数）。
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** 队级怪物资金表（惰性；key = teamId）。 */
export function teamMonsterFunds(m) {
  if (!m) return new Map();
  if (!m.teamMonsterFunds) m.teamMonsterFunds = new Map();
  return m.teamMonsterFunds;
}

/** 这一席的钱归队（shared）还是归人（solo）。商店关着时恒按个人（账户根本不参与）。 */
function fundsShared(m, ps) {
  return !!(m && ps && m.monsterShopOn === true && m.monsterMode !== 'solo');
}

/** 这一席所在的队 id（取不到 → 0，与 teamIdOf 的兜底一致）。 */
function fundsTeamKey(m, ps) {
  const t = m && typeof m.teamIdOf === 'function' ? m.teamIdOf(ps) : 0;
  return Number.isFinite(Number(t)) ? Number(t) : 0;
}

/**
 * 把队级余额写进**同队每个成员**的 `ps.monsterFunds`（镜像：帧 / 旧读数与账户恒等）。
 * @param {object} m @param {object} ps
 * @returns {number} 写进去的余额
 */
function syncTeamMonsterFunds(m, ps) {
  const key = fundsTeamKey(m, ps);
  const funds = Math.max(0, Number(teamMonsterFunds(m).get(key)) || 0);
  const seats = m && Array.isArray(m.order) ? m.order : [];
  for (const mate of seats) {
    if (!mate || typeof m.teamIdOf !== 'function' || m.teamIdOf(mate) !== key) continue;
    if (Number(mate.monsterFunds) === funds) continue;
    mate.monsterFunds = funds;
    if (typeof mate.dirty === 'function') mate.dirty();
  }
  return funds;
}

/**
 * 这一席此刻的**怪物资金余额**（唯一的读数入口：帧、购买闸门、提交预算都问它）。
 * @param {object} m @param {object} ps
 * @returns {number} >= 0
 */
export function monsterFundsOf(m, ps) {
  if (!ps) return 0;
  if (!fundsShared(m, ps)) return Math.max(0, Number(ps.monsterFunds) || 0);
  const key = fundsTeamKey(m, ps);
  const book = teamMonsterFunds(m);
  // 播种：队里第一次读这笔钱时，从该成员的现余额起算（老对局 / 迁移过来的个人账户不会被抹掉）。
  if (!book.has(key)) book.set(key, Math.max(0, Number(ps.monsterFunds) || 0));
  return Math.max(0, Number(book.get(key)) || 0);
}

/**
 * 入账（军费 / 击杀与漏过奖励 / 盟约返款）。shared → 队账户（同队成员镜像同步）；solo → ps.monsterFunds。
 * @param {object} m @param {object} ps @param {number} n
 * @returns {number} 实际入账的数（非正 / 非法 → 0）
 */
export function addMonsterFundsTo(m, ps, n) {
  if (!ps) return 0;
  if (!fundsShared(m, ps)) return typeof ps.addMonsterFunds === 'function' ? ps.addMonsterFunds(n) : 0;
  const v = Number.isFinite(n) ? Math.trunc(n) : 0;
  if (!(v > 0)) return 0;
  const key = fundsTeamKey(m, ps);
  const book = teamMonsterFunds(m);
  book.set(key, monsterFundsOf(m, ps) + v);
  syncTeamMonsterFunds(m, ps);
  return v;
}

/**
 * 扣款（买卡 / 刷新 / 投放），**全有或全无**：余额不够就一分不扣、返回 false。
 * shared → 队账户；solo → ps.spendMonsterFunds。
 * @param {object} m @param {object} ps @param {number} n
 * @returns {boolean} 是否扣款成功
 */
export function spendMonsterFundsFrom(m, ps, n) {
  if (!ps) return false;
  if (!fundsShared(m, ps)) return typeof ps.spendMonsterFunds === 'function' ? ps.spendMonsterFunds(n) : false;
  const v = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  if (!(v > 0)) return true;
  const cur = monsterFundsOf(m, ps);
  if (v > cur) return false;
  teamMonsterFunds(m).set(fundsTeamKey(m, ps), cur - v);
  syncTeamMonsterFunds(m, ps);
  return true;
}

/**
 * 同队阵线里**人类攻方**的人数（共享池的「留一份」口径）。取不到（没有 confrontActors / 它抛异常 /
 * 不是数组）→ 0 —— 调用方据此退化成「不留份」，与改造前完全一致。
 * @param {object} m
 * @returns {number} >= 0
 */
export function humanAttackers(m) {
  if (!m || typeof m.confrontActors !== 'function') return 0;
  let actors = null;
  try { actors = m.confrontActors(); } catch { return 0; }
  if (!Array.isArray(actors)) return 0;
  let n = 0;
  for (const p of actors) if (p && !p.botControlled) n += 1;
  return n;
}

/**
 * 本席购买 / 投放时**要给同队人类攻方留的份数**：只有「bot 买、shared 模式」才留。
 * 人类永远不停手（可以买到最后一份）；solo 每人一个池，也不留。
 * @param {object} m @param {object} ps
 * @returns {number} >= 0
 */
export function monsterReserve(m, ps) {
  if (!ps || !ps.botControlled) return 0;
  if (m && m.monsterMode === 'solo') return 0;
  return humanAttackers(m);
}

/**
 * 本席此刻还能从 `key` 拿走几份 = 池里剩余 − 给人类队友留的份数（下限 0）。
 * 真机 2V2 控怪档（2026-11-04）：同队 1 人类 + 1 bot 共享一个池，bot 开窗瞬间把池买空，人类两张卡都
 * `0/N` 且 `is-disabled` —— 留份就是为了让人类**至少还能买到最后一份**。人类自己的 ps 不是 bot ⇒ 上限
 * 就是池里的真实剩余，行为不变。buyMonster / placeMonster 与 botConfront 的逐 key 额度都走这一个函数。
 * @param {object} m @param {object} ps @param {string} key
 * @returns {number} >= 0
 */
export function monsterStockLeft(m, ps, key) {
  const left = monsterPoolFor(m, ps).left(key);
  const reserve = monsterReserve(m, ps);
  return reserve > 0 ? Math.max(0, left - reserve) : left;
}

/**
 * 投放权闸门（业主 2026-11-04 的「单人怪物模式」）：shared 模式下全体攻方都能投放；
 * solo 模式只有该队**第一位存活攻方**能投放（判定收在 match/match/confront.js 的 monsterPlaceActor，
 * 那里才有座位顺序）。match 没提供该判定时按「无权」处理 —— 宁可关店，也不让队友偷投。
 */
function placeActorOk(m, ps) {
  if (!ps) return false;
  if (!m || m.monsterMode !== 'solo') return true;
  return typeof m.monsterPlaceActor === 'function' && m.monsterPlaceActor(ps) === true;
}

/** 商店自己的随机流（与波次 / 布阵的流分开，回放时不会互相扰动）。 */
export function monsterShopRng(m) {
  if (typeof m.rngMonsterShop === 'function') return m.rngMonsterShop;
  m.rngMonsterShop = createRng(deriveSeed((Number(m.seed) >>> 0) || 1, 'monster-shop'));
  return m.rngMonsterShop;
}

// 合法 key 集合的**唯一判据** = monsterPool.js 的 `legalKeys`（2026-11-04 起从本文件移出，见文件头 import）：
// 优先级 = 本回合官方出怪（`m._roundOfficialSpawns` 只读快照）→ confrontGroups 并集 → null（不闸门）。
// `submitConfront` 的 `_confrontMember` 也调同一个函数，保证「买得到 / 点得动」的卡一定交得上。

/**
 * 一只怪在本回合的价格（confrontValue 量纲 × MONSTER_PRICE_FACTOR；取不到 → 0）。
 * **价格的唯一权威**：卡面报价（dealSlots / refillSlot）、购买 / 刷新 / 投放的扣款、撤回退款，以及
 * `match/confront.js` 的 `confrontSpent` / `_confrontMember` 预算判据全部走这里 —— 不要另算一遍公式，
 * 否则预算与卡价会不同尺度。
 */
export function monsterPriceOf(m, key) {
  if (!m || typeof m.confrontValueOf !== 'function' || typeof key !== 'string' || !key) return 0;
  const v = Number(m.confrontValueOf(key));
  return Number.isFinite(v) && v > 0 ? Math.max(1, Math.round(v * MONSTER_PRICE_FACTOR)) : 0;
}

/**
 * 本回合这个攻方还能花多少 —— 直接读**怪物资金账户**（业主 2026-11-04：攻方有独立账户、跨回合结转，
 * 买 / 刷新 / 投放都是显式扣款，不再拿「回合预算 − Σpicks」重算）。
 * 账户归属走 `monsterFundsOf`：shared 模式 = 队级账户（同队两人读到同一个数），solo = 个人账户。
 * 四个字段保留（帧兼容，老客户端只读 `left`）：`budget` = 余额，`picks` / `refresh` 恒 0（已经记账在余额里）。
 * @returns {{ budget: number, picks: number, refresh: number, left: number }}
 */
export function monsterBudgetLeft(m, ps) {
  const funds = monsterFundsOf(m, ps);
  return { budget: funds, picks: 0, refresh: 0, left: funds };
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
  // 怪物盟约（2026-11-04）：本回合投放累积出来的层数（空 → null，帧里省略该字段，老帧形状不变）
  const bonds = shopEnabled(m) ? monsterBondView(m, ps) : null;
  return {
    t: 'm.monsterShop',
    open: true,
    round: m ? m.round : null,
    refreshPrice: MONSTER_REFRESH_PRICE,
    freeRefreshes: Math.max(0, Number(shop.freeRefreshes) || 0),
    refreshes: Math.max(0, Number(shop.refreshes) || 0),
    budget: left.budget,
    // `spent` 现在恒 0：攻方是显式扣款（钱一花出去余额就少了），没有「预算 − 已花」这层记账了。
    // 字段名一个都没改（老客户端不会炸），语义见 monsterBudgetLeft。
    spent: left.picks + left.refresh,
    left: left.left,
    // 怪物资金（业主 2026-11-04）：`funds` = 账户余额（跨回合结转），`grant` = 本回合军费、`earned` = 本回合奖励。
    // 只有**商店真开着**（m.monsterShopOn）才出现 —— `opts.monsterShop === false` 的帧里一个新字段都不加，
    // 老客户端/旧对局的帧逐字节不变。
    ...(shopEnabled(m) ? {
      // shared 模式下同队两人读到同一个余额（队级账户，见 monsterFundsOf）
      funds: monsterFundsOf(m, ps),
      grant: Math.max(0, Number(ps.monsterGrant) || 0),
      earned: Math.max(0, Number(ps.monsterEarned) || 0),
    } : {}),
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
    // 怪物盟约条（客户端 `.gm__bonds` 在攻方回合改读这一份）；空则整个键不出现
    ...(bonds ? { bonds } : {}),
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
 * 单格补位（业主 2026-11-04「点卡即投放，用掉后该格自动补位」）：把 `idx` 这一格重抽一张新卡。
 * 规则与 dealSlots 同一套：只从「本回合合法集合 ∩ 池里有货」抽；跳过**其他格已占的 key**（同一次发牌内不重复）
 * 与**本格刚用掉的那张卡**（`usedKey`，避免同一格立刻重复上一张；它的剩余份数仍在池里，刷新可以再抽到）。
 * 冻结是「这一格这张卡」的属性：新卡不继承冻结（与 dealSlots 的 keep 判据一致 —— 冻结只对未售出且仍合法的那张卡生效）。
 * 池里没货 → 该格置 null。
 * @param {object} m @param {object} ps @param {number} idx @param {string|null} [usedKey]
 * @returns {{ key: string, tier: number, price: number, frozen: boolean, sold: boolean }|null}
 */
function refillSlot(m, ps, idx, usedKey = null) {
  const shop = ps && ps.monsterShop;
  if (!shop || !Array.isArray(shop.slots) || !Number.isInteger(idx) || idx < 0 || idx >= shop.slots.length) return null;
  const pool = monsterPoolFor(m, ps);
  const rng = monsterShopRng(m);
  const legal = legalKeys(m);
  const taken = new Set();
  for (let i = 0; i < shop.slots.length; i++) {
    if (i === idx) continue;
    const s = shop.slots[i];
    if (s && typeof s.key === 'string' && s.key) taken.add(s.key);
  }
  if (typeof usedKey === 'string' && usedKey) taken.add(usedKey);
  // 池里不在本回合合法集合内的 key 一律排除（pool.roll 只认 exclude，不认 allow —— 这里换算成 exclude）
  const excludeSet = () => {
    if (!legal) return taken;
    const ex = new Set(taken);
    for (const key of Object.keys(pool.snapshot())) if (!legal.has(key)) ex.add(key);
    return ex;
  };
  const key = pool.roll(rng, { exclude: excludeSet() });
  if (key == null) { shop.slots[idx] = null; return null; }
  shop.slots[idx] = {
    key,
    tier: pool.tier(key) || 1,
    price: monsterPriceOf(m, key),
    frozen: false,
    sold: false,
  };
  return shop.slots[idx];
}

/**
 * 把**开着的**怪物商店推给所有**非 bot** 的投放方（2026-11-04 第二轮复审修复 1：共享池不同步）。
 *
 * 为什么需要它：池按队共享（`monsterPoolFor`），但 bot 买卡只改池、不推帧 —— 人类队友手里的 `m.monsterShop`
 * 一直停在旧帧：`slots[].left` 是开局值、点卡得到 SOLD_OUT、面板整局不刷新。共享池的每次变化都必须让
 * 所有能看到这块池的席位收到新帧。
 *
 * 只推「商店开着」的席位（`ps.monsterShop` 存在：solo 模式里没投放权 / 已收尾的队友不该收到货架）；
 * bot 席位一律不推（`sendTo` 对 bot 本来就返回 false，但不依赖那一条）。推送失败不影响已经成功的操作。
 * @param {object} m
 * @param {{ except?: object|null }} [opts] except: 调用方自己已经单独推过的席位（避免同一帧发两遍）
 * @returns {number} 实际推出去的帧数
 */
export function pushMonsterShops(m, { except = null } = {}) {
  if (!shopEnabled(m) || typeof m.sendTo !== 'function' || typeof m.confrontActors !== 'function') return 0;
  let sent = 0;
  for (const ps of m.confrontActors()) {
    if (!ps || ps === except) continue;
    if (ps.botControlled || ps.isBot) continue;
    if (!ps.monsterShop || !ps.playerId) continue;
    try { m.sendTo(ps.playerId, monsterShopFrame(m, ps)); sent += 1; } catch (e) {
      if (typeof m.reportError === 'function') m.reportError('monster shop push', e);
    }
  }
  return sent;
}

/**
 * 开（或重置）本回合的商店，并把投放草稿清空。
 * 只要求商店开着（阶段由调用方保证：match/match/confront.js 的 finishConfrontTargets 在目标选择结束时开，
 * 让攻方在整个 PREP 里都有商店可用）。
 * solo 怪物模式：非「第一位存活攻方」不开店（返回 WRONG_PHASE）—— bot 策略自己开店的路径也走这道闸门。
 * @param {object} m @param {object} ps
 * @returns {{ ok: true, shop: object } | { error: string, detail?: string }}
 */
export function openMonsterShop(m, ps) {
  if (!shopEnabled(m)) return off();
  if (!ps) return fail(ERR.BAD_TARGET);
  if (!placeActorOk(m, ps)) return fail(ERR.WRONG_PHASE, 'solo monster mode: only the first attacker places'); // i18n-ignore
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
  if (readyLocked(ps)) return fail(ERR.WRONG_PHASE, 'ready'); // i18n-ignore: 服务端内部 detail
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
    // 显式扣款（业主 2026-11-04）：自费刷新花的是怪物资金；余额不够就一分不扣、不重抽、不记自费次数。
    // 账户走访问器：shared 扣队级账户，solo 扣个人账户。
    if (!spendMonsterFundsFrom(m, ps, price)) return fail(ERR.CONFRONT_BUDGET, 'refresh price over the monster funds'); // i18n-ignore
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
 * 共享池留份（2026-11-04 真机）：bot 的库存上限是 `monsterStockLeft`（= 剩余 − 同队人类攻方人数），
 * 留不出来就 SOLD_OUT；人类的上限仍是真实剩余。
 * @param {object} m @param {object} ps @param {number} idx
 * @returns {{ ok: true, index: number, key: string, price: number, left: number, picks: number }
 *   | { error: string, detail?: string }}
 */
export function buyMonster(m, ps, idx) {
  if (!shopEnabled(m)) return off();
  if (readyLocked(ps)) return fail(ERR.WRONG_PHASE, 'ready'); // i18n-ignore: 服务端内部 detail
  if (!inMonsterStage(m)) return fail(ERR.WRONG_PHASE);
  if (!isAttacker(m, ps)) return fail(ERR.WRONG_PHASE, 'the defending team cannot place monsters'); // i18n-ignore
  if (!placeActorOk(m, ps)) return fail(ERR.WRONG_PHASE, 'solo monster mode: only the first attacker places'); // i18n-ignore
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
  // 共享池留份（2026-11-04 真机 2V2）：bot 不得把同队人类的份额买光，人类自己不受这条限制。
  if (monsterStockLeft(m, ps, slot.key) <= 0) return fail(ERR.SOLD_OUT, 'stock reserved for human teammates'); // i18n-ignore
  const price = monsterPriceOf(m, slot.key);
  if (!(price > 0)) return fail(ERR.BAD_TARGET, 'unknown monster'); // i18n-ignore
  // 显式扣款（业主 2026-11-04）：先扣钱、再动库存 —— 钱不够时连库存都不碰。
  if (!spendMonsterFundsFrom(m, ps, price)) return fail(ERR.CONFRONT_BUDGET, 'price over the monster funds'); // i18n-ignore
  const taken = pool.take(slot.key, 1);
  if (taken < 1) { addMonsterFundsTo(m, ps, price); return fail(ERR.SOLD_OUT, 'stock empty'); } // i18n-ignore
  const key = slot.key;
  if (!ps.monsterDraft) ps.monsterDraft = { picks: [], position: 'mid' };
  if (!Array.isArray(ps.monsterDraft.picks)) ps.monsterDraft.picks = [];
  // 业主口径：买到就进草稿；投放时刻 / 门由 submitConfront（或 AI 的 _botConfrontPlan）再定
  ps.monsterDraft.picks.push({ enemyKey: key, gate: 'lower', time: null });
  // 怪物盟约（2026-11-04）：这一只算进「本回合投放的某一类型」的层数（官方波次不进这里）
  addMonsterBonds(m, ps, { enemyKey: key, count: 1, price });
  // 用掉自动补位（业主 2026-11-04）：这一格立刻重抽一张新卡（旧面板照旧能买，只是不再显示 sold 格）
  refillSlot(m, ps, idx, key);
  return { ok: true, index: idx, key, price, left: monsterBudgetLeft(m, ps).left, picks: ps.monsterDraft.picks.length };
}

/**
 * 点卡即投放（业主 2026-11-04）：`g.monsterPlace { index, gate, count? }` —— 把第 index 格的卡**直接**
 * 投到上/下出怪口，可选数量（缺省 1）。与 buyMonster 的区别只在「门」与「一次几只」；
 * 判据（商店开着 / 投放窗口 / 攻方 / 合法集合 / 预算 / 库存）与 buyMonster 完全同一套。
 *
 * count 的夹紧：`[1, min(20, 可用库存, 本格剩余预算能买的只数)]`，可用库存 = `monsterStockLeft`
 * （bot 在 shared 模式里要扣掉同队人类攻方的份数）；夹到 0（连一只都买不起）→ CONFRONT_BUDGET，
 * 且**不动库存**（先算再 take）。用掉后该格立即补位（refillSlot，见上）。
 * @param {object} m @param {object} ps @param {number} index 商店格下标
 * @param {'upper'|'lower'} gate 出怪口 @param {number} [count] 只数，缺省 1
 * @returns {{ ok: true, placed: number, key: string, left: number, picks: number, slot: object|null }
 *   | { error: string, detail?: string }}
 */
export function placeMonster(m, ps, index, gate, count = 1) {
  if (!shopEnabled(m)) return off();
  if (readyLocked(ps)) return fail(ERR.WRONG_PHASE, 'ready'); // i18n-ignore: 服务端内部 detail
  if (!inMonsterStage(m)) return fail(ERR.WRONG_PHASE);
  if (!isAttacker(m, ps)) return fail(ERR.WRONG_PHASE, 'the defending team cannot place monsters'); // i18n-ignore
  if (!placeActorOk(m, ps)) return fail(ERR.WRONG_PHASE, 'solo monster mode: only the first attacker places'); // i18n-ignore
  const shop = ps && ps.monsterShop;
  if (!shop) return fail(ERR.WRONG_PHASE, 'monster shop not open'); // i18n-ignore
  if (!Number.isInteger(index) || index < 0 || index >= shop.slots.length) return fail(ERR.BAD_TARGET);
  if (gate !== 'upper' && gate !== 'lower') return fail(ERR.BAD_TARGET, 'unknown gate'); // i18n-ignore
  const slot = shop.slots[index];
  if (!slot) return fail(ERR.BAD_TARGET);
  if (slot.sold === true) return fail(ERR.SOLD_OUT);
  const legal = legalKeys(m);
  if (legal && !legal.has(slot.key)) return fail(ERR.BAD_TARGET, 'this monster is not open this round'); // i18n-ignore
  const pool = monsterPoolFor(m, ps);
  if (pool.left(slot.key) <= 0) return fail(ERR.SOLD_OUT, 'stock empty'); // i18n-ignore
  // 共享池留份（2026-11-04 真机 2V2）：一次投放的只数上限也要先扣掉给人类队友留的份数。
  const available = monsterStockLeft(m, ps, slot.key);
  if (available <= 0) return fail(ERR.SOLD_OUT, 'stock reserved for human teammates'); // i18n-ignore
  const price = monsterPriceOf(m, slot.key);
  if (!(price > 0)) return fail(ERR.BAD_TARGET, 'unknown monster'); // i18n-ignore
  // 只数上限读**怪物资金余额**（业主 2026-11-04）：余额 / 单价 = 买得起几只
  const fundsLeft = monsterBudgetLeft(m, ps).left;
  const want = Number.isFinite(Number(count)) && Number(count) >= 1 ? Math.floor(Number(count)) : 1;
  const affordable = price > 0 ? Math.floor(fundsLeft / price) : 0;
  const units = Math.min(20, available, Math.max(0, affordable), want);
  if (units <= 0) return fail(ERR.CONFRONT_BUDGET, 'price over the monster funds'); // i18n-ignore
  const key = slot.key;
  const placed = pool.take(key, units);
  if (placed < 1) return fail(ERR.SOLD_OUT, 'stock empty'); // i18n-ignore
  // 显式扣款：按**实际投下的只数**结算；扣不动就把刚取走的库存还回去（全有或全无）
  if (!spendMonsterFundsFrom(m, ps, price * placed)) { pool.give(key, placed); return fail(ERR.CONFRONT_BUDGET, 'price over the monster funds'); } // i18n-ignore
  if (!ps.monsterDraft) ps.monsterDraft = { picks: [], position: 'mid' };
  if (!Array.isArray(ps.monsterDraft.picks)) ps.monsterDraft.picks = [];
  // count 条草稿：门由这次点击决定，时刻留给 submitConfront / _botConfrontPlan 再定
  for (let i = 0; i < placed; i++) ps.monsterDraft.picks.push({ enemyKey: key, gate, time: null });
  // 怪物盟约（2026-11-04）：按**实际投下的只数**涨层（类型盟约 + 增援）
  addMonsterBonds(m, ps, { enemyKey: key, count: placed, price });
  // 用掉自动补位：这一格换成一张新卡（池里没货就置 null）
  const slotAfter = refillSlot(m, ps, index, key);
  return { ok: true, placed, key, left: monsterBudgetLeft(m, ps).left, picks: ps.monsterDraft.picks.length, slot: slotAfter };
}

/**
 * 冻结 / 解冻一格（已售出的格没有意义 → SOLD_OUT）。
 * @param {object} m @param {object} ps @param {number} idx
 * @returns {{ ok: true, index: number, frozen: boolean } | { error: string, detail?: string }}
 */
export function freezeMonster(m, ps, idx) {
  if (!shopEnabled(m)) return off();
  if (readyLocked(ps)) return fail(ERR.WRONG_PHASE, 'ready'); // i18n-ignore: 服务端内部 detail
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
  if (readyLocked(ps)) return fail(ERR.WRONG_PHASE, 'ready'); // i18n-ignore: 服务端内部 detail
  if (!inMonsterStage(m)) return fail(ERR.WRONG_PHASE);
  if (!isAttacker(m, ps)) return fail(ERR.WRONG_PHASE, 'the defending team cannot place monsters'); // i18n-ignore
  const picks = ps && ps.monsterDraft && Array.isArray(ps.monsterDraft.picks) ? ps.monsterDraft.picks : null;
  if (!picks) return fail(ERR.WRONG_PHASE, 'monster shop not open'); // i18n-ignore
  if (!Number.isInteger(index) || index < 0 || index >= picks.length) return fail(ERR.BAD_TARGET);
  const [removed] = picks.splice(index, 1);
  const key = removed && typeof removed.enemyKey === 'string' && removed.enemyKey ? removed.enemyKey : null;
  const pool = monsterPoolFor(m, ps);
  // 退款（业主 2026-11-04）：撤回一张已付过款的草稿 = 把那笔钱退回怪物资金（单价按当前口径，与买它时同源）。
  if (key) {
    pool.give(key, 1);
    addMonsterFundsTo(m, ps, monsterPriceOf(m, key));
    // 怪物盟约（2026-11-04）：撤回把这一只的层数 / 只数退回去（资金只在回合收尾发，不涉及追回）
    dropMonsterBonds(m, ps, key, 1);
  }
  return { ok: true, index, key, left: key ? pool.left(key) : 0, picks: picks.length, funds: monsterFundsOf(m, ps) };
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
