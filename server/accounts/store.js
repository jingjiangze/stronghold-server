// server/accounts/store.js — 极简账号库 (业主 2026-11-01)：QQ 号当登录名、头像走 QQ 头像 API（不存图）、
// 密码自己设、游客可绑定；服务端只存「口令哈希 + 名片/昵称样式 + 布阵数据用量」这几项，别的都不留。
//
// 存储纪律（「尽可能少存」）：
//   * 一个 append-only 的 JSONL（`data/accounts.jsonl`），每行一条 upsert，加载时后写覆盖先写；
//     行数超过 2× 账号数时压缩一次（重写到 `.tmp` 再 rename）。
//   * 不用数据库：这台 2C4G 的盒子不该多一个常驻 DB 进程，账号量级是「几十到几千」。
//   * 会话令牌是**无状态** HMAC（`<qq>.<exp>.<sig>`），密钥落在 `data/.account-secret`（32 字节，0600）——
//     服务端不为登录态存任何东西，重启也不掉线。
//
// 字段：qq（登录名，5–12 位数字）/ hash（scrypt）/ created / updated / profile{name,nameStyle,card} / lineupBytes。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 每个账号的布阵数据容量（业主：20G 是布阵数据的容量）。 */
export const DEFAULT_LINEUP_QUOTA_BYTES = 20 * 1024 ** 3;

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32 });
const QQ_RE = /^[1-9][0-9]{4,11}$/;
const PROFILE_MAX = 1024; // 名片/昵称样式这类展示记录的总字节上限
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** `$scrypt$N$r$p$salt$key` — the only form the store ever writes. */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `$scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Constant-time check against a stored hash. */
function checkPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 7 || parts[1] !== 'scrypt') return false;
    const [, , N, r, p, saltHex, keyHex] = parts;
    const key = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), keyHex.length / 2, { N: Number(N), r: Number(r), p: Number(p) });
    const want = Buffer.from(keyHex, 'hex');
    return key.length === want.length && crypto.timingSafeEqual(key, want);
  } catch { return false; }
}

/** A QQ number is the login name; anything else is rejected before it reaches the file. */
export function normalizeQq(qq) {
  const s = String(qq ?? '').trim();
  return QQ_RE.test(s) ? s : null;
}

/** Passwords: 6–64 chars, no leading/trailing-space surprises. */
export function normalizePassword(pw) {
  const s = typeof pw === 'string' ? pw : '';
  return s.length >= 6 && s.length <= 64 && s.trim() === s ? s : null;
}

/**
 * Open (or create) the account store.
 * @param {{ dataDir: string, log?: object, quotaBytes?: number, now?: () => number }} o
 */
export function openAccounts({ dataDir, log = console, quotaBytes = Number(process.env.SP_ACCOUNT_LINEUP_QUOTA_BYTES) || DEFAULT_LINEUP_QUOTA_BYTES, now = Date.now }) {
  const file = path.join(dataDir, 'accounts.jsonl');
  const secretFile = path.join(dataDir, '.account-secret');
  /** @type {Map<string, any>} qq → account (no hash in memory lists; hash kept here for login) */
  const byQq = new Map();
  let lines = 0;

  const secret = (() => {
    try {
      const raw = fs.readFileSync(secretFile);
      if (raw.length >= 32) return raw.subarray(0, 32);
    } catch { /* first boot */ }
    const made = crypto.randomBytes(32);
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(secretFile, made, { mode: 0o600 }); } catch (e) { log.warn?.('[accounts] cannot persist the token secret', e?.message); }
    return made;
  })();

  function apply(row) {
    if (!row || typeof row.qq !== 'string') return;
    const prev = byQq.get(row.qq);
    byQq.set(row.qq, { ...(prev || {}), ...row });
  }

  try {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      lines++;
      try { apply(JSON.parse(line)); } catch { log.warn?.('[accounts] skipping a malformed line'); }
    }
  } catch (e) { log.warn?.('[accounts] cannot read the store', e?.message); }

  function append(row) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
    lines++;
    // Compaction: one rewrite once the journal is twice the live set (cheap at this scale, keeps the file honest).
    if (lines > byQq.size * 2 + 32) {
      const tmp = `${file}.tmp`;
      const body = [...byQq.values()].map((a) => JSON.stringify(a)).join('\n');
      fs.writeFileSync(tmp, body ? `${body}\n` : '', 'utf8');
      fs.renameSync(tmp, file);
      lines = byQq.size;
    }
  }

  const publicView = (a) => a && ({
    qq: a.qq,
    // 头像不存：客户端直接用 QQ 头像 API（q1.qlogo.cn）；这里只给 URL，换号/换图都不用动存储。
    avatar: `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(a.qq)}&s=100`,
    name: a.profile?.name || '',
    nameStyle: a.profile?.nameStyle || null,
    card: a.profile?.card || null,
    created: a.created || null,
    lineup: { used: Number(a.lineupBytes) || 0, quota: quotaBytes },
  });

  function sign(qq) {
    const exp = now() + TOKEN_TTL_MS;
    const payload = `${qq}.${exp}`;
    const sig = b64u(crypto.createHmac('sha256', secret).update(payload).digest());
    return `${payload}.${sig}`;
  }

  /** @returns {string|null} the qq a token belongs to, or null for a bad/expired one. */
  function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [qq, exp, sig] = parts;
    if (!byQq.has(qq) || !Number.isFinite(Number(exp)) || Number(exp) < now()) return null;
    const want = b64u(crypto.createHmac('sha256', secret).update(`${qq}.${exp}`).digest());
    return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig)) ? qq : null;
  }

  return {
    file,
    quotaBytes,
    size: () => byQq.size,
    get: (qq) => byQq.get(String(qq)) || null,
    view: (qq) => publicView(byQq.get(String(qq))),
    list: () => [...byQq.values()].map(publicView),
    verifyToken,

    /** Create an account. @returns {{ok:true, token:string, account:object}|{error:string}} */
    register(qq, password) {
      const id = normalizeQq(qq), pw = normalizePassword(password);
      if (!id) return { error: 'BAD_QQ' };
      if (!pw) return { error: 'BAD_PASSWORD' };
      if (byQq.has(id)) return { error: 'EXISTS' };
      const row = { qq: id, hash: hashPassword(pw), created: now(), updated: now(), profile: {}, lineupBytes: 0 };
      apply(row); append(row);
      return { ok: true, token: sign(id), account: publicView(row) };
    },

    /** @returns {{ok:true, token:string, account:object}|{error:string}} */
    login(qq, password) {
      const id = normalizeQq(qq);
      const a = id ? byQq.get(id) : null;
      if (!a || !checkPassword(password, a.hash)) return { error: 'BAD_CREDENTIALS' };
      return { ok: true, token: sign(id), account: publicView(a) };
    },

    /** 游客绑定：既有账号就校验密码后绑定 playerId；没有就建号。 @returns {{ok:true,...}|{error:string}} */
    bind(qq, password, playerId) {
      const id = normalizeQq(qq), pw = normalizePassword(password);
      if (!id) return { error: 'BAD_QQ' };
      if (!pw) return { error: 'BAD_PASSWORD' };
      const a = byQq.get(id);
      if (a) {
        if (!checkPassword(pw, a.hash)) return { error: 'BAD_CREDENTIALS' };
        const row = { qq: id, playerId: String(playerId || ''), updated: now() };
        apply(row); append(row);
        return { ok: true, token: sign(id), account: publicView(byQq.get(id)) };
      }
      const row = { qq: id, hash: hashPassword(pw), created: now(), updated: now(), playerId: String(playerId || ''), profile: {}, lineupBytes: 0 };
      apply(row); append(row);
      return { ok: true, token: sign(id), account: publicView(row) };
    },

    /** 名片 / 昵称样式这类展示记录（总字节上限，超了整条拒绝）。 @returns {{ok:true,account:object}|{error:string}} */
    setProfile(qq, patch) {
      const a = byQq.get(String(qq));
      if (!a) return { error: 'NOT_FOUND' };
      const next = { ...(a.profile || {}) };
      for (const k of ['name', 'nameStyle', 'card']) {
        if (!(k in (patch || {}))) continue;
        const v = patch[k];
        if (v == null) { delete next[k]; continue; }
        if (typeof v === 'string' && v.length > 120) return { error: 'TOO_LARGE' };
        next[k] = typeof v === 'object' ? v : String(v);
      }
      if (Buffer.byteLength(JSON.stringify(next)) > PROFILE_MAX) return { error: 'TOO_LARGE' };
      const row = { qq: a.qq, profile: next, updated: now() };
      apply(row); append(row);
      return { ok: true, account: publicView(byQq.get(a.qq)) };
    },

    /** 布阵数据用量（20G 额度按账号算）：只接受非负整数，超额度直接拒。 @returns {{ok:true,used:number}|{error:string}} */
    addLineupBytes(qq, bytes) {
      const a = byQq.get(String(qq));
      if (!a) return { error: 'NOT_FOUND' };
      const n = Math.max(0, Math.floor(Number(bytes) || 0));
      const used = (Number(a.lineupBytes) || 0) + n;
      if (used > quotaBytes) return { error: 'QUOTA' };
      const row = { qq: a.qq, lineupBytes: used, updated: now() };
      apply(row); append(row);
      return { ok: true, used, quota: quotaBytes };
    },

    /** 管理后台：重设密码 / 调额度（额度为 null 表示回到默认）。 */
    adminPatch(qq, { password = null, lineupQuotaBytes = null } = {}) {
      const a = byQq.get(String(qq));
      if (!a) return { error: 'NOT_FOUND' };
      const row = { qq: a.qq, updated: now() };
      if (password != null) {
        const pw = normalizePassword(password);
        if (!pw) return { error: 'BAD_PASSWORD' };
        row.hash = hashPassword(pw);
      }
      if (lineupQuotaBytes != null) {
        const n = Math.floor(Number(lineupQuotaBytes));
        if (!Number.isFinite(n) || n < 0) return { error: 'BAD_QUOTA' };
        row.quotaOverride = n;
      }
      apply(row); append(row);
      return { ok: true, account: publicView(byQq.get(a.qq)) };
    },
  };
}
