// server/http/asset-jump.js — 缺失素材的 302 跳转，做在**游戏进程内**。
//
// 为什么进程内也要有这一层：素材跳转（把 /assets|fonts 缺的文件 302 到当前素材源）本来只有容器
// 边缘层（deploy/stardust/ms-edge 的 nginx + sidecar）。2026-10-11 实测创空间容器里 nginx 不在
// 链路上——镜像按提交重建成功、游戏在跑，但 /assets 请求直接落到游戏进程的 404。跳转不该押在
// 「平台是否执行我们的 CMD」上，所以游戏进程用**同一份 sources.json、同一组纯函数**兜底：
// 白名单、路径校验、例外表、?sp_source 覆盖都只有 edge-sidecar.mjs 一处实现，禁止在本文件里
// 拷贝或另立一套规则。
//
// 语义（本地优先）：static.js 只在**文件本机不存在**时才问这里；有文件仍走文件。
// 非 /assets|fonts 路径、不允许的扩展名、配置读不到 → 返回 null，交回原来的 404。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, noopLog } from './config.js';
import { decide, parseSources } from '../../deploy/stardust/ms-edge/edge-sidecar.mjs';

/** 排名端点（R2 上的静态 rank.json，speedcdn/weishucdn 同桶）。取不到就用 sources.json 的静态 order。 */
export const DEFAULT_RANK_URL = 'https://speedcdn.jiangjiangze.icu/cdn/v1/rank.json';
export const RANK_TTL_MS = 300_000;
/**
 * 排名里的 id → 边缘源表的 id。两边的命名不同名（CDN 侧叫 ms-dataset/ms-edge/r2-alt，边缘侧叫
 * modelscope/r2），而且 **ms-edge 就是本容器自己**——映射成 null 表示"跳过"：否则边缘会 302 到自己，
 * 客户端跟着无限跳。未列出的 id 按同名处理（两边同名时零配置即可用）。
 */
// 2026-10-13：不再映射 `ms-dataset` —— 它在 rank 里按 origins 顺序排在最前（未实测），映射成 modelscope 就会
// 把数据集抬到 weishucdn 之前。不映射 = 落回「未进榜的已配置源」段（静态 order 里排第二），weishucdn 优先。
export const RANK_ID_MAP = { 'r2': 'r2', 'r2-alt': 'r2', 'ms-edge': null };

export const DEFAULT_SOURCES_PATH = path.join(ROOT, 'deploy', 'stardust', 'ms-edge', 'sources.json');

/**
 * Build the jump decision function. Off when the sources file is unreadable or SP_ASSET_JUMP=0 —
 * a jump layer must never take the game down with it.
 * @param {{ sourcesPath?: string, disabled?: boolean, log?: { info?: Function, warn?: Function } }} [opts]
 * @returns {(pathname: string, query: string, method: string) => { status: number, headers: Record<string, string> } | null}
 */
export function createAssetJump({ sourcesPath = process.env.SP_EDGE_SOURCES || DEFAULT_SOURCES_PATH, disabled = process.env.SP_ASSET_JUMP === '0', log = noopLog, rankUrl = process.env.SP_RANK_URL || DEFAULT_RANK_URL, fetchImpl = globalThis.fetch } = {}) {
  if (disabled) {
    log.info?.('[http] asset jump: disabled (SP_ASSET_JUMP=0)');
    return () => null;
  }
  let config;
  try {
    config = parseSources(fs.readFileSync(sourcesPath, 'utf8'));
  } catch (e) {
    log.warn?.(`[http] asset jump: off — cannot read ${sourcesPath}: ${e?.message || e}`);
    return () => null;
  }
  log.info?.(`[http] asset jump: on — order=${config.order.join(' > ')}, exceptions=${config.exceptions.size} (${sourcesPath})`);
  // 动态次序：rank.json 把实测最快的源排在前面。只在**已配置的源**里取（不引入未知 id），
  // 取不到/解析失败就沿用静态 order——排名是优化，不是依赖。
  let ranked = null, rankedAt = 0, inflight = null;
  function refresh() {
    if (inflight || !rankUrl || !fetchImpl) return;
    inflight = (async () => {
      try {
        const res = await fetchImpl(rankUrl, { signal: AbortSignal.timeout(4000) });
        const doc = await res.json();
        const mapped = (doc?.rank || [])
          .filter((r) => r && r.excluded !== true && r.usable !== false)
          .map((r) => (Object.prototype.hasOwnProperty.call(RANK_ID_MAP, r.id) ? RANK_ID_MAP[r.id] : r.id))
          .filter((id) => typeof id === 'string' && id && config.byId.has(id));   // null（自身）与未知 id 一并丢掉
        const ids = [...new Set(mapped)];
        if (ids.length) {
          const rest = config.order.filter((id) => !ids.includes(id));   // 未进榜的已配置源接在后面
          ranked = [...ids, ...rest]; rankedAt = Date.now();
          log.info?.(`[http] asset jump: rank → ${ranked.join(' > ')}`);
        }
      } catch (e) {
        log.warn?.(`[http] asset jump: rank unavailable (${e?.message || e}) — using the static order`);
      } finally { inflight = null; }
    })();
  }
  /** 同步返回当前有效配置（后台按 TTL 刷新）：请求路径上永不等待网络。 */
  const effective = () => {
    if (!ranked || Date.now() - rankedAt >= RANK_TTL_MS) refresh();
    return ranked ? { ...config, order: ranked } : config;
  };
  refresh();   // 启动即预热

  // 只把 302 交出去：其余判定（404/405/204）保持 static.js 原有的行为，避免同一个 404 有两种样子。
  /** 取（可能被 rank 覆盖过 order 的）当前配置：static.js 在每次请求前 await 一次，命中缓存时是零成本。 */
  const jump = (pathname, query, method, cfg = null) => {
    const out = decide(cfg || config, { method, pathname, query });
    return out.status === 302 ? { status: out.status, headers: out.headers } : null;
  };
  jump.config = effective;
  return jump;
}
