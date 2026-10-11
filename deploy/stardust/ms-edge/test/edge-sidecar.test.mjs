// Runs the real edge-sidecar decision function. No server, no sockets, no clock.
//
// Run:  node --test deploy/stardust/ms-edge/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_EXT, decide, extensionOf, parseSources, pick, splittable, stripSourceParam, validPath,
} from '../edge-sidecar.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MS = 'https://modelscope.example/datasets/o/r/resolve/abc/releases/v1-trial';
const R2 = 'https://r2.example';
const REJECTED = '/assets/skins/char_340_shwaz_snow_1/illustration.png';

const config = parseSources(JSON.stringify({
  schemaVersion: 1,
  order: ['modelscope', 'r2'],
  sources: [
    { id: 'modelscope', base: MS },
    { id: 'r2', base: R2 },
  ],
  exceptions: { [REJECTED]: 'r2' },
}));

const run = (pathname, opts = {}) => decide(config, { pathname, ...opts });

test('a plain asset goes to the first source', () => {
  const out = run('/assets/char/avatar/char_003_kalts.png');
  assert.equal(out.status, 302);
  assert.equal(out.location, `${MS}/assets/char/avatar/char_003_kalts.png`);
});

test('fonts are redirected too', () => {
  const out = run('/fonts/bender-regular.woff2');
  assert.equal(out.status, 302);
  assert.equal(out.location, `${MS}/fonts/bender-regular.woff2`);
});

test('other query parameters are forwarded verbatim', () => {
  const out = run('/assets/char/avatar/x.png', { query: 'v=abc123' });
  assert.equal(out.location, `${MS}/assets/char/avatar/x.png?v=abc123`);
});

test('sp_source forces a named source and is stripped from the target', () => {
  const out = run('/assets/char/avatar/x.png', { query: 'sp_source=r2' });
  assert.equal(out.location, `${R2}/assets/char/avatar/x.png`);
  assert.equal(out.headers['X-SP-Edge'], 'forced:r2');
});

test('sp_source is stripped while the rest of the query survives', () => {
  const out = run('/assets/char/avatar/x.png', { query: 'sp_source=r2&v=abc' });
  assert.equal(out.location, `${R2}/assets/char/avatar/x.png?v=abc`);
});

test('an unknown sp_source is refused rather than silently falling back', () => {
  // Silently serving a different source than the caller asked for would make a client's own
  // measurement meaningless — it would be measuring a source it did not choose.
  const out = run('/assets/char/avatar/x.png', { query: 'sp_source=bogus' });
  assert.equal(out.status, 503);
});

test('a parameter that merely ends in sp_source is not touched', () => {
  // The old Lua used a single pattern with `(^|&)`, which Lua cannot express (no alternation) —
  // this is the case that a naive substring strip would also break.
  assert.equal(stripSourceParam('xsp_source=1&v=2'), 'xsp_source=1&v=2');
  const out = run('/assets/char/avatar/x.png', { query: 'xsp_source=1&v=2' });
  assert.equal(out.location, `${MS}/assets/char/avatar/x.png?xsp_source=1&v=2`);
});

test('an exception path is routed to its named source regardless of order', () => {
  const out = run(REJECTED);
  assert.equal(out.status, 302);
  assert.equal(out.location, `${R2}${REJECTED}`);
});

test('an exception keeps the query string', () => {
  const out = run(REJECTED, { query: 'v=9' });
  assert.equal(out.location, `${R2}${REJECTED}?v=9`);
});

test('an explicit sp_source still wins over an exception', () => {
  const out = run(REJECTED, { query: 'sp_source=modelscope' });
  assert.equal(out.location, `${MS}${REJECTED}`);
});

test('paths outside the two asset trees are not redirected', () => {
  for (const p of ['/data/assets.json', '/js/main.js', '/media/bgm/act1', '/', '/healthz']) {
    assert.equal(run(p).status, 404, `${p} must not be redirected`);
  }
});

test('a non-redirectable extension is refused', () => {
  // js/css/json stay with the game: they can differ from the deployed build's own copies.
  assert.equal(run('/assets/foo.js').status, 404);
  assert.equal(run('/assets/foo.css').status, 404);
  assert.equal(run('/assets/foo.json').status, 404);
  assert.equal(run('/assets/noext').status, 404);
});

test('traversal and malformed paths are refused', () => {
  for (const p of [
    '/assets/../../etc/passwd',
    '/assets/foo./bar.png',
    '/assets//x.png',
    '/assets/x\u0001y.png',
    '/assets/.hidden.png'.replace('.hidden', '..hidden'),
  ]) {
    assert.equal(run(p).status, 404, `${JSON.stringify(p)} must be refused`);
  }
});

test('OPTIONS answers the preflight and other methods are refused', () => {
  const opt = run('/assets/x.png', { method: 'OPTIONS' });
  assert.equal(opt.status, 204);
  assert.equal(opt.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(run('/assets/x.png', { method: 'POST' }).status, 405);
  assert.equal(run('/assets/x.png', { method: 'PUT' }).status, 405);
});

test('HEAD is allowed and still emits a Location', () => {
  const out = run('/assets/x.png', { method: 'HEAD' });
  assert.equal(out.status, 302);
  assert.ok(out.location);
});

test('the redirect carries CORS and a short cache', () => {
  const out = run('/assets/x.png');
  assert.equal(out.headers['Access-Control-Allow-Origin'], '*');
  assert.match(out.headers['Cache-Control'], /^public, max-age=\d+$/);
});

// --- config validation: this file is a build artifact, but a hand edit must not get that far ---

test('a source with a non-https base or a traversal is dropped, not honoured', () => {
  const cfg = parseSources(JSON.stringify({
    order: ['good', 'bad1', 'bad2'],
    sources: [
      { id: 'good', base: 'https://ok.example' },
      { id: 'bad1', base: 'http://plain.example' },
      { id: 'bad2', base: 'https://evil.example/..' },
    ],
  }));
  assert.deepEqual([...cfg.byId.keys()], ['good']);
  assert.deepEqual(cfg.order, ['good']);
});

test('an exception pointing at an unknown source is dropped', () => {
  const cfg = parseSources(JSON.stringify({
    order: ['a'],
    sources: [{ id: 'a', base: 'https://a.example' }],
    exceptions: { '/assets/x.png': 'nope' },
  }));
  assert.equal(cfg.exceptions.size, 0);
});

test('a config with no usable source is a hard failure', () => {
  assert.throws(() => parseSources(JSON.stringify({ order: [], sources: [] })));
  assert.throws(() => parseSources('{}'));
});

test('pick falls back to order and returns null when nothing is usable', () => {
  assert.equal(pick(config, null, '/assets/x.png'), MS);
  const empty = parseSources(JSON.stringify({ order: ['a'], sources: [{ id: 'a', base: 'https://a.example' }] }));
  const orphan = { ...empty, order: [] };
  assert.equal(pick(orphan, null, '/assets/x.png'), null);
});

// --- the shipped file: the tests above use a fixture, so check the real one too ---

test('the shipped sources.json is well formed and names a full source first', () => {
  const shipped = parseSources(fs.readFileSync(path.join(HERE, '..', 'sources.json'), 'utf8'));
  assert.ok(shipped.order.length >= 2, 'expected a primary and at least one fallback');
  const primary = shipped.byId.get(shipped.order[0]);
  assert.match(primary, /^https:\/\/modelscope\.cn\/datasets\//);
  // The one platform-rejected file must stay routed away from the dataset mirror.
  assert.equal(shipped.exceptions.get(REJECTED), shipped.byId.get('r2'));
});

// OpenI is the fastest source measured, and unusable for the browser: its ACAO is hardcoded to a
// third-party domain and it ignores Range on binaries. So it stays reachable *only* by name —
// a consumer that knows it does not need CORS (a direct download, a build-time fetch) can ask for
// it, and the default path can never land there.
test('a source outside order is reachable only when named explicitly', () => {
  const cfg = parseSources(JSON.stringify({
    order: ['a'],
    sources: [
      { id: 'a', base: 'https://a.example' },
      { id: 'openi', base: 'https://openi.example' },
    ],
  }));
  assert.equal(decide(cfg, { pathname: '/assets/x.png' }).location, 'https://a.example/assets/x.png');
  assert.equal(
    decide(cfg, { pathname: '/assets/x.png', query: 'sp_source=openi' }).location,
    'https://openi.example/assets/x.png',
  );
});

test('the shipped sources.json keeps openi out of the default order', () => {
  const shipped = parseSources(fs.readFileSync(path.join(HERE, '..', 'sources.json'), 'utf8'));
  assert.ok(shipped.byId.has('openi'), 'openi stays available as an explicitly named channel');
  assert.ok(!shipped.order.includes('openi'), 'openi must never be a default target: no usable CORS');
  assert.equal(shipped.order[0], 'modelscope', 'the CORS-clean, fastest source leads');
});

test('the extension allowlist and the path rules agree on what the tree contains', () => {
  // Guards against someone widening SEGMENT or ALLOWED_EXT into something that accepts a path
  // traversal: every rejected shape must stay rejected.
  assert.ok(ALLOWED_EXT.has(extensionOf('/assets/a/b/c.skel')));
  assert.ok(!splittable('/media/bgm/x.mp3'));
  assert.ok(validPath('/assets/a/b.png'));
  assert.ok(!validPath('/assets/a/..b.png'));
});
