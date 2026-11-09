// The server as one node of several (docs/spec/site.md 站点-6): the node from the environment, room codes that begin
// with its digit, and a code of another node answered with that node's host instead of as a wrong code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRooms, nodeOf, newCode, elsewhere } from '../src/index.js';

const PEERS = '1=hkg.play.example.org,2=tyo.play.example.org,3=lon.play.example.org';

test('[站点-6] the node from the environment: its digit and every node\'s host; anything else is a node of its own', () => {
  assert.equal(nodeOf({}), null);
  assert.deepEqual(nodeOf({ NCN_GAME_DIGIT: '2', NCN_GAME_PEERS: PEERS }),
    { digit: 2, peers: { 1: 'hkg.play.example.org', 2: 'tyo.play.example.org', 3: 'lon.play.example.org' } });
  const why = /** @type {string[]} */ ([]);
  for (const env of [{ NCN_GAME_DIGIT: '0', NCN_GAME_PEERS: PEERS }, { NCN_GAME_DIGIT: '12', NCN_GAME_PEERS: PEERS }, { NCN_GAME_DIGIT: '2', NCN_GAME_PEERS: '2=tyo' },
    { NCN_GAME_DIGIT: '2', NCN_GAME_PEERS: '2=a.example.org,2=b.example.org' }, { NCN_GAME_DIGIT: '2', NCN_GAME_PEERS: '2=evil.example.org/x' }]) {
    assert.equal(nodeOf(env, (l) => why.push(l)), null, JSON.stringify(env));
  }
  assert.equal(why.length, 5, 'each said why');
});

test('[站点-6] a node\'s codes begin with its digit; a code of another listed node names its host, one of this node or an unknown digit none', () => {
  const node = /** @type {import('../src/nodes.js').Node} */ (nodeOf({ NCN_GAME_DIGIT: '2', NCN_GAME_PEERS: PEERS }));
  let r = 0.5;
  const random = () => { r = (r * 9301 + 0.49297) % 1; return r; };
  const taken = new Set(['200000']);
  for (let i = 0; i < 200; i++) { const c = newCode(node, random, (x) => taken.has(x)); assert.match(c, /^2\d{5}$/); assert.ok(!taken.has(c)); taken.add(c); }
  assert.match(newCode(null, random, () => false), /^\d{6}$/);
  assert.deepEqual([elsewhere(node, '312345'), elsewhere(node, '212345'), elsewhere(node, '912345'), elsewhere(node, '31234'), elsewhere(null, '312345')],
    ['lon.play.example.org', null, null, null, null]);
});

test('[站点-6] [房间-1] joining another node\'s code: the page is told that node and the code, and it counts as no wrong code', () => {
  const got = /** @type {any[]} */ ([]), wrong = /** @type {number[]} */ ([]);
  const rooms = createRooms({
    now: () => 0, random: () => 0.123, send: (_id, msg) => got.push(msg), startMatch: () => 'm', projects: [{ level: 'act1multi_01', difficulty: 'NORMAL' }], recruits: [],
    wrongCode: (id) => wrong.push(id), node: nodeOf({ NCN_GAME_DIGIT: '2', NCN_GAME_PEERS: PEERS }),
  });
  rooms.hello(1, 'ka', 'A');
  rooms.message(1, { t: 'create' });
  assert.match(got.find((m) => m.t === 'room').code, /^2\d{5}$/);
  rooms.hello(2, 'kb', 'B');
  rooms.message(2, { t: 'join', code: '房间编号[312345],Dr.A 邀请您加入赛事' });
  assert.deepEqual(got.at(-1), { t: 'elsewhere', code: '312345', host: 'lon.play.example.org' });
  rooms.message(2, { t: 'join', code: '299999' });
  assert.equal(got.at(-1).msg, '没有这个房间编号', 'this node\'s code of no room');
  assert.deepEqual(wrong, [2]);
});
