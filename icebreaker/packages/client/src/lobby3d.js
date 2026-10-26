// The entry page's 3D scene (docs/spec/page.md 页面-6, engine 渲染-17): its models drawn behind the page by the engine's
// UI scene, following the page's clips (the camera moves to the room panel and back), the world-space ground mapped
// onto the floor where the camera sees it. Only when the assets have the scene's index; three.js comes with it (loaded
// then), so the room page stays light without it. Back to front: the sky's colour, the ground, the models, the page.
import { matrix3d } from '@aue/ui';

/** What runs after each UI tick (the page's UI loop calls these). @type {Set<() => void>} */
export const AFTER_TICK = new Set();

/**
 * The entry page's scene while it runs, for the effects on its ground (lobbyfx.js): the engine's scene, the ground
 * node, and a point of the page (CSS pixels) as a point of the ground canvas (its pixels from its top left).
 * @type {{ sc: any, ground: any, toGround: (x: number, y: number) => number[] | null } | null}
 */
export let SCENE3D = null;

/** A 3 × 3 matrix's inverse (row-major), or null. @param {number[]} m */
function inverse3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  if (!det) return null;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map((v) => v / det);
}

/**
 * Starts the scene for an opened entry page, or null when the assets have none (the page then hides its 3D part).
 * @param {any} ui the lobby UI @param {any} scr the entry page's screen @param {string} base the URL of the UI pack's folder
 * @returns {Promise<{ stop: () => void } | null>}
 */
export async function startScene3d(ui, scr, base) {
  const res = await fetch(new URL('lobby3d/index.json', base)).catch(() => null);
  const back = scr.one('view_back'), ground = scr.one('canvas_entry_ground');
  if (!res?.ok || !back || !ground) return null;
  const [{ createUiScene }, index] = await Promise.all([import('@aue/render'), res.json()]);
  if (scr.dead) return null;
  const canvas = document.createElement('canvas');
  scr.wrap.prepend(ground.el); // out of its parents' boxes: placed by the camera alone
  ground.el.after(canvas);
  const sc = createUiScene({ canvas, root: back, scene: index, base: new URL('lobby3d/', base).href });
  const sky = sc.background ? `rgb(${sc.background.map((/** @type {number} */ v) => Math.round(v * 255)).join(',')})` : '';
  const was = ui.layer.style.background;
  ui.layer.style.background = sky;
  let size = '';
  /** @type {number[] | null} the ground's map onto the UI layer, inverted */
  let inv = null;
  SCENE3D = { sc, ground, toGround: (x, y) => {
    if (!inv) return null;
    const k = ui.canvas.k, X = x / k, Y = y / k, w = inv[6] * X + inv[7] * Y + inv[8];
    return w ? [(inv[0] * X + inv[1] * Y + inv[2]) / w, (inv[3] * X + inv[4] * Y + inv[5]) / w] : null;
  } };
  const frame = () => {
    if (scr.dead) { stop(); return; }
    const k = ui.canvas.k, w = innerWidth, h = innerHeight;
    if (size !== `${w}x${h}x${k}`) {
      size = `${w}x${h}x${k}`;
      sc.resize(w, h, Math.min(2, devicePixelRatio));
      Object.assign(canvas.style, { position: 'absolute', left: '0px', top: '0px', width: `${w / k}px`, height: `${h / k}px`, pointerEvents: 'none' });
    }
    sc.render();
    // the ground's plane on the UI layer: its map from the element's pixels, shown while some of it is in front of the
    // camera; the browser leaves out what falls behind the camera itself (a clip path on this huge 3D-mapped element
    // made the GPU drop it on some frames: the page flickered)
    const pl = sc.plane(ground, 2), gw = ground.el.offsetWidth || ground.n.rt.size[0], gh = ground.el.offsetHeight || ground.n.rt.size[1];
    const ok = !!pl && pl.clip.length >= 3;
    ground.el.style.visibility = ok ? '' : 'hidden';
    const [sw, sh] = ground.n.rt.size, fx = sw / gw, fy = sh / gh;
    const H = ok ? [0, 1, 2].flatMap((r) => [pl.H[r * 3] * fx, pl.H[r * 3 + 1] * fy, pl.H[r * 3 + 2]].map((v) => (r < 2 ? v / k : v))) : null;
    inv = H ? inverse3(H) : null;
    if (H) Object.assign(ground.el.style, { left: '0px', top: '0px', transformOrigin: '0 0', transform: matrix3d(H) });
  };
  const stop = () => { AFTER_TICK.delete(frame); SCENE3D = null; sc.dispose(); canvas.remove(); ui.layer.style.background = was; };
  AFTER_TICK.add(frame);
  return { stop };
}
