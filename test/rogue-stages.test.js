// 官方肉鸽关卡 → 本作 stage 记录（2026-11-03）：三张真实 ro4 关卡做夹具，转完要能直接跑一场战斗。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { convertRogueLevel, routesOf, deployKindOf } from '../tools/rogue-stages.mjs';
import { makeBattle } from './helpers/battleHarness.js';

const DIR = new URL('./fixtures/rogue-levels/', import.meta.url);
const NAMES = ['level_rogue4_1-1', 'level_rogue4_1-2', 'level_rogue4_1-4'];
const load = (n) => JSON.parse(fs.readFileSync(new URL(`${n}.json`, DIR), 'utf8'));

test('转换：尺寸/行数/字符网格/部署格都来自官方 mapData', () => {
  for (const n of NAMES) {
    const lv = load(n);
    const st = convertRogueLevel(lv);
    const H = lv.mapData.map.length, W = lv.mapData.map[0].length;
    assert.deepEqual(st.size, [H, W], `${n} 尺寸`);
    assert.equal(st.rows.length, H, `${n} 行数`);
    assert.ok(st.rows.every((r) => r.length === W), `${n} 每行 ${W} 字`);
    assert.ok(st.rows.every((r) => !r.includes('?')), `${n} 不应有未知地形`);
    assert.equal(st.deployTiles.normal.melee.length + st.deployTiles.normal.rangedOnly.length > 0, true, `${n} 必须有可部署格`);
    // 部署格坐标必须落在图内
    for (const [r, c] of [...st.deployTiles.normal.melee, ...st.deployTiles.normal.rangedOnly]) {
      assert.ok(r >= 0 && r < H && c >= 0 && c < W, `${n} 部署格越界 ${r},${c}`);
    }
  }
});

test('官方行序是「上→下」、本作是「下→上」：转换后最下一行 = 官方最后一行', () => {
  const lv = load('level_rogue4_1-1');
  const st = convertRogueLevel(lv);
  const H = lv.mapData.map.length;
  const tilesById = lv.mapData.tiles;
  // 官方最后一行第一个格子的 tileKey，应等于本作 rows[0] 第一个字对应的 tileKey
  const lastRowFirstTile = tilesById[lv.mapData.map[H - 1][0]];
  assert.equal(st.tiles[st.rows[0][0]].tileKey, lastRowFirstTile.tileKey, '最下一行没翻过来');
});

test('routes：官方 row 从下往上数，转换后直接沿用（不翻、不是 [x,y]）', () => {
  const lv = load('level_rogue4_1-1');
  const routes = routesOf(lv);
  assert.ok(routes.length > 0, '官方关卡应有可用 routes');
  const H = lv.mapData.map.length;
  const tileAt = (r, c) => lv.mapData.tiles[lv.mapData.map[H - 1 - r]?.[c]]?.tileKey;
  const starts = routes.map((r) => r.start);
  assert.ok(starts.some(([r, c]) => /start/.test(String(tileAt(r, c)))), '至少一条 route 的起点落在 tile_start 上');
  for (const r of routes) {
    assert.ok(Number.isInteger(r.start[0]) && Number.isInteger(r.start[1]));
    assert.ok(Number.isInteger(r.end[0]) && Number.isInteger(r.end[1]));
  }
});

test('转换结果能直接跑一场战斗（7×9 这类小图引擎支持）', () => {
  const st = convertRogueLevel(load('level_rogue4_1-1'), { id: 'rogue_ro4_1-1' });
  const [tile] = st.deployTiles.normal.melee;
  assert.ok(tile, '需要一个可部署格');
  const h = makeBattle({
    stage: st,
    rect: { r0: 0, r1: st.size[0] - 1, c0: 0, c1: st.size[1] - 1 },
    units: [{ chessId: 'chess_char_1_01_a', row: tile[0], col: tile[1] }],
    content: 'generic', autoFinish: false,
  });
  h.step();
  const u = h.allies()[0];
  assert.ok(u && u.deployed, '在肉鸽地图的部署格上应该能落地');
  assert.deepEqual([h.b.rect.r1 + 1, h.b.rect.c1 + 1], st.size);
});

test('deployKindOf：高台只放远程，不可建造不给格', () => {
  assert.equal(deployKindOf(null), null);
  assert.equal(deployKindOf({ buildableType: 'NONE' }), null);
  assert.equal(deployKindOf({ buildableType: 'ALL', heightType: 'LOWLAND' }), 'melee');
  assert.equal(deployKindOf({ buildableType: 'ALL', heightType: 'HIGHLAND' }), 'rangedOnly');
});
