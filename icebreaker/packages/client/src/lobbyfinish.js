// The result after a match (docs/spec/page.md 页面-6, room.md 房间-6): the battle finish view over the room page when
// the players come back. Its first part: this player's assistant, the stage's name and class, the stamps won as the
// rating's stars, each stage's mark of a stamp won; 下一步 goes on to its second part: both players' assistants and
// name cards, the stage's code and class, its stars and rating, when it ended; 返回房间 goes on to the room (at 项目调整
// again), 返回主页 leaves it; a like for the other player (once), and the like this player got. The original's rewards,
// milestones and reports are of systems the platform does not have and stay hidden.
import { openPart, closePart, place, placeBottomBar, placePicture } from './lobbykit.js';
import { PAGES } from './lobbymap.js';
import { fillDiff, nameCard } from './lobbystage.js';
import { cardName } from './roomtext.js';

/** @typedef {import('./lobbykit.js').Part} Part @typedef {import('./lobbymap.js').MatchResult} MatchResult */
/** @typedef {import('./roomview.js').ProjectView} ProjectView @typedef {import('./lobbystage.js').StepCtx} StepCtx */
/** A player as the room shows it (房间-1). @typedef {{ name: string, tag?: string, avatar?: string, assist?: { id: string, art: number } | null }} Player */
/**
 * What the finish view works with: the stage of a level, the room's players (this player first; the room's view, else
 * this player's own name card), the likes on the result (given, got: 房间-6), the steps' pictures and names, liking
 * the other player, going on to the room, leaving it.
 * The room's 继续一起玩 after a matched match (房间-10): whether the room is matched, each seat's choice, choosing it.
 * @typedef {{ project: (level: string, difficulty?: string) => ProjectView | null, players: () => [Player | null, Player | null], likes: () => [boolean, boolean], X: StepCtx,
 *   like: () => void, done: () => void, quit: () => void, together: () => { matched: boolean, mine: boolean, mate: boolean, room: boolean }, playTogether: () => void }} FinishCtx
 */

/** The stamps won as stars, at most 3. @param {MatchResult} r */
const starsOf = (r) => Math.min(3, r.stamps.reduce((t, x) => t + Math.max(0, x), 0));

/**
 * The finish view for a match's result: its first part, then (下一步) its second. @param {any} ui @param {MatchResult} r
 * @param {FinishCtx} A
 */
export function createFinish(ui, r, A) {
  const page = openPart(ui, PAGES.finish), f = page.view(), pr = A.project(r.level, r.difficulty);
  // behind the panels the battle's last frame, blurred, as the original shows it
  if (r.bg) page.picture(f.blurBg ?? '@blur_bg', r.bg);
  page.show(f.playerDisplayContainer, false);
  page.show(f.reportPanelContainer, false);
  const info = f.completeInfoContainer && f.completeInfoPrefab ? place(page, f.completeInfoContainer, f.completeInfoPrefab) : null;
  /** @type {ReturnType<typeof players> | null} */
  let second = null;
  const next = async () => {
    if (info) await info.anim(info.view().hideAnim);
    page.show(f.completeInfoContainer, false);
    page.show(f.playerDisplayContainer, true);
    const pd = f.playerDisplayContainer && f.playerDisplayPrefab ? place(page, f.playerDisplayContainer, f.playerDisplayPrefab) : null;
    if (pd) second = players(pd, r, pr, A); else A.done();
  };
  if (info) completeInfo(info, r, pr, A, () => { void next(); });
  else void next();
  return { part: page, close: () => closePart(page), update: () => second?.likes() };
}

/**
 * The complete info panel: this player's assistant, the stage's name and class, the bar below, the mode's rating, 下一步.
 * @param {Part} info @param {MatchResult} r @param {ProjectView | null} pr @param {FinishCtx} A @param {() => void} next
 */
function completeInfo(info, r, pr, A, next) {
  const cf = info.view();
  for (const g of [cf.earlyQuitGO, cf.earlyQuitTitleGO, cf.rewardView, cf.btnNextQuitPartGO]) info.show(g, false);
  // this player's assistant in the illustration's container, as a loader puts it (页面-6)
  assistIn(info, info.view(cf.illustView ?? '@panel_illust').illustContainer, A.players()[0], A.X);
  info.show(cf.normalTitleGO, true);
  info.text(cf.textStageName, pr?.name ?? '');
  classOf(info, cf, pr);
  if (cf.bottomBarContainer && cf.bottomBarPrefab) placeBottomBar(info, cf.bottomBarContainer, cf.bottomBarPrefab);
  const mode = cf.modeViewContainer && cf.modePrefabList?.[0] ? place(info, cf.modeViewContainer, cf.modePrefabList[0]) : null;
  if (mode) stars(mode, r, pr);
  info.tap('@panel_front/btn_next/hotspot', next);
  void info.anim(cf.enterAnim).then(() => info.anim(cf.nextAnim));
}

/** The stage's class icon in a view's container for it. @param {Part} p @param {Record<string, any>} f @param {ProjectView | null} pr */
function classOf(p, f, pr) {
  const icon = pr && f.diffIconContainer && f.diffIconPrefab ? place(p, f.diffIconContainer, f.diffIconPrefab) : null;
  if (icon && pr) fillDiff(icon, pr.class);
}

/** A player's assistant at its art in an illustration's container, the container empty without one. @param {Part} p @param {string | undefined} at @param {Player | null} m @param {StepCtx} X */
const assistIn = (p, at, m, X) => placePicture(p, at, m?.assist ? X.cards.illust(m.assist.id, m.assist.art) : null);

/** The time a match ended as the finish view writes it: YYYY/MM/DD HH:mm:ss. @param {Date} t */
export function finishTime(t) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

/**
 * The player display (the finish view's second part): both players' assistants and name cards, the stage's code and
 * class, its stars and the rating they earn (稳扎稳打, 崭露头角, 统治赛场 for 1–3), when it ended; 返回房间 and 返回主页.
 * @param {Part} pd @param {MatchResult} r @param {ProjectView | null} pr @param {FinishCtx} A
 */
function players(pd, r, pr, A) {
  const f = pd.view(), X = A.X, both = A.players();
  both.forEach((m, i) => playerSide(pd, f, X, m, i === 0));
  stageInfo(pd, f, r, pr, X);
  for (const g of [f.newPhotoGO, f.btnReportGO, f.reportSuccGO, f.btnContinueMatchGO, f.btnContinueCoopGO, f.btnCompleteTrainingGO,
    '@panel_middle/report_toggle']) pd.show(g, false);
  // a match in 互选模式 carries its mark (房间-8)
  for (const g of [f.reverseBgGO, f.reverseTagGO]) pd.show(g, !!r.inverse);
  if (f.bottomBarContainer && f.bottomBarPrefab) placeBottomBar(pd, f.bottomBarContainer, f.bottomBarPrefab);
  pd.tap(`${f.btnReturnRoomGO ?? '@panel_front/room_btn'}/hotspot`, A.done);
  pd.tap('@panel_front/quit_btn/hotspot', A.quit);
  pd.tap(`${f.btnContinueCoopGO ?? '@panel_front/play_together_btn'}/hotspot`, A.playTogether);
  const likes = likesOn(pd, f, A, !!both[1]), together = togetherOn(pd, f, A);
  together();
  void pd.anim(f.enterAnim);
  return { likes: () => { likes(); together(); } };
}

/**
 * 继续一起玩 after a matched match (房间-10): its button instead of 返回房间, its two figures lit as each seat chooses
 * it; once the room is a team room again, on to it. Returns what the room's views call. @param {Part} pd
 * @param {Record<string, any>} f @param {FinishCtx} A
 */
function togetherOn(pd, f, A) {
  const icon = '@panel_front/play_together_btn/group_icon';
  let seen = { mine: false, mate: false }, gone = false;
  return () => {
    const t = A.together();
    pd.show(f.btnContinueCoopGO, t.matched);
    pd.show(f.btnReturnRoomGO, !t.matched);
    if (!t.matched) { if (t.room && seen.mine && !gone) { gone = true; A.done(); } return; }
    if (t.mine && !seen.mine) void pd.play(`${icon}/left`, 'battle_settle_btn_together_self');
    if (t.mate && !seen.mate) void pd.play(`${icon}/right`, 'battle_settle_btn_together_partner');
    if (!seen.mine && !seen.mate && (t.mine || t.mate)) void pd.anim(f.animWavingAnim);
    seen = { mine: t.mine, mate: t.mate };
  };
}

/**
 * The likes on the player display (房间-6): the like button on the other player's card — a tap likes it once, its clip
 * turns it to the liked mark —, and on this player's card the mark of a like it got, played in when it comes. Returns
 * what the room's views call to show the likes as they are now.
 * @param {Part} pd @param {Record<string, any>} f @param {FinishCtx} A @param {boolean} mate there is another player
 */
function likesOn(pd, f, A, mate) {
  const give = f.animGiveLike, got = f.animGotLike, shown = { gave: false, got: false };
  pd.show(give?.animationWrapper, mate);
  pd.show(got?.animationWrapper, false);
  const now = () => {
    const [gave, gotIt] = A.likes();
    if (gave && !shown.gave && give) { shown.gave = true; void pd.anim(give); }
    if (gotIt && !shown.got && got) { shown.got = true; pd.show(got.animationWrapper, true); void pd.anim(got); }
  };
  if (give) pd.tap(`${give.animationWrapper}/btn_like/hotspot`, () => { if (!shown.gave) { A.like(); shown.gave = true; void pd.anim(give); } });
  now();
  return now;
}

/**
 * One player's side of the player display: its assistant and its name card. @param {Part} pd @param {Record<string, any>} f
 * @param {StepCtx} X @param {Player | null} m @param {boolean} self
 */
function playerSide(pd, f, X, m, self) {
  const side = self ? f.myIllustView : f.partnerIllustView, box = self ? f.myNameCardContainer : f.partnerNameCardContainer;
  assistIn(pd, side ? pd.view(side).illustContainer : undefined, m, X);
  const c = m && box && f.nameCardPrefab ? place(pd, box, f.nameCardPrefab) : null;
  if (c && m) nameCard(c, cardName(m), X.art().namecard, m.avatar ? X.cards.avatar(m.avatar) : null);
}

/**
 * The player display's stage: its code and class, its stars and rating, the mode's icon and when it ended.
 * @param {Part} pd @param {Record<string, any>} f @param {MatchResult} r @param {ProjectView | null} pr @param {StepCtx} X
 */
function stageInfo(pd, f, r, pr, X) {
  pd.text(f.textStageCode, pr?.code ?? '');
  classOf(pd, f, pr);
  const won = starsOf(r), normal = '@panel_middle/panel_stage_info/stage_types/stage_type_normal';
  for (const v of f.resultViewList ?? []) pd.show(v, v === normal);
  const sf = pd.view(normal);
  (sf.activeStarGOList ?? []).forEach((/** @type {string} */ s, /** @type {number} */ k) => pd.show(s, k < won));
  (sf.inactiveStarGOList ?? []).forEach((/** @type {string} */ s, /** @type {number} */ k) => pd.show(s, k >= won));
  (f.starRatingGOList ?? []).forEach((/** @type {string} */ s, /** @type {number} */ k) => pd.show(s, k === won - 1));
  pd.picture(f.imgModeIcon, X.modeIcon(true));
  pd.text(f.textFinishTime, finishTime(new Date(r.at ?? Date.now())));
}

/**
 * The rating: a star for each stamp won (at most 3), each stage's panel marked when it won its stamps (its clip after
 * the panel's own); the last stage's task as the title and its goal as the description (the task's icon is filled at
 * run time from art the packs do not have).
 * @param {Part} m @param {MatchResult} r @param {import('./roomview.js').ProjectView | null} pr
 */
function stars(m, r, pr) {
  const f = m.view(), won = Math.min(3, r.stamps.reduce((t, x) => t + Math.max(0, x), 0));
  (f.activeStarGOList ?? []).forEach((/** @type {string} */ s, /** @type {number} */ i) => m.show(s, i < won));
  (f.inactiveStarGOList ?? []).forEach((/** @type {string} */ s, /** @type {number} */ i) => m.show(s, i >= won));
  m.show(f.penaltyHintGO, false);
  m.show(f.newStarGO, false);
  m.show(f.imgType, false);
  const { got, bars } = r.fortress ? fortressRating(m, f, r.fortress, won) : stageRating(m, f, r, pr);
  stagePanels(m, f, got, bars);
  void m.anim(f.animEnter).then(() => Promise.all([f.animComplete1, f.animComplete2, f.animComplete3].map((a, i) => (got[i] ? m.anim(a) : null))));
}

/**
 * 常规项目's rating: the last stage's task as the title and its goal as the description; the first stage's stamp, the
 * second's two. @param {Part} m @param {Record<string, any>} f @param {MatchResult} r @param {import('./roomview.js').ProjectView | null} pr
 */
function stageRating(m, f, r, pr) {
  const task = pr?.stages[pr.stages.length - 1];
  m.text(f.textTitle, task?.title ?? '');
  m.text(f.textDesc, task?.basic ?? '');
  const s1 = r.stamps[0] ?? 0, s2 = r.stamps[1] ?? 0;
  return { got: [s1 > 0, s2 > 0, s2 > 1], bars: [s1, Math.min(2, s2) / 2] };
}

/**
 * 堡垒守御's rating (房间-13): the waves defended as the title, the last wave's damage as the description; the first
 * panel the stamp of 3 waves, the second those of 5 and 7. @param {Part} m @param {Record<string, any>} f
 * @param {{ defended: number, damage: number }} fr @param {number} won
 */
function fortressRating(m, f, fr, won) {
  m.text(f.textTitle, `守住 ${fr.defended} 波`);
  m.text(f.textDesc, `最终波次伤害 ${fr.damage}`);
  return { got: [won > 0, won > 1, won > 2], bars: [Math.min(1, fr.defended / 3), Math.min(1, Math.max(0, fr.defended - 3) / 4)] };
}

/**
 * The two stages' panels: their stamps' marks (stage 1 one, stage 2 two) and progress bars; no counts (the room keeps
 * stamps only). @param {Part} m @param {Record<string, any>} f @param {boolean[]} got @param {number[]} bars
 */
function stagePanels(m, f, got, bars) {
  const at = '@group_info/main/panel_stage', p1 = `${at}1/panel_progress`, p2 = `${at}2/panel_progress`;
  for (const r of [`${p1}/panel_num`, `${p2}/panel_num_1`, `${p2}/panel_num_2`, `${p2}/div`]) m.show(r, false);
  [`${p1}/panel_got`, `${p2}/panel_got_1`, `${p2}/panel_got_2`].forEach((r, i) => m.show(r, got[i]));
  [f.sliderStage1, f.sliderStage2].forEach((s, i) => { const n = m.node(s); if (n) m.scr.slider('', Math.min(1, bars[i]), n); });
}
