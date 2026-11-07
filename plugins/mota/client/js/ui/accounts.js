// Compat module (stronghold-ui package) — install ONLY when the target has no public/js/ui/accounts.js.
// The original deployment has player accounts kept by its own accounts service (login, avatar, #tag, name cards, the
// same records on every device). This module is the LOCAL stand-in: one "本机账号" per browser, everything in
// localStorage — the profile (avatar, #tag) under `sp.pref.localAccount`, the match records in the game's own
// `sp.pref.stats` (ui/stats.js). Nothing is sent to the server, and only the player on this browser has an account:
// teammates show no #tag. To connect a real account system later, replace this file with a module that has the same
// exports (AGENTS.md §3.2 lists them and what each must return).
import { html, AvatarFrame, MicroLabel, Icon, Modal, Button } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { store } from '../store.js';
import { NameCardLayer } from './namecards.js';

/** This module keeps the account in the browser (other modules may check it to word their notes). */
export const LOCAL_ACCOUNT = true;

const KEY = 'sp.pref.localAccount';
const TOKEN_KEY = 'sp.accountToken'; // plugins/accounts: the sign-in token its title.login.js stores (`TOKEN_KEY` there)
const AVATAR_MAX = 160_000; // the stored data: URL (a 128×128 JPEG is ~10 kB)
const listeners = new Set();
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode / quota: kept for this page only */ } };

let profile = null;
function load() {
  if (profile) return profile;
  profile = read() || {};
  if (!/^\d{4}$/.test(profile.tag || '')) { profile.tag = String(1000 + Math.floor(Math.random() * 9000)); write(profile); }
  return profile;
}
function emit() { for (const fn of listeners) { try { fn(); } catch { /* a listener's own problem */ } } }
// (guarded: the module is also imported by Node tests, where there is no window)
globalThis.addEventListener?.('storage', (e) => {
  if (e.key === KEY) { profile = null; emit(); }
  // another tab signed in / out: the cached server account belongs to the old token
  else if (e.key === TOKEN_KEY) { svr = null; svrState = 'idle'; emit(); }
});

// ---- the server account (plugins/accounts, GET /api/account/me) ----------------------------------------------
// 一处修四处：大厅 chip、房间页自己的座位卡、结算卡、成就页都经 currentAccount() 取头像 / 昵称 / #代号 / 卡面。
// 只有存着 sp.accountToken 时才问服务端；拿到了就顶在本机账号前面，拿不到（未登录 / 离线 / 服务器没装
// accounts）仍旧是本机账号 —— 缺省行为与加这一段之前逐字节一致。
let svr = null;          // the `account` of /api/account/me ({ qq, avatar, name, card, … }), null = none
let svrState = 'idle';   // 'idle' (ask on the next read) | 'loading' | 'done' (svr set) | 'failed' (stay local)
const readToken = () => { try { return globalThis.localStorage?.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
/** Ask the accounts service once per token: the answer lands in `svr` and wakes every listener. */
function syncSvr() {
  const token = readToken();
  if (!token) { if (svr) { svr = null; svrState = 'idle'; } return; } // signed out: drop the old account
  if (svrState !== 'idle') return;                                    // loading / done / already failed
  svrState = 'loading';
  fetch('/api/account/me', { headers: { authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j && j.ok && j.account) { svr = j.account; svrState = 'done'; emit(); }
      else svrState = 'failed';
    })
    .catch(() => { svrState = 'failed'; /* offline / no accounts service: keep the local account */ });
}
// 登录 / 改昵称 / 换卡 / 登出（plugins/accounts 的 title.login.js 广播 sp:card-changed）→ 丢掉缓存重新问
globalThis.addEventListener?.('sp:card-changed', () => { svr = null; svrState = 'idle'; emit(); });

/**
 * This browser's account: { id, name (the game's player name), tag, avatar, card, local }.
 * With `sp.accountToken` and the accounts service answering, name / avatar / card are the server's; otherwise they
 * are the local ones (localStorage `sp.pref.localAccount`) and `local` is true.
 */
export function currentAccount() {
  syncSvr();
  const p = load();
  const localName = store.get().me?.name || p.name || '博士';
  // 业主 2026-11-02：代号以 sp.tag 为准（就是 hello 里发给服务端的那个），保证 chip 与座位卡显示同一个 #代号
  const spTag = (() => { try { const t = globalThis.localStorage?.getItem('sp.tag') || ''; return /^[0-9]{4}$/.test(t) ? t : ''; } catch { return ''; } })();
  const tag = spTag || p.tag;
  const localAvatar = typeof p.avatar === 'string' ? p.avatar : null;
  // 服务端账号的昵称 / 头像 / 卡面压过本机那份（头像由服务端现拼 QQ 头像 API，不存图）；没有就回退本机
  const s = svr;
  const name = (s && typeof s.name === 'string' && s.name) || localName;
  const avatar = (s && typeof s.avatar === 'string' && s.avatar) || localAvatar;
  const card = (s && s.card) || null;
  return { id: `local-${tag}`, name, tag, avatar, card, local: !s };
}
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export async function refreshAccount() { return currentAccount(); }
export async function logoutAccount() { /* a local account cannot log out */ }
/** A fetch timeout signal (some modules import it from here). */
export function timeoutSignal(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }

/** Preact: { me, loaded } — always loaded, `me` is the local account. */
export function useCurrentAccount() {
  const [me, setMe] = useState(currentAccount);
  useEffect(() => {
    const update = () => setMe(currentAccount());
    listeners.add(update);
    const off = store.subscribe ? store.subscribe(update) : null;
    return () => { listeners.delete(update); if (typeof off === 'function') off(); };
  }, []);
  return { me, loaded: true };
}

const isMe = (playerId) => !!playerId && playerId === store.get().me?.playerId;
/** A player's account — only this browser's own player has one here (teammates: null, no #tag). */
export function accountOf(playerId) { return isMe(playerId) ? currentAccount() : null; }
export function useAccount(playerId) {
  const { me } = useCurrentAccount();
  return isMe(playerId) ? me : null;
}
/** The small "#1234" after a name when that player has an account. */
export function AccountTag({ playerId }) {
  const info = useAccount(playerId);
  return info ? html`<span class="acct-tag" title=${`本机账号 ${info.name}#${info.tag}`}>#${info.tag}</span>` : null;
}
/** Plain DOM (chats): the #tag after this browser's own name. */
export function decorateChatName(element, playerId) {
  const info = accountOf(playerId);
  if (element && info && !element.querySelector('.acct-tag')) {
    const tag = document.createElement('span'); tag.className = 'acct-tag'; tag.textContent = `#${info.tag}`; element.append(tag);
  }
  return element;
}

// ---- avatar file → 128×128 square ------------------------------------------------------------------------------------
async function squareAvatar(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('图片读取失败')); i.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
    return c.toDataURL('image/jpeg', 0.86);
  } finally { URL.revokeObjectURL(url); }
}

// ---- the panel (opened from the hub's top-right chip) -------------------------------------------------------------------
function ensureStyle() {
  if (document.getElementById('local-acct-style')) return;
  const st = document.createElement('style');
  st.id = 'local-acct-style';
  st.textContent = `.acct-tag{margin-left:.06em;font-size:.8em;font-weight:600;opacity:.62;letter-spacing:.02em}
.lacct{display:flex;flex-direction:column;gap:.16rem;min-width:min(5.6rem,86vw)}
.lacct__who{display:flex;align-items:center;gap:.16rem}
.lacct__pic{width:.9rem;height:.9rem;flex:none;display:grid;place-items:center;overflow:hidden;border:2px solid var(--mint-700,#2b7);background:#101614;font-size:.4rem;font-weight:900}
.lacct__pic img{width:100%;height:100%;object-fit:cover}
.lacct__name{font-size:.3rem;font-weight:900}
.lacct__note{margin:0;font-size:.17rem;line-height:1.5;opacity:.72}
.lacct__btns{display:flex;flex-wrap:wrap;gap:.1rem}`;
  document.head.appendChild(st);
}
let host = null;
function AccountPanel({ onStats, onClose }) {
  const { me } = useCurrentAccount();
  const [busy, setBusy] = useState(false);
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setBusy(true);
      try { const d = await squareAvatar(f); if (d.length <= AVATAR_MAX) { profile = { ...load(), avatar: d }; write(profile); emit(); } }
      catch { /* not an image */ } finally { setBusy(false); }
    };
    input.click();
  };
  const clear = () => { profile = { ...load(), avatar: null }; write(profile); emit(); };
  return html`<${Modal} open=${true} title="本机账号" micro="LOCAL ACCOUNT" onClose=${onClose}>
    <div class="lacct">
      <div class="lacct__who">
        <span class="lacct__pic">${me.avatar ? html`<img src=${me.avatar} alt="" />` : [...me.name][0]}</span>
        <span><b class="lacct__name">${me.name}<span class="acct-tag">#${me.tag}</span></b><br /><${MicroLabel}>LOCAL · 本机<//></span>
      </div>
      <p class="lacct__note">头像、编号和战绩都保存在这台设备的浏览器里，不上传服务器；换设备或清除浏览器数据后不会保留。昵称跟随游戏里的名字。</p>
      <div class="lacct__btns">
        <${Button} size="sm" variant="secondary" icon="edit" loading=${busy} onClick=${pick}>更换头像<//>
        ${me.avatar ? html`<${Button} size="sm" variant="ghost" onClick=${clear}>移除头像<//>` : null}
        ${onStats ? html`<${Button} size="sm" variant="primary" icon="chart" onClick=${() => { onClose(); onStats(); }}>统计数据<//>` : null}
      </div>
    </div>
  <//>`;
}
/** Open the account panel ({ onStats } adds the 统计数据 button). */
export function openAccountPanel(opts = {}) {
  ensureStyle();
  if (!host) { host = document.createElement('div'); host.className = 'local-acct-host'; document.body.appendChild(host); }
  const close = () => render(null, host);
  render(html`<${AccountPanel} onStats=${opts.onStats} onClose=${close} />`, host);
}

/** The hub's top-right chip: avatar + name #tag; a click opens the account panel (with 统计数据). */
export function AccountMeChip({ player, onStats }) {
  const { me } = useCurrentAccount();
  useEffect(ensureStyle, []);
  const name = player?.name || me.name || '博士';
  // 名片卡面：走 UI 包既有的 .has-nc + .nc-layer（本机卡面 id 存在 sp.cardSkin）
  const skin = (() => { try { return globalThis.localStorage?.getItem('sp.cardSkin') || ''; } catch { return ''; } })();
  // 服务器账号：currentAccount() 已经问过 /api/account/me（有 sp.accountToken 才问），`local:false` 就是认到了。
  // （业主 2026-11-02：照 sp.bbsmc.cn 的两态文案 —— ACCOUNT · 账号 / LOCAL · 本机账号）
  const linked = !me.local;

  return html`<button type="button" class=${`me-chip me-chip--btn stats-entry${skin || me.card ? ' has-nc' : ''}`} onClick=${() => openAccountPanel({ onStats })} title=${linked ? '账号 · 统计数据' : '本机账号 · 统计数据'} aria-label=${linked ? '账号' : '本机账号'}>
    <${NameCardLayer} card=${me.card || (skin ? { skin } : null)} />
    <${AvatarFrame} size="sm" name=${name} seat=${0} self=${true} src=${me.avatar || undefined} />
    <span class="me-chip__text"><span class="me-chip__name">${name}<span class="acct-tag">#${me.tag}</span></span><${MicroLabel}>${linked ? 'ACCOUNT · 账号' : 'LOCAL · 本机账号'}<//></span>
    <${Icon} name="user" class="me-chip__stats" />
  </button>`;
}

/** Nothing to start: no service. */
export function startAccounts() {}
