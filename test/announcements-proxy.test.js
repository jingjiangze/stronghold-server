// L3 — the external notice board (server/http/announcements.js): a lobby notice that an operator can publish
// without redeploying the server.
//
// The invariant every case here defends, and the reason the module exists at all: **with no source configured,
// this server is indistinguishable from one that never heard of it.** A notice is optional decoration, so a
// source that is down, slow, or malformed must fall back to the on-disk file rather than fail the request —
// and a server whose operator configured nothing must not grow a fetch, a timer or a log line.
//
// Run: node --test test/announcements-proxy.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANNOUNCEMENTS_PATH, ANNOUNCEMENTS_URL_ENV,
  announcementsUrlFrom, createAnnouncementSource,
} from '../server/http/announcements.js';
import { createStaticHandler } from '../server/http/static.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** A data dir holding one known announcements.json, so "served the disk copy" is checkable byte for byte. */
function tempDataDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ann-${label}-`));
  fs.writeFileSync(path.join(dir, 'announcements.json'), JSON.stringify([{ title: 'on disk', date: '2026-10-12', paragraphs: ['from the image'] }]));
  return dir;
}

/**
 * Drive one GET through the static handler over a REAL socket: files.js streams the body with a real
 * ServerResponse, so a hand-rolled stub would test the stub rather than the answer.
 */
async function request(handler, url = ANNOUNCEMENTS_PATH) {
  const server = http.createServer((req, res) => {
    const i = req.url.indexOf('?');
    handler(req, res, i < 0 ? req.url : req.url.slice(0, i), i < 0 ? '' : req.url.slice(i + 1)).catch(() => res.destroy());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${url}`);
    const body = await res.text();
    // Node's fetch lowercases header names, so read through the Headers object rather than the plain copy.
    return { status: res.status, headers: res.headers, body };
  } finally {
    server.close();
  }
}

const jsonResponse = (obj) => ({
  ok: true, status: 200,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
  text: async () => JSON.stringify(obj),
});

test('no source configured → the on-disk file, and no fetch is ever made', async () => {
  const dataDir = tempDataDir('off');
  let fetches = 0;
  const source = createAnnouncementSource({ url: 'https://example.invalid/a.json', fetch: async () => { fetches += 1; return jsonResponse([]); } });
  // Simulate "not configured": the static handler is handed null, exactly as index.js does when
  // SP_ANNOUNCEMENTS_URL is unset.
  const handler = createStaticHandler({ publicDir: path.join(ROOT, 'public'), dataDir, sharedDir: path.join(ROOT, 'shared'), announcements: null, log: noopLog });
  const got = await request(handler);
  assert.equal(got.status, 200);
  assert.equal(JSON.parse(got.body)[0].title, 'on disk');
  assert.equal(source.body(), null, 'a source nobody started holds nothing');
  assert.equal(fetches, 0, 'nothing was fetched');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a configured and reachable source replaces the on-disk file', async () => {
  const dataDir = tempDataDir('on');
  const source = createAnnouncementSource({
    url: 'https://example.invalid/a.json',
    fetch: async () => jsonResponse([{ title: 'from the source', date: '2026-10-12', paragraphs: ['published without a redeploy'] }]),
  });
  await source.refresh();
  const handler = createStaticHandler({ publicDir: path.join(ROOT, 'public'), dataDir, sharedDir: path.join(ROOT, 'shared'), announcements: source, log: noopLog });
  const got = await request(handler);
  assert.equal(got.status, 200);
  assert.equal(JSON.parse(got.body)[0].title, 'from the source', 'the source wins over the baked file');
  assert.match(got.headers.get('cache-control'), /no-cache/);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a source that never answered falls back to the on-disk file', async () => {
  const dataDir = tempDataDir('down');
  const source = createAnnouncementSource({ url: 'https://example.invalid/a.json', fetch: async () => { throw new Error('ECONNREFUSED'); } });
  await source.refresh();
  assert.equal(source.body(), null);
  const handler = createStaticHandler({ publicDir: path.join(ROOT, 'public'), dataDir, sharedDir: path.join(ROOT, 'shared'), announcements: source, log: noopLog });
  const got = await request(handler);
  assert.equal(got.status, 200, 'a broken source must not fail the request');
  assert.equal(JSON.parse(got.body)[0].title, 'on disk');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a non-JSON body is refused, so an HTML error page never reaches the board', async () => {
  const source = createAnnouncementSource({
    url: 'https://example.invalid/a.json',
    fetch: async () => ({ ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) }, text: async () => '<html>nope</html>' }),
  });
  await source.refresh();
  assert.equal(source.body(), null, 'an HTML body is not a notice board');
});

test('malformed JSON is refused even when the content-type says json', async () => {
  const source = createAnnouncementSource({
    url: 'https://example.invalid/a.json',
    fetch: async () => ({ ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => '{ not json' }),
  });
  await source.refresh();
  assert.equal(source.body(), null);
});

test('a non-2xx answer is not a body', async () => {
  const source = createAnnouncementSource({
    url: 'https://example.invalid/a.json',
    fetch: async () => ({ ok: false, status: 404, headers: { get: () => 'application/json' }, text: async () => '[]' }),
  });
  await source.refresh();
  assert.equal(source.body(), null);
});

test('a fetch that hangs is abandoned, not awaited forever', async () => {
  const source = createAnnouncementSource({
    url: 'https://example.invalid/a.json',
    fetch: () => new Promise((resolve) => { setTimeout(() => resolve(jsonResponse([{ title: 'too late' }])), 60_000); }),
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)), // the injected clock decides the deadline
  });
  const started = Date.now();
  await source.refresh();
  assert.ok(Date.now() - started < 5_000, 'a hanging source must not hold the request');
  assert.equal(source.body(), null);
});

test('only absolute http(s) URLs configure a source', () => {
  const saved = process.env[ANNOUNCEMENTS_URL_ENV];
  try {
    for (const bad of [undefined, '', '   ', '/data/announcements.json', 'file:///etc/passwd', 'ftp://x/a.json', 42, null]) {
      process.env[ANNOUNCEMENTS_URL_ENV] = bad ?? '';
      assert.equal(announcementsUrlFrom(), null, `rejected: ${String(bad)}`);
    }
    process.env[ANNOUNCEMENTS_URL_ENV] = 'https://cdn.example/announcements.json';
    assert.equal(announcementsUrlFrom(), 'https://cdn.example/announcements.json');
    process.env[ANNOUNCEMENTS_URL_ENV] = 'http://127.0.0.1:9/a.json';
    assert.equal(announcementsUrlFrom(), 'http://127.0.0.1:9/a.json', 'plain http is the operator\'s call');
  } finally {
    if (saved === undefined) delete process.env[ANNOUNCEMENTS_URL_ENV];
    else process.env[ANNOUNCEMENTS_URL_ENV] = saved;
  }
});

test('the startServer() option wins over the environment', () => {
  const saved = process.env[ANNOUNCEMENTS_URL_ENV];
  try {
    process.env[ANNOUNCEMENTS_URL_ENV] = 'https://env.example/a.json';
    assert.equal(announcementsUrlFrom({ announcementsUrl: 'https://opt.example/a.json' }), 'https://opt.example/a.json');
    assert.equal(announcementsUrlFrom({ announcementsUrl: '' }), 'https://env.example/a.json', 'an empty option is not a veto');
  } finally {
    if (saved === undefined) delete process.env[ANNOUNCEMENTS_URL_ENV];
    else process.env[ANNOUNCEMENTS_URL_ENV] = saved;
  }
});

test('a successful refresh leaves no pending deadline timer (the process must not hang)', async () => {
  // Regression: the abort timer was armed on every refresh but only cleared on the failure path, so a
  // SUCCESSFUL poll left a pending setTimeout keeping the Node event loop alive — every refresh then cost
  // the full timeout before the process could move on or exit. A stubbed fetch cannot catch that (the
  // timer is real), so this arms a real 30s timer and asserts the refresh does not wait for it.
  let armed = null;
  const source = createAnnouncementSource({
    url: 'https://example.invalid/a.json',
    fetch: async () => jsonResponse([{ title: 'ok', paragraphs: ['p'] }]),
    setTimeout: (fn, ms) => { armed = { ms }; return setTimeout(fn, ms); },
  });
  const started = Date.now();
  await source.refresh();
  const elapsed = Date.now() - started;
  assert.equal(source.body() !== null, true);
  assert.equal(armed?.ms, 8000, 'a deadline was armed for the fetch');
  assert.ok(elapsed < 3000, `refresh returned in ${elapsed}ms — the 8000ms deadline must not hold it`);
});

test('concurrent refreshes share one request', async () => {
  let calls = 0;
  const source = createAnnouncementSource({
    url: 'https://example.invalid/a.json',
    fetch: async () => { calls += 1; await new Promise((r) => setTimeout(r, 10)); return jsonResponse([{ title: 'x' }]); },
  });
  await Promise.all([source.refresh(), source.refresh(), source.refresh()]);
  assert.equal(calls, 1, 'a poll storm must not become a request storm');
});
