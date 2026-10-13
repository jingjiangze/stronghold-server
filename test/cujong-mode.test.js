// 促融共竞 (MULTIPLAY_V3 co-op) as an independent mode: the shared room contract (modeIdFor / roomCapacity), the
// lobby flow at the fixed two-player capacity (create → join → start), the cujong guards (the project id rides in
// the difficulty slot; room.create / room.setDifficulty / room.start enforce it), the cluster admission boundary
// (copyAssignmentSpec, players.length === 2) and the generated data contract (data/config.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { CUJONG_PROJECTS, ERR, MATCHMAKING_VERSION, modeIdFor } from '../shared/constants.js';
import { PLAYER_CAPACITY_VERSION, roomCapacity } from '../shared/playerCapacity.js';
import { validateC2S } from '../shared/protocol.js';
import { copyAssignmentSpec } from '../server/cluster/game-host.js';

class RecordingMatch {
  constructor(opts) { this.opts = opts; }
  start() {}
  dispose() {}
  onLeave() {}
  onDisconnect() {}
  onReconnect() {}
}

function fixture(t) {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: RecordingMatch, getData: () => ({}), seedFn: () => 17 });
  t.after(() => lobby.shutdown());
  let count = 0;
  const player = () => {
    const s = registry.create(`Cujong${++count}`); s.connected = true; s.messages = [];
    s.matchmakingVersion = MATCHMAKING_VERSION; s.playerCapacityVersion = PLAYER_CAPACITY_VERSION;
    s.ws = { readyState: 1, bufferedAmount: 0, send(raw, cb) { s.messages.push(JSON.parse(raw)); cb?.(); } };
    return s;
  };
  return { lobby, player };
}

test('shared contract: modeIdFor routes cujong projects, solo/coop keep their modeIds, capacity is two', () => {
  assert.deepEqual(CUJONG_PROJECTS, ['football', 'fortress', 'raft']);
  for (const p of CUJONG_PROJECTS) assert.equal(modeIdFor('cujong', p), `mode_cujong_${p}`);
  assert.equal(modeIdFor('solo', 'FUNNY'), 'mode_single_funny');
  assert.equal(modeIdFor('coop', 'ABYSS'), 'mode_multi_abyss');
  assert.equal(roomCapacity('cujong'), 2);
  assert.equal(roomCapacity('solo'), 1);
  assert.equal(roomCapacity('coop'), 4);
});

test('a cujong room has two seats; both must be seated before start; the match carries mode_cujong_<project>', t => {
  const f = fixture(t);
  const host = f.player(), guest = f.player(), third = f.player();
  assert.deepEqual(f.lobby.create(host, { mode: 'cujong', difficulty: 'football' }), { ok: true });
  const room = f.lobby.roomOf(host);
  assert.equal(room.capacity, 2);
  assert.equal(room.seats.length, 2);
  assert.equal(f.lobby.start(host).error, ERR.NOT_READY, 'one seated player cannot start a two-player mode');
  assert.deepEqual(f.lobby.join(guest, { code: room.code }), { ok: true });
  assert.equal(f.lobby.join(third, { code: room.code }).error, ERR.ROOM_FULL);
  assert.equal(f.lobby.start(host).error, ERR.NOT_READY, 'the guest is connected but not ready');
  f.lobby.ready(guest, { ready: true });
  assert.deepEqual(f.lobby.start(host), { ok: true });
  assert.equal(room.match.opts.mode, 'cujong');
  assert.equal(room.match.opts.difficulty, 'football');
  assert.equal(room.match.opts.modeId, 'mode_cujong_football');
  assert.equal(room.match.opts.seats.length, 2);
});

test('a cujong room may start with one Doctor and one AI teammate (two seated players, like the cluster admission)', t => {
  const f = fixture(t);
  const host = f.player();
  assert.deepEqual(f.lobby.create(host, { mode: 'cujong', difficulty: 'raft' }), { ok: true });
  assert.deepEqual(f.lobby.addBot(host), { ok: true });
  const room = f.lobby.roomOf(host);
  assert.deepEqual(f.lobby.start(host), { ok: true });
  assert.equal(room.match.opts.modeId, 'mode_cujong_raft');
  assert.equal(room.match.opts.seats.length, 2);
  assert.ok(room.match.opts.seats.some((s) => s.isBot));
});

test('cujong rooms only carry the three projects (room.create + room.setDifficulty); non-cujong rooms are untouched', t => {
  const f = fixture(t);
  const host = f.player(), guest = f.player();
  assert.equal(f.lobby.create(host, { mode: 'cujong', difficulty: 'NORMAL' }).error, ERR.BAD_MSG);
  assert.deepEqual(f.lobby.create(host, { mode: 'cujong', difficulty: 'raft' }), { ok: true });
  const room = f.lobby.roomOf(host);
  assert.deepEqual(f.lobby.join(guest, { code: room.code }), { ok: true });
  assert.equal(f.lobby.setDifficulty(guest, { difficulty: 'football' }).error, ERR.NOT_HOST);
  assert.deepEqual(f.lobby.setDifficulty(host, { difficulty: 'fortress' }), { ok: true });
  assert.equal(room.difficulty, 'fortress');
  assert.equal(f.lobby.setDifficulty(host, { difficulty: 'hard' }).error, ERR.BAD_MSG);
  assert.equal(room.difficulty, 'fortress', 'a rejected project never mutates the room');
  // pairing: non-cujong modes keep the DIFFICULTIES contract (the wire layer accepts the union of both pools;
  // the lobby enforces which pool belongs to which mode)
  const coop = f.player();
  assert.equal(f.lobby.create(coop, { mode: 'coop', difficulty: 'football' }).error, ERR.BAD_MSG);
  assert.deepEqual(f.lobby.create(coop, { mode: 'coop', difficulty: 'HARD' }), { ok: true });
  assert.equal(f.lobby.setDifficulty(coop, { difficulty: 'football' }).error, ERR.BAD_MSG);
  assert.deepEqual(f.lobby.setDifficulty(coop, { difficulty: 'NORMAL' }), { ok: true });
  const solo = f.player();
  assert.equal(f.lobby.create(solo, { mode: 'solo', difficulty: 'football' }).error, ERR.BAD_MSG);
  assert.deepEqual(f.lobby.create(solo, { mode: 'solo', difficulty: 'NORMAL' }), { ok: true });
});

test('the wire schema accepts the cujong union; non-cujong values stay strict; pairing stays a lobby rule', () => {
  assert.equal(validateC2S({ t: 'room.create', mode: 'cujong', difficulty: 'football' }), null);
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }), null);
  assert.equal(typeof validateC2S({ t: 'room.create', mode: 'pvp', difficulty: 'NORMAL' }), 'string');
  assert.equal(typeof validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'EASY' }), 'string');
  // shape-valid but semantically wrong pairs pass the wire and are rejected by lobby.create / setDifficulty
  assert.equal(validateC2S({ t: 'room.create', mode: 'cujong', difficulty: 'NORMAL' }), null);
  assert.equal(validateC2S({ t: 'room.setDifficulty', difficulty: 'fortress' }), null);
  assert.equal(typeof validateC2S({ t: 'room.setDifficulty', difficulty: 'EASY' }), 'string');
  // P2: the 比赛风格 intent rides the same wire (MATCH_STYLES values only)
  assert.equal(validateC2S({ t: 'g.matchStyle', styleId: 'basic' }), null);
  assert.equal(validateC2S({ t: 'g.matchStyle', styleId: 'disabling' }), null);
  assert.equal(typeof validateC2S({ t: 'g.matchStyle', styleId: 'bogus' }), 'string');
});

const cujongSpec = (extra = {}) => ({ assignmentId: 'cujong-assignment', roomCode: 'CUJG', build: 'cujong-build', protocol: 1,
  seed: 7, matchNo: 1, mode: 'cujong', difficulty: 'football', modeId: 'mode_cujong_football',
  seats: [{ seat: 0, playerId: 'p0', name: 'Alpha', isBot: false, connected: true },
    { seat: 1, playerId: 'ai_1', name: 'AI', isBot: true, connected: true }],
  spectators: [], ...extra });

test('copyAssignmentSpec admits a two-seat cujong roster and rejects wrong projects, rosters and modeIds', () => {
  const safe = copyAssignmentSpec(cujongSpec());
  assert.equal(safe.mode, 'cujong');
  assert.equal(safe.difficulty, 'football');
  assert.equal(safe.modeId, 'mode_cujong_football');
  assert.equal(safe.seats.length, 2);
  // the project whitelist itself (modeId kept consistent, so only the project check can reject)
  assert.throws(() => copyAssignmentSpec(cujongSpec({ difficulty: 'NORMAL', modeId: 'mode_cujong_normal' })), /INVALID_SPEC/);
  // modeId must be derived from (mode, difficulty)
  assert.throws(() => copyAssignmentSpec(cujongSpec({ modeId: 'mode_multi_normal' })), /INVALID_SPEC/);
  assert.throws(() => copyAssignmentSpec(cujongSpec({ seats: cujongSpec().seats.slice(0, 1) })), /INVALID_SPEC/);
  assert.throws(() => copyAssignmentSpec(cujongSpec({ seats: [...cujongSpec().seats, { seat: 2, playerId: 'p2', name: 'Third', isBot: false, connected: true }] })), /INVALID_SPEC/);
});

test('data/config.json ships the three cujong modes as engine-reusable clones outside the in-scope set', () => {
  const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
  for (const p of CUJONG_PROJECTS) {
    const m = config.modes[`mode_cujong_${p}`];
    assert.ok(m, `mode_cujong_${p} missing`);
    assert.equal(m.modeId, `mode_cujong_${p}`);
    assert.equal(m.inScope, false);
    assert.equal(m.type, 'MULTI');
    assert.equal(m.code, 'CC');
    assert.ok(Number.isInteger(m.lastRound) && m.lastRound > 0, 'lastRound');
    assert.ok(Array.isArray(m.stages) && m.stages.length > 0, 'stages');
    assert.ok(m.rounds && Object.keys(m.rounds).length > 0, 'rounds');
    assert.equal(m.upgradePrices.length, 5);
  }
  assert.equal(Object.values(config.modes).filter((m) => m.inScope).length, 8, 'the in-scope set is unchanged');
});
