// plugins/accounts/client/js/plugins/accounts/title.login.js — 首页登录卡的账号入口（ui 插件 · 模块形态）。
//
// 宿主：public/js/ui/pluginSlots.js 把它 import 进来并调用 mount(el)。
//
// 口径（业主 2026-11-01/02）：
//   * QQ 号就是账号、头像调 QQ 头像 API（不存图）、密码两次输入、登录默认保留；
//   * **账号不强制**——不登录照样输代号开局；
//   * **点头像 = 打开名片**（昵称 / 昵称颜色），保存走 /api/account/profile 同步到服务器；
//   * 面板一律用站点的 Modal / Button / 字段类与主题变量，不再自带一套硬编码颜色（与 public/css/theme.css 一致）。
//
// 这个模块是**同源模块**：server/boot-main.js 的 clientOverlay 把 code.client 的文件按应用路径下发，
// 所以可以直接 import `/js/ui/components.js`（站点组件）与 `/vendor/*`（preact/hooks）。

import { render } from '/vendor/preact.module.js';
import { useEffect, useState } from '/vendor/hooks.module.js';
import { html, Button, Modal, Icon } from '/js/ui/components.js';
import { net } from '/js/net.js';

const TOKEN_KEY = 'sp.accountToken';
const NAME_KEY = 'sp.name';

const en = () => document.documentElement.getAttribute('data-script') === 'alphabetic';
const say = (zh, eng) => (en() ? eng : zh);

const ERRORS = {
  BAD_QQ: () => say('QQ 号看起来不对（5–12 位数字）', 'That does not look like a QQ number (5–12 digits)'),
  BAD_PASSWORD: () => say('密码要 6–64 位，且首尾不能是空格', 'The password is 6–64 characters, no leading or trailing space'),
  BAD_CREDENTIALS: () => say('QQ 号或密码不对', 'Wrong QQ number or password'),
  EXISTS: () => say('这个 QQ 号已经注册过了，直接登录即可', 'That QQ number is already registered — just sign in'),
  NO_GUEST_SESSION: () => say('当前没有可绑定的游客会话，请刷新页面后重试', 'No guest session to link — reload and try again'),
  TOO_LARGE: () => say('内容太长', 'Too long'),
  UNAUTHORIZED: () => say('登录已过期，请重新登录', 'The sign-in expired — sign in again'),
};

const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const writeToken = (v) => { try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

async function call(path, { method = 'GET', body = null, token = '' } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...data };
}

/** 把昵称回填到首页代号（受控输入，派发 input 让应用自己更新状态）并记到 sp.name。 */
function applyName(name) {
  if (!name) return;
  try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ }
  const input = document.querySelector('.title-login input');
  if (input && input.value !== name) {
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** 站点字段外观（label 在上、框在下，`.field__box brackets` 画四角括线）；支持 password，站点 TextField 没有。 */
function Field({ label, micro, type = 'text', value, onInput, maxLength, placeholder, inputMode, autofocus, hint }) {
  return html`<label class="field field--lg">
    ${label || micro ? html`<span class="field__label">${label}${micro ? html`<span class="micro">${micro}</span>` : null}</span>` : null}
    <span class="field__box brackets">
      <input class="field__input" type=${type} value=${value} maxLength=${maxLength} placeholder=${placeholder}
        inputMode=${inputMode} autocomplete="off" spellcheck=${false}
        data-autofocus=${autofocus ? '' : undefined} onInput=${(e) => onInput(e.currentTarget.value)} />
    </span>
    ${hint ? html`<span class="field__hint">${hint}</span>` : null}
  </label>`;
}

function Avatar({ account, size = 26 }) {
  return html`<img class="title-account-bar__avatar" src=${account?.avatar || ''} alt="" width=${size} height=${size} loading="lazy" />`;
}

function AccountPanel({ account, mode, onClose, onAccount, onSignedOut }) {
  const [qq, setQq] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [name, setName] = useState(account?.name || '');
  const [color, setColor] = useState(account?.nameStyle?.color || '#4ed8af');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const [notices, setNotices] = useState(null);

  useEffect(() => {
    setName(account?.name || '');
    setColor(account?.nameStyle?.color || '#4ed8af');
    setErr(''); setSaved('');
  }, [account, mode]);

  useEffect(() => {
    if (mode !== 'notices' || notices) return undefined;
    let live = true;
    call('/api/announcements')
      .then((r) => { if (live) setNotices(Array.isArray(r.items) ? r.items : []); })
      .catch(() => { if (live) setNotices([]); });
    return () => { live = false; };
  }, [mode, notices]);

  const signIn = async () => {
    setErr(''); setSaved('');
    if (pw2 && pw !== pw2) { setErr(say('两次输入的密码不一致', 'The two passwords differ')); return; }
    setBusy(true);
    try {
      const r = pw2
        ? await call('/api/auth/bind', { method: 'POST', body: { qq, password: pw } })
        : await call('/api/auth/login', { method: 'POST', body: { qq, password: pw } });
      if (!r.ok) { setErr((ERRORS[r.error] || (() => r.error || say('操作失败', 'Failed')))()); return; }
      writeToken(r.token);
      setPw(''); setPw2('');
      onAccount(r.account);
      applyName(r.account.name);
    } finally { setBusy(false); }
  };

  const saveProfile = async () => {
    setErr(''); setSaved('');
    const trimmed = name.trim();
    if (trimmed.length > 24) { setErr(say('昵称最多 24 字', 'At most 24 characters')); return; }
    setBusy(true);
    try {
      const r = await call('/api/account/profile', {
        method: 'POST',
        body: { name: trimmed, nameStyle: { color } },
        token: readToken(),
      });
      if (!r.ok) { setErr((ERRORS[r.error] || (() => r.error || say('保存失败', 'Could not save')))()); return; }
      onAccount(r.account);
      applyName(r.account.name);
      // 已经在局/厅里时把会话名也改掉：net.setName 走 repeated hello，服务端会把 session.name 换掉并
      // resync（大厅房内会广播新名字；对局中不广播，等这局结束）。没有活连接时它什么都不做。
      try { if (net?.status === 'online' && net.playerId) net.setName(r.account.name || ''); } catch { /* 尽力而为 */ }
      setSaved(say('已保存到服务器', 'Saved to the server'));
    } finally { setBusy(false); }
  };

  const signOut = () => { writeToken(''); onSignedOut(); };

  if (mode === 'notices') {
    return html`<${Modal} open title=${say('公告', 'Notices')} micro="NOTICES" width="min(640px,94vw)"
        onClose=${onClose} actions=${html`<${Button} variant="primary" onClick=${onClose}>${say('关闭', 'Close')}<//>`}>
      ${notices === null ? html`<p class="modal__text">${say('加载中…', 'Loading…')}</p>`
        : notices.length === 0 ? html`<p class="modal__text">${say('暂无公告', 'No notices yet')}</p>`
          : html`<div class="notice-list">${notices.map((it, i) => html`<article class="notice-card" key=${it.id || i}>
              <div class="notice-card__meta"><span class="notice-card__title">${it.title || ''}</span><span class="t-dim">${it.date || ''}</span></div>
              <div class="notice-card__body">${it.body || ''}</div>
            </article>`)}</div>`}
    <//>`;
  }

  if (!account) {
    return html`<${Modal} open title=${say('账号登录 / 绑定', 'Sign in / link account')} micro="ACCOUNT" width="min(460px,94vw)"
        onClose=${onClose}
        actions=${html`
          <${Button} variant="secondary" onClick=${onClose}>${say('关闭', 'Close')}<//>
          <${Button} variant="primary" disabled=${busy} onClick=${signIn}>${pw2 ? say('绑定并登录', 'Link and sign in') : say('登录', 'Sign in')}<//>`}>
      <p class="modal__text">${say('用 QQ 号登录；第一次绑定会以此密码建号，之后默认保留登录。',
        'Sign in with your QQ number. The first time, this password creates the account; afterwards you stay signed in.')}</p>
      <div class="acc-form">
        <${Field} label=${say('QQ 号', 'QQ number')} value=${qq} maxLength=${12} inputMode="numeric" autofocus onInput=${setQq} />
        <${Field} label=${say('密码', 'Password')} type="password" value=${pw} maxLength=${64} onInput=${setPw} />
        <${Field} label=${say('确认密码', 'Confirm password')} type="password" value=${pw2} maxLength=${64}
          placeholder=${say('首次绑定才需要', 'only when linking')} onInput=${setPw2} />
      </div>
      ${err ? html`<p class="acc-err t-red">${err}</p>` : null}
    <//>`;
  }

  return html`<${Modal} open title=${say('名片', 'Profile card')} micro="CALLSIGN" width="min(480px,94vw)"
      onClose=${onClose}
      actions=${html`
        <${Button} variant="ghost" onClick=${signOut} disabled=${busy}>${say('退出登录', 'Sign out')}<//>
        <${Button} variant="primary" onClick=${saveProfile} disabled=${busy}>${say('保存', 'Save')}<//>`}>
    <div class="acc-head">
      <${Avatar} account=${account} size=${56} />
      <div>
        <b>${account.qq}</b>
        <div class="t-dim">${say('布阵占用', 'Lineup used')} ${((account.lineup?.used || 0) / 1024 ** 2).toFixed(1)} MiB / ${((account.lineup?.quota || 0) / 1024 ** 3).toFixed(0)} GiB</div>
      </div>
    </div>
    <div class="acc-form">
      <${Field} label=${say('昵称', 'Nickname')} micro="NAME" value=${name} maxLength=${24}
        placeholder=${say('留空就用 QQ 号', 'Empty: your QQ number')} onInput=${setName} />
      <label class="field">
        <span class="field__label">${say('昵称颜色', 'Name colour')}</span>
        <span class="field__box brackets acc-color">
          <input class="field__input acc-color__input" type="color" value=${color} onInput=${(e) => setColor(e.currentTarget.value)} />
          <span class="acc-color__preview" style=${`color:${color}`}>${name || account.qq}</span>
        </span>
      </label>
    </div>
    ${err ? html`<p class="acc-err t-red">${err}</p>` : null}
    ${saved ? html`<p class="acc-ok t-mint">${saved}</p>` : null}
  <//>`;
}

function AccountSlot() {
  const [account, setAccount] = useState(null);
  const [mode, setMode] = useState(null); // null | 'signin' | 'profile' | 'notices'
  const [hasNotices, setHasNotices] = useState(false);

  useEffect(() => {
    let live = true;
    const token = readToken();
    if (token) {
      call('/api/account/me', { token }).then((r) => { if (!live) return; if (r.ok) setAccount(r.account); else writeToken(''); });
    }
    call('/api/announcements').then((r) => { if (live) setHasNotices((r.items || []).length > 0); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const row = account
    ? html`<div class="title-account-bar title-account-bar--in">
        <button type="button" class="title-account-bar__avatar-btn" title=${say('编辑名片', 'Edit profile card')}
          aria-label=${say('编辑名片', 'Edit profile card')} onClick=${() => setMode('profile')}>
          <${Avatar} account=${account} />
        </button>
        <span class="title-account-bar__name">${account.name || account.qq}</span>
        <${Button} variant="ghost" size="sm" onClick=${() => setMode('profile')}>${say('名片', 'Profile')}<//>
      </div>`
    : html`<button type="button" class="title-account-bar" onClick=${() => setMode('signin')}>
        <${Icon} name="user" class="title-account-bar__icon" />
        <span>${say('账号登录 / 绑定', 'Sign in / link account')}</span>
      </button>`;

  return html`<div class="title-account-bar-row">
    ${row}
    ${hasNotices
      ? html`<button type="button" class="title-account-bar title-account-bar--ann" onClick=${() => setMode('notices')}>${say('公告', 'Notices')}</button>`
      : null}
    ${!account ? html`<p class="acc-hint">${say('不登录也能直接开始（游客）', 'You can start as a guest without signing in')}</p>` : null}
    ${mode ? html`<${AccountPanel} account=${account} mode=${mode} onClose=${() => setMode(null)}
        onAccount=${(a) => { setAccount(a); setMode('profile'); }}
        onSignedOut=${() => { setAccount(null); setMode(null); }} />` : null}
  </div>`;
}

export function mount(host) {
  render(html`<${AccountSlot} />`, host);
}

export function unmount(host) {
  render(null, host);
  host.replaceChildren();
}
