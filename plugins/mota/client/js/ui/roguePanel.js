// plugins/mota/client/js/ui/roguePanel.js — 肉鸽「集成战略」全屏叠加面板。
//
// 形态（业主 2026-11-04「节点和地图改成官方风格叠加面板，近似 1:1，不做局内悬浮窗」；
//       2026-11-09 三版「照搬方舟的样式」⇒ 版式重搭为方舟信息页）：
//   · 一层面板 + 半透明遮罩，**不是**局内常驻浮窗；只在非战斗阶段由左上角的「肉鸽」按钮打开，
//     战斗 / 结算由 screens/game.js 关闭并禁用入口（这里再按 `blocked` 兜一层，防相位切换的那一帧）。
//   · 版式四块（方舟信息页）：顶栏（层号块 + 区域名 + AP / 藏品 / 回合资源条 + 视图切换 + 关闭）／
//     左竖排导航（节点 / 地图 / 藏品）／中间「当前区域的一整张多列节点图」／右侧详情栏（选中节点 +
//     战场缩略图 + 出怪路线 + 前往此节点）。
//   · 节点全部由官方精灵拼：底板 `img_node_bkg(.selectable).png` + 图标 `img_*_active.png` +
//     英文标签 `img_tag_*.png`（官方中文客户端在图上显示的就是这些英文小标）；当前所在节点背后垫
//     `img_focus.png` 雾团，被点开的节点套 `img_cursor.png` 选框。中文名在右侧详情栏与 aria-label。
//   · 连线仍是内联 SVG（几何由 nodeGraph() 给：行号 → 百分比），只改细线与配色。
//     区域视图只画区内连线，全部层视图画全部 14 列。
//   · 地图页 = 当前战场缩略图（buildMinimapModel 裁剪）+ 出怪路线 + 右侧关卡信息 / 地图统计；
//     藏品页 = 藏品格 + 右侧词缀与预告。
//
// 数据（全部只读，服务端已组装好）：
//   · `pub.rogue.nodes`（server/match/match/views.js → rogue-core 的 rogueNodeState）：14 层 × 3 候选；
//   · `pub.rogue` 的 affix / emergency / nextEventRound / nextEmergencyRound；
//   · `priv.relicCards`（player/views.js）—— 名称/品阶/正负/是否实装；`pub.rogue.relics` 作后备（只有 id 时）；
//   · `stages` 数据文件（`data.lookup('stages', stageId)`，与 rogueMapDock 同一读法）。
// 动作：节点/按钮的点击**不在这里发** —— 组件把意图交给 game.js 注入的 `onPickNode(intent, payload)`，
//       对局页用 `net.request('g.rogueNode', { nodeId })`（与 g.roguePick / g.hex 同一条通道）。拿不到回调时
//       按钮禁用并明说「只读」，不编造网络接口。
//
// ⚠ 界面**不得**出现 `rogue_ro...` 原始资源 ID（2026-11-04 第四轮视觉验收）：`data/stages.json` 里肉鸽图的
//   `name` 就是 id 本身，直接渲染 `stage.name` 等于把资源路径摆给玩家。凡是要写关卡名的地方一律走 `mapLabel()`
//   （`rogue_ro5_1-2_dlc1` → `RO5 · 1-2 · DLC1`），下一层预览只有 tier（具体落哪张图由服务端 seed 决定）走
//   `mapTierLabel()`（`RO5 · T1`）。两条都返回 '' 时显示「—」，不退回原始串。
//
// ⚠ htm 模板里不能写 JS 式 `//` 注释（`/` 会进解析器的自闭合分支，整屏 SYSTEM FAULT）：注释一律写在模板外。
// 尺寸：1rem = 100 设计 px（1280×720 下 1rem≈66.7px），所以全部用 rem，字号用 calc(N * var(--t))。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { buildMinimapModel, TERRAIN } from './rogueMapModel.js';
// 失与得（2026-11-06）：swap offer 进行中时，藏品页给每件藏品一个「换出」入口。
// 判断信号来自 relicOverlay 的渲染期标记（对局页同一帧先归一化藏品 offer 再渲染本面板），本面板不自己猜。
import { relicSwapPending } from './relicOverlay.js';

/** 官方素材根目录（public/assets/local/roguelike，由 assets 导出脚本落盘）。 */
export const ROGUE_ASSET = '/assets/local/roguelike';
/** 节点卡底（官方 165×94）。选中态只用 CSS（描边 + 光晕），官方 img_focus.png 留作以后换皮。 */
export const NODE_CARD_BG = `${ROGUE_ASSET}/node/img_node_bkg.png`;

/**
 * 官方类型色（用户给的对照表：battle / elite / boss / shop / rest / event，unknown 白）。
 * `wish`（得偿所愿）是官方 IS 的「许愿」节点：取金色系，但比 battle 的 #FFB80D 亮一档（#FFD76A），
 * 两者在同一张节点图里不会看混。
 */
export const TYPE_COLOR = Object.freeze({
  battle: '#FFB80D',
  elite: '#F37E00',
  boss: '#FF5201',
  shop: '#0DB28D',
  rest: '#00B4FF',
  event: '#00E2E4',
  incident: '#00E2E4',
  wish: '#FFD76A',
  unknown: '#FFFFFF',
});

/**
 * 类型 → 官方图标（`img_*_active.png`；事件在官方素材里叫 incident）。
 * ⚠ `wish` 没有官方图标：`public/assets/local/roguelike/node/` 里 `img_wish*` 一个都没有（导出脚本按官方包名取的，
 * 官方这一版素材就没带）。这里借用 `img_treasure_active.png`（藏宝宝箱，语义最近），换成官方图时只改这一行。
 */
const TYPE_ICON = {
  battle: 'img_battle_active.png',
  elite: 'img_elite_active.png',
  boss: 'img_boss_active.png',
  shop: 'img_shop_active.png',
  rest: 'img_rest_active.png',
  event: 'img_incident_active.png',
  incident: 'img_incident_active.png',
  wish: 'img_treasure_active.png',
};

/**
 * 官方节点底板/连线/选框（2026-11-09 三版「照搬方舟」）：节点不再自己画方块，直接用官方精灵拼。
 *   plate 165×94 半透明灰底板；selectable 186×114 亮白底板（候选）；focus 336×208 雾团（当前所在）；
 *   cursor 97×90 青色选框（焦点）；connector 34×12 青色箭头。
 *
 * ⚠ 这些精灵在 `public/assets/local/roguelike/node/` 与 `plugins/mota/client/assets/local/roguelike/node/`
 *   **各放一份**：线上容器没有 `public/assets`（整棵 /assets 靠 CDN 302，而 CDN 没有 assets/local/），
 *   插件 client/** 会按同路径顶替页面资源（server/http/static.js 的 clientOverlay，先于 302），
 *   所以真正的取件路径是插件里那份。删掉插件副本 = 节点图只剩空底板。
 */
export const NODE_SPRITE = Object.freeze({
  plate: 'img_node_bkg.png',
  selectable: 'img_node_bkg_selectable.png',
  focus: 'img_focus.png',
  cursor: 'img_cursor.png',
  connector: 'img_connector.png',
  zoneDesc: 'img_zone_desc.png',
  relic: 'relic.png',
  ap: 'ap_drop.png',
});

/**
 * 类型 → 官方**英文标签**精灵（`img_tag_*.png`，206×21，白字）。
 * 官方中文客户端在节点图上显示的就是这些英文小标（COMBAT OPS. / EMERGENCY OPS. / …），
 * 中文名放到右侧详情栏与 aria-label，不在图上重复一遍。
 */
const TYPE_TAG = {
  battle: 'img_tag_battle.png',
  elite: 'img_tag_elite.png',
  boss: 'img_tag_boss.png',
  shop: 'img_tag_shop.png',
  rest: 'img_tag_rest.png',
  event: 'img_tag_incident.png',
  incident: 'img_tag_incident.png',
  wish: 'img_tag_treasure.png',
  unknown: 'img_tag_unknown.png',
};

/** 类型 → 标签精灵地址（未知类型也有官方 UNKNOWN FOG）。 */
function typeTag(type) {
  const f = TYPE_TAG[type];
  return f ? `${ROGUE_ASSET}/node/${f}` : `${ROGUE_ASSET}/node/img_tag_unknown.png`;
}

/** 类型 → 中文名（渲染时取，不在模块加载时锁死语言）。 */
function typeName(type) {
  switch (type) {
    case 'battle': return t('战斗');
    case 'elite': return t('精英');
    case 'boss': return t('首领');
    case 'shop': return t('商店');
    case 'rest': return t('休整');
    case 'event':
    case 'incident': return t('事件');
    case 'wish': return t('得偿所愿');
    default: return t('未知');
  }
}

const REWARD_ORDER = ['funds', 'lp', 'ap', 'deployCap'];
const REWARD_LABEL = () => ({ funds: t('资金'), lp: t('生命'), ap: t('AP'), deployCap: t('部署') });

/**
 * 地图页的格子配色：地面深绿、高台/墙浅蓝白（青色描边）、禁入**灰红**（不再用饱和暗红：第一眼像可玩区被围死）、
 * 其余近黑。禁入格另加斜纹（minimap 的 HATCH 图案），只靠颜色区分不出「禁入」时也能读出来。
 */
export const MAP_COLORS = Object.freeze({
  ground: '#1f4a2f',
  high: '#b9cce0',
  forbidden: '#4a2b31',
  blocked: '#0c1118',
  melee: '#ffc75a',
  ranged: '#5ad1a0',
  grid: 'rgba(0, 226, 228, .10)',
  hatch: 'rgba(206, 138, 140, .22)',
  // 出怪路线（2026-11-08）：橙红，和部署点的黄/绿区分开
  route: '#e85a1a',
});

/** 禁入格斜纹图案的 SVG id（一个面板里只有一张缩略图，固定 id 够用）。 */
const HATCH_ID = 'rpn-forbidden-hatch';

/** 主题底图张数区间（`roN/rogue_N_map_<from..to>.webp`；ro5 的 `sky_2` 不是地图，跳过）。 */
const BACKDROP_RANGE = Object.freeze({
  ro1: [1, 6],
  ro2: [1, 7],
  ro3: [1, 8],
  ro4: [1, 10],
  ro5: [0, 9],
  ro6: [0, 6],
});

// 藏品**没有**数量上限：官方肉鸽不设「每人 3 件」，服务端已取消这条（2026-11 对齐官方形态），
// 所以面板只显示已持有件数，不出现 `n/3` / `undefined/3` 这类残句。别再把上限常量加回来。

/** `g.rogueNode` 的意图消息（纯函数：面板与 node 单测共用，不在组件里拼协议字符串）。 */
export function nodeIntent(nodeId) {
  return { intent: 'g.rogueNode', payload: { nodeId: String(nodeId || '') } };
}

/** `pub.rogue.nodes`（没有 / 不是对象时 null）。 */
export function rogueNodes(pub) {
  const n = pub && pub.rogue ? pub.rogue.nodes : null;
  return n && typeof n === 'object' ? n : null;
}

/** tier 文案：数字 → T<n>；字母是肉鸽层级（t 精英 / d 补给 / ev 事件 / b 首领），一律中文（界面不留英文小标）。 */
export function tierLabel(tier) {
  const v = typeof tier === 'string' ? tier : String(tier || '');
  if (!v) return '';
  if (/^\d+$/.test(v)) return `T${v}`;
  if (v === 'b') return t('首领');
  if (v === 't') return t('精英');
  if (v === 'ev') return t('事件');
  if (v === 'd') return t('补给');
  return v.toUpperCase();
}

/** 奖励摘要：`资金+2 · AP+1`（未知键忽略；空则「无奖励」）。 */
export function rewardText(reward) {
  if (!reward || typeof reward !== 'object') return t('无奖励');
  const label = REWARD_LABEL();
  const parts = [];
  for (const k of REWARD_ORDER) {
    const v = Number(reward[k]);
    if (!Number.isFinite(v) || v === 0) continue;
    parts.push(`${label[k]}${v > 0 ? '+' : ''}${v}`);
  }
  return parts.length ? parts.join(' · ') : t('无奖励');
}

/** 类型图标地址（未知类型 → 官方 img_unknown.png）。 */
export function typeIcon(type) {
  const f = TYPE_ICON[type];
  return f ? `${ROGUE_ASSET}/node/${f}` : `${ROGUE_ASSET}/node/img_unknown.png`;
}

/** 类型色（未知类型 → 白）。 */
export function typeColor(type) {
  return TYPE_COLOR[type] || TYPE_COLOR.unknown;
}

/**
 * 层名去掉数据里自带的层级前缀：`第一层 · 荒废站台` → `荒废站台`。
 * 界面已经用顶部 chip / 详情「当前层」/ 时间轴数字表示第几层，再拼一遍就是「第 1 层 · 第一层 · 荒废站台」
 * （2026-11-04 第五轮视觉验收）。没有前缀时原样返回，不猜数据格式。
 * @param {string} name
 * @returns {string}
 */
export function layerTitle(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const m = /^第\s*[0-9一二三四五六七八九十百千零两]+\s*层\s*[·・:：]\s*(.+)$/.exec(s);
  return m ? m[1].trim() : s;
}

/**
 * 14 层时间轴：`sequence` 是拍平的全部节点（每层 3 个），每层只留一个圆点。
 * @returns {Array<{ key: string, index: number, name: string, type: string }>}
 */
export function layerTrail(nodes) {
  const seq = nodes && Array.isArray(nodes.sequence) ? nodes.sequence : [];
  const out = [];
  const seen = new Set();
  for (const n of seq) {
    if (!n || !n.layer || seen.has(n.layer)) continue;
    seen.add(n.layer);
    out.push({
      key: String(n.layer),
      index: out.length,
      name: String(n.layerName || n.layer),
      type: String(n.type || 'unknown'),
    });
  }
  return out;
}

/**
 * 节点图：一层一列、列内纵排该层节点（本数据每层 3 个），列间画连线（官方 IS #4/#5 的节点图形态）。
 *
 * 分组：`sequence` 已按层拍平，这里只走一遍按 `layer`（缺省退回 `layerName`，再缺省都并进一列）分列，
 *       列序 = 首次出现顺序 = 第 1 层 … 第 14 层。某层只有 1 个节点也只是「只有 1 行的列」，不补空位。
 * 状态：列 —— `nodes.index`（0 起算的当前层）之前的列 done、等于 index 的列 current、`nextRound - 1` 的列
 *       next（有 `nextChoices` 时）、其余 future；节点 —— id 出现在 `visited` / `current` / `picked` 任一处的是
 *       taken，当前层里没走到的那两个是 sibling，下一层里属于 `nextChoices` 的是 candidate（可点 = 真会改下一
 *       回合地图），其余是 skipped（已过但没走）/ future。
 * 连线（只有层数据、没有显式边，简化规则固定为三条，便于复核）：
 *       ① 下一列是候选层 → 本列「已走节点」（本列还没走则用列中点）分别连到下一列**每个候选节点**（分支）；
 *       ② 下一列已经有走过的节点 → 本列**全部节点**都连到它（收敛），其中来自本列已走节点的那条标记 active；
 *       ③ 其余（两个都还没到的未来层之间）→ 本列已走节点（没有则中点）到下一列中点的一条干线。
 *       行号都是列内下标，渲染时用 {@link graphRowPct} 折算成百分比 y，所以某层只有 1 个节点时落在 50%。
 * @param {object|null} nodes `pub.rogue.nodes`（没有 / 不是对象时返回空图）
 * @returns {{
 *   layers: Array<{ key: string, index: number, name: string, state: 'done'|'current'|'next'|'future',
 *     nodes: Array<{ id: string, type: string, name: string, tier: string, cost: number,
 *       state: 'taken'|'sibling'|'candidate'|'skipped'|'future', picked: boolean }> }>,
 *   links: Array<{ key: string, gap: number, kind: 'taken'|'candidate'|'trunk',
 *     segs: Array<{ fromRow: number, toRow: number, active: boolean }> }>,
 * }}
 */
export function nodeGraph(nodes) {
  const seq = nodes && Array.isArray(nodes.sequence) ? nodes.sequence : [];
  const visited = nodes && Array.isArray(nodes.visited) ? nodes.visited.map((v) => String(v)) : [];
  const taken = new Set(visited);
  const rawIndex = nodes ? Number(nodes.index) : -1;
  const index = Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : -1;
  // 「已走」的三个来源：`visited`（历次落地的 id）、`current`（当前落地的 id）、`picked`（本层真正落地的
  // id，服务端 `picks[li]`）。任一命中都算走过，任一处缺失时另外两处还能兜住。
  const currentId = nodes && nodes.current ? String(nodes.current) : '';
  const pickedId = nodes && nodes.picked ? String(nodes.picked) : '';
  if (currentId) taken.add(currentId);
  if (pickedId) taken.add(pickedId);
  const nextChoices = nodes && Array.isArray(nodes.nextChoices) ? nodes.nextChoices : [];
  const candIds = new Set(nextChoices.filter(Boolean).map((n) => String(n.id)));
  const nextRound = Number(nodes && nodes.nextRound) || 0;
  const nextIndex = candIds.size && nextRound > 0 ? nextRound - 1 : -1;
  const nextPicked = nodes && nodes.nextPicked ? String(nodes.nextPicked) : '';
  // 候选↔具体关卡（2026-11-08）：服务端只在 choices / nextChoices 上带 `stageId`（sequence 不带，省帧），
  // 这里并成一张表，下面的节点对象照 id 取 —— 点候选时详情才能直接预览那张图和它的出怪路线。
  const stageById = new Map();
  for (const src of [nodes && nodes.choices, nextChoices, nodes && nodes.sequence]) {
    if (!Array.isArray(src)) continue;
    for (const n of src) if (n && n.id != null && n.stageId) stageById.set(String(n.id), String(n.stageId));
  }

  // —— 分组：按 layer 首现顺序分列（一遍遍历，单层 1 个节点也不丢）——
  const layers = [];
  const byKey = new Map();
  for (const n of seq) {
    if (!n || n.id === undefined || n.id === null || n.id === '') continue;
    const key = String(n.layer || n.layerName || 'layer-1');
    let col = byKey.get(key);
    if (!col) {
      // 区域（2026-11-09）：同 region 的若干列在聚焦视图里拼成「当前区域的一整张图」
      col = { key, index: layers.length, name: String(n.layerName || n.layer || ''), state: 'future', nodes: [],
        region: String(n.region || ''), regionName: String(n.regionName || '') };
      byKey.set(key, col);
      layers.push(col);
    }
    col.nodes.push({
      id: String(n.id),
      type: String(n.type || 'unknown'),
      name: String(n.name || ''),
      tier: n.tier == null ? '' : String(n.tier),
      cost: Number(n.cost) || 0,
      // 候选绑定的具体关卡（服务端 2026-11-08 起下发）：节点图详情据此直接预览这张图与它的出怪路线
      stageId: n.stageId ? String(n.stageId) : (stageById.get(String(n.id)) || ''),
      state: 'future',
      picked: false,
    });
  }

  // —— 列 / 节点状态 ——
  for (const col of layers) {
    col.state = col.index < index ? 'done'
      : col.index === index ? 'current'
        : col.index === nextIndex ? 'next'
          : 'future';
    for (const n of col.nodes) {
      if (taken.has(n.id)) n.state = 'taken';
      else if (col.state === 'current') n.state = 'sibling';
      else if (col.state === 'next') n.state = candIds.has(n.id) ? 'candidate' : 'skipped';
      else n.state = col.state === 'done' ? 'skipped' : 'future';
      n.picked = n.state === 'candidate' && n.id === nextPicked;
    }
  }

  // —— 连线（规则 ①②③，见函数头）——
  const mid = (col) => Math.floor((col.nodes.length - 1) / 2);
  const rowOfTaken = (col) => col.nodes.findIndex((n) => n.state === 'taken');
  const links = [];
  for (let i = 0; i < layers.length - 1; i++) {
    const a = layers[i];
    const b = layers[i + 1];
    const fromRow = rowOfTaken(a);
    const bTaken = rowOfTaken(b);
    const candRows = b.nodes.map((n, r) => (n.state === 'candidate' ? r : -1)).filter((r) => r >= 0);
    const segs = [];
    if (candRows.length) {
      const src = fromRow >= 0 ? [fromRow] : [mid(a)];
      for (const fr of src) for (const tr of candRows) segs.push({ fromRow: fr, toRow: tr, active: true });
      links.push({ key: `g${i}`, gap: i, kind: 'candidate', segs });
    } else if (bTaken >= 0) {
      for (const fr of a.nodes.map((_, r) => r)) segs.push({ fromRow: fr, toRow: bTaken, active: fr === fromRow });
      links.push({ key: `g${i}`, gap: i, kind: 'taken', segs });
    } else {
      segs.push({ fromRow: fromRow >= 0 ? fromRow : mid(a), toRow: mid(b), active: false });
      links.push({ key: `g${i}`, gap: i, kind: 'trunk', segs });
    }
  }
  return { layers, links };
}

/**
 * 列内第 `row` 个节点的纵向中心（百分比）：列内节点等高分布，所以 1 个节点时是 50%、3 个时是 16.7/50/83.3。
 * 渲染（`.rpn-graph__stack` 的 `repeat(n, 1fr)` + 居中）与连线 SVG 共用同一条公式，线才落在节点中心。
 */
function graphRowPct(col, row) {
  const rows = Math.max(1, col && Array.isArray(col.nodes) ? col.nodes.length : 1);
  return ((row + 0.5) / rows) * 100;
}

/**
 * 节点图里按 id 找节点（点图上的节点 → 右栏详情用）。
 * @param {ReturnType<typeof nodeGraph>} graph
 * @param {string} id
 * @returns {{ node: object, layer: object }|null}
 */
export function graphNode(graph, id) {
  const want = String(id || '');
  if (!want || !graph || !Array.isArray(graph.layers)) return null;
  for (const layer of graph.layers) {
    const node = layer.nodes.find((n) => n.id === want);
    if (node) return { node, layer };
  }
  return null;
}

/**
 * 可点击的那组候选：优先**下一层**（改得到下一回合的地图），没有下一层（最终层）时退回本层，只作展示。
 * @returns {{ list: object[], round: number, picked: string|null, isFinal: boolean, label: string }}
 */
export function choiceList(nodes) {
  const next = nodes && Array.isArray(nodes.nextChoices) ? nodes.nextChoices : [];
  const current = nodes && Array.isArray(nodes.choices) ? nodes.choices : [];
  const isFinal = next.length === 0;
  return {
    list: isFinal ? current : next,
    round: Number(isFinal ? (nodes && nodes.round) : (nodes && nodes.nextRound)) || 0,
    picked: (isFinal ? (nodes && nodes.picked) : (nodes && nodes.nextPicked)) || null,
    isFinal,
    label: isFinal ? t('本层候选') : t('下一层'),
  };
}

/** stageId → 主题号（`rogue_ro4_1-2` → `ro4`；不是肉鸽图返回 null）。 */
export function rogueThemeOf(stageId) {
  const m = /^rogue_(ro\d+)_/.exec(String(stageId || ''));
  return m ? m[1] : null;
}

/**
 * stageId → 界面短名：`rogue_ro5_1-2_dlc1` → `RO5 · 1-2 · DLC1`。
 * 界面任何位置都不再出现 `rogue_ro...` 原始串（见文件头）；不是肉鸽图返回 ''，调用方显示「—」。
 * DLC 后缀统一保留（省略会让 ro5 的 `4-1_dlc1` / `4-1_dlc2` 两张图读成同一关）。
 * @param {string} stageId
 * @returns {string}
 */
export function mapLabel(stageId) {
  const m = /^rogue_(ro\d+)_([0-9a-z]+(?:-[0-9a-z]+)*?)(?:_dlc(\d+))?$/i.exec(String(stageId || ''));
  if (!m) return '';
  const dlc = m[3] ? ` · DLC${m[3]}` : '';
  return `${m[1].toUpperCase()} · ${m[2]}${dlc}`;
}

/**
 * 主题官方底图（按 stageId 稳定选一张：同一关每次打开都是同一张，不闪）。
 * 素材缺失 / 非肉鸽图 → null（地图页只画不自造路径）。
 */
export function backdropPath(stageId) {
  const theme = rogueThemeOf(stageId);
  if (!theme) return null;
  const range = BACKDROP_RANGE[theme];
  if (!range) return null;
  const num = Number(theme.slice(2));
  const span = range[1] - range[0] + 1;
  const source = String(stageId);
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (h * 31 + source.charCodeAt(i)) >>> 0;
  const idx = range[0] + (h % span);
  return `${ROGUE_ASSET}/${theme}/rogue_${num}_map_${idx}.webp`;
}

/**
 * 藏品列表：`priv.relicCards`（有名称/品阶/实装标记）优先，`pub.rogue.relics` 作后备（可能只有 id）。
 * @returns {Array<{ id, name, tier, kind, icon, desc, applied }>}
 */
export function relicList(pub, relicCards) {
  const cards = Array.isArray(relicCards) ? relicCards : [];
  const raw = pub && pub.rogue && Array.isArray(pub.rogue.relics) ? pub.rogue.relics : [];
  if (cards.length) {
    return cards.map((c) => ({
      id: String(c.id || ''),
      name: String(c.name || c.id || ''),
      tier: String(c.tier || ''),
      kind: String(c.kind || ''),
      icon: String(c.icon || ''),
      desc: String(c.desc || ''),
      applied: c.applied !== false,
    }));
  }
  return raw.map((r) => (typeof r === 'string'
    ? { id: r, name: r, tier: '', kind: '', icon: '', desc: '', applied: true }
    : {
      id: String(r && r.id || ''),
      name: String((r && r.name) || (r && r.id) || ''),
      tier: String(r && r.tier || ''),
      kind: String(r && r.kind || ''),
      icon: String(r && r.icon || ''),
      desc: String(r && r.desc || ''),
      applied: !r || r.applied !== false,
    }));
}

/** 类名拼接（不引第三方）。 */
const cls = (...parts) => parts.filter(Boolean).join(' ');

/** 候选 id → 名称（找不到返回空串；详情页与时间轴都用它，不猜 id 的写法）。 */
export function pickText(id, list) {
  const want = String(id || '');
  if (!want) return '';
  const hit = (Array.isArray(list) ? list : []).find((n) => n && String(n.id) === want);
  return hit ? String(hit.name || hit.id || '') : '';
}

/**
 * 下一层预览的「地图标签」：tier 决定下一回合打哪张官方图（plugins/roguelike-core 的 `rogueStageFor`：
 * `rogue_ro<主题号>_<tier>-*`，同 tier 多张时按 seed 稳定取一张），所以预览只能给 **主题前缀 + tier**，不是具体关卡：
 * `RO5 · T1`（拿不到主题时只给 tier 文案）。不拼 `rogue_ro...` 原始串。
 * @param {string|number} tier @param {string} mapId 本局的 `nodes.mapId`（取主题号）
 * @returns {string}
 */
export function mapTierLabel(tier, mapId) {
  const label = tierLabel(tier);
  if (!label) return '';
  const theme = rogueThemeOf(mapId);
  return theme ? `${theme.toUpperCase()} · ${label}` : label;
}

/**
 * 地图统计（地图页右栏信息卡）：按 `buildMinimapModel` 的 `kinds` / `marks` 数格子与部署点，只读不新造数据。
 * @param {{ kinds?: string[][], marks?: Array<{ kind: string }> }|null} model
 * @returns {{ ground:number, high:number, forbidden:number, blocked:number, melee:number, ranged:number, cells:number }|null}
 */
export function minimapStats(model) {
  if (!model || !Array.isArray(model.kinds)) return null;
  const out = { ground: 0, high: 0, forbidden: 0, blocked: 0, melee: 0, ranged: 0, cells: 0 };
  for (const row of model.kinds) {
    for (const kind of (Array.isArray(row) ? row : [])) {
      out.cells += 1;
      if (kind === TERRAIN.GROUND) out.ground += 1;
      else if (kind === TERRAIN.HIGH) out.high += 1;
      else if (kind === TERRAIN.FORBIDDEN) out.forbidden += 1;
      else out.blocked += 1;
    }
  }
  for (const m of (Array.isArray(model.marks) ? model.marks : [])) {
    if (!m) continue;
    if (m.kind === 'melee') out.melee += 1;
    else if (m.kind === 'ranged') out.ranged += 1;
  }
  return out;
}

/**
 * 当前层的节点（详情列用）：优先 `nodes.picked`（本层真正落地的那个），其次 `nodes.current`，再从本层候选里按
 * `tier` 兜一层；都没有返回 null（还没开局）。
 * @returns {object|null}
 */
export function currentChoice(nodes) {
  const list = Array.isArray(nodes && nodes.choices) ? nodes.choices : [];
  const id = String((nodes && (nodes.picked || nodes.current)) || '');
  if (id) {
    const hit = list.find((n) => n && String(n.id) === id);
    if (hit) return hit;
  }
  const tier = nodes && nodes.tier != null ? String(nodes.tier) : '';
  if (!tier) return null;
  return list.find((n) => n && String(n.tier) === tier) || null;
}

/** 下一层预览：`nextChoices`（最终层为空），每组候选的 tier 决定下一回合的地图前缀。 */
export function previewChoices(nodes) {
  const next = nodes && Array.isArray(nodes.nextChoices) ? nodes.nextChoices : [];
  return next;
}

/** 难度条比例：数字 tier 是肉鸽层级 1–7，字母层级（t 精英 / b 首领 / ev 事件 / d 补给）给一个固定档。 */
export function difficultyFrac(tier) {
  const v = tier == null ? '' : String(tier);
  if (/^\d+$/.test(v)) return Math.max(0, Math.min(1, Number(v) / 7));
  if (v === 'd') return .2;
  if (v === 'ev') return .35;
  if (v === 't') return .7;
  if (v === 'b') return 1;
  return .3;
}

/** tab 表（渲染时取标签）。 */
const tabList = () => [
  { id: 'nodes', label: t('节点') },
  { id: 'map', label: t('地图') },
  { id: 'relics', label: t('藏品') },
];

/**
 * 一列到下一列的连线（内联 SVG，一条线一个 `<line>`）：
 * viewBox 固定 0–100，`preserveAspectRatio="none"` 把 x 拉伸到「本列中心 → 下一列中心」这段宽度
 * （CSS 里 SVG 的 `left:50%` + `width: calc(100% + 列间距)` 就是这个区间），y 用同一条百分比公式，
 * `vector-effect="non-scaling-stroke"` 保证线宽不被 x/y 的非等比缩放拉扁。
 * @param {{ key: string, kind: string, segs: Array<{ fromRow: number, toRow: number, active: boolean }> }} link
 * @param {object} col 本列 @param {object} next 下一列（行数可能不同）
 */
function graphLink(link, col, next) {
  return html`<svg class="rpn-graph__links" viewBox="0 0 100 100" preserveAspectRatio="none"
      aria-hidden="true" focusable="false">
    ${link.segs.map((s, i) => html`<line key=${`${link.key}-${i}`}
      x1="0" y1=${graphRowPct(col, s.fromRow)} x2="100" y2=${graphRowPct(next, s.toRow)}
      class=${cls('rpn-graph__wire', `is-${link.kind}`, s.active && 'is-active')}
      vector-effect="non-scaling-stroke" />`)}
  </svg>`;
}

/**
 * 集成战略叠加面板。
 * @param {{
 *   pub: object|null,
 *   relicCards?: Array|null,
 *   open?: boolean,
 *   blocked?: boolean,
 *   onClose?: () => void,
 *   onPickNode?: (intent: string, payload: object) => Promise<unknown>|unknown,
 * }} props
 */
export function RoguePanel({ pub, relicCards = null, myVote = null, open = false, blocked = false, onClose, onPickNode }) {
  const stagesReady = useData('stages');
  // 出怪路线要读 waves 表（rogue_* 关卡 id 就是 waves 的 key）：不订阅的话首次打开可能还没加载
  const wavesReady = useData('waves');
  const [tab, setTab] = useState('nodes');
  const [busy, setBusy] = useState(null);
  // 节点图上「被点开看详情」的节点 id（只影响右下详情栏，不发送任何意图）
  const [focusId, setFocusId] = useState(null);
  // 节点图视图（2026-11-08）：'focus' = 只画「本层 + 下一层」并配一条区域进度（官方就是这个节奏，
  // 也避免一开局就把 14 层全剧透）；'all' = 原来的 14 层总览，随时可切回。
  const [graphView, setGraphView] = useState('focus');
  // 关掉面板时清忙态与详情焦点：下一次打开不该继承上一张卡片的 spinner / 上一局的选中项
  useEffect(() => { if (!open) { setBusy(null); setFocusId(null); } }, [open]);

  const rogue = pub && pub.rogue ? pub.rogue : null;
  if (!open || !rogue) return null;

  const nodes = rogueNodes(pub);
  const graph = nodeGraph(nodes);
  const picks = choiceList(nodes);
  const relics = relicList(pub, relicCards);
  // 节点投票（2026-11-09）：票数在 pub.rogue.nodes.votes（按 nodeId），我投的那一票在 priv.rogueVote
  const voteCounts = nodes && nodes.votes && typeof nodes.votes === 'object' ? nodes.votes : {};
  const voteCast = Number(nodes && nodes.votedCount) || 0;
  const voteTotal = Math.max(Number(nodes && nodes.voterCount) || 0, 1);
  const voteWinner = nodes && nodes.voteWinner ? String(nodes.voteWinner) : '';
  const myVoteId = myVote ? String(myVote) : '';
  const currentIndex = nodes && Number.isFinite(Number(nodes.index)) ? Number(nodes.index) : -1;
  const ap = Number(nodes && nodes.ap) || 0;
  const maxAp = Math.max(Number(nodes && nodes.maxAp) || 0, ap, 1);
  const layerName = nodes && nodes.layerName ? String(nodes.layerName) : '';
  const round = Number(pub && pub.round) || 0;
  const lastRound = Number(pub && pub.lastRound) || 0;
  const affix = rogue.affix && rogue.affix.label ? String(rogue.affix.label) : '';
  const canSend = typeof onPickNode === 'function' && !blocked;
  // 详情列要用的派生值（全部只读 `pub.rogue.nodes` / 节点图，不新造字段）
  const cur = currentChoice(nodes);
  const curCol = currentIndex >= 0 ? graph.layers[currentIndex] || null : null;
  const curTaken = curCol ? curCol.nodes.find((n) => n.state === 'taken') || null : null;
  const curType = (cur && cur.type ? String(cur.type) : '') || (curTaken ? curTaken.type : '');
  const curTier = cur && cur.tier != null ? cur.tier : (nodes && nodes.tier != null ? nodes.tier : '');
  const curMapId = nodes && nodes.mapId ? String(nodes.mapId) : '';
  // 当前这一局的关卡：`pub.stageId`（缩略图读的那张）优先，其次 `nodes.mapId`；两者都只作 `mapLabel` 的输入
  const stageIdNow = (pub && pub.stageId ? String(pub.stageId) : '') || curMapId;
  const mapName = mapLabel(stageIdNow);
  const themeNo = rogueThemeOf(stageIdNow);
  // 详情栏「下一层预览」：候选的 tier 决定下一回合打哪张图（具体哪张由服务端 seed 定），只给主题 + tier
  const preview = previewChoices(nodes);

  const pick = async (nodeId) => {
    if (!canSend || busy) return;
    const { intent, payload } = nodeIntent(nodeId);
    setBusy(String(nodeId));
    try {
      await onPickNode(intent, payload);
    } catch (e) {
      // 拒绝 / 断线由对局页的统一错误提示处理，这里只解除忙态
    } finally {
      setBusy(null);
    }
  };

  // 失与得：点「换出」把这一件（relicId）发给服务端 —— 复用 `g.relicPick` 的第一阶段（服务端把没定换出时的
  // relicId 当换出 id），不新增意图。之后服务端按档位重发换入候选，藏品弹窗里选。
  const swapOut = async (relicId) => {
    if (!canSend || busy || !relicId) return;
    setBusy('swap:' + relicId);
    try {
      await onPickNode('g.relicPick', { relicId });
    } catch (e) {
      // 同上：错误提示归对局页，这里只解除忙态
    } finally {
      setBusy(null);
    }
  };
  const swapPending = relicSwapPending();

  const stage = stagesReady && pub && pub.stageId ? data.lookup('stages', pub.stageId) : null;
  // 出怪路线（2026-11-08）：waves.json 的 routes[].steps 是真实折线，和缩略图一起画出来。
  const stageWave = wavesReady && pub && pub.stageId ? data.lookup('waves', pub.stageId) : null;
  const model = tab === 'map' ? buildMinimapModel(stage, stageWave) : null;
  const backdrop = tab === 'map' ? backdropPath(pub && pub.stageId) : null;
  const mapStats = tab === 'map' ? minimapStats(model) : null;

  // 节点图的一次点击（2026-11-08 改）：**只切详情焦点**，不再当场发包 —— 先看清这张图与路线，
  // 详情栏的「前往此节点」才是提交。以前的「点一下就出发」是这次体验差的主因。
  const selectNode = (n) => {
    setFocusId(String(n.id));
  };
  const focus = focusId ? graphNode(graph, focusId) : null;
  // 焦点节点绑定的那张图（服务端下发 stageId）+ 它的出怪路线：详情栏直接预览，选之前就看得到。
  const focusStageId = focus && focus.node && focus.node.stageId ? focus.node.stageId : '';
  const focusStage = focusStageId && stagesReady ? data.lookup('stages', focusStageId) : null;
  const focusWave = focusStageId && wavesReady ? data.lookup('waves', focusStageId) : null;
  const focusModel = focusStage ? buildMinimapModel(focusStage, focusWave) : null;
  const focusIsCandidate = !!(focus && focus.node && focus.node.state === 'candidate');
  const focusPicked = !!(focus && focus.node && focus.node.picked);
  const canConfirm = focusIsCandidate && !focusPicked && canSend && busy === null && picks.isFinal !== true;

  // —— 区域分组（顶栏进度 / 区域图 / 区域圆点共用；官方是「区域 → 一张多列关卡图」）——
  const regions = [];
  for (const c of graph.layers) {
    const key = c.region || c.key;
    let r = regions.find((x) => x.id === key);
    if (!r) { r = { id: key, name: c.regionName || c.name, cols: [] }; regions.push(r); }
    r.cols.push(c);
  }
  const regionState = (r) => (r.cols.some((c) => c.state === 'current') ? 'current'
    : r.cols.some((c) => c.state === 'next') ? 'next'
      : r.cols.every((c) => c.state === 'done') ? 'done' : 'future');
  const curRegion = regions.find((r) => regionState(r) === 'current')
    || regions.find((r) => regionState(r) === 'next') || regions[0] || null;
  const layerNo = currentIndex >= 0 ? currentIndex + 1 : 1;
  const doneCols = Math.max(0, Math.min(currentIndex + 1, graph.layers.length));
  // 官方的节点图是**一回合一张**（业主 2026-11-09 第二轮）：只画「当前所在列 + 下一回合候选列」两列，
  // 节点放大到官方尺寸；进度交给顶部线路图。右上角仍可切「全部回合」看 14 列总览。
  const nextIdx = currentIndex >= 0 ? currentIndex + 1 : 0;
  const nextCol = graph.layers[nextIdx] || null;
  const boardCols = graphView === 'all'
    ? graph.layers
    : [curCol, nextCol].filter((c) => !!c);
  const sprite = (f) => `${ROGUE_ASSET}/node/${f}`;
  const railGlyph = (id) => (id === 'map' ? 'expand' : id === 'relics' ? 'box' : 'chevrons');

  // —— 顶栏（方舟信息页的头）：层号块 + 区域名 + 资源条 + 视图切换 + 关闭 ——
  const topBar = html`<header class="rpn-top">
    <div class="rpn-top__id">
      <span class="rpn-top__no">${String(layerNo).padStart(2, '0')}</span>
      <span class="rpn-top__names">
        <b class="rpn-top__region">${curRegion ? (layerTitle(curRegion.name) || curRegion.name) : t('集成战略')}</b>
        <i class="rpn-top__sub">INTEGRATED STRATEGIES · ${t('第 {n} 层', { n: layerNo })} / ${graph.layers.length || '—'}</i>
      </span>
    </div>
    <ul class="rpn-top__res">
      <li class="rpn-res"><img class="rpn-res__ico" src=${sprite(NODE_SPRITE.ap)} alt="" aria-hidden="true" />
        <b class="rpn-res__val">${ap}<span class="rpn-res__max">/${maxAp}</span></b>
        <span class="rpn-res__lb">AP</span></li>
      <li class="rpn-res"><img class="rpn-res__ico" src=${sprite(NODE_SPRITE.relic)} alt="" aria-hidden="true" />
        <b class="rpn-res__val">${relics.length}</b><span class="rpn-res__lb">${t('藏品')}</span></li>
      <li class="rpn-res"><b class="rpn-res__val">${round}${lastRound ? html`<span class="rpn-res__max">/${lastRound}</span>` : null}</b>
        <span class="rpn-res__lb">${t('回合')}</span></li>
      ${affix ? html`<li class="rpn-res is-affix"><b class="rpn-res__val">${affix}</b><span class="rpn-res__lb">${t('词缀')}</span></li>` : null}
    </ul>
    <div class="rpn-top__act">
      ${tab === 'nodes' ? html`<button type="button" class=${cls('rpn-top__btn', graphView === 'all' && 'is-on')}
        data-testid="rogue-nodes-view" aria-pressed=${graphView === 'all' ? 'true' : 'false'}
        onClick=${() => setGraphView(graphView === 'all' ? 'focus' : 'all')}>
        ${graphView === 'all' ? t('本回合视图') : t('全部回合')}</button>` : null}
      <button type="button" class="rpn-top__close" aria-label=${t('关闭集成战略')} title=${t('关闭')}
        data-testid="rogue-panel-close" onClick=${() => onClose && onClose()}><${Icon} name="close" /></button>
    </div>
  </header>`;

  // —— 左竖排导航（方舟的侧栏）：节点 / 地图 / 藏品 ——
  const railTabs = html`<nav class="rpn-rail" role="tablist" aria-label=${t('集成战略页面')}>
    ${tabList().map((tb) => html`<button key=${tb.id} type="button" role="tab" id=${`rpn-tab-${tb.id}`}
      aria-selected=${tab === tb.id} aria-controls=${`rpn-page-${tb.id}`} data-tab=${tb.id}
      class=${cls('rpn-rail__tab', tab === tb.id && 'is-on')} onClick=${() => setTab(tb.id)}>
      <span class="rpn-rail__ico" aria-hidden="true"><${Icon} name=${railGlyph(tb.id)} /></span>
      <span class="rpn-rail__lb">${tb.label}</span></button>`)}
  </nav>`;

  // 一个图上的节点（两种视图共用；点它只是切详情，发包在右侧「前往此节点」）。
  // 全部由官方精灵拼成：底板 img_node_bkg(.selectable) + 图标 img_*_active + 英文标签 img_tag_*；
  // 当前所在节点背后垫 img_focus 雾团，被点开的节点套 img_cursor 选框。
  const nodeBtn = (n, col) => {
    if (n.state === 'future') {
      // 未到的列只画占位：官方在没走到之前不告诉你下一个节点是什么（也不给点开看地图）
      return html`<span key=${n.id} class="rpn-node is-future is-locked" data-node-id=${n.id}
        data-graph-node="1" data-state="future" data-layer=${col.key} aria-hidden="true">
        <img class="rpn-node__plate" src=${sprite(NODE_SPRITE.plate)} alt="" />
        <span class="rpn-node__q">?</span>
      </span>`;
    }
    const focused = focusId === String(n.id);
    const votes = Number(voteCounts[n.id]) || 0;
    const mine = myVote && String(myVote) === String(n.id);
    return html`<button key=${n.id} type="button"
      class=${cls('rpn-node', `is-${n.state}`, n.picked && 'is-picked', focused && 'is-focus',
        mine && 'is-myvote', n.state === 'candidate' && !canSend && 'is-readonly')}
      style=${`--c:${typeColor(n.type)}`}
      data-node-id=${n.id} data-graph-node="1" data-type=${n.type} data-state=${n.state}
      data-layer=${col.key} data-votes=${votes}
      aria-current=${n.state === 'taken' ? 'true' : null}
      aria-label=${`${t('第 {n} 层', { n: col.index + 1 })} · ${n.name || typeName(n.type)} · ${typeName(n.type)}${n.tier ? ` · ${tierLabel(n.tier)}` : ''}${n.cost ? ` · -${n.cost} AP` : ''}${votes ? ` · ${t('{n} 票', { n: votes })}` : ''}`}
      title=${`${n.name || typeName(n.type)} · ${typeName(n.type)}${n.tier ? ` · ${tierLabel(n.tier)}` : ''}${votes ? ` · ${t('{n} 票', { n: votes })}` : ''}`}
      onClick=${() => selectNode(n)}>
      ${n.state === 'taken' && col.state === 'current'
        ? html`<img class="rpn-node__mist" src=${sprite(NODE_SPRITE.focus)} alt="" aria-hidden="true" />` : null}
      ${n.state === 'candidate'
        ? html`<img class="rpn-node__glow" src=${sprite(NODE_SPRITE.selectable)} alt="" aria-hidden="true" />` : null}
      <img class="rpn-node__plate" src=${sprite(NODE_SPRITE.plate)} alt="" aria-hidden="true" />
      <img class="rpn-node__icon" src=${typeIcon(n.type)} alt="" aria-hidden="true" />
      <img class="rpn-node__tag" src=${typeTag(n.type)} alt="" aria-hidden="true" />
      ${n.state === 'taken' ? html`<span class="rpn-node__ok" aria-hidden="true">✓</span>` : null}
      ${votes ? html`<span class="rpn-node__vote" aria-hidden="true">${votes}</span>` : null}
      ${focused ? html`<img class="rpn-node__cur" src=${sprite(NODE_SPRITE.cursor)} alt="" aria-hidden="true" />` : null}
    </button>`;
  };

  // 一列：列头（回合号 + 本回合/下一回合）+ 该列节点 + 与下一列的连线
  const colLabel = (col) => (col.state === 'current' ? t('本回合')
    : col.state === 'next' ? t('下一回合')
      : col.state === 'done' ? t('已通过')
        : t('第 {n} 回合', { n: col.index + 1 }));
  const graphColumn = (col, opts = {}) => {
    const link = graph.links.find((l) => l.gap === col.index) || null;
    const next = link ? graph.layers[col.index + 1] : null;
    const sameRegion = !!next && (next.region || next.key) === (col.region || col.key);
    const drawLink = !!link && !!next && (opts.all === true || sameRegion);
    return html`<div key=${col.key} class=${cls('rpn-col', `is-${col.state}`)}
        data-layer=${col.key} data-layer-state=${col.state}>
      <div class="rpn-col__head">
        <span class="rpn-col__no">${String(col.index + 1).padStart(2, '0')}</span>
        <span class="rpn-col__lb">${colLabel(col)}</span>
      </div>
      <div class="rpn-col__stack" style=${`--rows:${Math.max(col.nodes.length, 1)}`}>
        ${drawLink ? graphLink(link, col, next) : null}
        ${col.nodes.map((n) => nodeBtn(n, col))}
      </div>
    </div>`;
  };

  // —— 本局线路图（官方那种「一条线走完一局」的指示）：14 个回合圆点按区域分段，
  //    已过 = 金实心、当前 = 白环、下一回合 = 青环、未到 = 暗空心；区域之间留一道分隔。 ——
  const routeStrip = html`<ol class="rpn-route" aria-label=${t('本局线路')}>
    ${regions.map((r, ri) => html`<li key=${r.id} class=${cls('rpn-route__seg', `is-${regionState(r)}`)}>
      ${r.cols.map((c) => html`<i key=${c.key} class=${cls('rpn-route__pip', `is-${c.state}`)}
        title=${`${t('第 {n} 回合', { n: c.index + 1 })}${c.name ? ` · ${layerTitle(c.name) || c.name}` : ''}`}></i>`)}
      ${ri < regions.length - 1 ? html`<s class="rpn-route__sep" aria-hidden="true"></s>` : null}
    </li>`)}
    <li class="rpn-route__now">${curRegion ? (layerTitle(curRegion.name) || curRegion.name) : ''}</li>
  </ol>`;

  // —— 右侧详情栏（方舟的信息页）：被点开的节点优先，没点开就显示当前所在节点 ——
  const inspNode = focus ? focus.node : (curTaken || null);
  const inspLayer = focus ? focus.layer : curCol;
  const inspType = inspNode && inspNode.type ? String(inspNode.type) : curType;
  const inspStage = focus ? focusStageId : stageIdNow;
  const inspModel = focus ? focusModel
    : (tab === 'nodes' && stage ? buildMinimapModel(stage, stageWave) : null);
  const inspTier = inspNode && inspNode.tier != null ? inspNode.tier : curTier;
  const inspCost = inspNode && Number(inspNode.cost) ? Number(inspNode.cost) : 0;
  const inspActionable = !!(focus && (focusIsCandidate || focusPicked));
  const inspector = html`<aside class="rpn-insp" aria-label=${t('节点详情')} data-insp=${focus ? 'focus' : 'current'}>
    <div class="rpn-insp__head" style=${`--c:${typeColor(inspType)}`}>
      <div class="rpn-insp__top">
        <span class="rpn-insp__kind">${inspType ? typeName(inspType) : '—'}</span>
        <span class="rpn-insp__cost">${inspCost ? `-${inspCost} AP` : t('免费')}</span>
      </div>
      <h3 class="rpn-insp__name">${inspNode ? (inspNode.name || typeName(inspNode.type)) : t('尚未开局')}</h3>
      <p class="rpn-insp__meta">${inspLayer ? t('第 {n} 层', { n: inspLayer.index + 1 }) : '—'}${inspLayer && inspLayer.name ? ` · ${layerTitle(inspLayer.name) || inspLayer.name}` : ''}${inspTier !== '' ? ` · ${tierLabel(inspTier)}` : ''}</p>
    </div>
    <div class="rpn-insp__map" data-testid="rpn-focus-map">
      ${inspModel ? minimap(inspModel) : html`<p class="rpn-insp__none">${t('战场缩略图待载入…')}</p>`}
    </div>
    <p class="rpn-insp__note">${inspStage ? (mapLabel(inspStage) || '—') : '—'}${inspModel && inspModel.routes.length ? ` · ${t('出怪路线 {n} 条', { n: inspModel.routes.length })}` : ''}</p>
    <dl class="rpn-insp__kv">
      <div><dt>${t('进度')}</dt><dd>${graph.layers.length ? `${doneCols} / ${graph.layers.length}` : '—'}</dd></div>
      <div><dt>${t('奖励')}</dt><dd>${rewardText(inspNode && inspNode.reward)}</dd></div>
      <div><dt>${t('藏品')}</dt><dd>${relics.length}</dd></div>
    </dl>
    <div class="rpn-insp__sec">
      <h4 class="rpn-insp__h">${t('难度')}</h4>
      <div class="rpn-insp__reward">
        <span class="rpn-insp__diff">${inspTier !== '' ? tierLabel(inspTier) : t('未知')}</span>
        <span class="rpn-insp__cost">${inspCost ? `${t('消耗')} -${inspCost} AP` : t('免费')}</span>
      </div>
      <div class="rpn-insp__meter" aria-hidden="true"><i style=${`width:${Math.round(difficultyFrac(inspTier) * 100)}%`}></i></div>
    </div>
    <div class="rpn-insp__sec">
      <h4 class="rpn-insp__h">${t('下一层预览')}</h4>
      ${preview.length ? html`<ul class="rpn-insp__next">
        ${preview.map((n) => html`<li key=${n.id} class=${cls('rpn-insp__nextrow', picks.picked === n.id && 'is-picked')}
            style=${`--c:${typeColor(n.type)}`}>
          <i class="rpn-insp__dot" aria-hidden="true"></i>
          <span class="rpn-insp__nextname">${n.name || typeName(n.type)}</span>
          <span class="rpn-insp__nextmap">${mapTierLabel(n.tier, curMapId || stageIdNow) || '—'}</span>
        </li>`)}
      </ul>` : html`<p class="rpn-insp__hint">${t('已是最终层：没有下一层候选。')}</p>`}
    </div>
    <div class="rpn-insp__foot">
      ${blocked ? html`<span class="rpn-insp__warn">${t('战斗中不可选')}</span>` : null}
      ${!canSend && !blocked ? html`<span class="rpn-insp__warn">${t('只读：拿不到对局网络')}</span>` : null}
      ${inspActionable && !voteWinner ? html`<p class="rpn-insp__vote">
        ${t('投票 {a}/{b}', { a: voteCast, b: voteTotal })}</p>` : null}
      ${inspActionable
        ? (voteWinner
          ? html`<span class="rpn-insp__done">${t('本回合前往：{n}', { n: pickText(voteWinner, preview) || voteWinner })}</span>`
          : (myVoteId && myVoteId === String(focus.node.id)
            ? html`<span class="rpn-insp__done">${t('已投票 · 等待 {a}/{b}', { a: voteCast, b: voteTotal })}</span>`
            : html`<button type="button" class="rpn-confirm" disabled=${!canConfirm}
                onClick=${() => pick(focus.node.id)}>${t('投票给此节点')}${focus.node.cost ? `（-${focus.node.cost} AP）` : ''}</button>`))
        : html`<p class="rpn-insp__hint">${picks.isFinal ? t('最终层：本局已结算') : t('在图上点节点查看详情')}</p>`}
    </div>
  </aside>`;

  // 候选条兜底：候选在图上找不到（服务端没下发 sequence，或 nextRound 对不上）时至少还能选
  const graphCandCount = graph.layers.reduce((s, c) => s + c.nodes.filter((n) => n.state === 'candidate').length, 0);
  const fallbackStrip = (picks.list.length && !graphCandCount && !picks.isFinal)
    ? html`<div class="rpn-fallback">
      <b class="rpn-fallback__lb">${picks.label}</b>
      ${picks.list.map((n) => html`<button key=${n.id} type="button" class="rpn-fallback__item"
        style=${`--c:${typeColor(n.type)}`} disabled=${!canSend || busy !== null}
        onClick=${() => selectNode(n)}>${n.name || typeName(n.type)}
        <i>${typeName(n.type)}${n.cost ? ` · -${n.cost} AP` : ''}</i></button>`)}
    </div>` : null;

  const nodesPage = html`<div class="rpn-page">
    <div class="rpn-board" data-testid="rogue-nodes" data-layers=${String(graph.layers.length)} data-graph-root="1"
      data-view=${graphView === 'all' ? 'all' : 'round'}>
      <div class="rpn-board__head">
        ${routeStrip}
        <span class="rpn-board__count">${doneCols}/${graph.layers.length || '—'}</span>
        <ul class="rpn-legend" aria-label=${t('节点图例')}>
          <li><i class="is-past" aria-hidden="true"></i>${t('已通过')}</li>
          <li><i class="is-now" aria-hidden="true"></i>${t('当前')}</li>
          <li><i class="is-cand" aria-hidden="true"></i>${t('候选')}</li>
          <li><i class="is-todo" aria-hidden="true"></i>${t('未到')}</li>
        </ul>
      </div>
      ${!graph.layers.length
        ? html`<p class="rpn-empty">${t('本局没有节点数据：服务端未安装 roguelike-core。')}</p>`
        : html`<div class="rpn-board__map" data-testid="rogue-nodes-focus"
            style=${`--cols:${Math.max(1, boardCols.length)}`}>
          ${boardCols.map((c) => graphColumn(c, { all: graphView === 'all' }))}
        </div>`}
      ${fallbackStrip}
    </div>
    ${inspector}
  </div>`;

  const mapPage = html`<div class="rpn-page">
    <div class="rpn-board rpn-board--stage">
      <div class="rpn-stage">
        ${backdrop ? html`<img class="rpn-stage__bg" src=${backdrop} alt="" aria-hidden="true" />` : null}
        ${model ? minimap(model) : html`<p class="rpn-empty">${t('战场缩略图待载入…')}</p>`}
        <span class="rpn-stage__label">${mapName || t('未知战场')}</span>
      </div>
      <ul class="rpn-legend rpn-legend--map" aria-label=${t('地图图例')}>
        <li><i style=${`background:${MAP_COLORS.ground}`}></i>${t('地面')}</li>
        <li><i class="is-high" style=${`background:${MAP_COLORS.high}`}></i>${t('高台 / 墙')}</li>
        <li><i class="is-forbidden" style=${`background:${MAP_COLORS.forbidden}`}></i>${t('禁入')}</li>
        <li><i style=${`background:${MAP_COLORS.blocked}`}></i>${t('其他')}</li>
        <li><i class="is-dot" style=${`background:${MAP_COLORS.melee}`}></i>${t('可部署（近战）')}</li>
        <li><i class="is-dot" style=${`background:${MAP_COLORS.ranged}`}></i>${t('可部署（远程）')}</li>
      </ul>
    </div>
    <aside class="rpn-insp" aria-label=${t('关卡信息')}>
      <div class="rpn-insp__head">
        <div class="rpn-insp__top">
          <span class="rpn-insp__kind">${t('关卡')}</span>
          <span class="rpn-insp__cost">${model ? `${model.width}×${model.height}` : '—'}</span>
        </div>
        <h3 class="rpn-insp__name">${mapName || t('未知战场')}</h3>
        <p class="rpn-insp__meta">${lastRound ? t('回合 {r}/{last}', { r: round, last: lastRound }) : t('回合 {r}', { r: round })}${themeNo ? ` · ${themeNo.toUpperCase()}` : ''}</p>
      </div>
      ${mapStats ? html`<div class="rpn-insp__tiles">
        <span class="rpn-insp__tile is-ground"><b>${mapStats.ground}</b>${t('地面')}</span>
        <span class="rpn-insp__tile is-high"><b>${mapStats.high}</b>${t('高台 / 墙')}</span>
        <span class="rpn-insp__tile is-forbidden"><b>${mapStats.forbidden}</b>${t('禁入')}</span>
        <span class="rpn-insp__tile is-blocked"><b>${mapStats.blocked}</b>${t('其他')}</span>
        <span class="rpn-insp__tile is-melee"><b>${mapStats.melee}</b>${t('近战部署点')}</span>
        <span class="rpn-insp__tile is-ranged"><b>${mapStats.ranged}</b>${t('远程部署点')}</span>
      </div>` : null}
      <p class="rpn-insp__note">${t('地面格可通行；高台 / 墙要近战干员踩上去才可部署。禁入格（红纹）不可进入、也不可部署。黄点是近战部署点，绿点是远程部署点。')}</p>
    </aside>
  </div>`;


  const badges = [];
  if (rogue.emergency === true) badges.push({ icon: 'warn', text: t('紧急作战') });
  if (Number.isInteger(rogue.nextEventRound)) badges.push({ icon: 'dice', text: t('下次不期而遇 R{r}', { r: rogue.nextEventRound }) });
  if (Number.isInteger(rogue.nextEmergencyRound)) badges.push({ icon: 'hourglass', text: t('下次紧急作战 R{r}', { r: rogue.nextEmergencyRound }) });
  // 失与得进行中：提示「点一件换出」，并给每件藏品开一个换出入口（见下方 data-swap-id）
  if (swapPending) badges.push({ icon: 'refresh', text: t('失与得：点一件换出') });

  const relicsPage = html`<div class="rpn-page">
    <div class="rpn-board rpn-board--relics">
      <div class="rpn-board__head">
        <b class="rpn-board__name">${t('本局藏品')}</b>
        <span class="rpn-board__count">${relics.length}</span>
        <ul class="rpn-legend" aria-label=${t('藏品图例')}>
          <li><i class="is-past" aria-hidden="true"></i>${t('已生效')}</li>
          <li><i class="is-todo" aria-hidden="true"></i>${t('未实装')}</li>
        </ul>
      </div>
      ${relics.length ? html`<ul class="rpn-relics">
        ${relics.map((c) => html`<li key=${c.id} class=${cls('rpn-relic', c.kind === 'negative' && 'is-negative')} data-relic-id=${c.id}>
          <span class="rpn-relic__icon">
            ${c.icon ? html`<img src=${c.icon} alt="" loading="lazy" />` : html`<${Icon} name="box" />`}
          </span>
          <span class="rpn-relic__body">
            <b>${c.name}</b>
            ${c.desc ? html`<span class="rpn-relic__desc">${c.desc}</span>` : null}
          </span>
          ${c.tier ? html`<span class="rpn-relic__tier">${c.tier}</span>` : null}
          ${c.applied === false ? html`<span class="rpn-relic__na" title=${t('这条藏品的效果还没接进引擎：本局只记录、不生效')}>${t('未实装')}</span>` : null}
          ${swapPending ? html`<button type="button" class="rpn-relic__swap" data-swap-id=${c.id}
            disabled=${!canSend || !!busy} title=${t('失与得：换出这一件')}
            onClick=${() => swapOut(c.id)}>${t('换出')}</button>` : null}
        </li>`)}
      </ul>` : html`<p class="rpn-empty">${t('还没有藏品：开局与每 2 回合各有一次三选一。')}</p>`}
    </div>
    <aside class="rpn-insp" aria-label=${t('藏品概况')}>
      <div class="rpn-insp__head">
        <div class="rpn-insp__top">
          <span class="rpn-insp__kind">${t('藏品')}</span>
          <span class="rpn-insp__cost">${relics.length}</span>
        </div>
        <h3 class="rpn-insp__name">${affix || t('本局无词缀')}</h3>
        <p class="rpn-insp__meta">${t('第 {n} 层', { n: layerNo })} · ${t('回合 {r}', { r: round })}</p>
      </div>
      <dl class="rpn-insp__kv">
        <div><dt>${t('藏品')}</dt><dd>${relics.length}</dd></div>
        <div><dt>${t('未实装')}</dt><dd>${relics.filter((c) => c.applied === false).length}</dd></div>
        <div><dt>${t('词缀')}</dt><dd>${affix || t('无')}</dd></div>
      </dl>
      ${badges.length ? html`<div class="rpn-insp__tiles">
        ${badges.map((b) => html`<span key=${b.text} class="rpn-insp__tile"><${Icon} name=${b.icon} />${b.text}</span>`)}
      </div>` : null}
      <p class="rpn-insp__note">${t('藏品在开局与每 2 回合的三选一里获得；标「未实装」的只记录、不生效。')}</p>
    </aside>
  </div>`;

  return html`<div class="rpn" id="rogue-panel" role="dialog" aria-modal="true" aria-label=${t('集成战略')} data-testid="rogue-panel">
    <div class="rpn__veil" aria-hidden="true" onClick=${() => onClose && onClose()}></div>
    <div class="rpn__panel" data-tab=${tab}>
      ${topBar}
      <div class="rpn__main">
        ${railTabs}
        <div class="rpn__page" role="tabpanel" id=${`rpn-page-${tab}`} aria-labelledby=${`rpn-tab-${tab}`}>
          ${tab === 'map' ? mapPage : tab === 'relics' ? relicsPage : nodesPage}
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * 战场缩略图（静态 SVG，不启第二个棋盘渲染器）：按 `kinds` 上色，部署格打点。
 * 坐标翻转与 ui/rogueMapDock.js 一致：`kinds[0]` 是引擎最下行 → 画到最下面。
 * 禁入格填 `<pattern>` 斜纹（灰红底 + 淡红斜线）：只靠颜色时第一眼像「可玩区被围死」，斜纹让它读成禁区。
 */
function minimap(model) {
  const { width, height, kinds, marks } = model;
  const routes = Array.isArray(model.routes) ? model.routes : [];
  const cell = 10;
  const W = width * cell;
  const H = height * cell;
  const px = (c) => c * cell + cell / 2;
  const py = (r) => (height - 1 - r) * cell + cell / 2;
  const cells = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const kind = (kinds && kinds[r] && kinds[r][c]) || TERRAIN.BLOCKED;
      cells.push({ key: `${r},${c}`, x: c * cell, y: (height - 1 - r) * cell, kind });
    }
  }
  const dots = marks.map((m) => ({
    key: `d${m.r},${m.c}`,
    cx: m.c * cell + cell / 2,
    cy: (height - 1 - m.r) * cell + cell / 2,
    fill: m.kind === 'melee' ? MAP_COLORS.melee : MAP_COLORS.ranged,
  }));
  return html`<svg class="rpn-map__svg" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      role="img" aria-label=${t('战场缩略图')} data-testid="rogue-map-svg">
    <defs>
      <pattern id=${HATCH_ID} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" fill=${MAP_COLORS.forbidden} />
        <line x1="0" y1="0" x2="0" y2="5" stroke=${MAP_COLORS.hatch} stroke-width="1.6" />
      </pattern>
    </defs>
    ${cells.map((p) => html`<rect key=${p.key} x=${p.x} y=${p.y} width=${cell} height=${cell}
      fill=${p.kind === TERRAIN.FORBIDDEN ? `url(#${HATCH_ID})` : MAP_COLORS[p.kind] || MAP_COLORS.blocked}
      stroke=${p.kind === TERRAIN.HIGH ? 'rgba(0, 226, 228, .55)' : MAP_COLORS.grid}
      stroke-width=${p.kind === TERRAIN.HIGH ? 0.7 : 0.3} />`)}
    ${dots.map((d) => html`<circle key=${d.key} cx=${d.cx} cy=${d.cy} r=${cell * 0.26}
      fill=${d.fill} stroke="rgba(6, 12, 20, .85)" stroke-width="0.6" />`)}
    ${routes.map((rt, ri) => (rt.segs || []).map((seg, si) => {
      // 出怪折线（2026-11-08）：先画一条深色描边再叠亮线，压在格子上也看得清；起点画一个圈标出怪口。
      const pts = seg.map((p) => `${px(p.c)},${py(p.r)}`).join(' ');
      const head = seg[0];
      return html`<g key=${`rt${ri}-${si}`} class="rpn-map__route">
        <polyline points=${pts} fill="none" stroke="rgba(6, 12, 20, .78)" stroke-width="2.4"
          stroke-linejoin="round" stroke-linecap="round" />
        <polyline points=${pts} fill="none" stroke=${MAP_COLORS.route || '#e85a1a'} stroke-width="1.2"
          stroke-linejoin="round" stroke-linecap="round" stroke-dasharray=${rt.motion === 'FLY' ? '3 2' : 'none'} />
        <circle cx=${px(head.c)} cy=${py(head.r)} r=${cell * 0.3} fill="none"
          stroke=${MAP_COLORS.route || '#e85a1a'} stroke-width="1.1" />
      </g>`;
    }))}
  </svg>`;
}
