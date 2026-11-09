// Pages opened by a LAN address (docs/spec/page.md 页面-3): keys without crypto.randomUUID, and no page source using
// what only a secure context has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { randomKey, tabKey } from '../src/session.js';

test('[页面-3] a key is 128 random bits as hex, made with getRandomValues; without sessionStorage a tab still gets one', () => {
  const a = randomKey(), b = randomKey();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  assert.match(tabKey('ice.test'), /^[0-9a-f]{32}$/, 'no sessionStorage in Node: a fresh key');
});

test('[页面-3] the page sources use nothing only a secure context has', () => {
  const dir = new URL('../src/', import.meta.url), secureOnly = /\b(randomUUID|navigator\.clipboard|crypto\.subtle|serviceWorker|SharedArrayBuffer)\b/;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const hit = secureOnly.exec(readFileSync(new URL(f, dir), 'utf8'));
    assert.equal(hit, null, `${f} uses ${hit?.[0]}`);
  }
});
