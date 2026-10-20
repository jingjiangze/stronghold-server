// test/oauth-login.test.js — 魔搭 OAuth 登录（server/http/oauth.js）。
//
// 关键契约有两条，其余都是细节：
//   1. **没配就没这个人**：环境里没有 OAUTH_CLIENT_ID/SECRET 时，两条路由都不认领任何路径、不发任何请求 ——
//      一台从没听说过 OAuth 的服务器，必须和"装了但没配"的服务器完全一样。
//   2. **登录链接只能由服务器生成**：平台把 client id 注入容器（公开 API 只给 OAuthAppID，用它拼链接会被
//      `invalid client_id` 拒掉，2026-10-12 实测），所以 /auth/login 必须自己拼出带 state 的授权地址。
// Run: node --test test/oauth-login.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  oauthConfigFrom, createOauthRoutes, authorizeUrl,
  OAUTH_LOGIN_PATH, OAUTH_CALLBACK_PATH,
} from '../packages/oauth/oauth.js';

const ENV = { OAUTH_CLIENT_ID: 'cid-abc', OAUTH_CLIENT_SECRET: 'sec-shh', STUDIO_HOST: 'studio.example' };

/** A minimal ServerResponse stand-in: records the status, headers and body. */
function fakeRes() {
  const res = {
    status: 0, headers: {}, body: '', ended: false,
    writeHead(status, headers) { this.status = status; if (headers) Object.assign(this.headers, headers); return this; },
    end(body) { if (body !== undefined) this.body += String(body); this.ended = true; return this; },
  };
  return res;
}

/** The discovery document the provider serves (shape taken from the live document, 2026-10-12). */
const DISCOVERY = {
  authorization_endpoint: 'https://www.modelscope.cn/oauth/authorize',
  token_endpoint: 'https://www.modelscope.cn/oauth/token',
  userinfo_endpoint: 'https://www.modelscope.cn/oauth/userinfo',
};

/** A fetch stub that answers discovery / token / userinfo and records every call. */
function fakeFetch({ tokenOk = true, profile = { sub: 'u1', name: '测试玩家' } } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/.well-known/openid-configuration')) {
      return { ok: true, status: 200, json: async () => DISCOVERY };
    }
    if (String(url) === DISCOVERY.token_endpoint) {
      if (!tokenOk) return { ok: false, status: 400, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ access_token: 'at-1', token_type: 'Bearer' }) };
    }
    if (String(url) === DISCOVERY.userinfo_endpoint) return { ok: true, status: 200, json: async () => profile };
    throw new Error(`unexpected fetch ${url}`);
  };
  impl.calls = calls;
  return impl;
}

const req = (method = 'GET', cookie = null) => ({ method, headers: cookie ? { cookie } : {} });

test('unconfigured: no client id/secret means no config at all', () => {
  // every shape of "missing" reads as not configured, so a typo never turns into a request
  assert.equal(oauthConfigFrom({}), null);
  assert.equal(oauthConfigFrom({ OAUTH_CLIENT_ID: 'cid' }), null, 'a client id without its secret is not a login');
  assert.equal(oauthConfigFrom({ OAUTH_CLIENT_SECRET: 'sec' }), null);
  // a client id + secret but no registered callback domain: nothing to redirect back to
  assert.equal(oauthConfigFrom({ OAUTH_CLIENT_ID: 'cid', OAUTH_CLIENT_SECRET: 'sec' }), null);
});

test('unconfigured: the routes own no path and never call the provider', async () => {
  const fetchImpl = fakeFetch();
  const routes = createOauthRoutes({ config: null, fetchImpl });
  for (const path of [OAUTH_LOGIN_PATH, OAUTH_CALLBACK_PATH, '/', '/data/announcements.json']) {
    assert.equal(await routes(req(), fakeRes(), path, ''), false, `${path} must fall through to the static handler`);
  }
  assert.deepEqual(fetchImpl.calls, [], 'an unconfigured install must not talk to the provider');
});

test('configured: the config uses the injected values, and STUDIO_HOST becomes the redirect', () => {
  const c = oauthConfigFrom(ENV);
  assert.equal(c.clientId, 'cid-abc');
  assert.equal(c.clientSecret, 'sec-shh');
  assert.equal(c.redirectUri, 'https://studio.example', 'the platform registers the studio origin, no path');
  assert.equal(c.scopes, 'openid profile', 'the default scope set');
  assert.equal(c.provider, 'https://www.modelscope.cn');
  // OAUTH_SCOPES wins when the platform injects one; a trailing slash on the provider is normalised away
  const c2 = oauthConfigFrom({ ...ENV, OAUTH_SCOPES: 'openid profile read-repos', OPENID_PROVIDER_URL: 'https://x.example/' });
  assert.equal(c2.scopes, 'openid profile read-repos');
  assert.equal(c2.provider, 'https://x.example');
});

test('authorizeUrl: the four parameters the provider needs, with the redirect encoded', () => {
  const c = oauthConfigFrom(ENV);
  const url = new URL(authorizeUrl(c, DISCOVERY, 'state-1'));
  assert.equal(url.origin + url.pathname, 'https://www.modelscope.cn/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'cid-abc');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://studio.example');
  assert.equal(url.searchParams.get('scope'), 'openid profile');
  assert.equal(url.searchParams.get('state'), 'state-1');
});

test('/auth/login: 302 to the provider with a fresh state, which is echoed into a cookie', async () => {
  const fetchImpl = fakeFetch();
  const routes = createOauthRoutes({ config: oauthConfigFrom(ENV), fetchImpl });
  const res = fakeRes();
  assert.equal(await routes(req(), res, OAUTH_LOGIN_PATH, ''), true, 'the login route owns its path');
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.Location);
  assert.equal(loc.searchParams.get('client_id'), 'cid-abc');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://studio.example');
  const state = loc.searchParams.get('state');
  assert.match(state, /^[0-9a-f]{32}$/, 'a random 16-byte state');
  const cookie = res.headers['Set-Cookie'];
  assert.match(cookie, new RegExp(`sp_oauth_state=${state}`), 'the state travels with the browser, not the URL only');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(fetchImpl.calls.filter((c) => c.url === DISCOVERY.token_endpoint).length, 0, 'login never exchanges anything');
});

test('the callback: a missing or mismatched state is refused before any token call', async () => {
  const fetchImpl = fakeFetch();
  const routes = createOauthRoutes({ config: oauthConfigFrom(ENV), fetchImpl });
  for (const [label, cookie, query] of [
    ['no cookie', null, 'code=c1&state=s1'],
    ['no state in the query', 'sp_oauth_state=s1', 'code=c1'],
    ['mismatched state', 'sp_oauth_state=other', 'code=c1&state=s1'],
  ]) {
    const res = fakeRes();
    assert.equal(await routes(req('GET', cookie), res, OAUTH_CALLBACK_PATH, query), true, label);
    assert.equal(res.status, 400, label);
    assert.match(res.body, /state mismatch/, label);
    assert.equal(fetchImpl.calls.filter((c) => c.url === DISCOVERY.token_endpoint).length, 0,
      `${label}: the code must not be exchanged without the state it was issued for`);
  }
});

test('the callback: exchanges the code (client_secret_basic) and reads the profile', async () => {
  const fetchImpl = fakeFetch();
  const routes = createOauthRoutes({ config: oauthConfigFrom(ENV), fetchImpl });
  const res = fakeRes();
  assert.equal(await routes(req('GET', 'sp_oauth_state=s1'), res, OAUTH_CALLBACK_PATH, 'code=c1&state=s1'), true);
  assert.equal(res.status, 200);
  assert.match(res.body, /测试玩家/, 'the page names who logged in');
  const tokenCall = fetchImpl.calls.find((c) => c.url === DISCOVERY.token_endpoint);
  assert.ok(tokenCall, 'the code was exchanged');
  assert.match(tokenCall.init.headers.authorization, /^Basic /, 'client_secret_basic, as the discovery document advertises');
  assert.equal(Buffer.from(tokenCall.init.headers.authorization.slice(6), 'base64').toString(), 'cid-abc:sec-shh');
  assert.match(String(tokenCall.init.body), /grant_type=authorization_code/);
  assert.match(String(tokenCall.init.body), /code=c1/);
  assert.match(String(tokenCall.init.body), /redirect_uri=https%3A%2F%2Fstudio\.example/, 'the same redirect the authorize call used');
  const userinfo = fetchImpl.calls.find((c) => c.url === DISCOVERY.userinfo_endpoint);
  assert.equal(userinfo.init.headers.authorization, 'Bearer at-1');
});

test('the callback: the provider returns the code to the studio ROOT, and the root claims it', async () => {
  // The registered callback is the bare origin (no path), so `?code=` arrives at `/`. Claiming it there is what
  // makes the plain link work without the operator registering a callback path first.
  const fetchImpl = fakeFetch();
  const routes = createOauthRoutes({ config: oauthConfigFrom(ENV), fetchImpl });
  const res = fakeRes();
  assert.equal(await routes(req('GET', 'sp_oauth_state=s2'), res, '/', 'code=c2&state=s2'), true);
  assert.equal(res.status, 200);
  // …but a plain root visit is still the game page, and must fall through untouched
  assert.equal(await routes(req(), fakeRes(), '/', ''), false);
  assert.equal(await routes(req(), fakeRes(), '/', 'room=ABCD'), false);
});

test('the callback: a rejected token or a missing profile is a page, never a crash', async () => {
  const routes = createOauthRoutes({ config: oauthConfigFrom(ENV), fetchImpl: fakeFetch({ tokenOk: false }) });
  const res = fakeRes();
  assert.equal(await routes(req('GET', 'sp_oauth_state=s3'), res, OAUTH_CALLBACK_PATH, 'code=c3&state=s3'), true);
  assert.equal(res.status, 400);
  assert.match(res.body, /token endpoint 400/);
  // a good token with no userinfo still reports the login, it just does not name anyone
  const routes2 = createOauthRoutes({ config: oauthConfigFrom(ENV), fetchImpl: fakeFetch({ profile: null }) });
  const res2 = fakeRes();
  assert.equal(await routes2(req('GET', 'sp_oauth_state=s4'), res2, OAUTH_CALLBACK_PATH, 'code=c4&state=s4'), true);
  assert.equal(res2.status, 200);
});
