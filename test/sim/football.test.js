// 促融共竞·阵地足球 (P3), sim side: the balls, the kick, the goals, the field bonuses and the rival flavors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { kickDistance, spawnBall } from '../../server/sim/content/football.js';

const defs = { chess: { t_a: chessRec({ id: 't_a', stats: { atk: 3000, aspd: 100, maxHp: 2000, def: 0, res: 0 } }) } };
const players = (extra = {}) => [{
  playerId: 'p_0', seat: 0, side: 'L', bonds: {}, bandId: null, football: true, rivalTeam: 'standard',
  units: [{ uid: 1, kind: 'chess', chessId: 't_a', row: 10, col: 4, skillIndex: 0, moduleId: null }],
  ...extra,
}];
const build = (extra = {}, opts = {}) => makeBattle({ defs, players: players(extra), content: 'full', seed: 7, ...opts });
const ballsOf = (h) => h.b.enemies.filter((e) => e.ball);
const pp = (h) => h.b._pp('p_0');

test('two balls spawn on the midfield: enemy-faction, no attack, never walking, not counted in the totals', () => {
  const h = build();
  const balls = ballsOf(h);
  assert.equal(balls.length, 2);
  const [a, b] = balls;
  assert.deepEqual([Math.round(a.x), Math.round(a.y)], [5, 10]);
  assert.deepEqual([Math.round(b.x), Math.round(b.y)], [6, 10]);
  for (const e of balls) {
    assert.equal(e.profile.noAttack, true, 'dmgType none ⇒ never attacks');
    assert.equal(e.base.moveSpeed, 0, 'never walks');
    assert.equal(e.blockWeight, 3, '占用 3 个阻挡数');
    assert.equal(e.counted, false, 'not counted (no LP / perfect / totals impact)');
  }
  assert.equal(h.b.total, 0);
  assert.ok(a.name.includes('RMA70'));
});

test('a hit at/over the ball 推需伤害 kicks it along the attacker→ball ray; below it nothing moves', () => {
  const h = build();
  const op = h.unit(1); // (10, 4): due west of ball_pink at (10, 6) ⇒ the kick goes east
  const [a, b] = ballsOf(h);
  h.b.dealDamage(op, b, { amount: 400, type: 'true' }); // 粉红绒气球 threshold 500
  assert.equal(Math.round(b.x), 6, 'below the threshold: no kick');
  h.b.dealDamage(op, b, { amount: 600, type: 'true' });
  assert.equal(Math.round(b.x), 6 + kickDistance(b), 'kicked east by its own distance (stays off the goal line)');
  assert.equal(pp(h).goalsFor, undefined, 'no goal yet');
  // RMA70 at (10, 5): a 5-tile kick from the same spot crosses the away goal line at col ≥ 9
  h.b.dealDamage(op, a, { amount: 2300, type: 'true' });
  assert.equal(pp(h).goalsFor, 1);
  assert.deepEqual([Math.round(a.x), Math.round(a.y)], [5, 10], 'reset to its spot after the goal');
});

test('into the away goal it scores (至纯 ×3); into the own goal it concedes', () => {
  const h = build();
  const op = h.unit(1);
  const [a, b] = ballsOf(h);
  h.b.dealDamage(op, a, { amount: 2500, type: 'true' }); // east: the away goal fires
  assert.equal(pp(h).goalsFor, 1);
  assert.deepEqual([Math.round(a.x), Math.round(a.y)], [5, 10], 'reset to its spot');
  h.b.displace(b, { x: -1, y: 0 }, 9, {}); // roll the second ball at the own goal
  h.run(0.4); // the 0.25 s safety check fires (an auto-kick of the adjacent RMA70 may add a goal meanwhile)
  assert.equal(pp(h).goalsAgainst, 1);
  assert.deepEqual([Math.round(b.x), Math.round(b.y)], [6, 10]);
  const before = pp(h).goalsFor || 0;
  const pure = spawnBall(h.b, 'ball_pure', [11, 5]); // 至纯源石球: a goal scores triple
  h.b.displace(pure, { x: 1, y: 0 }, 10, {});
  h.run(0.4);
  assert.equal(pp(h).goalsFor, before + 3);
});

test('balls never leak and never count; the field bonuses apply (sp ×0.8, 回复 ×2, keeper +3 阻挡)', () => {
  const h = build({}, { timeLimit: 4 });
  h.run(3.9);
  assert.equal(h.eventsOf('enemyLeak').length, 0, 'a ball never walks into a leak');
  const op = h.unit(1);
  assert.equal(op.skill.spCostMul, 0.8, '技力需求 −20 %');
  assert.equal(op.s.spRecovery, 2, '技力回复 ×2');
  assert.equal(op.s.blockCnt, 5, 'keeper zone (cols 4–5) +3 over the chess default 2');
  assert.equal(h.b.total, 0);
});

test('the rival team flavors its wave enemies (球德联 +20 % ATK)', () => {
  const h = makeBattle({
    defs: { ...defs, enemies: { enemy_team: enemyRec({ key: 'enemy_team', hp: 1000, speed: 1, atk: 100 }) } },
    players: players({ rivalTeam: 'union' }),
    enemies: [{ key: 'enemy_team', pos: [10, 15] }],
    content: 'full', seed: 7,
  });
  h.step();
  const e = h.enemy('enemy_team');
  assert.ok(e, 'the rival spawned');
  assert.equal(e.s.atk, 120);
});
