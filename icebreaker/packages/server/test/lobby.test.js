// The lobby over real WebSockets (docs/spec/room.md): malformed messages close the connection; two players make a
// room, go through the allocation with squads of real operators and get the match; only their keys take its seats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@aue/schema';
import { ROSTER } from '@aue/content';
import { createHttpServer, createLobby, createBattles, lobbyMessageProblem, projectViews, recruits } from '../src/index.js';

test('[房间-1] lobby messages: a known type with exactly its fields, each of its kind', () => {
  assert.equal(lobbyMessageProblem({ t: 'hello', key: 'k', name: 'A' }), null);
  assert.equal(lobbyMessageProblem({ t: 'create' }), null);
  assert.equal(lobbyMessageProblem({ t: 'ping', at: 12.5 }), null);
  assert.match(String(lobbyMessageProblem({ t: 'ping', at: 'now' })), /malformed/);
  assert.equal(lobbyMessageProblem({ t: 'profile', tag: '0420', avatar: '', assist: null }), null);
  assert.equal(lobbyMessageProblem({ t: 'profile', tag: '9414', avatar: 'char_002_amiya', assist: { id: 'char_1044_hsgma2', art: 2 } }), null);
  for (const bad of [{ tag: '941' }, { tag: 'abcd' }, { avatar: 'amiya' }, { assist: { id: 'char_002_amiya', art: 3 } }, { assist: { id: 'char_002_amiya' } }]) {
    assert.match(String(lobbyMessageProblem({ t: 'profile', tag: '0001', avatar: '', assist: null, ...bad })), /malformed|fields/);
  }
  assert.match(String(lobbyMessageProblem({ t: 'create', x: 1 })), /fields/);
  assert.match(String(lobbyMessageProblem({ t: 'hello', key: 'k', name: '   ' })), /malformed/);
  assert.match(String(lobbyMessageProblem({ t: 'shout' })), /not a lobby message/);
  assert.match(String(lobbyMessageProblem({ t: 'lineup', lineup: [{ id: 'x' }] })), /malformed/);
});

/** A lobby and its battles on a free port. */
async function start() {
  const battles = createBattles({ onEnd: (id) => lobby.rooms.ended(id) });
  const lobby = createLobby({ projects: projectViews(), recruits: await recruits(), startMatch: (m, keys) => battles.start(m, keys) });
  const server = createHttpServer({ rootDir: process.cwd(), onUpgrade: (req, socket, head) => { if (!lobby.upgrade(req, socket, head) && !battles.upgrade(req, socket, head)) socket.destroy(); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  return { port, close: () => { lobby.close(); battles.close(); server.close(); } };
}

/** A socket that collects what it receives; `next(t)` waits for the next message of a type. @param {string} url */
function open(url) {
  const ws = new WebSocket(url), got = /** @type {any[]} */ ([]), waiting = /** @type {{ t: string, r: (m: any) => void }[]} */ ([]);
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)), i = waiting.findIndex((w) => w.t === m.t);
    if (i >= 0) waiting.splice(i, 1)[0].r(m); else got.push(m);
  });
  const closed = new Promise((r) => ws.on('close', (code, reason) => r({ code, reason: String(reason) })));
  const next = (/** @type {string} */ t) => {
    const i = got.findIndex((m) => m.t === t);
    return i >= 0 ? Promise.resolve(got.splice(i, 1)[0]) : new Promise((r) => waiting.push({ t, r }));
  };
  const send = (/** @type {any} */ m) => ws.send(JSON.stringify(m));
  return { ws, next, send, closed, ready: new Promise((r) => ws.on('open', r)) };
}

/** Squads of real six-star operators: 10 high and 10 low, from the `from`-th. @param {number} from */
function realSquad(from) {
  const ids = Object.entries(ROSTER).filter(([, o]) => o.rarity === 6).map(([id]) => id).slice(from, from + 20);
  const e = (/** @type {string} */ id) => ({ id, elite: 2, level: 60, potential: 1, trust: 100, skills: [7, 7, 7], modules: [] });
  return { high: ids.slice(0, 10).map(e), low: ids.slice(10).map(e) };
}

test('[房间-1] a malformed message, or any before hello, closes the lobby connection', async () => {
  const s = await start();
  try {
    const a = open(`ws://127.0.0.1:${s.port}/lobby`);
    await a.ready;
    a.send({ t: 'create' });
    assert.equal((/** @type {any} */ (await a.closed)).reason, 'say hello first');
    const b = open(`ws://127.0.0.1:${s.port}/lobby`);
    await b.ready;
    b.send({ t: 'hello', key: 'k', name: 'B', extra: 1 });
    assert.match((/** @type {any} */ (await b.closed)).reason, /fields/);
  } finally { s.close(); }
});

test('[页面-6] a ping after hello comes straight back with its time, for the latency the page shows', async () => {
  const s = await start();
  try {
    const a = open(`ws://127.0.0.1:${s.port}/lobby`);
    await a.ready;
    a.send({ t: 'hello', key: 'k', name: 'A' });
    a.send({ t: 'ping', at: 1234.5 });
    assert.deepEqual(await a.next('pong'), { t: 'pong', at: 1234.5 });
    a.ws.close();
  } finally { s.close(); }
});

test('[房间-2] [房间-5] [房间-6] two players: a room, its project confirmed with their squads, their lineups, and the match whose seats only their keys take', { timeout: 120000 }, async () => {
  const s = await start();
  try {
    const a = open(`ws://127.0.0.1:${s.port}/lobby`), b = open(`ws://127.0.0.1:${s.port}/lobby`);
    await Promise.all([a.ready, b.ready]);
    a.send({ t: 'hello', key: 'key-a', name: 'A' });
    b.send({ t: 'hello', key: 'key-b', name: 'B' });
    const lobby = await a.next('lobby');
    assert.deepEqual(lobby.projects.map((/** @type {any} */ p) => p.code), ['IG-1', 'IG-10', 'IG-14', 'IG-4', 'IG-6', 'IG-EX-1', 'IG-EX-10', 'IG-S-2', 'IG-DF-1', 'IG-DF-4', 'IG-S-5']);
    assert.deepEqual(lobby.projects.map((/** @type {any} */ p) => p.testing), [false, false, false, true, true, false, false, false, true, true, true], '[房间-13] the levels being tested');
    assert.equal(lobby.recruits.length, 5);
    a.send({ t: 'create' });
    const code = (await a.next('room')).code;
    b.send({ t: 'join', code });
    b.send({ t: 'prepare', on: true });
    await b.next('room');
    await b.next('room');
    a.send({ t: 'go' });
    a.send({ t: 'confirm', style: 'buff_1', squad: realSquad(0) });
    b.send({ t: 'confirm', style: 'buff_1', squad: realSquad(20) });
    let v;
    do v = await a.next('room'); while (v.phase !== 'lineup');
    const lineup = (/** @type {number} */ seat) => v.options[seat].kept.slice(0, 6).map((/** @type {string} */ id) => ({ id, skill: 0, module: -1 }));
    a.send({ t: 'lineup', lineup: lineup(0) });
    b.send({ t: 'lineup', lineup: lineup(1) });
    a.send({ t: 'ready', on: true });
    b.send({ t: 'ready', on: true });
    const go = await b.next('start');
    assert.equal(go.seat, 1);
    const seat = (/** @type {number} */ n, /** @type {string} */ key) => {
      const ws = open(`ws://127.0.0.1:${s.port}/battle?match=${go.match}&seat=${n}`);
      ws.ready.then(() => ws.send({ t: 'hello', v: PROTOCOL_VERSION, seat: n, key, since: -1 }));
      return ws;
    };
    const intruder = seat(0, 'not-a-member');
    assert.equal((/** @type {any} */ (await intruder.closed)).reason, 'seat taken');
    const welcome = await seat(1, 'key-b').next('welcome');
    assert.equal(welcome.match.level, 'act1multi_01');
    assert.deepEqual(welcome.match.decks.map((/** @type {any[]} */ d) => d.length), [6, 6]);
  } finally { s.close(); }
});
