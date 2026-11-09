// 把 assets-rogue 里的肉鸽敌人增量（打包的 spine 目录 + 图标）并进 AUE 素材包。
// 镜像构建期与运行期补拉素材之后都可以跑，幂等。
//
//   node tools/merge-rogue-assets.mjs <assetsDir> [packDir]
//
// 前置：packDir 里的 enemy-pack.tgz.part* 已解压到 <assetsDir>/skeleton（Dockerfile 负责这一步），
// 本脚本只合并两份 JSON：spine/index.json 的 models 与 manifest.json 的 files。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const assets = resolve(process.argv[2] ?? '');
const pack = resolve(process.argv[3] ?? join(root, 'assets-rogue'));
if (!assets || !existsSync(join(assets, 'skeleton'))) throw new Error('usage: merge-rogue-assets.mjs <assetsDir> [packDir]');
const patchSpine = JSON.parse(readFileSync(join(pack, 'spine.patch.json'), 'utf8'));
const patchManifest = JSON.parse(readFileSync(join(pack, 'manifest.patch.json'), 'utf8'));

const indexFile = join(assets, 'skeleton', 'spine', 'index.json');
const manifestFile = join(assets, 'skeleton', 'manifest.json');
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { version: 1, models: {} };
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { version: 1, files: {} };
index.models ??= {};
manifest.files ??= {};

let addedModels = 0, addedFiles = 0;
for (const [k, v] of Object.entries(patchSpine.models ?? {})) if (!(k in index.models)) { index.models[k] = v; addedModels++; }
for (const [k, v] of Object.entries(patchManifest.files ?? {})) if (!(k in manifest.files)) { manifest.files[k] = v; addedFiles++; }

writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ assets, pack, addedModels, addedFiles, models: Object.keys(index.models).length, files: Object.keys(manifest.files).length }));
