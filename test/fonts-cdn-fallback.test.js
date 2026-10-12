// Fonts for an install whose art lives on a mirror instead of on disk.
//
// The image ships no public/fonts/: tools/fetch-assets.mjs writes it only for a self-contained install, and the
// deployment pins data/assets.json to a public mirror whose font URLs are absolute. public/index.html still links
// /fonts/fonts.css, so without a fallback every load answers 404 and the game falls back to the system fonts —
// which is what the mirror-pinned install did. A missing /fonts/… path is now redirected to the URL the pinned
// manifest names (301-style local-first: a file that IS on disk is still served from disk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../server/index.js';
import { fontUrlsFrom } from '../server/http/asset-cdn.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'https://mirror.test';

/** A deployment whose manifest points at a mirror (absolute URLs). */
const MIRROR_MANIFEST = {
  version: 'v0.2.4-test',
  fonts: {
    css: `${MIRROR}/fonts/fonts.css?v=v0.2.4-test`,
    faces: {
      'bender-regular': {
        family: 'Bender',
        weight: 400,
        original: `${MIRROR}/fonts/bender-regular.otf?v=v0.2.4-test`,
        woff2: `${MIRROR}/fonts/bender-regular.woff2?v=v0.2.4-test`,
      },
    },
  },
};

function tmpdirWith(prefix, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

function serve({ dataDir, publicDir = path.join(ROOT, 'public') }) {
  const handler = createStaticHandler({ publicDir, dataDir, sharedDir: path.join(ROOT, 'shared') });
  const srv = http.createServer((req, res) => {
    const [p, q] = req.url.split('?');
    handler(req, res, p, q || '');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

function get(srv, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, cache: res.headers['cache-control'], body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('a missing /fonts/… is redirected to the mirror the pinned manifest names', async () => {
  const dataDir = tmpdirWith('sp-fonts-', { 'assets.json': MIRROR_MANIFEST });
  const srv = await serve({ dataDir });
  try {
    // the stylesheet itself keeps the manifest's own URL, version token included
    const css = await get(srv, '/fonts/fonts.css');
    assert.equal(css.status, 302);
    assert.equal(css.location, `${MIRROR}/fonts/fonts.css?v=v0.2.4-test`);
    // a face is named by the manifest too
    const woff2 = await get(srv, '/fonts/bender-regular.woff2');
    assert.equal(woff2.status, 302);
    assert.equal(woff2.location, `${MIRROR}/fonts/bender-regular.woff2?v=v0.2.4-test`);
    const otf = await get(srv, '/fonts/bender-regular.otf');
    assert.equal(otf.location, `${MIRROR}/fonts/bender-regular.otf?v=v0.2.4-test`);
    // a font the manifest does not name still resolves next to the stylesheet that references it
    const other = await get(srv, '/fonts/novecento-wide-normal.woff2');
    assert.equal(other.status, 302);
    assert.equal(other.location, `${MIRROR}/fonts/novecento-wide-normal.woff2`);
    // cached like the font files themselves (files.js: one day), so the redirect is not per-load traffic
    assert.equal(css.cache, 'public, max-age=86400');
    const head = await get(srv, '/fonts/fonts.css', 'HEAD');
    assert.equal(head.status, 302);
    assert.equal(head.body, '');
  } finally {
    srv.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the fallback is limited to /fonts/ — everything else still 404s', async () => {
  const dataDir = tmpdirWith('sp-fonts-scope-', { 'assets.json': MIRROR_MANIFEST });
  const srv = await serve({ dataDir });
  try {
    assert.equal((await get(srv, '/nope.txt')).status, 404);
    assert.equal((await get(srv, '/data/nope.json')).status, 404);
    assert.equal((await get(srv, '/fonts/')).status, 404);
  } finally {
    srv.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a local public/fonts/ wins — the redirect never shadows a file that is on disk', async () => {
  const dataDir = tmpdirWith('sp-fonts-local-data-', { 'assets.json': MIRROR_MANIFEST });
  const publicDir = tmpdirWith('sp-fonts-local-pub-', { 'fonts/fonts.css': '/* local */\n' });
  const srv = await serve({ dataDir, publicDir });
  try {
    const r = await get(srv, '/fonts/fonts.css');
    assert.equal(r.status, 200);
    assert.equal(r.body, '/* local */\n');
  } finally {
    srv.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(publicDir, { recursive: true, force: true });
  }
});

test('a self-contained manifest (root-relative fonts) and a missing manifest both keep the 404', async () => {
  const relative = tmpdirWith('sp-fonts-rel-', { 'assets.json': { version: 'v1', fonts: { css: '/fonts/fonts.css', faces: { bender: { woff2: '/fonts/bender-regular.woff2' } } } } });
  const none = tmpdirWith('sp-fonts-none-', { 'config.json': '{}' });
  for (const dataDir of [relative, none]) {
    const srv = await serve({ dataDir });
    try {
      assert.equal((await get(srv, '/fonts/fonts.css')).status, 404, dataDir);
    } finally {
      srv.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }
});

test('fontUrlsFrom tolerates an absent or reshaped manifest', () => {
  assert.deepEqual(fontUrlsFrom(null).byPath.size, 0);
  assert.equal(fontUrlsFrom({}).base, null);
  assert.equal(fontUrlsFrom({ fonts: { faces: {} } }).base, null);
  // faces without the stylesheet still name the mirror: the base comes from a face's own directory
  const facesOnly = fontUrlsFrom({ fonts: { faces: { b: { woff2: `${MIRROR}/fonts/b.woff2?v=1` } } } });
  assert.equal(facesOnly.base.href, `${MIRROR}/fonts/`);
  assert.equal(facesOnly.byPath.get('/fonts/b.woff2'), `${MIRROR}/fonts/b.woff2?v=1`);
  // a mirror that moves to a path prefix carries over, because the base comes from the manifest's own URL
  const prefixed = fontUrlsFrom({ fonts: { css: `${MIRROR}/app/g1/fonts/fonts.css?v=1` } });
  assert.equal(prefixed.base.href, `${MIRROR}/app/g1/fonts/`);
});
