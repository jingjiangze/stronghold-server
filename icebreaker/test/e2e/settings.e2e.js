// End to end: the picture settings (docs/spec/page.md 页面-1) — the tab opens the panel, a choice holds after a reload,
// and with the assets (a field to draw) the FPS readout stays at the cap; with their voices, the dubs they have (页面-4).
// Run with `pnpm run e2e`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openSeat, startStack, until } from './helpers.js';

const ASSETS = process.env['AUE_ASSETS_DIR'] ?? '';
const HAS_VOICES = ASSETS !== '' && existsSync(join(ASSETS, 'skeleton', 'voice', 'index.json'));

describe('picture settings', () => {
  /** @type {Awaited<ReturnType<typeof startStack>>} */ let stack;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {Awaited<ReturnType<typeof openSeat>>} */ let seat;

  before(async () => { stack = await startStack(); browser = await launch(); });
  after(async () => {
    await seat?.context.close().catch(() => {});
    await browser?.close();
    await stack?.stop();
  });

  test('[页面-1] [页面-4] a choice applies, is saved and holds after a reload; the readout follows the cap', async () => {
    seat = await openSeat(browser, stack.port, 0);
    const p = seat.page, pressed = (/** @type {string} */ text) => p.locator('#settings .row button', { hasText: new RegExp(`^${text}$`) }).getAttribute('aria-pressed');
    assert.equal(await p.locator('#settings .panel').evaluate((e) => getComputedStyle(e).display), 'none', 'closed: takes no room, catches no taps');
    await p.locator('#settings > button').click();
    await p.locator('#settings .row', { hasText: '帧率上限' }).locator('button', { hasText: /^30$/ }).click();
    await p.locator('#settings .row', { hasText: '显示帧率' }).locator('button', { hasText: /^开$/ }).click();
    // the dubs the assets' voices have (页面-4): no 配音 row without them
    const dub = p.locator('#settings .row', { hasText: '配音' }), jp = dub.locator('button', { hasText: /^日语$/ });
    if (HAS_VOICES) await until('the dubs', async () => ((await jp.count()) ? true : undefined), 10000).then(() => jp.click());
    else assert.equal(await dub.count(), 0, 'no 配音 row without voices');
    assert.equal(await pressed('30'), 'true');
    await p.reload();
    await p.waitForFunction(() => /** @type {any} */ (globalThis).__battle?.ready(), null, { timeout: 20000 });
    await p.locator('#settings > button').click();
    assert.equal(await pressed('30'), 'true', 'saved on the device');
    if (HAS_VOICES) assert.equal(await until('the dubs', async () => ((await jp.count()) ? jp.getAttribute('aria-pressed') : undefined), 10000), 'true', 'the dub too');
    assert.equal(await p.locator('#fps').evaluate((e) => /** @type {HTMLElement} */ (e).hidden), false, 'the readout is on');
    if (process.env['AUE_ASSETS_DIR']) {
      const fps = await until('a readout', async () => {
        const t = await p.locator('#fps').textContent();
        const n = Number(/(\d+) 帧/.exec(t ?? '')?.[1]);
        return n > 0 ? n : undefined;
      });
      await p.waitForTimeout(1500);
      const later = Number(/(\d+) 帧/.exec((await p.locator('#fps').textContent()) ?? '')?.[1]);
      assert.ok(fps <= 31 && later <= 31 && later >= 10, `${fps}, ${later} frames a second under a 30 cap`);
    }
    assert.deepEqual(seat.errors, []);
  });
});
