// server/mirrorProbe.js — 容器视角的镜像测速（服务端实测证据，请求路径上永不等待）。
//
// 为什么是「容器视角」而不是「玩家视角」：容器在 cn-beijing，玩家在全国各地 —— 这两条链路不同
// （rank 的注释、deploy/stardust/ms-edge/README 都写过这条分工）。但容器是唯一能**主动、持续、零外部额度**
// 地测的位置：玩家浏览器的测速要有消费者才有意义（superbig 外壳拿不到也改不了游戏 iframe 里的相对素材路径），
// CF 边缘测的是「CF 节点 → 镜像」且每个素材请求都要过 Worker（免费额度会被全站素材吃光）。
// 所以这里产出的是**实测证据**，由 `/sp-edge/*` 与单一对外域名统一返回，供跳转层/第三方/监控消费。
//
// 与另外两层的分工（别混）：
//   健康（asset-jump 内）= 通不通        —— 固定路径 HEAD，秒级、判定成 skip
//   存在性（asset-jump 内）= 有没有这个文件 —— (源,路径) HEAD
//   本模块 = 快不快                      —— 真实 GET + 计时，分钟级、产出排序证据
export const DEFAULT_PROBE_PATH = '/assets/char/avatar/char_003_kalts.png';
export const DEFAULT_INTERVAL_MS = 300_000;   // 5 分钟
export const DEFAULT_BYTES = 262_144;         // 取前 256 KiB 量吞吐（各镜像都支持 Range）
export const DEFAULT_TIMEOUT_MS = 8000;
export const EWMA_ALPHA = 0.4;                // 平滑：单次抖动不该翻盘

const noop = { info() {}, warn() {} };

/**
 * @param {{ sources?: {id:string, base:string}[], fetchImpl?: Function, log?: object,
 *           intervalMs?: number, probePath?: string, bytes?: number, timeoutMs?: number, alpha?: number }} [opts]
 */
export function createMirrorProbe({
  sources = [], fetchImpl = globalThis.fetch, log = noop,
  intervalMs = DEFAULT_INTERVAL_MS, probePath = DEFAULT_PROBE_PATH,
  bytes = DEFAULT_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS, alpha = EWMA_ALPHA,
} = {}) {
  // 只测调用方给的源（= sources.json 的已配置源）。这里**绝不**接受任何外部传入的 URL：
  // 一个能被调用方指定目标的测速端点就是一台扫描器。
  const list = sources.filter((s) => s && typeof s.id === 'string' && typeof s.base === 'string' && s.base.startsWith('https://'));
  const baseOf = new Map(list.map((s) => [s.id, s.base]));
  const stats = new Map();       // id → { ok, ttfbMs, bps, at, samples, error? }
  const inflight = new Set();
  let lastAt = null;

  const smooth = (prev, next) => (prev == null ? next : alpha * next + (1 - alpha) * prev);

  async function measureOne(id) {
    const base = baseOf.get(id);
    if (!base || !fetchImpl || inflight.has(id)) return stats.get(id) ?? null;
    inflight.add(id);
    const t0 = Date.now();
    try {
      const res = await fetchImpl(base + probePath, {
        headers: { range: `bytes=0-${bytes - 1}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res || res.ok === false || (typeof res.status === 'number' && res.status >= 400)) {
        throw new Error(`HTTP ${res?.status ?? '?'}`);
      }
      const ttfb = Date.now() - t0;                       // fetch 在收到响应头后 resolve ⇒ 这就是首字节
      let n = 0;
      if (typeof res.arrayBuffer === 'function') {
        const buf = await res.arrayBuffer();
        n = buf?.byteLength ?? 0;
      } else if (typeof res.text === 'function') {
        n = (await res.text()).length;
      }
      const total = Math.max(1, Date.now() - t0);
      const bps = n > 0 ? Math.round((n * 1000) / total) : null;
      const prev = stats.get(id);
      const v = {
        ok: true,
        ttfbMs: Math.round(smooth(prev?.ttfbMs ?? null, ttfb)),
        bps: bps == null ? (prev?.bps ?? null) : (prev?.bps == null ? bps : Math.round(smooth(prev.bps, bps))),
        at: new Date().toISOString(),
        samples: (prev?.samples ?? 0) + 1,
        bytes: n,
      };
      stats.set(id, v);
      return v;
    } catch (e) {
      const prev = stats.get(id) ?? {};
      const v = { ...prev, ok: false, at: new Date().toISOString(), samples: (prev.samples ?? 0) + 1, error: String(e?.message || e).slice(0, 80) };
      stats.set(id, v);
      log.warn?.(`[probe] ${id} measurement failed: ${v.error}`);
      return v;
    } finally {
      inflight.delete(id);
      lastAt = new Date().toISOString();
    }
  }

  /** 测一轮（全部源并行）。可 await（诊断/测试用），也可 fire-and-forget。 */
  const refresh = async () => { await Promise.all(list.map((s) => measureOne(s.id))); return state(); };

  /** 实测序：只排在**本轮测成功**的源，按 TTFB 升序、并列时按吞吐降序。测失败的源不参与（也就不会被抬高）。 */
  function measuredOrder() {
    return list
      .map((s) => ({ id: s.id, ...(stats.get(s.id) ?? {}) }))
      .filter((r) => r.ok === true && typeof r.ttfbMs === 'number')
      .sort((a, b) => (a.ttfbMs - b.ttfbMs) || ((b.bps ?? 0) - (a.bps ?? 0)))
      .map((r) => r.id);
  }

  function state() {
    return {
      at: lastAt,
      intervalMs,
      probePath,
      bytes,
      sources: list.map((s) => ({ id: s.id, base: s.base, ...(stats.get(s.id) ?? { ok: null, samples: 0 }) })),
      measuredOrder: measuredOrder(),
    };
  }

  const timer = intervalMs > 0 && fetchImpl
    ? setInterval(() => { refresh(); }, intervalMs)
    : null;
  timer?.unref?.();
  if (timer) refresh();   // 启动即预热（容器重建后几秒内就有第一批数字）

  return { refresh, state, measuredOrder, stop: () => timer && clearInterval(timer), ids: list.map((s) => s.id) };
}
