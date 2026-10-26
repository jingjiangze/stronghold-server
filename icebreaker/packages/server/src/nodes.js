// The server as one node of several (docs/spec/site.md 站点-6): the same server runs on several machines, each with its
// own rooms; a room's code begins with its node's digit, and a code of another node is answered with that node's name,
// so the page connects there. Set by the environment of the server's process; without it the server is a node of its
// own, as before.
//
//   NCN_GAME_DIGIT   this node's digit, 1–9
//   NCN_GAME_PEERS   every node's digit and host name: "1=a.example.org,2=b.example.org" (this node too)

/** @typedef {{ digit: number, peers: Record<string, string> }} Node */

/** A host name a page may connect to: letters, digits, hyphens and dots only, at least one dot. */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * This server's node from the environment (站点-6); null without one, or when the values are not as above (the server
 * then keeps 6-digit codes of its own, and logs why).
 * @param {Record<string, string | undefined>} env @param {(line: string) => void} [log] @returns {Node | null}
 */
export function nodeOf(env, log = () => {}) {
  const d = (env['NCN_GAME_DIGIT'] ?? '').trim(), list = (env['NCN_GAME_PEERS'] ?? '').trim();
  if (!d && !list) return null;
  if (!/^[1-9]$/.test(d)) { log(`NCN_GAME_DIGIT is not a digit from 1 to 9: "${d}" — a node of its own`); return null; }
  /** @type {Record<string, string>} */
  const peers = {};
  for (const part of list.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([1-9])=(.+)$/.exec(part), host = m ? m[2].toLowerCase() : '';
    if (!m || !HOST.test(host) || Object.hasOwn(peers, m[1])) { log(`NCN_GAME_PEERS has a bad entry "${part}" — a node of its own`); return null; }
    peers[m[1]] = host;
  }
  return { digit: Number(d), peers };
}

/**
 * A new room's code (房间-1, 站点-6): 6 digits none uses — on a node, its digit then 5 random ones.
 * @param {Node | null | undefined} node @param {() => number} random @param {(code: string) => boolean} taken
 */
export function newCode(node, random, taken) {
  let code;
  do code = node ? `${node.digit}${String(Math.floor(random() * 1e5)).padStart(5, '0')}` : String(Math.floor(random() * 1e6)).padStart(6, '0');
  while (taken(code));
  return code;
}

/**
 * The host of the node a room code belongs to when it is another node's (站点-6): its first digit is another node's in
 * the list; null for this node's, an unknown digit, or a server that is no node.
 * @param {Node | null | undefined} node @param {string} code
 */
export function elsewhere(node, code) {
  if (!node || !/^\d{6}$/.test(code) || code[0] === String(node.digit)) return null;
  return Object.hasOwn(node.peers, code[0]) ? node.peers[code[0]] : null;
}
