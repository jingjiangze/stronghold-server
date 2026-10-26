// The server's guard on the open internet (docs/spec/site.md 站点-2): how many WebSockets one network address may hold
// (the lobby's and the battles' together), how many wrong room codes it may try in a minute, and the address itself —
// the peer's, or behind a trusted reverse proxy the one it says it saw.

/** The limits (站点-2). */
export const LIMITS = Object.freeze({ sockets: 24, wrongCodes: 10, wrongMs: 60_000, rooms: 500, battles: 100 });

/**
 * A limit given on the command line (--max-rooms 50), or its default; anything but a whole number from 1 is an error.
 * @param {string[]} argv @param {string} name @param {number} fallback
 */
export function countOption(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} needs a whole number from 1`);
  return n;
}

/**
 * A connection's network address: with `trustProxy` the proxy's X-Real-IP (the proxy must set it to the address it
 * saw), else the peer's own.
 * @param {import('node:http').IncomingMessage} req @param {boolean} trustProxy
 */
export function addressOf(req, trustProxy) {
  const told = trustProxy ? req.headers['x-real-ip'] : undefined;
  return (typeof told === 'string' && told.trim()) || req.socket.remoteAddress || 'unknown';
}

/**
 * @param {{ now?: () => number, limits?: Partial<Record<keyof typeof LIMITS, number>> }} [o]
 */
export function createGuard(o = {}) {
  const now = o.now ?? (() => Date.now()), lim = { ...LIMITS, ...o.limits };
  /** Open sockets by address. @type {Map<string, number>} */
  const open = new Map();
  /** The times of each address's wrong room codes within the window. @type {Map<string, number[]>} */
  const wrong = new Map();

  /** @param {string} addr */
  const recent = (addr) => {
    const t = now(), list = (wrong.get(addr) ?? []).filter((x) => t - x < lim.wrongMs);
    if (list.length) wrong.set(addr, list);
    else wrong.delete(addr);
    return list;
  };

  return {
    limits: lim,
    /** One more socket for the address, or false when it holds its limit already. @param {string} addr */
    admit(addr) {
      const n = open.get(addr) ?? 0;
      if (n >= lim.sockets) return false;
      open.set(addr, n + 1);
      return true;
    },
    /** A socket of the address closed. @param {string} addr */
    release(addr) {
      const n = (open.get(addr) ?? 0) - 1;
      if (n > 0) open.set(addr, n);
      else open.delete(addr);
    },
    /** Whether the address may look a room code up now. @param {string} addr */
    mayJoin: (addr) => recent(addr).length < lim.wrongCodes,
    /** The address tried a code no room has. @param {string} addr */
    wrongCode(addr) { wrong.set(addr, [...recent(addr), now()]); },
    /** How many sockets each address holds (for the logs and tests). */
    sockets: () => new Map(open),
  };
}

/**
 * The server's upgrade handler with the guard in front (站点-2): an address at its socket limit gets 429 and no
 * WebSocket; an admitted one counts until its socket closes.
 * @param {ReturnType<typeof createGuard>} guard @param {boolean} trustProxy
 * @param {(req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void} next
 */
export function guardUpgrades(guard, trustProxy, next) {
  return (/** @type {import('node:http').IncomingMessage} */ req, /** @type {import('node:stream').Duplex} */ socket, /** @type {Buffer} */ head) => {
    const addr = addressOf(req, trustProxy);
    if (!guard.admit(addr)) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    socket.once('close', () => guard.release(addr));
    next(req, socket, head);
  };
}
