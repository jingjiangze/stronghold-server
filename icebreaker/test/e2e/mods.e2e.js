// End to end in a real browser with a host's mods (docs/spec/site.md 站点-7, page.md 页面-10): the server serves the
// list and the files, both seat pages make the same content from them — an operator the mod adds, one it changes — and
// play in step with the arbiter; the match is marked. Run with `pnpm run e2e`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MATCH, loadHostMods } from '@icebreaker/server';
import { command, DEPLOY, launch, matchesArbiter, openSeat, pastFrame, startStack, until } from './helpers.js';

const RANG = fileURLToPath(new URL('../../engine/packages/content/data/operators/char_503_rang.json', import.meta.url));

/** A mods folder with one mod: 巡林者 again as e2e:rang_alt (looking like her), 芬's attack raised. @returns {string} */
function modsFolder() {
  const root = mkdtempSync(join(tmpdir(), 'ig-mods-')), dir = join(root, 'e2e');
  mkdirSync(dir);
  writeFileSync(join(dir, 'pack.json'), JSON.stringify({ type: 'data', version: '1.0.0', app: '*', name: 'e2e', files: { data: 'data.json' } }));
  const rang = JSON.parse(readFileSync(RANG, 'utf8'));
  writeFileSync(join(dir, 'data.json'), JSON.stringify({ operators: {
    'e2e:rang_alt': { ...rang, name: '巡林者（另）', look: 'char_503_rang' },
    char_123_fang: { phases: { 0: { frames: { 1: { stats: { atk: 999 } } } } } },
  } }));
  return root;
}

describe('a host with mods', () => {
  /** @type {Awaited<ReturnType<typeof startStack>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {Awaited<ReturnType<typeof openSeat>>[]} */ const seats = [];
  const folder = modsFolder();
  const match = { ...DEFAULT_MATCH, decks: [DEFAULT_MATCH.decks[0].map((d) => (d.id === 'char_503_rang' ? { ...d, id: 'e2e:rang_alt' } : d)), DEFAULT_MATCH.decks[1]] };

  before(async () => { stack = await startStack(match, { mods: await loadHostMods(folder) }); browser = await launch(); });
  after(async () => {
    await Promise.all(seats.map((s) => s.context.close().catch(() => {})));
    await browser?.close();
    await stack?.stop();
    rmSync(folder, { recursive: true, force: true });
  });

  test('[站点-7] [页面-10] both seats make the host\'s content, play the added operator in step, and the match is marked', async () => {
    const list = await (await fetch(`http://127.0.0.1:${stack.port}/mods/index.json`)).json();
    assert.deepEqual(list.mods.map((/** @type {any} */ m) => [m.id, m.version, m.files.map((/** @type {any} */ f) => f.path)]), [['e2e', '1.0.0', ['data.json']]]);
    assert.equal((await fetch(`http://127.0.0.1:${stack.port}/mods/e2e/pack.json`)).status, 404, 'only the listed data files');
    const a = await openSeat(browser, stack.port, 0), b = await openSeat(browser, stack.port, 1);
    seats.push(a, b);
    await Promise.all([pastFrame(a.page, 30), pastFrame(b.page, 30)]);
    await command(a.page, { ...DEPLOY[0], op: 'e2e:rang_alt#0' });
    await command(b.page, DEPLOY[1]);
    const host = stack.room.host.world;
    await until('both operators in the arbiter world', () => (host.units.some((u) => u.key === 'e2e:rang_alt#0') && host.units.some((u) => u.key === 'char_123_fang#1') ? true : undefined));
    for (const s of seats) {
      const { d, theirs } = await matchesArbiter(s.page, stack.room);
      assert.equal(d.hash, theirs, `hash at frame ${d.frame}`);
    }
    assert.equal(await a.page.locator('#modded').textContent(), '装了 mod：e2e 1.0.0');
    assert.equal(await a.page.locator('#modded').isVisible(), true);
    assert.deepEqual(stack.lines.filter((l) => l.startsWith('desync')), []);
    for (const s of seats) assert.deepEqual(s.errors, []);
  });
});
