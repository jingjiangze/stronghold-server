// 训练场 (docs/spec/room.md 房间-11): a session outside a room asks for a training level and gets a match of its own —
// the level's own cards with 基础专项 for seat 0, nobody for seat 1 —, which begins once seat 0 is ready.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@aue/schema';
import { createHttpServer, createLobby, createBattles, lobbyMessageProblem, projectViews, recruits, trainingMatch } from '../src/index.js';

/** A lobby and its battles on a free port, trainings started as the server starts them. */
async function start() {
  const battles = createBattles({ onEnd: (id) => lobby.rooms.ended(id) });
  const lobby = createLobby({ projects: projectViews(), recruits: await recruits(), startMatch: (m, keys) => battles.start(m, keys),
    startTraining: (m, key) => battles.start(m, [key], { absent: [1] }) });
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
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  ws.on('error', () => {});
  const next = (/** @type {string} */ t) => {
    const i = got.findIndex((m) => m.t === t);
    return i >= 0 ? Promise.resolve(got.splice(i, 1)[0]) : new Promise((r) => waiting.push({ t, r }));
  };
  return { ws, next, send: (/** @type {any} */ m) => ws.send(JSON.stringify(m)), closed, ready: new Promise((r) => ws.on('open', r)) };
}

test('[房间-11] a training\'s match: IG-TR-1\'s own four operators with 基础专项 for seat 0, nobody for seat 1; only training levels', () => {
  const m = /** @type {any} */ (trainingMatch('act1multi_tr01', 5));
  assert.deepEqual(m.decks.map((/** @type {any[]} */ d) => d.map((e) => e.id)), [['char_124_kroos', 'char_150_snakek', 'char_117_myrrh', 'char_126_shotst'], []]);
  assert.deepEqual(m.runes[0].map((/** @type {any} */ r) => r.key), ['char_attribute_mul', 'insert_token_card']);
  assert.deepEqual([m.level, m.difficulty, m.seed, m.runes[1]], ['act1multi_tr01', 'NORMAL', 5, []]);
  assert.equal(trainingMatch('act1multi_01', 5), null, 'a project is not a training');
  assert.equal(trainingMatch('act1multi_tr02', 5), null, '阵地足球\'s training is not played here');
  assert.equal(lobbyMessageProblem({ t: 'train', level: 'act1multi_tr01' }), null);
  assert.match(String(lobbyMessageProblem({ t: 'train' })), /fields/);
});

test('[房间-11] the lobby starts a training (engine 同步-14); its seat 0 is the session\'s, seat 1 nobody\'s; it begins once seat 0 is ready', async () => {
  const s = await start();
  try {
    const a = open(`ws://127.0.0.1:${s.port}/lobby`);
    await a.ready;
    a.send({ t: 'hello', key: 'key-a', name: 'A' });
    a.send({ t: 'train', level: 'act1multi_01' });
    assert.equal((await a.next('error')).msg, '没有这个训练');
    a.send({ t: 'train', level: 'act1multi_tr01' });
    const go = await a.next('start');
    assert.deepEqual([go.seat, go.training], [0, 'act1multi_tr01']);
    const partner = open(`ws://127.0.0.1:${s.port}/battle?match=${go.match}&seat=1`);
    assert.notEqual(await partner.closed, 1000, 'the absent seat is not taken');
    const b = open(`ws://127.0.0.1:${s.port}/battle?match=${go.match}&seat=0`);
    await b.ready;
    b.send({ t: 'hello', v: PROTOCOL_VERSION, seat: 0, key: 'key-a', since: -1 });
    const welcome = await b.next('welcome');
    assert.deepEqual(welcome.match.decks.map((/** @type {any[]} */ d) => d.length), [4, 0]);
    b.send({ t: 'ready' });
    let f = await b.next('frames');
    while (f.to < 10) f = await b.next('frames');
    assert.ok(f.to >= 10, 'frames are sealed without seat 1');
    a.send({ t: 'create' });
    await a.next('room');
    a.send({ t: 'train', level: 'act1multi_tr01' });
    assert.equal((await a.next('error')).msg, '已在房间里，不能训练');
  } finally { s.close(); }
});
