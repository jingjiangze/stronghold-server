// What the original battle UI shows, worked out from a frame (the engine's docs/spec/ui.md 界面-10…14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND, SKILL_STATE, STATUS_BIT } from '@aue/schema';
import { deckCards, battleSpeed, hudState, menuSkill, ownUnitAt, requestsAfter, taskOf, costInput, unitBars, stageStartOf, fortressOf, partnerOf, seatOrder } from '../src/battlehud.js';

/** A view unit. @param {Record<string, number>} v @returns {import('@aue/schema').ViewUnit} */
const unit = (v) => ({ id: 1, kind: KIND.OPERATOR, owner: 0, x: 2, y: 3, z: 0, dir: 0, hp: 10, maxHp: 10, anim: 0, sp: 5, spCost: 20, skill: SKILL_STATE.CHARGING, skillLeft: -1, status: 0, element: 0, ep: 1, burst: 0, ...v });

test('the deck as cards: avatar, profession, rarity from the roster, elite phase from the build, 再部署时间', () => {
  const match = /** @type {any} */ ({ decks: [[{ id: 'char_122_beagle#0', build: { elite: 2 } }, { id: 'x#0', build: { elite: 0 } }]] });
  const content = { decks: [['char_122_beagle#0', 'x#0']], operators: { 'char_122_beagle#0': { char: 'char_122_beagle', profession: 'TANK', respawnTime: 70 }, 'x#0': {} } };
  const cards = deckCards(match, content, 0, (c) => (c === 'char_122_beagle' ? `/avatar/${c}.png` : null));
  assert.deepEqual(cards[0], { id: 'char_122_beagle#0', avatar: '/avatar/char_122_beagle.png', profession: 'TANK', rarity: 3, phase: 2, respawn: 70 });
  assert.deepEqual(cards[1], { id: 'x#0', avatar: null, profession: '', rarity: 1, phase: 0, respawn: 60 });
  assert.deepEqual(deckCards(match, { operators: {} }, 1, () => null), []);
});

test('the deck with its operators\' summon cards, put in by cost and id (the engine\'s 界面-23)', () => {
  const match = /** @type {any} */ ({ decks: [[{ id: 'a#0', build: { elite: 2 } }, { id: 'b#0', build: { elite: 1 } }]] });
  const summon = (/** @type {string} */ owner, /** @type {number} */ cost, /** @type {number} */ supply) => ({ char: 'token_x', profession: 'TOKEN', cost, respawnTime: 10, summoner: owner, summon: { supply } });
  const content = { decks: [['a#0', 'b#0']], operators: { 'a#0': { cost: 10 }, 'b#0': { cost: 20 }, 't#0': summon('a#0', 12, 2), 'u#0': summon('a#0', 5, 0), 'v#1': summon('c#1', 1, 1),
    'g#0': { ...summon('b#0', 25, 0), summon: { supply: 0, grant: { n: 1, at: 'start' } } } } };
  const cards = deckCards(match, content, 0, (c) => `/avatar/${c}.png`);
  assert.deepEqual(cards.map((c) => c.id), ['a#0', 't#0', 'b#0', 'g#0'], 'a summon with a card (its talent\'s count or its skill\'s copies), by cost; none without a card or of another seat');
  assert.deepEqual(cards[1], { id: 't#0', avatar: '/avatar/token_x.png', profession: 'TOKEN', rarity: 1, phase: 0, respawn: 10, summon: true });
});

test('the speed: 2× only when every seat has its switch on (同步-7)', () => {
  assert.equal(battleSpeed(null), 1);
  assert.equal(battleSpeed({ fast: [1, 0], held: 0, asker: -1, resuming: 0 }), 1);
  assert.equal(battleSpeed({ fast: [1, 1], held: 0, asker: -1, resuming: 0 }), 2);
  assert.equal(battleSpeed({ fast: [], held: 0, asker: -1, resuming: 0 }), 1);
});

test('the HUD\'s state of a frame: the deck, the cost and its next point, lives, speed, pause; the co-op sides', () => {
  const view = { frame: 90, players: [{ life: 3, cost: 12 }, { life: 2, cost: 4 }], units: [] };
  const ps = (/** @type {number} */ revive) => ({ costTimer: 10, deployed: ['a'], slots: 7, cards: { a: { cost: 9, ready: 0 } }, summons: {}, revive, ask: -1, askCd: 0 });
  const status = /** @type {any} */ ({ players: [ps(-1), ps(45)] });
  const s = hudState({ view, status, control: { fast: [1, 0], held: 1, asker: -1, resuming: 0 }, seat: 0, options: { costIncreaseTime: 1, maxCost: 99 }, selected: 'b' });
  assert.deepEqual({ ...s, coop: undefined }, { frame: 90, fps: 30, cost: 12, cards: { a: { cost: 9, ready: 0 } }, deployed: ['a'], slots: 7, summons: {}, costTimer: 10, costPeriod: 30,
    maxCost: 99, selected: 'b', life: 3, speed: 1, paused: true, coop: undefined, states: { result: undefined, down: false, offline: false }, stageStart: null });
  assert.deepEqual(s.coop, { me: { life: 3, fast: true, revive: -1 }, mate: { life: 2, fast: false, revive: 1.5 },
    sides: [{ life: 3, fast: true, revive: -1 }, { life: 2, fast: false, revive: 1.5 }], score: undefined, speed: 1, paused: true, asking: -1, confirm: -1, task: null,
    cost: { state: 'forbid', amount: 15, share: 0, wait: 0 } }, 'the mate down: no cost request');
  const alone = hudState({ view: { ...view, players: [view.players[0]] }, status, control: null, seat: 0, options: { costIncreaseTime: 2, maxCost: 10 }, selected: null });
  assert.equal(alone.coop, undefined);
  assert.equal(alone.costPeriod, 60);
});

test('2v2 的比分：两队剩余生命合计，两人局没有（顶栏那条比分组保持隐藏）', () => {
  const ps = (/** @type {number} */ revive) => ({ costTimer: 10, deployed: [], slots: 7, cards: {}, summons: {}, revive, ask: -1, askCd: 0 });
  const view = { frame: 90, players: [{ life: 15, cost: 12 }, { life: 12, cost: 4 }, { life: 13, cost: 8 }, { life: 15, cost: 0 }], units: [] };
  const status = /** @type {any} */ ({ players: [ps(-1), ps(-1), ps(-1), ps(-1)] });
  const four = (/** @type {number} */ seat) => hudState({ view, status, control: null, seat, options: { costIncreaseTime: 1, maxCost: 99 }, selected: null }).coop;
  // 偶席位（0/2）一队 28，奇席位（1/3）一队 27；站在哪一席，mine 就是哪一队
  assert.deepEqual([0, 2, 1, 3].map((s) => four(s)?.score), [{ mine: 28, theirs: 27 }, { mine: 28, theirs: 27 }, { mine: 27, theirs: 28 }, { mine: 27, theirs: 28 }]);
  // 两人局：不比，比分组不出现
  const two = hudState({ view: { ...view, players: view.players.slice(0, 2) }, status, control: null, seat: 0, options: { costIncreaseTime: 1, maxCost: 99 }, selected: null }).coop;
  assert.equal(two?.score, undefined);
});

test('the seats the top bar shows: me, then my partner, then the rest (a match of four pairs by parity)', () => {
  assert.deepEqual(seatOrder(0, 2), [0, 1], 'a match of two: the other seat');
  assert.deepEqual(seatOrder(1, 2), [1, 0]);
  assert.deepEqual(seatOrder(0, 4), [0, 2, 1, 3], 'a match of four: me, the partner (same parity), then the two others');
  assert.deepEqual(seatOrder(3, 4), [3, 1, 0, 2]);
  assert.deepEqual(seatOrder(0, 1), [0], 'alone');
  assert.equal(partnerOf(0, 4), 2);
  assert.equal(partnerOf(1, 4), 3);
  assert.equal(partnerOf(0, 1), -1);
});

test('the operator menu\'s skill: icon, charging, ready, running with the time left, stoppable; none without a skill', () => {
  const op = { skill: { id: 'skchr_beagle_1', type: 'MANUAL', duration: 10, stoppable: false } }, icons = { skchr_beagle_1: 'skchr_beagle_1.webp' }, base = 'http://h/skills/';
  assert.deepEqual(menuSkill(unit({}), op, icons, base), { icon: 'http://h/skills/skchr_beagle_1.webp', manual: true, state: 'charging', share: 0.25, stoppable: false, blocked: false });
  assert.deepEqual([STATUS_BIT.freeze, STATUS_BIT.stun, STATUS_BIT.silence, STATUS_BIT.cold].map((b) => menuSkill(unit({ status: b | STATUS_BIT.weaken }), op, icons, base)?.blocked),
    [true, true, true, false], 'frozen, stunned, silenced: blocked; cold: not');
  assert.equal(menuSkill(unit({ skill: SKILL_STATE.READY }), op, icons, base)?.state, 'ready');
  assert.equal(menuSkill(unit({ skill: SKILL_STATE.READY }), op, icons, base)?.share, 1);
  const run = menuSkill(unit({ skill: SKILL_STATE.RUNNING, skillLeft: 150 }), { skill: { ...op.skill, type: 'AUTO', stoppable: true } }, icons, base);
  assert.deepEqual([run?.state, run?.share, run?.manual, run?.stoppable], ['running', 0.5, false, true]);
  assert.equal(menuSkill(unit({ skill: SKILL_STATE.RUNNING, skillLeft: -1 }), { skill: { ...op.skill, duration: 0 } }, icons, base)?.share, 1, 'no duration: full');
  assert.equal(menuSkill(unit({}), { skill: { ...op.skill, id: 'other' } }, icons, base)?.icon, null, 'no icon in the assets');
  assert.equal(menuSkill(unit({ spCost: 0 }), op, icons, base)?.share, 0);
  assert.equal(menuSkill(unit({ skill: SKILL_STATE.NONE }), op, icons, base), null);
  assert.equal(menuSkill(unit({}), {}, icons, base), null);
});

test('this seat\'s operator on a tile', () => {
  const view = { frame: 0, players: [], units: [unit({ id: 4, x: 2.04, y: 2.98 }), unit({ id: 5, owner: 1, x: 5, y: 5 }), unit({ id: 6, kind: KIND.ENEMY, x: 1, y: 1 })] };
  assert.equal(ownUnitAt(view, 0, { row: 3, col: 2 })?.id, 4);
  assert.equal(ownUnitAt(view, 0, { row: 5, col: 5 }), null, 'the mate\'s');
  assert.equal(ownUnitAt(view, 0, { row: 1, col: 1 }), null, 'an enemy');
});

test('the requests remembered: the last answer to this seat, since when the pause request is open', () => {
  const r0 = { answer: null, pauseSince: -1, now: 0 }, open = { fast: [0, 0], held: 0, asker: 1, resuming: 0 };
  const r1 = requestsAfter(r0, { events: [{ type: 'answer', owner: 1, accept: 1, amount: 3 }], control: open, seat: 0, frame: 10, now: 500 });
  assert.deepEqual(r1, { answer: null, pauseSince: 500, now: 500 }, 'an answer to the mate is not ours');
  const r2 = requestsAfter(r1, { events: [{ type: 'answer', owner: 0, accept: 0, amount: 0 }], control: open, seat: 0, frame: 12, now: 900 });
  assert.deepEqual(r2, { answer: { accept: 0, amount: 0, frame: 12 }, pauseSince: 500, now: 900 });
  assert.equal(requestsAfter(r2, { events: [], control: { ...open, held: 1 }, seat: 0, frame: 13, now: 950 }).pauseSince, -1, 'paused: no request open');
  assert.equal(requestsAfter(r2, { events: [], control: null, seat: 0, frame: 13, now: 950 }).pauseSince, -1);
});

test('the task of the stage: none before the first, the rest left, the time left, the advanced goal', () => {
  const stages = [{ objective: 'protect', goal: 4, time: 150 }, { objective: 'kill', goal: 3, advanced: 5, time: 60 }];
  assert.equal(taskOf(/** @type {any} */ ({ stage: -1, start: 0, count: 0 }), stages, 0), null);
  assert.deepEqual(taskOf(/** @type {any} */ ({ stage: 0, start: 300, count: 1 }), stages, 150), { stage: 1, objective: 'protect', count: 1, goal: 4, left: 5 });
  assert.deepEqual(taskOf(/** @type {any} */ ({ stage: 1, start: 300, count: 2 }), stages, 600), { stage: 2, objective: 'kill', count: 2, goal: 3, advanced: 5, left: 50 });
  assert.equal(taskOf(/** @type {any} */ ({ stage: 1, start: 0, count: 0 }), stages, 99999)?.left, 0);
});

test('the inputs of the cost request (合作-5): open requests, the wait, whether this seat may ask, the cap, what the request of the mate takes', () => {
  const view = { frame: 300, players: [{ life: 3, cost: 12 }, { life: 3, cost: 95 }], units: [] };
  const p = (/** @type {Record<string, number>} */ v) => ({ costTimer: 0, deployed: [], slots: 8, cards: {}, revive: -1, ask: -1, askCd: 0, ...v });
  const st = (/** @type {any} */ a, /** @type {any} */ b) => /** @type {any} */ ({ players: [p(a), p(b)] });
  const base = { view, seat: 0, options: { maxCost: 99 } };
  const c = costInput({ ...base, status: st({}, {}), requests: { answer: { accept: 1, amount: 4, frame: 240 }, pauseSince: -1, now: 0 } });
  assert.deepEqual(c, { mine: -1, mates: -1, cooldown: 0, canAsk: true, cap: 15, give: 4, answer: { accept: 1, amount: 4, ago: 2 }, fps: 30, open: 450 });
  assert.equal(costInput({ ...base, options: { maxCost: 99, costTransfer: 25 }, status: st({}, {}) }).cap, 25);
  assert.equal(costInput({ ...base, status: st({ askCd: 10 }, {}) }).canAsk, false, 'cooling down');
  assert.equal(costInput({ ...base, status: st({}, { revive: 30 }) }).canAsk, false, 'the mate down');
  assert.equal(costInput({ ...base, status: st({}, { ask: 100 }) }).canAsk, false, 'a request open');
  assert.equal(costInput({ ...base, view: { ...view, players: [{ life: 3, cost: 99 }, view.players[1]] }, status: st({}, {}) }).canAsk, false, 'cost full');
});

test('the co-op state: the time left of a pause request for the asker and the mate, the task, the cost request', () => {
  const view = { frame: 90, players: [{ life: 3, cost: 12 }, { life: 2, cost: 4 }], units: [] };
  const ps = { costTimer: 10, deployed: [], slots: 7, cards: {}, revive: -1, ask: -1, askCd: 0 };
  const status = /** @type {any} */ ({ stage: 0, start: 0, count: 1, players: [ps, ps] });
  const req = { answer: null, pauseSince: 1000, now: 4000 };
  const mine = hudState({ view, status, control: { fast: [0, 0], held: 0, asker: 0, resuming: 0 }, seat: 0, options: { costIncreaseTime: 1, maxCost: 99 }, selected: null,
    stages: [{ objective: 'kill', goal: 5, time: 100 }], requests: req }).coop;
  assert.deepEqual([mine?.asking, mine?.confirm, mine?.task?.goal, mine?.cost?.state], [0.8, -1, 5, 'none']);
  const theirs = hudState({ view, status, control: { fast: [0, 0], held: 0, asker: 1, resuming: 0 }, seat: 0, options: { costIncreaseTime: 1, maxCost: 99 }, selected: null, requests: req }).coop;
  assert.deepEqual([theirs?.asking, theirs?.confirm, theirs?.task], [-1, 0.8, null]);
});

test('the units\' bars: the drawn units at their feet, operator, enemy or leader, the HP share, the skill, the element', () => {
  const view = /** @type {any} */ ({ frame: 0, players: [], units: [
    unit({ id: 1, hp: 5, sp: 10, element: 3, ep: 0.25 }), unit({ id: 2, kind: KIND.ENEMY, hp: 30, maxHp: 20, element: 2, ep: 0.5, burst: 1 }),
    unit({ id: 3, kind: KIND.ENEMY, hp: -1 }), unit({ id: 4, kind: KIND.ENEMY }), unit({ id: 5, skill: SKILL_STATE.NONE }),
  ] });
  const keys = new Map([[1, 'op#0'], [2, 'slug#1'], [3, 'boss#2'], [4, 'slug#3'], [5, 'op#0']]);
  const bars = unitBars(view, { leaders: new Set(['boss']), keyOf: (id) => keys.get(id)?.split('#')[0], shows: (id) => id !== 4, at: (u) => [u.x * 10, u.y * 10],
    operators: { 'op#0': { skill: { id: 's', duration: 10 } } }, unitKey: (id) => keys.get(id) });
  assert.deepEqual(bars.map((b) => b.id), [1, 2, 3, 5], 'only the drawn ones');
  assert.deepEqual(bars[0], { id: 1, at: [20, 30], kind: 'char', hp: 0.5, sp: { state: 'charging', share: 0.5 }, el: { element: 3, share: 0.25, burst: false }, mark: null });
  assert.deepEqual([bars[1].kind, bars[1].hp, bars[1].sp, bars[1].el], ['enemy', 1, null, { element: 2, share: 0.5, burst: true }]);
  assert.deepEqual([bars[2].kind, bars[2].hp, bars[2].el], ['boss', 0, null]);
  assert.equal(bars[3].sp, null, 'no skill, no SP bar');
});

test('the units\' bars: this seat\'s operators their skill mark — ready by hand, stoppable while running; none blocked, auto or the mate\'s', () => {
  const manual = { skill: { id: 's', type: 'MANUAL', duration: 10, stoppable: true } }, auto = { skill: { id: 'a', type: 'AUTO', duration: 10 } };
  const view = /** @type {any} */ ({ frame: 0, players: [], units: [unit({ id: 1, skill: SKILL_STATE.READY }), unit({ id: 2, skill: SKILL_STATE.RUNNING, skillLeft: 30 }),
    unit({ id: 3, skill: SKILL_STATE.READY, status: STATUS_BIT.freeze }), unit({ id: 4, skill: SKILL_STATE.READY }), unit({ id: 5, owner: 1, skill: SKILL_STATE.READY }),
    unit({ id: 6, skill: SKILL_STATE.CHARGING })] });
  const keys = new Map([[1, 'm'], [2, 'm'], [3, 'm'], [4, 'a'], [5, 'm'], [6, 'm']]);
  const bars = unitBars(view, { leaders: new Set(), keyOf: (id) => keys.get(id), shows: () => true, at: (u) => [u.x, u.y], operators: { m: manual, a: auto }, unitKey: (id) => keys.get(id), seat: 0 });
  assert.deepEqual(bars.map((b) => b.mark), ['ready', 'stop', null, null, null, null]);
});

test('the units\' bars of level devices (engine 装置-3): one on our side has an operator\'s bar with no SP, one on the enemies\' side an enemy\'s', () => {
  const view = /** @type {any} */ ({ frame: 0, players: [], units: [unit({ id: 1, kind: KIND.DEVICE, owner: -1 }), unit({ id: 2, kind: KIND.DEVICE, owner: -1 })] });
  const keys = new Map([[1, 'wall'], [2, 'flag']]);
  const bars = unitBars(view, { leaders: new Set(), foeDevices: new Set(['flag']), keyOf: (id) => keys.get(id), shows: () => true, at: (u) => [u.x, u.y],
    operators: {}, unitKey: (id) => keys.get(id) });
  assert.deepEqual(bars.map((b) => [b.kind, b.sp]), [['char', null], ['enemy', null]]);
});

test('a stage that has just begun, with its task texts: within a second of its start; none in its rest, later, or without texts', () => {
  const stages = [{ task: { title: '营救', basic: '保护4位' } }, { task: { title: '营救', basic: '保护3位', advanced: '保护5位' } }, {}];
  const st = (/** @type {number} */ stage, /** @type {number} */ start) => /** @type {any} */ ({ stage, start });
  assert.deepEqual(stageStartOf(st(0, 0), stages, 0), { stage: 1, title: '营救', basic: '保护4位' });
  assert.deepEqual(stageStartOf(st(1, 300), stages, 310), { stage: 2, title: '营救', basic: '保护3位', advanced: '保护5位' });
  assert.deepEqual([stageStartOf(st(1, 300), stages, 290), stageStartOf(st(1, 300), stages, 330), stageStartOf(st(2, 0), stages, 0)], [null, null, null]);
  assert.equal(stageStartOf(st(0, 0), stages, 0, { training: true, waves: 0 })?.training, true, 'a training\'s (the engine\'s 界面-40)');
});

test('[房间-13] a 堡垒守御 wave whose defence has just begun (the engine\'s 界面-40): its number of the level\'s waves, the last or not; none in a rest or later', () => {
  const at = (/** @type {Record<string, any>} */ f) => /** @type {any} */ ({ stage: 0, start: 0, fortress: { phase: 'defend', wave: 0, start: 100, ...f } });
  const o = { training: false, waves: 7 };
  assert.deepEqual(stageStartOf(at({}), [], 110, o), { stage: 1, title: '', basic: '', defence: { wave: 1, waves: 7, last: false } });
  assert.deepEqual(stageStartOf(at({ wave: 6, start: 900 }), [], 900, o)?.defence, { wave: 7, waves: 7, last: true });
  assert.deepEqual([stageStartOf(at({ phase: 'rest' }), [], 110, o), stageStartOf(at({}), [], 140, o), stageStartOf(at({}), [], 90, o)], [null, null, null]);
});


test('[房间-13] 堡垒守御 on the HUD (the engine\'s 界面-39): the builders as counted cards, their counts, the wave and the rest panel', () => {
  const match = /** @type {any} */ ({ decks: [[]] });
  const content = { decks: [['w#0']], operators: { 'w#0': { char: 'trap_166_muwork', profession: 'TRAP', respawnTime: 0, builder: { sp: 'sp', hits: 5, life: 6 } } } };
  assert.deepEqual(deckCards(match, content, 0, () => null)[0], { id: 'w#0', avatar: null, profession: 'TRAP', rarity: 1, phase: 0, respawn: 0, pool: true });
  const fortress = { phase: 'rest', wave: 2, until: 300, defended: 3, stamps: 1, damage: 0, ready: [false, true], pools: [{ 'w#0': 4 }, { 'w#1': 1 }], total: 9, out: 9, levels: {} };
  const view = { frame: 90, players: [{ life: 3, cost: 12 }, { life: 2, cost: 4 }], units: [] };
  const ps = { costTimer: 10, deployed: [], slots: 7, cards: {}, summons: {}, revive: -1, ask: -1, askCd: 0 };
  const status = /** @type {any} */ ({ players: [ps, ps], fortress });
  const s = hudState({ view, status, control: null, seat: 0, options: { costIncreaseTime: 1, maxCost: 99 }, selected: null, waves: 8 });
  assert.deepEqual([s.counts, s.building], [{ 'w#0': 4 }, true]);
  assert.deepEqual(s.coop?.fortress, { wave: 4, waves: 8, out: 0, total: 0, left: 7, last: false, damage: 0 }, 'in a rest after the third wave: the fourth, the rest left');
  assert.deepEqual(s.coop?.resting, { left: 7, me: false, mate: true });
  const last = fortressOf(/** @type {any} */ ({ fortress: { ...fortress, phase: 'defend', wave: 7, out: 1, total: 1, damage: 5e5 } }), 8, 90, 1);
  assert.deepEqual([last.fortress?.last, last.fortress?.damage, last.resting], [true, 5e5, null]);
  assert.deepEqual(fortressOf(/** @type {any} */ ({}), 8, 0, 0), {});
});

test('[页面-10] an operator a host\'s mod adds: its card from the roster the page made from the host\'s mods', () => {
  const match = /** @type {any} */ ({ decks: [[{ id: 'mine:alt#0', build: { elite: 1 } }]] });
  const content = { decks: [['mine:alt#0']], operators: { 'mine:alt#0': { char: 'mine:alt', look: 'char_010_chen', respawnTime: 70 } } };
  const roster = { 'mine:alt': { profession: 'WARRIOR', rarity: 5 } };
  assert.deepEqual(deckCards(match, content, 0, (c) => `/avatar/${c}.png`, roster)[0], { id: 'mine:alt#0', avatar: '/avatar/mine:alt.png', profession: 'WARRIOR', rarity: 5, phase: 1, respawn: 70 });
  assert.equal(deckCards(match, content, 0, () => null)[0].rarity, 1, 'not in the official roster');
});
