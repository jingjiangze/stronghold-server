// plugins/mota/server/match/monsterPool.js — 怪物卡池：把「对抗可投放的敌人」做成干员卡池形态。
// 价格 = confrontValueOf(enemyKey)（与波次价值同一量纲）；阶位按 attrPower 分档（展示 / 发牌阶位上限）；
// 份数按官方卫戍干员商店的 poolCopies 等比换算（业主 2026-11-05，见 MONSTER_COPIES_BY_TIER）。
// 单位是「一只怪」（spawn count:1），不是整波。
//
// 与 pool.js 的 SharedPool 同构（cap / left / take / give / snapshot / totalLeft / 份数加权 roll）：
// 买走一份就少一份。池的归属随 `m.monsterMode`：shared（默认）= 同队攻方共用一个池（见
// match/match/confront.js 的 finishConfrontTargets / this.monsterPools）；solo = 每人一个池（只有该队
// 第一位存活攻方持有投放权，见 monsterShop.js 的 monsterPoolFor）。
//
// 卡池来源（业主 2026-11-05 裁决「放宽卡池来源，但相关规则参考官方卫戍，如怪物星级商店概率等，等比换算」）：
//   · **池 = data/enemies.json 的全部条目**（491 条；排除 `tokenOnly: true` 的 8 条 ⇒ 483 只），不筛阵营、不筛官方波次。
//     旧口径（2026-11-04）= 本回合官方出怪 / 面板并集，实测让 7 个阵营在池里 0 只（池层面）。
//   · 「本回合官方出怪优先」的语义保留为**成员保证**：官方波次的 key 一定在池里（本回合快照来自同一份 data）；
//     快照里有、data 里没有的 key 也补进池（防御：宁可多一只，不丢官方可投放怪）。
//   · **合法性（能不能提交）仍按规则档分流，与池来源解耦**：`legalKeys` 保持不变 —— 对抗档 = 本回合官方出怪、
//     赏金档 = 面板并集；`_confrontMember` 与商店的发牌 / 购买 / 投放都调它（业主 2026-11-05「不改提交合法性」）。
//     所以「池里能抽到」≠「一定交得上」：后者仍只看 legalKeys。
//
// 阶位口径（2026-11-04 并入 242 条肉鸽怪后重切，6 档；切点本身沿用，未重算）：
//   · 切点 MONSTER_TIER_BANDS 是 2026-11-04 在**基线池子集**（confrontPool(data/factions.json) ∩ data/enemies.json
//     = 120 只）上按 attrPower 六等分位定出来的（全表有 boss 的 attrPower 离群 2.5M，会把分位拉坏）；
//     2026-11-05 池放宽到 483 只后业主口径是「按现有的 6 档切点分档」，所以**切点不动**。
//   · 分位口径用 attrPower（官方强度式：atk×5 + maxHp + def×3 + res×3，见 data/enemies.json 的 attrPower）；
//     confrontValue = round(stat / 120)，两者只差 ÷120 与取整，所以切点按 attrPower 算完后 ÷120 存**基础价量纲**。
//     实测切点 [39, 57, 87, 134, 176]（≈ 每 1/6 一档）；旧基线池每档 20/20/21/20/19/20 只。
//   · 放宽到 483 只后**实测每档 58 / 60 / 69 / 74 / 49 / 173 只**（高阶偏多：491 条含 BOSS / 肉鸽精英的 attrPower
//     离群值）。阶位只用于展示与「发牌阶位上限 = 商店等级」，偏斜不影响可玩性。
//   · 旧切点 [25, 50, 100, 200]（2026-11-03）在同一个池子集上实测 5 / 26 / 34 / 40 / 15 —— 严重偏斜，已废弃。
//   · 定阶只看**基础价**，不看本回合价：本回合价随 gd.enemyScale 的 hp/atk 倍率整体上浮，同一只怪会在后期
//     跳档；阶位是怪物的固有稀有度（与「这一回合卖多少钱」分开）。
//   · 卡面价格仍由 m.confrontValueOf(key) 取（本回合量纲，含特性档位分）—— 预算判据因此与既有逻辑同尺度。
//
// 依赖方向：本文件 import 了 match/match/confront.js 的两个**纯函数**（confrontPool / confrontValue）；
// confront.js 又 import 本文件，构成 ESM 循环导入。两边都只在函数体内取用对方的导出（函数声明会被提升），
// 模块顶层不互相求值，因此安全。

import { confrontPool, confrontValue } from './match/confront.js';

/**
 * 价格分档切点（基础价口径，见文件头）。`cost > band` 逐级 +1 ⇒ 6 档（`length + 1`）。
 * 池子集 120 只上按 attrPower 六等分位、÷120 取整：20/40/60/80/100 位 = 4730/6840/10390/16100/21150。
 * @type {readonly number[]}
 */
export const MONSTER_TIER_BANDS = Object.freeze([39, 57, 87, 134, 176]);

/**
 * 官方卫戍**干员商店**每张棋子的库存份数（`data/config.json` → `economy.poolCopies`，实测原值）。
 * 这是「等比换算」的基准（业主 2026-11-05），不要再手改 —— 换算表见 MONSTER_COPIES_BY_TIER。
 * @type {Readonly<Record<number, number>>}
 */
export const MONSTER_OFFICIAL_COPIES_BY_TIER = Object.freeze({ 1: 12, 2: 14, 3: 18, 4: 16, 5: 8, 6: 5 });

/** 干员池 key 数（`data/chess.json` 的条数，实测 266 —— 等比换算的分母）。 */
export const MONSTER_CHESS_POOL_SIZE = 266;
/** 怪物池 key 数（`data/enemies.json` 的条数，实测 491 —— 业主裁决的等比换算是以 491 为基数）。 */
export const MONSTER_ENEMY_POOL_SIZE = 491;
/**
 * 怪物份数的**等比缩放系数** = 怪物池 key 数 ÷ 干员池 key 数 = 491 / 266 = 1.845865…，保留 3 位 → **1.846**。
 * 推导：`Math.round((MONSTER_ENEMY_POOL_SIZE / MONSTER_CHESS_POOL_SIZE) * 1000) / 1000`。
 */
export const MONSTER_COPY_SCALE = 1.846;

/**
 * 每阶的份数（**库存 cap 的唯一公式**，业主 2026-11-05）：
 * `MONSTER_COPIES_BY_TIER[t] = max(1, round(MONSTER_OFFICIAL_COPIES_BY_TIER[t] × MONSTER_COPY_SCALE))`。
 * 实测（scale 1.846）：tier1→22、2→26、3→33、4→30、5→15、6→9（6 档全覆盖）。
 * **旧口径「份数 = 官方该回合只数 × 1.5」已废弃**（它只对官方波次成立，池放宽到全表后失效）；
 * 1.5 倍出怪量改由**军费**保证：每名攻方每回合拿到「官方波次价值 × 1.5 ÷ 攻方人数」
 * （match/match/confront.js 的 grantMonsterFunds / CONFRONT_VOLUME_SHARE），库存不再是它的约束。
 * @type {Readonly<Record<number, number>>}
 */
export const MONSTER_COPIES_BY_TIER = Object.freeze(
  Object.fromEntries(Object.entries(MONSTER_OFFICIAL_COPIES_BY_TIER).map(([tier, copies]) => [
    Number(tier),
    Math.max(1, Math.round(copies * MONSTER_COPY_SCALE)),
  ])),
);

/**
 * **旧口径的 1.5 常量，现已不参与库存公式**（业主 2026-11-05：份数改按官方 poolCopies 等比换算）。
 * 保留导出是为了不破坏外部引用；「1.5 × 出怪量」现在只由**资金口径**保证 ——
 * 与 match/match/confront.js 的 `CONFRONT_VOLUME_SHARE = 1.5` 同一个数（军费 = 波次价值 × 1.5）。
 */
export const MONSTER_POOL_COPIES_SHARE = 1.5;

/** 最高阶（= 分档切点数 + 1；当前 5 个切点 ⇒ 6 档）。 */
export const MONSTER_MAX_TIER = MONSTER_TIER_BANDS.length + 1;

/**
 * 价格 → 阶位（1..MONSTER_MAX_TIER）。非有限 / 非正数一律按 tier1 处理（与 confrontValue 的下限 1 一致）。
 * @param {number} cost 基础价（confrontValue 口径；不是混了本回合倍率的价格）
 * @returns {number} 1..6
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
 * 两个用途（2026-11-05 起职责拆分）：
 *   · `legalKeys` 的**规则闸门**（对抗档 = 本回合官方出怪 —— 提交合法性，未放宽）；
 *   · `monsterPoolKeys` 的**成员保证**（官方 key 一定进池，见那里的注释）。
 * boss 回合 / 老对局 / 未进 ROUND_START 时没有快照 → null。
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
 * 本回合官方出怪里每个 key 的**合计只数**。2026-11-05 起**不再是份数口径**（份数改按官方 poolCopies 等比换算）；
 * 现在只给盟约用：monsterBonds.js 的「增援」以「官方只数 × 1.5」为基准、`factionPoolCounts` 按官方只数加权。
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
 * 合法性闸门的规则分流（**只管能不能提交 / 能不能买，不再决定池子来源**，2026-11-05）：
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
 * 本回合**合法可投放**（= 可提交 / 可购买 / 可投放）的 key 集合 —— **提交合法性**的唯一判据。
 * 业主 2026-11-05：「只放宽池/库存，不改提交合法性」⇒ 本函数与 2026-11-04 的规则分流**逐字节不变**。
 * 按规则档分流（officialForRule）：
 *   · 对抗档 = 本回合官方出怪（`m._roundOfficialSpawns`，业主 2026-11-04 口径）；
 *   · 赏金档 / 没有快照 = `confrontGroups()` 的行 key 并集（面板并集；赏金档实测官方 key ∩ 面板 = 0）。
 * `submitConfront` 的 `_confrontMember` 与 monsterShop 的购买 / 投放都调这一个函数。
 *
 * ⚠ 池来源已放宽到 data/enemies.json 全表（monsterPoolKeys），但**本函数不跟着放宽**：
 *   「池里抽得到」≠「一定交得上」，能否提交仍只看这里（业主裁决）。
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
 * 本回合「可投放的怪物」全集（**2026-11-04 口径，保持不变**）：对抗档 = 本回合官方出怪；赏金档 = 面板并集
 * （confrontGroups 的行 key 并集，同一套分流见 officialForRule）；两者都取不到才退回官方全池。
 * ⚠ **它不是卡池来源**（卡池见 `monsterPoolKeys`，2026-11-05 已放宽到 data/enemies.json 全表）。
 * 保留它是因为 monsterBonds.js 拿它做**盟约阈值的分母**（`factionPoolCounts`：「本回合可投放池里该阵营的只数」）——
 * 阈值因此仍是**按回合 / 按面板**的小分母（[1,2,3] 量级），不随全表 483 只膨胀（那会把大阵营的 1 阶推到
 * 16~18 层、实际永远打不到）。改这里会一并改盟约数值，属于独立裁决，不在本次放宽池子的范围内。
 * @param {object} m
 * @returns {string[]} 排序后的 key（顺序稳定，便于复现）
 */
export function monsterCardKeys(m) {
  const official = officialForRule(m);
  if (official) return [...official].sort();
  const keys = new Set();
  if (m && typeof m.confrontGroups === 'function') {
    for (const g of m.confrontGroups() || []) {
      for (const r of (g && g.rows) || []) if (r && typeof r.key === 'string' && r.key) keys.add(r.key);
    }
  }
  if (!keys.size) for (const k of confrontPool(m && m.data && m.data.factions)) keys.add(k);
  return [...keys].sort();
}

/**
 * **卡池的 key 全集**（`buildMonsterPool` 的遍历源）。业主 2026-11-05「放宽卡池来源」：
 *   · 主来源 = **`data/enemies.json` 的全部条目**（491 条；排除 `tokenOnly: true` 的 8 条 ⇒ 483 只），
 *     不筛阵营、不筛官方波次 —— 旧口径只取「本回合官方出怪 / 面板并集」，实测 7 个阵营在池里 0 只。
 *   · 「本回合官方出怪优先」保留为**成员保证**：`_roundOfficialSpawns` 的 key **一定**在池里
 *     （本回合快照来自同一份 data；若某 key 被 tokenOnly 过滤掉或 data 里没有，也补进来 —— 官方怪不能买不到）。
 *   · data 不可用（直测 / 精简 stub）时回落旧路径：面板并集 → `confrontPool(data/factions.json)`，绝不返回空池。
 * ⚠ 本函数只管**池 / 库存**；能不能提交仍看 `legalKeys`（业主裁决：不改提交合法性）。
 * ⚠ 不要用它替换 `monsterCardKeys`：后者是盟约阈值的分母（见那里的注释），两者的分母口径必须分开。
 * @param {object} m
 * @returns {string[]} 排序后的 key（顺序稳定，便于复现）
 */
export function monsterPoolKeys(m) {
  const keys = new Set();
  // 1) data/enemies.json 全表（tokenOnly 的召唤物 / 部件不单独建条目）
  const enemies = (m && m.data && m.data.enemies) || {};
  for (const key of Object.keys(enemies)) {
    const rec = enemies[key];
    if (!rec || rec.tokenOnly === true) continue;
    keys.add(key);
  }
  // 2) 本回合官方出怪的 key 必须有（官方优先 = 成员保证；也覆盖 tokenOnly / data 缺条目的边角）
  const official = officialSpawnKeys(m);
  if (official) for (const key of official) keys.add(key);
  // 3) data 不可用的回落（面板并集 → confrontPool）
  if (!keys.size) {
    if (m && typeof m.confrontGroups === 'function') {
      for (const g of m.confrontGroups() || []) {
        for (const r of (g && g.rows) || []) if (r && typeof r.key === 'string' && r.key) keys.add(r.key);
      }
    }
    if (!keys.size) for (const k of confrontPool(m && m.data && m.data.factions)) keys.add(k);
  }
  return [...keys].sort();
}

/**
 * 这一回合**该队**的存活攻方人数。
 * **不是份数的乘数**（份数 2026-11-05 起只由阶位份数表决定，与人数 / 官方只数都无关 —— 见 buildMonsterPool）；
 * 保留导出是因为它是「该队有几个攻方」的通用问法（军费按它摊：grantMonsterFunds），改口径前其它调用方可能还在用。
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
 * 份数口径（业主 2026-11-05 裁决「参考官方卫戍，等比换算」）：`cap = MONSTER_COPIES_BY_TIER[阶位]`
 *   （= `max(1, round(官方 poolCopies[阶位] × MONSTER_COPY_SCALE))`，见常量处的推导与实测值）。
 *   · **旧口径「份数 = 官方该回合只数 × 1.5」已替换**（它只对官方波次成立，池放宽到 483 只后失效）；
 *   · **1.5 × 出怪量改由军费保证**：每名攻方每回合拿到「官方波次价值 × 1.5 ÷ 攻方人数」
 *     （match/match/confront.js 的 grantMonsterFunds / CONFRONT_VOLUME_SHARE），库存不再是它的约束；
 *   · **按队算**：shared 模式下同队攻方共用这一个池，份数不乘攻方人数（队友看到的是同一份库存，买走就少）；
 *   · **与「这一回合官方出了几只」无关**：池每回合重建（finishConfrontTargets），库存每回合回到满值。
 * `tier` 字段建在 entry 上：卡面阶位展示 + **发牌阶位上限**（monsterShop 的 dealSlots/refillSlot 只抽
 * `tier ≤ 商店等级` 的卡，与干员商店 `maxTier = shop.level` 同构）。
 * @param {object} m Match 实例（只用 data / _roundOfficialSpawns / confrontGroups / confrontValueOf）
 * @returns {MonsterPool}
 */
export function buildMonsterPool(m) {
  const entries = [];
  if (!m) return new MonsterPool(entries);
  const enemies = (m.data && m.data.enemies) || {};
  for (const key of monsterPoolKeys(m)) {
    // 价格（本回合量纲）：与预算 / 波次价值 / 提交校验同一个函数
    const price = typeof m.confrontValueOf === 'function' ? Number(m.confrontValueOf(key)) : 0;
    if (!Number.isFinite(price) || price <= 0) continue;
    // 阶位（无倍率量纲）：怪物的固有稀有度，不随回合倍率跳档 —— 展示 + 发牌阶位上限
    const rec = enemies[key] || null;
    const base = rec ? confrontValue(rec) : price;
    const tier = monsterTierOf(base);
    // 份数（业主 2026-11-05）：官方干员商店 poolCopies 的等比换算值；与官方只数 / 攻方人数无关。
    // 缺表项（未来加档）兜底 1 份，绝不出现 0 份的卡。
    const cap = MONSTER_COPIES_BY_TIER[tier] || 1;
    entries.push({ key, cost: price, tier, cap });
  }
  return new MonsterPool(entries);
}
