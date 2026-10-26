// The room page's music (docs/spec/page.md 页面-5): the activity's menu music, the audio index's music bank
// sys.ON_MULTIV3_LOADED — its intro, then its loop from the intro's end, at the bank's volume times the player's music
// volume. A browser lets a page sound only after the player touched it, so it starts on the first touch or key; it
// fades out over the bank's crossfade when the page leaves for a battle. Without the bank the page is silent.
import { audioContext } from './sound.js';

/** The bank the room page plays. */
export const ROOM_MUSIC = 'sys.ON_MULTIV3_LOADED';

/** @typedef {{ intro: string | null, loop: string, volume: number, crossfade: number }} MusicBank */

/** The room music bank of an audio index, or null. @param {any} index @returns {MusicBank | null} */
export function roomMusicOf(index) {
  const m = index?.music?.[ROOM_MUSIC];
  return m && typeof m.loop === 'string' ? m : null;
}

/** A file's decoded audio, or null. @param {AudioContext} ctx @param {string} url */
const decoded = (ctx, url) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? ctx.decodeAudioData(b) : null)).catch(() => null);

/**
 * The room page's music player. `start` plays it (once); `volume` sets the player's music volume, 0–1; `leave` fades it
 * out and resolves when it is quiet (at once when nothing plays).
 * @param {string} base the URL of the assets' audio directory @param {number} volume the player's music volume
 */
export function createRoomMusic(base, volume) {
  /** @type {{ ctx: AudioContext, gain: GainNode, bank: MusicBank } | null} */
  let P = null, started = false, level = volume;
  const ready = fetch(new URL('index.json', base)).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((index) => {
    const bank = roomMusicOf(index);
    const ctx = bank ? audioContext() : null;
    if (!bank || !ctx) return null;
    const gain = ctx.createGain();
    gain.gain.value = bank.volume * level;
    gain.connect(ctx.destination);
    P = { ctx, gain, bank };
    return P;
  });
  const play = async () => {
    const p = await ready;
    if (!p) return;
    await p.ctx.resume();
    const [intro, loop] = await Promise.all([p.bank.intro ? decoded(p.ctx, new URL(p.bank.intro, base).href) : null, decoded(p.ctx, new URL(p.bank.loop, base).href)]);
    if (!loop) return;
    const at = p.ctx.currentTime + 0.05;
    if (intro) {
      const a = p.ctx.createBufferSource();
      a.buffer = intro;
      a.connect(p.gain);
      a.start(at);
    }
    const b = p.ctx.createBufferSource();
    b.buffer = loop;
    b.loop = true;
    b.connect(p.gain);
    b.start(at + (intro ? intro.duration : 0));
  };
  return {
    start: () => { if (!started) { started = true; void play(); } },
    /** @param {number} v */
    volume: (v) => { level = v; if (P) P.gain.gain.value = P.bank.volume * v; },
    /** @returns {Promise<void>} */
    leave: () => {
      if (!P || !started || P.ctx.state !== 'running') return Promise.resolve();
      const { ctx, gain, bank } = P, t = ctx.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + bank.crossfade);
      return new Promise((done) => { setTimeout(done, bank.crossfade * 1000); });
    },
  };
}
