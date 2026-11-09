// The battle page's marks and emotes (docs/spec/room.md 房间-12): an emote's picture, the mate's operator on a tile,
// the marks shown now with the tile dragged over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emotePicture, mateOn, liveMarks } from '../src/battlesignals.js';

test('[房间-12] an emote\'s picture in its theme\'s folder; none without the index or the emote', () => {
  const art = { base: '/a/', index: { emotes: { e1: { pic: 'pic_thanks_battle' } } } };
  assert.equal(emotePicture(art, 't1', 'e1'), '/a/t1/pic_thanks_battle.webp');
  assert.equal(emotePicture(art, 't1', 'e2'), null);
  assert.equal(emotePicture(null, 't1', 'e1'), null);
});

test('[房间-12] the mate\'s operator on a tile: an operator of the mate standing there with HP', () => {
  const u = (/** @type {Record<string, number>} */ o) => ({ kind: 0, owner: 1, hp: 10, x: 3, y: 2, ...o });
  const view = /** @type {any} */ ({ units: [u({}), u({ x: 5, owner: 0 }), u({ x: 6, kind: 1 }), u({ x: 7, hp: 0 })] });
  assert.deepEqual([mateOn(view, 1, 2, 3), mateOn(view, 1, 2, 5), mateOn(view, 1, 2, 6), mateOn(view, 1, 2, 7), mateOn(null, 1, 2, 3)], [true, false, false, false, false]);
});

test('[房间-12] the marks shown: those whose time has not run out, and the tile dragged over as this seat\'s', () => {
  const m = (/** @type {string} */ id, /** @type {number} */ until) => ({ id, seat: 1, row: 0, col: 0, type: 0, until });
  assert.deepEqual(liveMarks([m('a', 5), m('b', 15)], 10, null).map((x) => x.id), ['b']);
  assert.deepEqual(liveMarks([], 10, { row: 2, col: 4 }).map((x) => [x.seat, x.row, x.col]), [[-1, 2, 4]]);
});
