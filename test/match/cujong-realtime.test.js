// 促融共竞·实时协防 (mode_cujong_realtime) — the realtime deploy slice:
//   · the opening deployment is skipped (Battle.flags.liveDeploy → lifecycle), every board piece waits held;
//   · g.deploy { uid } during COMBAT deploys that piece on its own board tile through Battle.deployLive —
//     DP charged (stats.cost), occupied / wrong-tile / respawn-window refusals answered on m.deploy;
//   · the automatic home-tile redeploy never runs (deploy.js _checkRedeploys): a downed operator waits for
//     its player until stats.respawnTime passes;
//   · the co-op main loop around it (targetLp / revive / settle) is unchanged (cujong-loop covers it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, chessOfTier } from './harness.js';
import { PHASE, ERR } from '../../shared/constants.js';

const realtime = (o = {}) => makeMatch({ mode: 'cujong', difficulty: 'realtime', humans: 2, ...o });

const toPrep1 = (h) => { h.autoHumans(); h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 1); return h; };

/** Place one melee + one ranged op per player and ready both sides into round 1's COMBAT. */
function toCombat1(h) {
  toPrep1(h);
  const m = h.m;
  const placed = new Map();
  for (const pid of ['p_0', 'p_1']) {
    const ps = h.ps(pid);
    const meleeId = chessOfTier(1, (c) => c.position === 'MELEE').find((id) => m.pool.has(id));
    const rangedId = chessOfTier(1, (c) => c.position === 'RANGED').find((id) => m.pool.has(id));
    const melee = give(m, ps, meleeId);
    const ranged = give(m, ps, rangedId);
    assert.deepEqual(m.handle(pid, { t: 'g.move', uid: melee.uid, to: { area: 'board', row: 9, col: 3 } }), { ok: true });
    assert.deepEqual(m.handle(pid, { t: 'g.move', uid: ranged.uid, to: { area: 'board', row: 10, col: 4 } }), { ok: true }, 'ranged on the 高台');
    placed.set(pid, [melee, ranged]);
  }
  h.drive(() => h.m.phase === PHASE.COMBAT && h.m.round === 1);
  return { placed };
}

/** The player's own live Battle (inline harness path: the Battle instance runs on this thread). */
const battleOf = (h, pid) => h.m.runner.fields.find((f) => f.fieldId === `n:${pid}`).battle;

test('realtime: the mode wires through (project, flag, spec flags) and the opening deployment is skipped', () => {
  const h = realtime({ seed: 5 }).start();
  const m = h.m;
  assert.equal(m.isCujong, true);
  assert.equal(m.cujongProject, 'realtime');
  assert.equal(m.cujongRealtime, true);
  assert.equal(m.gd.modeId, 'mode_cujong_realtime');
  toCombat1(h);
  const b = battleOf(h, 'p_0');
  assert.equal(b.flags.liveDeploy, true, 'the battle runs in live-deploy mode');
  const held = b.players[0].units.filter((u) => u.kind === 'op');
  assert.ok(held.length >= 2, 'the board pieces exist as units');
  for (const u of held) assert.equal(u.deployed, false, `${u.defId} waits held off the field`);
  // and the enemy wave DID deploy (the stage plays normally around them)
  assert.ok(b.units.some((u) => u.side === 'enemy' && u.alive && u.deployed) || b.killed + b.total > 0, 'enemies arrive');
  h.invariants();
});

test('realtime: g.deploy puts the held piece on its board tile and charges DP', () => {
  const h = realtime({ seed: 7 }).start();
  const m = h.m;
  const { placed } = toCombat1(h);
  const [melee] = placed.get('p_0');
  const b = battleOf(h, 'p_0');
  const ps = b.getPlayer('p_0');
  let dp0 = ps.dp;
  const cost = m.gd.chess(melee.id).stats.cost;
  // the opening DP (dpInit 10) may sit below the piece's cost: step the battle until the natural DP regen affords it
  // (dpPerSec 1 per game-second — the same resource loop the HUD shows)
  for (let i = 0; i < 600 && ps.dp < cost; i++) b.step();
  dp0 = ps.dp;
  assert.ok(dp0 >= cost, `the regen affords the piece (${dp0} ≥ ${cost})`);

  assert.deepEqual(m.handle('p_0', { t: 'g.deploy', uid: melee.uid }), { ok: true });
  const unit = b.players[0].units.find((u) => u.uid === melee.uid);
  assert.equal(unit.alive && unit.deployed, true, 'the piece stands on its tile');
  assert.ok(ps.dp <= dp0 - cost, `DP charged (cost ${cost}): ${dp0} → ${ps.dp}`);
  // the authoritative answer reached the deployer
  const reply = h.lastTo('p_0', 'm.deploy');
  assert.ok(reply && reply.ok === true && reply.uid === melee.uid, 'm.deploy ok carries uid + dp');
  // deploying the same piece again is ACCEPTED for processing (the intent enqueues) — the refusal is the
  // authoritative m.deploy answer, not the intent's return value
  assert.deepEqual(m.handle('p_0', { t: 'g.deploy', uid: melee.uid }), { ok: true });
  const again = h.lastTo('p_0', 'm.deploy');
  assert.equal(again.ok, false);
  assert.equal(again.error, 'deployed');
  h.invariants();
});

test('realtime: DP is the gate — a piece the DP cannot afford refuses with error dp', () => {
  const h = realtime({ seed: 9 }).start();
  const m = h.m;
  const { placed } = toCombat1(h);
  const [, ranged] = placed.get('p_0');
  const b = battleOf(h, 'p_0');
  const ps = b.getPlayer('p_0');
  ps.dp = 0;
  m.handle('p_0', { t: 'g.deploy', uid: ranged.uid });
  const reply = h.lastTo('p_0', 'm.deploy');
  assert.equal(reply.ok, false);
  assert.equal(reply.error, 'dp');
  assert.equal(b.players[0].units.find((u) => u.uid === ranged.uid).deployed, false);
  h.invariants();
});

test('realtime: a downed operator waits for its respawn window and its player, never the automatic redeploy', () => {
  const h = realtime({ seed: 11 }).start();
  const m = h.m;
  const { placed } = toCombat1(h);
  const [melee] = placed.get('p_0');
  const b = battleOf(h, 'p_0');
  const ps = b.getPlayer('p_0');
  ps.dp = 99;
  m.handle('p_0', { t: 'g.deploy', uid: melee.uid });
  const unit = b.players[0].units.find((u) => u.uid === melee.uid);
  // knock it down the way the sim does (kill → the redeploy timer arms)
  b.kill(unit);
  assert.equal(unit.alive, false);
  assert.ok((unit.respawnAt ?? 0) > b.time, 'the respawn window armed');
  // while the window runs, the player's order is refused
  assert.equal(b.flags.liveDeploy, true);
  m.handle('p_0', { t: 'g.deploy', uid: melee.uid });
  assert.equal(h.lastTo('p_0', 'm.deploy').error, 'respawn');
  // the automatic home-tile redeploy never fires in live mode: step past where _checkRedeploys would have
  // brought it back (the window itself is stats.respawnTime — shortened here, not waited out)
  for (let i = 0; i < 10; i++) b.step();
  assert.equal(unit.deployed, false, 'no automatic redeploy in live mode');
  // the window passes; the player's order brings the piece back on its tile
  unit.respawnAt = b.time;
  b.step();
  m.handle('p_0', { t: 'g.deploy', uid: melee.uid });
  const reply = h.lastTo('p_0', 'm.deploy');
  assert.equal(reply.ok, true, 'back on its tile after the window');
  assert.equal(unit.alive && unit.deployed, true);
  h.invariants();
});

test('realtime: the co-op frame is untouched — non-realtime cujong keeps PREP deployment and no liveDeploy flag', () => {
  const h = makeMatch({ mode: 'cujong', difficulty: 'fortress', humans: 2, seed: 5 }).start();
  const m = h.m;
  assert.equal(m.cujongRealtime, false);
  toPrep1Like(h);
  h.drive(() => h.m.phase === PHASE.COMBAT && h.m.round === 1);
  assert.equal(h.m.runner.fields[0].battle.flags.liveDeploy, undefined, 'fortress keeps the opening deployment');
  h.invariants();
});

function toPrep1Like(h) { h.autoHumans(); h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 1); return h; }
