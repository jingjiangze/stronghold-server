// Checks a release bundle against its MANIFEST.json (docs/deploy.md): every file there, with its size and sha256.
// Usage: node scripts/verify.js [folder] (default: the bundle this script is in). Exits 1 when a file is missing or
// differs; files the manifest does not list (the links made at the first start, saves) are not counted.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const manifest = JSON.parse(readFileSync(join(root, 'MANIFEST.json'), 'utf8'));
/** @type {string[]} */
const bad = [];
for (const [path, want] of Object.entries(/** @type {Record<string, { size: number, sha256: string }>} */ (manifest.files))) {
  const file = join(root, path);
  if (!existsSync(file)) { bad.push(`缺少 ${path}`); continue; }
  const data = readFileSync(file);
  if (data.length !== want.size || createHash('sha256').update(data).digest('hex') !== want.sha256) bad.push(`不一致 ${path}`);
}
const total = Object.keys(manifest.files).length;
console.log(`${manifest.name} v${manifest.version}：${total - bad.length}/${total} 个文件与 MANIFEST.json 一致`);
for (const b of bad.slice(0, 50)) console.log(`  ${b}`);
if (bad.length) process.exitCode = 1;
