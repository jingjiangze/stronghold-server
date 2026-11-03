// plugins/mota/server/match/monsterPool.js — 怪物卡池：把「对抗可投放的敌人」做成干员卡池形态。
// 价格 = confrontValueOf(enemyKey)（与波次价值同一量纲）；阶位按价格分档；份数按阶位递减。
// 单位是「一只怪」（spawn count:1），不是整波。
//
// 与 pool.js 的 SharedPool 同构（cap / left / take / give / snapshot / totalLeft / 份数加权 roll）：
// 买走一份就少一份，同队攻方共用一个池（见 match/match/confront.js 的 enterConfront / this.monsterPools）。
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

/** 每阶的份数（业主口径：阶越高越稀有）。tier1 → 8 … tier5 → 1。 */
export const MONSTER_COPIES_BY_TIER = Object.freeze({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 1 });

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
 * 本局「可投放的怪物」全集 = 本回合面板（confrontGroups）给出的那些 key。
 * 用 groups 而不是裸的 confrontPool 有两个理由：
 *   ① 合法性 —— submitConfront 的 `_confrontMember` 只认 groups 的并集，买到的卡必须能提交；
 *   ② 回合闸门 —— 对抗档的 groups 已经过 confrontSeenKeys（只给第 1..N 回合真正出过的怪）。
 * groups 取不到时（非对抗档 / 早期回合没建波）退回官方全池。
 * @param {object} m
 * @returns {string[]} 排序后的 key（顺序稳定，便于复现）
 */
function monsterCardKeys(m) {
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
 * 用本局数据建一张怪物卡池（每队一张，见 match/match/confront.js 的 enterConfront）。
 * @param {object} m Match 实例（只用 data / confrontGroups / confrontValueOf）
 * @returns {MonsterPool}
 */
export function buildMonsterPool(m) {
  const entries = [];
  if (!m) return new MonsterPool(entries);
  const enemies = (m.data && m.data.enemies) || {};
  for (const key of monsterCardKeys(m)) {
    // 价格（本回合量纲）：与预算 / 波次价值 / 提交校验同一个函数
    const price = typeof m.confrontValueOf === 'function' ? Number(m.confrontValueOf(key)) : 0;
    if (!Number.isFinite(price) || price <= 0) continue;
    // 阶位（无倍率量纲）：怪物的固有稀有度，不随回合倍率跳档
    const rec = enemies[key] || null;
    const base = rec ? confrontValue(rec) : price;
    const tier = monsterTierOf(base);
    entries.push({ key, cost: price, tier, cap: MONSTER_COPIES_BY_TIER[tier] || 1 });
  }
  return new MonsterPool(entries);
}
