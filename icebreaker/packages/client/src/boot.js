// The page's side of the loading screen (docs/spec/page.md 页面-8): the plain script (static/boot.js) put it up before
// the modules ran; the page tells it each step, and hands over or reports a failure. Without the screen, nothing.

/** @typedef {{ step: (what: string, at: number) => void, done: () => void, fail: (why: string) => void, up: boolean }} Boot */

/** The screen, when it is still up. @returns {Boot | null} */
const screen = () => { const b = /** @type {Boot | undefined} */ (/** @type {any} */ (globalThis).__boot); return b?.up ? b : null; };

/** A step of loading: its status and the share done (0.3 … 1; the modules took the first 0.3). @param {string} what @param {number} at */
export const bootStep = (what, at) => screen()?.step(what, at);

/** The page has taken over: the screen fades out. */
export const bootDone = () => screen()?.done();

/** Loading failed: the reason and what to do stay on the screen. @param {string} why */
export const bootFail = (why) => screen()?.fail(why);

/**
 * A share of loading spread over some loads: each settled one moves the screen on from `from` to `to`.
 * @param {string} what @param {number} from @param {number} to @param {number} total
 * @returns {() => void} call as each one settles
 */
export function bootCounter(what, from, to, total) {
  let n = 0;
  bootStep(what, from);
  return () => { n += 1; bootStep(what, from + ((to - from) * Math.min(n, total)) / Math.max(1, total)); };
}
