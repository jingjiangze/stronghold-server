// public/js/ui/account.js — 账号面板（P2/P5，业主 2026-11-01）。
//
// 口径：QQ 号就是账号、头像直接调 QQ 头像 API（不存图）、**账号不强制**（游客仍可直接开局，
// 想留名/跨设备再手动绑定）、密码自己设（**两次输入**）、登录默认保留（令牌存 localStorage）。
// 公告来自服务端 /api/announcements（管理后台写）。
//
// 2026-11-01 业主第二次改口径：「账号按钮太小」「首页替换为账号」——
// 入口不再是左上角小 chip，而是首页登录卡里那条宽度撑满的 `AccountBar`（`public/css/screens/title.css`
// 的 `.title-account-bar`）；登录后首页代号框锁定为账号昵称（`title.js`）。`AccountDock` 保留导出但已停用
// （插件 `main.js` 仍在挂它，撤掉会 404/报错）。
//
// 这个文件在核心 public/js 下：插件 `main.js` 用 `./ui/account.js`、插件 `ui/accounts.js` 用 `./account.js`
// 引它时，运行时回退到这里（`plugins/mota/plugin.json` 的 `code.client` 只列了复数 `js/ui/accounts.js`）。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, Modal } from './components.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

const TOKEN_KEY = 'sp.accountToken';

const readToken = () => { try { return globalThis.localStorage?.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const writeToken = (v) => { try { if (v) globalThis.localStorage?.setItem(TOKEN_KEY, v); else globalThis.localStorage?.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

async function call(path, { method = 'GET', body = null, token = '' } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...data };
}

const ERR = {
  BAD_QQ: () => t('QQ 号看起来不对（5–12 位数字）'),
  BAD_PASSWORD: () => t('密码要 6–64 位，且首尾不能是空格'),
  BAD_CREDENTIALS: () => t('QQ 号或密码不对'),
  EXISTS: () => t('这个 QQ 号已经注册过了，直接登录即可'),
  NO_GUEST_SESSION: () => t('当前没有可绑定的游客会话，请刷新页面后重试'),
  TOO_LARGE: () => t('内容太长'),
  UNAUTHORIZED: () => t('登录已过期，请重新登录'),
};

/** 一次性把面板样式塞进 head（不依赖任何插件 CSS）；入口条本身的样式在 title.css。 */
let styled = false;
function ensureStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  if (document.getElementById('sp-acc-style')) return;
  const st = document.createElement('style');
  st.id = 'sp-acc-style';
  st.textContent = `
    .acc-head{display:flex;gap:12px;align-items:center;margin-bottom:12px}
    .acc-avatar{border-radius:50%}
    .acc-dim{color:#8b93a1;font-size:12px}
    .acc-row{display:flex;gap:10px;align-items:center;margin:8px 0}
    .acc-row span{width:84px;flex:none;color:#aab2c0}
    .acc-row input{flex:1;padding:6px 8px;border-radius:6px;border:1px solid #2f3745;background:#0e1116;color:#e6e9ef;font:inherit}
    .acc-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
    .acc-err{color:#ff8a80;margin:8px 0 0}
    .acc-ann{list-style:none;padding:0;margin:0}
    .acc-ann li{padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)}
    .acc-ann__t{font-weight:600;display:flex;justify-content:space-between;gap:10px}
    .acc-ann__b{white-space:pre-wrap;color:#c8cdd6;margin-top:4px}`;
  document.head.appendChild(st);
}

// ── 账号会话（模块级快照 + 订阅）：首页登录条、大厅身份 chip、代号锁定都读同一份 ─────────────
let snapshot = { token: readToken(), account: null, ready: false };
const subs = new Set();
const publish = (patch) => { snapshot = { ...snapshot, ...patch }; for (const f of [...subs]) f(snapshot); };

/** 已登录账号（可能为 null）。任何组件都能读；登录/退出后自动重渲染。 */
export function useAccount() {
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    subs.add(setSnap);
    ensureStyle();
    if (snapshot.token && !snapshot.account) refreshAccount();
    else if (!snapshot.token && !snapshot.ready) publish({ ready: true });
    return () => { subs.delete(setSnap); };
  }, []);
  return snap;
}

/** 用本地令牌向服务端确认身份；令牌失效就丢掉。 */
export async function refreshAccount() {
  const token = readToken();
  if (!token) { publish({ token: '', account: null, ready: true }); return null; }
  try {
    const r = await call('/api/account/me', { token });
    if (r.ok) { publish({ token, account: r.account, ready: true }); return r.account; }
  } catch { /* offline: keep the token, retry on the next mount */ }
  writeToken('');
  publish({ token: '', account: null, ready: true });
  return null;
}

/** 登录/绑定成功后写入令牌并广播。 */
export function setAccountSession(token, account) {
  writeToken(token || '');
  publish({ token: token || '', account: account || null, ready: true });
}

/** 退出登录（只清本地令牌，不影响对局）。 */
export function clearAccountSession() {
  writeToken('');
  publish({ token: '', account: null, ready: true });
}

/** 大厅等处读一眼「有没有绑定账号」——非响应式，够用于静态标签。 */
export function hasBoundAccount() {
  return !!snapshot.account || !!readToken();
}

export function AccountModal({ open, onClose, onChanged }) {
  const me = useStore((s) => s.me);
  const [token, setToken] = useState(readToken);
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [qq, setQq] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('');

  useEffect(() => {
    if (!open || !token) return;
    let live = true;
    call('/api/account/me', { token }).then((r) => {
      if (!live) return;
      if (r.ok) { setAccount(r.account); setName(r.account.name || ''); setColor(r.account.nameStyle?.color || ''); } else { writeToken(''); setToken(''); }
    });
    return () => { live = false; };
  }, [open, token]);

  const submit = async () => {
    setErr('');
    if (pw2 && pw !== pw2) { setErr(t('两次输入的密码不一致')); return; }
    setBusy(true);
    try {
      // 填了确认密码 = 建号/绑定；只填密码 = 登录
      const r = pw2
        ? await call('/api/auth/bind', { method: 'POST', body: { qq, password: pw }, token: me?.token || '' })
        : await call('/api/auth/login', { method: 'POST', body: { qq, password: pw } });
      if (!r.ok) { setErr((ERR[r.error] || (() => r.error || t('操作失败')))()); return; }
      setToken(r.token); setAccount(r.account); setName(r.account.name || ''); setColor(r.account.nameStyle?.color || '');
      setAccountSession(r.token, r.account);
      setPw(''); setPw2(''); onChanged?.(r.account);
    } finally { setBusy(false); }
  };

  const save = async () => {
    setErr(''); setBusy(true);
    try {
      const body = { name: name.trim(), nameStyle: color ? { color } : null };
      const r = await call('/api/account/profile', { method: 'POST', body, token });
      if (!r.ok) { setErr((ERR[r.error] || (() => r.error || t('保存失败')))()); return; }
      setAccount(r.account); publish({ account: r.account }); onChanged?.(r.account);
    } finally { setBusy(false); }
  };

  const logout = () => { setToken(''); setAccount(null); clearAccountSession(); onChanged?.(null); };

  return html`<${Modal} open=${open} onClose=${onClose} title=${t('账号')} width="min(460px,92vw)"
      actions=${html`<${Button} onClick=${onClose}>${t('关闭')}<//>`}>
    ${account ? html`
      <div class="acc-head">
        <img class="acc-avatar" src=${account.avatar} alt="" width="56" height="56" loading="lazy" />
        <div><b>${account.qq}</b><div class="acc-dim">${t('布阵占用')} ${(account.lineup?.used / 1024 ** 2).toFixed(1)} MiB / ${(account.lineup?.quota / 1024 ** 3).toFixed(0)} GiB</div></div>
      </div>
      <label class="acc-row"><span>${t('昵称')}</span><input value=${name} maxlength="24" onInput=${(e) => setName(e.currentTarget.value)} /></label>
      <label class="acc-row"><span>${t('昵称颜色')}</span><input type="color" value=${color || '#e6e9ef'} onInput=${(e) => setColor(e.currentTarget.value)} /></label>
      <div class="acc-actions"><${Button} onClick=${save} disabled=${busy}>${t('保存')}<//><${Button} onClick=${logout} disabled=${busy}>${t('退出登录')}<//></div>
    ` : html`
      <p class="acc-dim">${t('用 QQ 号登录；第一次绑定会以此密码建号，之后默认保留登录。')}</p>
      <label class="acc-row"><span>${t('QQ 号')}</span><input value=${qq} inputmode="numeric" maxlength="12" onInput=${(e) => setQq(e.currentTarget.value)} /></label>
      <label class="acc-row"><span>${t('密码')}</span><input type="password" value=${pw} maxlength="64" onInput=${(e) => setPw(e.currentTarget.value)} /></label>
      <label class="acc-row"><span>${t('确认密码')}</span><input type="password" value=${pw2} maxlength="64" placeholder=${t('首次绑定才需要')} onInput=${(e) => setPw2(e.currentTarget.value)} /></label>
      <div class="acc-actions"><${Button} onClick=${submit} disabled=${busy}>${pw2 ? t('绑定并登录') : t('登录')}<//></div>
    `}
    ${err ? html`<p class="acc-err">${err}</p>` : null}
  <//>`;
}

export function AnnouncementModal({ open, onClose }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    call('/api/announcements').then((r) => { if (live) setItems(Array.isArray(r.items) ? r.items : []); }).catch(() => setItems([]));
    return () => { live = false; };
  }, [open]);
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('公告')} width="min(620px,92vw)"
      actions=${html`<${Button} onClick=${onClose}>${t('关闭')}<//>`}>
    ${items === null ? html`<p class="acc-dim">${t('加载中…')}</p>`
      : items.length === 0 ? html`<p class="acc-dim">${t('暂无公告')}</p>`
        : html`<ul class="acc-ann">${items.map((it, i) => html`<li key=${it.id || i}>
            <div class="acc-ann__t">${it.title || ''}<span class="acc-dim">${it.date || ''}</span></div>
            <div class="acc-ann__b">${it.body || ''}</div>
          </li>`)}</ul>`}
  <//>`;
}

/**
 * 首页登录卡里的账号条（业主 2026-11-01：入口要显眼，不做小 chip）。
 * 未登录：整行「账号登录 / 绑定」；已登录：QQ 头像 + 昵称 + 「切换账号」。
 * 账号不强制——游客直接输代号点开始即可，绑定只是可选。
 */
export function AccountBar({ account = null, onAccount }) {
  const [open, setOpen] = useState(false);
  const [annOpen, setAnnOpen] = useState(false);
  const [hasAnn, setHasAnn] = useState(false);
  useEffect(() => {
    ensureStyle();
    call('/api/announcements').then((r) => setHasAnn((r.items || []).length > 0)).catch(() => {});
  }, []);

  const modal = html`<${AccountModal} open=${open} onClose=${() => setOpen(false)}
      onChanged=${(a) => { setOpen(false); onAccount?.(a); }} />`;
  const annModal = html`<${AnnouncementModal} open=${annOpen} onClose=${() => setAnnOpen(false)} />`;

  if (!account) {
    return html`<div class="title-account-bar-row">
      <button type="button" class="title-account-bar" onClick=${() => setOpen(true)} title=${t('用 QQ 号登录或绑定账号')}>
        <${Icon} name="user" class="title-account-bar__icon" />
        <span>${t('账号登录 / 绑定')}</span>
      </button>
      ${hasAnn ? html`<button type="button" class="title-account-bar title-account-bar--ann" onClick=${() => setAnnOpen(true)}>${t('公告')}</button>` : null}
      ${modal}${annModal}
    </div>`;
  }
  return html`<div class="title-account-bar-row">
    <div class="title-account-bar title-account-bar--in">
      <img class="title-account-bar__avatar" src=${account.avatar} alt="" width="26" height="26" loading="lazy" />
      <span class="title-account-bar__name">${account.name || account.qq}</span>
      <${Button} variant="ghost" size="sm" onClick=${() => setOpen(true)}>${t('切换账号')}<//>
    </div>
    ${hasAnn ? html`<button type="button" class="title-account-bar title-account-bar--ann" onClick=${() => setAnnOpen(true)}>${t('公告')}</button>` : null}
    ${modal}${annModal}
  </div>`;
}

/**
 * 旧的全屏悬浮 dock：已停用（业主 2026-11-01「入口挂首页、不要悬浮窗」）。
 * 插件 `main.js` 仍然 `render(html\`<${App}/><${AccountDock}/>\`)`，所以这个导出必须留着。
 */
export function AccountDock() {
  useEffect(() => { ensureStyle(); }, []);
  return null;
}
