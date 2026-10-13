// server/sim/content/football.js — battle side of 促融共竞·阵地足球 (P3): the match balls, the kick, the goal zones,
// the field bonuses and the rival-team flavors. Active only when the battle carries a football player flag
// (`players[].football`, set from the match's `cujongProject === 'football'` — round.js battleInput), so every other
// battle installs nothing.
//
//   * balls: enemy-faction entities (dmgType 'none' ⇒ never attacks, moveSpeed 0 ⇒ never walks, blockCnt 3 ⇒ it takes
//     three blockers' worth of the slot, huge maxHp ⇒ effectively indestructible, notCountInTotal ⇒ no LP/perfect/
//     totals impact). Two balls spawn on the midfield (the stage's own passable tiles; stages without free midfield
//     tiles spawn none).
//   * kick: a hit by one of the player's operators whose instance damage reaches the ball's 推需伤害 pushes it along
//     the attacker→ball ray through the engine's displace mover (walls stop it; the client shows the slide).
//   * goals: the stage's own gates on the NORMAL field (cols 0–10, rows 9–12; GEO.NORMAL_RECT) — the west E door
//     (col ≤ 3) is the OWN goal (concedes), the east S gate edge (col ≥ 9) the AWAY goal (scores); the ball returns
//     to its spawn spot. The goals ride the battle result's perPlayer as `goalsFor` / `goalsAgainst` (Match settle
//     accumulates them into the match's 净胜球; cujong.js).
//   * field bonuses (main.raw 399–401): 技力需求 −20 %, 技力回复 ×2 for the player's operators; an operator deployed
//     in the keeper zone (the two columns just before the own goal) gains +3 阻挡. “再部署不增费” and “守门位不占部署位”
//     have no remake-side counterpart (no escalating redeploy cost; deploy slots are a match-level rule) — docs note.
//   * the 4 rival teams (main.raw 586–613): [ASSUMED] remake flavors — the match picks one per seed and the rival wave
//     enemies spawn with the team's small modifier.
//
// Numbers transcribed from the official tables (main.raw 423–582; 玩法-PRTS.md §阵地足球): 攻击 / 摩擦系数 / 弹性系数 /
// 重量 / 推需伤害 / 推动力度 + per-ball traits. The kick distance is an explicit remake adaptation (the official formula
// is not in the extracted data): heavier and grippier balls roll shorter, elastic slick ones roll far. Deterministic:
// no rng anywhere in this module.
import { passiveBuff } from './support/index.js';
import { hypot } from '../detmath.js';

/** A ball past this column (rows 9–12, the normal rect's east edge at the S gate) enters the AWAY goal — it scores. */
export const FOOTBALL_EAST_COL = 9;
/** …at/under this one the OWN goal (the E door area) — it concedes. */
export const FOOTBALL_WEST_COL = 3;
const FIELD_ROWS = [9, 12];

/** The 10 official match balls (main.raw 423–582): attack / 摩擦系数 / 弹性系数 / 重量 / 推需伤害 / 推动力度 + traits. */
export const BALLS = Object.freeze({
  ball_rma70: { name: 'RMA70刺球(标准)', attack: 12000, friction: 0.7, elasticity: 0.75, weight: 1, pushDamage: 2300, pushForce: 450 },
  ball_pink: { name: '粉红绒气球', attack: 2500, friction: 1.7, elasticity: 0.3, weight: 0, pushDamage: 500, pushForce: 395 },
  ball_concrete: { name: '压缩建材球', attack: 12000, friction: 0.19, elasticity: 1.0, weight: 2, pushDamage: 3500, pushForce: 260 },
  ball_originium: { name: '高能源石球(高级)', attack: 20000, friction: 0.65, elasticity: 0.3, weight: 1, pushDamage: 3000, pushForce: 390, trait: 'burst' },
  ball_pure: { name: '至纯源石球(高级)', attack: 20000, friction: 0.48, elasticity: 0.5, weight: 2, pushDamage: 4500, pushForce: 310, trait: 'triple' },
  ball_void: { name: '无垠回荡球(高级)', attack: 8000, friction: 0.12, elasticity: 1.0, weight: 0, pushDamage: 4500, pushForce: 400 },
  ball_leakbug: { name: '漏气甲虫球(#2)', attack: 10000, friction: 0.19, elasticity: 1.0, weight: 1, pushDamage: 7100, pushForce: 260, trait: 'deflate' },
  ball_pumpbug: { name: '膨胀甲虫球(#2)', attack: 10000, friction: 1.8, elasticity: 0.3, weight: 1, pushDamage: 10, pushForce: 400, trait: 'inflate' },
  ball_north: { name: '北境意志球(#2)', attack: 10000, friction: 0.5, elasticity: 0.9, weight: 1, pushDamage: 3800, pushForce: 275, trait: 'ice' },
  ball_seabed: { name: '底海滑动球(#2)', attack: 10000, friction: 0.3, elasticity: 1.0, weight: 1, pushDamage: 1500, pushForce: 260, trait: 'slime' },
});

/** [ASSUMED] remake flavors of the 4 rival teams (main.raw 586–613), picked per match from the seed (cujong.js). */
export const RIVAL_TEAMS = Object.freeze({
  standard: { name: '标准队' },
  tactical: { name: '战术队', speedMul: 1.1 },
  ballclub: { name: '爱球会', hpMul: 1.1, blockWeightBonus: 1 },
  union: { name: '球德联', atkMul: 1.2 },
});
export const FOOTBALL_RIVAL_IDS = Object.freeze(Object.keys(RIVAL_TEAMS));

/** The midfield layout (the first ball of the list is the standard RMA70). */
const MIDFIELD_BALLS = ['ball_rma70', 'ball_pink'];

const isFootball = (battle) => (battle.players || []).some((p) => p.football === true);

/**
 * The kick distance in tiles (remake adaptation): heavier / grippier balls roll shorter, elastic slick ones far;
 * clamped to 1…12 tiles.
 */
export function kickDistance(ball) {
  const i = ball.ballInfo;
  const d = (i.pushForce / 100) * (0.8 + 0.5 * i.elasticity) / (0.2 + i.friction) / (1 + 0.3 * i.weight);
  return Math.max(1, Math.min(12, Math.round(d)));
}

/** An indestructible, non-attacking, non-walking ball as an inline enemy record (`spawnEnemy` opts.def, normalized). */
export function spawnBall(battle, key, pos) {
  const spec = BALLS[key];
  const def = {
    type: 'enemy', id: key, key, name: spec.name, rank: 'NORMAL',
    maxHp: 1e9, atk: 0, def: 0, res: 0, aspd: 100, bat: 1, rangeRadius: 0,
    moveSpeed: 0, massLevel: spec.weight, lpr: 1, motion: 'WALK', applyWay: 'MELEE',
    dmgType: 'none', immune: new Set(), tauntLevel: 0, blockCnt: 3,
    epResistance: 0, epDamageResistance: 0, hpRecoveryPerSec: 0, notCountInTotal: true,
    tags: [], abilities: [], skills: [], talent: {}, spine: 'unknown', avatar: 'unknown', raw: {},
  };
  const e = battle.spawnEnemy(key, { def, pos, countInTotal: false });
  if (!e) return null;
  e.ball = true;
  e.ballInfo = { ...spec, kicks: 0, drift: 0 };
  return e;
}

export function install(battle) {
  if (!isFootball(battle)) return;

  // ---- field bonuses: 技力需求 −20 %，技力回复 ×2；the keeper zone's +3 阻挡
  const keeperCols = [FOOTBALL_WEST_COL + 1, FOOTBALL_WEST_COL + 2];
  const applyUnit = (u) => {
    if (!u || u.kind !== 'op' || u.side !== 'ally' || u.footballApplied) return; // once per unit (initial + deploy)
    u.footballApplied = true;
    if (u.skill) u.skill.spCostMul = (Number.isFinite(u.skill.spCostMul) ? u.skill.spCostMul : 1) * 0.8;
    passiveBuff(battle, u, 'football:field', { spRecoveryMul: 2 });
    const r = Math.round(u.y), c = Math.round(u.x);
    if (r >= FIELD_ROWS[0] && r <= FIELD_ROWS[1] && keeperCols.includes(c)) {
      u.base.blockCnt += 3;
      u.markDirty?.();
    }
  };
  for (const u of battle.allyUnits || []) applyUnit(u);
  battle.on('deploy', (c) => applyUnit(c.unit));

  // ---- the rival team's flavor modifier on its wave enemies
  const team = RIVAL_TEAMS[battle.players[0]?.rivalTeam] ?? null;
  if (team && (team.speedMul || team.atkMul || team.hpMul || team.blockWeightBonus)) {
    battle.on('enemySpawn', (c) => {
      const e = c.enemy;
      // the football is flagged after its spawn returns — skip it by key until then (its defId is the ball key)
      if (!e || e.ball || String(e.defId || '').startsWith('ball_')) return;
      if (team.speedMul && e.base.moveSpeed > 0) e.base.moveSpeed *= team.speedMul;
      if (team.atkMul) e.base.atk *= team.atkMul;
      if (team.hpMul) e.base.maxHp *= team.hpMul;
      if (team.blockWeightBonus) e.blockWeight = (e.blockWeight || 1) + team.blockWeightBonus;
      e.markDirty?.();
      if (team.hpMul) e.hp = e.s.maxHp;
    });
  }

  // ---- the balls on the midfield (the stage's own passable tiles; none where the midfield is blocked)
  const spots = [];
  for (const r of [10, 11, 9, 12]) for (const c of [5, 6, 4, 7]) {
    if (spots.length >= MIDFIELD_BALLS.length) break;
    if (battle.grid.groundPassable(r, c)) spots.push([r, c]);
  }
  MIDFIELD_BALLS.forEach((key, i) => { if (spots[i]) spawnBall(battle, key, spots[i]); });

  // ---- goals + the ball upkeep
  const inRows = (e) => { const r = Math.round(e.y); return r >= FIELD_ROWS[0] && r <= FIELD_ROWS[1]; };
  const checkGoal = (e) => {
    if (!e.alive || !e.ballInfo || !inRows(e)) return false;
    const c = Math.round(e.x);
    const side = c >= FOOTBALL_EAST_COL ? 'for' : c <= FOOTBALL_WEST_COL ? 'against' : null;
    if (!side) return false;
    const pid = battle.players[0]?.playerId;
    const pp = pid != null ? battle._pp(pid) : null;
    if (pp) {
      if (side === 'for') pp.goalsFor = (pp.goalsFor || 0) + (e.ballInfo.trait === 'triple' ? 3 : 1); // 至纯: 进球 3 倍得分
      else pp.goalsAgainst = (pp.goalsAgainst || 0) + 1;
    }
    battle.fx('footballGoal', { x: e.x, y: e.y, id: e.id, side });
    e.x = e.spawnX; // back to its spot for the next kick-off
    e.y = e.spawnY;
    battle.fx('displace', { x: e.x, y: e.y, id: e.id });
    return true;
  };

  const kick = (e, src) => {
    const info = e.ballInfo;
    const dx = e.x - src.x, dy = e.y - src.y;
    if (!(hypot(dx, dy) > 1e-6)) return;
    const dist = kickDistance(e);
    battle.displace(e, { x: dx, y: dy }, dist, { dur: Math.min(1.2, Math.max(0.25, dist * 0.12)), keepFacing: true });
    info.kicks += 1;
    battle.fx('footballKick', { x: e.x, y: e.y, id: e.id });
    // per-ball traits (deterministic counters; the two terrain-painting balls stay unimplemented — docs note)
    if (info.trait === 'deflate') info.drift = Math.max(-3 * 2200, info.drift - 2200); // 漏气: 下次推需伤害 −2200，叠 3 次
    else if (info.trait === 'inflate') info.drift = Math.min(25 * 250, info.drift + 250); // 膨胀: +250，叠 25 次
    else if (info.trait === 'burst' && info.kicks % 4 === 0) { // 高能源石球: 约每 2~5 次踢爆一次 (deterministic 4)
      for (const u of battle.allyUnits || []) {
        if (!u.alive) continue;
        if (hypot(u.x - e.x, u.y - e.y) <= 1.5) {
          battle.dealDamage(e, u, { amount: 1500, type: 'true', isSkill: true, canDodge: false, tags: ['football'] });
          battle.applyStatus(u, 'stun', { duration: 3, source: e });
        }
      }
    }
    checkGoal(e);
  };

  battle.on('damaged', (c) => {
    const e = c.target;
    if (!e || !e.ballInfo || !e.alive) return;
    const src = c.source;
    if (!src || src.side !== 'ally' || src.kind !== 'op') return;
    const amount = Number(c.amount) || 0;
    if (!(amount >= e.ballInfo.pushDamage + e.ballInfo.drift)) return;
    kick(e, src);
  });

  // safety net: any other displacement (a future content hook) still scores once the ball sits in a goal zone
  battle.every(0.25, () => { for (const e of battle.enemies) if (e.ball) checkGoal(e); });
}
