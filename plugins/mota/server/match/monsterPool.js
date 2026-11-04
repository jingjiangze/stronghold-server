// plugins/mota/server/match/monsterPool.js — 怪物卡池：把「对抗可投放的敌人」做成干员卡池形态。
// 价格 = confrontValueOf(enemyKey)（与波次价值同一量纲）；阶位按价格分档（**只作展示**）；
// 份数 = 官方该回合只数 × 1.5（业主 2026-11-04：不再按阶位递减、不再乘攻方人数，见 buildMonsterPool）。
// 单位是「一只怪」（spawn count:1），不是整波。
//
// 与 pool.js 的 SharedPool 同构（cap / left / take / give / snapshot / totalLeft / 份数加权 roll）：
// 买走一份就少一份。池的归属随 `m.monsterMode`：shared（默认）= 同队攻方共用一个池（见
// match/match/confront.js 的 finishConfrontTargets / this.monsterPools）；solo = 每人一个池（只有该队
// 第一位存活攻方持有投放权，见 monsterShop.js 的 monsterPoolFor）。
// 卡池来源（业主 2026-11-04；2026-11-04 复验按规则档分流）：对抗档 = 该回合的官方出怪（match/match/phases.js 的
// `_roundOfficialSpawns` 只读快照）；赏金档 = 面板并集（confrontGroups 的行 key 并集，见 officialForRule）——
// 赏金档实测「官方 key ∩ 面板 = 0」；快照/面板都缺失时回落 confrontPool。
//
// 阶位口径（2026-11-03 实测 data/enemies.json × data/factions.json，confrontPool 120 只）：
//   · 基础价 = confrontValue(e)（scale 为 1 的无倍率口径，即 R1 量纲）—— 实测区间 8..405，
//     分位 p25 / p50 / p75 / p90 = 50 / 87 / 152 / 226。
//   · 分档切点 MONSTER_TIER_BANDS = [25, 50, 100, 200] → tier1..5，实测每档 5 / 26 / 34 / 40 / 15 只。
//   · 定阶只看**基础价**，不看本回合价：本回合价随 gd.enemyScale 的 hp/atk 倍率整体上浮，同一只怪会在后期
//     跳档；阶位是怪物的固有稀有度（与「这一回合卖多少钱」分开）。
//   · 卡面价格仍由 m.confrontValueOf(key) 取（本回合量纲，含特性档位分）—— 预算判据因此与既有逻辑同尺度。
//
// 依赖方向：本文件 import 了 match/match/confront.js 的两个**纯函数**（confrontPool / confrontValue）；
// confront.js 又 import 本文件，构成 ESM 循环导入。两边都只在函数体内取用对方的导出（函数声明会被提升），
// 模块顶层不互相求值，因此安全。

import { confrontPool, confrontValue } from './match/confront.js';

/**
 * 价格分档切点（基础价口径，见文件头）。`cost > band` 逐级 +1 ⇒ 5 档。
 * @type {readonly number[]}
 */
export const MONSTER_TIER_BANDS = Object.freeze([25, 50, 100, 200]);

/** 每阶的份数（**仅在没有官方出怪快照时**的回落值：boss 回合 / 老对局）。tier1 → 8 … tier5 → 1。 */
export const MONSTER_COPIES_BY_TIER = Object.freeze({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 1 });

/**
 * 卡池份数的**全局比例**（业主 2026-11-04 裁决：卡池份数 = 官方该回合只数 × 1.5，按队算）。
 * 与 match/confront.js:90 的 `CONFRONT_VOLUME_SHARE` **保持一致**（同一个「控怪出怪量 = 官方 1.5 倍」口径）。
 * 为什么要在这里再写一份：从 confront.js 导入会让本文件 → confront.js → 本文件的循环更深，且顶层 const
 * 在循环求值时有 TDZ 风险；两份常量都是「业主口径 1.5」，改动时两处一起改。
 */
export const MONSTER_POOL_COPIES_SHARE = 1.5;

/** 最高阶（= 分档切点数 + 1）。 */
export const MONSTER_MAX_TIER = MONSTER_TIER_BANDS.length + 1;

/**
 * 价格 → 阶位（1..MONSTER_MAX_TIER）。非有限 / 非正数一律按 tier1 处理（与 confrontValue 的下限 1 一致）。
 * @param {number} cost 基础价（confrontValue 口径；不是混了本回合倍率的价格）
 * @returns {number} 1..5
 */
export function monsterTierOf(cost) {
  const v = Number(cost);
  if (!Number.isFinite(v) || v <= 0) return 1;
  let tier = 1;
  for (const band of MONSTER_TIER_BANDS) if (v > band) tier += 1;
  return Math.min(MONSTER_MAX_TIER, tier);
}

/**
 * 一只怪的卡池条目：`{ key, cost, tier, cap }`。
 * `cost` 是**价格**（本回合 confrontValueOf 量纲），`tier` 由基础价定（见文件头），`cap` = 该阶份数。
 * @typedef {{ key: string, cost: number, tier: number, cap: number }} MonsterPoolEntry
 */
export class MonsterPool {
  /**
   * @param {MonsterPoolEntry[]} entries
   */
  constructor(entries = []) {
    /** @type {Map<string, { cap: number, left: number, tier: number, cost: number }>} */
    this.entries = new Map();
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || typeof e.key !== 'string' || !e.key) continue;
      const cap = Math.max(0, Math.floor(Number(e.cap) || 0));
      if (cap <= 0) continue;
      const cost = Number(e.cost);
      const tier = Math.max(1, Math.min(MONSTER_MAX_TIER, Math.floor(Number(e.tier) || 1)));
      this.entries.set(e.key, {
        cap,
        left: cap,
        tier,
        cost: Number.isFinite(cost) && cost > 0 ? cost : 0,
      });
    }
  }

  /** 这只怪是否在池里。 */
  has(key) { return this.entries.has(key); }

  /** 价格（entry 建池时的量纲）；不在池里 → 0。 */
  cost(key) { return this.entries.get(key)?.cost ?? 0; }

  /** 阶位；不在池里 → 0。 */
  tier(key) { return this.entries.get(key)?.tier ?? 0; }

  /** 该怪的官方份数（总额）；不在池里 → 0。 */
  cap(key) { return this.entries.get(key)?.cap ?? 0; }

  /** 剩余份数（对外一律夹到 >= 0）。 */
  left(key) { return Math.max(0, this.entries.get(key)?.left ?? 0); }

  /**
   * 取走最多 n 份，返回**实际取走**的数量（夹在剩余份数内；不在池里 / n 非正 → 0）。
   * @param {string} key @param {number} [n]
   */
  take(key, n = 1) {
    const e = this.entries.get(key);
    const want = Math.floor(Number(n));
    if (!e || !(want > 0)) return 0;
    const k = Math.min(Math.max(0, e.left), want);
    e.left -= k;
    return k;
  }

  /**
   * 归还最多 n 份，返回**实际归还**的数量（夹在 cap 内）。
   * @param {string} key @param {number} [n]
   */
  give(key, n = 1) {
    const e = this.entries.get(key);
    const want = Math.floor(Number(n));
    if (!e || !(want > 0)) return 0;
    const k = Math.min(e.cap - e.left, want);
    e.left += k;
    return k;
  }

  /** { key: 剩余份数 } 快照（测试 / 诊断）。 */
  snapshot() {
    const o = {};
    for (const [key, e] of this.entries) o[key] = Math.max(0, e.left);
    return o;
  }

  /** 全池剩余份数合计。 */
  totalLeft() {
    let n = 0;
    for (const e of this.entries.values()) n += Math.max(0, e.left);
    return n;
  }

  /**
   * 按**剩余份数**加权抽一个 key（份数就是权重：便宜的怪份数多，出场率自然高）。
   * 剩余为 0 的怪永远不会被抽到。
   * @param {() => number} rng [0,1) 随机源（match 里用 m.rngMonsterShop）
   * @param {{ tiers?: number[]|Set<number>|number|null, exclude?: string[]|Set<string>|null }} [opts]
   *   tiers: 只在这些阶里抽（缺省 = 全阶）；exclude: 不抽这些 key（同一张商店里避免重复）
   * @returns {string|null} 无候选 → null
   */
  roll(rng, { tiers = null, exclude = null } = {}) {
    let tierFilter = null;
    if (tiers != null) {
      const list = Array.isArray(tiers) || tiers instanceof Set ? [...tiers] : [tiers];
      tierFilter = new Set(list.map(Number).filter((t) => Number.isFinite(t)));
    }
    const excludeSet = exclude == null ? null : (exclude instanceof Set ? exclude : new Set(exclude));
    const candidates = [];
    let total = 0;
    for (const [key, e] of this.entries) {
      if (!(e.left > 0)) continue;
      if (tierFilter && !tierFilter.has(e.tier)) continue;
      if (excludeSet && excludeSet.has(key)) continue;
      candidates.push([key, e.left]);
      total += e.left;
    }
    if (!(total > 0)) return null;
    let r = (typeof rng === 'function' ? rng() : Math.random()) * total;
    for (const [key, n] of candidates) { r -= n; if (r < 0) return key; }
    return candidates[candidates.length - 1][0];
  }
}

/**
 * 本回合官方出怪的**只读快照**（由 match/match/phases.js 在每回合建波后写入 `m._roundOfficialSpawns`）。
 * 卡池真源（业主 2026-11-04：每回合卡池 = 该回合的官方出怪，然后随机）。boss 回合 / 老对局 / 未进 ROUND_START
 * 时没有快照 → null（调用方回落到 confrontGroups / confrontPool）。
 * @param {object} m
 * @returns {Set<string>|null} 去重后的 enemyKey；无快照 → null
 */
export function officialSpawnKeys(m) {
  const list = m && m._roundOfficialSpawns;
  if (!Array.isArray(list) || !list.length) return null;
  const keys = new Set();
  for (const s of list) if (s && typeof s.enemyKey === 'string' && s.enemyKey) keys.add(s.enemyKey);
  return keys.size ? keys : null;
}

/**
 * 本回合官方出怪里每个 key 的**合计只数**（份数的口径，见 buildMonsterPool）。
 * @param {object} m
 * @returns {Map<string, number>|null} 无快照 → null
 */
export function officialSpawnCounts(m) {
  const list = m && m._roundOfficialSpawns;
  if (!Array.isArray(list) || !list.length) return null;
  const counts = new Map();
  for (const s of list) {
    if (!s || typeof s.enemyKey !== 'string' || !s.enemyKey) continue;
    const n = Math.max(1, Number(s.count) || 1);
    counts.set(s.enemyKey, (counts.get(s.enemyKey) || 0) + n);
  }
  return counts.size ? counts : null;
}

/**
 * 本回合官方出怪快照**只对「对抗」档生效**（业主 2026-11-04 复验修复 2）：
 *   · 对抗档（`m.isConfrontRule()`）→ 官方波次（本回合真正生成的怪），维持 2026-11-04 的口径；
 *   · 赏金档（缺省）→ 返回 null，让调用方回落到**面板并集**（confrontGroups 的行 key 并集）——
 *     实测赏金档 R2/R3 的「官方 key ∩ 面板」= 0，用官方集合当闸门会把该档的子单 / 商店 / bot 全部判死；
 *   · 取不到 isConfrontRule（老对局 / 直测 / 非对抗）→ 沿用官方优先的旧行为。
 * @param {object} m
 * @returns {Set<string>|null}
 */
function officialForRule(m) {
  if (!m) return null;
  const rule = typeof m.isConfrontRule === 'function' ? m.isConfrontRule() === true : true;
  return rule ? officialSpawnKeys(m) : null;
}

/**
 * 本回合**合法可投放**的 key 集合 —— 卡池与提交校验的**唯一**判据（复验踩过的坑：买得到的卡必须交得上）。
 * 按规则档分流（officialForRule）：
 *   · 对抗档 = 本回合官方出怪（`m._roundOfficialSpawns`，业主 2026-11-04 口径）；
 *   · 赏金档 / 没有快照 = `confrontGroups()` 的行 key 并集（面板并集；赏金档实测官方 key ∩ 面板 = 0）。
 * `submitConfront` 的 `_confrontMember` 与 monsterShop 的发牌 / 购买 / 投放都调这一个函数。
 *
 * 返回 null = 两个来源都取不到（match 上没有 confrontGroups / 它抛异常）= 不做闸门（旧行为不受影响）。
 * 回落路径的缓存挂在 match 上、以 groups 数组的**引用**为键：`confrontGroups()` 按「回合|倍率」重算时会换新数组，
 * 引用一变缓存自动失效（官方快照路径每次现算，键少、成本可忽略）。
 * @param {object} m
 * @returns {Set<string>|null}
 */
export function legalKeys(m) {
  const official = officialForRule(m);
  if (official) return official;
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

/**
 * 本回合「可投放的怪物」全集：**对抗档 = 本回合官方出怪**（业主 2026-11-04）；**赏金档 = 面板并集**
 * （confrontGroups 的行 key 并集，同一套分流见 officialForRule —— 与 legalKeys 同源，买得到的一定交得上）；
 * 两者都取不到才退回官方全池。
 * @param {object} m
 * @returns {string[]} 排序后的 key（顺序稳定，便于复现）
 */
export function monsterCardKeys(m) {
  const official = officialForRule(m);
  if (official) return [...official].sort();
  const keys = new Set();
  if (typeof m.confrontGroups === 'function') {
    for (const g of m.confrontGroups() || []) {
      for (const r of (g && g.rows) || []) if (r && typeof r.key === 'string' && r.key) keys.add(r.key);
    }
  }
  if (!keys.size) for (const k of confrontPool(m.data && m.data.factions)) keys.add(k);
  return [...keys].sort();
}

/**
 * 这一回合**该队**的存活攻方人数。
 * **不再是份数的乘数**（2026-11-04 业主裁决：卡池份数 = 官方只数 × 1.5，按队、不乘人数 —— 见 buildMonsterPool）；
 * 保留导出是因为它是「该队有几个攻方」的通用问法，改口径前其它调用方可能还在用。
 * 只用 `m.attackingTeam` 与 `m.teamIdOf` 现算（座位表取 `m.alivePlayers()`，没有就用 `m.order` 过滤）：
 * 非攻防回合（`attackingTeam == null`）、老对局、取不到座位表 → 1（老行为）。
 * @param {object} m
 * @returns {number} >= 1
 */
export function teamAttackerCount(m) {
  if (!m || m.attackingTeam == null || typeof m.teamIdOf !== 'function') return 1;
  const list = typeof m.alivePlayers === 'function'
    ? m.alivePlayers()
    : (Array.isArray(m.order) ? m.order.filter((p) => p && p.alive !== false && p.left !== true) : []);
  let n = 0;
  for (const ps of Array.isArray(list) ? list : []) if (m.teamIdOf(ps) === m.attackingTeam) n += 1;
  return Math.max(1, n);
}

/**
 * 用本局数据建一张怪物卡池（shared 怪物模式每队一张，solo 每人一张 —— 见 match/match/confront.js 的
 * finishConfrontTargets 与 monsterShop.js 的 monsterPoolFor）。
 * 份数口径（业主 2026-11-04 裁决，**只看官方只数**）：`cap = 官方该回合该 key 的合计只数 × 1.5`（至少 1）。
 *   · **按队算**：shared 模式下同队攻方共用这一个池，份数不乘攻方人数（队友看到的是同一份库存，买走就少）；
 *   · **不再受阶位份数封顶**（旧的 `MONSTER_COPIES_BY_TIER` 只留在没有官方快照时的回落路径）；
 *   · 资金侧配套：每名攻方每回合拿到「官方波次价值 × 1.5 ÷ 攻方人数」的军费（confront.js grantMonsterFunds），
 *     两人合起来刚好买得下整池 —— 份数与钱同一个 1.5 口径。
 * `tier` 字段仍建在 entry 上（卡面阶 / 稀有度展示用），但它不再是份数上限。
 * 没有官方快照（boss 回合 / 老对局）时沿用旧的阶位份数。
 * @param {object} m Match 实例（只用 data / _roundOfficialSpawns / confrontGroups / confrontValueOf）
 * @returns {MonsterPool}
 */
export function buildMonsterPool(m) {
  const entries = [];
  if (!m) return new MonsterPool(entries);
  const enemies = (m.data && m.data.enemies) || {};
  const officialCounts = officialSpawnCounts(m);
  for (const key of monsterCardKeys(m)) {
    // 价格（本回合量纲）：与预算 / 波次价值 / 提交校验同一个函数
    const price = typeof m.confrontValueOf === 'function' ? Number(m.confrontValueOf(key)) : 0;
    if (!Number.isFinite(price) || price <= 0) continue;
    // 阶位（无倍率量纲）：怪物的固有稀有度，不随回合倍率跳档 —— 现在只作**展示 / 分档**用，不再是份数上限
    const rec = enemies[key] || null;
    const base = rec ? confrontValue(rec) : price;
    const tier = monsterTierOf(base);
    const officialCount = officialCounts ? officialCounts.get(key) : undefined;
    // 份数（业主 2026-11-04 裁决）：官方该回合只数 × 1.5（按队，**不乘攻方人数、不受阶位份数上限约束**）。
    // 官方快照里没有这只怪（赏金档的面板怪物 —— 该档合法集合 = 面板并集，见 officialForRule / legalKeys）
    // → 回落到阶位份数表（至少 1），否则那一档的商店每张卡都只有 1 份。
    const cap = officialCount != null
      ? Math.max(1, Math.round(officialCount * MONSTER_POOL_COPIES_SHARE))
      : (MONSTER_COPIES_BY_TIER[tier] || 1);
    entries.push({ key, cost: price, tier, cap });
  }
  return new MonsterPool(entries);
}
