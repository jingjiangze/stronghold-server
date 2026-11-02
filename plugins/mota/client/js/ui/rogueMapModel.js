// 肉鸽地图浮层的缩略图模型（2026-11-02）：**纯函数、无 import** —— 组件与 node 单测共用。
/**
 * 把一份 stage 数据规约成缩略图模型（纯函数，便于单测）：
 * `{ width, height, floor: [[bool]], marks: [{ r, c, kind: 'melee'|'ranged' }] }`。
 * 坐标已翻成「最上行在上」的屏幕方向（引擎 `rows[0]` 是最下行）。
 */
export function buildMinimapModel(stage) {
  if (!stage || !Array.isArray(stage.rows) || !stage.rows.length) return null;
  const rows = stage.rows;
  const height = rows.length;
  const width = Math.max(...rows.map((r) => String(r).length));
  if (!width) return null;
  const tiles = stage.tiles && typeof stage.tiles === 'object' ? stage.tiles : {};
  const walkable = (ch) => {
    const t = tiles[ch];
    if (!t) return false;
    return t.groundPassable === true || String(t.passable || '').includes('WALK');
  };
  const floor = [];
  for (let r = 0; r < height; r++) {
    const line = String(rows[r]);
    const row = [];
    for (let c = 0; c < width; c++) row.push(walkable(line[c]));
    floor.push(row);           // floor[0] = rows[0] = 引擎最下行
  }
  const marks = [];
  const dep = stage.deployTiles && stage.deployTiles.normal ? stage.deployTiles.normal : null;
  if (dep) {
    for (const [r, c] of (Array.isArray(dep.melee) ? dep.melee : [])) marks.push({ r, c, kind: 'melee' });
    for (const [r, c] of (Array.isArray(dep.rangedOnly) ? dep.rangedOnly : [])) marks.push({ r, c, kind: 'ranged' });
  }
  return { width, height, floor, marks };
}

