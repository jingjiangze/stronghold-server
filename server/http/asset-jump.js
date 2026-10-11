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

export const DEFAULT_SOURCES_PATH = path.join(ROOT, 'deploy', 'stardust', 'ms-edge', 'sources.json');

/**
 * Build the jump decision function. Off when the sources file is unreadable or SP_ASSET_JUMP=0 —
 * a jump layer must never take the game down with it.
 * @param {{ sourcesPath?: string, disabled?: boolean, log?: { info?: Function, warn?: Function } }} [opts]
 * @returns {(pathname: string, query: string, method: string) => { status: number, headers: Record<string, string> } | null}
 */
export function createAssetJump({ sourcesPath = process.env.SP_EDGE_SOURCES || DEFAULT_SOURCES_PATH, disabled = process.env.SP_ASSET_JUMP === '0', log = noopLog } = {}) {
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
  // 只把 302 交出去：其余判定（404/405/204）保持 static.js 原有的行为，避免同一个 404 有两种样子。
  return (pathname, query, method) => {
    const out = decide(config, { method, pathname, query });
    return out.status === 302 ? { status: out.status, headers: out.headers } : null;
  };
}
