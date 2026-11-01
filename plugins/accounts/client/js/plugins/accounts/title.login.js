// plugins/accounts/client/js/plugins/accounts/title.login.js — 首页登录卡的账号入口（ui 插件 · 模块形态）。
//
// 宿主：public/js/ui/pluginSlots.js 把本模块 import 进来并调用 mount(el)。
// 口径（业主 2026-11-01）：QQ 号就是账号、头像调 QQ 头像 API（不存图）、密码两次输入、登录默认保留；
// **账号不强制**——不登录照样输代号开局，入口只是可选。
//
// 本模块可以用同源模块的方式写，是因为宿主把「ui 插件的 code.client 模块」当应用路径下发
// （server/boot-main.js 的 clientOverlay 按 status==='loaded' 收集，不分类别）。

const TOKEN_KEY = 'sp.accountToken';
const NAME_KEY = 'sp.name';

const en = () => document.documentElement.getAttribute('data-script') === 'alphabetic';
const say = (zh, eng) => (en() ? eng : zh);

const ERRORS = {
  BAD_QQ: () => say('QQ 号看起来不对（5–12 位数字）', 'That does not look like a QQ number (5–12 digits)'),
  BAD_PASSWORD: () => say('密码要 6–64 位，且首尾不能是空格', 'The password is 6–64 characters with no leading or trailing space'),
  BAD_CREDENTIALS: () => say('QQ 号或密码不对', 'Wrong QQ number or password'),
  EXISTS: () => say('这个 QQ 号已经注册过了，直接登录即可', 'That QQ number is already registered — just sign in'),
  NO_GUEST_SESSION: () => say('当前没有可绑定的游客会话，请刷新页面后重试', 'No guest session to link — reload the page and try again'),
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

/** 登录后把首页的代号输入框同步成账号昵称（应用是受控输入，派发 input 事件让它自己更新状态）。 */
function applyName(name) {
  if (!name) return;
  try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ }
  const input = document.querySelector('.title-login input');
  if (input && input.value !== name) {
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

let styled = false;
function ensureStyle() {
  if (styled || document.getElementById('sp-accounts-style')) { styled = true; return; }
  styled = true;
  const st = document.createElement('style');
  st.id = 'sp-accounts-style';
  st.textContent = `
    .sp-acc-bar{display:flex;align-items:center;justify-content:center;gap:.1rem;width:100%;min-height:.56rem;padding:0 .16rem;
      border:1px solid var(--line-2,rgba(255,255,255,.18));background:rgba(10,13,12,.72);color:var(--text-hi,#e6e9ef);
      font:inherit;font-size:calc(.18 * var(--t,11));letter-spacing:.04em;cursor:pointer}
    .sp-acc-bar:hover,.sp-acc-bar:focus-visible{border-color:var(--mint-500,#7fd1b0);color:#fff}
    .sp-acc-bar--in{cursor:default;justify-content:flex-start;gap:.12rem}
    .sp-acc-bar--in:hover{border-color:var(--line-2,rgba(255,255,255,.18));color:var(--text-hi,#e6e9ef)}
    .sp-acc-bar img{width:.3rem;height:.3rem;border-radius:50%;flex:none}
    .sp-acc-bar b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
    .sp-acc-bar small{flex:none;color:var(--text-lo,#8b93a1);font-size:calc(.12 * var(--t,11))}
    .sp-acc-hint{margin:.06rem 0 0;color:var(--text-lo,#8b93a1);font-size:calc(.12 * var(--t,11));text-align:center}
    .sp-acc-mask{position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.62)}
    .sp-acc-card{width:min(460px,92vw);padding:18px 20px;background:#11161b;color:#e6e9ef;border:1px solid #2f3745;
      box-shadow:0 .2rem .5rem rgba(0,0,0,.5);font-size:14px;line-height:1.5}
    .sp-acc-card h3{margin:0 0 10px;font-size:16px;font-weight:600}
    .sp-acc-row{display:flex;gap:10px;align-items:center;margin:8px 0}
    .sp-acc-row span{width:84px;flex:none;color:#aab2c0}
    .sp-acc-row input{flex:1;min-width:0;padding:7px 9px;border-radius:6px;border:1px solid #2f3745;background:#0e1116;color:#e6e9ef;font:inherit}
    .sp-acc-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
    .sp-acc-acts button{padding:7px 14px;border-radius:6px;border:1px solid #2f3745;background:#1a2129;color:#e6e9ef;font:inherit;cursor:pointer}
    .sp-acc-acts button[data-primary]{background:#17f9b7;border-color:#17f9b7;color:#06110d;font-weight:600}
    .sp-acc-acts button:disabled{opacity:.55;cursor:default}
    .sp-acc-err{margin:10px 0 0;color:#ff8a80}
    .sp-acc-head{display:flex;gap:12px;align-items:center;margin-bottom:12px}
    .sp-acc-head img{border-radius:50%}
    .sp-acc-dim{color:#8b93a1;font-size:12px}`;
  document.head.appendChild(st);
}

/**
 * 渲染入口条；返回一个恢复函数给宿主的 unmount 用。
 * @param {HTMLElement} host
 */
export async function mount(host) {
  ensureStyle();
  let account = null;
  let mask = null;
  let destroyed = false;

  const token = readToken();
  if (token) {
    const r = await call('/api/account/me', { token });
    if (r.ok) account = r.account;
    else writeToken('');
  }
  if (destroyed) return;

  const bar = document.createElement('div');
  host.replaceChildren(bar);

  const render = () => {
    bar.replaceChildren();
    bar.className = account ? 'sp-acc-bar sp-acc-bar--in' : 'sp-acc-bar';
    if (!account) {
      bar.setAttribute('role', 'button');
      bar.tabIndex = 0;
      const icon = document.createElement('span');
      icon.textContent = '👤';
      const label = document.createElement('span');
      label.textContent = say('账号登录 / 绑定', 'Sign in / link account');
      bar.append(icon, label);
      const open = () => openModal(null);
      bar.onclick = open;
      bar.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
      const hint = document.createElement('p');
      hint.className = 'sp-acc-hint';
      hint.textContent = say('不登录也能直接开始（游客）', 'You can start without signing in (guest)');
      host.replaceChildren(bar, hint);
      return;
    }
    const img = document.createElement('img');
    img.src = account.avatar || '';
    img.alt = '';
    img.loading = 'lazy';
    const name = document.createElement('b');
    name.textContent = account.name || account.qq;
    const tag = document.createElement('small');
    tag.textContent = say('QQ 账号', 'QQ account');
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.textContent = say('账号', 'Account');
    sw.style.cssText = 'flex:none;padding:2px 8px;border:1px solid #2f3745;border-radius:4px;background:#1a2129;color:inherit;font:inherit;cursor:pointer';
    sw.onclick = () => openModal(account);
    bar.append(img, name, tag, sw);
    const hint = document.createElement('p');
    hint.className = 'sp-acc-hint';
    hint.textContent = say('代号已同步为账号昵称', 'Your callsign follows your account name');
    host.replaceChildren(bar, hint);
  };

  const closeModal = () => { mask?.remove(); mask = null; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') closeModal(); };

  const openModal = (current) => {
    closeModal();
    mask = document.createElement('div');
    mask.className = 'sp-acc-mask';
    const card = document.createElement('div');
    card.className = 'sp-acc-card';
    mask.appendChild(card);
    mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(mask);

    let busy = false;
    const err = document.createElement('p');
    err.className = 'sp-acc-err';

    const finish = (acc) => {
      writeToken(acc.token || readToken());
      account = acc;
      closeModal();
      render();
      applyName(acc.name);
    };

    if (current) {
      card.innerHTML = `<h3>${say('账号', 'Account')}</h3>`;
      const head = document.createElement('div');
      head.className = 'sp-acc-head';
      const avatar = document.createElement('img');
      avatar.src = current.avatar || '';
      avatar.width = 56; avatar.height = 56; avatar.alt = '';
      const who = document.createElement('div');
      who.innerHTML = `<b></b><div class="sp-acc-dim"></div>`;
      who.querySelector('b').textContent = current.qq;
      who.querySelector('.sp-acc-dim').textContent = say('布阵占用 ', 'Lineup used ')
        + `${((current.lineup?.used || 0) / 1024 ** 2).toFixed(1)} MiB / ${((current.lineup?.quota || 0) / 1024 ** 3).toFixed(0)} GiB`;
      head.append(avatar, who);

      const nameRow = field(say('昵称', 'Nickname'), 'text', current.name || '', 24);
      const colorRow = field(say('昵称颜色', 'Name colour'), 'color', current.nameStyle?.color || '#e6e9ef', 32);
      const acts = document.createElement('div');
      acts.className = 'sp-acc-acts';
      const saveBtn = button(say('保存', 'Save'), true);
      const outBtn = button(say('退出登录', 'Sign out'), false);
      acts.append(saveBtn, outBtn);
      card.append(head, nameRow.row, colorRow.row, err, acts);

      saveBtn.onclick = async () => {
        if (busy) return;
        busy = true; saveBtn.disabled = true; err.textContent = '';
        try {
          const r = await call('/api/account/profile', {
            method: 'POST',
            body: { name: nameRow.input.value.trim(), nameStyle: colorRow.input.value ? { color: colorRow.input.value } : null },
            token: readToken(),
          });
          if (!r.ok) { err.textContent = (ERRORS[r.error] || (() => r.error || say('保存失败', 'Could not save')))(); return; }
          account = r.account; closeModal(); render(); applyName(r.account.name);
        } finally { busy = false; saveBtn.disabled = false; }
      };
      outBtn.onclick = () => { writeToken(''); account = null; closeModal(); render(); };
      return;
    }

    card.innerHTML = `<h3>${say('账号登录 / 绑定', 'Sign in / link account')}</h3>
      <p class="sp-acc-dim">${say('用 QQ 号登录；第一次绑定会以此密码建号，之后默认保留登录。',
        'Sign in with your QQ number. The first time, this password creates the account; afterwards you stay signed in.')}</p>`;
    const qqRow = field(say('QQ 号', 'QQ number'), 'text', '', 12, 'numeric');
    const pwRow = field(say('密码', 'Password'), 'password', '', 64);
    const pw2Row = field(say('确认密码', 'Confirm'), 'password', '', 64, null, say('首次绑定才需要', 'only when linking'));
    const acts = document.createElement('div');
    acts.className = 'sp-acc-acts';
    const goBtn = button(say('登录', 'Sign in'), true);
    const cancelBtn = button(say('关闭', 'Close'), false);
    acts.append(goBtn, cancelBtn);
    card.append(qqRow.row, pwRow.row, pw2Row.row, err, acts);
    cancelBtn.onclick = closeModal;

    goBtn.onclick = async () => {
      if (busy) return;
      const qq = qqRow.input.value.trim();
      const password = pwRow.input.value;
      const password2 = pw2Row.input.value;
      if (password2 && password !== password2) { err.textContent = say('两次输入的密码不一致', 'The two passwords differ'); return; }
      busy = true; goBtn.disabled = true; err.textContent = '';
      try {
        const r = password2
          ? await call('/api/auth/bind', { method: 'POST', body: { qq, password } })
          : await call('/api/auth/login', { method: 'POST', body: { qq, password } });
        if (!r.ok) { err.textContent = (ERRORS[r.error] || (() => r.error || say('操作失败', 'Failed')))(); return; }
        writeToken(r.token);
        finish(r.account);
      } finally { busy = false; goBtn.disabled = false; }
    };
    card.querySelector('input')?.focus();
  };

  render();
  // 公告（/api/announcements，管理后台写）：有条目才多一个入口，撤掉核心 dock 后这个能力不能丢
  call('/api/announcements').then((r) => {
    const items = Array.isArray(r.items) ? r.items : [];
    if (destroyed || !items.length) return;
    const link = document.createElement('button');
    link.type = 'button';
    link.textContent = say('公告', 'Notices');
    link.style.cssText = 'margin-top:.06rem;background:none;border:0;color:var(--mint-500,#7fd1b0);font:inherit;font-size:calc(.13 * var(--t,11));cursor:pointer';
    link.onclick = () => openNotices(items);
    host.appendChild(link);
  }).catch(() => {});

  const openNotices = (items) => {
    closeModal();
    mask = document.createElement('div');
    mask.className = 'sp-acc-mask';
    const card = document.createElement('div');
    card.className = 'sp-acc-card';
    card.style.width = 'min(620px,92vw)';
    const h = document.createElement('h3');
    h.textContent = say('公告', 'Notices');
    card.appendChild(h);
    for (const it of items) {
      const box = document.createElement('div');
      box.style.cssText = 'padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)';
      const title = document.createElement('div');
      title.style.cssText = 'display:flex;justify-content:space-between;gap:10px;font-weight:600';
      const t1 = document.createElement('span'); t1.textContent = it.title || '';
      const t2 = document.createElement('span'); t2.className = 'sp-acc-dim'; t2.textContent = it.date || '';
      title.append(t1, t2);
      const body = document.createElement('div');
      body.style.cssText = 'white-space:pre-wrap;color:#c8cdd6;margin-top:4px';
      body.textContent = it.body || '';
      box.append(title, body);
      card.appendChild(box);
    }
    const acts = document.createElement('div');
    acts.className = 'sp-acc-acts';
    const close = button(say('关闭', 'Close'), false);
    close.onclick = closeModal;
    acts.appendChild(close);
    card.appendChild(acts);
    mask.appendChild(card);
    mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(mask);
  };

  host.__spAccountsCleanup = () => { destroyed = true; closeModal(); };
}

/** 宿主在槽位消失时调用。 */
export function unmount(host) {
  try { host.__spAccountsCleanup?.(); } catch { /* already gone */ }
  host.replaceChildren();
}

// ── 小工具 ─────────────────────────────────────────────────────────────────
function field(label, type, value, maxLength, inputmode, placeholder) {
  const row = document.createElement('label');
  row.className = 'sp-acc-row';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.maxLength = maxLength;
  if (inputmode) input.inputMode = inputmode;
  if (placeholder) input.placeholder = placeholder;
  row.append(span, input);
  return { row, input };
}

function button(text, primary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (primary) b.dataset.primary = '1';
  return b;
}
