// The lobby screens' particle effects (docs/spec/page.md 页面-6, engine 渲染-18): with the assets' effect pack of the
// lobby, each UI particle node of an open screen plays its effect while it shows, following the node — on a page-wide
// layer above the screens, or, on the entry page's ground, in its 3D scene (lobby3d.js). three.js comes with the pack.
import { AFTER_TICK, SCENE3D } from './lobby3d.js';

/**
 * A node's effect while it shows. @typedef {{ key: string, node: any, ground: boolean, scale: number,
 *   h: { move: (r: any) => void, remove: () => void, clip: (r: number[] | null) => void, done: boolean } | null }} Spot
 */

/**
 * The page rectangle (CSS pixels x, y, w, h) a node's effect is clipped to, or null: its nearest masking ancestor's,
 * cut to the box of a stencil image beside it (the effect reads the stencil that image writes, as the team-up button's
 * waves its rounded back; the box stands for the image's shape).
 * @param {any} n
 */
function clipOf(n) {
  /** @type {DOMRect | null} */
  let r = null;
  for (let x = n.parent; x && !r; x = x.parent) if (x.n.comps.mask) r = x.el.getBoundingClientRect();
  const w = n.parent?.kids.find((/** @type {any} */ k) => k !== n && k.active && k.n.comps.mask === 'stencil' && k.n.comps.img);
  const b = w?.el.getBoundingClientRect() ?? null;
  if (!r && !b) return null;
  if (!r || !b) { const q = /** @type {DOMRect} */ (r ?? b); return [q.left, q.top, q.width, q.height]; }
  const x0 = Math.max(r.left, b.left), y0 = Math.max(r.top, b.top), x1 = Math.min(r.right, b.right), y1 = Math.min(r.bottom, b.bottom);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

/** Whether a node and its ancestors show. @param {any} n */
function showing(n) {
  for (let x = n; x; x = x.parent) if (!x.active) return false;
  return !!n.shown || !!n.el?.isConnected;
}

/** How opaque a node's graphic draws: its colour's alpha through its own and its ancestors' groups (0 when hidden). @param {any} n */
function drawnAlpha(n) {
  let a = n.color?.[3] ?? 0;
  for (let x = n; x; x = x.parent) { if (!x.active) return 0; a *= x.alpha ?? 1; }
  return a;
}

/** Whether a node draws a solid colour (an image with no sprite, or the common white one). @param {any} n */
const solid = (n) => !!n.g && !!n.n.comps.img && (!n.sprite || String(n.sprite).endsWith('/sprite_white'));

/**
 * Whether a node's effect is under a solid graphic drawn after it that covers its centre (页面-6): the page-wide layer
 * is above every screen, so an effect a later opaque layer hides in the original — the title's season cover over the
 * team-up button's waves — is not drawn. @param {any} n
 */
function covered(n) {
  const r = n.el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  /** @param {any} k @returns {boolean} */
  const over = (k) => {
    if (!k.active) return false;
    if (solid(k) && drawnAlpha(k) >= 0.9) {
      const b = k.el.getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return true;
    }
    return k.kids.some(over);
  };
  for (let c = n; c.parent; c = c.parent) {
    const kids = c.parent.kids;
    if (kids.slice(kids.indexOf(c) + 1).some(over)) return true;
  }
  return false;
}

/**
 * The effects' nodes in a screen, by the pack's keys "<prefab>|<root>/<path>": in the screen of that prefab, or in a
 * screen that has the prefab nested (every copy). @param {any} pack @param {any} scr @returns {Spot[]}
 */
function spotsOf(pack, scr) {
  /** @type {Spot[]} */
  const out = [];
  for (const [key, path] of Object.entries(/** @type {Record<string, string>} */ (pack.data.nodes ?? {}))) {
    const p = String(path), own = key.startsWith(`${scr.name}|`);
    const nodes = own ? [scr.one(p.split('/').slice(1).join('/'))] : scr.q(p);
    for (const node of nodes) if (node) out.push({ key, node, ground: p.includes('/canvas_entry_ground/'), scale: node.n.comps.particle?.scale?.[0] ?? 1, h: null });
  }
  return out;
}

/**
 * Starts the lobby's effects, or null when the assets have no effect pack for it.
 * @param {any} ui the lobby UI @param {string} base the URL of the UI pack's folder @returns {Promise<{ stop: () => void } | null>}
 */
export async function startLobbyFx(ui, base) {
  const res = await fetch(new URL('lobbyfx.json', base)).catch(() => null);
  if (!res?.ok) return null;
  const [{ loadEffectPack, createUiFx, pageRoot }, data] = await Promise.all([import('@aue/render'), res.json()]);
  const pack = await loadEffectPack(data), canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
  ui.layer.after(canvas);
  const flat = createUiFx({ pack, canvas });
  /** @type {{ fx: any, sc: any } | null} */
  let deep = null;
  /** @type {Map<any, Spot[]>} */
  const spots = new Map();
  let at = performance.now(), size = '';
  /** Where a spot's effect goes now, or null. @param {Spot} s */
  const rootOf = (s) => {
    const r = s.node.el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (!s.ground) return pageRoot(x, y, ui.canvas.k);
    const g = SCENE3D?.toGround(x, y);
    return g && SCENE3D ? SCENE3D.sc.canvasRoot(SCENE3D.ground, g[0], g[1], 1) : null;
  };
  /** The 3D effects live in the entry page's scene while it runs: made for it, gone with it. */
  const syncDeep = () => {
    if (deep && deep.sc !== SCENE3D?.sc) {
      deep.fx.dispose();
      deep = null;
      for (const l of spots.values()) for (const s of l) if (s.ground) s.h = null;
    }
    if (!deep && SCENE3D) deep = { fx: createUiFx({ pack, scene: SCENE3D.sc.scene, camera: () => SCENE3D?.sc.camera ?? null }), sc: SCENE3D.sc };
  };
  /** The open screens' spots, a closed screen's gone. */
  const syncSpots = () => {
    for (const scr of ui.screens) if (!spots.has(scr)) spots.set(scr, spotsOf(pack, scr));
    for (const [scr, list] of spots) {
      if (scr.dead) { for (const s of list) s.h?.remove(); spots.delete(scr); continue; }
      for (const s of list) place(s, s.ground ? deep?.fx ?? null : flat);
    }
  };
  const frame = () => {
    const now = performance.now(), dt = Math.min(0.1, (now - at) / 1000);
    at = now;
    if (size !== `${innerWidth}x${innerHeight}`) { size = `${innerWidth}x${innerHeight}`; flat.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio)); }
    syncDeep();
    syncSpots();
    flat.frame(dt);
    deep?.fx.frame(dt);
  };
  /** A spot's effect started, moved or removed as its node shows. @param {Spot} s @param {any} fx */
  const place = (s, fx) => {
    const r = fx && showing(s.node) && (s.ground || !covered(s.node)) ? rootOf(s) : null;
    if (!r) { s.h?.remove(); s.h = null; return; }
    if (s.h?.done) s.h = null;
    if (s.h) s.h.move(r); else s.h = fx.play(s.key, r, s.scale);
    if (s.h && !s.ground) s.h.clip(clipOf(s.node));
  };
  AFTER_TICK.add(frame);
  // for tests and the console: the effects playing on the page layer and in the 3D scene, the spots found
  /** @type {any} */ (globalThis).__lobbyFx = () => ({ flat: flat.count, deep: deep?.fx.count ?? 0, boxes: deep?.fx.inspect() ?? [], flatBoxes: flat.inspect(), cam: SCENE3D?.sc.camera?.getWorldPosition(new SCENE3D.sc.camera.position.constructor()).toArray().map(Math.round),
    spots: [...spots.values()].flat().map((s) => ({ key: s.key.split('|')[1]?.split('/').slice(-2).join('/'), on: !!s.h, ground: s.ground })) });
  return { stop: () => { AFTER_TICK.delete(frame); flat.dispose(); deep?.fx.dispose(); canvas.remove(); } };
}
