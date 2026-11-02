// tools/rogue-stages.mjs — 把官方集成战略（ISW/肉鸽）的关卡 JSON 转成本作的 stage 记录
// （业主 2026-11-02：「能不能提取肉鸽地图进去」→ 2026-11-03 审计确认可以做，这里做转换层）。
//
// 输入：官方 `levels/obt/roguelike/ro<N>/level_rogue*.json`（与 autochess 同一套 schema：
//       `mapData.map` 是 H×W 的 tile id 网格、`mapData.tiles` 是 id→tile 定义、`routes`/`waves`/`options`）。
// 输出：`data/stages.json` 里同形状的一条 stage（`size/rows/tiles/deployTiles/options/...`），
//       缺的字段（groundPaths / devices / special）先留空 —— 肉鸽关卡没有本作的「半场」语义。
//
// 与 `tools/build-data.mjs` 的 buildStages 保持同一套约定（关键三点，抄错会整张图翻过来）：
//   ① 官方 `map[0]` 是**最上一行**，本作 `rows[0]` 是**最下一行** ⇒ `tileAt(r,c) = tiles[map[H-1-r][c]]`；
//   ② 每张图 `size: [H, W]`，运行时 Battle 按 `rect` 走，不假设 19×21（2026-11-03 用 7×9 场地实测通过）；
//   ③ 部署格按 tile 的可建造类型判，不按固定矩形（肉鸽没有 bossLeft/bossRight 半场）。

/**
 * 一个 tile 是否可站人（部署格判据）。本作用 `buildableType`；官方另有黑名单地形（深水/高台边）走 `passableMask`。
 * @param {any} t 官方 mapData.tiles[id]
 */
export function deployKindOf(t) {
  if (!t) return null;
  const bt = String(t.buildableType || 'NONE').toUpperCase();
  if (bt === 'NONE') return null;
  // 高台只能放远程（与 buildStages 的 deployIn 同口径）
  if (t.heightType === 'HIGHLAND') return 'rangedOnly';
  return 'melee';
}

/** 一个 tile 的字符（同一张图里同 tileKey 复用同一字符；按出现顺序取 a..z, A..Z, 0..9）。 */
function glyphFor(tileKey, table) {
  if (table.has(tileKey)) return table.get(tileKey);
  const n = table.size;
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const g = n < alphabet.length ? alphabet[n] : '#';
  table.set(tileKey, g);
  return g;
}

/**
 * 把一份官方肉鸽关卡转成 stage 记录。
 * @param {any} lv 官方 level JSON
 * @param {{ id?: string, name?: string, modes?: string[], active?: boolean }} [meta]
 */
export function convertRogueLevel(lv, meta = {}) {
  const map = lv && lv.mapData && Array.isArray(lv.mapData.map) ? lv.mapData.map : null;
  const tilesById = lv && lv.mapData && lv.mapData.tiles && typeof lv.mapData.tiles === 'object' ? lv.mapData.tiles : {};
  if (!map || !map.length) throw new Error('rogue level without mapData.map');
  const H = map.length;
  const W = Math.max(...map.map((row) => (Array.isArray(row) ? row.length : 0)));
  if (!W) throw new Error('rogue level with empty map rows');
  const tileAt = (r, c) => tilesById[map[H - 1 - r] ? map[H - 1 - r][c] : undefined];

  const glyphs = new Map();
  const rows = [];
  const tiles = {};
  const melee = [];
  const rangedOnly = [];
  for (let r = 0; r < H; r++) {
    let line = '';
    for (let c = 0; c < W; c++) {
      const t = tileAt(r, c);
      const g = t ? glyphFor(t.tileKey, glyphs) : '?';
      line += g;
      if (t && !tiles[g]) {
        tiles[g] = {
          tileKey: t.tileKey,
          height: t.heightType === 'HIGHLAND' ? 'HIGH' : 'LOW',
          buildable: String(t.buildableType || 'NONE').toUpperCase(),
          passable: t.passableMask,
          groundPassable: t.passableMask === 'ALL',
          flyPassable: t.passableMask !== 'NONE',
        };
      }
      const kind = deployKindOf(t);
      if (kind === 'melee') melee.push([r, c]);
      else if (kind === 'rangedOnly') rangedOnly.push([r, c]);
    }
    rows.push(line);
  }

  const o = lv.options || {};
  return {
    id: meta.id || lv.levelId || `rogue_${lv.mapId || 'x'}`,
    name: meta.name || lv.levelId || '肉鸽战场',
    weight: 0,
    active: meta.active === true,
    modes: Array.isArray(meta.modes) ? meta.modes : [],
    size: [H, W],
    rows,
    tiles,
    devices: [],
    mapChars: [],
    special: {},
    runes: [],
    globalBuffs: [],
    // 肉鸽没有半场：可站人的格子就是部署区（高台只放远程）
    deployTiles: { normal: { melee, rangedOnly, changedByDevices: [] }, bossLeft: { melee: [], rangedOnly: [], changedByDevices: [] }, bossRight: { melee: [], rangedOnly: [], changedByDevices: [] } },
    // 本作的流场按固定 12 组端点算，肉鸽关卡用自己的 routes（在 waves 里），这里先留空
    groundPaths: {},
    groundPathsWithDevices: {},
    options: { characterLimit: o.characterLimit ?? 6, moveMultiplier: o.moveMultiplier ?? 0.5 },
    config: {},
  };
}

/**
 * 一张图里敌人从哪出发、往哪走。
 * 官方 `routes[].startPosition = { row, col }`：**row 从下往上数**（与 `mapData.map` 的 0=最上行相反）——
 * 实测：按 `map[H-1-row][col]` 取到的正是 `tile_start` / `tile_road` / `tile_end`。所以这里**直接用 row/col**，
 * 与 `tools/build-data.mjs` 的 resolveRoute 同口径。
 */
export function routesOf(lv) {
  const pos = (q) => (q && Number.isFinite(Number(q.row)) && Number.isFinite(Number(q.col)) ? [Number(q.row), Number(q.col)] : null);
  const out = [];
  for (const r of (lv && Array.isArray(lv.routes) ? lv.routes : [])) {
    const start = pos(r && r.startPosition);
    const end = pos(r && r.endPosition);
    if (!start || !end) continue;
    if (start[0] === end[0] && start[1] === end[1]) continue;   // 官方占位空路由
    out.push({
      motion: r.motionMode || 'WALK',
      start,
      end,
      checkpoints: (Array.isArray(r.checkpoints) ? r.checkpoints : []).map((c) => pos(c && c.position)).filter(Boolean),
      ...(r.allowDiagonalMove === false ? { allowDiagonal: false } : {}),
    });
  }
  return out;
}

export default { convertRogueLevel, deployKindOf, routesOf };
