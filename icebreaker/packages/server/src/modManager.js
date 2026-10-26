// The mod manager (the `/mod` page and its API): the host's data mods managed from the browser instead of the
// filesystem alone. Icebreaker reads `mods/` once at start (mods.js, site spec 站点-7); this adds the other half the
// host needs in a deployed container — see what loaded, put a mod zip in, turn one off, and re-read the folder
// without restarting the server.
//
// Contract with the rest of the server:
//   · `current()` is the HostMods every request and every NEW battle reads (http.js serves /mods/ from it,
//     battles.js takes its content source per match), so a reload reaches the next battle without a restart;
//   · writes require the owner key: `--mod-key <k>`, else `AUE_MOD_KEY`, else the first start writes
//     `<mods>/.mod-key` (0600) and logs it. Reads (the page, the list) never need it;
//   · nothing here trusts an upload: path safety + size caps live in zipRead.js, and the manifest is validated with
//     the engine's own reader (readModManifest) before anything is written;
//   · a disabled mod is moved under `<mods>/.disabled/<id>` — a dot directory, which the loader skips — so enabling
//     it back is a rename, never a re-download.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MOD_ID, MOD_LIMITS, readModManifest } from '@aue/schema';
import { loadHostMods } from './mods.js';
import { readZip } from './zipRead.js';
import { rawPathname } from './paths.js';
import { sendBody, sendText } from './respond.js';

/**
 * @typedef {{ prefix: string, handles: (path: string) => boolean,
 *   handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<boolean>,
 *   current: () => import('./mods.js').HostMods, reload: () => Promise<import('./mods.js').HostMods>,
 *   info: () => { dir: string | null } }} HostModManager
 */

/** Where the manager lives. */
export const MOD_MANAGER_PREFIX = '/mod';
/** The disabled mods' folder, inside the mods folder: a dot directory, which the loader skips. */
const DISABLED = '.disabled';
/** The most bytes of a JSON request the manager reads (toggle / reload carry tiny objects). */
const JSON_BODY_BYTES = 64 * 1024;
const JSON_TYPE = 'application/json; charset=utf-8';

/** @param {Buffer} a @param {Buffer} b */
const sameBytes = (a, b) => a.length === b.length && timingSafeEqual(a, b);
/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {unknown} value */
const json = (req, res, value) => sendBody(req, res, { body: Buffer.from(JSON.stringify(value), 'utf8'), type: JSON_TYPE });

/**
 * The owner key: `--mod-key <k>`, else `AUE_MOD_KEY`, else the key file the first start creates in the mods folder.
 * A read-only server directory falls back to a per-process key (logged), so the page still works with `--mod-key`.
 * @param {{ rootDir: string, modsDir: string | null, argv: readonly string[], env: Record<string, string | undefined>, log?: (line: string) => void }} o
 * @returns {string}
 */
export function loadOwnerKey({ rootDir, modsDir, argv, env, log }) {
  const i = argv.indexOf('--mod-key');
  const given = (i >= 0 ? argv[i + 1] : undefined) ?? env['AUE_MOD_KEY'];
  if (typeof given === 'string' && given.length > 0) return given;
  const dir = modsDir ?? join(rootDir, 'mods'), file = join(dir, '.mod-key');
  if (existsSync(file)) {
    try { const k = readFileSync(file, 'utf8').trim(); if (k) return k; } catch { /* unreadable: recreate below */ }
  }
  const key = randomBytes(16).toString('hex');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${key}\n`, { mode: 0o600 });
    log?.(`mod manager key: ${key} (${file})`);
  } catch (e) {
    log?.(`mod manager key: ${key} (not written to ${file}: ${e instanceof Error ? e.message : String(e)})`);
  }
  return key;
}

/**
 * The mod's folder root inside an archive: `pack.json` at the top, or inside a single top-level directory (the
 * shape every "zip a folder" gesture produces) — and the id the loader will use for it (the folder's name).
 * @param {{ path: string, data: Buffer }[]} entries
 * @returns {{ prefix: string, id: string, pack: { path: string, data: Buffer } } | null}
 */
function archiveRoot(entries) {
  const top = entries.find((e) => e.path === 'pack.json');
  if (top) return { prefix: '', id: '', pack: top };
  const firsts = new Set(entries.map((e) => e.path.split('/')[0]));
  if (firsts.size !== 1) return null;
  const dir = [...firsts][0];
  const pack = entries.find((e) => e.path === `${dir}/pack.json`);
  return pack ? { prefix: `${dir}/`, id: dir, pack } : null;
}

/**
 * The id a zip installs under: the folder it was packed as, else the manifest's own `id`. Validated as a mod id.
 * @param {{ id: string }} root @param {unknown} manifest
 * @returns {{ id: string } | { error: string }}
 */
function installId(root, manifest) {
  const declared = /** @type {any} */ (manifest)?.id;
  const id = root.id || (typeof declared === 'string' ? declared : '');
  if (!id) return { error: 'pack.json at the top of the zip needs an "id" (or put it in one folder)' };
  if (!MOD_ID.test(id)) return { error: `id "${id}" is not 1–32 of a–z 0–9 _ -` };
  return { id };
}

/** @param {import('node:http').IncomingMessage} req @param {number} max @returns {Promise<Buffer | null>} */
const readBody = (req, max) => new Promise((done) => {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0, settled = false;
  const finish = (/** @type {Buffer | null} */ v) => { if (!settled) { settled = true; done(v); } };
  req.on('data', (c) => {
    size += c.length;
    if (size > max) { finish(null); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => finish(Buffer.concat(chunks)));
  req.on('error', () => finish(null));
});

/** The ids of the parked (disabled) mods. @param {string | null} modsDir @returns {string[]} */
function disabledIds(modsDir) {
  if (!modsDir) return [];
  try {
    const dir = join(modsDir, DISABLED);
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort();
  } catch { return []; }
}

/**
 * Writes an uploaded archive into the mods folder (atomically: staging → rename), then answers with the id.
 * @param {{ modsDir: string, zip: { entries: { path: string, data: Buffer }[] }, replace: boolean }} o
 * @returns {{ id: string, error: null, status: 200 } | { id: null, error: string, status: number }}
 */
function installZip({ modsDir, zip, replace }) {
  const root = archiveRoot(zip.entries);
  if (!root) return { id: null, status: 400, error: 'the zip holds no pack.json (at the top, or in one folder)' };
  /** @type {unknown} */
  let manifestRaw;
  try { manifestRaw = JSON.parse(root.pack.data.toString('utf8')); } catch { return { id: null, status: 400, error: 'pack.json is not JSON' }; }
  const named = installId(root, manifestRaw);
  if ('error' in named) return { id: null, status: 400, error: named.error };
  const read = readModManifest(manifestRaw, named.id);
  if (!read.manifest) return { id: null, status: 400, error: `pack.json: ${read.problems.join('; ')}` };
  const id = read.manifest.id, target = join(modsDir, id);
  if (existsSync(target) && !replace) return { id: null, status: 409, error: `mod ${id} is already there (upload with ?replace=1)` };
  const staging = join(modsDir, `.staging-${id}-${process.pid}`);
  try {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    let total = 0;
    for (const entry of zip.entries) {
      if (root.prefix && !entry.path.startsWith(root.prefix)) continue; // other top-level files are not the mod
      const rel = entry.path.slice(root.prefix.length);
      if (rel === '') continue;
      total += entry.data.length;
      if (total > MOD_LIMITS.modBytes) return { id: null, status: 413, error: `the mod is larger than ${MOD_LIMITS.modBytes} bytes` };
      const out = join(staging, rel);
      if (!resolve(out).startsWith(resolve(staging))) return { id: null, status: 400, error: `unsafe path ${rel}` };
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, entry.data);
    }
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    return { id: null, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
  return { id, status: 200, error: null };
}

/**
 * Moves a mod between `mods/<id>` and `mods/.disabled/<id>`.
 * @param {string} modsDir @param {string} id @param {boolean} enabled
 * @returns {{ status: 200, error: null } | { status: number, error: string }}
 */
function toggleDir(modsDir, id, enabled) {
  const active = join(modsDir, id), parked = join(modsDir, DISABLED, id);
  if (enabled) {
    if (!existsSync(parked)) return { status: 404, error: 'that mod is not disabled' };
    if (existsSync(active)) return { status: 409, error: 'a mod with that id is already there' };
    renameSync(parked, active);
  } else {
    if (!existsSync(active)) return { status: 404, error: 'that mod is not loaded' };
    mkdirSync(dirname(parked), { recursive: true });
    renameSync(active, parked);
  }
  return { status: 200, error: null };
}

/**
 * The list: what loaded, what the folder holds, what is parked. Reads never need the key.
 * @param {{ modsDir: string | null, current: () => import('./mods.js').HostMods }} o
 * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
 */
function getList(o, req, res) {
  const current = o.current();
  json(req, res, {
    mods: current.index.mods, engine: current.index.engine, indexVersion: current.index.version,
    dir: o.modsDir, disabled: disabledIds(o.modsDir), reports: current.reports ?? [], skipped: current.skipped ?? [],
  });
  return true;
}

/**
 * `{ id, enabled }` → move the folder, then re-read.
 * @param {{ modsDir: string | null, reload: () => Promise<import('./mods.js').HostMods> }} o
 * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
 */
async function postToggle(o, req, res) {
  const raw = await readBody(req, JSON_BODY_BYTES);
  if (raw === null) { sendText(res, 413, 'request body too large'); return true; }
  /** @type {{ id?: unknown, enabled?: unknown }} */
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { sendText(res, 400, 'the body is not JSON'); return true; }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!MOD_ID.test(id)) { sendText(res, 400, 'bad mod id'); return true; }
  try {
    const out = toggleDir(/** @type {string} */ (o.modsDir), id, body.enabled === true);
    if (out.error !== null) { sendText(res, out.status, out.error); return true; }
  } catch (e) { sendText(res, 500, e instanceof Error ? e.message : String(e)); return true; }
  const mods = await o.reload();
  json(req, res, { ok: true, enabled: body.enabled === true, mods: mods.index.mods.length });
  return true;
}

/**
 * A zip body → written into the folder, then re-read.
 * @param {{ modsDir: string | null, reload: () => Promise<import('./mods.js').HostMods> }} o
 * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {URL} url
 */
async function postUpload(o, req, res, url) {
  const raw = await readBody(req, MOD_LIMITS.modBytes);
  if (raw === null) { sendText(res, 413, `the upload is larger than ${MOD_LIMITS.modBytes} bytes`); return true; }
  const zip = readZip(raw);
  if (zip.error) { sendText(res, 400, zip.error); return true; }
  const out = installZip({ modsDir: /** @type {string} */ (o.modsDir), zip, replace: url.searchParams.get('replace') === '1' });
  if (out.error !== null) { sendText(res, out.status, out.error); return true; }
  const mods = await o.reload();
  json(req, res, { ok: true, id: out.id, mods: mods.index.mods.length });
  return true;
}

/**
 * The API's write routes, after the key gate.
 * @param {{ modsDir: string | null, reload: () => Promise<import('./mods.js').HostMods> }} o
 * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {string} name @param {URL} url
 */
async function routePost(o, req, res, name, url) {
  if (!o.modsDir) { sendText(res, 409, 'this server has no mods folder'); return true; }
  if (name === 'reload') { const mods = await o.reload(); json(req, res, { ok: true, mods: mods.index.mods.length }); return true; }
  if (name === 'toggle') return postToggle(o, req, res);
  if (name === 'upload') return postUpload(o, req, res, url);
  sendText(res, 404, 'not found');
  return true;
}

/**
 * Creates the manager.
 * @param {{ modsDir: string | null, key: string, log?: (line: string) => void, initial: import('./mods.js').HostMods }} o
 */
export function createModManager({ modsDir, key, log, initial }) {
  /** @type {import('./mods.js').HostMods} */
  let current = initial;
  const keyBuf = Buffer.from(key, 'utf8');

  /**
   * Re-reads the mods folder and publishes the result. New battles and the pages see it; a running battle keeps the
   * content it started with.
   * @returns {Promise<import('./mods.js').HostMods>}
   */
  const reload = async () => {
    current = await loadHostMods(modsDir);
    for (const line of current.lines) log?.(line);
    return current;
  };
  const o = { modsDir, reload, current: () => current };

  /** @param {import('node:http').IncomingMessage} req */
  const authorized = (req) => {
    const raw = req.headers['x-mod-key'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const query = new URL(req.url ?? '/', 'http://x').searchParams.get('key');
    const value = typeof header === 'string' && header.length > 0 ? header : query;
    return typeof value === 'string' && sameBytes(Buffer.from(value, 'utf8'), keyBuf);
  };

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x'), path = rawPathname(req.url ?? '');
    if (path === MOD_MANAGER_PREFIX || path === `${MOD_MANAGER_PREFIX}/`) {
      // the page is public: it lists what loaded, and asks for the key before any write
      sendBody(req, res, { body: Buffer.from(page(), 'utf8'), type: 'text/html; charset=utf-8' });
      return true;
    }
    const api = `${MOD_MANAGER_PREFIX}/api/`, name = path.startsWith(api) ? path.slice(api.length) : null;
    if (name === null) { sendText(res, 404, 'not found'); return true; }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (name === 'list.json') return getList(o, req, res);
      sendText(res, 404, 'not found');
      return true;
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, HEAD, POST'); sendText(res, 405, 'method not allowed'); return true; }
    if (!authorized(req)) { sendText(res, 401, 'the owner key is required (x-mod-key)'); return true; }
    return routePost(o, req, res, name, url);
  };

  return {
    prefix: MOD_MANAGER_PREFIX,
    /** @param {string} path */
    handles: (path) => path === MOD_MANAGER_PREFIX || path.startsWith(`${MOD_MANAGER_PREFIX}/`),
    handler,
    /** The mods everything downstream reads — the current folder, after every reload. */
    current: () => current,
    reload,
    /** Where the mods live (the page never prints the key). */
    info: () => ({ dir: modsDir }),
  };
}

/**
 * The page: one self-contained document, no build step (the same rule as the platform's other pages).
 * @returns {string}
 */
export function page() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>mod 管理器 · Icebreaker Games</title>
<style>
 :root{color-scheme:dark}body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#14171a;color:#e6ecef}
 main{max-width:56rem;margin:0 auto;padding:1.5rem}
 h1{font-size:1.25rem;margin:0 0 .25rem}h2{font-size:1rem;margin:1.2rem 0 .4rem}p.sub{margin:0 0 1.25rem;color:#93a1a8}
 table{width:100%;border-collapse:collapse;margin:0 0 1rem}th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid #262d31;vertical-align:top}
 th{color:#93a1a8;font-weight:600}.ok{color:#5fd08a}.bad{color:#ff8a7a}.dim{color:#93a1a8}
 fieldset{border:1px solid #262d31;border-radius:.4rem;padding:.9rem 1rem;margin:0 0 1rem}
 legend{padding:0 .4rem;color:#93a1a8}
 input[type=password],input[type=file]{background:#1d2226;color:inherit;border:1px solid #2c3439;border-radius:.3rem;padding:.35rem}
 button{background:#2c5f4f;color:#eafff8;border:0;border-radius:.3rem;padding:.4rem .9rem;cursor:pointer}
 button.ghost{background:#242b30;color:#cfdadf}button:disabled{opacity:.5;cursor:default}
 #msg{margin:.5rem 0 1rem;min-height:1.5em}code{color:#a8d8c8}
</style></head>
<body><main>
<h1>mod 管理器</h1>
<p class="sub">数据 mod 放在 <code>mods/</code>；这里上传、启停、重读。<span class="dim">写入需要业主钥匙。</span></p>
<fieldset><legend>业主钥匙</legend>
 <input id="key" type="password" size="40" placeholder="--mod-key / AUE_MOD_KEY / mods/.mod-key" autocomplete="off">
 <button class="ghost" id="save">保存到本浏览器</button>
 <span class="dim">只存在 localStorage，不上传。</span>
</fieldset>
<div id="msg"></div>
<h2>已加载</h2><table><thead><tr><th>id</th><th>版本</th><th>名称</th><th>文件</th><th></th></tr></thead><tbody id="mods"></tbody></table>
<h2>已停用</h2><table><thead><tr><th>id</th><th></th></tr></thead><tbody id="off"></tbody></table>
<fieldset><legend>上传 mod（zip，内含 pack.json）</legend>
 <input id="zip" type="file" accept=".zip,application/zip">
 <label class="dim"><input id="replace" type="checkbox"> 覆盖同名</label>
 <button id="up">上传并重读</button>
</fieldset>
<p><button class="ghost" id="reload">只重读 mods/</button></p>
<script>
const $=(s)=>document.querySelector(s), keyEl=$('#key');
keyEl.value=localStorage.getItem('ig-mod-key')||'';
$('#save').onclick=()=>{localStorage.setItem('ig-mod-key',keyEl.value.trim());say('钥匙已保存','ok');};
const say=(t,cls)=>{const m=$('#msg');m.textContent=t;m.className=cls||'';};
const hdr=()=>({'x-mod-key':keyEl.value.trim()});
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Relative to the page, so the manager works both at the root and under a reverse proxy's sub-path (站点-1: the
// platform asks for nothing outside its own prefix).
const apiBase=(location.pathname.endsWith('/')?location.pathname:location.pathname+'/')+'api/';
async function api(name,body){const r=await fetch(apiBase+name,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{...hdr(),'content-type':body instanceof Blob?'application/zip':'application/json'},body});const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));return t?JSON.parse(t):{};}
async function toggle(id,enabled){try{const r=await api('toggle',JSON.stringify({id,enabled}));say((enabled?'已启用 ':'已停用 ')+id+'（现 '+r.mods+' 个）','ok');await refresh();}catch(e){say(e.message,'bad');}}
async function refresh(){
 try{const d=await api('list.json');
  $('#mods').innerHTML=(d.mods||[]).map(m=>'<tr><td>'+esc(m.id)+'</td><td>'+esc(m.version||'')+'</td><td>'+esc(m.name||'')+'</td><td class="dim">'+((m.files||[]).length||'')+'</td><td><button class="ghost" data-off="'+esc(m.id)+'">停用</button></td></tr>').join('')||'<tr><td colspan="5" class="dim">（没有）</td></tr>';
  $('#off').innerHTML=(d.disabled||[]).map(id=>'<tr><td>'+esc(id)+'</td><td><button class="ghost" data-on="'+esc(id)+'">启用</button></td></tr>').join('')||'<tr><td colspan="2" class="dim">（没有）</td></tr>';
  document.querySelectorAll('[data-off]').forEach(b=>b.onclick=()=>toggle(b.dataset.off,false));
  document.querySelectorAll('[data-on]').forEach(b=>b.onclick=()=>toggle(b.dataset.on,true));
 }catch(e){say('读列表失败：'+e.message,'bad');}
}
$('#up').onclick=async()=>{const f=$('#zip').files[0];if(!f)return say('先选一个 zip','bad');const q=$('#replace').checked?'?replace=1':'';try{say('上传中…');const r=await api('upload'+q,f);say('已装入 '+r.id+'（现 '+r.mods+' 个）','ok');await refresh();}catch(e){say('上传失败：'+e.message,'bad');}};
$('#reload').onclick=async()=>{try{const r=await api('reload');say('已重读（现 '+r.mods+' 个）','ok');await refresh();}catch(e){say(e.message,'bad');}};
refresh();
</script>
</main></body></html>`;
}
