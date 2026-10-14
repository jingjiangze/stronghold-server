// server/mirrorProbe.js — 容器视角测速：只测调用方给的源、TTFB/吞吐进 EWMA、失败不进实测序。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMirrorProbe, DEFAULT_PROBE_PATH } from '../server/mirrorProbe.js';

const silent = { info() {}, warn() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SOURCES = [{ id: 'a', base: 'https://a.example' }, { id: 'b', base: 'https://b.example' }];

/** 假的镜像：按源给不同首字节延迟；字节数固定。 */
function mkFetch(delays = {}, { fail = [], bytes = 4096 } = {}) {
  const seen = [];
  const impl = async (url, init = {}) => {
    const u = new URL(url);
    const id = u.host.split('.')[0];
    seen.push({ id, path: u.pathname, range: init.headers?.range });
    if (fail.includes(id)) throw new Error('ECONNRESET');
    await sleep(delays[id] ?? 0);
    return { ok: true, status: 206, arrayBuffer: async () => new ArrayBuffer(bytes) };
  };
  return { impl, seen };
}

test('measures exactly the configured sources, on the configured path, with a Range request', async () => {
  const { impl, seen } = mkFetch();
  const p = createMirrorProbe({ sources: SOURCES, fetchImpl: impl, log: silent, intervalMs: 0 });
  await p.refresh();
  assert.deepEqual(p.ids, ['a', 'b'], '只测已配置源');
  assert.deepEqual([...new Set(seen.map((s) => s.path))], [DEFAULT_PROBE_PATH]);
  assert.ok(seen.every((s) => /^bytes=0-\d+$/.test(s.range || '')), '用量程请求（不要整档）');
  assert.deepEqual(p.state().sources.map((s) => s.ok), [true, true]);
  assert.ok(p.state().sources.every((s) => typeof s.ttfbMs === 'number' && s.samples === 1));
});

test('the measured order is by TTFB (fastest first), and a failing source never enters it', async () => {
  const { impl } = mkFetch({ a: 40, b: 5 }, { fail: ['b'] });
  const p = createMirrorProbe({ sources: SOURCES, fetchImpl: impl, log: silent, intervalMs: 0 });
  await p.refresh();
  assert.deepEqual(p.measuredOrder(), ['a'], 'b 测失败 ⇒ 不进实测序（也不会被抬高）');
  assert.equal(p.state().sources.find((s) => s.id === 'b').ok, false);
  assert.equal(p.state().sources.find((s) => s.id === 'b').error != null, true);
});

test('EWMA smooths a single noisy sample instead of letting it flip the order', async () => {
  let slow = 100;
  const impl = async () => { await sleep(slow); return { ok: true, status: 206, arrayBuffer: async () => new ArrayBuffer(2048) }; };
  const p = createMirrorProbe({ sources: [SOURCES[0]], fetchImpl: impl, log: silent, intervalMs: 0, alpha: 0.4 });
  await p.refresh();
  const first = p.state().sources[0].ttfbMs;
  slow = 0;                                   // 突然变快
  await p.refresh();
  const second = p.state().sources[0].ttfbMs;
  assert.ok(second < first, '应朝着新样本移动');
  assert.ok(second > first * 0.3, `但只移动一档（EWMA），实际 ${first} → ${second}`);
  assert.equal(p.state().sources[0].samples, 2);
});

test('intervalMs: 0 disables the loop and the warm-up (nothing measured until asked)', async () => {
  const { impl, seen } = mkFetch();
  const p = createMirrorProbe({ sources: SOURCES, fetchImpl: impl, log: silent, intervalMs: 0 });
  await sleep(20);
  assert.equal(seen.length, 0);
  assert.equal(p.state().sources[0].samples, 0);
  assert.deepEqual(p.measuredOrder(), []);
  p.stop();
});
