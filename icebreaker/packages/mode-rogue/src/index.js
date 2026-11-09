// 集成战略（肉鸽）的 run 规则：主题数据、节点图生成、节点推进、战斗结算与奖励。
// 只有规则与数据，不碰网络与 DOM —— 服务端（packages/server）持有 run，客户端拿 view。
// 数据结构来源：官方 roguelike_topic_table.json（见 tools/rogue-data.mjs 的抽取口径）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 可玩的主题。 */
export const TOPICS = Object.freeze(['rogue_1', 'rogue_2', 'rogue_3', 'rogue_4', 'rogue_5', 'rogue_6']);

/** 节点类型（官方 nodeTypeData 的键 + 我们补的两个非战斗项）。 */
export const NODES = Object.freeze(['BATTLE_NORMAL', 'BATTLE_ELITE', 'BATTLE_BOSS', 'SHOP', 'REST', 'INCIDENT', 'TREASURE', 'ENTERTAINMENT', 'UNKNOWN']);

/** 一层的列数与候选数（官方口径：4–8 列、每列 2–4 个候选，逐列走、层末出口进下一区）。 */
export const MAP_RULES = Object.freeze({ columns: [4, 8], candidates: [2, 4] });

/** 非战斗节点的出现权重（层内非最后一列）。battle 由列位置决定，这里只管中段。 */
const WEIGHTS = Object.freeze({ BATTLE_NORMAL: 34, BATTLE_ELITE: 12, INCIDENT: 18, SHOP: 9, REST: 9, TREASURE: 6, ENTERTAINMENT: 7, UNKNOWN: 5 });

/** mulberry32：确定性随机，同一 seed 两端一致。 @param {number} seed */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickOne = (rnd, list) => list[Math.floor(rnd() * list.length) % list.length];
const int = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));

/** @type {Map<string, any>} */
const cache = new Map();
/** 读一个主题的数据（node 侧；客户端只拿 view）。 @param {string} topicId */
export function topicData(topicId) {
  if (!TOPICS.includes(topicId)) throw new RangeError(`no rogue topic ${topicId}`);
  if (!cache.has(topicId)) {
    const file = fileURLToPath(new URL(`../data/${topicId}.json`, import.meta.url));
    cache.set(topicId, JSON.parse(readFileSync(file, 'utf8')).topic);
  }
  return cache.get(topicId);
}

/** 主题的一览（给大厅/选择页）：名字、区域数与可玩的关卡数。 */
export function topicList() {
  return TOPICS.map((id) => {
    const t = topicData(id);
    return { id, name: t.name, line: t.line, zones: mainZones(t).length, stages: t.stages.length,
      squads: t.squads.map((s) => ({ id: s.id, name: s.name, desc: s.desc, usage: s.usage })), difficulties: t.difficulties };
  });
}

/** 主区域：id 为 zone_<N> 的（排除 portal_* / *_b / sky 这些分支与隐藏变体），按序号排序。 */
const zoneNumber = (z) => Number((z.id.match(/\d+/) ?? ['0'])[0]);
const mainZones = (t) => t.zones.filter((z) => /^zone_\d+$/.test(z.id)).slice().sort((a, b) => zoneNumber(a) - zoneNumber(b));

/** 某层某类型的关卡池（先按区域，池空则全主题兜底）。 */
export function stagePool(t, node, zone) {
  const byNode = t.stages.filter((s) => s.node === node);
  const inZone = byNode.filter((s) => s.zone === zone);
  return inZone.length ? inZone : byNode;
}

/** 一层里一列的节点类型（官方规则：第一列必为作战，最后一列为首领/精英，中段按权重）。 */
function nodeTypeFor(rnd, col, cols, zone, lastZone) {
  if (col === 0) return 'BATTLE_NORMAL';
  if (col === cols - 1) return lastZone ? 'BATTLE_BOSS' : (rnd() < 0.5 ? 'BATTLE_ELITE' : 'BATTLE_NORMAL');
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  let x = rnd() * total;
  for (const [k, w] of Object.entries(WEIGHTS)) { x -= w; if (x <= 0) return k; }
  return 'BATTLE_NORMAL';
}

/** 生成整张图（所有区域一次算好，确定性）。 @param {any} t @param {number} seed */
export function generateMap(t, seed) {
  const rnd = rng(seed);
  const zones = mainZones(t);
  return zones.map((z, zi) => {
    const cols = int(rnd, MAP_RULES.columns[0], MAP_RULES.columns[1]);
    const lastZone = zi === zones.length - 1;
    const columns = Array.from({ length: cols }, (_, col) => {
      const n = int(rnd, MAP_RULES.candidates[0], MAP_RULES.candidates[1]);
      return Array.from({ length: n }, (_, k) => {
        const node = nodeTypeFor(rnd, col, cols, zi + 1, lastZone);
        const pool = stagePool(t, node, zi + 1);
        const stage = pool.length && node.startsWith('BATTLE') ? pickOne(rnd, pool) : null;
        return { id: `${z.id}-${col}-${k}`, node, stage: stage ? { id: stage.id, level: stage.level, name: stage.name, code: stage.code } : null, done: false };
      });
    });
    return { zone: { id: z.id, name: z.name, time: z.time, bg: z.bg, icon: z.icon }, columns };
  });
}

/** 开局：按 init 的对应难度取初始资源与分队。 @param {{ topicId: string, seed: number, squadId?: string, grade?: number, seats?: number }} o */
export function createRun({ topicId, seed, squadId, grade = 0, seats = 1 }) {
  const t = topicData(topicId);
  const init = t.init.find((x) => x.mode === 'NORMAL' && x.grade === grade) ?? t.init.find((x) => x.mode === 'NORMAL') ?? t.init[0];
  const graph = generateMap(t, seed);
  return {
    topicId, seed, grade, seats, mode: init.mode,
    hp: init.hp, maxHp: init.hp, gold: init.gold, cap: init.cap, hope: 0,
    squadId: squadId ?? init.squads[0], squadName: t.squads.find((s) => s.id === squadId)?.name ?? null,
    relics: [], graph, zone: 0, column: 0, status: 'running', pending: null, battles: 0, wins: 0, losses: 0,
  };
}

/** 走完一层就进下一区；全部走完 = 通关。 */
function normalize(run) {
  while (run.status === 'running' && run.zone < run.graph.length && run.column >= run.graph[run.zone].columns.length) {
    run.zone++;
    run.column = 0;
  }
  if (run.status === 'running' && run.zone >= run.graph.length) { run.status = 'won'; run.pending = null; }
}

/** 当前列的候选（给客户端）。 */
export function columnView(run) {
  normalize(run);
  const g = run.graph[run.zone];
  if (!g) return null;
  return { zone: g.zone, index: run.zone, columns: g.columns.length, column: run.column, nodes: g.columns[run.column] };
}

/** 选一个节点：只能选当前列的；返回这一节点要做什么（战斗/事件/商店/休整/补给/宝箱）。 */
export function chooseNode(run, nodeId) {
  const col = columnView(run);
  const node = col?.nodes.find((n) => n.id === nodeId);
  if (!node || run.pending) return null;
  if (node.node.startsWith('BATTLE')) return { kind: 'battle', node };
  return { kind: node.node.toLowerCase(), node };
}

/** 战斗结束回写：胜＝可选择奖励并进下一列；负＝扣 1 生命、留在本列。 @param {boolean} won */
export function applyBattle(run, won) {
  run.battles++;
  if (won) {
    run.wins++;
    run.pending = 'reward';
    run.column++;
    return { next: 'reward', hp: run.hp };
  }
  run.losses++;
  run.hp -= 1;
  if (run.hp <= 0) run.status = 'lost';
  return { next: run.status === 'lost' ? 'lost' : 'retry', hp: run.hp };
}

/** 奖励候选：按稀有度从池里抽 3 个未持有的藏品。 */
export function rewardChoices(run, count = 3) {
  const t = topicData(run.topicId);
  const own = new Set(run.relics);
  const pool = t.relics.filter((r) => !own.has(r.id) && relicUsable(run, r));
  const rnd = rng(run.seed ^ (run.relics.length * 2654435761));
  const out = [];
  while (out.length < Math.min(count, pool.length)) {
    const r = pickOne(rnd, pool);
    if (!out.includes(r)) out.push(r);
  }
  run.pending = 'reward:choices';
  return out;
}

/** 拿一个奖励。 */
export function takeReward(run, relicId) {
  const t = topicData(run.topicId);
  const r = t.relics.find((x) => x.id === relicId);
  if (!r || run.relics.includes(relicId)) return null;
  run.relics.push(relicId);
  // 局外资源当场结算（生命/源石锭/携带上限）
  const m = metaOf(run, relicId);
  run.hp = Math.min(run.maxHp, run.hp + m.hp);
  run.gold += m.gold;
  run.cap += m.cap;
  run.pending = null;
  return r;
}

/** 非战斗节点的结算（MVP：给资源/回血/藏品，事件随机一个正向结果）。返回值给客户端展示。 */
export function resolveNode(run, node) {
  const t = topicData(run.topicId);
  const rnd = rng(run.seed ^ (run.column * 131 + run.zone));
  if (node.node === 'SHOP') { run.shop = shopOffers(run); run.pending = 'shop'; return { kind: 'shop', text: '诡意行商：花源石锭买一件藏品' }; }
  if (node.node === 'REST') { const heal = Math.min(1, run.maxHp - run.hp); run.hp += heal; return { kind: 'rest', heal, text: heal ? '休整：恢复 1 点生命' : '休整：生命已满' }; }
  if (node.node === 'UNKNOWN') { const gold = int(rnd, 2, 5); run.gold += gold; return { kind: 'unknown', gold, text: `未知：获得 ${gold} 枚源石锭` }; }
  if (node.node === 'TREASURE') { run.pending = 'reward'; return { kind: 'treasure', text: '宝箱：选择一件藏品' }; }
  if (node.node === 'INCIDENT') {
    const good = rnd() < 0.6;
    if (good) { const gold = int(rnd, 3, 6); run.gold += gold; return { kind: 'event', good: true, gold, text: `事件：获得 ${gold} 枚源石锭` }; }
    run.hp -= 1; if (run.hp <= 0) run.status = 'lost';
    return { kind: 'event', good: false, hp: -1, text: '事件：失去了 1 点生命' };
  }
  return { kind: 'unknown', text: '' };
}

/** 推进到下一列；一层走完进下一区。 */
export function advance(run) {
  const g = run.graph[run.zone];
  if (!g) { run.status = 'won'; return { zone: run.zone, column: 0, done: true }; }
  if (run.column >= g.columns.length) {
    run.zone++;
    run.column = 0;
    if (run.zone >= run.graph.length) { run.status = 'won'; run.pending = null; return { zone: run.zone, column: 0, done: true }; }
  }
  return { zone: run.zone, column: run.column, done: false };
}

/** 客户端看到的 run（不含图里未到达的细节也可以给全图，官方地图本来就全显）。 */
export function runView(run) {
  const t = topicData(run.topicId);
  const byId = new Map([...t.relics, ...t.squads].map((r) => [r.id, r]));
  return {
    topicId: run.topicId, grade: run.grade, mode: run.mode, status: run.status, pending: run.pending,
    hp: run.hp, maxHp: run.maxHp, gold: run.gold, cap: run.cap, hope: run.hope,
    relicCount: run.relics.length, squad: { id: run.squadId, name: run.squadName },
    zone: run.zone, column: run.column,
    graph: run.graph.map((g, zi) => ({ zone: g.zone, current: zi === run.zone, columns: g.columns.map((c, ci) => c.map((n) => ({
      id: n.id, node: n.node, stage: n.stage ? { name: n.stage.name, code: n.stage.code } : null,
      state: zi < run.zone || (zi === run.zone && ci < run.column) ? 'done' : zi === run.zone && ci === run.column ? 'current' : 'locked',
    }))) })),
    relics: run.relics,
    relicList: run.relics.map((id) => { const r = byId.get(id); return { id, name: r?.name ?? id, usage: r?.usage ?? null, rarity: r?.rarity ?? null }; }),
  };
}

// ───────────────────────── 藏品 / 分队 → 战斗 ─────────────────────────
// 官方藏品的 buff 是一套很大的 DSL（576 种键）。这里只映射到引擎真正能生效的那一档：
//   · 属性乘算 / 加算、再部署、阻挡、部署上限、出生技力、攻击/受击回技力、伤害与治疗系数 → match 的 seat runes；
//   · 敌方血量/攻击/防御/移速/攻速 → 这一局的关卡变体（enemyMul）；
//   · 初始费用 → 关卡变体的 options.initialCost；
//   · 生命/源石锭/携带上限等局外资源 → 领取时直接结算。
// 其余键（招募券、商店、掉落表、天气、节点刷新…）不进战斗，奖励池里会过滤掉「完全无法生效」的藏品。

/** 全职业的 mask（PROFESSION_BITS 全置位）。 */
const ALL_PROF = 1023;
const PROF_BIT = Object.freeze({ warrior: 1, sniper: 2, tank: 4, medic: 8, support: 16, caster: 32, special: 64, token: 128, trap: 256, pioneer: 512 });

/** 职业选择器 → mask；没有选择器就是全职业。 */
function maskOf(bb) {
  const s = bb['selector.profession'];
  if (typeof s !== 'string' || !s.trim()) return ALL_PROF;
  const m = s.split('|').reduce((acc, p) => acc | (PROF_BIT[/** @type {keyof typeof PROF_BIT} */ (p.trim())] ?? 0), 0);
  return m || ALL_PROF;
}

/** 引擎 seat runes 认识的属性字段（与 content/src/runes.js 的 MUL_FIELDS 同名）。 */
const ATTR = Object.freeze(['atk', 'def', 'max_hp', 'magic_resistance', 'attack_speed', 'move_speed', 'mass_level']);
/** env_gbuff_new 里引擎认识的键。 */
const GBUFF = Object.freeze(['damage_scale[out]', 'damage_scale[input][char]', 'heal_scale[advanced][out]', 'sp_recovery_reduction']);
/** 局外资源：buff 的 id 前缀 → 资源。 */
const RESOURCE = Object.freeze({ _hp: 'hp', _hpmax: 'hp', _gold: 'gold', _population: 'cap', _exp: null, _population_max: 'cap' });

/** 一条 buff 能落到的位置：{kind:'rune'|'scale'|'meta'|'cost'}；null = 不认识。 */
function effectOfBuff(b) {
  const key = b.key, v = b.value;
  if (key === 'char_attribute_mul' || key === 'layer_char_attribute_mul' || key === 'char_squad_attribute_mul' || key === 'rogue_5_character_in_candle_holder_common_buff') {
    const board = ATTR.filter((k) => typeof b[k] === 'number').map((k) => [k, 1 + b[k]]);
    return board.length ? { kind: 'rune', key: 'char_attribute_mul', mask: maskOf(b), board } : null;
  }
  if (key === 'char_attribute_add' || key === 'char_squad_attribute_add') {
    const board = ATTR.filter((k) => typeof b[k] === 'number').map((k) => [k, b[k]]);
    return board.length ? { kind: 'rune', key: 'char_attribute_add', mask: maskOf(b), board } : null;
  }
  if (key === 'level_char_limit_add' && typeof v === 'number') return { kind: 'rune', key: 'global_deck_placeable_char_num_add', mask: ALL_PROF, board: [['value', v]] };
  if (key === 'char_blockcnt_add' && typeof v === 'number') return { kind: 'rune', key: 'char_blockcnt_add', mask: maskOf(b), board: [['value', v]] };
  if (key === 'misc_insert_token_card' && typeof b.token_key === 'string' && (b.cnt ?? 1) === 1) {
    return { kind: 'rune', key: 'insert_token_card', mask: ALL_PROF, board: [['token_key', b.token_key], ['level', b.level ?? 1], ['skill', b.skill ?? -1], ['skill_level', b.skill_level ?? 1]] };
  }
  if (key === 'modify_sp[born]' && typeof b.sp === 'number') return { kind: 'rune', key: 'char_dynamic_ability_new', mask: maskOf(b), board: [['key', 'modify_sp[born]'], ['sp', b.sp]] };
  if (key === 'env_gbuff_new' && GBUFF.includes(String(b.key2 ?? b['key'] ?? ''))) {
    const k = String(b.key2 ?? b['key']);
    const field = { 'damage_scale[out]': 'damage_scale', 'damage_scale[input][char]': 'damage_scale', 'heal_scale[advanced][out]': 'heal_scale', sp_recovery_reduction: 'sp_recovery_per_sec' }[k];
    return typeof b[field] === 'number' ? { kind: 'rune', key: 'env_gbuff_new', mask: maskOf(b), board: [['key', k], [field, b[field]]] } : null;
  }
  const enemy = { enemy_max_hp_down: 'max_hp', enemy_atk_down: 'atk', enemy_def_down: 'def', enemy_move_speed_down: 'move_speed', enemy_attack_speed_down: 'attack_speed' }[key];
  if (enemy && typeof b[enemy] === 'number') return { kind: 'scale', field: enemy, mul: 1 + b[enemy] };
  if (key === 'level_init_cost_add' && typeof v === 'number') return { kind: 'cost', add: v };
  if (key === 'level_life_point_add' && typeof v === 'number') return { kind: 'meta', res: 'hp', add: v };
  if (key === 'immediate_reward' || key === 'immediate_cost' || key === 'zone_into_reward' || key === 'secret_into_reward' || key === 'immediate_reward_once') {
    const id = String(b.id ?? '');
    const hit = Object.entries(RESOURCE).find(([suffix]) => id.endsWith(suffix));
    return hit && hit[1] && typeof b.count === 'number' ? { kind: 'meta', res: hit[1], add: b.count } : null;
  }
  return null;
}

/** 一名玩家已持有的全部藏品与分队的效果汇总（同一 key+mask 的钱包合并，避免超过 MAX_RUNES=16）。 */
export function battleFromRun(run) {
  const t = topicData(run.topicId);
  const byId = new Map([...t.relics, ...t.squads].map((r) => [r.id, r]));
  /** @type {Map<string, { key: string, mask: number, board: Map<string, any> }>} */
  const runes = new Map();
  const scale = { max_hp: 1, atk: 1, def: 1, move_speed: 1, attack_speed: 1 };
  const meta = { hp: 0, gold: 0, cap: 0 };
  let cost = 0, known = 0, total = 0;
  const ids = [run.squadId, ...run.relics].filter(Boolean);
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    for (const b of r.buffs ?? []) {
      total++;
      const e = effectOfBuff(b);
      if (!e) continue;
      known++;
      if (e.kind === 'rune') {
        const k = `${e.key}:${e.mask}`;
        const acc = runes.get(k) ?? { key: e.key, mask: e.mask, board: new Map() };
        for (const [field, val] of e.board) {
          if (e.key === 'char_attribute_mul') acc.board.set(field, (acc.board.get(field) ?? 1) * val);
          else acc.board.set(field, val);
        }
        runes.set(k, acc);
      } else if (e.kind === 'scale') scale[e.field] *= e.mul;
      else if (e.kind === 'cost') cost += e.add;
      else if (e.kind === 'meta') meta[e.res] += e.add;
    }
  }
  // 难度档（grade 0–15）：官方表里没有数值倍率（只有展示与评分），这里按社区口径取每档 +5% 的敌方血量/攻防 —— 标注为假设，
  // 拿到官方系数后只改这一处。
  const g = 1 + 0.05 * Math.max(0, run.grade | 0);
  scale.max_hp *= g; scale.atk *= g; scale.def *= g;
  // meta 只在领取时结算，这里给出一次性汇总给服务端用
  return {
    runes: [...runes.values()].map((r) => ({ key: r.key, professions: r.mask, board: [...r.board.entries()] })),
    scale, meta, cost, coverage: { known, total },
  };
}

/** 一件藏品/分队自带的局外资源（生命/源石锭/携带上限）：领取时按这一件结算一次。 */
export function metaOf(run, relicId) {
  const t = topicData(run.topicId);
  const r = [...t.relics, ...t.squads].find((x) => x.id === relicId);
  const out = { hp: 0, gold: 0, cap: 0 };
  for (const b of r?.buffs ?? []) {
    const e = effectOfBuff(b);
    if (e?.kind === 'meta') out[e.res] += e.add;
  }
  return out;
}

/** 奖励池只放「至少有一样东西能生效」的藏品，避免领到完全空转的。 */
export function relicUsable(run, relic) {
  if (/_band_/.test(relic.id)) return false;
  return (relic.buffs ?? []).some((b) => effectOfBuff(b) !== null);
}

// ───────────────────────── 商店 ─────────────────────────
/** 稀有度 → 价格。 */
const PRICE = Object.freeze({ NORMAL: 4, RARE: 6, SUPER_RARE: 8, EPIC: 10, LEGEND: 12 });

/** 商店的三件货（确定性地按 seed 抽，可买空）。 */
export function shopOffers(run) {
  const t = topicData(run.topicId);
  const own = new Set(run.relics);
  const pool = t.relics.filter((r) => !own.has(r.id) && relicUsable(run, r));
  const rnd = rng((run.seed ^ ((run.zone + 1) * 7919)) >>> 0);
  const out = [];
  while (out.length < Math.min(3, pool.length)) {
    const r = pickOne(rnd, pool);
    if (out.includes(r)) continue;
    out.push({ id: r.id, name: r.name, usage: r.usage, rarity: r.rarity, price: PRICE[String(r.rarity ?? 'NORMAL')] ?? 6 });
  }
  run.shop = out;
  return out;
}

/** 买一件：钱够才成交。 */
export function buyOffer(run, relicId) {
  const offer = (run.shop ?? []).find((o) => o.id === relicId);
  if (!offer || run.gold < offer.price || run.relics.includes(relicId)) return null;
  run.gold -= offer.price;
  run.relics.push(relicId);
  const m = metaOf(run, relicId);
  run.hp = Math.min(run.maxHp, run.hp + m.hp);
  run.gold += m.gold;
  run.cap += m.cap;
  run.shop = run.shop.filter((o) => o.id !== relicId);
  return offer;
}
