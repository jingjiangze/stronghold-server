// The room page's icons and music (docs/spec/page.md 页面-5): the atlas's sprites by name, the styles' and the mode's
// icons, the room music bank of an audio index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, MODE } from '@icebreaker/mode-regular';
import { MODE_ICONS, spriteUrl, styleIcon, modeIcon } from '../src/roomart.js';
import { ROOM_MUSIC, roomMusicOf } from '../src/roommusic.js';

const BASE = 'http://host/assets/skeleton/ui/room/';
const sprite = (/** @type {string} */ n) => ({ file: `${n}.webp`, w: 1, h: 1 });
const ATLAS = { sprites: Object.fromEntries(['buff_icon_basic', 'buff_icon_basic_tiny', 'icon_mode_1_color', 'icon_mode_2'].map((n) => [n, sprite(n)])) };

test('[页面-5] a sprite by name; none when the atlas lacks it or there is no atlas', () => {
  assert.equal(spriteUrl(ATLAS, BASE, 'icon_mode_2'), `${BASE}icon_mode_2.webp`);
  assert.equal(spriteUrl(ATLAS, BASE, 'nothing'), null);
  assert.equal(spriteUrl(ATLAS, BASE, 'toString'), null, 'own names only');
  assert.equal(spriteUrl(null, BASE, 'icon_mode_2'), null);
});

test('[页面-5] a style\'s icon by its icon id from the activity table: the full one and the small one', () => {
  assert.deepEqual(STYLES.map((s) => s.icon), ['buff_icon_basic', 'buff_icon_anchoring', 'buff_icon_roaming', 'buff_icon_offensive', 'buff_icon_supportive']);
  assert.deepEqual(STYLES.map((s) => s.color), ['#9A72FF', '#3E64F6', '#37CDB2', '#DE4A27', '#ACCE44'], 'their theme colours');
  assert.equal(styleIcon(ATLAS, BASE, STYLES[0].icon, ''), `${BASE}buff_icon_basic.webp`);
  assert.equal(styleIcon(ATLAS, BASE, STYLES[0].icon, '_tiny'), `${BASE}buff_icon_basic_tiny.webp`);
  assert.equal(styleIcon(ATLAS, BASE, STYLES[1].icon, '_tiny'), null, 'not in this atlas');
});

test('[页面-5] the mode: 常规项目 in its colour, its icon the atlas\'s first mode icon (tinted)', () => {
  assert.deepEqual(MODE, { type: 'NORMAL', name: '常规项目', icon: 'normal', color: '#d2284b' });
  assert.deepEqual(MODE_ICONS, { NORMAL: 'icon_mode_1', FOOTBALL: 'icon_mode_2', DEFENCE: 'icon_mode_3', RAFT: 'icon_mode_4' });
  assert.equal(modeIcon(ATLAS, BASE, MODE.type), `${BASE}icon_mode_1_color.webp`);
  assert.equal(modeIcon(ATLAS, BASE, 'NOT_A_MODE'), null);
});

test('[页面-5] the room music: the audio index\'s sys.ON_MULTIV3_LOADED bank, none without it', () => {
  const bank = { intro: 'm_sys_act1multi_intro.mp3', loop: 'm_sys_act1multi_loop.mp3', volume: 1, crossfade: 1 };
  assert.equal(ROOM_MUSIC, 'sys.ON_MULTIV3_LOADED');
  assert.deepEqual(roomMusicOf({ banks: {}, music: { [ROOM_MUSIC]: bank, 'battle.ON_GAME_READY': bank } }), bank);
  assert.equal(roomMusicOf({ banks: {}, music: { 'battle.ON_GAME_READY': bank } }), null);
  assert.equal(roomMusicOf(null), null);
  assert.equal(roomMusicOf({ music: { [ROOM_MUSIC]: { intro: null } } }), null, 'a bank without a loop');
});
