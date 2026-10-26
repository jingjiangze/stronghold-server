// The stage steps of the prepare page (docs/spec/page.md 页面-6): 项目调整 on the stage choose panel (the owner picks
// the stage in the stage list and goes on; the guest prepares), 项目确认 on the stage confirm part of the entrance show
// panel (the stage's detail and both players' confirmations), and the start of the match on its show part (both
// players' name cards and styles). The room flow is the platform's (房间-2, 房间-6).
import { openPart, closePart, place, unplace, fillList, setSwitch, placeTopMenu, placeBottomBar, seasonLogo, placePicture, placeAvatar, showInvert } from './lobbykit.js';
import { stagePanel, ownerStatus, pictureOf } from './lobbymap.js';
import { STYLES, TOASTS, PLAYER_TITLE, INVERSE, modeOf } from '@icebreaker/mode-regular';
import { cardName } from './roomtext.js';

/** @typedef {import('./lobbykit.js').Part} Part @typedef {import('./roomview.js').ProjectView} ProjectView */
/** @typedef {import('@icebreaker/mode-regular').BoxEntry} BoxEntry @typedef {import('./roomtext.js').Pick} Pick */
/**
 * What the steps work with: the room's messages, the lobby's projects, the pack's art, the cards' pictures, the
 * styles' icons, toasts, leaving (asked first), 请离房间, 上一步, whether the page is offline, the stage list, the
 * lineup's sub-step, copying the invitation, names, the save's squad and style, the lineup being set and the room's
 * box entries.
 * @typedef {object} StepCtx
 * @property {(m: Record<string, unknown>) => void} send
 * @property {() => ProjectView[]} projects
 * @property {() => any} art
 * @property {import('./lobbycards.js').CardArt} cards
 * @property {(style: string, variant: '' | '_tiny' | '_show') => string | null} styleIcon
 * @property {(text: string) => void} toast
 * @property {() => void} leave
 * @property {() => void} kick
 * @property {() => void} back
 * @property {() => boolean} offline
 * @property {(open: boolean) => void} list
 * @property {(sub: 'sel' | 'skill' | 'check') => void} sub
 * @property {() => void} copy
 * @property {(id: string) => string} nameOf
 * @property {(id: string) => { rarity: number, profession: string } | null} rosterOf
 * @property {() => import('@icebreaker/mode-regular').Squad} squad
 * @property {() => string | null} squadProblem
 * @property {() => string} style
 * @property {(d: Pick[]) => void} setDraft
 * @property {(seat: number, id: string) => BoxEntry | null} entryOf
 * @property {(id: string, skill: number) => string | null} skillId
 * @property {(color?: boolean, type?: string) => string | null} modeIcon a mode's icon URL (常规项目's unless a type is given; its coloured tile when asked)
 * @property {(id: string, k: number) => string | null} moduleType a module's type (EXE-Y…), null until its data came
 * @property {(id: string) => number} moduleCount how many modules an operator has (0 until its data came)
 * @property {() => number} version a number that changes when lazily loaded data (skill ids, module types) comes
 * @property {() => { base: string, index: any } | null} emoteArt the emote index and its folder's URL (房间-7), null without it
 * @property {(id: string, theme: string) => void} emote sends an emote (房间-7)
 */

/** The class nodes of the class icon prefab (common/multiv3_map_diff_icon). */
const CLASSES = Object.freeze(['TRAINING', 'ORDINARY', 'DIFFICULTY', 'EXTREMELY']);

/** Shows a project's class on a class icon. @param {Part} icon @param {string} cls the class (ORDINARY…) or its name */
export function fillDiff(icon, cls) {
  for (const c of CLASSES) icon.show(`@${c}`, c === cls || icon.node(`@${c}/Text`)?.n.comps.text?.text === cls);
}

/**
 * A project's class icon in a container, at the scale its controller gives.
 * @param {Part} p @param {string | undefined} at @param {string | undefined} prefab @param {ProjectView} pr @param {number} [scale]
 */
export function classIcon(p, at, prefab, pr, scale = 1) {
  const icon = at && prefab ? place(p, at, prefab) : null;
  if (!icon) return;
  fillDiff(icon, pr.class);
  icon.root.rt.scale = [scale, scale];
}

/**
 * 项目调整 on the stage choose panel (房间-2). @param {Part} p @param {StepCtx} X
 */
export function createStage(p, X) {
  const f = p.view();
  p.tap('@owner_guest_toggle/group_owner/group_btn_select_map/bg/hotspot', () => X.list(true));
  p.tap('@group_map_detail/root_switch_map/hotspot', () => X.list(true));
  p.tap('@group_room_id/container/btn_copy', X.copy);
  p.tap('@owner_guest_toggle/group_owner/group_wait_status/group_btn_prepared/btn_enter_toggle/prepared_avail/hotspot', () => X.send({ t: 'go' }));
  /** @type {any} */
  let last = null;
  p.tap('@owner_guest_toggle/group_guest/group_btn_prepared_g/has_map_toggle/has_map', () => X.send({ t: 'prepare', on: !last?.prepared }));
  const mode = createModeSwitch(p, f, X, () => last);
  /** @type {number} */
  let shown = -1, entered = false;
  return {
    /** @param {any} S */
    update(S) {
      const v = S.view, sp = stagePanel(v), pr = X.projects()[v.project];
      if (!entered) { entered = true; void p.anim(sp.owner ? f.ownerInAnim : f.guestInAnim); }
      if (shown >= 0 && shown !== v.project) X.toast(sp.owner ? TOASTS.roomOwnerReviseMap : TOASTS.roomCollaboratorReviseMap);
      last = v;
      mode.update(v, sp.owner);
      p.showAll(f.emptyMapObjs, false);
      p.showAll(f.selectedMapObjs, true);
      p.showAll(f.ownerObjs, sp.owner);
      p.showAll(f.guestObjs, !sp.owner);
      setSwitch(p, f.ownerGusetToggle, sp.owner);
      setSwitch(p, f.randomMapToggle, false);
      p.text(f.roomIdText, v.code);
      p.text(f.ownerWatingStatusTxt, ownerStatus(v));
      p.text(f.guestWatingStatusTxt, v.prepared ? '已准备就绪，等待房主进入备赛' : '房主已选好项目，准备好后点击准备就绪');
      setSwitch(p, f.ownerPreparBtnAvailToggle, sp.canEnter);
      setSwitch(p, f.guestBtnAvailToggle, true);
      setSwitch(p, f.guestPreparedCancelBtnToggle, v.prepared);
      if (pr && shown !== v.project) {
        // the guest sees the stage the owner chose come in
        if (!sp.owner) void p.anim(f.guestMapDetailInAnim);
        p.text(f.mapCodeText, pr.code);
        p.text(f.mapModeText, pr.name);
        p.sprite(f.stageBigPreviewImg, pictureOf(X.art(), pr.stage));
        classIcon(p, f.mapDiffIconViewContainer, f.mapDiffIconViewPrefab, pr, f.mapDiffScale ?? 1);
      }
      shown = v.project;
    },
  };
}

/**
 * 互选模式 on the stage panel (房间-8): the owner's mode toggle (常规模式 / 互选模式, unlocked) turns it; the panel's top
 * shows its highlight and hint while it is on, switching with its clips; a change is toasted to both.
 * @param {Part} p @param {Record<string, any>} f @param {StepCtx} X @param {() => any} last the room view last drawn
 */
function createModeSwitch(p, f, X, last) {
  const toggle = f.inverseToggleViewContainer ? place(p, f.inverseToggleViewContainer, f.inverseToggleViewPrefab) : null, tf = toggle?.view() ?? {};
  if (toggle) {
    setSwitch(toggle, tf.inverseUnlockState ?? '@bg/group_flip_lock_toggle', true);
    toggle.show(tf.newTrackGO ?? '@new_track_root', false);
    toggle.tap('@bg/hotspot', () => { const v = last(); if (v) X.send({ t: 'inverse', on: !v.inverse }); });
  }
  /** @type {boolean | null} */
  let on = null;
  return {
    /** @param {any} v @param {boolean} owner */
    update(v, owner) {
      if (on === v.inverse) return;
      const at = on === null ? Infinity : 0;
      if (on !== null) X.toast(owner ? TOASTS.roomOwnerReviseMode : TOASTS.roomCollaboratorReviseMode);
      on = !!v.inverse;
      showInvert(p, '@group_top_deco/group_invert', on, INVERSE.hint);
      void p.play('@group_top_deco', on ? 'mode_switch_invert' : 'mode_switch_normal', { from: at });
      if (toggle) void toggle.play('@', 'mode_toggle_switch', { reverse: !on, from: at });
    },
  };
}

/** The stage list's tabs by class, in the list's order (its tabs' `diffType` 2–4). */
const TABS = Object.freeze(['ORDINARY', 'DIFFICULTY', 'EXTREMELY']);

/**
 * The stage list over the prepare page for the owner (房间-2): a tab for each class that has projects, a row of the
 * class's projects (their small pictures and codes, the current one marked); a pick sets the project and closes it.
 * @param {Part} page @param {StepCtx} X
 */
export function createStageList(page, X) {
  const state = place(page, '@state_engine/stage_list_state', 'prepare/stagelist/stage_list_state');
  const sf = state?.view() ?? {}, arena = state && sf.viewHolder && sf.viewPrefab ? place(state, sf.viewHolder, sf.viewPrefab) : null;
  const af = arena?.view() ?? {};
  state?.tap('@btn_back', () => X.list(false));
  // the common top menu: back closes the list
  if (state) placeTopMenu(state, '@top_menu_container', { back: () => X.list(false) });
  state?.show('@btn_reward', false);
  arena?.show('@pnl_content/dec_info', false);
  let cls = '', current = -1, played = '';
  /** @param {string} c */
  const tab = (c) => { cls = c; current = -2; };
  TABS.forEach((c, i) => {
    const t = `@pnl_content/panel_top_bar/layout_tab/pnl_tab${i + 1}`;
    arena?.tap(`${t}/hotspot`, () => { tab(c); X.list(true); });
  });
  return {
    /** @param {any} S */
    update(S) {
      if (!arena) return;
      const projects = X.projects(), v = S.view;
      if (!cls) cls = projects[v.project]?.class ?? TABS[0];
      // the class shown comes in with its colour line (each class its own clip)
      if (arena && cls !== played) {
        played = cls;
        void arena.anim((af.animConfigs ?? []).find((/** @type {any} */ c) => c.diffType === TABS.indexOf(cls) + 2)?.diffAnim);
      }
      TABS.forEach((c, i) => {
        const t = `@pnl_content/panel_top_bar/layout_tab/pnl_tab${i + 1}`, has = projects.some((x) => x.class === c);
        arena.show(t, has);
        arena.show(`${t}/img_selected`, c === cls);
        arena.text(`${t}/text_tab`, projects.find((x) => x.class === c)?.className ?? '');
      });
      if (current === v.project) return;
      current = v.project;
      rows(arena, af, { projects, cls, chosen: v.project }, X);
    },
    close: () => unplace(page, '@state_engine/stage_list_state'),
  };
}

/**
 * The list's row of a class's projects, the chosen one marked.
 * @param {Part} arena @param {Record<string, any>} af @param {{ projects: ProjectView[], cls: string, chosen: number }} o @param {StepCtx} X
 */
function rows(arena, af, o, X) {
  const { projects, cls, chosen } = o;
  const mine = projects.map((x, i) => ({ x, i })).filter(({ x }) => x.class === cls);
  // a row for each mode with projects of the class, its title the mode's (常规项目, then 堡垒守御)
  const modes = [...new Set(mine.map(({ x }) => x.mode))];
  fillList(arena, af.layout, modes.length, (row, r) => {
    const rf = row.view(), mode = modes[r], own = mine.filter(({ x }) => x.mode === mode), icon = X.modeIcon(false, mode);
    fillList(row, rf.titleLayout, 1, (t) => {
      t.text('@text_name', modeOf({ mode }).name);
      t.show('@img_seperator', false);
      // the title's mode icon (an empty slot the page fills; none without the room atlas)
      t.picture('@img_icon', icon);
      t.show('@img_icon', !!icon);
    });
    fillList(row, rf.stageLayout, own.length, (item, k) => {
      const { x, i } = own[k], f = item.view(), small = pictureOf(X.art(), x.stage);
      item.text(f.stageCodeText, x.code);
      item.sprite(f.stageImage, small ? X.art().stageIcon?.[`${small.split('/').pop()}_small`] ?? small : null);
      item.show(f.pnlLocked, false);
      item.show(f.pnlCorner, false);
      item.show(f.randomPanel, false);
      item.show(f.pnlTrackpoint, false);
      item.show('@pnl_stage/detail_panel/normal_panel/star_content', false);
      item.show(f.pnlSelected, i === chosen);
      item.tap('@hotspot', () => { X.send({ t: 'project', index: i }); X.list(false); });
    });
  }, af.rowViewPrefab);
}

/** The dialog 「查看地图」 opens (页面-6): the stage detail over the prepare page. */
const STAGE_DIALOG = 'dialog/stage_detail_dialog';

/**
 * The stage's detail in its dialog over the prepare page (页面-6, 「查看地图」 on the top bar): as 项目确认 shows it; its
 * close button or a tap outside it closes it. @param {any} ui @param {ProjectView} pr @param {StepCtx} X
 */
export function openStageDialog(ui, pr, X) {
  const dlg = openPart(ui, STAGE_DIALOG, 70), f = dlg.view(), close = () => closePart(dlg);
  const d = f.viewContainer && f.viewPrefab ? place(dlg, f.viewContainer, f.viewPrefab) : null;
  if (d) { fillDetail(d, pr, X); void d.anim(d.view().inAnim); }
  dlg.tap(`${f.backBtnRect ?? '@btn_close'}/hotspot`, close);
  dlg.tap('@darken', close);
}

/** The room a goal row keeps at its right once its text takes the reward's (INF-0016). */
const GOAL_RIGHT = 12;

/**
 * The stage's detail (项目确认, 房间-2): its code, the mode and class, its description, its picture, the activity's
 * missions for it.
 * @param {Part} d @param {ProjectView} pr @param {StepCtx} X
 */
export function fillDetail(d, pr, X) {
  const f = d.view();
  d.text(f.stageCodeTxt, pr.code);
  // the code and the mode only, as the original's recording shows the title (IG-1 常规项目, without the stage's name)
  d.text(f.modeNameCodeTxt, modeOf(pr).name);
  classIcon(d, f.diffIconViewContainer, f.diffIconViewPrefab, pr, f.diffScale ?? 1);
  // the title's mode icon: the mode's coloured tile (the slot's own size; the original's recording shows it red)
  d.picture(f.titleModeIconImg, X.modeIcon(true, pr.mode));
  d.show(f.titleModeIconImg, !!X.modeIcon(true, pr.mode));
  seasonLogo(d, f.seasonIcon, 'detail');
  // the stage's description as the game writes it (its markup as rich text), else the stages' titles
  d.text(f.stageDetailTxt, pr.detail || pr.stages.map((s, i) => `阶段${i + 1}：${s.title}`).join('\n'));
  d.sprite(f.stageBigPreviewImg, pictureOf(X.art(), pr.stage));
  // the goal panel: the activity's missions for the stage in order, an arrow between them (the stage's tasks without
  // them); their rewards are the activity's tokens, which the platform does not give, so a mission's text takes the
  // reward's room too, a long one on two lines (the row grows; INF-0016)
  const goals = pr.missions?.length ? pr.missions : pr.stages.map((s) => s.basic);
  fillList(d, f.goalItemContainer, goals.length, (g, i) => {
    const gf = g.view(), t = g.node(gf.goalTxt);
    if (t) t.rt.size[0] = Math.max(t.rt.size[0], g.root.rt.size[0] - (g.root.n.comps.lg?.pad?.[0] ?? 0) - GOAL_RIGHT);
    g.text(gf.goalTxt, goals[i]);
    g.show(gf.rewardCntTxt, false);
    g.show(gf.itemIconImg, false);
    g.show(gf.nextArrowObj, i < goals.length - 1);
  }, f.goalItemPrefab);
  const regular = (f.modeConfigs ?? []).find((/** @type {any} */ m) => m.modeType === 1);
  for (const m of f.modeConfigs ?? []) d.show(m.recordObj, m === regular);
  if (regular) { d.show(regular.recordContentObj, false); d.show(regular.noRecordObj, true); }
}

/**
 * 项目确认 (房间-2, 房间-3): the stage's detail, the mate's confirmation, this player's button — 我确认好了 sends the
 * save's 常规队 and style, unless the 常规队 cannot be used.
 * @param {Part} p @param {StepCtx} X
 */
export function createConfirm(p, X) {
  const f = p.view();
  p.show(f.entranceShowRoot, false);
  p.show('@multi_v3_stage_confirm', true);
  void p.anim(f.mapConfirmEnterAnim);
  let detail = false;
  /** @type {any} */
  let last = null;
  p.tap('@multi_v3_stage_confirm/panel_certain/btn_certain_player', () => {
    if (last?.confirmed[last.you]) return;
    const why = X.squadProblem();
    if (why) { X.toast(`常规队不能参赛：${why}`); return; }
    X.send({ t: 'confirm', squad: X.squad(), style: X.style() });
  });
  return {
    /** @param {any} S */
    update(S) {
      const v = S.view, pr = X.projects()[v.project];
      last = v;
      for (const r of f.invertObjs ?? []) showInvert(p, r, !!v.inverse);
      if (!detail && pr) {
        detail = true;
        const d = f.stageDetailContainer && f.stageDetailPrefab ? place(p, f.stageDetailContainer, f.stageDetailPrefab) : null;
        if (d) { fillDetail(d, pr, X); void d.anim(d.view().inAnim); }
      }
      setSwitch(p, f.partnerReadyToggle, !!v.confirmed[1 - v.you]);
      setSwitch(p, f.confirmBtnToggle, !!v.confirmed[v.you]);
    },
  };
}

/** How long the entrance show holds 比赛启动 between its clips, as the original's recording shows it (INF-0015). */
export const SHOW_HOLD_MS = 1200;

/**
 * The entrance show once both players have confirmed (页面-6): on 项目确认's own panel, the logo comes together, then
 * 比赛启动 with both players' name cards and styles (房间-3), held a while, then it goes; resolves when it has gone.
 * @param {Part} p the 项目确认 part @param {StepCtx} X @param {any} v the room's view
 */
export async function playEntrance(p, X, v) {
  const f = p.view();
  p.show('@multi_v3_stage_confirm', false);
  p.show(f.entranceShowRoot, true);
  for (const r of f.invertObjs ?? []) showInvert(p, r, !!v.inverse);
  // the season's logo in the corner, which the game fills at run time (INF-0018)
  seasonLogo(p, f.seasonIconImg2, 'start');
  if (f.bottomBarContainer) placeBottomBar(p, f.bottomBarContainer);
  showPlayer(p, f, X, v, [v.you, f.selfAssitIllustContainer, f.selfEffectIcon, f.selfEffectNameTxt, f.selfNameCardContainer]);
  showPlayer(p, f, X, v, [1 - v.you, f.partnerAssitIllustContainer, f.partnerEffectIcon, f.partnerEffectNameTxt, f.partnerNameCardContainer]);
  await p.anim(v.inverse ? f.flipEnterAnim ?? f.normEnterAnim : f.normEnterAnim);
  await new Promise((done) => { setTimeout(done, SHOW_HOLD_MS); });
  await p.anim(f.showExitAnim);
}

/**
 * One player's side of the entrance show: its assistant's illustration at its chosen art (房间-1), its style's icon and
 * name, its name card.
 * @param {Part} p @param {Record<string, any>} f @param {StepCtx} X @param {any} v
 * @param {[number, string, string, string, string]} side the seat; its illust loader, its style's icon and name, its name card's container
 */
function showPlayer(p, f, X, v, [seat, illust, icon, name, card]) {
  const m = v.members[seat], a = m?.assist, st = STYLES.find((s) => s.id === v.styles[seat]);
  placePicture(p, illust, a ? X.cards.illust(a.id, a.art) : null);
  p.picture(icon, st ? X.styleIcon(st.id, '') : null);
  p.text(name, st?.name ?? '');
  const c = card && f.nameCardPrefab ? place(p, card, f.nameCardPrefab) : null;
  if (c) nameCard(c, cardName(m), X.art().namecard, m?.avatar ? X.cards.avatar(m.avatar) : null);
}

/**
 * A player's short name card (INF-0014): its 昵称#代号 and the title of a player who chose none (平凡的博士) on the
 * default card skin — the skin at its sprite's own size in the card's skin holder (the holder's scale makes it the
 * card's size, as the original's recording shows it) — and its avatar in its avatar loader; no id, level, mentor mark
 * or early-quit mask (the platform has none).
 * @param {Part} c @param {string} name @param {string | undefined} skin the default skin's sprite @param {string | null} avatar
 */
export function nameCard(c, name, skin, avatar) {
  const f = c.view(), sp = skin ? c.scr.ctx.pack.sprites[skin] : null;
  placePicture(c, f.bgImgContainer, sp && skin ? { sprite: skin, pos: [0, 0], size: [sp.w, sp.h] } : null);
  c.text(f.doctorName, name);
  c.text(f.doctorTitle, PLAYER_TITLE);
  for (const r of [f.doctorUidGO, f.mentorObj, f.earlyQuitMaskGO]) c.show(r, false);
  c.show('@container/headIcon/panel_exp', false);
  placeAvatar(c, f.avatarViewContainer, avatar);
}
