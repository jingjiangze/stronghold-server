// public/js/ui/account.js — 账号入口（P2，业主 2026-11-01）。
//
// 口径：QQ 号就是账号、头像直接调 QQ 头像 API（不存图）、游客可绑定、密码自己设（**两次输入**）、
// 登录默认保留（令牌存 localStorage）。公告来自服务端 /api/announcements（管理后台写）。
//
// 2026-11-01 追加（业主）：「账号入口挂在首页，而不是悬浮窗」——入口组件 `AccountEntry` / `AnnouncementEntry`
// 由首页（`plugins/mota/client/js/screens/title.js` 右上工具行）渲染；底部悬浮 dock 已撤掉。
//
// 这个文件在核心 public/js 下；插件里用 `../ui/account.js` 引它时，运行时回退到这里
// （插件只覆盖 code.client 列出的文件，ui/account.js 不在其中）。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
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

/** 一次性把入口需要的样式塞进 head（不依赖任何插件 CSS）。 */
let styled = false;
function ensureStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  if (document.getElementById('sp-acc-style')) return;
  const st = document.createElement('style');
  st.id = 'sp-acc-style';
  st.textContent = `
    .title-account{display:inline-flex;align-items:center;gap:6px}
    .title-account__avatar{width:18px;height:18px;border-radius:50%;vertical-align:-4px}
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

export function AccountModal({ open, onClose, onChanged }) {
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
      if (r.ok) { setAccount(r.account); setName(r.account.name || ''); setColor(r.account.nameStyle?.color || ''); }
      else { writeToken(''); setToken(''); }
    });
    return () => { live = false; };
  }, [open, token]);

  const submit = async () => {
    setErr('');
    if (pw2 && pw !== pw2) { setErr(t('两次输入的密码不一致')); return; }
    setBusy(true);
    try {
      // 填了确认密码 = 建号/绑定；只填密码 = 登录。bind 不依赖 WS 会话（服务端已放开）。
      const r = pw2
        ? await call('/api/auth/bind', { method: 'POST', body: { qq, password: pw } })
        : await call('/api/auth/login', { method: 'POST', body: { qq, password: pw } });
      if (!r.ok) { setErr((ERR[r.error] || (() => r.error || t('操作失败')))()); return; }
      writeToken(r.token); setToken(r.token); setAccount(r.account);
      setName(r.account.name || ''); setColor(r.account.nameStyle?.color || '');
      setPw(''); setPw2(''); onChanged?.(r.account);
    } finally { setBusy(false); }
  };

  const save = async () => {
    setErr(''); setBusy(true);
    try {
      const body = { name: name.trim(), nameStyle: color ? { color } : null };
      const r = await call('/api/account/profile', { method: 'POST', body, token });
      if (!r.ok) { setErr((ERR[r.error] || (() => r.error || t('保存失败')))()); return; }
      setAccount(r.account); onChanged?.(r.account);
    } finally { setBusy(false); }
  };

  const logout = () => { writeToken(''); setToken(''); setAccount(null); onChanged?.(null); };

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

/** 首页右上角的账号入口（登录后显示 QQ 头像 + 昵称）。 */
export function AccountEntry() {
  ensureStyle();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(null);
  useEffect(() => {
    const token = readToken();
    if (!token) return;
    call('/api/account/me', { token }).then((r) => { if (r.ok) setAccount(r.account); });
  }, []);
  return html`<${Button} variant="ghost" size="sm" icon="user" class="title-account" onClick=${() => setOpen(true)} title=${t('账号')}>
      ${account ? html`<img class="title-account__avatar" src=${account.avatar} alt="" width="18" height="18" />${account.name || account.qq}` : t('账号')}
    <//>
    <${AccountModal} open=${open} onClose=${() => setOpen(false)} onChanged=${setAccount} />`;
}

/** 首页的公告入口（没有公告时什么都不渲染）。 */
export function AnnouncementEntry() {
  ensureStyle();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  useEffect(() => { call('/api/announcements').then((r) => setCount((r.items || []).length)).catch(() => {}); }, []);
  if (!count) return null;
  return html`<${Button} variant="ghost" size="sm" icon="info" class="title-announce" onClick=${() => setOpen(true)} title=${t('公告')}>${t('公告')}<//>
    <${AnnouncementModal} open=${open} onClose=${() => setOpen(false)} />`;
}
