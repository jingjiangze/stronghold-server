// 素材跳转（server/http/asset-jump.js）：缺失的 /assets|fonts 文件 302 到素材源，本地文件优先。
// 判定与容器边缘层共用同一份实现（deploy/stardust/ms-edge/edge-sidecar.mjs）与同一份 sources.json，
// 所以这里既测进程内集成，也测「仓库自带的清单里每条皮肤路径都跳得出去」这条回归线。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../server/index.js';
import { createAssetJump, rankQualified } from '../server/http/asset-jump.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const MIRROR = 'https://mirror.example/assets-mirror';
const R2 = 'https://cdn.example';

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sp-jump-')); }
function writeSources(dir, doc) {
  const p = path.join(dir, 'sources.json');
  fs.writeFileSync(p, JSON.stringify(doc));
  return p;
}
const DOC = {
  schemaVersion: 1,
  order: ['mirror', 'r2'],
  sources: [{ id: 'mirror', base: MIRROR }, { id: 'r2', base: R2 }],
  exceptions: { '/assets/skins/char_340_shwaz_snow_1/illustration.png': 'r2' },
};

function serve(publicDir, jump) {
  const handler = createStaticHandler({ publicDir, dataDir: path.join(ROOT, 'data'), sharedDir: path.join(ROOT, 'shared'), log: silent, assetJump: jump });
  const srv = http.createServer((req, res) => {
    const [p, q] = req.url.split('?');
    handler(req, res, p, q || '');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

function get(srv, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, cache: res.headers['cache-control'] }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('missing /assets file → 302 to the first source (cacheable), local file still wins', async () => {
  const dir = tmpdir();
  const pub = path.join(dir, 'public');
  fs.mkdirSync(pub);
  const jump = createAssetJump({ sourcesPath: writeSources(dir, DOC), log: silent, healthIntervalMs: 0, probeIntervalMs: 0 });
  const srv = await serve(pub, jump);
  try {
    const miss = await get(srv, '/assets/skins/char_103_angel_wild_1/front/char_103_angel_wild_1.skel');
    assert.equal(miss.status, 302);
    assert.equal(miss.location, `${MIRROR}/assets/skins/char_103_angel_wild_1/front/char_103_angel_wild_1.skel`);
    assert.match(miss.cache, /max-age=\d+/);
    assert.equal((await get(srv, '/assets/skins/char_103_angel_wild_1/front/char_103_angel_wild_1.skel', 'HEAD')).status, 302);
    // 本地优先：有文件时不再跳
    const rel = 'assets/skins/char_103_angel_wild_1/front';
    fs.mkdirSync(path.join(pub, rel), { recursive: true });
    fs.writeFileSync(path.join(pub, rel, 'char_103_angel_wild_1.skel'), 'local');
    assert.equal((await get(srv, '/assets/skins/char_103_angel_wild_1/front/char_103_angel_wild_1.skel')).status, 200);
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('exception path is forced to r2; ?sp_source overrides the order and only that key is dropped', async () => {
  const dir = tmpdir();
  const jump = createAssetJump({ sourcesPath: writeSources(dir, DOC), log: silent, healthIntervalMs: 0, probeIntervalMs: 0 });
  try {
    const exc = jump('/assets/skins/char_340_shwaz_snow_1/illustration.png', '', 'GET');
    assert.equal(exc.status, 302);
    assert.equal(exc.headers.Location, `${R2}/assets/skins/char_340_shwaz_snow_1/illustration.png`);
    const forced = jump('/assets/skins/char_103_angel_wild_1/portrait.png', 'sp_source=r2&v=7', 'GET');
    assert.equal(forced.headers.Location, `${R2}/assets/skins/char_103_angel_wild_1/portrait.png?v=7`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('non-asset paths, other extensions and traversal stay with the caller (null → its own 404)', () => {
  const dir = tmpdir();
  const jump = createAssetJump({ sourcesPath: writeSources(dir, DOC), log: silent, healthIntervalMs: 0, probeIntervalMs: 0 });
  try {
    for (const p of ['/js/app.js', '/data/assets.json', '/assets/x/y.js', '/assets/min.js', '/assets/min.css', '/assets/../etc/passwd', '/assets/a b/c.png']) {
      assert.equal(jump(p, '', 'GET'), null, p);
    }
    // One exception: `/fonts/fonts.css` is the official client's font manifest, and an install built without the art
    // holds no copy of it — so it is served from the same source table as the fonts it names. (The exclusion the other
    // paths carry is about manifest/code *version skew*; there is no local counterpart to skew against here.)
    assert.equal(jump('/fonts/fonts.css', '', 'GET')?.status, 302, '/fonts/fonts.css');
    // The extracted LOCAL art is the same kind of exception: a scene's `scene.json` / `scene.bin` (and the other
    // module manifests under /assets/local/) have no in-container counterpart either, so they ride the same table.
    assert.equal(jump('/assets/local/scene/act1autochess_m01/scene.json', '', 'GET')?.status, 302, '/assets/local/** *.json');
    assert.equal(jump('/assets/local/scene/act1autochess_m01/scene.bin', '', 'GET')?.status, 302, '/assets/local/** *.bin');
    assert.equal(jump('/assets/local/x/y.bin', '', 'GET')?.status, 302, '/assets/local/** *.bin (any depth)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a source known to be missing the file is skipped on the next jump (non-empty preference)', async () => {
  const dir = tmpdir();
  const doc = { schemaVersion: 1, order: ['a', 'b'], sources: [{ id: 'a', base: 'https://a.example' }, { id: 'b', base: 'https://b.example' }] };
  const okB = (url) => url.startsWith('https://b.example');
  const fetchImpl = async (url, init = {}) => (init.method === 'HEAD'
    ? { ok: okB(url), status: okB(url) ? 200 : 404 }
    : { ok: true, json: async () => ({ rank: [] }) });
  const jump = createAssetJump({ sourcesPath: writeSources(dir, doc), log: silent, fetchImpl, probeIntervalMs: 0 });
  try {
    // 第一次：这个 (源,路径) 还没判定过 ⇒ 按既有顺序跳 a（可能与今天线上相同：第一个请求仍可能打到缺件源）
    assert.equal(jump('/assets/x.png', '', 'GET').headers.Location, 'https://a.example/assets/x.png');
    for (let i = 0; i < 80 && jump.exists().known === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(jump.exists().known, 1, 'a 被记为「缺这个文件」');
    // 第二次：已知 a 缺件 ⇒ 自动避开，跳到真的有这个文件的 b
    assert.equal(jump('/assets/x.png', '', 'GET').headers.Location, 'https://b.example/assets/x.png');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 合格集：只有 measured:true 的条目才能进生效顺序的头部（未实测的「第一」只是登记顺序）。
test('rankQualified: measured/usable/excluded/down/coverage 硬闸门', () => {
  const ok = { id: 'r2', measured: true, usable: true, coverage: 'full' };
  assert.equal(rankQualified(ok), true);
  assert.equal(rankQualified({ ...ok, measured: false }), false, '未实测 ⇒ 不进头部');
  assert.equal(rankQualified({ ...ok, usable: false }), false);
  assert.equal(rankQualified({ ...ok, usable: null }), true, 'usable:null 是「没结论」，不是「不可用」');
  assert.equal(rankQualified({ ...ok, excluded: true }), false);
  assert.equal(rankQualified({ ...ok, down: true }), false);
  assert.equal(rankQualified({ ...ok, coverage: 'partial' }), false);
  assert.equal(rankQualified(null), false);
});

// 现场形状：线上的 rank[0] 是 ms-dataset（measured:false，按 origins.json 登记顺序排）⇒ 不许它压过 weishucdn。
test('an unmeasured rank[0] cannot lead — the static order survives (live rank shape)', async () => {
  const dir = tmpdir();
  const doc = { schemaVersion: 1, order: ['r2', 'modelscope'], sources: [{ id: 'r2', base: R2 }, { id: 'modelscope', base: MIRROR }] };
  // 2026-10-14 线上 rank.json 的前三条原样照抄（前两条都是 measured:false）
  const rank = { rank: [{ id: 'ms-dataset', measured: false, usable: null, coverage: 'full' }, { id: 'ms-edge', measured: false, usable: null, coverage: 'full' }, { id: 'r2', measured: true, usable: true, coverage: 'full' }] };
  const logs = [];
  const jump = createAssetJump({
    sourcesPath: writeSources(dir, doc),
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => rank }), probeIntervalMs: 0,
  });
  try {
    for (let i = 0; i < 100 && !logs.some((m) => m.includes('rank(')); i++) await new Promise((r) => setTimeout(r, 10));
    const line = logs.find((m) => m.includes('rank(')) || '';
    assert.match(line, /qualified=\[r2\]/, line);
    assert.match(line, /r2 > modelscope/, line);
    // 生效顺序 = effective()（static.js 每请求把它作为 cfg 传进 jump）
    assert.deepEqual(jump.config().order, ['r2', 'modelscope']);
    assert.equal(jump('/assets/a/b.png', '', 'GET', jump.config()).headers.Location, `${R2}/assets/a/b.png`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 反过来：同一份 rank，只要 ms-dataset 被实测过并更快 ⇒ 必须真的翻身（否则「最快」只是装饰）。
test('a measured, faster dataset takes the lead — and the unranked sources keep their tail', async () => {
  const dir = tmpdir();
  const doc = { schemaVersion: 1, order: ['r2', 'modelscope'], sources: [{ id: 'r2', base: R2 }, { id: 'modelscope', base: MIRROR }] };
  const rank = { rank: [{ id: 'ms-dataset', measured: true, usable: true, coverage: 'full' }, { id: 'r2', measured: true, usable: true, coverage: 'full' }] };
  const logs = [];
  const jump = createAssetJump({
    sourcesPath: writeSources(dir, doc),
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => rank }), probeIntervalMs: 0,
  });
  try {
    for (let i = 0; i < 100 && !logs.some((m) => m.includes('rank(')); i++) await new Promise((r) => setTimeout(r, 10));
    assert.match(logs.find((m) => m.includes('rank(')) || '', /modelscope > r2/);
    assert.deepEqual(jump.config().order, ['modelscope', 'r2']);
    assert.equal(jump('/assets/a/b.png', '', 'GET', jump.config()).headers.Location, `${MIRROR}/assets/a/b.png`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 多门牌回退：同桶的两个域名，第一个 5xx/超时不能让排名整段失效。
test('rank fetch falls through to the next url when the first one fails', async () => {
  const dir = tmpdir();
  const doc = { schemaVersion: 1, order: ['r2', 'modelscope'], sources: [{ id: 'r2', base: R2 }, { id: 'modelscope', base: MIRROR }] };
  const rank = { rank: [{ id: 'ms-dataset', measured: true, usable: true, coverage: 'full' }] };
  const seen = [];
  const logs = [];
  const jump = createAssetJump({
    sourcesPath: writeSources(dir, doc), rankUrls: ['https://dead.example/rank.json', 'https://alive.example/rank.json'],
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    fetchImpl: async (u) => {
      seen.push(u);
      if (u.startsWith('https://dead.example')) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => rank };
    }, probeIntervalMs: 0,
  });
  try {
    for (let i = 0; i < 100 && !logs.some((m) => m.includes('rank(')); i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(seen.slice(0, 2), ['https://dead.example/rank.json', 'https://alive.example/rank.json']);
    assert.match(logs.find((m) => m.includes('rank(')) || '', /alive\.example/);
    assert.deepEqual(jump.config().order, ['modelscope', 'r2']);
    assert.equal(jump('/assets/a/b.png', '', 'GET', jump.config()).headers.Location, `${MIRROR}/assets/a/b.png`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── ② 顺延链：一个域用不了了，就返回下一个域（全部在容器内，不涉及 CF / 盒子）──────────────────────
const HEALTH_PATH = '/assets/char/avatar/char_003_kalts.png';   // 与 asset-jump.js 的默认健康路径一致
const THREE = { schemaVersion: 1, order: ['a', 'b', 'c'],
  sources: [{ id: 'a', base: 'https://a.example' }, { id: 'b', base: 'https://b.example' }, { id: 'c', base: 'https://c.example' }] };

/** 假的素材源：健康（固定路径）与存在性（任意路径）返回可编程状态；rank 返回空（走静态 order）。 */
function fakeSources(healthStatus = {}, missing = []) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = new URL(url);
    const id = u.host.split('.')[0];
    if (init.method === 'HEAD') {
      if (u.pathname === HEALTH_PATH) {
        const st = healthStatus[id] ?? 200;
        calls.push(`health ${id} ${st}`);
        return { ok: st < 400, status: st };
      }
      const st = missing.includes(id + u.pathname) ? 404 : 200;
      calls.push(`exist ${id} ${st}`);
      return { ok: st < 400, status: st };
    }
    calls.push('rank');
    return { ok: true, status: 200, json: async () => ({ rank: [] }) };
  };
  return { impl, calls };
}

test('a source that answers 5xx is skipped — the jump falls through to the next domain', async () => {
  const dir = tmpdir();
  const { impl } = fakeSources({ a: 503 });
  const jump = createAssetJump({ sourcesPath: writeSources(dir, THREE), log: silent, fetchImpl: impl, healthIntervalMs: 0, probeIntervalMs: 0 });
  try {
    await jump.checkHealth();
    assert.equal(jump.health().sources.a.v, 'down');
    assert.equal(jump.health().sources.b.v, 'ok');
    // 生效顺序仍是 a > b > c，但 a 已知不可达 ⇒ 302 顺延到 b
    assert.equal(jump.config().order[0], 'a');
    assert.equal(jump('/assets/x.png', '', 'GET', jump.config()).headers.Location, 'https://b.example/assets/x.png');
    assert.equal(jump('/assets/x.png', '', 'GET', jump.config()).headers['X-SP-Fallbacks'], 'https://c.example/assets/x.png');
    assert.ok(jump.health().byHealth >= 1, '被健康顺延掉的次数要被记下来');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an unreachable source (network error / timeout) is also skipped', async () => {
  const dir = tmpdir();
  const boom = async (url, init = {}) => {
    const u = new URL(url);
    if (init.method === 'HEAD' && u.pathname === HEALTH_PATH && u.host.startsWith('a.')) throw new Error('ETIMEDOUT');
    if (init.method === 'HEAD') return { ok: true, status: 200 };
    return { ok: true, status: 200, json: async () => ({ rank: [] }) };
  };
  const jump = createAssetJump({ sourcesPath: writeSources(dir, THREE), log: silent, fetchImpl: boom, healthIntervalMs: 0, probeIntervalMs: 0 });
  try {
    await jump.checkHealth();
    assert.equal(jump.health().sources.a.v, 'down');
    assert.equal(jump('/assets/x.png', '', 'GET', jump.config()).headers.Location, 'https://b.example/assets/x.png');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reachability is not file presence: a 404 on the health path must NOT demote the source', async () => {
  const dir = tmpdir();
  const { impl } = fakeSources({ a: 404 });
  const jump = createAssetJump({ sourcesPath: writeSources(dir, THREE), log: silent, fetchImpl: impl, healthIntervalMs: 0, probeIntervalMs: 0 });
  try {
    await jump.checkHealth();
    assert.equal(jump.health().sources.a.v, 'ok', '403/404 说明域名活着，只是没有这个文件');
    assert.equal(jump('/assets/x.png', '', 'GET', jump.config()).headers.Location, 'https://a.example/assets/x.png');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every source unreachable → still 302 to the primary (never 404/503)', async () => {
  const dir = tmpdir();
  const { impl } = fakeSources({ a: 503, b: 503, c: 503 });
  const jump = createAssetJump({ sourcesPath: writeSources(dir, THREE), log: silent, fetchImpl: impl, healthIntervalMs: 0, probeIntervalMs: 0 });
  try {
    await jump.checkHealth();
    const res = jump('/assets/x.png', '', 'GET', jump.config());
    assert.equal(res.status, 302);
    assert.equal(res.headers.Location, 'https://a.example/assets/x.png', 'fail-open: 主源兜底');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('naming an unreachable source falls through by order instead of handing out a dead link', async () => {
  const dir = tmpdir();
  const { impl } = fakeSources({ a: 503 });
  const jump = createAssetJump({ sourcesPath: writeSources(dir, THREE), log: silent, fetchImpl: impl, healthIntervalMs: 0, probeIntervalMs: 0 });
  try {
    await jump.checkHealth();
    const res = jump('/assets/x.png', 'sp_source=a&v=2', 'GET', jump.config());
    assert.equal(res.headers.Location, 'https://b.example/assets/x.png?v=2', '点名降级为偏好，顺延下一个域');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the fallback list follows the effective order, excludes the chosen source, and never self-links', async () => {
  const dir = tmpdir();
  const { impl } = fakeSources();
  const jump = createAssetJump({ sourcesPath: writeSources(dir, THREE), log: silent, fetchImpl: impl, healthIntervalMs: 0, probeIntervalMs: 0 });
  try {
    await jump.checkHealth();
    const res = jump('/assets/x.png', 'v=7', 'GET', jump.config());
    assert.equal(res.headers.Location, 'https://a.example/assets/x.png?v=7');
    assert.equal(res.headers['X-SP-Fallbacks'], 'https://b.example/assets/x.png?v=7,https://c.example/assets/x.png?v=7');
    assert.match(res.headers.Link, /^<https:\/\/b\.example\/assets\/x\.png\?v=7>; rel="alternate", <https:\/\/c\.example\/assets\/x\.png\?v=7>; rel="alternate"$/);
    assert.ok(!res.headers['X-SP-Fallbacks'].includes('https://a.example'), '自己不在后备里');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 容器测速：默认只报告，不掌舵（10-13 指令：weishucdn 优先）；开关打开后实测序掌舵。
test('container-measured speed is reported by default and leads only when asked to', async () => {
  const dir = tmpdir();
  const doc = { schemaVersion: 1, order: ['a', 'b'],
    sources: [{ id: 'a', base: 'https://a.example' }, { id: 'b', base: 'https://b.example' }] };
  const mkFetch = (delays) => async (url, init = {}) => {
    const u = new URL(url);
    const id = u.host.split('.')[0];
    if (init.method === 'HEAD') return { ok: true, status: 200 };
    // rank 只有一个门牌地址（dead/alive.example）；抽样测速打的是素材源（a/b.example）
    if (u.host.includes('example') && !u.pathname.startsWith('/rank')) {
      await new Promise((r) => setTimeout(r, delays[id] ?? 0));
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64 * 1024) };
    }
    return { ok: true, status: 200, json: async () => ({ rank: [] }) };   // rank
  };
  const off = createAssetJump({ sourcesPath: writeSources(dir, doc), log: silent, fetchImpl: mkFetch({ a: 30, b: 0 }), healthIntervalMs: 0, probeIntervalMs: 0 });
  try {
    await off.checkProbe();
    assert.deepEqual(off.config().order, ['a', 'b'], '默认不让实测序掌舵（保持既有指令的顺序）');
    assert.deepEqual(off.probe().measuredOrder, ['b', 'a'], '但实测证据要如实给出');
    assert.equal(off.probe().leads, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const dir2 = tmpdir();
  const on = createAssetJump({ sourcesPath: writeSources(dir2, doc), log: silent, fetchImpl: mkFetch({ a: 30, b: 0 }), healthIntervalMs: 0, probeIntervalMs: 0, probeLeads: true });
  try {
    await on.checkProbe();
    assert.deepEqual(on.config().order, ['b', 'a'], 'probeLeads 打开后实测序掌舵');
    assert.equal(on('/assets/x.png', '', 'GET', on.config()).headers.Location, 'https://b.example/assets/x.png');
  } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
});

test('an unreadable sources file turns the jump off instead of failing requests', () => {
  const dir = tmpdir();
  try {
    const jump = createAssetJump({ sourcesPath: path.join(dir, 'missing.json'), log: silent });
    assert.equal(jump('/assets/skins/a/b.png', '', 'GET'), null);
    assert.equal(createAssetJump({ disabled: true, log: silent })('/assets/skins/a/b.png', '', 'GET'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every path in the committed manifest is jumpable — or a fonts URL (absolute by design)', () => {
  const jump = createAssetJump({ sourcesPath: path.join(ROOT, 'deploy/stardust/ms-edge/sources.json'), log: silent, healthIntervalMs: 0, probeIntervalMs: 0 });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
  assert.equal(Object.keys(manifest.skins || {}).length, 271, '271 skins in data/assets.json');

  const urls = [];
  (function walk(o) {
    if (typeof o === 'string') urls.push(o);
    else if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') Object.values(o).forEach(walk);
  })(manifest);
  const rel = [...new Set(urls.filter((u) => u.startsWith('/')))];
  const abs = [...new Set(urls.filter((u) => /^https?:\/\//.test(u)))];
  assert.ok(rel.length > 13000, `${rel.length} relative asset paths`);

  // A relative path the jump rejects (extension / shape) would 404 for every player — none may fail.
  const dead = rel.filter((u) => { const [p, q] = u.split('?'); return !jump(p, q || '', 'GET'); });
  assert.deepEqual(dead, [], 'every relative manifest path must 302 (tools/relativize-assets-manifest.mjs)');

  // Absolute URLs stay for the fonts only: fonts.css uses root-absolute url() and must come from its own origin,
  // and CSS is deliberately outside the jump allow-list (see deploy/stardust/ms-edge/README.md).
  const badAbs = abs.filter((u) => !/^https:\/\/weishucdn\.jiangjiangze\.icu\/fonts\//.test(u));
  assert.deepEqual(badAbs, [], 'absolute URLs may only be the /fonts/ files');
});
