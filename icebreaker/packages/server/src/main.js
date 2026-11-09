// CLI: node packages/server/src/main.js [--port 8700] [--host 127.0.0.1] [--match <file.json>] [--trust-proxy]
//   [--max-rooms 500] [--max-battles 100] [--mods <folder>]
// (env AUE_ASSETS_DIR: the local assets directory; AUE_KITS_DIR: the pinned kits; AUE_MODS_DIR: the mods, read once at
// start, default <root>/mods — docs/spec/site.md 站点-7). Without --match the server holds the
// lobby and its rooms (docs/spec/room.md) and their battles; with it, one battle room of that match. It listens on
// 127.0.0.1 unless --host says otherwise (--host 0.0.0.0 for players on the local network). The guard (docs/spec/site.md
// 站点-2) limits each address's sockets and wrong room codes and the server's rooms and battles (--max-rooms,
// --max-battles: fewer on a small machine); behind a reverse proxy that sets X-Real-IP to the address it saw,
// --trust-proxy takes the address from there. As one node of several (site.md 站点-6) the environment names the node:
// NCN_GAME_DIGIT and NCN_GAME_PEERS (nodes.js).
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startHttpServer } from './http.js';
import { createMatchRoom } from './battle.js';
import { createBattles } from './battles.js';
import { createLobby } from './lobby.js';
import { SEATS_MAX } from './rooms.js';
import { projectViews, recruits } from './catalog.js';
import { kitDir, nodeKits } from './kits.js';
import { createGuard, guardUpgrades, countOption, LIMITS } from './guard.js';
import { nodeOf } from './nodes.js';
import { loadHostMods, modsDir } from './mods.js';
import { createModManager, loadOwnerKey } from './modManager.js';
import { withRogueLevels } from './rogueLevels.js';
import { createHash } from 'node:crypto';

/** @param {string[]} argv @returns {number} */
export function parsePort(argv) {
  const i = argv.indexOf('--port');
  if (i < 0) return 8700;
  const port = Number(argv[i + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port needs an integer from 0 to 65535');
  return port;
}

/** @param {string[]} argv @param {string} name */
const option = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2), file = option(args, '--match');
const kitsDir = kitDir(rootDir), log = (/** @type {string} */ line) => console.log(line);
const trustProxy = args.includes('--trust-proxy'), guard = createGuard();
console.log(kitsDir ? `kits: ${kitsDir}` : 'kits: none (operators fight on the engine’s own)');
const kits = kitsDir ? { kits: (/** @type {string[]} */ ids) => nodeKits(kitsDir, ids) } : {};
const hostModsDir = modsDir(rootDir, args, process.env);
const mods = await loadHostMods(hostModsDir);
for (const line of mods.lines) console.log(line);
// the mod manager: reads need no key, writes take --mod-key / AUE_MOD_KEY / mods/.mod-key (created on first start)
const modKey = loadOwnerKey({ rootDir, modsDir: hostModsDir, argv: args, env: process.env, log });
const modManager = createModManager({ modsDir: hostModsDir, key: modKey, log, initial: mods });
// 肉鸽关卡（635 张官方集成战略图）按需从磁盘读，不进 LEVELS 的静态 import：AUE_ROGUE_LEVELS 可指到别的目录
const rogueLevelsDir = process.env['AUE_ROGUE_LEVELS'] ?? join(rootDir, 'engine', 'packages', 'content', 'data', 'levels');
/** 肉鸽一局专用的关卡变体：同 id 复用（藏品/分队变了才另建一份）。 */
const rogueVariants = new Map();
const content = { ...kits, getSource: () => withRogueLevels(rogueLevelsDir, modManager.current().source, rogueVariants) };
function rogueVariant(baseId, scale, cost) {
  const h = createHash('sha1').update(JSON.stringify([scale, cost])).digest('hex').slice(0, 8), id = `${baseId}__s${h}`;
  if (!rogueVariants.has(id)) {
    const doc = JSON.parse(readFileSync(join(rogueLevelsDir, `${baseId}.json`), 'utf8'));
    const mul = { mods: { max_hp: scale.max_hp, atk: scale.atk, def: scale.def, move_speed: scale.move_speed, attack_speed: scale.attack_speed } };
    for (const d of Object.values(doc.difficulties ?? {})) (d.enemyMul ??= []).push(mul);
    doc.id = id;
    doc.level = { ...doc.level, id, options: { ...doc.level.options, initialCost: Math.max(0, (doc.level.options.initialCost ?? 10) + cost) } };
    rogueVariants.set(id, doc);
  }
  return id;
}

/** @type {(req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void} */
let onUpgrade;
if (file) {
  onUpgrade = (await createMatchRoom(JSON.parse(readFileSync(file, 'utf8')), { log, ...content })).upgrade;
} else {
  const battles = createBattles({ ...content, log, max: countOption(args, '--max-battles', LIMITS.battles),
    // 一场对局结束时：房间回去「项目调整」，肉鸽把结果回写到它那一次探索（result 1 = 胜；0 负 / -1 引擎失败都算失败）
    onEnd: (id) => { const r = battles.live.get(id)?.room?.host?.world?.result ?? -1; log(`battle ${id} ended result=${r}`); lobby.rooms.ended(id); lobby.rogue.endHandler(id, r); } });
  const node = nodeOf(process.env, log);
  if (node) console.log(`node ${node.digit} of ${Object.keys(node.peers).length}: room codes begin with ${node.digit}`);
  const lobby = createLobby({ projects: projectViews(), recruits: await recruits(), startMatch: (m, keys) => battles.start(m, keys), log, guard, trustProxy, node, variant: rogueVariant,
    // 肉鸽的超时保险：直接把对局判成「守住」（result 1），sweep 随后走正常的 onEnd 回写
    forceEnd: (id) => { const b = battles.live.get(id); if (b && !b.endedAt && b.room.host.world.result < 0) { b.room.host.world.result = 1; b.room.host.world.events.push({ type: 'end', result: 1 }); } },
    startTraining: (m, key) => battles.start(m, [key], { absent: [1] }),
    maxRooms: countOption(args, '--max-rooms', LIMITS.rooms),
    // 房间座位数：默认 2（上游的合作人数），`--seats 4` 开四人房。上限见 rooms.js 的 SEATS_MAX。
    seats: Math.max(1, Math.min(SEATS_MAX, countOption(args, '--seats', 2))) });
  onUpgrade = (req, socket, head) => { if (!lobby.upgrade(req, socket, head) && !battles.upgrade(req, socket, head)) socket.destroy(); };
}
const server = await startHttpServer({ rootDir, port: parsePort(args), host: option(args, '--host') ?? '127.0.0.1', onUpgrade: guardUpgrades(guard, trustProxy, onUpgrade), kitsDir, home: file ? 'play' : 'room', mods, modManager,
  rogueLevelsDir, rogueLevelOf: (id) => rogueVariants.get(id) ?? null });
const addr = server.address();
if (addr !== null && typeof addr === 'object') console.log(`http://${addr.address}:${addr.port}/`);
