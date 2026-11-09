// 把集成战略用到的敌人素材补进 AUE 素材包：spine 模型（isHarryh/Ark-Models）+ 158×158 图标（ArknightsGameResource）。
// 素材包本身不在仓库里（构建期 504 MB zip），所以这个脚本在构建期/本地都能跑，幂等（已存在的跳过）。
//
//   node tools/rogue-enemy-assets.mjs --assets <AUE_ASSETS_DIR> [--levels <dir>] [--only k1,k2] [--icons-only] [--dry]
//
// 产出：
//   <assets>/skeleton/spine/<key>/front/{model.skel,model.atlas,<key>.png}
//   <assets>/skeleton/enemy/<key>.png                     （图标，AUE 的 enemy:<key> 卡片贴图）
//   <assets>/skeleton/spine/index.json                    （合并 models 条目）
//   <assets>/skeleton/manifest.json                       （合并 enemy:<key> 文件条目）
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const assets = resolve(arg('--assets', ''));
const levelsDir = resolve(arg('--levels', join(root, 'data/rogue-levels')));
const only = (arg('--only', '') || '').split(',').filter(Boolean);
const iconsOnly = argv.includes('--icons-only');
const dry = argv.includes('--dry');
if (!assets || !existsSync(join(assets, 'skeleton'))) throw new Error('need --assets <AUE assets dir containing skeleton/>');

const SPINE = join(assets, 'skeleton', 'spine');
const ICONS = join(assets, 'skeleton', 'enemy');
const { readSkeleton } = await import(pathToFileURL(join(root, 'engine/packages/spine/src/skeleton.js')).href);

/** 素材来源的固定提交（可写死，避免上游漂移）；--ref 可覆盖。 */
const MODELS_REF = arg('--ref', 'main');
const modelUrl = (key, file) => `https://raw.githubusercontent.com/isHarryh/Ark-Models/${MODELS_REF}/models_enemies/${key.replace(/^enemy_/, '')}/${file}`;
const iconUrl = (key) => `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/master/enemy/${key}.png`;

/** @param {string} url @returns {Promise<Buffer | null>} */
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'rogue-assets/1.0' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === 2) return null; await new Promise((x) => setTimeout(x, 800 * (i + 1))); }
  }
  return null;
}

const indexFile = join(SPINE, 'index.json'), manifestFile = join(assets, 'skeleton', 'manifest.json');
const index = JSON.parse(readFileSync(indexFile, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
index.models ??= {};
manifest.files ??= {};

const keys = only.length ? only : [...new Set(readdirSync(levelsDir).filter((f) => /^rogue\d.*\.json$/.test(f)).flatMap((f) => Object.keys(JSON.parse(readFileSync(join(levelsDir, f), 'utf8')).enemies ?? {})))].sort();
console.log(JSON.stringify({ keys: keys.length, assets, levelsDir, iconsOnly, dry }));

mkdirSync(ICONS, { recursive: true });
const stat = { spine: 0, icon: 0, skip: 0, fail: [] };
let done = 0;

/** @param {string} key */
async function one(key) {
  const idx = index.models[key];
  const iconEntry = manifest.files[`enemy:${key}`];
  const wantSpine = !iconsOnly && !idx, wantIcon = !iconEntry;
  if (!wantSpine && !wantIcon) { stat.skip++; return; }
  if (wantSpine) {
    const dir = join(SPINE, key, 'front');
    const [skel, atlas, png] = await Promise.all([
      get(modelUrl(key, `${key}.skel`)), get(modelUrl(key, `${key}.atlas`)), get(modelUrl(key, `${key}.png`)),
    ]);
    if (skel && atlas && png) {
      try {
        readSkeleton(new Uint8Array(skel));
        if (!dry) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'model.skel'), skel);
          writeFileSync(join(dir, 'model.atlas'), atlas);
          writeFileSync(join(dir, `${key}.png`), png);
          index.models[key] = { front: { skel: `${key}/front/model.skel`, atlas: `${key}/front/model.atlas`,
            pages: { [`${key}.png`]: `${key}/front/${key}.png` }, pma: true,
            source: `isHarryh/Ark-Models@${MODELS_REF}:models_enemies/${key.replace(/^enemy_/, '')}` } };
        }
        stat.spine++;
      } catch { stat.fail.push(`${key}: spine ${skel.length}B not 3.8`); }
    } else stat.fail.push(`${key}: spine files missing`);
  }
  if (wantIcon) {
    const png = await get(iconUrl(key));
    if (png) {
      if (!dry) {
        writeFileSync(join(ICONS, `${key}.png`), png);
        manifest.files[`enemy:${key}`] = { file: `enemy/${key}.png`, width: 158, height: 158,
          sha256: createHash('sha256').update(png).digest('hex'), source: 'yuanyan3060/ArknightsGameResource:enemy' };
      }
      stat.icon++;
    } else stat.fail.push(`${key}: icon missing`);
  }
  if (++done % 50 === 0) console.log(`  ${done}/${keys.length} spine=${stat.spine} icon=${stat.icon} fail=${stat.fail.length}`);
}

const queue = [...keys];
await Promise.all(Array.from({ length: 8 }, async () => { for (let k = queue.shift(); k; k = queue.shift()) await one(k); }));

if (!dry) {
  writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(JSON.stringify({ ...stat, failSample: stat.fail.slice(0, 20), models: Object.keys(index.models).length, manifest: Object.keys(manifest.files).length }, null, 1));
