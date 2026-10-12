import test from 'node:test';
import assert from 'node:assert/strict';
import { experimentalSummary, ExperimentalOptions } from '../../public/js/ui/experimental.js';
import { partyQueueReason } from '../../public/js/screens/room.js';
import { queueActive, queueTime } from '../../public/js/ui/matchmaking.js';

test('party matching hints require a waiting coop, host, online humans and no AI', () => {
  const room = { mode: 'coop', hostId: 'p1', inMatch: false, seats: [{ playerId: 'p1', connected: true }, { playerId: 'p2', connected: true, ready: true }] };
  assert.equal(partyQueueReason(room, 'p1'), null);
  assert.match(partyQueueReason(room, 'p2'), /创建者/);
  assert.match(partyQueueReason(room, 'p1', false), /连接中断/);
  assert.match(partyQueueReason({ ...room, inMatch: true }, 'p1'), /等待/);
  assert.match(partyQueueReason({ ...room, mode: 'solo' }, 'p1'), /等待/);
  assert.match(partyQueueReason({ ...room, seats: [...room.seats, { playerId: 'bot', isBot: true }] }, 'p1'), /移除 AI/);
  assert.match(partyQueueReason({ ...room, seats: [...room.seats, { playerId: 'p3', connected: false }] }, 'p1'), /所有队友/);
  assert.match(partyQueueReason({ ...room, seats: [...room.seats, { playerId: 'p3', connected: true, ready: false }] }, 'p1'), /未准备/);
  assert.equal(partyQueueReason({ ...room, experimental: { disableSharedPool: false, playerCapacity: 8 } }, 'p1'), null);
});

test('experimental rules display room options only', () => {
  assert.equal(experimentalSummary(null), '共享卡池 开启');
  assert.equal(experimentalSummary({ disableSharedPool: true }), '共享卡池 关闭');
  const view = ExperimentalOptions({ open: true, value: { disableSharedPool: true }, editable: false });
  const switches = [];
  const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (node?.props) { if (node.props.role === 'switch') switches.push(node); visit(node.props.children); } };
  visit(view);
  assert.equal(switches.length, 2);
  assert.ok(switches.every(node => node.props.disabled));
  assert.equal(switches[0].props.checked, true, 'the shared-pool switch follows the room value');
  assert.equal(switches[1].props.checked, false, 'expanded rooms stay default off independently of the shared-pool rule');
});

test('queue UI distinguishes pending vs allocated and clamps clocks', () => {
  assert.equal(queueActive({ state: 'queued' }), true);
  assert.equal(queueActive({ state: 'offered' }), true);
  assert.equal(queueActive({ state: 'matched' }), false);
  assert.equal(queueActive(null), false);
  assert.equal(queueTime({ state: 'queued', joinedAt: 1000 }, 3200), 2);
  assert.equal(queueTime({ state: 'queued', joinedAt: 9000 }, 3200), 0);
  assert.equal(queueTime({ state: 'offered', deadline: 6000 }, 3200), 3);
  assert.equal(queueTime({ state: 'offered', deadline: 3000 }, 3200), 0);
});
