// A whole match played by two bots (bots.js) over the lockstep host and clients in one process, on a simulated clock
// (the engine's 同步-1 … 同步-9 end to end, without sockets); both turn 2× on. The match must end with a result, no seat
// may desync, and both clients must end in the arbiter's state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LockstepHost, LockstepClient } from '@aue/net';
import { matchContent } from '@aue/content';
import { stateHash } from '@aue/sim';
import { DEFAULT_MATCH } from '../src/battle.js';
import { botCommands, STRONG_DECKS } from './bots.js';

const FRAME_MS = 1000 / 30, LIMIT = 30 * 60 * 30;

/** Messages through JSON, as the sockets would carry them. @param {unknown} m */
const wire = (m) => JSON.parse(JSON.stringify(m));

/**
 * Plays a match with two bots to its end (or the limit) and returns both clients' worlds, the arbiter's and the
 * desyncs seen.
 * @param {import('@aue/schema').Match} match
 */
async function play(match) {
  const content = await matchContent(match), desyncs = /** @type {unknown[]} */ ([]), toHost = /** @type {[number, any][]} */ ([]);
  const toClient = /** @type {any[][]} */ ([[], []]);
  const host = new LockstepHost({ content, seats: 2, seed: match.seed, match, send: (seat, m) => toClient[seat].push(wire(m)), onDesync: (d) => desyncs.push(d) });
  const clients = [0, 1].map((seat) => new LockstepClient({ content, send: (m) => toHost.push([seat, wire(m)]) }));
  const routes = /** @type {Record<string, (seat: number, m: any, now: number) => void>} */ ({
    cmd: (s, m) => host.command(s, m.at, m.cmd), hash: (s, m) => host.hash(s, m.frame, m.hash), speed: (s, m, now) => host.speed(s, m.on, now),
  });
  let now = 0;
  host.hello(0, now);
  host.hello(1, now);
  host.ready(0, now);
  host.ready(1, now);
  for (const cl of clients) cl.speed(true);
  for (let w = clients[0].world; !w || (w.result < 0 && w.frame <= LIMIT); w = clients[0].world) {
    now += FRAME_MS;
    for (const [seat, m] of toHost.splice(0)) routes[m.t]?.(seat, m, now);
    host.tick(now);
    clients.forEach((cl, seat) => { for (const m of toClient[seat].splice(0)) cl.receive(m); cl.pump(); });
    if (clients[0].world && clients[0].world.frame % 10 === 0) clients.forEach((cl, seat) => bot(cl, content, seat));
  }
  const [a, b] = clients.map((cl) => /** @type {import('@aue/sim').World} */ (cl.world));
  while (b.frame < a.frame) clients[1].playOne(b);
  return { a, b, host, desyncs };
}

/** One bot's turn. @param {LockstepClient} cl @param {import('@aue/sim').Content} c @param {number} seat */
function bot(cl, c, seat) {
  for (const cmd of botCommands(/** @type {import('@aue/sim').World} */ (cl.world), c, seat)) cl.command(cmd);
}

/** @param {Awaited<ReturnType<typeof play>>} r */
const summary = (r) => `result ${r.a.result} at frame ${r.a.frame}; stages passed ${r.a.stage.passed}; stamps ${r.a.stage.stamps}; life ${r.a.players.map((p) => p.life).join('/')}`;

test('two bots play the default match to its end without a desync', { timeout: 600000 }, async () => {
  const r = await play(DEFAULT_MATCH);
  assert.deepEqual(r.desyncs, []);
  assert.ok(r.a.result === 0 || r.a.result === 1, `the match ended (${summary(r)})`);
  assert.equal(stateHash(r.a), stateHash(r.b));
  assert.ok(r.host.world.frame >= r.a.frame);
  console.log(`default match: ${summary(r)}`);
});

test('two bots with elite-2 six-stars play the same level through its stages', { timeout: 600000 }, async () => {
  const match = { ...DEFAULT_MATCH, decks: STRONG_DECKS };
  const r = await play(match);
  assert.deepEqual(r.desyncs, []);
  assert.ok(r.a.result === 0 || r.a.result === 1, `the match ended (${summary(r)})`);
  assert.equal(stateHash(r.a), stateHash(r.b));
  assert.ok(r.a.stage.passed >= 1, `the first stage is passed (${summary(r)})`);
  console.log(`strong match: ${summary(r)}`);
});
