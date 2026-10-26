// The activity's prepare page (docs/spec/page.md 页面-6): the room from 项目调整 to the match — its top bar (the step's
// countdown, warning from the activity's hintTime; the stage; leaving; 上一步 in the lineup), the two players beside
// it (names, styles once shown, who has confirmed, 请离房间, the room's time left), the banner of a new phase, the
// step views in its step container (项目确认 leaving with the entrance show), the countdown before the match, the
// lost-connection view, the emotes (lobbychat.js, 房间-7).
import { openPart, closePart, place, setSwitch, screenKey, placeAvatar, showInvert } from './lobbykit.js';
import { PLAYER_TITLE, INVERSE } from '@icebreaker/mode-regular';
import { PAGES, STEP_SCREENS, stepOf, countdownOf, bannerOf } from './lobbymap.js';
import { createStage, createStageList, createConfirm, playEntrance, classIcon, openStageDialog } from './lobbystage.js';
import { createPick } from './lobbypick.js';
import { createLineup } from './lobbylineup.js';
import { clock, pingText, cardName } from './roomtext.js';
import { createChat } from './lobbychat.js';


/** @typedef {import('./lobbykit.js').Part} Part @typedef {import('./lobbystage.js').StepCtx} StepCtx */

const MAIN = '@state_engine/main_state';
const TOP = 'prepare/mainviews/act_multi_v3_parepare_main_top_view', SIDE = 'prepare/mainviews/act_multi_v3_side_player_info_view';
const COUNTDOWN = 'prepare/mainviews/act_multi_v3_countdown_view';
/** When the countdown's logo stands and the screen goes black for the match, as the original's recording shows it (INF-0015). */
const LOGO_STANDS_MS = 4400, BLACK_MS = 100;
/**
 * Whether the side view shows its full panel on a step: in 项目调整 and the lineup's check; the coordination and the
 * lineup's first two steps lay their content out from the left edge, where only the small one fits; 项目确认 shows no
 * side view at all, as the original's recording does (INF-0013).
 * @param {string} step
 */
const fullSide = (step) => step === 'stage' || step === 'check';

/** What each side view showed last: its panel (small or not) and its players' ready marks, for the clips on a change. @type {WeakMap<Part, { small: boolean | null, ready: boolean[] }>} */
const SIDE_SEEN = new WeakMap();

/** The step controllers by step screen use (the three lineup steps share the squad check panel). */
const CONTROL = Object.freeze({ stage: 'stage', confirm: 'confirm', pick: 'pick', sel: 'lineup', skill: 'lineup', check: 'lineup' });

/** Each step's controller, made on a step part. @type {Record<string, (p: Part, X: StepCtx) => { update: (S: any, L: any) => void }>} */
const MAKERS = { stage: createStage, confirm: createConfirm, pick: createPick, lineup: createLineup };

/**
 * The prepare page on the lobby UI.
 * @param {any} ui @param {StepCtx} X
 */
export function createPrepare(ui, X) {
  const page = openPart(ui, PAGES.prepare), mv = page.view(MAIN);
  const containers = Object.fromEntries((mv.viewPrefabs ?? []).map((/** @type {any} */ v) => [screenKey(v.viewPrefab), v.container]));
  const top = place(page, containers[TOP] ?? `${MAIN}/top_view`, TOP), side = place(page, containers[SIDE] ?? `${MAIN}/player_info_view`, SIDE);
  const tf = top?.view() ?? {}, sf = side?.view() ?? {};
  if (top) wireTop(top, tf, X);
  // 查看地图: the stage's detail in its dialog (页面-6)
  top?.tap('@bkg/panel_horz_grp/panel_map_btn/btn_show_map', () => {
    const v = lastArgs?.[0]?.view, pr = v ? X.projects()[v.project] : null;
    if (pr) openStageDialog(ui, pr, X);
  });
  if (side) wireSide(side, sf, X);
  const chat = createChat(page, side, sf, X);
  /** @type {[any, any] | null} */
  let lastArgs = null;
  /** @type {string | null} */
  let phase = null, warn = false, offline = false, list = /** @type {{ update: (S: any) => void, close: () => void } | null} */ (null);
  // the entrance show fills the screen: the top bar and the side view give way to it
  const cover = (/** @type {boolean} */ on) => { for (const p of [top, side]) if (p) p.root.active = !on; };
  const steps = createSteps(page, mv.stepView ?? `${MAIN}/step_container`, X, () => { if (top) void top.anim(tf.switchAnim); }, cover);

  /** @param {any} S @param {any} L */
  function update(S, L) {
    lastArgs = [S, L];
    const v = S.view, step = stepOf(v, L);
    if (!steps.swap(step, S, () => { if (lastArgs) update(...lastArgs); })) return;
    steps.c?.update(S, L);
    stageList(S, L);
    if (top) topUpdate(top, tf, S, step, X);
    if (side) { side.root.active = step !== 'confirm'; sideUpdate(side, sf, S, X, step); }
    chat.update(S, !fullSide(step));
    const b = bannerOf(phase, v);
    if (b) void banner(page, b);
    phase = v.phase;
    // the connection lost: its view comes in with its clip (页面-6)
    const lost = X.offline(), at = `${MAIN}/lost_connection_view`;
    page.show(at, lost);
    if (lost && !offline) void page.anim(page.view(at).entryAnim);
    offline = lost;
  }

  /** The stage list over the page while the owner picks a stage (项目调整). @param {any} S @param {any} L */
  function stageList(S, L) {
    const open = L.list && S.view.phase === 'setup' && S.view.you === 0;
    if (open && !list) list = createStageList(page, X);
    if (!open && list) { list.close(); list = null; }
    list?.update(S);
  }

  return {
    part: page,
    update,
    /** The countdowns, a few times a second. @param {any} S */
    tick(S) {
      if (!S.view) return;
      const cd = countdownOf(S.view, performance.now() - S.at);
      if (top) warn = countdownTick(top, tf, cd, warn);
      if (side) side.text(sf.closeTxt, clock(S.view.left - (performance.now() - S.at))); chat.tick(S);
      // the lobby's latency on the top bar and, beside no 上一步, on the side view's full panel (页面-6)
      const pt = S.ping == null ? '' : pingText(S.ping);
      if (top) { top.show(tf.pingLabel, !!pt); top.text(tf.pingLabel, pt); }
      if (side) side.text(sf.pingTxt, pt);
    },
    /**
     * Before the match (页面-6): the countdown over the lineup, 3-2-1, then the logo's white frame closing in; once
     * the logo stands the screen goes black for the match page. Resolves then.
     */
    async start() {
      await steps.leaving;
      const at = containers[COUNTDOWN] ?? `${MAIN}/countdown_view_container`, cd = place(page, at, COUNTDOWN);
      if (cd) await Promise.race([cd.anim(cd.view().cdAnim), wait(LOGO_STANDS_MS)]);
      await toBlack();
    },
    close: () => { list?.close(); chat.close(); closePart(page); }, chat,
  };
}

/** @param {number} ms */
const wait = (ms) => new Promise((done) => { setTimeout(done, ms); });

/** The screen fades to black over everything (the match page comes next). */
async function toBlack() {
  const body = globalThis.document?.body;
  if (!body) return;
  const el = document.createElement('div');
  Object.assign(el.style, { position: 'fixed', inset: '0', background: '#000', opacity: '0', transition: `opacity ${BLACK_MS}ms linear`, zIndex: '2147483647', pointerEvents: 'none' });
  body.appendChild(el);
  void el.offsetWidth;
  el.style.opacity = '1';
  await wait(BLACK_MS);
}

/**
 * The prepare page's step views (页面-6): `swap` keeps the same controller, else places a new view (and calls
 * `entered`); 项目确认 first plays its exit clip and, going on to the coordination or the lineup, the entrance show
 * over the covered page, the new view coming after them (`again` runs then); swap returns false while they play.
 * @param {Part} page @param {string} at the step container @param {StepCtx} X @param {() => void} entered
 * @param {(on: boolean) => void} cover hides what the entrance show covers
 */
function createSteps(page, at, X, entered, cover) {
  /** @type {{ ctl: string, c: { update: (S: any, L: any) => void } | null, part: Part | null }} */
  let cur = { ctl: '', c: null, part: null };
  /** @type {Promise<void> | null} */
  let leaving = null;
  return {
    get c() { return cur.c; },
    get leaving() { return leaving; },
    /** @param {string} step @param {any} S @param {() => void} again */
    swap(step, S, again) {
      if (leaving) return false;
      const ctl = /** @type {Record<string, string>} */ (CONTROL)[step] ?? 'stage';
      if (ctl === cur.ctl && cur.c) return true;
      const was = cur.part, exit = cur.ctl === 'confirm' ? was?.view().mapConfirmExitAnim : null;
      if (exit?.animationName && was) {
        const show = ctl !== 'stage' && S.view;
        leaving = was.anim(exit)
          .then(async () => { if (show) { cover(true); try { await playEntrance(was, X, S.view); } finally { cover(false); } } })
          .then(() => { leaving = null; cur = { ctl: '', c: null, part: null }; again(); });
        return false;
      }
      const part = place(page, at, /** @type {Record<string, string>} */ (STEP_SCREENS)[step]);
      cur = { ctl, c: part ? MAKERS[ctl](part, X) : null, part };
      entered();
      return true;
    },
  };
}

/** The top bar's taps: leaving, 上一步. @param {Part} t @param {Record<string, any>} f @param {StepCtx} X */
function wireTop(t, f, X) {
  t.tap('@bkg/btn_exit/hot_spot', X.leave);
  t.tap('@bkg/panel_horz_grp/panel_pre_btn/btn_return', X.back);
}

/**
 * The top bar for a room (页面-6): 查看地图, the stage and its class, leaving hidden while the stage is confirmed and the
 * match starts. Beside the side view's full panel its own leaving and 上一步 give way to the panel's; the bar's space
 * for the team and, beside the full panel, its 上一步 slot keep the stage clear of the side view (INF-0013).
 * @param {Part} t @param {Record<string, any>} f @param {any} S @param {string} step @param {StepCtx} X
 */
function topUpdate(t, f, S, step, X) {
  const p = X.projects()[S.view.project];
  // 互选模式's hint on the bar from the coordination on: 项目调整's panel shows its own (房间-8)
  showInvert(t, f.invertTipObj, !!S.view.inverse && step !== 'stage', INVERSE.hint);
  if (p) {
    t.text(f.stageCode, p.code);
    t.text(f.stageName, p.name);
    if (!t.node(f.diffIconContainer)?.kids.length) classIcon(t, f.diffIconContainer, f.diffIconPrefab, p, f.diffIconScale ?? 1);
  }
  const full = fullSide(step);
  for (const r of t.view('@hideInEntrance').gos ?? []) t.show(r, step !== 'confirm');
  // the bar keeps clear of the side view as the original does: the narrow view's space always, the 上一步 slot too
  // beside the full view (under it there) and in the skill step (where 上一步 is on the bar)
  t.show(f.btnReturn, full || step === 'skill');
  t.show(f.space, true);
  if (full) t.show('@bkg/btn_exit', false);
}

/**
 * The top bar's countdown: hidden without one; its number and progress; its warning look, the warning clip once on
 * entering it. Returns whether it warns now.
 * @param {Part} t @param {Record<string, any>} f @param {{ left: number, total: number, warn: boolean } | null} cd @param {boolean} was
 */
function countdownTick(t, f, cd, was) {
  t.show(f.cdState, !!cd);
  if (!cd) return false;
  setSwitch(t, f.cdState, cd.warn);
  for (const r of f.cdNums ?? []) t.text(r, String(Math.ceil(cd.left / 1000)));
  for (const r of f.cdPrgs ?? []) { const s = t.node(r); if (s) s.fill = cd.total > 0 ? cd.left / cd.total : 0; }
  if (cd.warn && !was) void t.anim(f.emergencyAnim);
  return cd.warn;
}

/** The side view's taps: leaving, 上一步, 请离房间. @param {Part} s @param {Record<string, any>} f @param {StepCtx} X */
function wireSide(s, f, X) {
  s.tap(f.backBtnRect ?? '@full_panel_bg/btn_exit/hot_spot', X.leave);
  s.tap('@full_panel_bg/last_step_btn_toggle/group_return/btn_return/hotspot', X.back);
  s.tap('@full_panel_bg/group_player_top/btn_kick/layout/kick_img/hotspot', X.kick);
  s.showAll(f.chatObjs, false);
  s.showAll(f.chatNewPoints, false);
  s.show('@full_panel_bg/group_player_top/info_toggle/group_wating/group_avatar/panel_invite', false);
}

/**
 * The two players (页面-6): the mate above, this player below — names, the style once the room shows it, the confirm
 * marks while the stage is confirmed, the mate offline, 请离房间 for the owner in 项目调整; the full view or the small
 * one by the step (fullSide), sliding in as the panels change; on the full one 上一步 in the lineup's check, else the
 * room's time left.
 * @param {Part} s @param {Record<string, any>} f @param {any} S @param {StepCtx} X @param {string} step
 */
function sideUpdate(s, f, S, X, step) {
  const v = S.view, me = v.you, mate = 1 - me, other = v.members[mate] ?? null, small = !fullSide(step);
  const seen = SIDE_SEEN.get(s) ?? { small: null, ready: [false, false] };
  SIDE_SEEN.set(s, seen);
  setSwitch(s, f.tinyToggle ?? '@', small);
  if (seen.small !== null && seen.small !== small) void s.anim(small ? f.tinyPanelInAnim : f.fullPanelInAnim);
  seen.small = small;
  setSwitch(s, f.topPlayerToggle, !!other);
  for (const [g, i, k] of /** @type {[any, number, number][]} */ ([[f.topPlayerGroup, mate, 0], [f.botPlayerGroup, me, 1]])) {
    if (!g) continue;
    const ready = player(s, g, v, i, X);
    // a mark that comes draws itself in (its clip); one that goes is hidden
    if (ready && !seen.ready[k]) void s.anim(g.readyAnim);
    seen.ready[k] = ready;
  }
  s.showAll(f.charPickObjs, v.styles?.some((/** @type {string} */ x) => x));
  s.showAll(f.stageCheckObjs, false);
  s.show(f.kickBtnObj, me === 0 && v.phase === 'setup' && !!other);
  s.show(f.partnerOfflineObj, !!other && !other.online);
  setSwitch(s, f.lastStepBtnToggle, step === 'check');
}

/**
 * One player's group of the side view: its 昵称#代号, the title of a player who chose none, its avatar (房间-1; no
 * level: the platform has none), its style once shown, its ready mark — the guest prepared in 项目调整, confirmed in
 * 项目确认, ready in the lineup. Returns whether the mark shows.
 * @param {Part} s @param {Record<string, any>} g @param {any} v @param {number} i @param {StepCtx} X @returns {boolean}
 */
function player(s, g, v, i, X) {
  const m = v.members[i];
  s.text(g.playerNameTxt, cardName(m));
  s.text(g.playerTitleTxt, m ? PLAYER_TITLE : '');
  s.show(g.playerLvTxt ? g.playerLvTxt.replace(/\/text_playerlevel$/, '') : null, false);
  // the style: its full icon on the full panel (the slot's scaler is made at the full icon's 150 × 156), the small one on the narrow panel
  const style = v.styles?.[i] ?? '', url = style ? X.styleIcon(style, '_tiny') : null;
  s.picture(g.effectImg, style ? X.styleIcon(style, '') : null);
  s.picture(g.effectTinyImg, url);
  s.show(g.effectTinyImg, !!url);
  placeAvatar(s, g.avatarContainer, m?.avatar ? X.cards.avatar(m.avatar) : null);
  /** @type {Record<string, boolean>} */
  const ready = { setup: i === 1 && v.prepared, confirm: !!v.confirmed[i], lineup: !!v.ready[i] }, on = ready[v.phase] ?? false;
  s.show(g.readyAnim?.animationWrapper, on);
  return on;
}

/** How long a banner stays between its clips, in ms. */
const BANNER_STAYS_MS = 900;

/**
 * The banner of a new phase (页面-6): first or second pick, no coordination needed, the lineup; it comes in, stays a
 * moment, goes. No coordination needed switches on to the lineup with its switch clip before it goes (INF-0027).
 * @param {Part} page @param {'first' | 'second' | 'skip' | 'lineup'} kind
 */
async function banner(page, kind) {
  const f = page.view(`${MAIN}/banner_view`), b = `${MAIN}/banner_view`, stay = () => new Promise((done) => { setTimeout(done, BANNER_STAYS_MS); });
  page.show(b, true);
  setSwitch(page, f.blackToggle, kind === 'second');
  page.show(f.firstNode, kind === 'first');
  page.show(f.noCharPickNode, kind === 'skip');
  page.show(f.squadNode, kind === 'lineup');
  await page.anim(f.animIn);
  await stay();
  if (kind === 'skip' && f.animSwitch?.animationName) {
    await page.anim(f.animSwitch);
    await stay();
  }
  await page.anim(f.animOut);
  page.show(b, false);
}
