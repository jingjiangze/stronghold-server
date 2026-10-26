// The activity's quick match page (docs/spec/room.md 房间-9, page.md 页面-6): the modes' cards — 常规项目 with its
// classes to choose from (a class without a project of the server locked), the other modes not open —, the match
// position (教练 locked), 互选模式 with its effect, 开始匹配; while looking, the matching banner with the classes and
// the time left, 取消匹配; its end in the original's banners (success with the mate's position, failure, cancelled).
// 常规项目's header, the position panel and 互选模式's effect come and go with their clips and fades.
// The page's curved billboard (a camera drawn onto a mesh) is not drawn.
import { openPart, closePart, place, fillList, setSwitch, placeTopMenu, showInvert } from './lobbykit.js';
import { MATCH, INVERSE, CLASS_NAMES } from '@icebreaker/mode-regular';
import { PAGES } from './lobbymap.js';

/** @typedef {import('./lobbykit.js').Part} Part */
/**
 * What the match page works with: the lobby's classes of its projects (with their names), sending, looking for a mate,
 * the mode icons, the state of the search, going back, a toast.
 * @typedef {{ classes: () => { class: string, name: string }[], send: (m: Record<string, unknown>) => void, seek: (classes: string[], pos: string, inverse: boolean) => void,
 *   modeIcon: (type: string) => string | null, seeking: () => { classes: string[], until: number } | null, back: () => void, toast: (t: string) => void }} MatchCtx
 */
/**
 * The page and what it shows: the classes chosen, the position, 互选模式, whether the position panel is open, the
 * matching banner, the last drawn settings; what is on the screen of the three that come and go with a clip or a fade
 * (常规项目's header, the position panel, 互选模式's effect).
 * @typedef {{ p: Part, f: Record<string, any>, X: MatchCtx, chosen: Set<string>, pos: string, inverse: boolean, panel: boolean, matching: Part | null, shown: string,
 *   on: { header: boolean | null, panel: boolean, inverse: boolean } }} Match
 */

const QM = '@view_ui/canvas_ui/state_root/quick_match_state';
/** The classes' order on a mode's card (its diff containers' diffType 2–4). */
const CLASS_OF = Object.freeze({ 2: 'ORDINARY', 3: 'DIFFICULTY', 4: 'EXTREMELY' });
/** How long the end banners stay, in ms. */
const BANNER_MS = 2000;

/** @param {number} diffType */
const classOf = (diffType) => /** @type {Record<number, string>} */ (CLASS_OF)[diffType];

/**
 * A class's item on 常规项目's card: its name, chosen or not, locked without a project. @param {Part} item
 * @param {string} name @param {boolean} on @param {boolean} locked
 */
function fillClass(item, name, on, locked) {
  const f = item.view();
  item.text(f.textName, name);
  item.color(f.textName, on ? f.colorNameSelect : f.colorNameUnselect);
  item.show(f.selectBgGO, on);
  item.show(f.unselectBgGO, !on);
  item.show(f.lockPartGO, locked);
  item.show(f.starCountPartGO, false);
}

/**
 * 常规项目's header while one of its classes is chosen: it slides in with its clip, and back out (页面-6); at once on the
 * page's first drawing. @param {Match} M @param {Part} item @param {boolean} on
 */
function header(M, item, on) {
  const at = '@normal_part/header', was = M.on.header;
  M.on.header = on;
  if (was === null || was === on) { item.show(at, on); return; }
  const a = item.view().animSwitch;
  if (on) { item.show(at, true); void item.anim(a); return; }
  void item.play(a?.animationWrapper ?? at, a?.animationName ?? 'mode_group_item_switch', { reverse: true }).then(() => { if (!M.on.header) item.show(at, false); });
}

/** 常规项目's card: its classes, each a tap to choose. @param {Match} M @param {Part} item */
function normalCard(M, item) {
  const v = item.view(), open = new Set(M.X.classes().map((c) => c.class)), names = new Map(M.X.classes().map((c) => [c.class, c.name]));
  header(M, item, [...M.chosen].some((c) => open.has(c)));
  for (const d of v.diffItemContainers ?? []) {
    const cls = classOf(d.diffType);
    item.show(d.trackGO, false);
    const it = cls ? place(item, d.container, 'screen:quickmatch/star_count_match_diff_item') : null;
    if (!it || !cls) continue;
    fillClass(it, names.get(cls) ?? CLASS_NAMES[cls] ?? cls, M.chosen.has(cls), !open.has(cls));
    it.tap('@click_area', () => {
      if (!open.has(cls)) return;
      if (M.chosen.has(cls)) M.chosen.delete(cls); else M.chosen.add(cls);
      draw(M);
    });
  }
}

/** The modes' cards: 常规项目's open, the others not. @param {Match} M */
function modes(M) {
  fillList(M.p, M.f.modeList, MATCH.modes.length, (item, i) => {
    const m = MATCH.modes[i], v = item.view(), normal = m.type === 'NORMAL', icon = M.X.modeIcon(m.type);
    item.show(v.normalPartGO, normal);
    item.show(v.lockPartGO, !normal);
    item.text(normal ? v.textName : v.textNameInLock, m.name);
    item.text(v.textModeUnlockTime, '暂未开放');
    if (icon) item.picture(normal ? v.imgTopIcon : v.imgTopIconInLock, icon);
    for (const g of [v.trainingLockGO, v.trainingPartGO, v.stageUnlockHintGO]) item.show(g, false);
    if (normal) normalCard(M, item);
  });
}

/** The position: its button's name and, while the panel is open, the positions to choose (教练 locked). @param {Match} M */
function positions(M) {
  const f = M.f, cur = MATCH.positions.find((x) => x.id === M.pos);
  M.p.text(f.textCurrMatchPos, cur?.name ?? '');
  // the positions' icons come from an atlas the pack does not carry: not shown
  M.p.show(f.imgCurrMatchIcon, false);
  positionPanel(M);
  M.p.show(f.matchPosDescGO, !!cur?.desc);
  M.p.text(f.textPosDesc, cur?.desc ?? '');
  if (!M.panel) return;
  fillList(M.p, f.matchPosList, MATCH.positions.length, (item, i) => {
    const pos = MATCH.positions[i], v = item.view(), on = pos.id === M.pos;
    item.text(v.textName, pos.name);
    item.color(v.textName, on ? v.colorTextSelect : v.colorTextUnselect);
    item.show(v.selectPartGO, on);
    item.show(v.unselectPartGO, !on);
    item.show(v.lockPartGO, pos.locked);
    item.show(v.imgIconUnselect, false);
    item.show(v.imgIconSelect, false);
    item.tap('@click_area', () => {
      if (pos.locked) { M.X.toast(pos.hint); return; }
      Object.assign(M, { pos: pos.id, panel: false });
      M.X.toast(pos.toast);
      draw(M);
    });
  });
}

/**
 * The position panel opening or closing (页面-6): it fades over the controller's time while the position button fades
 * the other way with its switch clip.
 * @param {Match} M
 */
function positionPanel(M) {
  const f = M.f;
  if (M.on.panel === M.panel) { M.p.show(f.matchPosListPanel, M.panel); return; }
  M.on.panel = M.panel;
  void M.p.fade(f.matchPosListPanel, M.panel, f.posPanelFadeDuration ?? 0);
  const a = f.animBtnSelectPosSwitch;
  if (a?.animationName) void M.p.play(a.animationWrapper ?? f.btnMatchPosGO, a.animationName, { reverse: M.panel });
}

/**
 * 互选模式's effect (页面-6): turned on it fades in and plays its entry clip; turned off it fades out. @param {Match} M
 */
function inverseEffect(M) {
  const f = M.f;
  if (M.on.inverse === M.inverse) { showInvert(M.p, f.inverseEffectHandler, M.inverse); return; }
  M.on.inverse = M.inverse;
  if (M.inverse) {
    showInvert(M.p, f.inverseEffectHandler, true);
    void M.p.fade(f.inverseEffectHandler, true, f.inverseEffectFadeDuration ?? 0);
    void M.p.anim(f.animInverseModeEnter);
    return;
  }
  void M.p.fade(f.inverseEffectHandler, false, f.inverseEffectFadeDuration ?? 0).then(() => { if (!M.inverse) showInvert(M.p, f.inverseEffectHandler, false); });
}

/** The matching banner while looking (its classes, its cancel), placed once. @param {Match} M */
function banner(M) {
  const sk = M.X.seeking(), f = M.f;
  if (!sk || M.matching || !f.matchingPrefab || !f.matchingContainer) return;
  const m = place(M.p, f.matchingContainer, f.matchingPrefab);
  M.matching = m;
  if (!m) return;
  const mv = m.view();
  for (const r of [mv.cancelPanel, mv.timecountPanel, mv.successPanel]) m.show(r, false);
  m.show(mv.matchingPanel, true);
  m.tap('@banner_matching/panel_banner/btn_cancel/hotspot', () => M.X.send({ t: 'unseek' }));
  fillList(m, mv.modeList, 1, (item) => {
    const iv = item.view(), icon = M.X.modeIcon('NORMAL');
    if (icon) item.picture(iv.imgModeIcon, icon);
    for (const d of iv.diffList ?? []) item.show(d.diffGO, sk.classes.includes(classOf(d.diffType)));
  });
  void m.anim(mv.animMatchingEnter);
}

/** @param {Match} M */
function draw(M) {
  const key = JSON.stringify([[...M.chosen], M.pos, M.inverse, M.panel, M.X.classes()]);
  if (key !== M.shown) {
    M.shown = key;
    modes(M);
    positions(M);
    inverseEffect(M);
    M.p.show(M.f.btnStartNormalGO, M.chosen.size > 0);
    M.p.show(M.f.btnStartDisableGO, M.chosen.size === 0);
  }
  banner(M);
}

/** An end banner of the search, gone after a while. @param {Match} M @param {'successPanel' | 'timecountPanel' | 'cancelPanel'} panel @param {string} [desc] */
function ending(M, panel, desc) {
  const part = M.matching;
  if (!part) return;
  const mv = part.view(), anim = { successPanel: mv.animSuccessEnter, timecountPanel: mv.animTimeoutEnter, cancelPanel: mv.animCancelEnter }[panel];
  part.show(mv.matchingPanel, false);
  part.show(mv[panel], true);
  if (desc) part.text(mv.textSuccessDesc, desc);
  void part.anim(anim);
  M.matching = null;
  setTimeout(() => { if (!part.scr.dead) closePart(part); }, BANNER_MS);
}

/** The page's taps: the position button and its panel, 互选模式's toggle, 开始匹配. @param {Match} M */
function wire(M) {
  const { p, f, X } = M;
  if (f.topMenuContainer) placeTopMenu(p, f.topMenuContainer, { back: X.back, home: X.back });
  const toggle = f.inverseToggleContainer ? place(p, f.inverseToggleContainer, f.inverseTogglePrefab) : null;
  if (toggle) {
    setSwitch(toggle, toggle.view().inverseUnlockState ?? '@bg/group_flip_lock_toggle', true);
    toggle.show(toggle.view().newTrackGO ?? '@new_track_root', false);
    toggle.tap('@bg/hotspot', () => { M.inverse = !M.inverse; void toggle.play('@', 'mode_toggle_switch', { reverse: !M.inverse }); draw(M); });
  }
  p.text(f.textInverseDesc, INVERSE.hint);
  p.tap(`${f.btnMatchPosGO}/click_area`, () => { M.panel = true; draw(M); });
  p.tap(`${f.matchPosListPanel}/raycast`, () => { M.panel = false; draw(M); });
  p.tap(`${QM}/btn_start_match/click_area`, () => {
    if (!M.chosen.size) { X.toast('请选择至少一个项目'); return; }
    X.seek([...M.chosen], M.pos, M.inverse);
  });
}

/** @param {any} ui @param {MatchCtx} X */
export function createMatch(ui, X) {
  const p = openPart(ui, PAGES.match), f = p.view(QM);
  /** @type {Match} */
  const M = { p, f, X, chosen: new Set(MATCH.classes.filter((c) => c.first).map((c) => c.class)), pos: MATCH.positions[0]?.id ?? 'NORMAL', inverse: false, panel: false, matching: null, shown: '',
    on: { header: null, panel: false, inverse: false } };
  // the curved billboard is a camera drawn onto a mesh: not drawn here
  for (const r of f.billboardMeshImages ?? []) p.show(r, false);
  p.show('@view_billboard', false);
  p.show(f.guidebookGO, false);
  wire(M);
  void p.anim(f.animEnter);
  return {
    part: p,
    update: () => draw(M),
    close: () => closePart(p),
    /** The banner's time left. */
    tick() {
      const sk = X.seeking();
      if (sk && M.matching) M.matching.text(M.matching.view().textWaitSec, `（剩余${Math.max(0, Math.ceil((sk.until - performance.now()) / 1000))}s）`);
    },
    /** The search ended (房间-9). @param {{ how: string, mate?: string }} m */
    sought(m) {
      if (m.how !== 'found') { ending(M, m.how === 'fail' ? 'timecountPanel' : 'cancelPanel'); return; }
      const mv = M.matching?.view();
      if (M.matching && mv) { M.matching.show(mv.partnerCoachGO, m.mate === 'COACH'); M.matching.show(mv.partnerStudentGO, m.mate === 'STUDENT'); }
      ending(M, 'successPanel', MATCH.positions.find((x) => x.id === m.mate)?.found);
    },
    /** What the page shows, for tests. */
    state: () => ({ chosen: [...M.chosen], pos: M.pos, inverse: M.inverse, matching: !!M.matching }),
  };
}
