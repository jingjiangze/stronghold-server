// 把抽取好的肉鸽关卡收进完整包的 data/rogue-levels（发布/打包时跑）。
// 用法: node tools/export-rogue-levels.mjs [--from <levels dir>] [--to <dir>]
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const from = resolve(arg('--from', join(root, 'engine/packages/content/data/levels')));
const to = resolve(arg('--to', join(root, 'data/rogue-levels')));
if (!existsSync(from)) throw new Error(`no levels dir ${from} (先跑 tools/extract-rogue.mjs)`);
mkdirSync(to, { recursive: true });
const files = readdirSync(from).filter((f) => /^rogue\d.*\.json$/.test(f));
for (const f of files) copyFileSync(join(from, f), join(to, f));
console.log(JSON.stringify({ from, to, copied: files.length }, null, 1));
