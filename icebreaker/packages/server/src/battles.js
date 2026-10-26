// The battles of a server's rooms (docs/spec/room.md 房间-6): each started match is a battle room of its own, reached
// at /battle?match=<id>&seat=<n> by the room's members only (their session keys take the seats). A battle that ended
// tells its room and stays a while for the players to see the result and reconnect; one nobody has been connected to
// for a long time ends too.
import { randomBytes } from 'node:crypto';
import { createMatchRoom } from './battle.js';

/** How long an ended battle stays, and how long one may have nobody connected, in ms. */
export const LINGER = Object.freeze({ ended: 120_000, empty: 10 * 60_000 });

/**
 * @param {{ kits?: import('./battle.js').BattleRoomOptions['kits'], source?: import('@aue/content').ContentSource, getSource?: () => import('@aue/content').ContentSource, log?: (line: string) => void, onEnd: (id: string) => void, max?: number, now?: () => number }} o
 */
export function createBattles(o) {
  const now = o.now ?? (() => Date.now());
  /** @type {Map<string, { room: Awaited<ReturnType<typeof createMatchRoom>>, endedAt: number, emptySince: number }>} */
  const live = new Map();

  /** @param {string} id */
  function end(id) {
    const b = live.get(id);
    if (!b || b.endedAt) return;
    b.endedAt = now();
    o.onEnd(id);
  }

  function sweep() {
    const t = now();
    for (const [id, b] of live) {
      const online = b.room.online();
      b.emptySince = online > 0 ? 0 : b.emptySince || t;
      if (!b.endedAt && (b.room.ended() || (b.emptySince && t - b.emptySince > LINGER.empty))) end(id);
      else if (b.endedAt && t - b.endedAt > LINGER.ended) { b.room.close(); live.delete(id); }
    }
  }
  const timer = setInterval(sweep, 1000);

  return {
    live,
    sweep,
    /**
     * Starts a match whose seats only the given keys take — nobody the absent ones (a training's partner, engine
     * 同步-14) —; its id. @param {import('@aue/schema').Match} match @param {string[]} keys @param {{ absent?: number[] }} [more]
     * @returns {Promise<string>}
     */
    async start(match, keys, more = {}) {
      if (o.max && live.size >= o.max) throw new Error('服务器的对局已满');
      const id = randomBytes(6).toString('hex');
      // the content source is read PER MATCH: the mod manager reloads it, and the next battle must see the new set
      const source = typeof o.getSource === 'function' ? o.getSource() : o.source;
      const room = await createMatchRoom(match, { keys, ...(o.kits ? { kits: o.kits } : {}), ...(source ? { source } : {}), ...(more.absent ? { absent: more.absent } : {}),
        log: (line) => o.log?.(`[${id}] ${line}`) });
      live.set(id, { room, endedAt: 0, emptySince: now() });
      return id;
    },
    /** Takes over an upgrade for /battle?match=…; false for any other path. @param {import('node:http').IncomingMessage} req @param {import('node:stream').Duplex} socket @param {Buffer} head */
    upgrade(req, socket, head) {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== '/battle') return false;
      const b = live.get(url.searchParams.get('match') ?? '');
      if (b) b.room.upgrade(req, socket, head);
      else socket.destroy();
      return true;
    },
    close() { clearInterval(timer); for (const b of live.values()) b.room.close(); live.clear(); },
  };
}
