// The site under any path (docs/spec/site.md 站点-1): the page's URLs come from its own address, and no page source
// or page file names a path from the root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { assetsUrl, codeVersion, kitsUrl, modsUrl, moduleUrl, siteUrl, socketUrl, nodeHost, pageNode } from '../src/site.js';
import { bootCounter, bootDone, bootFail, bootStep } from '../src/boot.js';

test('[站点-1] site URLs and socket URLs follow the page, under a prefix or at the root', () => {
  for (const prefix of ['', '/icebreaker']) {
    const page = `https://x.test${prefix}/play?match=ab&seat=1`;
    assert.equal(siteUrl('assets/skeleton/', page).href, `https://x.test${prefix}/assets/skeleton/`);
    assert.equal(siteUrl('room', page).href, `https://x.test${prefix}/room`);
    assert.equal(socketUrl('battle?seat=1', page), `wss://x.test${prefix}/battle?seat=1`);
    assert.equal(socketUrl('lobby', `http://192.168.1.2:8700${prefix}/`), `ws://192.168.1.2:8700${prefix}/lobby`);
  }
});

test('[站点-6] another node: a host one level under the page name only; its sockets keep the path', () => {
  const page = 'https://play.example.org/icebreaker/room';
  assert.deepEqual(['tyo.play.example.org', 'play.example.org', 'a.tyo.play.example.org', 'evil.org', 'tyo.play.example.org.evil.org', 'x.play.example.org:444', 'TYO.play.example.org', 42, null]
    .map((h) => nodeHost(h, page)), [true, false, false, false, false, false, false, false, false]);
  assert.equal(socketUrl('lobby', page, 'tyo.play.example.org'), 'wss://tyo.play.example.org/icebreaker/lobby');
  assert.equal(socketUrl('battle?seat=1', 'https://play.example.org/icebreaker/play?match=m1&seat=1', null), 'wss://play.example.org/icebreaker/battle?seat=1');
  assert.deepEqual([pageNode(`${page}?server=lon.play.example.org`), pageNode(`${page}?server=evil.org`), pageNode(page)], ['lon.play.example.org', null, null]);
});

test('[站点-3] the asset base is the one the page names, else assets/skeleton/', () => {
  const page = 'https://x.test/icebreaker/play?seat=0';
  const doc = (/** @type {string | null} */ content) => ({ querySelector: () => (content === null ? null : { getAttribute: () => content }) });
  assert.equal(assetsUrl(doc('assets/~0123456789ab/skeleton/'), page).href, 'https://x.test/icebreaker/assets/~0123456789ab/skeleton/');
  assert.equal(assetsUrl(doc(null), page).href, 'https://x.test/icebreaker/assets/skeleton/');
  assert.equal(assetsUrl(undefined, page).href, 'https://x.test/icebreaker/assets/skeleton/');
});

test('[站点-1] no page source, page or style sheet names a path from the root', () => {
  const rooted = /new URL\('\/|location\.host\b|href = '\/|href: `\/|`\/(play|room|lobby|battle)\b|(href|src)="\/(?!\/)|url\(["']?\/(?!\/)/;
  for (const sub of ['../src/', '../public/']) {
    const dir = new URL(sub, import.meta.url);
    for (const f of readdirSync(dir).filter((x) => /\.(js|html|css)$/.test(x))) {
      const hit = rooted.exec(readFileSync(new URL(f, dir), 'utf8'));
      assert.equal(hit, null, `${sub}${f} has ${hit?.[0]}`);
    }
  }
});

test('[站点-4] the Worker and the kits under the version the modules of the page were loaded with; none without one', () => {
  const page = 'https://x.test/icebreaker/play?seat=0', mod = 'https://x.test/icebreaker/m/~0123456789ab/@icebreaker/client/src/main.js';
  assert.equal(codeVersion(mod), '~0123456789ab');
  assert.equal(moduleUrl('@aue/worker/src/worker.js', mod, page).href, 'https://x.test/icebreaker/m/~0123456789ab/@aue/worker/src/worker.js');
  assert.equal(kitsUrl(mod, page).href, 'https://x.test/icebreaker/k/~0123456789ab/');
  const bare = 'https://x.test/icebreaker/m/@icebreaker/client/src/main.js';
  assert.equal(codeVersion(bare), '');
  assert.equal(moduleUrl('@aue/worker/src/worker.js', bare, page).href, 'https://x.test/icebreaker/m/@aue/worker/src/worker.js');
  assert.equal(kitsUrl(bare, page).href, 'https://x.test/icebreaker/k/');
});

test('[站点-7] [页面-10] where the host serves its mods: beside the page, under a path too', () => {
  assert.equal(modsUrl('https://x.test/icebreaker/room?code=1').href, 'https://x.test/icebreaker/mods/');
  assert.equal(modsUrl('http://192.168.1.5:8700/play?seat=0').href, 'http://192.168.1.5:8700/mods/');
});

test('[页面-8] the page tells the loading screen its steps, a share spread over loads, the hand-over and a failure; nothing without it', () => {
  /** @type {any[]} */
  const heard = [];
  const g = /** @type {any} */ (globalThis);
  g.__boot = { up: true, step: (/** @type {string} */ w, /** @type {number} */ a) => heard.push([w, a]), done: () => heard.push('done'), fail: (/** @type {string} */ w) => heard.push(['fail', w]) };
  try {
    bootStep('正在连接对局', 0.52);
    const one = bootCounter('正在载入', 0.5, 0.9, 4);
    one(); one();
    bootFail('载入失败');
    bootDone();
    assert.deepEqual(heard, [['正在连接对局', 0.52], ['正在载入', 0.5], ['正在载入', 0.6], ['正在载入', 0.7], ['fail', '载入失败'], 'done']);
    g.__boot.up = false;
    bootStep('x', 1);
    assert.equal(heard.length, 6, 'the screen gone: nothing more');
  } finally { delete g.__boot; }
  bootDone();
});
