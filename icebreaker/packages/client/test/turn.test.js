// Phones (docs/spec/page.md 页面-7): a touch screen held upright turns; a point and a rect of the screen in the turned
// frame (x down the screen, y from its right edge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnedPoint, turnedRect, wantsTurn } from '../src/turn.js';

test('[页面-7] only a touch screen held upright turns', () => {
  assert.deepEqual([wantsTurn({ coarse: true, w: 412, h: 839 }), wantsTurn({ coarse: true, w: 839, h: 412 }), wantsTurn({ coarse: false, w: 412, h: 839 })], [true, false, false]);
});

test('[页面-7] a point and a rect of the screen in the turned frame', () => {
  // a screen 412 wide: its top right corner is the frame's origin, its left edge the frame's bottom
  assert.deepEqual(turnedPoint(412, 0, 412), [0, 0]);
  assert.deepEqual(turnedPoint(0, 839, 412), [839, 412]);
  assert.deepEqual(turnedPoint(100, 300, 412), [300, 312]);
  assert.deepEqual(turnedRect({ left: 100, top: 300, width: 50, height: 20 }, 412), { left: 300, top: 262, width: 20, height: 50 });
  const r = turnedRect({ left: 100, top: 300, width: 50, height: 20 }, 412), [x, y] = turnedPoint(150, 300, 412);
  assert.deepEqual([x === r.left, y === r.top], [true, true], 'the rect\'s top-right corner on the screen is its top-left in the frame');
});
