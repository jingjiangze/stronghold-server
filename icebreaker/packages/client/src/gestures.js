// The player's hand on the original battle UI (the engine's 界面-13, 界面-14): a usable card pressed and dragged onto a
// tile it may be deployed on — or pressed, then the tile tapped — opens the direction selector there; a drag from
// anywhere points a facing (its range shows) and letting go deploys; the cancel button takes it back. While it is
// placed the operator stands on its tile, its direction indicator at its feet while the facing is chosen (渲染-14). A
// tap on one of this seat's operators opens its menu: start its skill, retreat it; a tap elsewhere closes it. A card
// taken or an operator's menu opened is the player choosing it (its voice: the engine's 音频-5).
import { DIR } from '@aue/schema';
import { dragFacing, groundOffset } from '@aue/ui';
import { ownUnitAt, menuSkill } from './battlehud.js';

/** @typedef {{ row: number, col: number }} Tile */
/** @typedef {'idle' | 'drag' | 'pick' | 'aim' | 'menu'} Mode */
/**
 * @typedef {{ canvas: HTMLCanvasElement, renderer: any, hud: any, battle: any, level: any, seat: number, content: any,
 *   icons: Record<string, string>, iconBase: string, view: () => import('@aue/schema').View | null,
 *   usable: (id: string) => boolean, unitKey: (id: number) => string | undefined, focus?: (key: string) => void }} HandOptions
 */

/** Whether a pointer event is on a tappable part of the UI (the UI handles it). @param {Event} e */
const onUi = (e) => e.target instanceof Element && e.target.closest('.aue-hot') !== null;

export class Hand {
  /** @param {HandOptions} o */
  constructor(o) {
    this.o = o;
    /** @type {Mode} */ this.mode = 'idle';
    /** @type {string | null} */ this.op = null;
    /** @type {Tile | null} */ this.tile = null;
    this.facing = -1; this.unit = -1; this.seq = 0;
    /** @type {number[] | null} where an aiming drag started */ this.from = null;
    /** @type {Set<number>} */ this.deployable = new Set();
    const hud = o.hud;
    hud.on('card', (/** @type {string} */ id) => this.card(id));
    hud.on('cancel', () => this.clear());
    hud.on('withdraw', () => this.act('retreat'));
    hud.on('skill', () => this.act('skill'));
    addEventListener('pointermove', (e) => this.move(e));
    addEventListener('pointerdown', (e) => { if (this.mode === 'aim' && !onUi(e)) this.from = [e.clientX, e.clientY]; });
    addEventListener('pointerup', (e) => this.up(e));
  }

  /** The card shown selected. */
  selected() { return this.mode === 'drag' || this.mode === 'pick' || this.mode === 'aim' ? this.op : null; }

  /** A tile's height level. @param {{ row: number, col: number }} t */
  height(t) { return this.o.level.tiles?.[Math.round(t.row)]?.[Math.round(t.col)]?.height === 'HIGHLAND' ? 1 : 0; }

  /** Ground offsets from a point of the field to page pixels. @param {{ row: number, col: number }} t @param {number} h */
  toPage(t, h) { return (/** @type {number} */ e, /** @type {number} */ n) => this.o.renderer.screenOf(t.col + e, t.row + n, h); }

  /** The tile under a pointer. @param {PointerEvent} e @returns {Tile | null} */
  pick(e) { return this.o.renderer.pick(e.clientX, e.clientY); }

  /** The deploy highlight and the range of the selected operator facing `dir` on a tile (渲染-8, 渲染-9). @param {Tile | null} tile @param {number} dir */
  mark(tile, dir) {
    const seq = ++this.seq, r = this.o.renderer;
    this.o.battle.marks({ op: this.op, dir, tile }).then((/** @type {any} */ m) => {
      if (seq !== this.seq || !this.op) return;
      this.deployable = new Set(m.deployable);
      r.highlight(m.deployable);
      r.range(m.range ? m.range.keys : null, m.range?.heal);
    });
  }

  clear() {
    Object.assign(this, { mode: 'idle', op: null, tile: null, facing: -1, unit: -1, from: null });
    this.seq++;
    this.o.hud.direction.hide(); this.o.hud.menu.hide();
    this.o.renderer.highlight(null); this.o.renderer.range(null); this.o.renderer.placing(null);
  }

  /**
   * The selected operator standing on a tile (渲染-14): facing its chosen facing (right until one is chosen), the
   * direction indicator while it is aimed; none off the tiles it may go to.
   * @param {Tile | null} t
   */
  place(t) {
    const ok = t && this.op && (this.mode === 'aim' || this.deployable.has(t.row * this.o.level.width + t.col));
    this.o.renderer.placing(ok && t && this.op ? { key: this.op.split('#')[0], col: t.col, row: t.row, h: this.height(t),
      dir: this.facing < 0 ? DIR.RIGHT : this.facing, ring: this.mode === 'aim' } : null);
  }

  /** A card pressed: a usable one starts a drag. @param {string} id */
  card(id) {
    if (!this.o.usable(id)) return;
    this.clear();
    Object.assign(this, { mode: 'drag', op: id });
    this.o.focus?.(id);
    this.mark(null, 0);
  }

  /** The direction selector on a tile. @param {Tile} t */
  aim(t) {
    Object.assign(this, { mode: 'aim', tile: t, facing: -1, from: null });
    this.o.hud.direction.show(this.toPage(t, this.height(t)));
    this.o.hud.direction.point(-1);
    this.mark(t, 0);
    this.place(t);
  }

  /**
   * The aiming drag so far: its page vector from where it started, and a tile east and a tile north of the selector's
   * centre as they lie on the page. @param {PointerEvent} e
   */
  aimDrag(e) {
    const t = /** @type {Tile} */ (this.tile), h = this.height(t), r = this.o.renderer, c = r.screenOf(t.col, t.row, h);
    const east = r.screenOf(t.col + 1, t.row, h), north = r.screenOf(t.col, t.row + 1, h), from = /** @type {number[]} */ (this.from);
    return { d: [e.clientX - from[0], e.clientY - from[1]], ex: [east[0] - c[0], east[1] - c[1]], ny: [north[0] - c[0], north[1] - c[1]] };
  }

  /** @param {PointerEvent} e */
  move(e) {
    if (this.mode === 'drag') { const t = this.pick(e); this.mark(t, 0); this.place(t); return; }
    if (this.mode !== 'aim' || !this.from) return;
    // the drag handle follows the drag on the ground; the facing is where the drag goes furthest (the engine's 界面-13)
    const a = this.aimDrag(e), f = dragFacing(a.d, a.ex, a.ny, 0.4 * Math.hypot(a.ex[0], a.ex[1]));
    this.o.hud.direction.drag?.(groundOffset(a.d, a.ex, a.ny));
    if (f === this.facing) return;
    this.facing = f;
    this.o.hud.direction.point(f);
    this.mark(this.tile, Math.max(0, f));
    this.place(this.tile);
  }

  /** @param {PointerEvent} e */
  up(e) {
    if (this.mode === 'aim') { this.letGo(); return; }
    if (this.mode === 'drag' && onUi(e)) { this.mode = 'pick'; return; }
    if (onUi(e)) return;
    const t = this.pick(e);
    if (this.mode === 'drag' || this.mode === 'pick') {
      if (t && this.deployable.has(t.row * this.o.level.width + t.col)) this.aim(t); else this.clear();
      return;
    }
    const view = this.o.view(), u = t && view ? ownUnitAt(view, this.o.seat, t) : null;
    if (!u) { this.clear(); return; }
    Object.assign(this, { mode: 'menu', unit: u.id });
    this.showMenu(u);
    const key = this.o.unitKey(u.id);
    if (key) this.o.focus?.(key);
  }

  /** The aiming drag let go: the drag handle back at the centre, the operator deployed facing the pointed facing. */
  letGo() {
    if (!this.from) return;
    this.from = null;
    this.o.hud.direction.drag?.(null);
    this.deploy();
  }

  /** Deploys the selected operator facing the pointed facing. */
  deploy() {
    if (!this.op || !this.tile || this.facing < 0) return;
    this.o.battle.command({ type: 'deploy', op: this.op, row: this.tile.row, col: this.tile.col, dir: this.facing });
    this.clear();
  }

  /** The open menu's operator: retreat it or start its skill. @param {'retreat' | 'skill'} type */
  act(type) {
    if (this.unit >= 0) this.o.battle.command({ type, unit: this.unit });
    this.clear();
  }

  /** @param {import('@aue/schema').ViewUnit} u */
  showMenu(u) {
    this.o.hud.menu.show(this.toPage({ col: u.x, row: u.y }, u.z), menuSkill(u, this.o.content.operators[this.o.unitKey(u.id) ?? ''], this.o.icons, this.o.iconBase));
  }

  /** A frame went by: the open menu follows its operator (and closes when it is gone). @param {import('@aue/schema').View} view */
  frame(view) {
    if (this.mode !== 'menu') return;
    const u = view.units.find((x) => x.id === this.unit);
    if (u) this.showMenu(u); else this.clear();
  }
}
