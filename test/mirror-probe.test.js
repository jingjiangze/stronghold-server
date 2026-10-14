// server/mirrorProbe.js — 容器视角测速：抽样（每次不同素材）／小文件测延迟＋大文件测吞吐／顺手出缺失表。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMirrorProbe, samplerPool, SMALL_MAX_BYTES, LARGE_MIN_BYTES } from '../server/mirrorProbe.js';

const silent = { info() {}, warn() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SOURCES = [{ id: 'a', base: 'https://a.example' }, { id: 'b', base: 'https://b.example' }];
// 20 条路径的池子（够两轮抽到不同的），大小由假 fetch 按名字决定
const PATHS = Array.from({ length: 20 }, (_, i) => `/assets/probe/p${String(i).padStart(2, '0')}.png`);

/** 假的镜像：按文件名给固定字节数；delays 控制首字节；missing 指定某源对某路径 404。 */
function mkFetch({ delays = {}, sizes = {}, missing = [] } = {}) {
  const calls = [];
  const impl = async (url) => {
    const u = new URL(url);
    const id = u.host.split('.')[0];
    const name = u.pathname.split('/').pop();
    calls.push({ id, path: u.pathname });
    if (missing.includes(`${id}${u.pathname}`)) return { ok: false, status: 404 };
    await sleep(delays[id] ?? 2);
    const bytes = sizes[name] ?? (name < 'p10' ? 64 * 1024 : 3 * 1024 * 1024);
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(bytes) };
  };
  return { impl, calls };
}

test('samplerPool only accepts static asset paths', () => {
  const pool = samplerPool(['/assets/a/b.png', '/assets/a/c.skel', '/js/app.js', 'https://x/y.png', '/assets/a/d.json']);
  assert.deepEqual(pool.sort(), ['/assets/a/b.png', '/assets/a/c.skel']);
});

test('every round samples a *different* asset, and measures the SAME file on all mirrors', async () => {
  const { impl, calls } = mkFetch();
  let n = 0;
  const p = createMirrorProbe({ sources: SOURCES, paths: PATHS, fetchImpl: impl, log: silent, intervalMs: 0, rand: () => (n++ % 7) / 7 });
  await p.refresh();
  const first = p.state().lastSamples.map((s) => s.path);
  assert.ok(first.length >= 1);
  const round1 = calls.map((c) => `${c.id}:${c.path}`);
  assert.ok(round1.includes(`a:${first[0]}`) && round1.includes(`b:${first[0]}`), '同一个文件在两个源上各测一次');
  n = 3;
  await p.refresh();
  const second = p.state().lastSamples.map((s) => s.path);
  assert.ok(second.some((x) => !first.includes(x)), `第二轮换素材：${first} → ${second}`);
  assert.equal(p.state().round, 2);
});

test('small files feed latency (TTFB), large files feed throughput (B/s) — classified by measured bytes', async () => {
  const sizes = {}; for (const f of PATHS) sizes[f.split('/').pop()] = f < '/assets/probe/p10' ? 64 * 1024 : 3 * 1024 * 1024;
  const { impl } = mkFetch({ delays: { a: 30, b: 3 }, sizes });
  let n = 0;
  const p = createMirrorProbe({ sources: SOURCES, paths: PATHS.slice(0, 12), fetchImpl: impl, log: silent, intervalMs: 0, rand: () => (n++ % 5) / 5 });
  for (let i = 0; i < 6; i++) await p.refresh();          // 多跑几轮：小/大池都喂到
  const st = p.state();
  const a = st.sources.find((s) => s.id === 'a'), b = st.sources.find((s) => s.id === 'b');
  assert.ok(a.smallSamples > 0 && b.smallSamples > 0, '两边都量到小文件');
  assert.ok(a.smallTtfb > b.smallTtfb, `a 更慢：${a.smallTtfb} vs ${b.smallTtfb}`);
  assert.deepEqual(st.measuredOrder, ['b', 'a']);
  assert.ok(a.largeSamples + b.largeSamples > 0, '大文件也量到了（吞吐）');
  assert.ok(a.largeBps > 0 && b.largeBps > 0);
});

test('a file missing on one mirror lands in the missing table, the other mirror still gets measured', async () => {
  const { impl } = mkFetch({ missing: [`b${PATHS[0]}`] });
  const p = createMirrorProbe({ sources: SOURCES, paths: [PATHS[0]], fetchImpl: impl, log: silent, intervalMs: 0, rand: () => 0 });
  await p.refresh();
  const miss = p.state().missing;
  assert.equal(miss.length, 1);
  assert.equal(miss[0].path, PATHS[0]);
  assert.deepEqual(miss[0].sources, ['b']);
  assert.equal(p.state().sources.find((s) => s.id === 'a').lastOk, true);
  assert.equal(p.state().sources.find((s) => s.id === 'b').lastOk, false);
});

test('a path missing on *every* mirror is not a mirror gap — it is dropped from the pool', async () => {
  const p0 = PATHS[0];
  const impl = async () => ({ ok: false, status: 404 });
  const p = createMirrorProbe({ sources: SOURCES, paths: [p0], fetchImpl: impl, log: silent, intervalMs: 0, rand: () => 0 });
  await p.refresh();
  assert.deepEqual(p.state().missing, [], '全缺件 = 这条路径本身不在任何镜像，不记进缺失表');
  assert.equal(p.poolSize(), 0, '并且不再拿它抽样');
});

test('intervalMs: 0 disables the loop and the warm-up (nothing measured until asked)', async () => {
  const { impl, calls } = mkFetch();
  const p = createMirrorProbe({ sources: SOURCES, paths: PATHS, fetchImpl: impl, log: silent, intervalMs: 0 });
  await sleep(20);
  assert.equal(calls.length, 0);
  assert.equal(p.state().round, 0);
  assert.deepEqual(p.state().missing, []);
  p.stop();
});

test('thresholds are the documented ones (small < 256 KiB, large >= 1 MiB)', () => {
  assert.equal(SMALL_MAX_BYTES, 256 * 1024);
  assert.equal(LARGE_MIN_BYTES, 1024 * 1024);
});
