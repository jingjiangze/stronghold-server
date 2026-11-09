// The battle socket end to end over real WebSockets: hello → welcome and sealed frames; malformed messages, binary
// frames and a second key for a taken seat close the connection; a command reaches the arbiter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@aue/schema';
import { createHttpServer, createBattleRoom } from '../src/index.js';

/** A server with a battle room on a free port. */
async function start() {
  const room = createBattleRoom({ seed: 3 }), server = createHttpServer({ rootDir: process.cwd(), onUpgrade: room.upgrade });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { room, url: (/** @type {number} */ seat) => `ws://127.0.0.1:${addr.port}/battle?seat=${seat}`, close: () => { room.close(); server.close(); } };
}

/** Opens a socket and collects what it receives. @param {string} url */
function open(url) {
  const ws = new WebSocket(url), got = /** @type {any[]} */ ([]);
  /** @type {Promise<{ code: number, reason: string }>} */
  const closed = new Promise((r) => ws.on('close', (code, reason) => r({ code, reason: String(reason) })));
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  return { ws, got, closed, ready: new Promise((r) => ws.on('open', r)) };
}

/** @param {number} ms */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('hello → welcome with a snapshot; sealed frames once both seats are ready (同步-11); a command reaches the arbiter', async () => {
  const s = await start();
  try {
    const a = open(s.url(0)), b = open(s.url(1));
    await Promise.all([a.ready, b.ready]);
    a.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, seat: 0, key: 'ka', since: -1 }));
    a.ws.send(JSON.stringify({ t: 'ready' }));
    b.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, seat: 1, key: 'kb', since: -1 }));
    await wait(400);
    assert.equal(a.got[0].t, 'welcome');
    assert.ok(!a.got.some((m) => m.t === 'frames'), 'the mate not ready: no frames');
    b.ws.send(JSON.stringify({ t: 'ready' }));
    await wait(400);
    assert.ok(a.got.some((m) => m.t === 'frames'));
    a.ws.send(JSON.stringify({ t: 'cmd', at: s.room.host.sealed + 9, cmd: { type: 'deploy', op: 'char_503_rang', row: 3, col: 2, dir: 0 } }));
    await wait(600);
    assert.equal(s.room.host.world.units.filter((u) => u.kind === 0).length, 1);
    a.ws.close();
    b.ws.close();
  } finally { s.close(); }
});

test('malformed and binary messages close the connection; a taken seat refuses another key', async () => {
  const s = await start();
  try {
    const bad = open(s.url(1));
    await bad.ready;
    bad.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, seat: 1, key: 'k', since: -1, admin: true }));
    assert.deepEqual(await bad.closed, { code: 1008, reason: 'unknown field admin' });
    const bin = open(s.url(1));
    await bin.ready;
    bin.ws.send(Buffer.from([1, 2, 3]));
    assert.equal((await bin.closed).code, 1003);
    const first = open(s.url(0));
    await first.ready;
    first.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, seat: 0, key: 'owner', since: -1 }));
    await wait(100);
    const thief = open(s.url(0));
    await thief.ready;
    thief.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, seat: 0, key: 'other', since: -1 }));
    assert.deepEqual(await thief.closed, { code: 1008, reason: 'seat taken' });
    const early = open(s.url(1));
    await early.ready;
    early.ws.send(JSON.stringify({ t: 'hash', frame: 30, hash: 1 }));
    assert.deepEqual(await early.closed, { code: 1008, reason: 'say hello first' });
    first.ws.close();
  } finally { s.close(); }
});

test('upgrades to other paths or seats are refused', async () => {
  const s = await start();
  try {
    for (const url of [s.url(2), s.url(-1), s.url(0).replace('/battle', '/other')]) {
      const x = open(url);
      x.ws.on('error', () => {});
      assert.ok((await x.closed).code >= 1000);
    }
  } finally { s.close(); }
});

test('a match room (engine spec 同步-9): its content made from the settings, the welcome carries them, decks keyed id#seat', async () => {
  const { createMatchRoom, DEFAULT_MATCH } = await import('../src/index.js');
  const room = await createMatchRoom(DEFAULT_MATCH), server = createHttpServer({ rootDir: process.cwd(), onUpgrade: room.upgrade });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  try {
    const a = open(`ws://127.0.0.1:${port}/battle?seat=1`);
    await a.ready;
    a.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, seat: 1, key: 'kb', since: -1 }));
    await wait(300);
    assert.deepEqual(a.got[0].match, DEFAULT_MATCH);
    assert.deepEqual(room.host.o.content.decks?.[1], DEFAULT_MATCH.decks[1].map((d) => `${d.id}#1`));
    a.ws.send(JSON.stringify({ t: 'speed', on: 1 }));
    a.ws.send(JSON.stringify({ t: 'pause' }));
    await wait(200);
    assert.deepEqual([room.host.fast, room.host.asker], [[0, 1], 1], 'the controls reach the host');
    assert.ok(a.got.some((m) => m.t === 'control' && m.asker === 1));
    a.ws.close();
  } finally { room.close(); server.close(); }
  await assert.rejects(createMatchRoom({ ...DEFAULT_MATCH, difficulty: /** @type {any} */ ('EASY') }), /match settings: match.difficulty/);
});

test('[房间-6] an engine error ends that battle alone: logged, its seats closed with 1011, the process goes on', async () => {
  const lines = /** @type {string[]} */ ([]);
  const room = createBattleRoom({ seed: 3, log: (l) => lines.push(l) }), server = createHttpServer({ rootDir: process.cwd(), onUpgrade: room.upgrade });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  try {
    const a = open(`ws://127.0.0.1:${addr.port}/battle?seat=0`);
    await a.ready;
    a.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, seat: 0, key: 'ka', since: -1 }));
    await wait(200);
    assert.equal(room.ended(), false);
    room.host.tick = () => { throw new Error('engine bug'); };
    const { code, reason } = await a.closed;
    assert.deepEqual([code, reason], [1011, 'battle failed']);
    assert.equal(room.failed(), true);
    assert.equal(room.ended(), true, 'the battles sweep ends it');
    assert.ok(lines.some((l) => l.startsWith('battle failed: Error: engine bug')), 'the error is logged with its stack');
    const b = open(`ws://127.0.0.1:${addr.port}/battle?seat=1`);
    await b.ready;
    b.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, seat: 1, key: 'kb', since: -1 }));
    assert.equal((await b.closed).code, 1011, 'a later hello is closed the same way');
  } finally {
    room.close();
    server.close();
  }
});
