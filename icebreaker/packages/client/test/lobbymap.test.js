// The original lobby screens' mapping (docs/spec/page.md 页面-6): the page and step of a room state, the step's
// countdown and warning, the banners, the stage choose panel, the pick, the lineup's options, the battle's result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageOf, stepOf, countdownOf, bannerOf, stagePanel, ownerStatus, pictureOf, pickView, lineupOptions, resultOf, newLocal, STEP_SCREENS, LINEUP_VIEWS } from '../src/lobbymap.js';
import { pickOf } from '../src/lobbysound.js';
import { pingText, partnerOf } from '../src/roomtext.js';

test('[页面-6] the latency text: the colour of the highest threshold at or under it, in whole ms, at least 1', () => {
  assert.equal(pingText(0.2), '当前延迟<color=#7fa826>1</color>ms');
  assert.equal(pingText(59.4), '当前延迟<color=#7fa826>59</color>ms');
  assert.equal(pingText(60), '当前延迟<color=#ec7a00>60</color>ms');
  assert.equal(pingText(250), '当前延迟<color=#ff3d3d>250</color>ms');
});

test('[页面-6] [房间-9] the page: a result first, the entry page (or its squad or quick match page) without a room, the prepare page in one', () => {
  const L = newLocal();
  assert.deepEqual(L, { sub: 'sel', list: false, squad: false, finish: null, room: false, match: false, train: false });
  assert.equal(pageOf({ view: null }, L), 'entry');
  assert.equal(pageOf({ view: null }, { ...L, squad: true }), 'squad');
  assert.equal(pageOf({ view: null }, { ...L, match: true }), 'match');
  assert.equal(pageOf({ view: null }, { ...L, train: true }), 'train', 'the training room page (房间-11)');
  assert.equal(pageOf({ view: { phase: 'setup' } }, { ...L, train: true }), 'prepare', 'a room ends it');
  assert.equal(pageOf({ view: { phase: 'confirm' } }, { ...L, match: true }), 'prepare', 'a matched room');
  assert.equal(pageOf({ view: { phase: 'setup' } }, { ...L, squad: true }), 'prepare');
  assert.equal(pageOf({ view: { phase: 'setup' } }, { ...L, finish: { match: 'm', result: 1, level: 'x', stamps: [] } }), 'finish');
});

test('[页面-6] the step of each phase: the stage choose panel, the confirm, the pick, the lineup at its sub-step, still the lineup while the match starts', () => {
  const L = newLocal();
  assert.deepEqual(['setup', 'confirm', 'pick', 'battle', 'other'].map((phase) => stepOf({ phase }, L)), ['stage', 'confirm', 'pick', L.sub, 'stage']);
  assert.equal(stepOf({ phase: 'lineup' }, { ...L, sub: 'skill' }), 'skill');
  for (const s of ['stage', 'confirm', 'pick', 'sel', 'skill', 'check']) assert.ok(/** @type {Record<string, string>} */ (STEP_SCREENS)[s], s);
  assert.deepEqual(Object.keys(LINEUP_VIEWS), ['sel', 'skill', 'check']);
});

test('[页面-6] a step\'s countdown: its time left of its whole, warning from the activity\'s hintTime; none in 项目调整', () => {
  assert.deepEqual(countdownOf({ phase: 'confirm', step: 30000 }, 5000), { left: 25000, total: 30000, warn: false });
  assert.deepEqual(countdownOf({ phase: 'confirm', step: 30000 }, 20000), { left: 10000, total: 30000, warn: true }, '10 s: ENTRANCE hintTime');
  assert.equal(countdownOf({ phase: 'pick', step: 20000 }, 16000)?.warn, false, '4 s left, CHAR_PICK hintTime 3');
  assert.equal(countdownOf({ phase: 'lineup', step: 4000 }, 9000)?.left, 0, 'never below 0');
  assert.equal(countdownOf({ phase: 'setup', step: 0 }, 0), null);
});

test('[页面-6] the banners: first or second pick on entering the pick, no coordination or the lineup on entering the lineup', () => {
  const v = (/** @type {string} */ phase, by = 0) => ({ phase, you: 0, picking: phase === 'pick' ? { by } : null });
  assert.equal(bannerOf('confirm', v('pick', 0)), 'first');
  assert.equal(bannerOf('confirm', v('pick', 1)), 'second');
  assert.equal(bannerOf('confirm', v('lineup')), 'skip');
  assert.equal(bannerOf('pick', v('lineup')), 'lineup');
  assert.equal(bannerOf('pick', v('pick')), null, 'no change of phase');
  assert.equal(bannerOf(null, v('lineup')), null, 'a page that joins in the lineup');
  assert.equal(bannerOf('setup', v('confirm')), null);
  assert.equal(bannerOf('confirm', { phase: 'pick', you: 0, picking: null }), null);
});

test('[页面-6] the stage choose panel: owner or guest, the guest prepared, the owner may go on; the owner\'s status', () => {
  const one = { you: 0, prepared: false, members: [{}] }, two = { you: 0, prepared: false, members: [{}, {}] }, ready = { ...two, prepared: true };
  assert.deepEqual(stagePanel(one), { owner: true, prepared: false, canEnter: false, full: false });
  assert.deepEqual(stagePanel(ready), { owner: true, prepared: true, canEnter: true, full: true });
  assert.equal(stagePanel({ ...ready, you: 1 }).owner, false);
  assert.deepEqual([one, two, ready].map(ownerStatus), ['等待协作者加入项目...', '等待协作者准备...', '协作者已准备，可以进入备赛']);
});

test('[页面-6] a stage\'s picture by its previewIconId, none for a stage or art without it', () => {
  const art = { stageBig: { 'multi_v3_01-01_preview': 'sprite/stage_big/multi_v3_01-01_preview' } };
  assert.equal(pictureOf(art, 'act1multi_01'), 'sprite/stage_big/multi_v3_01-01_preview');
  assert.equal(pictureOf(art, 'act1multi_06'), null, 'not in this art');
  assert.equal(pictureOf(art, 'not_a_stage'), null);
  assert.equal(pictureOf(null, 'act1multi_01'), null);
});

test('[页面-6] [房间-4] the pick as a player sees it: its turn, handing over while two are left and not just handed', () => {
  const picking = { by: 0, yielded: false, left: ['a', 'b'], won: [['x'], ['y', 'z']] };
  assert.deepEqual(pickView({ you: 0, picking }), { mine: true, yielded: false, canYield: true, left: ['a', 'b'], kept: ['x'], theirs: ['y', 'z'] });
  assert.equal(pickView({ you: 1, picking }).canYield, false, 'not its turn');
  assert.equal(pickView({ you: 0, picking: { ...picking, yielded: true } }).canYield, false);
  assert.equal(pickView({ you: 0, picking: { ...picking, left: ['a'] } }).canYield, false);
});

test('[页面-6] [房间-5] the lineup\'s options in order: kept, drawn, then the extra ones with the recruits marked', () => {
  assert.deepEqual(lineupOptions({ kept: ['k'], drawn: ['d'], extra: ['r', 'e'] }, new Set(['r'])),
    [{ id: 'k', tag: 'kept' }, { id: 'd', tag: 'drawn' }, { id: 'r', tag: 'recruit' }, { id: 'e', tag: 'extra' }]);
});

test('[页面-6] the battle page\'s result: read when whole, else none', () => {
  assert.deepEqual(resultOf('{"match":"m1","result":1,"level":"act1multi_01","stamps":[1,"2"]}'), { match: 'm1', result: 1, level: 'act1multi_01', stamps: [1, 2] });
  assert.deepEqual(resultOf('{"match":"m1","result":0,"stamps":[]}'), { match: 'm1', result: 0, level: '', stamps: [] });
  for (const bad of [null, '', '{', '{"match":1,"result":1,"stamps":[]}', '{"match":"m","result":"1","stamps":[]}', '{"match":"m","result":1}', 'null']) assert.equal(resultOf(bad), null, String(bad));
});

test('[页面-6] a UI sound of a bank: by weight (all 0: alike), pitch and volume within their ranges; none for an empty bank', () => {
  const s = (/** @type {string} */ file, /** @type {number} */ weight) => ({ file, weight, delay: 0.1, pitch: [1, 1], volume: [0.5, 1] });
  const seq = (/** @type {number[]} */ xs) => { let i = 0; return () => xs[i++] ?? 0; };
  const bank = { sounds: [s('a', 1), s('b', 3)], max: 0, popOldest: false, loop: false };
  assert.deepEqual(pickOf(bank, seq([0.2, 0, 1])), { file: 'a', delay: 0.1, pitch: 1, volume: 1 });
  assert.equal(pickOf(bank, seq([0.3, 0, 0]))?.file, 'b');
  const even = { ...bank, sounds: [s('a', 0), s('b', 0)] };
  assert.deepEqual([pickOf(even, seq([0.4]))?.file, pickOf(even, seq([0.6]))?.file], ['a', 'b']);
  assert.equal(pickOf({ ...bank, sounds: [] }, Math.random), null);
});

test('[页面-6] a result keeps when its match ended; the finish view writes the time as the original does', async () => {
  const { finishTime } = await import('../src/lobbyfinish.js');
  assert.deepEqual(resultOf(JSON.stringify({ match: 'm', result: 1, level: 'act1multi_01', stamps: [1, 2], at: 5 })), { match: 'm', result: 1, level: 'act1multi_01', stamps: [1, 2], at: 5 });
  assert.equal(resultOf(JSON.stringify({ match: 'm', result: 1, stamps: [], at: 'x' }))?.at, undefined);
  assert.equal(finishTime(new Date(2026, 9, 17, 8, 7, 4)), '2026/10/17 08:07:04');
});

test('[房间-13] a 堡垒守御 result: its difficulty, the stamps of the waves defended, those waves and the last wave\'s damage', () => {
  const raw = JSON.stringify({ match: 'm', result: 1, level: 'act1multi_fortress_rm01', difficulty: 'FOUR_STAR', stamps: [2], fortress: { defended: 5, damage: 123456 }, at: 9 });
  assert.deepEqual(resultOf(raw), { match: 'm', result: 1, level: 'act1multi_fortress_rm01', difficulty: 'FOUR_STAR', stamps: [2], fortress: { defended: 5, damage: 123456 }, at: 9 });
  assert.equal(resultOf(JSON.stringify({ match: 'm', result: 0, level: 'x', stamps: [], fortress: { damage: 1 } }))?.fortress, undefined, 'no waves: none');
});

test('[房间-1] 我的搭档：两座局是另一位，四座局是同奇偶那一席（与引擎 coop.partnerOf 同一条规则）', () => {
  assert.deepEqual([partnerOf(0, 2), partnerOf(1, 2)], [1, 0], '两座：互为搭档');
  assert.deepEqual([partnerOf(0, 4), partnerOf(1, 4), partnerOf(2, 4), partnerOf(3, 4)], [2, 3, 0, 1], '四座：0/2 一队、1/3 一队');
  assert.deepEqual([partnerOf(0, 3), partnerOf(1, 3), partnerOf(2, 3)], [2, -1, 0], '三座：奇席位落单，没有搭档');
  assert.equal(partnerOf(0, 1), -1, '一个人：没有搭档');
});
