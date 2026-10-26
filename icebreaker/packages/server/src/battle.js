// The battle socket: one room of a match (同步-9), or of the M0.5 skeleton stage when no match is given. A browser
// connects to /battle?seat=<n>; its first hello binds the seat to its key, so a later connection with another key
// cannot take the seat over. Every message is checked with clientMessageProblem before the lockstep host sees it; the
// host's clock is ticked on a timer.
import { WebSocketServer } from 'ws';
import { clientMessageProblem, matchProblem, MAX_SEAT } from '@aue/schema';
import { LockstepHost } from '@aue/net';
import { skeletonContent, matchContent } from '@aue/content';
import { signalRule } from '@icebreaker/mode-regular';

/** Largest message a browser may send, in bytes. */
export const MAX_MESSAGE = 4096;
const TICK_MS = 1000 / 60;

/** The training of the default decks' operators: elite 0 at level 30, potential 1, no trust, the first skill at level 4. */
const BUILD = Object.freeze({ elite: 0, level: 30, potential: 1, trust: 0, skill: 0, skillLevel: 4 });
/** The reserve operators have no skill. */
const RESERVES = Object.freeze(['char_500_noirc', 'char_502_nblade', 'char_503_rang']);
const deck = (/** @type {string[]} */ ids) => ids.map((id) => ({ id, build: { ...BUILD, skill: RESERVES.includes(id) ? -1 : 0 } }));

/** The default match: IG-1 (act1multi_01) at 初级赛, the reserve operators for seat 0 and four 3-stars for seat 1. */
export const DEFAULT_MATCH = Object.freeze({
  level: 'act1multi_01', difficulty: /** @type {const} */ ('NORMAL'), seed: 1209492319,
  decks: [deck(['char_500_noirc', 'char_502_nblade', 'char_503_rang', 'char_122_beagle']), deck(['char_123_fang', 'char_240_wyvern', 'char_124_kroos', 'char_212_ansel'])],
});

/**
 * @typedef {object} BattleRoomOptions
 * @property {number} [seats]
 * @property {number} [seed]
 * @property {ConstructorParameters<typeof LockstepHost>[0]['content']} [content] the battle's content (default: the skeleton stage)
 * @property {import('@aue/schema').Match | null} [match] the match settings the content was made from
 * @property {() => number} [now] milliseconds
 * @property {(line: string) => void} [log]
 * @property {import('@aue/content').ContentSource} [source] the content the match is made from: the host's mods (站点-7), default the official content
 * @property {(charIds: string[]) => Promise<{ kits: Record<string, any>, failed: string[] }>} [kits] loads the pinned kits of a match's
 *   operators (kits.js nodeKits); none: the operators fight on the engine's own (engine ADR 0058)
 * @property {string[]} [keys] each seat's key set beforehand (a room's members, room.md 房间-6): only it takes the seat
 * @property {number[]} [absent] the seats nobody plays (a training's partner, engine 同步-14)
 * @property {(seat: number, s: import('@aue/schema').Signal, now: number) => boolean} [signals] the mode's rule for the seats' signals (engine 同步-13)
 */

/**
 * A room of a match (同步-9): its content is made from the settings first; the seats' signals go by 常规项目's rule
 * (marks and battle emotes, room.md 房间-12).
 * @param {import('@aue/schema').Match} match @param {Omit<BattleRoomOptions, 'content' | 'match' | 'seats' | 'seed'>} [o]
 */
export async function createMatchRoom(match, o = {}) {
  const why = matchProblem(match);
  if (why) throw new Error(`match settings: ${why}`);
  const loaded = o.kits ? await o.kits(match.decks.flat().map((e) => e.id)) : null;
  if (loaded?.failed.length) o.log?.(`kits not loaded: ${loaded.failed.join(', ')}`);
  const content = await matchContent(match, { ...(o.source ? { source: o.source } : {}), kits: loaded?.kits ?? {} });
  return createBattleRoom({ signals: signalRule(content.level), ...o, content, match, seats: match.decks.length, seed: match.seed });
}

/**
 * A battle's guard against an engine error (房间-6): `run` calls into the engine; if that throws (a bug), the battle ends
 * alone — the error logged with its stack, `stop` called, its seats closed with 1011 — and the process, with every
 * other room and battle on it, goes on. Uncaught, such an error took the whole server down. After it, `run` does nothing.
 * @param {(line: string) => void} log @param {Map<number, import('ws').WebSocket>} sockets @param {() => void} stop
 */
function guardOf(log, sockets, stop) {
  let failed = false;
  return {
    failed: () => failed,
    /** @param {() => void} f */
    run(f) {
      if (failed) return;
      try { f(); } catch (e) {
        failed = true;
        stop();
        log(`battle failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        for (const ws of sockets.values()) ws.close(1011, 'battle failed');
      }
    },
  };
}

/** @param {BattleRoomOptions} [o] */
export function createBattleRoom(o = {}) {
  const now = o.now ?? (() => performance.now()), log = o.log ?? (() => {}), seats = o.seats ?? 2;
  /** @type {Map<number, import('ws').WebSocket>} */
  const sockets = new Map();
  /** @type {Map<number, string>} */
  const keys = new Map((o.keys ?? []).map((k, seat) => [seat, k]));
  const host = new LockstepHost({
    content: o.content ?? skeletonContent, seats, seed: o.seed ?? 1, match: o.match ?? null, ...(o.absent ? { absent: o.absent } : {}), ...(o.signals ? { signals: o.signals } : {}),
    send: (seat, msg) => { const ws = sockets.get(seat); if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); },
    onDesync: (d) => log(`desync seat ${d.seat} at frame ${d.frame}: ${d.theirs} != ${d.ours}`),
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  const guard = guardOf(log, sockets, () => clearInterval(timer));
  const timer = setInterval(() => guard.run(() => host.tick(now())), TICK_MS);

  /** What a seat's checked message does, besides hello. @type {Record<string, (seat: number, m: any) => void>} */
  const routes = {
    cmd: (seat, m) => host.command(seat, m.at, m.cmd),
    hash: (seat, m) => host.hash(seat, m.frame, m.hash),
    speed: (seat, m) => host.speed(seat, m.on, now()),
    pause: (seat) => host.pause(seat, now()),
    pauseReply: (seat, m) => host.pauseReply(seat, m.accept, now()),
    resume: (seat) => host.resume(seat, now()),
    ready: (seat) => host.ready(seat, now()),
    signal: (seat, m) => host.signal(seat, m.s, now()),
  };

  /** @param {import('ws').WebSocket} ws @param {number} seat @param {string} text */
  const onMessage = (ws, seat, text) => {
    /** @type {unknown} */
    let m;
    try { m = JSON.parse(text); } catch { m = null; }
    const why = clientMessageProblem(m);
    if (why) { ws.close(1008, why.slice(0, 120)); return; }
    const msg = /** @type {import('@aue/schema').ClientMessage} */ (m);
    if (guard.failed()) ws.close(1011, 'battle failed');
    else if (msg.t === 'hello') guard.run(() => hello(ws, seat, msg));
    else if (sockets.get(seat) !== ws) ws.close(1008, 'say hello first');
    else guard.run(() => routes[msg.t](seat, msg));
  };

  /** @param {import('ws').WebSocket} ws @param {number} seat @param {Extract<import('@aue/schema').ClientMessage, { t: 'hello' }>} msg */
  const hello = (ws, seat, msg) => {
    if (msg.seat !== seat || (keys.has(seat) && keys.get(seat) !== msg.key)) { ws.close(1008, 'seat taken'); return; }
    keys.set(seat, msg.key);
    const old = sockets.get(seat);
    sockets.set(seat, ws);
    if (old && old !== ws) old.close(1000, 'replaced');
    host.hello(seat, now());
    log(`seat ${seat} connected`);
  };

  return {
    host,
    /** Whether the match has ended (won or lost: the arbiter's world has a result), or failed (an engine error). */
    ended: () => guard.failed() || host.world.result >= 0,
    /** Whether the engine threw in this battle and it was ended for everyone. */
    failed: guard.failed,
    /** How many seats are connected. */
    online: () => sockets.size,
    /** Takes over an HTTP upgrade for /battle?seat=N. @param {import('node:http').IncomingMessage} req @param {import('node:stream').Duplex} socket @param {Buffer} head */
    upgrade(req, socket, head) {
      const url = new URL(req.url ?? '/', 'http://x'), seat = Number(url.searchParams.get('seat'));
      // an absent seat (a training's partner, engine 同步-14) is nobody's to take
      if (url.pathname !== '/battle' || !Number.isInteger(seat) || seat < 0 || seat >= Math.min(seats, MAX_SEAT + 1) || o.absent?.includes(seat)) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('message', (data, binary) => { if (binary) ws.close(1003, 'text only'); else onMessage(ws, seat, String(data)); });
        ws.on('close', () => { if (sockets.get(seat) === ws) { sockets.delete(seat); guard.run(() => host.bye(seat, now())); log(`seat ${seat} left`); } });
      });
    },
    close() { clearInterval(timer); for (const ws of sockets.values()) ws.close(1001, 'server closing'); wss.close(); },
  };
}
