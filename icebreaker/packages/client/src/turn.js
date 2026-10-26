// Phones (docs/spec/page.md 页面-7): the pages play in landscape. On a touch screen held upright the body is turned a
// quarter turn clockwise and sized to the screen's long side; the pointer positions, the element rects and the
// window's size the pages and the engine read are given in the turned body's frame, so everything lays out, draws and
// hits as on a screen held sideways (the browser itself hits the turned elements). A screen held sideways, and any
// screen with a mouse, is left as it is. Also the touch screen's own gestures (zooming, scrolling the page, the long-press
// menu) are kept off the game, and the pages offer 全屏 where the browser can do it.

/** Whether the turn is on: the native window size while it is (the turned frame is H × W of it). */
const T = { on: false, w: 0, h: 0 };
/** The native window size, before the turn's own getters. */
const native = {
  w: /** @type {() => number} */ (() => window.innerWidth), h: /** @type {() => number} */ (() => window.innerHeight),
};

/**
 * A point of the screen in the turned frame: the frame's x runs down the screen, its y from the screen's right edge.
 * @param {number} x @param {number} y @param {number} w the screen's width
 */
export const turnedPoint = (x, y, w) => [y, w - x];

/**
 * A rect of the screen in the turned frame (an element's box, axis-aligned in the frame).
 * @param {{ left: number, top: number, width: number, height: number }} r @param {number} w the screen's width
 */
export const turnedRect = (r, w) => ({ left: r.top, top: w - r.left - r.width, width: r.height, height: r.width });

/** Whether this screen is a touch screen held upright. @param {{ coarse: boolean, w: number, h: number }} s */
export const wantsTurn = (s) => s.coarse && s.h > s.w;

/** The getters the turn changes, given in the frame while it is on. */
function patch() {
  const proto = MouseEvent.prototype, cx = Object.getOwnPropertyDescriptor(proto, 'clientX'), cy = Object.getOwnPropertyDescriptor(proto, 'clientY');
  const rect = Element.prototype.getBoundingClientRect, iw = Object.getOwnPropertyDescriptor(window, 'innerWidth'), ih = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  if (!cx?.get || !cy?.get || !iw?.get || !ih?.get) return false;
  const getX = cx.get, getY = cy.get, getW = iw.get, getH = ih.get;
  native.w = () => getW.call(window);
  native.h = () => getH.call(window);
  Object.defineProperty(proto, 'clientX', { ...cx, get() { return T.on ? turnedPoint(getX.call(this), getY.call(this), T.w)[0] : getX.call(this); } });
  Object.defineProperty(proto, 'clientY', { ...cy, get() { return T.on ? turnedPoint(getX.call(this), getY.call(this), T.w)[1] : getY.call(this); } });
  Element.prototype.getBoundingClientRect = function turnedBox() {
    const r = rect.call(this);
    if (!T.on || !document.body.contains(this)) return r;
    const t = turnedRect(r, T.w);
    return new DOMRect(t.left, t.top, t.width, t.height);
  };
  Object.defineProperty(window, 'innerWidth', { ...iw, get() { return T.on ? T.h : getW.call(window); } });
  Object.defineProperty(window, 'innerHeight', { ...ih, get() { return T.on ? T.w : getH.call(window); } });
  return true;
}

/** Turns the body or not for the screen now. */
function update() {
  const w = native.w(), h = native.h(), on = wantsTurn({ coarse: matchMedia('(pointer: coarse)').matches, w, h });
  Object.assign(T, { on, w, h });
  document.documentElement.classList.toggle('turned', on);
  const s = document.body.style;
  if (on) Object.assign(s, { position: 'fixed', left: '0', top: '0', width: `${h}px`, height: `${w}px`, transformOrigin: '0 0', transform: `translateX(${w}px) rotate(90deg)` });
  else for (const k of ['position', 'left', 'top', 'width', 'height', 'transformOrigin', 'transform']) s.removeProperty(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
}

/**
 * Sets the turn up (before the page's own modules read sizes or listen to resizes): touch screens get it, and it
 * follows the screen's turns. A button for 全屏 where the browser has it and the screen is a touch screen.
 * @param {HTMLButtonElement | null} [full]
 */
export function startTurn(full) {
  if (typeof window === 'undefined' || !matchMedia('(pointer: coarse)').matches || !patch()) return;
  document.documentElement.classList.add('touch');
  update();
  // first among the window's resize listeners: the pages measure the turned frame
  addEventListener('resize', update);
  screen.orientation?.addEventListener?.('change', () => { update(); dispatchEvent(new Event('resize')); });
  if (full && document.fullscreenEnabled) {
    full.hidden = false;
    full.addEventListener('click', () => { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' })).catch(() => {}); });
  }
}
