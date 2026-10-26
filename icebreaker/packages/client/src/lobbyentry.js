// The activity's entry page (docs/spec/page.md 页面-6, engine ADR 0063): 组队参加 opens its room panel, where 发起！
// makes a room and 加入！ joins one by its code (the invitation text pasted whole works too, 房间-1); 编队 opens the
// squad page; 快速匹配 opens the quick match page (房间-9) once the main panel has given way; the room panel's 训练场 the
// training room page (房间-11). The entries of systems the platform does not have — the manual, milestones, rewards,
// medals, invitations, the guide book — are hidden, not left as dead ends.
import { openPart, closePart, inputOn, placeBottomBar, placeTopMenu, seasonLogo } from './lobbykit.js';
import { startScene3d } from './lobby3d.js';
import { PAGES } from './lobbymap.js';

/** The entry page's state root, under which its panels are. */
export const ENTRY = '@view_ui/canvas_ui/canvas_group/state_root/panel_entry_state';

/** The entry page's nodes for the systems the platform does not have (ADR 0063). */
export const ENTRY_HIDDEN = Object.freeze([
  'panel_main/panel_match/new_match', 'panel_main/panel_left/btn_seasonal_handbook', 'panel_main/panel_left/btn_milestone',
  'panel_main/panel_left/btn_reward', 'panel_main/panel_left/btn_mission', 'panel_main/group_upper_right/group_time', 'panel_main/group_upper_right/btn_medal',
  'panel_main/btn_invite', 'panel_room/btn_train/new_train', 'panel_room/panel_right/btn_invite', 'btn_guidebook',
].map((p) => `${ENTRY}/${p}`));

/**
 * @typedef {object} EntryActions
 * @property {() => void} create makes a room
 * @property {(code: string) => void} join joins a room by a code or an invitation text
 * @property {() => void} squad opens the squad page
 * @property {() => void} match opens the quick match page (房间-9)
 * @property {() => void} train opens the training room page (房间-11)
 * @property {() => string | null} squadProblem why the save's 常规队 cannot be used (the 编队 button says 人数不足)
 * @property {(room: boolean) => void} roomPanel the room panel is shown or not (the page's back button follows it)
 * @property {Promise<unknown>} [effects] settles when the screens' particle effects are loaded (or will not be)
 */

/** The entry page's title animation (its entry clip's first part, ADR 0063): the panel, its two lines, where it ends. */
const TITLE = '@view_ui/canvas_ui/canvas_group/panel_entry_anim', TITLE_END = 2.28;
/** The season cover's colour as the original's recording shows it (INF-0017), and how long the title waits for its effects. */
const COVER = [46 / 255, 178 / 255, 167 / 255, 1], TITLE_WAIT_MS = 6000;
/** Whether this page load has played the title: it plays on the first entry only, a later one starts after it. */
let titled = false;

/**
 * 快速匹配 (页面-6): the main panel gives way with its clip — the camera comes in, the panels fade under the cover —,
 * then the match page opens; not while the page is busy or on its room panel.
 * @param {import('./lobbykit.js').Part} p @param {Record<string, any>} f @param {EntryActions} A @param {() => boolean} held
 */
function wireMatch(p, f, A, held) {
  let going = false;
  p.tap(`${ENTRY}/panel_main/panel_match/btn_match/hotspot`, () => {
    if (going || held()) return;
    going = true;
    void p.anim(f.animMainToMatch).then(() => { going = false; if (!p.scr.dead) A.match(); });
  });
}

/**
 * The entry page on the lobby UI.
 * @param {any} ui @param {EntryActions} A
 */
export function createEntry(ui, A) {
  const p = openPart(ui, PAGES.entry), f = p.view(ENTRY);
  for (const r of ENTRY_HIDDEN) p.show(r, false);
  // the 3D scene behind (its models, camera and the world-space ground): shown once the engine draws it, hidden without its assets (页面-6)
  p.show('@view_back', false);
  /** @type {{ stop: () => void } | null} */
  let scene = null;
  const scene3d = startScene3d(ui, p.scr, ui.ctx.base).then((s) => { scene = s; if (s) p.show('@view_back', true); }, () => {});
  // the season's logo and the title's season cover mark, which the game fills per season (INF-0018)
  seasonLogo(p, f.imgLogo, 'logo');
  seasonLogo(p, f.entryAnimLogo, 'mark');
  // the activity's "ended" marks, and the left panel's back that framed the buttons hidden above
  p.show(`${ENTRY}/panel_main/panel_left/btn_formation/act_end`, false);
  p.show(`${ENTRY}/panel_main/panel_match/group_act_end`, false);
  p.show(`${ENTRY}/panel_main/panel_left/left_panel_back`, false);
  // the common bottom bar the page puts in its holder (the scrolling strip along the bottom)
  if (f.bottomBarHolder) placeBottomBar(p, f.bottomBarHolder);
  let room = false, busy = false;
  const join = (/** @type {string} */ v) => { if (!v.trim()) return; joining(true); A.join(v); };
  const code = inputOn(p, `${ENTRY}/panel_room/panel_right/btn_join_room/hotspot`, { label: '房间编号', onEnter: join });
  /** @param {boolean} on */
  function joining(on) { p.show(f.joinRoomMask ?? `${ENTRY}/panel_room/group_lower_bar_joining`, on && room); }
  /** @param {boolean} on */
  async function toRoom(on) {
    if (busy || on === room) return;
    busy = true;
    if (on) p.show(`${ENTRY}/panel_room`, true);
    await p.anim(on ? f.animMainToRoom : f.animRoomToMain);
    p.show(`${ENTRY}/panel_room`, on);
    p.show(`${ENTRY}/panel_main`, !on);
    room = on;
    busy = false;
    joining(false);
    if (menu) menu.root.active = on;
    A.roomPanel(on);
  }
  // the common top menu over the room panel: back and home both lead to the main panel (the page has no home above
  // the activity's, so the main panel has none)
  const menu = placeTopMenu(p, `${ENTRY}/top_menu_container`, { back: () => { void toRoom(false); }, home: () => { void toRoom(false); } });
  if (menu) menu.root.active = false;
  p.tap(`${ENTRY}/panel_main/panel_match/btn_team_up/hotspot`, () => { void toRoom(true); });
  p.tap(`${ENTRY}/panel_main/panel_left/btn_formation/hotspot`, A.squad);
  wireMatch(p, f, A, () => busy || room);
  p.tap(`${ENTRY}/panel_room/btn_train/hotspot`, A.train);
  p.tap(`${ENTRY}/panel_room/panel_right/btn_strat_room/hotspot`, A.create);
  p.tap(`${ENTRY}/panel_room/panel_right/btn_join_room/btn_search_room/panel_enable/hotspot`, () => join(code?.value() ?? ''));
  joining(false);
  // the title's two lines, which the game fills at run time, and the season cover in the recording's colour (INF-0017)
  p.text(`${TITLE}/group_text_ice/entry_text_ice`, 'ICEBREAKER');
  p.text(`${TITLE}/group_text_game/entry_text_ice`, 'GAME');
  if (f.imgEntryAnimBkg) p.color(f.imgEntryAnimBkg, COVER);
  const a = f.animEntry, first = !titled;
  titled = true;
  if (a?.animationName && first) {
    // the title holds its first frame (white) until the 3D scene and the particle effects are ready, then plays
    void p.play(a.animationWrapper ?? '@', a.animationName, { rate: 0 });
    const ready = Promise.all([scene3d, A.effects]), late = new Promise((done) => { setTimeout(done, TITLE_WAIT_MS); });
    void Promise.race([ready, late]).then(() => { if (!p.scr.dead) void p.anim(a); });
  } else if (a?.animationName) void p.play(a.animationWrapper ?? '@', a.animationName, { from: TITLE_END });
  return {
    part: p,
    /** The 编队 button's hint when the 常规队 cannot be used. */
    update: () => p.show(`${ENTRY}/panel_main/panel_left/btn_formation/info_not_ready`, !!A.squadProblem()),
    /** Back from the room panel to the main panel. */
    back: () => toRoom(false),
    /** A join came to nothing (an error from the server). */
    failed: () => joining(false),
    /** Whether the room panel shows. */
    get room() { return room; },
    /** The join box (for tests and the page). */
    code,
    close: () => { scene?.stop(); closePart(p); },
  };
}
