// 守卫（2026-11-01）：插件客户端覆盖清单必须自洽。
//
// 背景：#45「肉鸽常驻 HUD」加了 `plugins/mota/client/js/ui/rogueHud.js` 并在 game.js 里 import，
// 但没把它加进 `plugin.json.code.client` ⇒ 浏览器请求 `/js/ui/rogueHud.js` **404** ⇒ 模块图断，
// `#app` 一个子节点都没有（整页白屏）。核心 public/js 里没有同名文件可以兜底，所以是真的死了。
//
// 规则：从 code.client 里已列出的 js 出发做 import 闭包，凡落在插件 client 树内的目标，
// 要么已列出，**要么核心 `public/<path>` 有同名文件**（此时由核心提供，不会 404）；
// 两者都不满足 = 会在浏览器里 404 —— 直接失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = path.join(ROOT, 'plugins', 'mota');

test('mota: 被 import 的插件客户端模块，要么在 code.client 里，要么核心 public/ 有同名文件', () => {
  const pj = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8'));
  const listed = new Set(pj.code.client || []);
  const clientRoot = path.join(PLUGIN, 'client');
  const gaps = new Set();
  const seen = new Set();
  const queue = [...listed].filter((f) => f.endsWith('.js'));
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(clientRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] || m[2];
      if (!spec || !spec.startsWith('.')) continue;
      const target = path.relative(clientRoot, path.resolve(path.dirname(abs), spec)).split(path.sep).join('/');
      if (target.startsWith('..')) continue; // 插件树之外（/shared、/vendor…），由各自挂载点提供
      if (!fs.existsSync(path.join(clientRoot, target))) continue; // 插件没有 → 核心提供
      if (!listed.has(target)) gaps.add(target);
      queue.push(target);
    }
  }
  const fatal = [...gaps].filter((g) => !fs.existsSync(path.join(ROOT, 'public', g))).sort();
  assert.deepEqual(fatal, [], 'these plugin client modules are imported but never served (browser would 404)');
});
