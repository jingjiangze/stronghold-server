// The battle page's sound beyond the battle's events (docs/spec/page.md 页面-4): the mate's requests heard as the game
// sounds them — a pause request, a 2× request — from the control state the server sends (engine 同步-7, 同步-8).

/** @typedef {{ fast: number[], held: number, asker: number, resuming: number }} Control */

/**
 * The banks a change of the control state calls for (页面-4, engine 音频-2): the mate asking to pause; the mate turning
 * its 2× on while this seat's is off.
 * @param {Control | null} prev @param {Control} next @param {number} seat @returns {string[]}
 */
export function controlSounds(prev, next, seat) {
  /** @type {string[]} */
  const out = [];
  if (next.asker >= 0 && next.asker !== seat && prev?.asker !== next.asker) out.push('battle.ON_COOPERATE_PAUSE_CONFIRM');
  const mateOn = next.fast.some((f, i) => i !== seat && f === 1 && prev?.fast[i] !== 1);
  if (mateOn && next.fast[seat] !== 1) out.push('battle.ON_COOPERATE_SPEED_REQUEST');
  return out;
}

/** A Web Audio context (older Safari's prefixed one), or null where the browser has none: the page then stays silent. */
export function audioContext() {
  const C = /** @type {typeof AudioContext | undefined} */ (globalThis.AudioContext ?? /** @type {any} */ (globalThis).webkitAudioContext);
  return C ? new C() : null;
}
