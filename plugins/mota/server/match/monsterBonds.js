// plugins/mota/server/match/monsterBonds.js — 怪物方的**独立盟约**（攻方专属，业主 2026-11-04 口径）。
//
// 业主口径（2026-11-04）：**攻方完全没有干员盟约、没有干员商店，只有怪物方的独立盟约** —— 7 条按类型 + 3 条通用，
// 层数制，**只影响本回合**。所以本模块与 `bondsMeta.js`（干员盟约：整局持久、ps.layers / ps.bonds 被 invariants.js
// 钉死）是**平行结构**，两套数据 / 状态 / installer 一律不共用：
//   · 状态 `m.monsterBonds` = Map<key, Record<bondId, layers>>，key 与怪物池同口径（monsterMode === 'solo' ? playerId
//     : teamId，见 monsterPool.js monsterPoolFor）—— 共享池时同队两名攻方的层数合成一份；
//   · 生命周期**每回合重置**（match/match/phases.js 的回合边界调 closeMonsterBondRound）；
//   · 涨层 = `monsterShop.js` 的 placeMonster / buyMonster（只算攻方投放的怪，官方波次不算），dropMonster 回退；
//   · 效果 = spawn 的 `mods` 乘区（hpMul / atkMul / defMul / resMul / speedMul / aspdMul），在 match/match/confront.js 的
//     applyConfront（投放怪）与 _confrontBossSpawns（事件期 boss）合并；资金类（增援 / 回收）在回合收尾发放。
//
// 【aspdMul（攻速乘区）】2026-11-04 起两棵 sim 树的 `spawns.js`（`server/sim/battle/spawns.js` 与
// `plugins/mota/server/sim/battle/spawns.js`）的 enemy mods 都认 `aspdMul`：`aspd = def.aspd * (m.aspdMul ?? 1)`，
// 下游 `units.js` 的 `clamp(..., ASPD_MIN, ASPD_MAX)` 照旧兜底。**两棵树必须同步改**，否则客户端与服务端结果会漂。
//
// 守卫：`m.monsterShopOn === false`（opts.monsterShop === false / 非对抗局）时**整段不跑** —— 不建状态、不发帧、
// 不发放资金，旧对局的行为与字节完全不变。

import { officialSpawnCounts } from './monsterPool.js';
// 怪物资金账户的唯一入口（业主 2026-11-04 裁决 2）：shared 落队级账户、solo 落个人账户。
// 与 monsterShop.js 互为 import（它 import 本文件的 addMonsterBonds / monsterBondView）：两边都只在函数体内取用，
// 模块顶层不互相求值（与 monsterPool ↔ match/confront 的循环同一口径），因此安全。
import { addMonsterFundsTo } from './monsterShop.js';

/** 层数阈值（tier1 / tier2 / tier3）。层数 = 该类型**本回合投放过的只数**；常量可调。 */
export const MONSTER_BOND_THRESHOLDS = [2, 4, 6];
/** 会战只看「同队有几名攻方投过」（2V2 上限 2 人 / 4V4 上限 4 人），阈值因此单独一张。 */
export const MONSTER_BOND_CONCERT_THRESHOLDS = [2, 3, 4];
/** 增援：投放只数超过「官方只数 × 1.5」的部分才算增援（与 monsterPool.js 的池口径、confront.js 的
 *  CONFRONT_VOLUME_SHARE 同一个 1.5）。 */
export const MONSTER_BOND_SURPLUS_SHARE = 1.5;
/** 增援：超出部分按**单价 × 20%** 返还怪物资金。 */
export const MONSTER_BOND_SURPLUS_REFUND = 0.2;
/** 回收：漏过的投放怪每只的**既有奖励**（与 match/match/settle.js 的 MONSTER_LEAK_REWARD 同值，两处要一起改）。
 *  settle 已经在发这一笔，所以本盟约只发「额外 +50%」（下面那个系数），不重复发全额。 */
export const MONSTER_LEAK_REWARD_BASE = 4;
/** 回收：在 settle 既有发奖之上再 +50%。 */
export const MONSTER_BOND_LEAK_EXTRA = 0.5;
/** 资金类盟约的层数档倍率（下标 = tier，0 = 未达一阶 = 不发钱）。 */
export const MONSTER_BOND_TIER_MUL = [0, 1, 1.5, 2];
/** 会战的固定加成（同队两名攻方都投过 ≥1 只即生效）。 */
export const MONSTER_BOND_CONCERT_BONUS = 0.05;

/** 隐形判据的 tag 白名单（enemies.json 现在的隐形怪都靠 acType = INVISIBLE；tag 只是兜底口径）。 */
const STEALTH_TAGS = new Set(['invisible', 'stealth', 'cloak']);

const hasTag = (enemyRec, tag) => {
  const tags = Array.isArray(enemyRec && enemyRec.tags) ? enemyRec.tags : [];
  return tags.some((t) => String(t).toLowerCase() === tag);
};

/**
 * 10 条盟约的固定定义（业主口径：7 条按类型 + 3 条通用）。`classify` 是**纯函数**，只看敌人数据
 * （data/enemies.json 的记录：`isFlyEnemy` / `acType` / `rank` / `tags`），不看本回合抽到哪个 confrontGroups
 * （那是「本回合抽到的组」，与怪物本身是什么类型无关）；`classify: null` = 通用条，由投放统计算出层数。
 */
export const MONSTER_BOND_DEFS = [
  // ---- 7 条按类型 ----
  { id: 'air', name: '空袭', thresholds: MONSTER_BOND_THRESHOLDS, classify: (e) => e.isFlyEnemy === true },
  // 潜伏：acType = INVISIBLE（data/enemies.json 的隐形怪，如 enemy_1009_lurker）；tag 兜底见 STEALTH_TAGS
  { id: 'stealth', name: '潜伏', thresholds: MONSTER_BOND_THRESHOLDS, classify: (e) => e.acType === 'INVISIBLE' || hasTag(e, 'invisible') || hasTag(e, 'stealth') || hasTag(e, 'cloak') },
  { id: 'refract', name: '折射', thresholds: MONSTER_BOND_THRESHOLDS, classify: (e) => e.acType === 'REFLECTION' },
  { id: 'element', name: '元素', thresholds: MONSTER_BOND_THRESHOLDS, classify: (e) => e.acType === 'ELEMENT' },
  { id: 'dot', name: '灼蚀', thresholds: MONSTER_BOND_THRESHOLDS, classify: (e) => e.acType === 'DOT' },
  // 频次：acType = TIMES。效果走攻速乘区 aspdMul（攻速快 = 更难，两棵 sim 树都认，见文件头）
  { id: 'tempo', name: '频次', thresholds: MONSTER_BOND_THRESHOLDS, classify: (e) => e.acType === 'TIMES' },
  { id: 'elite', name: '特化', thresholds: MONSTER_BOND_THRESHOLDS, classify: (e) => e.rank === 'ELITE' || e.rank === 'BOSS' },
  // ---- 3 条通用 ----
  // 增援：投放只数 ≥ 官方只数 × 1.5（层数 = 投放只数），效果走资金返还
  { id: 'reinforce', name: '增援', thresholds: MONSTER_BOND_THRESHOLDS, classify: null, kind: 'funds' },
  // 会战：同队两名攻方都投放 ≥1 只（层数 = 投过的攻方人数），效果走全队速度乘区
  { id: 'concert', name: '会战', thresholds: MONSTER_BOND_CONCERT_THRESHOLDS, classify: null },
  // 回收：本回合有投放怪漏过（层数 = 漏过只数），效果走资金返还（额外 +50%）
  { id: 'recover', name: '回收', thresholds: MONSTER_BOND_THRESHOLDS, classify: null, kind: 'funds' },
];

/**
 * 效果表（乘区）：每条的「每层增量」与单条上限。`key` 只允许 spawn mods 认的六个键
 * （server/sim/battle/spawns.js 的 `mm()`：hpMul / atkMul / defMul / resMul / speedMul / aspdMul）。
 * 乘数语义 = 1 + Δ（sim 里 `base.maxHp * m.hpMul`），所以 Δ 是**加法叠加**的百分比。
 */
export const MONSTER_BOND_MODS = {
  air: { key: 'speedMul', per: 0.05, cap: 0.25 },
  stealth: { key: 'hpMul', per: 0.04, cap: 0.5 },
  refract: { key: 'defMul', per: 0.06, cap: 0.6 },
  element: { key: 'atkMul', per: 0.04, cap: 0.5 },
  dot: { key: 'hpMul', per: 0.03, cap: 0.5 },
  // 频次：攻速快 = 更难（每层 +5% 攻速，上限与其它条一致）
  tempo: { key: 'aspdMul', per: 0.05, cap: 0.5 },
  elite: { key: 'atkMul', per: 0.03, cap: 0.5 },
};

const defById = new Map(MONSTER_BOND_DEFS.map((d) => [d.id, d]));

/** 某条盟约的阈值表（未知 id 用默认 2/4/6）。 */
function thresholdsOf(id) {
  const d = defById.get(id);
  return d && Array.isArray(d.thresholds) && d.thresholds.length ? d.thresholds : MONSTER_BOND_THRESHOLDS;
}

/**
 * 层数 → 阶（tier）：达到几个阈值就是几阶（0 = 未激活）。纯函数。
 * @param {number} layers @param {number[]} [thresholds]
 * @returns {number} 0..thresholds.length
 */
export function monsterBondTier(layers, thresholds = MONSTER_BOND_THRESHOLDS) {
  const n = Math.max(0, Number(layers) || 0);
  let tier = 0;
  for (const th of thresholds) if (Number.isFinite(th) && n >= th) tier += 1;
  return tier;
}

/**
 * 攻方回合的角色判据（三处服务端闸门共用）：本回合是攻守回合**且**这个席位属于进攻方。
 * R14/R15 这类 `attackingTeam == null` 的回合 `m.isAttacker` 自带保护（infra.js），这里再用 `isRoleRound()`
 * 兜一道 —— **不要**改写成 `!isDefender`（非攻守回合两者都是 false）。
 * @param {object} m @param {object} ps
 * @returns {boolean}
 */
export function isAttackerRound(m, ps) {
  if (!m || !ps) return false;
  if (typeof m.isRoleRound !== 'function' || m.isRoleRound() !== true) return false;
  return typeof m.isAttacker === 'function' && m.isAttacker(ps) === true;
}

/**
 * 盟约状态的归属键：与怪物池（monsterPool.js monsterPoolFor）**同口径** ——
 * solo 按人（playerId）、shared 按队（teamId）。取不到时回落 0（与池的 `: 0` 一致）。
 */
export function monsterBondKey(m, ps) {
  if (!m || !ps) return null;
  if (m.monsterMode === 'solo') return ps.playerId != null ? ps.playerId : 0;
  return typeof m.teamIdOf === 'function' ? m.teamIdOf(ps) : 0;
}

/** 全席位（m.order 是数组；StubMatch / 直测可能只给 Map）。 */
function allPlayers(m) {
  if (Array.isArray(m && m.order)) return m.order;
  if (m && m.players instanceof Map) return [...m.players.values()];
  return [];
}

/**
 * 一只怪属于哪几条**类型**盟约（可同时属于多条，例如飞行 ELITE）。纯函数，只看敌人数据。
 * @param {object} gd GameData（用 gd.enemy(key)）/ 或 { enemy(key) }
 * @param {string} enemyKey
 * @returns {string[]} 盟约 id 列表（顺序 = MONSTER_BOND_DEFS）
 */
export function monsterBondIdsOf(gd, enemyKey) {
  let rec = null;
  try { rec = gd && typeof gd.enemy === 'function' ? gd.enemy(enemyKey) : null; } catch { rec = null; }
  if (!rec) return [];
  const out = [];
  for (const def of MONSTER_BOND_DEFS) if (typeof def.classify === 'function' && def.classify(rec)) out.push(def.id);
  return out;
}

/** 本回合的盟约记录（懒建）。空记录 = `{ round, layers:{}, placed:0, cost:0, byPlayer:{} }`。 */
export function monsterBondState(m, ps) {
  const key = monsterBondKey(m, ps);
  if (key == null) return null;
  if (!(m.monsterBonds instanceof Map)) m.monsterBonds = new Map();
  let st = m.monsterBonds.get(key);
  if (!st) {
    st = { round: Number(m.round) || 0, layers: {}, placed: 0, cost: 0, byPlayer: {} };
    m.monsterBonds.set(key, st);
  }
  return st;
}

/** 某席位当前的盟约记录（没有就 null，**不建**）。 */
function recordOf(m, ps) {
  if (!m || !(m.monsterBonds instanceof Map)) return null;
  const key = monsterBondKey(m, ps);
  return key == null ? null : (m.monsterBonds.get(key) || null);
}

/**
 * 投放涨层（monsterShop.js 的 placeMonster / buyMonster 成功后调用）：类型盟约各 + 投放只数，
 * 通用「增援」也按投放只数累加；同时记下总只数 / 总花费 / 每名攻方投了几只（会战与资金分摊要用）。
 * 只算**攻方投放的怪**（官方波次不进这里）。
 * @param {object} m @param {object} ps
 * @param {{ enemyKey: string, count?: number, price?: number }} placement
 * @returns {{ ids: string[], layers: object }|null} null = 商店关着 / 参数不对
 */
export function addMonsterBonds(m, ps, { enemyKey, count = 1, price = 0 } = {}) {
  if (!m || m.monsterShopOn !== true || !ps) return null;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!(n > 0)) return null;
  const st = monsterBondState(m, ps);
  if (!st) return null;
  const ids = monsterBondIdsOf(m.gd, enemyKey);
  for (const id of ids) st.layers[id] = Math.max(0, Number(st.layers[id]) || 0) + n;
  st.layers.reinforce = Math.max(0, Number(st.layers.reinforce) || 0) + n;
  st.placed = Math.max(0, Number(st.placed) || 0) + n;
  st.cost = Math.max(0, Number(st.cost) || 0) + Math.max(0, Number(price) || 0) * n;
  st.byPlayer[ps.playerId] = Math.max(0, Number(st.byPlayer[ps.playerId]) || 0) + n;
  return { ids, layers: st.layers };
}

/**
 * 撤回（monsterShop.js 的 dropMonster）：把那一只的层数 / 只数 / 花费退回去（下限 0）。**不追回已发的资金**
 * （资金只在回合收尾发一次，届时按最终口径算）。
 * @param {object} m @param {object} ps @param {string} enemyKey @param {number} [count]
 * @returns {object|null} 新的 layers
 */
export function dropMonsterBonds(m, ps, enemyKey, count = 1) {
  if (!m || m.monsterShopOn !== true || !ps) return null;
  const st = recordOf(m, ps);
  if (!st) return null;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!(n > 0)) return null;
  const ids = monsterBondIdsOf(m.gd, enemyKey);
  for (const id of ids.concat('reinforce')) st.layers[id] = Math.max(0, (Number(st.layers[id]) || 0) - n);
  const before = Math.max(0, Number(st.placed) || 0);
  const placed = Math.max(0, before - n);
  // 花费按撤回前的均价退（总价 / 总只数），退到 0 为止
  const avg = before > 0 ? (Number(st.cost) || 0) / before : 0;
  st.cost = Math.max(0, (Number(st.cost) || 0) - avg * n);
  st.placed = placed;
  const mine = Math.max(0, Number(st.byPlayer[ps.playerId]) || 0);
  st.byPlayer[ps.playerId] = Math.max(0, mine - n);
  return st.layers;
}

/**
 * 本回合「投放怪漏过 **by 归属键**」的快照（2026-11-04 复验修复 3：回收盟约恒发 0）。
 *
 * 为什么需要它：`settle()` 在**发完攻方奖励之后**就把 `this.fields` 清掉了（match/match/settle.js:238），
 * 而回合边界（match/match/phases.js:472 的 `closeMonsterBondRound`）必然在 settle 之后才跑 ——
 * 那时 `leaksForKey` 直接读 `this.fields` 只能读到 `[]`，实测「回收」盟约发放恒为 0。
 * 修法（B 的变体）：在 settle 里**清 fields 之前**把漏怪数钉成快照，回合边界只读这份快照。
 * 触发点不在 settle.js（不在本次改动清单内），而是 settle 已经在调的两个允许文件入口：
 *   · `monsterShop.js` 的 `addMonsterFundsTo`（settle 的击杀 / 漏过奖励经 Match.js 改道到这里；shared 模式）；
 *   · `match/match/confront.js` 的 `monsterShopOn` getter（settle.js:112 的闸门；两种怪物模式都会读，补 solo 的缺口）。
 * 快照只在 `this.fields` 非空、且至少一场结果已就绪时写：settle 清空之后（以及下一回合 PREP 里）的调用一律 no-op，
 * 不会把好数据覆盖成 0。
 * @param {object} m
 * @returns {{ round: number, leaks: Map<any, number> }|null} 当前生效的快照
 */
export function captureMonsterBondLeaks(m) {
  // 注意：**不能**读 m.monsterShopOn —— 本函数会从 monsterShopOn 之外的两个入口被调，
  // 而其中的 getter 若也调本函数就会自递归。这里用同一个判据的直接写法（与 confront.js 的 getter 等价）。
  if (!m || m.isVersus !== true || (m.opts && m.opts.monsterShop === false)) return null;
  if (!Array.isArray(m.fields) || !m.fields.length) return m._bondRoundStats || null;
  const byKey = new Map();
  const players = allPlayers(m);
  let saw = false;
  for (const f of m.fields) {
    // 与 settle.js 的 placedFieldResult 同一取源：优先 f.result，没有就问 battle.result()（clientCombat / 直测）
    let fr = f && f.result;
    if (!fr && f && f.battle && typeof f.battle.result === 'function') {
      try { fr = f.battle.result(); } catch { fr = null; }
    }
    if (!fr || typeof fr !== 'object') continue;
    saw = true;
    const leaks = fr.confrontLeaks;
    if (!leaks || typeof leaks !== 'object') continue;
    for (const [seatStr, v] of Object.entries(leaks)) {
      const owner = players.find((x) => x && x.seat === Number(seatStr));
      if (!owner) continue;
      const key = monsterBondKey(m, owner);
      if (key == null) continue;
      byKey.set(key, (byKey.get(key) || 0) + Math.max(0, Number(v) || 0));
    }
  }
  // 一场结果都还没出来（战斗进行中 / fields 只是占位）→ 不覆盖已钉好的快照，也不凭空写一份空快照
  if (!saw) return m._bondRoundStats || null;
  m._bondRoundStats = { round: Number(m.round) || 0, leaks: byKey };
  return m._bondRoundStats;
}

/**
 * 本回合某个归属键下**投放怪漏过**的只数：优先读 `captureMonsterBondLeaks` 钉下的快照（settle 清 fields 之前），
 * 没有快照（例如战斗还没打完）才回落到 `m.fields` 的 `confrontLeaks`（sim/battle/lifecycle.js 按**投放席位**汇总）。
 */
function leaksForKey(m, key) {
  const snap = m && m._bondRoundStats;
  if (snap && snap.leaks instanceof Map) return Math.max(0, Number(snap.leaks.get(key)) || 0);
  if (!Array.isArray(m && m.fields) || !m.fields.length) return 0;
  const players = allPlayers(m);
  let n = 0;
  for (const f of m.fields) {
    const fr = (f && f.result) || null;
    const leaks = fr && fr.confrontLeaks;
    if (!leaks || typeof leaks !== 'object') continue;
    for (const [seatStr, v] of Object.entries(leaks)) {
      const owner = players.find((x) => x && x.seat === Number(seatStr));
      if (!owner) continue;
      if (monsterBondKey(m, owner) !== key) continue;
      n += Math.max(0, Number(v) || 0);
    }
  }
  return n;
}

/** 本席归属键下投放怪漏过的只数（视图与收尾共用）。 */
export function monsterBondLeaks(m, ps) {
  if (!m || m.monsterShopOn !== true) return 0;
  const key = monsterBondKey(m, ps);
  return key == null ? 0 : leaksForKey(m, key);
}

/** 本回合官方出怪的**合计只数**（增援的 1.5 倍基准；没有快照 → 0 = 增援不成立）。 */
function officialTotalCount(m) {
  const counts = officialSpawnCounts(m);
  if (!counts) return 0;
  let n = 0;
  for (const v of counts.values()) n += Math.max(0, Number(v) || 0);
  return n;
}

/**
 * 本席此刻的盟约层数（含通用条：增援 = 投放只数、会战 = 投过的攻方人数、回收 = 漏过只数）。
 * @returns {Object<string, number>}
 */
export function monsterBondLayers(m, ps) {
  const st = recordOf(m, ps);
  const out = {};
  if (!st) return out;
  for (const def of MONSTER_BOND_DEFS) {
    let n = 0;
    if (def.id === 'concert') {
      const byPlayer = st.byPlayer || {};
      n = Object.keys(byPlayer).filter((pid) => (Number(byPlayer[pid]) || 0) > 0).length;
    } else if (def.id === 'recover') {
      n = monsterBondLeaks(m, ps);
    } else {
      n = Math.max(0, Number(st.layers[def.id]) || 0);
    }
    if (n > 0) out[def.id] = n;
  }
  return out;
}

/**
 * 本席此刻的怪物盟约**乘区乘数**（供 spawn 的 mods 用）：`{ hpMul: 1.12, atkMul: 1.09, speedMul: 1.05, aspdMul: 1.15 }`。
 * 没有盟约 / 商店关着 → null（调用方原样返回 roundMods 的对象）。
 * @param {object} m @param {object} ps 投放者（applyConfront 里由 sub 反查到的攻方）
 * @returns {Object<string, number>|null}
 */
export function monsterBondMods(m, ps) {
  if (!m || m.monsterShopOn !== true || !ps) return null;
  const st = recordOf(m, ps);
  if (!st) return null;
  const delta = {};
  for (const [id, cfg] of Object.entries(MONSTER_BOND_MODS)) {
    const layers = Math.max(0, Number(st.layers[id]) || 0);
    if (!(layers > 0)) continue;
    const add = Math.min(cfg.cap, cfg.per * layers);
    if (add > 0) delta[cfg.key] = (delta[cfg.key] || 0) + add;
  }
  // 会战：同队两名攻方都投过 ≥1 只 → 全队速度 +5%（一阶；更上层数由 concert 的阈值决定，效果仍是这一个固定值）
  const placing = Object.keys(st.byPlayer || {}).filter((pid) => (Number(st.byPlayer[pid]) || 0) > 0).length;
  if (monsterBondTier(placing, thresholdsOf('concert')) > 0) delta.speedMul = (delta.speedMul || 0) + MONSTER_BOND_CONCERT_BONUS;
  const keys = Object.keys(delta);
  if (!keys.length) return null;
  const out = {};
  for (const k of keys) out[k] = 1 + delta[k];
  return out;
}

/**
 * 把盟约乘区**乘**到 spawn mods 上（`roundMods` 的既有键不动，只乘不覆盖）。
 * @param {object} mods roundMods 的结果（可能已带 supplyHpMul 等） @param {object|null} bondMods monsterBondMods
 * @returns {object} 新的 mods 对象（bondMods 为 null 时原样返回）
 */
export function mergeMonsterBondMods(mods, bondMods) {
  if (!bondMods) return mods;
  const out = { ...mods };
  for (const [k, mul] of Object.entries(bondMods)) {
    const cur = Number(out[k]);
    out[k] = (Number.isFinite(cur) && cur > 0 ? cur : 1) * mul;
  }
  return out;
}

/**
 * 私有帧 `m.monsterShop.bonds` 的载荷：`[{ id, name, layers, tier, active }]`，空则返回 null（帧里省略该字段，
 * 保持老帧形状）。层数语义见 monsterBondLayers（含三条通用）。
 */
export function monsterBondView(m, ps) {
  if (!m || m.monsterShopOn !== true) return null;
  const layers = monsterBondLayers(m, ps);
  const rows = [];
  for (const def of MONSTER_BOND_DEFS) {
    const n = Math.max(0, Number(layers[def.id]) || 0);
    if (!(n > 0)) continue;
    const tier = monsterBondTier(n, thresholdsOf(def.id));
    rows.push({ id: def.id, name: def.name, layers: n, tier, active: tier > 0 });
  }
  return rows.length ? rows : null;
}

/**
 * 回合收尾（phases.js 的回合边界）：把资金类盟约（增援 / 回收）按本回合最终口径发给投放者，然后清空
 * `m.monsterBonds`（每回合重置）。
 * 漏怪数读 `captureMonsterBondLeaks` 在 settle 里钉下的快照（`m._bondRoundStats`）—— settle 结尾会清 `m.fields`
 * （settle.js:238），所以这里读不到 fields 本身（2026-11-04 复验修复 3：此前「回收」恒发 0）。
 * 同队共享池时按各人投放只数的比例分摊。
 * @param {object} m
 * @returns {number} 实际发出的怪物资金总额
 */
export function closeMonsterBondRound(m) {
  if (!m || m.monsterShopOn !== true) return 0;
  const map = m.monsterBonds;
  if (!(map instanceof Map) || !map.size) { m.monsterBonds = null; m._bondRoundStats = null; return 0; }
  const players = allPlayers(m);
  const official = officialTotalCount(m);
  let paid = 0;
  for (const [key, rec] of map) {
    if (!rec || typeof rec !== 'object') continue;
    const mine = players.filter((ps) => ps && ps.alive !== false && (Number(rec.byPlayer[ps.playerId]) || 0) > 0 && monsterBondKey(m, ps) === key);
    if (!mine.length) continue;
    const totalPlaced = mine.reduce((n, ps) => n + (Number(rec.byPlayer[ps.playerId]) || 0), 0) || Math.max(0, Number(rec.placed) || 0);
    const shareOf = (ps) => (totalPlaced > 0 ? (Number(rec.byPlayer[ps.playerId]) || 0) / totalPlaced : 1 / mine.length);
    const pay = (ps, amount) => {
      const v = Math.max(0, Math.round(Number(amount) || 0));
      if (!(v > 0)) return;
      ps.monsterEarned = Math.max(0, Number(ps.monsterEarned) || 0) + v;
      // 账户走访问器（业主 2026-11-04 裁决 2）：shared 进队级账户（同队成员镜像同步），solo 进个人账户。
      addMonsterFundsTo(m, ps, v);
      paid += v;
    };
    // 增援：超出「官方只数 × 1.5」的部分按均价 ×20% 返还（× 层数档倍率）
    const placed = Math.max(0, Number(rec.placed) || 0);
    const surplus = Math.max(0, placed - official * MONSTER_BOND_SURPLUS_SHARE);
    const tierR = monsterBondTier(Math.max(0, Number(rec.layers.reinforce) || 0), thresholdsOf('reinforce'));
    if (surplus > 0 && tierR > 0) {
      const avg = placed > 0 ? (Number(rec.cost) || 0) / placed : 0;
      const amount = surplus * avg * MONSTER_BOND_SURPLUS_REFUND * (MONSTER_BOND_TIER_MUL[tierR] || 1);
      for (const ps of mine) pay(ps, amount * shareOf(ps));
    }
    // 回收：settle 已经按 MONSTER_LEAK_REWARD 发过全额，这里只发「额外 +50%」
    const leaked = leaksForKey(m, key);
    const tierV = monsterBondTier(leaked, thresholdsOf('recover'));
    if (leaked > 0 && tierV > 0) {
      const amount = leaked * MONSTER_LEAK_REWARD_BASE * MONSTER_BOND_LEAK_EXTRA * (MONSTER_BOND_TIER_MUL[tierV] || 1);
      for (const ps of mine) pay(ps, amount * shareOf(ps));
    }
  }
  m.monsterBonds = null;
  // 快照按回合消费一次：清掉之后本回合的漏怪数不会再被下一回合误读（下一回合的 settle 会重新钉一份）。
  m._bondRoundStats = null;
  return paid;
}
