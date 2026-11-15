#!/usr/bin/env node
// deploy/probes/post-deploy.mjs — 部署后探针（sync.sh 5e 与 CI probe job 共用同一口径）。
//
//   node deploy/probes/post-deploy.mjs --base https://120.48.56.189 [--app-dir /opt/stronghold] [--sample 40] [--skip-assets]
//
// 检查面（每项一行 PASS/FAIL，任一 FAIL 退出码 1）：
//   1. healthz 契约：ok:true、app == package.json version、plugins >= 20
//   2. 版本集：act1/act2/act3 全启，default 由 env/参数期望指定（默认 act2autochess）
//   3. 规程端点：data/versions/act3autochess-v3_1/config.json 200
//   4. 前端 bundle：index.html / js/screens/lobby.js / js/audio.js 200
//   5. 资产完整性（--app-dir 时）：data/assets.json 的 audio 引用 vs 磁盘，0 缺失
//   6. 音频抽样（HTTP）：清单内抽样 N 条 URL 200（覆盖 bgm/sfx/voice，含规程曲目）
// 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 探针自身错误（连不上等）。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i > -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const flag = (name) => args.includes('--' + name);
const BASE = (arg('base', 'http://127.0.0.1:3000') || '').replace(/\/$/, '');
const APP_DIR = arg('app-dir', null);
const SAMPLE = Number(arg('sample', 40));
const SKIP_ASSETS = flag('skip-assets');
// CI 的 checkout 没有 public/assets（git-ignored）——跳过磁盘完整性与音频 HTTP 抽样（线上必开）。
const SKIP_AUDIO = flag('skip-audio');
const EXPECT_DEFAULT = arg('expect-default', process.env.SP_VERSION_DEFAULT || 'act2autochess');
const MIN_PLUGINS = Number(arg('min-plugins', 20));

const results = [];
const report = (ok, name, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

async function fetchStatus(url, timeoutMs = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    return res.status;
  } catch { return 0; } finally { clearTimeout(timer); }
}

// ---- 1. healthz 契约 ----
let health = null;
try {
  const res = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(15000) });
  health = await res.json();
  const pkgVersion = APP_DIR ? JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version : null;
  const okShape = health && health.ok === true && typeof health.build === 'string';
  const appOk = !pkgVersion || health.app === pkgVersion;
  const plugins = Number(health.content?.plugins ?? 0);
  report(okShape, 'healthz: ok:true + build', okShape ? '' : JSON.stringify(health).slice(0, 120));
  report(appOk, `healthz: app == ${pkgVersion ?? '(skip)'}`, health.app);
  report(plugins >= MIN_PLUGINS, `healthz: plugins >= ${MIN_PLUGINS}`, String(plugins));
} catch (e) {
  report(false, 'healthz reachable', String(e.message || e).slice(0, 120));
  console.log('SUMMARY ' + (results.every(Boolean) ? 'PASS' : 'FAIL') + ` (${results.filter(Boolean).length}/${results.length})`);
  process.exit(2);
}

// ---- 2. 版本集 ----
{
  const enabled = health.versions?.enabled ?? [];
  const want = ['act1autochess', 'act1autochess@V1_1', 'act2autochess', 'act2autochess@V2_1', 'act3autochess@V3_1'];
  const missing = want.filter((id) => !enabled.includes(id));
  report(missing.length === 0, 'versions: act1/act2/act3 all enabled', missing.length ? 'missing ' + missing.join(',') : enabled.join(','));
  const dflt = health.versions?.default;
  report(dflt === EXPECT_DEFAULT, `versions: default == ${EXPECT_DEFAULT}`, String(dflt));
}

// ---- 3. 规程端点 ----
{
  const st = await fetchStatus(`${BASE}/data/versions/act3autochess-v3_1/config.json`);
  report(st === 200, 'act3 config 200', String(st));
}

// ---- 4. 前端 bundle ----
for (const p of ['/index.html', '/js/screens/lobby.js', '/js/audio.js']) {
  const st = await fetchStatus(BASE + p);
  report(st === 200, `bundle ${p} 200`, String(st));
}

// ---- 5+6. 资产完整性与音频抽样（--skip-audio 时整体跳过：CI checkout 无资产目录）----
if (!SKIP_AUDIO) {
  const manifestAudioPaths = [];
  {
    const src = APP_DIR ? fs.readFileSync(path.join(APP_DIR, 'data/assets.json'), 'utf8') : await (await fetch(`${BASE}/data/assets.json`, { signal: AbortSignal.timeout(20000) })).text();
    const j = JSON.parse(src);
    const walk = (o) => { if (!o || typeof o !== 'object') return; for (const v of Object.values(o)) { if (typeof v === 'string' && v.startsWith('/assets/audio/')) manifestAudioPaths.push(v); else if (v && typeof v === 'object') walk(v); } };
    walk(j.audio);
    report(manifestAudioPaths.length > 1000, `manifest audio refs (${manifestAudioPaths.length})`, `total ${manifestAudioPaths.length}`);
  }

  if (!SKIP_ASSETS && APP_DIR) {
    const missing = [];
    for (const p of new Set(manifestAudioPaths)) {
      if (!fs.existsSync(path.join(APP_DIR, 'public', p))) missing.push(p);
    }
    report(missing.length === 0, `asset completeness: 0 missing on disk`, missing.length ? `${missing.length} missing — e.g. ${missing.slice(0, 4).join(', ')}` : `all ${new Set(manifestAudioPaths).size} present`);
  }

  {
    const uniq = [...new Set(manifestAudioPaths)];
    // 分层抽样：bgm 全查（少而关键），voice/sfx 随机抽 SAMPLE 条
    const bgm = uniq.filter((p) => p.includes('/bgm/'));
    const rest = uniq.filter((p) => !p.includes('/bgm/'));
    const picks = [...bgm];
    for (let i = rest.length - 1; i > 0; i--) { const j = (i * 2654435761) >>> 0; const k = j % (i + 1); [rest[i], rest[k]] = [rest[k], rest[i]]; }
    picks.push(...rest.slice(0, Math.max(0, SAMPLE - bgm.length)));
    let bad = [];
    for (const p of picks) {
      const st = await fetchStatus(BASE + p, 20000);
      if (st !== 200) bad.push(`${st} ${p}`);
    }
    report(bad.length === 0, `audio sample ${picks.length} URLs 200`, bad.length ? `${bad.length} bad — ${bad.slice(0, 4).join(' | ')}` : 'all ok');
  }
}

const ok = results.every(Boolean);
console.log(`SUMMARY ${ok ? 'PASS' : 'FAIL'} (${results.filter(Boolean).length}/${results.length})`);
process.exit(ok ? 0 : 1);
