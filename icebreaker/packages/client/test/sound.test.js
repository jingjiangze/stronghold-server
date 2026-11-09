// The battle page's sound beyond the battle's events (docs/spec/page.md 页面-4): the mate's requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlSounds } from '../src/sound.js';

const C = (/** @type {Partial<{ fast: number[], held: number, asker: number, resuming: number }>} */ x) => ({ fast: [0, 0], held: 0, asker: -1, resuming: 0, ...x });

test('[页面-4] the mate asking to pause, once; this seat\'s own request is silent', () => {
  assert.deepEqual(controlSounds(C({}), C({ asker: 1 }), 0), ['battle.ON_COOPERATE_PAUSE_CONFIRM']);
  assert.deepEqual(controlSounds(C({ asker: 1 }), C({ asker: 1 }), 0), [], 'the same request again');
  assert.deepEqual(controlSounds(C({}), C({ asker: 0 }), 0), [], 'its own');
  assert.deepEqual(controlSounds(null, C({ asker: 1 }), 0), ['battle.ON_COOPERATE_PAUSE_CONFIRM']);
});

test('[页面-4] the mate turning 2× on while this seat\'s is off', () => {
  assert.deepEqual(controlSounds(C({}), C({ fast: [0, 1] }), 0), ['battle.ON_COOPERATE_SPEED_REQUEST']);
  assert.deepEqual(controlSounds(C({ fast: [1, 0] }), C({ fast: [1, 1] }), 0), [], 'already on here: no request');
  assert.deepEqual(controlSounds(C({ fast: [0, 1] }), C({ fast: [0, 1] }), 0), [], 'no change');
  assert.deepEqual(controlSounds(C({}), C({ fast: [1, 0] }), 0), [], 'its own switch');
});
