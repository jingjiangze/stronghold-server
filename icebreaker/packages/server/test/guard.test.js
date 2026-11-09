// The guard on the open internet (docs/spec/site.md 站点-2): sockets per address, wrong room codes per minute, the
// address behind a trusted proxy, and the limits as the lobby and the server apply them over real WebSockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { TOASTS } from '@icebreaker/mode-regular';
import { createGuard, guardUpgrades, addressOf, countOption, LIMITS, createHttpServer, createLobby, createRooms, projectViews, recruits } from '../src/index.js';

/** A request as the guard reads it. @param {string} peer @param {Record<string, string>} [headers] */
const req = (peer, headers = {}) => /** @type {any} */ ({ headers, socket: { remoteAddress: peer } });

test('[站点-2] an address holds at most its sockets; a closed one frees a place', () => {
  const g = createGuard({ limits: { sockets: 2 } });
  assert.equal(g.admit('a'), true);
  assert.equal(g.admit('a'), true);
  assert.equal(g.admit('a'), false);
  assert.equal(g.admit('b'), true, 'another address has its own');
  g.release('a');
  assert.equal(g.admit('a'), true);
  g.release('b');
  assert.deepEqual([...g.sockets()], [['a', 2]]);
  assert.equal(LIMITS.sockets, 24);
});

test('[站点-2] wrong room codes: at most so many a minute, counted per address, forgotten after the window', () => {
  let t = 0;
  const g = createGuard({ now: () => t, limits: { wrongCodes: 3 } });
  for (let i = 0; i < 3; i++) { assert.equal(g.mayJoin('a'), true); g.wrongCode('a'); t += 1000; }
  assert.equal(g.mayJoin('a'), false);
  assert.equal(g.mayJoin('b'), true);
  t = 60_001;
  assert.equal(g.mayJoin('a'), true, 'the first wrong code left the window');
});

test('[站点-2] the room and battle limits come from the command line, else the defaults', () => {
  assert.equal(countOption(['--port', '1'], '--max-rooms', LIMITS.rooms), 500);
  assert.equal(countOption(['--max-battles', '12'], '--max-battles', LIMITS.battles), 12);
  for (const bad of [['--max-rooms'], ['--max-rooms', '0'], ['--max-rooms', '2.5'], ['--max-rooms', 'many']]) assert.throws(() => countOption(bad, '--max-rooms', 1), /whole number/);
});

test('[站点-2] the address is the peer, or behind a trusted proxy its X-Real-IP', () => {
  assert.equal(addressOf(req('10.0.0.5', { 'x-real-ip': '203.0.113.9' }), false), '10.0.0.5', 'a header nobody trusts is ignored');
  assert.equal(addressOf(req('127.0.0.1', { 'x-real-ip': '203.0.113.9' }), true), '203.0.113.9');
  assert.equal(addressOf(req('127.0.0.1'), true), '127.0.0.1', 'no header: the peer');
});

test('[站点-2] a full server refuses a new room with the activity\'s busy toast', () => {
  const sent = /** @type {[number, any][]} */ ([]);
  const rooms = createRooms({ now: () => 0, random: Math.random, send: (id, m) => sent.push([id, m]), startMatch: () => 'x', projects: [], recruits: [], maxRooms: 1 });
  rooms.hello(1, 'k1', 'A');
  rooms.hello(2, 'k2', 'B');
  rooms.message(1, { t: 'create' });
  rooms.message(2, { t: 'create' });
  assert.equal(rooms.rooms.size, 1);
  assert.deepEqual(sent.filter(([id, m]) => id === 2 && m.t === 'error').map(([, m]) => m.msg), [TOASTS['serverOverload']]);
});

/** @param {number} port @param {string} [ip] */
function open(port, ip) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/lobby`, ip ? { headers: { 'X-Real-IP': ip } } : {}), got = /** @type {any[]} */ ([]);
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  const opened = new Promise((r) => { ws.on('open', () => r(true)); ws.on('unexpected-response', (_q, res) => r(res.statusCode)); ws.on('error', () => {}); });
  return { ws, got, opened, send: (/** @type {any} */ m) => ws.send(JSON.stringify(m)) };
}

/** @param {() => boolean} f */
const until = async (f) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(f()); };

test('[站点-2] over the server: an address past its sockets gets 429; one past its wrong codes is told to wait', async () => {
  const guard = createGuard({ limits: { sockets: 2, wrongCodes: 2 } });
  const lobby = createLobby({ projects: projectViews(), recruits: await recruits(), startMatch: () => 'x', guard, trustProxy: true });
  const server = createHttpServer({ rootDir: process.cwd(), onUpgrade: guardUpgrades(guard, true, (q, s, h) => { if (!lobby.upgrade(q, s, h)) s.destroy(); }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  try {
    const a = open(port, '198.51.100.1'), b = open(port, '198.51.100.1');
    assert.deepEqual(await Promise.all([a.opened, b.opened]), [true, true]);
    assert.equal(await open(port, '198.51.100.1').opened, 429);
    const c = open(port, '198.51.100.2');
    assert.equal(await c.opened, true, 'another address');
    a.send({ t: 'hello', key: 'ka', name: 'A' });
    for (const code of ['000001', '000002', '000003']) a.send({ t: 'join', code });
    await until(() => a.got.filter((m) => m.t === 'error').length === 3);
    assert.deepEqual(a.got.filter((m) => m.t === 'error').map((m) => m.msg), ['没有这个房间编号', '没有这个房间编号', TOASTS['continuousClicks']]);
    b.ws.close();
    await until(() => guard.sockets().get('198.51.100.1') === 1);
    assert.equal(await open(port, '198.51.100.1').opened, true, 'a closed socket frees its place');
  } finally {
    lobby.close();
    server.closeAllConnections();
    server.close();
  }
});
