// Game-owned spectator-to-AI handover. No monitor or administrator API dependency.
// A 第二期下半 match answers here synchronously. An official non-default version's match runs in its
// version host: the lobby asks aiHandoverView / acceptAiHandover and keeps sessions, seats, tokens,
// votes and timers in this process.
// fork: gameplay-plugin rooms are NOT refused —— their Match runs in a match-host worker and the fork's
// MatchProxy answers takeoverSeatState / takeoverSeat RPCs (server/match/host/proxy.js), so the fork's
// 接管投票 / 随机交接 / 潜入 live on those rooms. Routing: hostView() (official version room) → the
// upstream 0.4.0 host path; otherwise the fork path (worker RPC or the in-process Match).
import { ERR, PROTOCOL_VERSION } from '../shared/constants.js';
import { DEFAULT_VERSION } from '../shared/versions.js';
import { resetStateDelta, stateDeltaVersion } from './stateTransport.js';
const fail = detail => ({ error: ERR.BAD_TARGET, detail });
const pending = new WeakMap();

// fork: 3–9 回合窗口 (2026-10-31): 接管只在这几个回合的 PREP 里成立；随机交接也落在这个区间。
export const AI_TAKEOVER_MIN_ROUND = 3;
export const AI_TAKEOVER_MAX_ROUND = 9;
const inWindow = (m) => Number.isInteger(m?.round) && m.round >= AI_TAKEOVER_MIN_ROUND && m.round <= AI_TAKEOVER_MAX_ROUND;

/** A real official-version match host. A forged `hosted` flag on an in-process match is not this. */
function hostView(room) {
  return !!room && room.match?.hosted === true && room.version !== DEFAULT_VERSION && !room.modded;
}

export function resetAiTakeover(room) {
  const votes = pending.get(room);
  if (votes) { for (const vote of votes.values()) clearTimeout(vote.timer); votes.clear(); }
  room.aiTakeoverVotes = [];
}

export function takeoverVoters(room) {
  const m = room.match;
  const seats = room.seats.filter(s => s && !s.isBot && !s.left && s.connected);
  // fork: A hosted (plugin) match keeps its PlayerStates in the worker, so `autoplay` is not readable here:
  // nobody is filtered out — a托管中的队友 still votes, exactly like an ordinary one.
  const players = m?.players instanceof Map ? m.players : null;
  const ids = seats.filter(s => !players || !players.get(s.playerId)?.autoplay).map(s => s.playerId);
  if (!ids.length && room.seatOf(room.hostId)?.connected) ids.push(room.hostId);
  return ids;
}

/**
 * fork: The live state the vote flow needs, from whichever side owns the match: an in-process Match answers from itself,
 * a match host's MatchProxy is asked over the takeover RPC (plugin matches run in a worker — the lobby has no
 * players / phase / round there). @returns {Promise<{phase:string, round:number, ended:boolean, disposed:boolean,
 *   frozen?:boolean, bots:{playerId:string,name:string,seat:number}[]}|null>}
 */
async function matchState(m) {
  if (!m) return null;
  if (m.hosted) {
    const st = await m.takeoverSeatState();
    return st && typeof st.phase === 'string' ? st : null;
  }
  return {
    phase: m.phase, round: m.round, ended: !!m.ended, disposed: !!m.disposed, frozen: !!m.emergencyFrozen,
    bots: [...(m.players?.values?.() || [])].filter(ps => ps.isBot && !ps.left && ps.alive)
      .map(ps => ({ playerId: ps.playerId, name: ps.name, seat: ps.seat })),
  };
}

// upstream 0.4.0: view helpers for official-version host rooms (the eligibility snapshot rides on aiHandoverView).
function votersFromView(room, view) {
  const row = (id) => view?.players?.find(p => p && p.playerId === id);
  const seats = room.seats.filter(s => s && !s.isBot && !s.left && s.connected);
  const ids = seats.filter(s => !row(s.playerId)?.autoplay).map(s => s.playerId);
  if (!ids.length && room.seatOf(room.hostId)?.connected) ids.push(room.hostId);
  return ids;
}

function hostSnap(raw) {
  if (!raw || raw.ok !== true || typeof raw.phase !== 'string' || !Array.isArray(raw.players)) return null;
  return raw;
}

export async function transferAiSeat(lobby, room, applicantId, botId) {
  // upstream 0.4.0: an official-version room's match lives on its version host — the child re-checks and mutates.
  if (hostView(room)) return transferOnHost(lobby, room, applicantId, botId);
  const m = room.match, session = lobby.registry.byId(applicantId), spectator = room.spectatorOf(applicantId);
  const seat = room.seatOf(botId);
  if (room.aiTakeoverEnabled !== true || room.mode !== 'coop' || room.version !== DEFAULT_VERSION) return fail('AI handover is disabled');
  if (!session?.connected || !session.ws || !spectator || !seat || seat.isBot !== true || seat.left) return fail('AI handover unavailable');
  if (lobby.registry.byId(botId)) return fail('AI seat already has a session');
  const conn = lobby.network?.conns.get(session.ws);
  if (!conn || conn.closing) return fail('connection unavailable');
  if (m?.hosted) {
    // 插件对局的 Match/PlayerState 在 match host 的 worker 里：相位、回合、席位都那边判，变更也在那边做
    const res = await m.takeoverSeat(botId, applicantId, session.name);
    if (!res || res.ok !== true) return fail('AI handover unavailable');
  } else {
    const ps = m?.players?.get(botId);
    if (!ps?.isBot || ps.left || !ps.alive || m.phase !== 'PREP' || m.ended || m.disposed || m.emergencyFrozen) return fail('AI handover unavailable');
    m.cancelSeatRehearsal(botId);
    ps._botPrepToken = (ps._botPrepToken || 0) + 1;
    Object.assign(ps, { isBot: false, autoplay: false, connected: true, ready: false, name: session.name });
    m.loneHuman = m.order.filter(p => !p.isBot && !p.left).length === 1;
    ps.aiTakeoverRound = m.round;
    // The seat keeps the bot's playerId (the session below takes it over), so remember who actually played it: the
    // result row carries this as `ownerId` and the client keys the record to the human instead of the `ai_…` seat.
    ps.aiTakeoverFrom = applicantId;
    m.markPublic(); ps.dirty();
  }
  lobby.removeMember(room, applicantId); lobby.clearResync(applicantId);
  lobby.registry.byPlayerId.delete(applicantId); session.playerId = botId; lobby.registry.byPlayerId.set(botId, session);
  session.roomCode = room.code; session.notice = null; session.pendingResult = null; session.resyncAt = -Infinity;
  Object.assign(seat, { isBot: false, connected: true, left: false, ready: false, name: session.name });
  seat.aiTakeoverFrom = applicantId;
  session.aiTakeoverFrom = applicantId;
  resetStateDelta(conn.ws);
  lobby.network.onHelloMsg(conn, { t: 'hello', version: PROTOCOL_VERSION, delta: stateDeltaVersion(conn.ws), name: session.name, token: session.token }, lobby.now());
  lobby.broadcastState(room); return { ok: true };
}

// upstream 0.4.0: session rebind for a seat inherited on a version host (the child already mutated its Match).
function bindInheritedSeat(lobby, room, session, conn, applicantId, botId) {
  lobby.removeMember(room, applicantId); lobby.clearResync(applicantId);
  lobby.registry.byPlayerId.delete(applicantId); session.playerId = botId; lobby.registry.byPlayerId.set(botId, session);
  session.roomCode = room.code; session.notice = null; session.pendingResult = null; session.resyncAt = -Infinity;
  const seat = room.seatOf(botId);
  if (seat) Object.assign(seat, { isBot: false, connected: true, left: false, ready: false, name: session.name });
  seat.aiTakeoverFrom = applicantId; // fork: 结算 ownerId 归属（results.js 读 match 侧的同名 PlayerState 字段）
  session.aiTakeoverFrom = applicantId;
  resetStateDelta(conn.ws);
  lobby.network.onHelloMsg(conn, { t: 'hello', version: PROTOCOL_VERSION, delta: stateDeltaVersion(conn.ws), name: session.name, token: session.token }, lobby.now());
  lobby.broadcastState(room);
}

// upstream 0.4.0: the same for a match on its version host; the child answers acceptAiHandover like handle.
// fork: the applicant id rides along (3rd arg) so the child can stamp the result's ownerId (ps.aiTakeoverFrom).
function transferOnHost(lobby, room, applicantId, botId) {
  const m = room.match, session = lobby.registry.byId(applicantId), spectator = room.spectatorOf(applicantId);
  const seat = room.seatOf(botId);
  if (room.aiTakeoverEnabled !== true || room.mode !== 'coop' || !hostView(room)) return fail('AI handover is disabled');
  if (!session?.connected || !session.ws || !spectator || !seat) return fail('AI handover unavailable');
  if (lobby.registry.byId(botId)) return fail('AI seat already has a session');
  const conn = lobby.network?.conns.get(session.ws);
  if (!conn || conn.closing) return fail('connection unavailable');
  // The child re-checks the bot and the phase, then mutates. Rebind only after it accepts.
  return m.acceptAiHandover(botId, session.name, applicantId).then((accepted) => {
    if (!accepted || accepted.ok !== true) return accepted && accepted.error ? accepted : fail('AI handover unavailable');
    if (lobby.registry.byId(applicantId) !== session || !session.connected || !session.ws || conn.closing || !room.spectatorOf(applicantId)) {
      // The host already made the seat human (the socket dropped during the round trip). [ASSUMED] It stays the
      // applicant's as a disconnected seat — their token resumes it, the match's disconnect rules apply meanwhile — and
      // an applicant whose session is gone has left it: never a human seat the lobby does not know.
      const seat = room.seatOf(botId);
      if (lobby.registry.byId(applicantId) === session && room.spectatorOf(applicantId)) {
        lobby.removeMember(room, applicantId); lobby.clearResync(applicantId);
        lobby.registry.byPlayerId.delete(applicantId); session.playerId = botId; lobby.registry.byPlayerId.set(botId, session);
        session.roomCode = room.code; session.aiTakeoverFrom = applicantId;
        if (seat) Object.assign(seat, { isBot: false, connected: false, left: false, ready: false, name: session.name });
        lobby.callMatch(room, 'onDisconnect', botId);
      } else {
        if (seat) Object.assign(seat, { isBot: false, connected: false, left: true, ready: false });
        lobby.callMatch(room, 'onLeave', botId);
      }
      lobby.broadcastState(room);
      return fail('connection unavailable');
    }
    bindInheritedSeat(lobby, room, session, conn, applicantId, botId);
    return { ok: true };
  });
}

// [ASSUMED] Any electorate change cancels rather than lowering the approval threshold.
function drop(votes, id) {
  clearTimeout(votes.get(id)?.timer);
  votes.delete(id);
}
function snapshot(room, votes) {
  room.aiTakeoverVotes = [...votes.values()].map(v => ({ id: v.id, applicantId: v.applicantId,
    applicantName: v.applicantName, botId: v.botId, expiresAt: v.expiresAt, eligible: v.eligible,
    yes: [...v.yes], no: [...v.no], ...(v.random ? { random: true } : {}) }));
}

export function reconcileAiTakeover(lobby, room) {
  const votes = pending.get(room);
  if (!votes?.size) return false;
  // upstream 0.4.0: an official-version room's votes reconcile off the view RPC (returns a promise for afterReconcile).
  if (hostView(room)) return reconcileOnHost(lobby, room);
  const m = room.match;
  const hosted = m?.hosted === true;
  const eligible = m ? takeoverVoters(room) : [];
  let changed = false;
  for (const [id, v] of votes) {
    const applicant = lobby.registry.byId(v.applicantId), bot = hosted ? null : m?.players?.get(v.botId);
    // Hosted (plugin) matches keep phase/round/players in the worker, so the detailed checks happen again inside the
    // takeover RPC; here only what the lobby can see (identity, connection, electorate, expiry) can drop a vote.
    if (room.aiTakeoverEnabled !== true || room.version !== DEFAULT_VERSION
      || m !== v.match
      || (hosted ? m.ended || m.disposed : m.phase !== 'PREP' || m.round !== v.round || m.ended || m.disposed || m.emergencyFrozen)
      || !room.spectatorOf(v.applicantId)?.connected || !applicant?.connected || applicant.roomCode !== room.code
      || (!hosted && (!bot?.isBot || !bot.alive || bot.left)) || Date.now() >= v.expiresAt
      || eligible.length !== v.eligible.length || eligible.some((id, i) => id !== v.eligible[i])) {
      drop(votes, id); changed = true;
    }
  }
  if (changed) snapshot(room, votes);
  return changed;
}

// upstream 0.4.0: view-based reconcile for version-host rooms.
function reconcileWith(lobby, room, view) {
  const votes = pending.get(room);
  if (!votes?.size) return false;
  const m = room.match;
  const eligible = view ? votersFromView(room, view) : [];
  const row = (id) => view?.players?.find(p => p && p.playerId === id);
  let changed = false;
  for (const [id, v] of votes) {
    const applicant = lobby.registry.byId(v.applicantId), bot = row(v.botId);
    if (room.aiTakeoverEnabled !== true || room.modded || !hostView(room)
      || m !== v.match || view?.phase !== 'PREP' || view?.round !== v.round || view?.ended || view?.disposed || view?.emergencyFrozen
      || !room.spectatorOf(v.applicantId)?.connected || !applicant?.connected || applicant.roomCode !== room.code
      || !bot?.isBot || !bot.alive || bot.left || Date.now() >= v.expiresAt
      || eligible.length !== v.eligible.length || eligible.some((pid, i) => pid !== v.eligible[i])) {
      drop(votes, id); changed = true;
    }
  }
  if (changed) snapshot(room, votes);
  return changed;
}

function reconcileOnHost(lobby, room) {
  const m = room.match;
  if (!m || m.ended || m.disposed) return Promise.resolve(reconcileWith(lobby, room, null));
  return m.aiHandoverView().then((raw) => {
    const view = hostSnap(raw);
    // [ASSUMED] A failed host read does not cancel the vote. The next public snapshot, or the match ending, does.
    if (!view) return false;
    return reconcileWith(lobby, room, view);
  });
}

/** upstream 0.4.0: When reconcile read a version host, broadcast only after that read settles. A boolean stays synchronous. */
function afterReconcile(lobby, room, rec) {
  if (rec && typeof rec.then === 'function') {
    rec.then((changed) => { if (changed && room && !room.disposed) lobby.broadcastState(room); }, (e) => {
      lobby.log?.error?.(`[lobby] ${room?.code} AI handover reconcile failed`, e);
    });
    return;
  }
  if (rec && room) lobby.broadcastState(room);
}

export function aiTakeover(lobby, session, msg) {
  const room = lobby.roomOf(session);
  // upstream 0.4.0: official-version rooms vote against the version host's eligibility snapshot.
  if (hostView(room)) return aiTakeoverOnHost(lobby, session, room, msg);
  if (room && reconcileAiTakeover(lobby, room)) lobby.broadcastState(room);
  return aiTakeoverLocal(lobby, session, msg);
}

// fork: the vote machinery for plugin rooms (worker RPC) and in-process matches — same shape as the upstream
// in-process path, but every phase/round/bot read goes through matchState() so a hosted Match answers too.
async function aiTakeoverLocal(lobby, session, msg) {
  const room = lobby.roomOf(session), m = room?.match;
  const st = await matchState(m);
  // 2026-11-01 P1（审计 P3-12）：手动接管与随机路径同一 3–9 回合窗口 —— 头注释本来就写着「接管只在这几个回合的
  // PREP 里成立」，但手动入口一直没查窗口（常量对主路径形同死代码）。
  if (!room || room.aiTakeoverEnabled !== true || room.mode !== 'coop' || room.version !== DEFAULT_VERSION
    || !st || st.phase !== 'PREP' || st.ended || st.disposed || st.frozen || !inWindow(st)) return fail('AI handover requires preparation in a coop match (rounds 3–9)');
  let votes = pending.get(room); if (!votes) pending.set(room, votes = new Map());
  const sync = () => { snapshot(room, votes); lobby.broadcastState(room); };
  if (msg.t === 'room.aiRequest') {
    const bot = (st.bots || []).find((b) => b.playerId === msg.botId);
    if (!room.spectatorOf(session.playerId) || !session.connected || !bot) return fail('a spectator must select an active AI');
    if ([...votes.values()].some(v => v.applicantId === session.playerId || v.botId === msg.botId)) return fail('request already pending');
    const eligible = takeoverVoters(room);
    if (!eligible.length) return fail('no online voter available');
    const id = String(room.aiTakeoverSeq = (room.aiTakeoverSeq || 0) + 1);
    // [ASSUMED] A 30-second vote expires without approval; the whole room elects by strict majority.
    const vote = { id, applicantId: session.playerId, applicantName: session.name, botId: msg.botId,
      match: m, round: st.round, eligible, expiresAt: Date.now() + 30000, yes: new Set(), no: new Set() };
    votes.set(id, vote);
    vote.timer = setTimeout(() => { if (votes.get(id) === vote) { drop(votes, id); sync(); } }, 30000);
    vote.timer.unref?.(); sync(); return { ok: true };
  }
  const vote = votes.get(msg.voteId);
  if (!vote) return fail('request expired');
  if (!vote.eligible.includes(session.playerId)) return fail('only online human room teammates can vote');
  (msg.approve ? vote.no : vote.yes).delete(session.playerId);
  (msg.approve ? vote.yes : vote.no).add(session.playerId);
  const required = Math.floor(vote.eligible.length / 2) + 1;
  if (vote.no.size >= required) { drop(votes, vote.id); sync(); return { ok: true }; }
  if (vote.yes.size >= required) {
    drop(votes, vote.id);
    const result = await transferAiSeat(lobby, room, vote.applicantId, vote.botId); sync(); return result;
  }
  sync(); return { ok: true };
}

// upstream 0.4.0: the vote machinery for official-version rooms (the view snapshot rides on aiHandoverView).
function aiTakeoverOnHost(lobby, session, room, msg) {
  return room.match.aiHandoverView().then((raw) => {
    const view = hostSnap(raw);
    if (view && reconcileWith(lobby, room, view)) lobby.broadcastState(room);
    return decideOnHost(lobby, session, room, msg, view);
  });
}

function decideOnHost(lobby, session, room, msg, view) {
  const m = room.match;
  if (room.aiTakeoverEnabled !== true || room.mode !== 'coop' || !hostView(room) || !m || !view || view.phase !== 'PREP' || view.ended || view.disposed || view.emergencyFrozen) {
    return fail('AI handover requires preparation in an original-content match');
  }
  let votes = pending.get(room); if (!votes) pending.set(room, votes = new Map());
  const sync = () => { snapshot(room, votes); lobby.broadcastState(room); };
  if (msg.t === 'room.aiRequest') {
    const bot = view.players.find(p => p && p.playerId === msg.botId);
    if (!room.spectatorOf(session.playerId) || !session.connected || !bot?.isBot || bot.left || !bot.alive) return fail('a spectator must select an active AI');
    if ([...votes.values()].some(v => v.applicantId === session.playerId || v.botId === msg.botId)) return fail('request already pending');
    const eligible = votersFromView(room, view);
    if (!eligible.length) return fail('no online voter available');
    const id = String(room.aiTakeoverSeq = (room.aiTakeoverSeq || 0) + 1);
    const vote = { id, applicantId: session.playerId, applicantName: session.name, botId: msg.botId,
      match: m, round: view.round, eligible, expiresAt: Date.now() + 30000, yes: new Set(), no: new Set() };
    votes.set(id, vote);
    vote.timer = setTimeout(() => { if (votes.get(id) === vote) { drop(votes, id); sync(); } }, 30000);
    vote.timer.unref?.(); sync(); return { ok: true };
  }
  const vote = votes.get(msg.voteId);
  if (!vote) return fail('request expired');
  if (!vote.eligible.includes(session.playerId)) return fail('only online human room teammates can vote');
  (msg.approve ? vote.no : vote.yes).delete(session.playerId);
  (msg.approve ? vote.yes : vote.no).add(session.playerId);
  const required = Math.floor(vote.eligible.length / 2) + 1;
  if (vote.no.size >= required) { drop(votes, vote.id); sync(); return { ok: true }; }
  if (vote.yes.size >= required) {
    drop(votes, vote.id);
    const result = transferAiSeat(lobby, room, vote.applicantId, vote.botId);
    if (result && typeof result.then === 'function') return result.then((r) => { sync(); return r; });
    sync(); return result;
  }
  sync(); return { ok: true };
}

/**
 * fork: 「潜入」直接接管（业主 2026-11-01：**无需申请接替**）：观战者选中一个活跃 AI 席就直接换席，不走投票。
 * 门槛与投票路径一致（房主已开 `aiTakeoverEnabled`、coop、默认版本、本人是观战席、目标是活着的 AI、该席没有 session），
 * 但**不要求**「3–9 回合窗口」——潜入是临时加入，限制在窗口里等于不让人玩；安全性由「房主开关 + 只在休整期」保证。
 */
export async function aiTakeoverDirect(lobby, session, msg) {
  const room = lobby.roomOf(session), m = room?.match;
  if (room && reconcileAiTakeover(lobby, room)) lobby.broadcastState(room);
  const st = await matchState(m);
  if (!room || room.aiTakeoverEnabled !== true || room.mode !== 'coop' || room.version !== DEFAULT_VERSION
    || !st || st.phase !== 'PREP' || st.ended || st.disposed || st.frozen) return fail('AI handover requires preparation in a coop match');
  const bot = (st.bots || []).find((b) => b.playerId === msg.botId);
  if (!room.spectatorOf(session.playerId) || !session.connected || !bot) return fail('a spectator must select an active AI');
  return transferAiSeat(lobby, room, session.playerId, msg.botId);
}

/**
 * fork: 随机交接 (2026-10-31): 房主同时打开 aiTakeoverEnabled 与 aiRandomHandover 的 coop 房里，本局会在 3–9 回合中随机挑一个回合，在该回合的
 * PREP 开始替一名在线观战者向一个存活的 AI 席发起接管请求。仍然走同一套投票（不替任何人做决定），每局最多一次；
 * 挑回合/挑人/挑席都用对战种子派生，回放与测试可复现。
 * Called from lobby `opts.onPrepStart` (the match reports every PREP start).
 * @returns {boolean} whether a request was opened
 */
export async function maybeRandomAiTakeover(lobby, room, round) {
  const m = room?.match;
  if (!m || room.aiTakeoverEnabled !== true || room.aiRandomHandover !== true || room.mode !== 'coop' || room.version !== DEFAULT_VERSION) return false;
  if (room.aiRandomFired === true || !inWindow({ round })) return false;
  const st = await matchState(m);
  if (!st || st.phase !== 'PREP' || st.ended || st.disposed || st.frozen || st.round !== round) return false;
  const rng = seededRng(Number(m.seed) >>> 0, round);
  if (!Number.isInteger(room.aiRandomRound)) {
    room.aiRandomRound = AI_TAKEOVER_MIN_ROUND + (rng() % (AI_TAKEOVER_MAX_ROUND - AI_TAKEOVER_MIN_ROUND + 1));
  }
  if (room.aiRandomRound !== round) return false;
  const bots = st.bots || [];
  const viewers = (room.spectators || []).filter((s) => s && s.connected && lobby.registry.byId(s.playerId)?.connected);
  if (!bots.length || !viewers.length) return false;
  const bot = bots[rng() % bots.length];
  const viewer = viewers[rng() % viewers.length];
  const eligible = takeoverVoters(room);
  if (!eligible.length) return false;
  let votes = pending.get(room);
  if (!votes) pending.set(room, votes = new Map());
  if ([...votes.values()].some((v) => v.applicantId === viewer.playerId || v.botId === bot.playerId)) return false;
  room.aiRandomFired = true;
  const id = String(room.aiTakeoverSeq = (room.aiTakeoverSeq || 0) + 1);
  const vote = { id, applicantId: viewer.playerId, applicantName: viewer.name, botId: bot.playerId,
    match: m, round, eligible, expiresAt: Date.now() + 30000, yes: new Set(), no: new Set(), random: true };
  votes.set(id, vote);
  vote.timer = setTimeout(() => {
    if (votes.get(id) === vote) { drop(votes, id); snapshot(room, votes); lobby.broadcastState(room); }
  }, 30000);
  vote.timer.unref?.();
  snapshot(room, votes); lobby.broadcastState(room);
  return true;
}

/** fork: Deterministic xorshift for the random handover (the match seed + round; no Math.random, so a replay picks the same). */
function seededRng(seed, salt) {
  let x = (((seed || 1) ^ Math.imul(salt | 0, 2654435761)) >>> 0) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
}

export { afterReconcile };
