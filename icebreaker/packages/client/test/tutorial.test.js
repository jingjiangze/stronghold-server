// The training tutorials' places and texts (docs/spec/room.md 房间-11, INF-0023): the script's 1280 × 720 screen from
// its centre, y up, by the screen's width, from a corner by its anchor; the game's colours in its lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenPoint, richHtml } from '../src/tutorial.js';

const box = /** @type {DOMRect} */ ({ left: 0, top: 0, width: 1920, height: 1080 });

test('[房间-11] a script\'s point on the page: from the centre, y up, scaled by width; from a corner by its anchor', () => {
  assert.deepEqual(screenPoint(box, 0, 0), { x: 960, y: 540, k: 1.5 });
  assert.deepEqual(screenPoint(box, -568, -217), { x: 960 - 852, y: 540 + 325.5, k: 1.5 }, 'the lower dialog place');
  assert.deepEqual(screenPoint(box, -130, 60, 'BottomRight'), { x: 1920 - 195, y: 1080 - 90, k: 1.5 }, 'from the bottom right corner');
  const wide = screenPoint(/** @type {DOMRect} */ ({ left: 10, top: 0, width: 1280, height: 600 }), 0, 0, 'TopLeft');
  assert.deepEqual(wide, { x: 10, y: 0, k: 1 }, 'a wider screen: the corners of the field');
});

test('[房间-11] a line\'s rich text as HTML: colours as spans, the rest as text, line breaks kept', () => {
  assert.equal(richHtml('看<color=#0098DC>这里</color>\n<b>'), '看<span style="color:#0098DC">这里</span><br>&#60;b&#62;');
});
