// The lobby socket (docs/spec/room.md): a browser connects to /lobby, says hello with its session key and name, then
// creates or joins a room and goes through the allocation; rooms.js holds the state. Every message is checked with
// lobbyMessageProblem first; a connection that sends too much, too fast or malformed is closed. With a guard, an
// address that tried too many wrong room codes is told to wait instead of having its code looked up (站点-2).
import { WebSocketServer } from 'ws';
import { TOASTS } from '@icebreaker/mode-regular';
import { createRooms } from './rooms.js';
import { createMatcher } from './match.js';
import { addressOf } from './guard.js';
import { trainingMatch } from './catalog.js';

/** Largest message a browser may send to the lobby, in bytes (a squad of 30 operators fits). */
export const MAX_LOBBY_MESSAGE = 16384;
/** Messages a connection may send: a burst, refilled per second. */
const BURST = 30, REFILL = 10;

/** @param {unknown} x @returns {x is Record<string, unknown>} */
const isRecord = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
/** @param {unknown} x @param {number} max */
const shortText = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max;
/** An operator's id. @param {unknown} x */
const operatorId = (x) => typeof x === 'string' && /^char_[a-z0-9_]{1,40}$/.test(x);
/** A name card's assistant: an operator and its art (1: elite 1, 2: elite 2), or none. @param {unknown} x */
const assistPick = (x) => x === null || (isRecord(x) && Object.keys(x).sort().join() === 'art,id' && operatorId(x.id) && (x.art === 1 || x.art === 2));

/** Each message's fields beside `t`, and the check of their values. @type {Record<string, (m: Record<string, unknown>) => boolean>} */
const SHAPES = {
  hello: (m) => shortText(m.key, 64) && shortText(m.name, 16) && String(m.name).trim().length > 0,
  create: () => true, leave: () => true, kick: () => true, go: () => true, handover: () => true, like: () => true,
  emote: (m) => shortText(m.id, 48) && shortText(m.theme, 48), unseek: () => true, together: () => true,
  seek: (m) => Array.isArray(m.classes) && m.classes.length <= 8 && m.classes.every((c) => shortText(c, 16)) && shortText(m.pos, 16) && typeof m.inverse === 'boolean'
    && isRecord(m.squad) && shortText(m.style, 16),
  ping: (m) => typeof m.at === 'number' && Number.isFinite(m.at),
  profile: (m) => typeof m.tag === 'string' && /^\d{4}$/.test(m.tag) && (m.avatar === '' || operatorId(m.avatar)) && assistPick(m.assist),
  join: (m) => shortText(m.code, 200),
  train: (m) => shortText(m.level, 32),
  project: (m) => Number.isInteger(m.index),
  prepare: (m) => typeof m.on === 'boolean',
  inverse: (m) => typeof m.on === 'boolean',
  ready: (m) => typeof m.on === 'boolean',
  confirm: (m) => isRecord(m.squad) && shortText(m.style, 16),
  pick: (m) => shortText(m.id, 32),
  lineup: (m) => Array.isArray(m.lineup) && m.lineup.length <= 12 && m.lineup.every((x) => isRecord(x) && Object.keys(x).sort().join() === 'id,module,skill'),
};
/** The fields each message has besides `t`. @type {Record<string, string>} */
const FIELDS = { hello: 'key,name', ping: 'at', train: 'level', profile: 'assist,avatar,tag', join: 'code', project: 'index', prepare: 'on', ready: 'on', confirm: 'squad,style', pick: 'id', lineup: 'lineup', emote: 'id,theme', inverse: 'on', seek: 'classes,inverse,pos,squad,style' };

/**
 * Why a lobby message is malformed, or null (room.md): a known type with exactly its fields, each of its kind; the
 * squad and the lineup are checked against the rules by the room (rooms.js, with the regular mode's squad rules).
 * @param {unknown} m @returns {string | null}
 */
export function lobbyMessageProblem(m) {
  if (!isRecord(m) || typeof m.t !== 'string' || !Object.hasOwn(SHAPES, m.t)) return 'not a lobby message';
  const want = ['t', ...(FIELDS[m.t] ? FIELDS[m.t].split(',') : [])].sort().join();
  if (Object.keys(m).sort().join() !== want) return `${m.t}: fields are not ${want}`;
  return SHAPES[m.t](m) ? null : `${m.t}: a field is malformed`;
}

/**
 * 训练场 (房间-11): a training level's match for a session alone, the partner's seat absent; the page goes to it as to a
 * room's match. Not from a room; a search for a mate ends.
 * @param {{ o: { random?: () => number, startTraining?: (match: import('@aue/schema').Match, key: string) => Promise<string> | string },
 *   rooms: { inRoom: (id: number) => boolean }, matcher: { drop: (id: number) => void }, key: string | undefined }} L
 * @param {number} id @param {import('ws').WebSocket} ws @param {string} level
 */
async function train(L, id, ws, level) {
  const reply = (/** @type {Record<string, unknown>} */ msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const match = trainingMatch(level, Math.floor((L.o.random ?? Math.random)() * 0x7fffffff));
  if (L.rooms.inRoom(id)) { reply({ t: 'error', msg: '已在房间里，不能训练' }); return; }
  if (!match || !L.key || !L.o.startTraining) { reply({ t: 'error', msg: '没有这个训练' }); return; }
  L.matcher.drop(id);
  try {
    reply({ t: 'start', match: await L.o.startTraining(match, L.key), seat: 0, training: level });
  } catch (e) { reply({ t: 'error', msg: `训练没能开始：${/** @type {Error} */ (e).message}` }); }
}

/**
 * The lobby: its rooms and the upgrade of /lobby connections; `guard` and `trustProxy` as the server's (站点-2); a
 * training's match started through `startTraining` (房间-11).
 * @param {Omit<import('./rooms.js').RoomsOptions, 'send' | 'now' | 'random' | 'wrongCode'> & { now?: () => number, random?: () => number, log?: (line: string) => void,
 *   guard?: ReturnType<typeof import('./guard.js').createGuard>, trustProxy?: boolean, startTraining?: (match: import('@aue/schema').Match, key: string) => Promise<string> | string }} o
 */
export function createLobby(o) {
  /** The connections, their network addresses and their sessions' keys once they said hello. @type {[Map<number, import('ws').WebSocket>, Map<number, string>, Map<number, string>]} */
  const [sockets, addresses, keys] = [new Map(), new Map(), new Map()];
  let next = 1;
  const rooms = createRooms({
    ...o, now: o.now ?? (() => Date.now()), random: o.random ?? Math.random,
    send: (id, msg) => { const ws = sockets.get(id); if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); },
    wrongCode: (id) => { const addr = addresses.get(id); if (addr !== undefined) o.guard?.wrongCode(addr); },
  });
  // 快速匹配 (房间-9): who is looking for a mate; a pair gets its room
  const matcher = createMatcher({
    now: o.now ?? (() => Date.now()), random: o.random ?? Math.random, projects: /** @type {any} */ (o.projects),
    send: (id, msg) => { const ws = sockets.get(id); if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); },
    open: (pair, project) => rooms.openMatched(pair, project),
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_LOBBY_MESSAGE });
  const timer = setInterval(() => { rooms.tick(); matcher.tick(); }, 250);

  /** @param {import('ws').WebSocket} ws @param {Record<string, unknown>} msg */
  const reply = (ws, msg) => ws.send(JSON.stringify(msg));
  /**
   * The messages of a session that said hello, besides the room's own: the latency the page shows (页面-6, its own time
   * sent straight back), the name card, joining (held for an address past its wrong codes, 站点-2), 快速匹配 (房间-9).
   * @type {Record<string, (id: number, ws: import('ws').WebSocket, addr: string, m: any) => void>}
   */
  const OWN = {
    ping: (_id, ws, _a, m) => reply(ws, { t: 'pong', at: m.at }),
    profile: (id, _ws, _a, m) => rooms.profile(id, { tag: m.tag, avatar: m.avatar, assist: m.assist }),
    join: (id, ws, addr, m) => {
      if (o.guard && !o.guard.mayJoin(addr)) { reply(ws, { t: 'error', msg: TOASTS['continuousClicks'] }); return; }
      matcher.drop(id);
      rooms.message(id, m);
    },
    create: (id, _ws, _a, m) => { matcher.drop(id); rooms.message(id, m); },
    seek: (id, ws, _a, m) => { if (rooms.inRoom(id)) reply(ws, { t: 'error', msg: '已在房间里，不能匹配' }); else matcher.seek(id, m); },
    unseek: (id) => matcher.cancel(id),
    train: (id, ws, _a, m) => { void train({ o, rooms, matcher, key: keys.get(id) }, id, ws, m.level); },
  };

  /** @param {import('ws').WebSocket} ws @param {string} addr */
  function connect(ws, addr) {
    const id = next++, bucket = { n: BURST, at: Date.now() };
    let hello = false;
    sockets.set(id, ws);
    addresses.set(id, addr);
    ws.on('message', (data, binary) => {
      const now = Date.now();
      bucket.n = Math.min(BURST, bucket.n + ((now - bucket.at) / 1000) * REFILL);
      bucket.at = now;
      if (binary || --bucket.n < 0) { ws.close(1008, binary ? 'text only' : 'too many messages'); return; }
      let m;
      try { m = JSON.parse(String(data)); } catch { m = null; }
      const why = lobbyMessageProblem(m);
      if (why) { ws.close(1008, why.slice(0, 120)); return; }
      if (m.t === 'hello') { hello = true; keys.set(id, m.key); rooms.hello(id, m.key, String(m.name).trim()); } else if (!hello) ws.close(1008, 'say hello first');
      else if (Object.hasOwn(OWN, m.t)) OWN[m.t](id, ws, addr, m);
      else rooms.message(id, m);
    });
    ws.on('close', () => { sockets.delete(id); addresses.delete(id); keys.delete(id); matcher.drop(id); if (hello) rooms.gone(id); });
  }

  return {
    rooms,
    matcher,
    /** Takes over an upgrade for /lobby; false for any other path. @param {import('node:http').IncomingMessage} req @param {import('node:stream').Duplex} socket @param {Buffer} head */
    upgrade(req, socket, head) {
      if (new URL(req.url ?? '/', 'http://x').pathname !== '/lobby') return false;
      wss.handleUpgrade(req, socket, head, (ws) => connect(ws, addressOf(req, !!o.trustProxy)));
      return true;
    },
    close() { clearInterval(timer); for (const ws of sockets.values()) ws.close(1001, 'server closing'); wss.close(); },
  };
}
