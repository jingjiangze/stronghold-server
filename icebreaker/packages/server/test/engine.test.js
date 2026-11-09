// The engine submodule is wired into the workspace: @aue packages resolve as workspace packages, at the pinned version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FPS, secondsToFrames } from '@aue/math';

test('the engine resolves through the workspace', () => {
  assert.equal(FPS, 30);
  assert.equal(secondsToFrames(0.3), 9);
});
