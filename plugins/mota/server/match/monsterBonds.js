// plugins/mota/server/match/monsterBonds.js — 怪物方的**独立盟约**（攻方专属，业主 2026-11-04 口径）。
//
// 业主口径（2026-11-04，v3 按特训类别）：**攻方完全没有干员盟约、没有干员商店，只有怪物方的独立盟约** ——
// 7 条**按特训类别**（data/factions.json 的 `types`：特异 / 飞行 / 频次 / 元素 / 持续 / 隐匿 / 折射）+ 3 条通用，
// 层数制，**只影响本回合**。业主 2026-11-04 裁决「按类别相关进行分类和加盟约」：上一版的 20 条阵营条改回这 7 条类别条；
// `data/monster-factions.json`（20 个阵营）**保留但降级为展示数据**，不参与盟约归属。
// 所以本模块与 `bondsMeta.js`（干员盟约：整局持久、ps.layers / ps.bonds 被 invariants.js 钉死）是**平行结构**，
// 两套数据 / 状态 / installer 一律不共用：
//   · 状态 `m.monsterBonds` = Map<key, Record<bondId, layers>>，key 与怪物池同口径（monsterMode === 'solo' ? playerId
//     : teamId，见 monsterPool.js monsterPoolFor）—— 共享池时同队两名攻方的层数合成一份；
//   · 生命周期**每回合重置**（match/match/phases.js 的回合边界调 closeMonsterBondRound）；
//   · 涨层 = `monsterShop.js` 的 placeMonster / buyMonster（只算攻方投放的怪，官方波次不算），dropMonster 回退；
//   · 效果 = spawn 的 `mods` 乘区（hpMul / atkMul / defMul / resMul / speedMul / aspdMul），在 match/match/confront.js 的
//     applyConfront（投放怪）与 _confrontBossSpawns（事件期 boss）合并；资金类（增援 / 回收）在回合收尾发放。
//
// 【类别归属（2026-11-04 v3）】判据 = 敌人记录 `acTypes`（**数组**，权威字段；`acType` 是死字段——27 条上它等于阵营码）
// 里含这个类别 id。acTypes 里混着 7 个特训类别 + 20 个阵营码 + `GHOST` / `HEAVY` 这类标签，**必须按 7 类白名单过滤**
// （MONSTER_BOND_CATEGORY_IDS + def.category），否则只在 GHOST / HEAVY 的怪会拿到不存在的盟约 id。一只怪可同时命中多条
// （实测 3 只 `["INVISIBLE","SPECIAL"]` 双归属），一次投放给命中的每条各 +n（保持既有语义）。
// 敌人记录读数与 gamedata.js 同源：`gd.enemy(key)` / `gd.raw.enemies`；拿不到 `gd.raw` 的直测 / stub 走同一个
// `getData()` 单例（与 builtinMeta.js 的懒取法一致），**不另造读数层**。4 只模板槽怪在 data/enemies.json 里
// `acTypes: []`（BOSS 保底怪不吃特训分类），靠 CATEGORY_EXTRA 手写补（与 match/confront.js 的
// CONFRONT_GROUP_EXTRA 同源同值，两处要一起改）。没有类别的怪只在 3 条通用条里计数。
//
// 【阈值（2026-11-04 v3 重定）】类别条用绝对 [2,4,6] 会把大池（特异 36 只）锁死、小池（频次 10 只）白送，所以按该
// 类别在**本回合可投放池**（monsterPool.js 的 monsterCardKeys，对抗档 = 本回合官方出怪 / 赏金档 = 面板并集）里的
// **合计份数** n 取比例：
//   t1 = max(1, ceil(n × 0.20))，t2 = max(t1+1, ceil(n × 0.40))，t3 = max(t2+1, ceil(n × 0.60))
// 份数 = 每个 key 的官方合计只数（无快照按 1），一只怪命中几条类别就分别计入几条（双归属两头都算）。shares 从阵营
// 版的 0.15/0.30/0.45 抬到 0.20/0.40/0.60：类别池比阵营池小一个量级，低 shares 会让小池一阶恒 1。n = 0（本回合
// 这只类别没牌）时回落到 [1,2,3]（此时也投不出它，阈值只是形态占位）。3 条通用条仍是绝对阈值（见各自的常量）。
//
// 【aspdMul（攻速乘区）】2026-11-04 起两棵 sim 树的 `spawns.js`（`server/sim/battle/spawns.js` 与
// `plugins/mota/server/sim/battle/spawns.js`）的 enemy mods 都认 `aspdMul`：`aspd = def.aspd * (m.aspdMul ?? 1)`，
// 下游 `units.js` 的 `clamp(..., ASPD_MIN, ASPD_MAX)` 照旧兜底。**两棵树必须同步改**，否则客户端与服务端结果会漂。
//
// 守卫：`m.monsterShopOn === false`（opts.monsterShop === false / 非对抗局）时**整段不跑** —— 不建状态、不发帧、
// 不发放资金，旧对局的行为与字节完全不变。

import { monsterCardKeys, officialSpawnCounts } from './monsterPool.js';
// 怪物资金账户的唯一入口（业主 2026-11-04 裁决 2）：shared 落队级账户、solo 落个人账户。
// 与 monsterShop.js 互为 import（它 import 本文件的 addMonsterBonds / monsterBondView）：两边都只在函数体内取用，
// 模块顶层不互相求值（与 monsterPool ↔ match/confront 的循环同一口径），因此安全。
import { addMonsterFundsTo } from './monsterShop.js';
// data/*.json 的进程级单例（server/data.js 的再导出）；只在拿不到 gd.raw 的直测 / stub 路径上懒取一次。
import { getData } from '../data.js';

/** 层数阈值（通用条用；类别条的阈值按池子集动态算，见文件头与 monsterBondThresholds）。 */
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

/** data/monster-factions.json 在 loadData() 里的 basename（server/data.js 的键 = 文件名去掉 .json）。
 * 2026-11-04 v3 起只服务**展示**（阵营归属不再参与盟约，盟约按特训类别），保留访问器是为了不删公共导出。 */
const FACTION_DATA_KEY = 'monster-factions';

/** 直测 / stub 路径的懒取缓存：null = 还没取，false = 取失败或文件缺失。 */
let factionDataFallback = null;

/**
 * `data/monster-factions.json`（只读）。优先 `gd.raw[FACTION_DATA_KEY]` —— GameData 的 raw 就是 server/data.js
 * `loadData()` 的产物（data/*.json 按 basename 装、deepFreeze），与 gamedata.js 的 factions getter 同一套读法，
 * 不另造读数层；stub / 直测没有 raw 时用 getData() 单例懒取一次（builtinMeta.js 的同一手法）。
 * @param {object} gd GameData（或用 gd.enemy(key) 的 stub）
 * @returns {{ map?: Object<string, string[]> }|null}
 */
function monsterFactionData(gd) {
  const raw = gd && gd.raw;
  const own = raw && typeof raw === 'object' ? raw[FACTION_DATA_KEY] : null;
  if (own && typeof own === 'object' && own.map && typeof own.map === 'object') return own;
  if (factionDataFallback === null) {
    try {
      const data = getData({ log: { warn() {}, error() {}, info() {} } });
      factionDataFallback = (data && data[FACTION_DATA_KEY]) || false;
    } catch { factionDataFallback = false; }
  }
  return factionDataFallback || null;
}

/**
 * 一只怪属于哪些阵营（`data/monster-factions.json` 的 map；没有 = []）。纯数据查询，不看敌人属性。
 * 2026-11-04 v3 起**与盟约无关**（业主要「按类别相关进行分类和加盟约」）：阵营数据降级为展示数据，
 * 盟约归属走 `monsterBondCategoryIds`；本函数只为兼容外部展示 / 调试导出保留。
 * @param {object} gd GameData / stub @param {string} enemyKey
 * @returns {string[]} 阵营 id 列表（map 里按 id 排序）
 */
export function monsterFactionIds(gd, enemyKey) {
  const data = monsterFactionData(gd);
  const list = data && typeof enemyKey === 'string' ? data.map[enemyKey] : null;
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string' && id) : [];
}

/** 盟约认的 7 个特训类别 id（顺序 = data/factions.json `types` 的顺序，也是 MONSTER_BOND_DEFS 的顺序）。 */
export const MONSTER_BOND_CATEGORY_IDS = Object.freeze(['SPECIAL', 'FLY', 'TIMES', 'ELEMENT', 'DOT', 'INVISIBLE', 'REFLECTION']);
const CATEGORY_ID_SET = new Set(MONSTER_BOND_CATEGORY_IDS);

/**
 * 4 只模板槽怪（data/factions.json 的 `templateSlots`，BOSS 保底怪）在 data/enemies.json 里 `acTypes: []`，
 * 数据本身给不出类别，只能手写补 —— 与 `match/confront.js` 的 **CONFRONT_GROUP_EXTRA 同源同值**（那边管狩猎期
 * 分组展示、这边管盟约归属）：**两处要一起改**。归类依据（按机制，不是新造的判据）：
 * 灵幛范围伤害 → 特异；暴鸰飞行轰炸 → 飞行；枯朽前锋 / 孽罪奇美拉散播源石污染 → 持续。
 */
const CATEGORY_EXTRA = Object.freeze({
  SPECIAL: ['enemy_1427_lrnazg'],
  FLY: ['enemy_1040_bombd'],
  DOT: ['enemy_1422_lrsldr', 'enemy_1425_lrcmra'],
});

/** enemyKey → 手写类别（反查表，模块加载时建一次）。 */
const CATEGORY_EXTRA_BY_KEY = new Map();
for (const [id, keys] of Object.entries(CATEGORY_EXTRA)) {
  for (const key of keys) CATEGORY_EXTRA_BY_KEY.set(key, [...(CATEGORY_EXTRA_BY_KEY.get(key) || []), id]);
}

/** data/enemies.json 在 loadData() 里的 basename（敌人记录的唯一读数源）。 */
const ENEMY_DATA_KEY = 'enemies';

/** 直测 / stub 路径的懒取缓存：null = 还没取，false = 取失败或文件缺失。 */
let enemyDataFallback = null;

/**
 * `data/enemies.json`（只读）。优先 `gd.raw[ENEMY_DATA_KEY]` —— GameData 的 raw 就是 server/data.js `loadData()`
 * 的产物（data/*.json 按 basename 装、deepFreeze）；stub / 直测没有 raw 时用 getData() 单例懒取一次
 * （与上面的 monsterFactionData / builtinMeta.js 同一手法）。
 * @param {object} gd GameData / stub
 * @returns {Object<string, object>|null}
 */
function enemyData(gd) {
  const raw = gd && gd.raw;
  const own = raw && typeof raw === 'object' ? raw[ENEMY_DATA_KEY] : null;
  if (own && typeof own === 'object') return own;
  if (enemyDataFallback === null) {
    try {
      const data = getData({ log: { warn() {}, error() {}, info() {} } });
      enemyDataFallback = (data && data[ENEMY_DATA_KEY]) || false;
    } catch { enemyDataFallback = false; }
  }
  return enemyDataFallback || null;
}

/**
 * 敌人记录的 `acTypes`（数组；缺记录 / 非数组 → []）。取源按优先级并列收集，命中第一个带数组的：
 * `gd.enemy(key)`（GameData 的 getter，stub 也常有）→ `gd.raw.enemies[key]` → getData() 单例。
 * @param {object} gd @param {string} enemyKey
 * @returns {string[]}
 */
function acTypesOf(gd, enemyKey) {
  if (typeof enemyKey !== 'string' || !enemyKey) return [];
  const recs = [];
  try {
    if (gd && typeof gd.enemy === 'function') recs.push(gd.enemy(enemyKey));
  } catch { /* 读不到就当没有，走下一档 */ }
  const table = enemyData(gd);
  recs.push(table ? table[enemyKey] : null);
  for (const rec of recs) {
    const list = rec && rec.acTypes;
    if (Array.isArray(list)) return list.filter((x) => typeof x === 'string' && x);
  }
  return [];
}

/**
 * 一只怪属于哪 7 个**特训类别**（顺序 = MONSTER_BOND_CATEGORY_IDS）。
 * 判据 = `acTypes` 里含该类别 id，**只认 7 类白名单** —— acTypes 里还混着 20 个阵营码与 `GHOST` / `HEAVY`，
 * 不过滤会让 GHOST / HEAVY 怪拿到不存在的盟约 id。`acTypes` 为空的 4 只模板槽怪按 CATEGORY_EXTRA 手写补。
 * 可返回多条（双归属），不会重复。纯数据查询，不抛异常。
 * @param {object} gd GameData / stub @param {string} enemyKey
 * @returns {string[]}
 */
export function monsterBondCategoryIds(gd, enemyKey) {
  const set = new Set();
  for (const id of acTypesOf(gd, enemyKey)) if (CATEGORY_ID_SET.has(id)) set.add(id);
  for (const id of CATEGORY_EXTRA_BY_KEY.get(enemyKey) || []) if (CATEGORY_ID_SET.has(id)) set.add(id);
  if (!set.size) return [];
  return MONSTER_BOND_CATEGORY_IDS.filter((id) => set.has(id));
}

/**
 * 10 条盟约的固定定义（业主 2026-11-04 裁决 v3：7 条按**特训类别** + 3 条通用）。
 * 类别条的 id == data/factions.json `types` 的 type id（也是 MONSTER_BOND_MODS 的键），name = 该 type 的 `name`
 * 去掉「特训敌人·」前缀；归属判据是敌人 `acTypes` 命中（见 monsterBondCategoryIds），不再看阵营 / acType / rank / tags。
 * 类别条的 `thresholds` **不写死** —— 按本回合可投放池里该类别的合计份数算（见 monsterBondThresholds），
 * 所以这里只有 3 条通用条带绝对阈值。顺序 = factions.json `types` 的顺序（monsterBondIdForEnemy 取第一条命中的）。
 */
export const MONSTER_BOND_DEFS = [
  // ---- 7 条按特训类别（顺序 = data/factions.json 的 types 顺序） ----
  { id: 'SPECIAL', name: '特异', category: 'SPECIAL' },
  { id: 'FLY', name: '飞行', category: 'FLY' },
  { id: 'TIMES', name: '频次', category: 'TIMES' },
  { id: 'ELEMENT', name: '元素', category: 'ELEMENT' },
  { id: 'DOT', name: '持续', category: 'DOT' },
  { id: 'INVISIBLE', name: '隐匿', category: 'INVISIBLE' },
  { id: 'REFLECTION', name: '折射', category: 'REFLECTION' },
  // ---- 3 条通用 ----
  // 增援：投放只数 ≥ 官方只数 × 1.5（层数 = 投放只数），效果走资金返还
  { id: 'reinforce', name: '增援', thresholds: MONSTER_BOND_THRESHOLDS, classify: null, kind: 'funds' },
  // 会战：同队两名攻方都投放 ≥1 只（层数 = 投过的攻方人数），效果走全队速度乘区
  { id: 'concert', name: '会战', thresholds: MONSTER_BOND_CONCERT_THRESHOLDS, classify: null },
  // 回收：本回合有投放怪漏过（层数 = 漏过只数），效果走资金返还（额外 +50%）
  { id: 'recover', name: '回收', thresholds: MONSTER_BOND_THRESHOLDS, classify: null, kind: 'funds' },
];

/**
 * 效果表（乘区）：每条类别的「每层增量」与单条上限。`key` 只允许 spawn mods 认的六个键
 * （server/sim/battle/spawns.js 的 `mm()`：hpMul / atkMul / defMul / resMul / speedMul / aspdMul）。
 * 乘数语义 = 1 + Δ（sim 里 `base.maxHp * m.hpMul`），所以 Δ 是**加法叠加**的百分比。
 *
 * 数值依据（写死的是**基线池**口径：data/factions.json 的 confrontPool 120 只，见 monsterPool.js 文件头；
 * 7 类按 `acTypes` 实测，含 4 只 CATEGORY_EXTRA 手写补的模板槽怪）：
 *   · 每层 per 按该类别在这 120 只里的只数 n 给：n ≥ 24 → 0.03，12..23 → 0.04，0..11 → 0.05
 *     （池子小 = 可选牌少，单层给得重一些补偿）；单条上限 cap = 0.3（0.03 要 10 层、0.04 要 8 层、0.05 要 6 层到顶）。
 *   · 六个乘区按 n 降序**轮转分配**（hp → atk → def → res → speed → aspd），避免同队多类别全部堆同一个乘区；
 *     并列时按 MONSTER_BOND_DEFS 的顺序。
 *   · 基线分布（实测 acTypes ∩ 120 只卡池，3 只双归属两条各计一次）：SPECIAL 36 / ELEMENT 18 / INVISIBLE 17 /
 *     FLY 15 / DOT 14 / REFLECTION 13 / TIMES 10。
 */
export const MONSTER_BOND_MODS = {
  // n=36 → per 0.03，rank0 → hpMul
  SPECIAL: { key: 'hpMul', per: 0.03, cap: 0.3 },
  // n=18 → 0.04，rank1 → atkMul
  ELEMENT: { key: 'atkMul', per: 0.04, cap: 0.3 },
  // n=17 → 0.04，rank2 → defMul
  INVISIBLE: { key: 'defMul', per: 0.04, cap: 0.3 },
  // n=15 → 0.04，rank3 → resMul
  FLY: { key: 'resMul', per: 0.04, cap: 0.3 },
  // n=14 → 0.04，rank4 → speedMul
  DOT: { key: 'speedMul', per: 0.04, cap: 0.3 },
  // n=13 → 0.04，rank5 → aspdMul
  REFLECTION: { key: 'aspdMul', per: 0.04, cap: 0.3 },
  // n=10 → 0.05，rank6 → hpMul（六乘区轮转回到第一格）
  TIMES: { key: 'hpMul', per: 0.05, cap: 0.3 },
};

const defById = new Map(MONSTER_BOND_DEFS.map((d) => [d.id, d]));

/** 类别条的三阶阈值比例（份数 = 本回合可投放池里该类别的合计份数 n；见 categoryThresholdsOf）。 */
export const MONSTER_BOND_CATEGORY_THRESHOLD_SHARES = Object.freeze([0.2, 0.4, 0.6]);

/**
 * 类别条的阈值（按该类别的合计份数 n 取比例）：纯函数。
 *   t1 = max(1, ceil(n × 0.20))，t2 = max(t1+1, ceil(n × 0.40))，t3 = max(t2+1, ceil(n × 0.60))
 * 严格递增（`max(t1+1, …)`）保证三阶不会塌成同一层；n = 0 → [1,2,3]（形态占位，该类别本回合无牌）。
 * @param {number} poolCount 该类别在本回合可投放池里的合计份数
 * @returns {number[]} 三阶阈值
 */
export function categoryThresholdsOf(poolCount) {
  const n = Math.max(0, Math.floor(Number(poolCount) || 0));
  const [s1, s2, s3] = MONSTER_BOND_CATEGORY_THRESHOLD_SHARES;
  const t1 = Math.max(1, Math.ceil(n * s1));
  const t2 = Math.max(t1 + 1, Math.ceil(n * s2));
  const t3 = Math.max(t2 + 1, Math.ceil(n * s3));
  return [t1, t2, t3];
}

/**
 * 本回合可投放池里**每个特训类别的合计份数**（阈值分母）。来源与怪物池同口径：`monsterCardKeys(m)` 的合法集合；
 * 有官方快照（对抗档）时按该 key 的官方合计只数计，赏金档 / 无快照按每 key 1 只计。一只怪命中几条类别就分别
 * 计入几条（双归属两头都算）。缓存挂在 match 上：官方快照数组 / 面板 groups 数组的**引用**或回合号一变就失效
 * （与 monsterPool.js legalKeys 同法）。
 * @param {object} m
 * @returns {Map<string, number>} 类别 id → 合计份数（没有类别的 key 不计）
 */
function categoryPoolCounts(m) {
  if (!m) return new Map();
  const official = Array.isArray(m._roundOfficialSpawns) && m._roundOfficialSpawns.length ? m._roundOfficialSpawns : null;
  const stamp = official || (m._monsterLegalKeys && m._monsterLegalKeys.groups) || null;
  const cache = m._bondCategoryPool;
  if (cache && cache.stamp === stamp && cache.round === m.round) return cache.counts;
  let keys = [];
  try { keys = monsterCardKeys(m) || []; } catch { keys = []; }
  const spawnCounts = officialSpawnCounts(m);
  const counts = new Map();
  for (const key of keys) {
    const ids = monsterBondCategoryIds(m.gd, key);
    if (!ids.length) continue;
    const n = Math.max(1, Number(spawnCounts && spawnCounts.get(key)) || 1);
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + n);
  }
  m._bondCategoryPool = { stamp, round: m.round, counts };
  return counts;
}

/**
 * 某条盟约的阈值表：类别条按本回合池子里该类别的合计份数动态算，通用条用定义上的绝对阈值。
 * @param {object} m @param {string} id
 * @returns {number[]}
 */
export function monsterBondThresholds(m, id) {
  const d = defById.get(id);
  if (!d) return MONSTER_BOND_THRESHOLDS;
  if (Array.isArray(d.thresholds) && d.thresholds.length) return d.thresholds;
  const counts = categoryPoolCounts(m);
  return categoryThresholdsOf(counts.get(d.id) || 0);
}

/** 内部别名（旧调用点少写一个参数名）。 */
function thresholdsOf(m, id) { return monsterBondThresholds(m, id); }

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
 * 一只怪属于哪几条**类别**盟约（可同时属于多条，例如 enemy_1043_zomsbr 同时是 INVISIBLE 与 SPECIAL）。
 * 判据 = `acTypes` 命中 7 类白名单（见 monsterBondCategoryIds），不看阵营 / rank / tags。纯数据查询，不抛异常。
 * @param {object} gd GameData（用 gd.raw / gd.enemy）/ stub（会回落到 getData() 单例）
 * @param {string} enemyKey
 * @returns {string[]} 盟约 id 列表（顺序 = MONSTER_BOND_DEFS，便于稳定取「第一条」）
 */
export function monsterBondIdsOf(gd, enemyKey) {
  const cats = new Set(monsterBondCategoryIds(gd, enemyKey));
  if (!cats.size) return [];
  const out = [];
  for (const def of MONSTER_BOND_DEFS) if (def.category && cats.has(def.category)) out.push(def.id);
  return out;
}

/**
 * 一只怪属于**第一条**类别盟约（商店卡面的小徽标用；业主 2026-11-04 报障：卡片要显示名称与怪物盟约）。
 * 顺序 = MONSTER_BOND_DEFS（同时命中多个类别时取第一条命中的，双归属 `["INVISIBLE","SPECIAL"]` 取 SPECIAL）；
 * 3 条通用（增援 / 会战 / 回收）不参与 —— 它们不是怪物本身的属性。命不中（acTypes 空且不在 CATEGORY_EXTRA）→ null。
 * @param {object} gd GameData / stub @param {string} enemyKey
 * @returns {string|null} 盟约 id（'SPECIAL' / 'INVISIBLE' …）
 */
export function monsterBondIdForEnemy(gd, enemyKey) {
  const ids = monsterBondIdsOf(gd, enemyKey);
  return ids.length ? ids[0] : null;
}

/**
 * 盟约 id → 显示名（'SPECIAL' → '特异'）。未知 id 原样返回（调用方只管显示，不做判据）；空 → null。
 * @param {string|null} id
 * @returns {string|null}
 */
export function monsterBondName(id) {
  if (typeof id !== 'string' || !id) return null;
  const def = defById.get(id);
  return def ? def.name : id;
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
 * 投放涨层（monsterShop.js 的 placeMonster / buyMonster 成功后调用）：该怪命中的**类别盟约**各 + 投放只数，
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
  if (monsterBondTier(placing, thresholdsOf(m, 'concert')) > 0) delta.speedMul = (delta.speedMul || 0) + MONSTER_BOND_CONCERT_BONUS;
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
    const tier = monsterBondTier(n, thresholdsOf(m, def.id));
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
    const tierR = monsterBondTier(Math.max(0, Number(rec.layers.reinforce) || 0), thresholdsOf(m, 'reinforce'));
    if (surplus > 0 && tierR > 0) {
      const avg = placed > 0 ? (Number(rec.cost) || 0) / placed : 0;
      const amount = surplus * avg * MONSTER_BOND_SURPLUS_REFUND * (MONSTER_BOND_TIER_MUL[tierR] || 1);
      for (const ps of mine) pay(ps, amount * shareOf(ps));
    }
    // 回收：settle 已经按 MONSTER_LEAK_REWARD 发过全额，这里只发「额外 +50%」
    const leaked = leaksForKey(m, key);
    const tierV = monsterBondTier(leaked, thresholdsOf(m, 'recover'));
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
