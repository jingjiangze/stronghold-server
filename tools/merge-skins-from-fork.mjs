#!/usr/bin/env node
// 把 Stardust fork 清单里的 `skins` 段并入本仓 data/assets.json。
//
// 为什么需要这个工具：本仓清单是 tools/fetch-assets.mjs 的产物，而 skins 是 fork 独有资产
// （上游树没有）——2026-10-11 换清单时被整段替换掉的正是它。以后每次换清单都跑一遍本工具，
// 不要手改 JSON。清单里的皮肤 URL 保持**相对路径**（/assets/skins/...），运行时由容器
// ms-edge 边缘层 302 到素材源（sources.json 的 order，镜像优先、R2 兜底）。
//
// 用法：
//   node tools/merge-skins-from-fork.mjs <fork 的 data/assets.json> [目标=本仓 data/assets.json] [皮肤总字节数]
// 只做本地文件合并（无网络）：追加 skins 段，按生成器约定重算 hash 与 stats。
// 皮肤总字节数要用 HEAD 全量统计一遍再传进来（见 2026-10-11 的执行记录），不传就保留旧值并警告。
import fs from 'node:fs';
import { contentHash } from './assets/manifest.mjs';
import { countStats } from './fetch-assets.mjs';

const [, , src, dst = 'data/assets.json', skinBytesRaw] = process.argv;
if (!src) {
  console.error('usage: node tools/merge-skins-from-fork.mjs <fork assets.json> [target] [skins-bytes]');
  process.exit(2);
}
const fork = JSON.parse(fs.readFileSync(src, 'utf8'));
const skins = fork.skins && typeof fork.skins === 'object' ? fork.skins : null;
if (!skins || Object.keys(skins).length === 0) {
  console.error(`拒绝合并：${src} 里没有 skins 段（那会把皮肤整段删掉）`);
  process.exit(1);
}

const current = JSON.parse(fs.readFileSync(dst, 'utf8'));
const { version, hash, generator, stats, ...body } = current;

// 幂等守卫：本工具只负责「无皮肤清单 + fork 皮肤」，对已含皮肤的清单再跑会重复计数。
if (stats?.skins) {
  console.error(`拒绝合并：${dst} 的 stats 显示已含 ${stats.skins} 套皮肤。请从无皮肤的清单开始（换清单时先恢复基础清单）。`);
  process.exit(1);
}

/** 清单里声明的皮肤文件（skel/atlas/textures + avatar/portrait/illustration）。 */
function skinFiles(recs) {
  const files = new Set();
  for (const rec of Object.values(recs)) {
    for (const face of ['front', 'back']) {
      const f = rec?.spine?.[face];
      if (!f) continue;
      for (const u of [f.skel, f.atlas, ...(f.textures || [])]) if (typeof u === 'string' && u) files.add(u);
    }
    for (const k of ['avatar', 'portrait', 'illustration']) if (typeof rec?.[k] === 'string') files.add(rec[k]);
  }
  return files;
}

const filesTotal = (stats?.files || 0) + skinFiles(skins).size;
// 皮肤字节数不联网就不可能有——由调用方用 HEAD 全量统计后传入；
// 没传就保留旧值并显式警告，不写一个看起来像真的假数。
const skinBytes = Number(skinBytesRaw);
const hasSkinBytes = Number.isFinite(skinBytes) && skinBytes > 0;
if (!hasSkinBytes) console.warn('警告：未提供皮肤总字节数（第 3 个参数），stats.bytes 将不含皮肤字节。');
const bytesTotal = (stats?.bytes ?? 0) + (hasSkinBytes ? skinBytes : 0);

body.skins = skins;
const merged = {
  version: version ?? 1,
  hash: contentHash(body),
  generator: 'tools/fetch-assets.mjs + tools/merge-skins-from-fork.mjs (2026-10-11)',
  stats: { ...countStats(body, bytesTotal, filesTotal), skins: Object.keys(skins).length },
  ...body,
};
fs.writeFileSync(dst, JSON.stringify(merged, null, 2) + '\n');
console.log(`merged: skins=${Object.keys(skins).length}, +files=${filesTotal - (stats?.files || 0)}, files=${filesTotal}, bytes=${bytesTotal}, hash=${merged.hash} -> ${dst}`);
