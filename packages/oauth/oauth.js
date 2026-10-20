// server/http/oauth.js — "log in with ModelScope" for a ModelScope 创空间 deployment.
//
// WHY THIS LIVES IN THE SERVER: the platform does not hand the OAuth client to the operator. When a studio's
// OAuth setting is on, the platform creates the app for it and injects `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET`
// into the RUNNING container (docs: /docs/studios/oauth, "运行时环境变量"). The client id is therefore only
// knowable from inside this process — a hand-built authorize URL with the studio's `OAuthAppID` from the public
// API is rejected with `invalid client_id` (measured 2026-10-12). So the server builds the link, and the only
// thing an operator has to know is this route's path.
//
// THE INVARIANT (same shape as server/http/announcements.js): with no client id and secret in the environment
// NOTHING is different from a plain install — both routes answer "not mine", the static handler serves the path
// exactly as before, and no request is ever made to the provider. A server that never heard of OAuth must stay
// indistinguishable from one that has it and is not configured.
//
// WHAT IT DOES, in the narrowest useful form: `/auth/login` redirects to the provider's authorize endpoint with
// a per-attempt `state`; the callback verifies that state, exchanges the code (client_secret_basic, the method
// the discovery document advertises), reads /userinfo, and shows who logged in. It deliberately does NOT yet
// decide what the identity means for a game session — that is a product decision, not a transport one.

import crypto from 'node:crypto';
import { noopLog } from '../../server/http/config.js';
import { t } from '../../shared/i18n.js';

/** The provider's discovery document (ADR: fetched, cached; the literal fallback is the measured document). */
const DEFAULT_PROVIDER = 'https://www.modelscope.cn';
const DISCOVERY_PATH = '/.well-known/openid-configuration';
/** The endpoints as measured on 2026-10-12 — used only when discovery cannot be fetched. */
const FALLBACK_ENDPOINTS = Object.freeze({
  authorization_endpoint: 'https://www.modelscope.cn/oauth/authorize',
  token_endpoint: 'https://www.modelscope.cn/oauth/token',
  userinfo_endpoint: 'https://www.modelscope.cn/oauth/userinfo',
});
const STATE_COOKIE = 'sp_oauth_state';
const DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

/**
 * The OAuth configuration, or null when this install has none.
 *
 * `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET` are injected by the platform; `STUDIO_HOST` (the studio's own
 * domain, no scheme) is the redirect the platform registered, which is the bare origin — there is no path to
 * point at, so the provider returns the code to `/` and the handler below claims it there.
 * @param {Record<string, string | undefined>} env
 * @param {{ clientId?: string, clientSecret?: string, redirectUri?: string, scopes?: string }} [opts]
 */
export function oauthConfigFrom(env = process.env, opts = {}) {
  const clientId = opts.clientId ?? env.OAUTH_CLIENT_ID;
  const clientSecret = opts.clientSecret ?? env.OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const host = env.STUDIO_HOST || env.SPACE_HOST || '';
  const redirectUri = opts.redirectUri ?? (host ? `https://${host}` : '');
  if (!redirectUri) return null; // no registered callback known: a redirect we cannot complete is worse than none
  return Object.freeze({
    clientId, clientSecret, redirectUri,
    scopes: opts.scopes ?? env.OAUTH_SCOPES ?? 'openid profile',
    provider: (env.OPENID_PROVIDER_URL || DEFAULT_PROVIDER).replace(/\/+$/, ''),
  });
}

/** The two paths this module owns. */
export const OAUTH_LOGIN_PATH = '/auth/login';
export const OAUTH_CALLBACK_PATH = '/auth/callback';

/** A random per-attempt state (the CSRF binding between the authorize call and the callback). */
const newState = () => crypto.randomBytes(16).toString('hex');

/**
 * Build the provider's authorize URL. Exported so a test — or an operator debugging a deployment — can see the
 * exact link without a browser: this is the "登录链接".
 * @param {{ clientId: string, redirectUri: string, scopes: string }} config
 * @param {{ authorization_endpoint: string }} endpoints
 * @param {string} state
 */
export function authorizeUrl(config, endpoints, state) {
  const u = new URL(endpoints.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', config.clientId);
  u.searchParams.set('redirect_uri', config.redirectUri);
  u.searchParams.set('scope', config.scopes);
  u.searchParams.set('state', state);
  return u.toString();
}

/** Fetch + cache the discovery document; fall back to the measured endpoints when it cannot be read. */
function createDiscovery({ provider, log, fetchImpl }) {
  let cached = null;
  return async function endpoints() {
    if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.value;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      const res = await fetchImpl(`${provider}${DISCOVERY_PATH}`, { signal: ac.signal, headers: { accept: 'application/json' } });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`discovery ${res.status}`);
      const doc = await res.json();
      const value = {
        authorization_endpoint: doc.authorization_endpoint,
        token_endpoint: doc.token_endpoint,
        userinfo_endpoint: doc.userinfo_endpoint,
      };
      if (!value.authorization_endpoint || !value.token_endpoint) throw new Error('discovery incomplete');
      cached = { at: Date.now(), value };
      return value;
    } catch (e) {
      log.warn?.(`[oauth] discovery unavailable (${e?.message || e}); using the measured endpoints`);
      cached = { at: Date.now(), value: FALLBACK_ENDPOINTS };
      return FALLBACK_ENDPOINTS;
    }
  };
}

/** A tiny server-rendered answer. Escaped: the name comes from a third party. */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>`
  + '<body style="font-family:system-ui;background:#12151c;color:#e8ecf3;padding:2rem">'
  + `<h1 style="font-size:1.25rem">${esc(title)}</h1>${body}</body>`;

const cookieValue = (req, name) => {
  const raw = req.headers?.cookie;
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
};

/**
 * The two routes. Returns a handler shaped like the static one; it answers `true` when it owned the request and
 * `false` for everything else, so the caller can fall through to the static handler.
 * @param {{ config: object | null, log?: object, fetchImpl?: typeof fetch }} opts
 */
export function createOauthRoutes({ config, log = noopLog, fetchImpl = globalThis.fetch } = {}) {
  if (!config) return async () => false; // not configured: own nothing, fetch nothing
  const endpoints = createDiscovery({ provider: config.provider, log, fetchImpl });
  /** Exchange the code and read the profile. Throws; the caller turns that into a page. */
  async function complete(req, q) {
    const eps = await endpoints();
    const state = q.get('state');
    const expected = cookieValue(req, STATE_COOKIE);
    if (!state || !expected || state !== expected) throw new Error('state mismatch (请重新从登录链接进入)');
    const code = q.get('code');
    if (!code) throw new Error(q.get('error') || 'no code in the callback');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetchImpl(eps.token_endpoint, {
      method: 'POST', signal: ac.signal,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // client_secret_basic, the method the discovery document advertises. The secret stays in this process.
        authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: String(code), redirect_uri: config.redirectUri }).toString(),
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`token endpoint ${res.status}`);
    const token = await res.json();
    if (!token.access_token) throw new Error('no access_token in the token response');
    let profile = null;
    if (eps.userinfo_endpoint) {
      const ures = await fetchImpl(eps.userinfo_endpoint, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (ures.ok) profile = await ures.json();
    }
    return profile;
  }

  return async function handleOauth(req, res, rawPath, query) {
    // The router hands over the raw query STRING (server/http/common.js splitUrl), so parse it here.
    const q = query instanceof URLSearchParams ? query : new URLSearchParams(query || '');
    // `/auth/login` … or the bare root carrying a ?code= from the provider: the platform registered the studio's
    // origin as the callback, so that is where the code arrives.
    const isLogin = rawPath === OAUTH_LOGIN_PATH;
    const isCallback = rawPath === OAUTH_CALLBACK_PATH || (rawPath === '/' && q.has('code') && q.has('state'));
    if (!isLogin && !isCallback) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }

    if (isLogin) {
      const state = newState();
      const eps = await endpoints();
      res.writeHead(302, {
        Location: authorizeUrl(config, eps, state),
        'Set-Cookie': `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return true;
    }

    try {
      const profile = await complete(req, q);
      const who = profile ? (profile.name || profile.nickname || profile.sub || t('(无名)')) : t('(令牌已换取，但 /userinfo 没有返回)');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Set-Cookie': `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
      });
      res.end(page(t('已通过魔搭登录'), t('<p>身份：<b>{0}</b></p><p style="opacity:.7">登录已经打通到 OAuth 换 token + /userinfo。把身份接到游戏会话上还没有做（那是产品决定）。</p>', { 0: esc(who) })));
    } catch (e) {
      log.warn?.(`[oauth] callback failed: ${e?.message || e}`);
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page(t('登录失败'), `<p>${esc(e?.message || e)}</p>`));
    }
    return true;
  };
}
