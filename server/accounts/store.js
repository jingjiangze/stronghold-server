// server/accounts/store.js — 极简账号库 (业主 2026-11-01)：QQ 号当登录名、头像走 QQ 头像 API（不存图）、
// 密码自己设、游客可绑定；服务端只存「口令哈希 + 名片/昵称样式 + 布阵数据用量」。
//
// 存储（业主 2026-11-01 追加：用 SQLite）：Node 内置 `node:sqlite`（22.11 需要 `--experimental-sqlite`，
// 生产在 systemd 的 NODE_OPTIONS 里给；Node 24 直接可用）。**拿不到该模块时退回 append-only JSONL**，
// 保证 CI（node 22 无 flag）与任何老运行时都能跑，接口完全一致。
//
// 容量（业主：20G 是**全服务器**的布阵数据容量，不是每账号）：`addLineupBytes` 按**全表总和**判定，
// 到顶即拒；`view()` 同时给出本单位与全服用量。
//
// 会话令牌是**无状态** HMAC（`<qq>.<exp>.<sig>`，密钥 `data/.account-secret` 0600）⇒ 服务端不为登录态
// 存任何东西，重启不掉线；客户端「默认保留登录」只需把令牌存进 localStorage（客户端侧决定）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

/** 全服布阵数据容量：业主口径 20G（不是每账号）。 */
export const DEFAULT_LINEUP_QUOTA_BYTES = 20 * 1024 ** 3;

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32 });
const QQ_RE = /^[1-9][0-9]{4,11}$/;
const PROFILE_MAX = 1024; // 名片 / 昵称样式这类展示记录的总字节上限
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `$scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

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

export function normalizeQq(qq) {
  const s = String(qq ?? '').trim();
  return QQ_RE.test(s) ? s : null;
}

export function normalizePassword(pw) {
  const s = typeof pw === 'string' ? pw : '';
  return s.length >= 6 && s.length <= 64 && s.trim() === s ? s : null;
}

/** node:sqlite when the runtime has it (22.5+ with --experimental-sqlite, 24+ by default), else null. */
function loadSqlite() {
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    return DatabaseSync || null;
  } catch { return null; }
}

/**
 * @param {{ dataDir: string, log?: object, quotaBytes?: number, now?: () => number }} o
 */
export function openAccounts({ dataDir, log = console, quotaBytes = Number(process.env.SP_ACCOUNT_LINEUP_QUOTA_BYTES) || DEFAULT_LINEUP_QUOTA_BYTES, now = Date.now }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const forceJsonl = String(process.env.SP_ACCOUNTS_BACKEND || '').toLowerCase() === 'jsonl';
  const DatabaseSync = forceJsonl ? null : loadSqlite();
  const backend = DatabaseSync ? 'sqlite' : 'jsonl';
  const secretFile = path.join(dataDir, '.account-secret');

  const secret = (() => {
    try {
      const raw = fs.readFileSync(secretFile);
      if (raw.length >= 32) return raw.subarray(0, 32);
    } catch { /* first boot */ }
    const made = crypto.randomBytes(32);
    try { fs.writeFileSync(secretFile, made, { mode: 0o600 }); } catch (e) { log.warn?.('[accounts] cannot persist the token secret', e?.message); }
    return made;
  })();

  // ---- backend: SQLite -----------------------------------------------------------------------------------------
  let db = null;
  if (backend === 'sqlite') {
    db = new DatabaseSync(path.join(dataDir, 'accounts.db'));
    db.exec(`CREATE TABLE IF NOT EXISTS accounts (
      qq TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      player_id TEXT,
      profile TEXT NOT NULL DEFAULT '{}',
      lineup_bytes INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS accounts_updated ON accounts(updated)');
  }

  /** The JSONL fallback keeps the exact same shapes (map + append). */
  const jsonlFile = path.join(dataDir, 'accounts.jsonl');
  let jsonl = null;
  if (!db) {
    jsonl = new Map();
    let lines = 0;
    try {
      const text = fs.existsSync(jsonlFile) ? fs.readFileSync(jsonlFile, 'utf8') : '';
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        lines++;
        try { const row = JSON.parse(line); const prev = jsonl.get(row.qq); jsonl.set(row.qq, { ...(prev || {}), ...row }); } catch { /* skip */ }
      }
    } catch (e) { log.warn?.('[accounts] cannot read the jsonl store', e?.message); }
    jsonl._lines = () => lines;
    jsonl._append = (row) => {
      fs.appendFileSync(jsonlFile, `${JSON.stringify(row)}\n`, 'utf8');
      lines++;
      if (lines > jsonl.size * 2 + 32) {
        const tmp = `${jsonlFile}.tmp`;
        const body = [...jsonl.values()].map((a) => JSON.stringify(a)).join('\n');
        fs.writeFileSync(tmp, body ? `${body}\n` : '', 'utf8');
        fs.renameSync(tmp, jsonlFile);
        lines = jsonl.size;
      }
    };
  }

  const rowOf = (qq) => {
    if (db) {
      const r = db.prepare('SELECT qq, hash, created, updated, player_id, profile, lineup_bytes FROM accounts WHERE qq = ?').get(qq);
      return r ? { qq: r.qq, hash: r.hash, created: r.created, updated: r.updated, playerId: r.player_id, profile: JSON.parse(r.profile || '{}'), lineupBytes: r.lineup_bytes } : null;
    }
    return jsonl.get(qq) || null;
  };

  const upsert = (row) => {
    const a = rowOf(row.qq) || { profile: {}, lineupBytes: 0 };
    const next = {
      qq: row.qq,
      hash: row.hash ?? a.hash,
      created: a.created ?? row.created ?? now(),
      updated: now(),
      playerId: row.playerId ?? a.playerId ?? null,
      profile: row.profile ?? a.profile ?? {},
      lineupBytes: row.lineupBytes ?? a.lineupBytes ?? 0,
    };
    if (db) {
      db.prepare(`INSERT INTO accounts (qq, hash, created, updated, player_id, profile, lineup_bytes) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(qq) DO UPDATE SET hash=excluded.hash, updated=excluded.updated, player_id=excluded.player_id,
          profile=excluded.profile, lineup_bytes=excluded.lineup_bytes`)
        .run(next.qq, next.hash, next.created, next.updated, next.playerId, JSON.stringify(next.profile), next.lineupBytes);
    } else {
      jsonl.set(next.qq, next);
      jsonl._append(next);
    }
    return next;
  };

  const totalBytes = () => {
    if (db) return Number(db.prepare('SELECT COALESCE(SUM(lineup_bytes),0) AS n FROM accounts').get().n) || 0;
    let n = 0;
    for (const a of jsonl.values()) n += Number(a.lineupBytes) || 0;
    return n;
  };

  const publicView = (a) => a && ({
    qq: a.qq,
    // 头像不存：客户端直接用 QQ 头像 API；换号/换图都不用动存储。
    avatar: `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(a.qq)}&s=100`,
    name: a.profile?.name || '',
    nameStyle: a.profile?.nameStyle || null,
    card: a.profile?.card || null,
    created: a.created || null,
    lineup: { used: Number(a.lineupBytes) || 0, total: totalBytes(), quota: quotaBytes },
  });

  function sign(qq) {
    const exp = now() + TOKEN_TTL_MS;
    const payload = `${qq}.${exp}`;
    return `${payload}.${b64u(crypto.createHmac('sha256', secret).update(payload).digest())}`;
  }

  function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [qq, exp, sig] = parts;
    if (!rowOf(qq) || !Number.isFinite(Number(exp)) || Number(exp) < now()) return null;
    const want = b64u(crypto.createHmac('sha256', secret).update(`${qq}.${exp}`).digest());
    return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig)) ? qq : null;
  }

  return {
    backend,
    file: db ? path.join(dataDir, 'accounts.db') : jsonlFile,
    quotaBytes,
    totalBytes,
    size: () => (db ? Number(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n) || 0 : jsonl.size),
    get: rowOf,
    view: (qq) => publicView(rowOf(String(qq))),
    list: () => (db
      ? db.prepare('SELECT qq FROM accounts ORDER BY updated DESC').all().map((r) => publicView(rowOf(r.qq)))
      : [...jsonl.keys()].map((qq) => publicView(jsonl.get(qq)))),
    verifyToken,

    register(qq, password) {
      const id = normalizeQq(qq), pw = normalizePassword(password);
      if (!id) return { error: 'BAD_QQ' };
      if (!pw) return { error: 'BAD_PASSWORD' };
      if (rowOf(id)) return { error: 'EXISTS' };
      const row = upsert({ qq: id, hash: hashPassword(pw), profile: {}, lineupBytes: 0 });
      return { ok: true, token: sign(id), account: publicView(row) };
    },

    login(qq, password) {
      const id = normalizeQq(qq);
      const a = id ? rowOf(id) : null;
      if (!a || !checkPassword(password, a.hash)) return { error: 'BAD_CREDENTIALS' };
      return { ok: true, token: sign(id), account: publicView(a) };
    },

    /** 游客绑定：既有账号要校验密码；没有就建号。 */
    bind(qq, password, playerId) {
      const id = normalizeQq(qq), pw = normalizePassword(password);
      if (!id) return { error: 'BAD_QQ' };
      if (!pw) return { error: 'BAD_PASSWORD' };
      const a = rowOf(id);
      if (a && !checkPassword(pw, a.hash)) return { error: 'BAD_CREDENTIALS' };
      const row = a ? upsert({ qq: id, playerId: String(playerId || '') }) : upsert({ qq: id, hash: hashPassword(pw), playerId: String(playerId || '') });
      return { ok: true, token: sign(id), account: publicView(row) };
    },

    setProfile(qq, patch) {
      const a = rowOf(String(qq));
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
      return { ok: true, account: publicView(upsert({ qq: a.qq, profile: next })) };
    },

    /** 布阵数据用量：**全服** 20G 判定（业主口径），到顶即拒。 */
    addLineupBytes(qq, bytes) {
      const a = rowOf(String(qq));
      if (!a) return { error: 'NOT_FOUND' };
      const n = Math.max(0, Math.floor(Number(bytes) || 0));
      if (totalBytes() + n > quotaBytes) return { error: 'QUOTA' };
      const row = upsert({ qq: a.qq, lineupBytes: (Number(a.lineupBytes) || 0) + n });
      return { ok: true, used: row.lineupBytes, total: totalBytes(), quota: quotaBytes };
    },

    adminPatch(qq, { password = null, lineupQuotaBytes = null } = {}) {
      const a = rowOf(String(qq));
      if (!a) return { error: 'NOT_FOUND' };
      const patch = { qq: a.qq };
      if (password != null) {
        const pw = normalizePassword(password);
        if (!pw) return { error: 'BAD_PASSWORD' };
        patch.hash = hashPassword(pw);
      }
      if (lineupQuotaBytes != null) {
        const n = Math.floor(Number(lineupQuotaBytes));
        if (!Number.isFinite(n) || n < 0) return { error: 'BAD_QUOTA' };
        patch.lineupBytes = n; // 管理口径：直接把该账号的占用改成这个数
      }
      return { ok: true, account: publicView(upsert(patch)) };
    },

    close() { try { db?.close(); } catch { /* already closed */ } },
  };
}
