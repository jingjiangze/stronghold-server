// The activity's training room page (docs/spec/room.md 房间-11, page.md 页面-6): the training modes on the right — 常规项目's
// open, 阵地足球 and 堡垒守御 not open here —, the chosen mode's training level in its detail on the billboard (drawn
// flat, not on the curved screen; INF-0022); a tap on the chosen mode starts its training.
import { openPart, closePart, place, fillList, placeTopMenu, placeBottomBar } from './lobbykit.js';
import { TRAINING, DETAILS, MISSIONS, CLASS_NAMES } from '@icebreaker/mode-regular';
import { LEVELS } from '@aue/content';
import { PAGES } from './lobbymap.js';
import { fillDetail } from './lobbystage.js';

/** @typedef {import('./lobbykit.js').Part} Part */
/**
 * What the training page works with: starting a training level, the mode icons, the stage detail's context (its
 * pictures and icons), going back.
 * @typedef {{ train: (level: string) => void, modeIcon: (type: string) => string | null, X: import('./lobbystage.js').StepCtx, back: () => void }} TrainCtx
 */

const ROOM = '@view_ui/canvas_ui/state_engine/pnl_training_room';
/** The stage detail the billboard shows (1200 × 520 in its 1280 × 720 holder). */
const DETAIL = 'stagedetail/act_multi_v3_stage_detail';
/**
 * The billboard's place drawn flat (INF-0022): the curved screen stands in 3D in the original (scaled, turned, pushed
 * back), which the page's layout does not do; its detail goes in the room left of the chosen mode's item (the page is
 * 1280 wide; the item, widened, starts about 808 in), between the top menu and the bottom bar (86), scaled to fit.
 */
const FLAT = Object.freeze({ amin: [0, 0.5], amax: [0, 0.5], pos: [410, 4], size: [780, 540], pivot: [0.5, 0.5], scale: [1, 1], rotz: 0 });
/** The text a mode shows while it is not open here (as the quick match page's modes, 房间-9). */
const NOT_OPEN = '暂未开放';

/**
 * A training level as the stage detail takes a project (房间-2): its code and name (engine 关卡-4), class 训练场, its
 * description, missions and the tasks of its stages. @param {string} level
 * @returns {import('./roomview.js').ProjectView}
 */
export function trainingProject(level) {
  const lv = /** @type {any} */ (LEVELS[level]).level;
  return {
    stage: level, mode: 'NORMAL', level, difficulty: 'NORMAL', class: 'TRAINING', className: CLASS_NAMES['TRAINING'] ?? '', code: lv.code, name: lv.name,
    stages: (lv.stages ?? []).map((/** @type {any} */ s) => ({ ...s.task, seconds: s.time })), missions: MISSIONS[level] ?? [], detail: DETAILS[level] ?? '',
  };
}

/** Whether a training mode is played here (房间-11): 常规项目's. @param {{ mode: string }} m */
const open = (m) => m.mode === 'NORMAL';

/** @typedef {{ p: Part, f: Record<string, any>, X: TrainCtx, chosen: number, items: Part[] }} Train */

/** A mode's item into its chosen look or out of it (its switch clip forwards or backwards). @param {Part | undefined} item @param {boolean} on */
function chosenLook(item, on) {
  const a = item?.view().animSelected;
  if (item && a?.animationName) void item.play(a.animationWrapper ?? '@', a.animationName, { reverse: !on });
}

/**
 * The modes' items: each its name and icon; the ones not open locked; a tap on one chooses it, or starts the chosen
 * one's training. @param {Train} T @param {(i: number) => void} tap
 */
function modes(T, tap) {
  fillList(T.p, T.f.layoutMode ?? `${ROOM}/group_choice`, TRAINING.modes.length, (item, i) => {
    const m = TRAINING.modes[i], v = item.view(), icon = T.X.modeIcon(m.mode);
    T.items[i] = item;
    item.show(v.pnlLocked, !open(m));
    item.show('@nomal', open(m));
    item.text(v.textModeName, m.name);
    item.text(v.textLockedDesc, NOT_OPEN);
    for (const r of [v.imgModeIcon, v.imgModeIconSelected, v.imgModeIconLocked]) if (icon) item.picture(r, icon);
    item.tap('@nomal/hotspot', () => tap(i));
  });
}

/**
 * The chosen mode's level in the stage detail, in the billboard's place drawn flat, scaled down to fit it should it not
 * (INF-0022). @param {Train} T
 */
function detail(T) {
  const m = TRAINING.modes[T.chosen], level = m?.levels[0];
  const d = level && LEVELS[level] ? place(T.p, `${ROOM}/billboard_mesh_image`, DETAIL) : null;
  if (!d || !level) return;
  const box = T.p.node(`${ROOM}/billboard_mesh_image`), size = d.root.rt.size;
  const k = box && size[0] > 0 && size[1] > 0 ? Math.min(1, box.rt.size[0] / size[0], box.rt.size[1] / size[1]) : 1;
  d.root.rt.scale = [k, k];
  fillDetail(d, trainingProject(level), T.X.X);
  void d.anim(d.view().inAnim);
}

/** @param {any} ui @param {TrainCtx} X */
export function createTraining(ui, X) {
  const p = openPart(ui, PAGES.train), f = p.view(ROOM);
  /** @type {Train} */
  const T = { p, f, X, chosen: 0, items: [] };
  // the curved billboard (a camera drawn onto a mesh) is drawn flat: its meshes hidden, its detail in their place
  for (const r of f.billboardMeshImageList ?? []) p.show(r, false);
  const flat = p.node(`${ROOM}/billboard_mesh_image`);
  if (flat) { flat.active = true; flat.rt = { ...flat.rt, ...structuredClone(FLAT) }; }
  p.show('@view_billboard', false);
  placeTopMenu(p, f.topMenuContainer ?? `${ROOM}/top_menu_container`, { back: X.back, home: X.back });
  placeBottomBar(p, f.bottomBarHolder ?? `${ROOM}/doc_down_common_holder`);
  /** A tap on a mode: the chosen one starts its training, another becomes the chosen one. @param {number} i */
  function tap(i) {
    const m = TRAINING.modes[i];
    if (!m || !open(m)) return;
    if (i === T.chosen) { X.train(m.levels[0]); return; }
    chosenLook(T.items[T.chosen], false);
    T.chosen = i;
    chosenLook(T.items[i], true);
    detail(T);
  }
  modes(T, tap);
  chosenLook(T.items[T.chosen], true);
  detail(T);
  return {
    part: p,
    update: () => {},
    close: () => closePart(p),
    /** What the page shows, for tests. */
    state: () => ({ chosen: TRAINING.modes[T.chosen]?.id ?? null }),
  };
}
