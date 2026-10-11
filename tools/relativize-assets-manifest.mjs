#!/usr/bin/env node
// 把 data/assets.json 里指向自家 CDN 的 /assets/… URL 改成**相对路径**（/assets/…）。
//
// 为什么：平台边缘会逐条扫响应里的 URL（实测 2026-10-11：清单 13,380 条 → 整段响应 ~27s、
// 按条数约 2ms/条；同尺寸但没 URL 的 JSON 只要 0.7s；切片/304 不扫 → 秒回），而网页客户端
// 对素材清单只等 8s。相对化后响应里没有绝对 URL，素材请求改走容器自身的 302 跳转
// （server/http/asset-jump.js → sources.json 的源表，镜像优先、r2 兜底）——这正是 fork 原生形态。
// /fonts/ 保持绝对：fonts.css 内部是根绝对 url()，必须从它自己的 origin（CDN）取，且 css 不在跳转白名单。
//
// 用法：node tools/relativize-assets-manifest.mjs [目标=data/assets.json]
// 只做本地文件变换（无网络）：改写 URL、按生成器约定重算 hash；stats 不变（同一批文件）。
import fs from 'node:fs';
import { contentHash } from './assets/manifest.mjs';

const dst = process.argv[2] || 'data/assets.json';
const CDN = 'https://weishucdn.jiangjiangze.icu';
const m = JSON.parse(fs.readFileSync(dst, 'utf8'));

let changed = 0;
const walk = (node) => {
  if (Array.isArray(node)) { node.forEach((v, i) => { const n = walk(v); if (n !== v) node[i] = n; }); return node; }
  if (node && typeof node === 'object') { for (const k of Object.keys(node)) { const v = walk(node[k]); if (v !== node[k]) node[k] = v; } return node; }
  if (typeof node === 'string' && node.startsWith(`${CDN}/assets/`)) { changed++; return node.slice(CDN.length); }
  return node;
};
walk(m);

const { version, hash, generator, stats, ...body } = m;
m.hash = contentHash(body);
fs.writeFileSync(dst, JSON.stringify(m, null, 2) + '\n');

// 校验：不再有自家 CDN 的 /assets 绝对 URL；剩下的绝对 URL 只允许 /fonts/（及被封素材的其它域）
const all = [];
(function collect(o) { if (typeof o === 'string') all.push(o); else if (Array.isArray(o)) o.forEach(collect); else if (o && typeof o === 'object') Object.values(o).forEach(collect); })(m);
const badAssets = all.filter((u) => u.startsWith(`${CDN}/assets/`));
const absolute = all.filter((u) => /^https?:\/\//.test(u));
console.log(`relativized: ${changed} URLs | 残留 CDN /assets 绝对: ${badAssets.length} | 剩余绝对 URL: ${absolute.length}`);
for (const u of [...new Set(absolute.map((u) => new URL(u).host + new URL(u).pathname.replace(/\/[^/]*$/, '/')))].slice(0, 6)) console.log('  abs host/dir:', u);
console.log(`hash=${m.hash} files=${stats.files}`);
if (badAssets.length) { console.error('FAIL: 仍有 CDN /assets 绝对 URL'); process.exit(1); }
