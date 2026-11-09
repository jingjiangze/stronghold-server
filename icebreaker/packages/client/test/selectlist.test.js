// The operator select page's list (docs/spec/page.md 页面-9): rows at the box's training or the full one, filters,
// sorts, choosing in order, the game's markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER } from '@aue/content';
import { rowsOf, filtered, sorted, firstOf, tapped, branchesOf, fullOf, maxLevelOf, gameRich, PROFESSIONS } from '../src/selectlist.js';

const ROSTER4 = {
  a: { name: 'A', rarity: 6, profession: 'WARRIOR', branch: 'fighter' },
  b: { name: 'B', rarity: 5, profession: 'WARRIOR', branch: 'centurion' },
  c: { name: 'C', rarity: 3, profession: 'MEDIC', branch: 'physician' },
  d: { name: 'D', rarity: 6, profession: 'CASTER', branch: 'corecaster' },
};
const ENTRIES = /** @type {Record<string, { elite: number, level: number, potential: number }>} */ ({ b: { elite: 2, level: 90 - 10, potential: 3 }, d: { elite: 1, level: 60, potential: 1 } });
const rows = () => rowsOf(ROSTER4, (id) => ENTRIES[id] ?? null);

test('[页面-9] every operator: the box\'s training, else the full training its rarity gets (页面-2)', () => {
  const r = rows();
  assert.deepEqual(r.map((x) => [x.id, x.elite, x.level, x.potential, x.inBox]), [['a', 2, 90, 1, false], ['b', 2, 80, 3, true], ['c', 1, 55, 1, false], ['d', 1, 60, 1, true]]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(fullOf), [{ elite: 0, level: 30 }, { elite: 0, level: 30 }, { elite: 1, level: 55 }, { elite: 2, level: 70 }, { elite: 2, level: 80 }, { elite: 2, level: 90 }]);
  assert.deepEqual([maxLevelOf(6, 0), maxLevelOf(6, 1), maxLevelOf(4, 2), maxLevelOf(2, 2)], [50, 80, 70, 30], 'a phase it does not have: its last');
  assert.equal(rowsOf(ROSTER, () => null).length, Object.keys(ROSTER).length);
});

test('[页面-9] filters: a profession, one of its branches, rarities (none: all)', () => {
  const r = rows();
  const ids = (/** @type {any} */ f) => filtered(r, { profession: null, branch: null, rarities: [], ...f }).map((x) => x.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids({ profession: 'WARRIOR' }), ['a', 'b']);
  assert.deepEqual(ids({ profession: 'WARRIOR', branch: 'centurion' }), ['b']);
  assert.deepEqual(ids({ rarities: [6] }), ['a', 'd']);
  assert.deepEqual(ids({ profession: 'WARRIOR', rarities: [6, 3] }), ['a']);
  assert.deepEqual(branchesOf(r, 'WARRIOR'), ['fighter', 'centurion']);
  assert.deepEqual(PROFESSIONS.map(([id]) => id), ['PIONEER', 'WARRIOR', 'TANK', 'SNIPER', 'CASTER', 'MEDIC', 'SUPPORT', 'SPECIAL']);
});

test('[页面-9] sorts: by level (elite phase first) or rarity, the other as the tie-break, either way round', () => {
  const r = rows(), ids = (/** @type {any} */ s) => sorted(r, s).map((x) => x.id);
  assert.deepEqual(ids({ by: 'level', up: false }), ['a', 'b', 'd', 'c'], 'E2 90, E2 80, E1 60, E1 55');
  assert.deepEqual(ids({ by: 'level', up: true }), ['c', 'd', 'b', 'a']);
  assert.deepEqual(ids({ by: 'rarity', up: false }), ['a', 'd', 'b', 'c'], 'six-stars by level: E2 before E1');
  assert.deepEqual(ids({ by: 'rarity', up: true }), ['c', 'b', 'd', 'a']);
  const same = rowsOf({ x: ROSTER4.a, y: ROSTER4.a }, () => null);
  assert.deepEqual(sorted(same, { by: 'level', up: false }).map((x) => x.id), ['x', 'y'], 'the same on both: the roster\'s order');
});

test('[页面-9] the operators the list had when the page opened come first, in its order', () => {
  const r = sorted(rows(), { by: 'level', up: false });
  assert.deepEqual(firstOf(r, ['c', 'b', 'x']).map((x) => x.id), ['c', 'b', 'a', 'd']);
  assert.deepEqual(firstOf(r, []).map((x) => x.id), ['a', 'b', 'd', 'c']);
});

test('[页面-9] a tap chooses at the end or lets go (the later ones move up); a full list takes no more', () => {
  assert.deepEqual(tapped(['a', 'b'], 'c', 3), { chosen: ['a', 'b', 'c'], full: false });
  assert.deepEqual(tapped(['a', 'b', 'c'], 'a', 3), { chosen: ['b', 'c'], full: false });
  assert.deepEqual(tapped(['a', 'b', 'c'], 'd', 3), { chosen: ['a', 'b', 'c'], full: true });
});

test('[页面-9] the game\'s markup as rich text: its styles\' colours, a term\'s text, written line breaks', () => {
  assert.equal(gameRich('攻击力<@ba.vup>+{atk}</>，<$ba.camou>迷彩</>\n<@ba.unknown>x</>'), '攻击力<color=#0098DC>+{atk}</color>，迷彩\nx');
});
