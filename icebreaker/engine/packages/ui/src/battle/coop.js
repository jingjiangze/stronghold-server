// The co-op top bar (docs/spec/ui.md 界面-12, 界面-16, 界面-17, 界面-39, 界面-40): over the battle screen in a match of
// two, in place of its own top bar — both players' lives (and the time until a down player comes back), the speed
// button with a light for each side's 2× switch, the pause button, the pause request waiting for the mate; the stage's
// task, or 堡垒守御's wave; the mate's pause request to answer. Their changes play the pack's clips (界面-40).
import { refNode } from '../node.js';

/** @typedef {import('../node.js').UiNode} UiNode */
/** @typedef {import('../screen.js').Screen} Screen */
/**
 * A side's state: its lives, whether its 2× switch is on, the seconds until it comes back when down (−1 when not).
 * @typedef {{ life: number, fast: boolean, revive: number }} Side
 */
/**
 * The stage's task: its number (1-based), objective (protect, target, kill, survive, boss, tower, car), count, goal and
 * advanced goal, and the seconds left of its time (or of the rest before it).
 * @typedef {{ stage: number, objective: string, count: number, goal: number, advanced?: number, left: number }} Task
 */
/**
 * 堡垒守御's wave (界面-39): its number (1-based) of the level's waves, the enemies of it gone of those it spawns, the
 * seconds left of its defence (or of the rest before it); the last wave instead its damage record.
 * @typedef {{ wave: number, waves: number, out: number, total: number, left: number, last: boolean, damage: number }} FortressTask
 */
/**
 * What the co-op top bar shows: this seat and the mate, the speed the battle runs at, whether it is paused, the share
 * left of this seat's pause request and of the mate's (−1 for none), the stage's task (none before the first), or
 * 堡垒守御's wave and the rest panel's state (界面-39).
 * @typedef {{ me: Side, mate: Side, speed: number, paused: boolean, asking: number, confirm?: number, task?: Task | null, fortress?: FortressTask | null,
 *   resting?: import('./resting.js').Resting | null, sides?: Side[], score?: { mine: number, theirs: number } }} CoopState
 */

/** The objectives the task panel has a line for. */
export const OBJECTIVES = Object.freeze(['kill', 'survive', 'tower', 'protect', 'car', 'target', 'boss']);
/** From how many seconds left the timer shows its warning when the pack gives none. */
export const TIMER_WARN = 10;

/** A task's time as minutes and seconds (mm:ss), rounded up. @param {number} s */
export const clockText = (s) => { const t = Math.max(0, Math.ceil(s)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/** The speed icon for the speed the battle runs at: 2× only when both sides have it on. @param {Record<string, any>} sp @param {number} speed */
export const coopSpeedSprite = (sp, speed) => (speed >= 2 ? sp.x2 : sp.x1);

/** A side's countdown text: whole seconds, rounded up. @param {number} s */
export const reviveText = (s) => String(Math.max(0, Math.ceil(s)));

/** The pack's seat tags, in the order a seat list is shown: this seat, then the others. A 4-player pack has all four. */
export const SEAT_TAGS = Object.freeze(['[my]', '[you]', '[mate2]', '[mate3]']);

/**
 * A ref of this seat's node, rewritten for another seat in the list: `[my]` stays, the rest take the pack's tags.
 * Seats past the tags the pack has give their own `[my]`-less ref, which finds nothing and shows nothing.
 * @param {string} ref @param {number} i
 */
export const seatRef = (ref, i) => (i === 0 ? ref : ref.replace('[my]', SEAT_TAGS[i] ?? '[you]'));


/**
 * The co-op top bar on a UI; `update` shows a frame's state; taps on speed and pause call the handlers, and the answer
 * to the mate's pause request `on.confirm(accept)`.
 * @param {ReturnType<typeof import('../ui.js').createUi>} ui @param {Record<string, any>} c the pack's co-op top bar data
 * @param {{ speed: () => void, pause: () => void, confirm?: (accept: boolean) => void }} on
 */
export function createCoopTop(ui, c, on) {
  const scr = ui.open('coop.topbar'), root = scr.root, status = refNode(root, c.status.panel);
  scr.show('btn_menu', false);
  if (status) status.active = true;
  for (const ref of [...SEAT_TAGS.map((t) => c.status.lifeLost?.replace('[my]', t)), c.lag?.back]) { const n = refNode(root, ref); if (n) n.active = false; }
  scr.show('text_battle_end_time', false);
  for (const n of ['fortress', 'fortress_lastWave', 'slider_progress_outer']) scr.show(n, false);
  // 2v2 的比分：素材包里没有这一组（两人局本来也不需要），有才用
  const score = c.score ? refNode(root, c.score.panel) : null;
  if (score) score.active = false;
  const confirm = refNode(root, c.pauseConfirm);
  if (confirm) {
    scr.tap('btn_confirm', () => on.confirm?.(true), confirm);
    scr.tap('btn_cancel/hotspot', () => on.confirm?.(false), confirm);
  }
  tapHit(scr, root, '@btn_speed_level/btn_speed_level_icon/hotspot', on.speed);
  tapHit(scr, root, `${c.pause}/collider`, on.pause);
  /** @type {CoopState | null} the state shown last */
  let was = null, first = 0;
  return {
    screen: scr,
    /** @param {CoopState} s */
    update(s) {
      const sides = s.sides ?? [s.me, s.mate];
      sides.forEach((side, i) => showSide(scr, root, seatRef(c.status.life, i), side));
      if (was) sideEntries(scr, root, c.enter, was, s);
      showSpeed(scr, root, c.speed, s, was);
      showPause(scr, root, c, s);
      if (score) showScore(scr, root, c.score, s, score);
      if (confirm) showConfirm(scr, root, c, confirm, s);
      first ||= s.task?.stage ?? 0;
      if (status && s.fortress) showFortress(scr, status, s.fortress, c.timerWarn ?? TIMER_WARN);
      else if (status) showTask(scr, status, s.task ?? null, { warn: c.timerWarn ?? TIMER_WARN, first });
      taskMotion(scr, root, c, was, s);
      was = s;
    },
  };
}

/**
 * The pause button (界面-17): pause or resume, and this seat's request waiting for the mate.
 * @param {Screen} scr @param {UiNode} root @param {Record<string, any>} c @param {CoopState} s
 */
function showPause(scr, root, c, s) {
  const pause = refNode(root, c.pauseImage), resume = refNode(root, c.resumeImage), wait = refNode(root, `${c.pause}/slider_pause_waiting`);
  if (pause) pause.active = !s.paused;
  if (resume) resume.active = s.paused;
  if (wait) { wait.active = s.asking >= 0; if (s.asking >= 0) scr.slider('', s.asking, wait); }
}

/**
 * The mate's pause request to answer (界面-17): it comes in with its clip (界面-40), its time left on its bar.
 * @param {Screen} scr @param {UiNode} root @param {Record<string, any>} c @param {UiNode} confirm @param {CoopState} s
 */
function showConfirm(scr, root, c, confirm, s) {
  const asked = (s.confirm ?? -1) >= 0;
  if (asked && !confirm.active) void playRef(scr, root, c.pauseConfirmShow);
  confirm.active = asked;
  if (asked) scr.slider('slider_progress', s.confirm ?? 0, confirm);
}

/**
 * Plays a clip the pack names with its node ({ node, clip }) on that node under the root; nothing without one.
 * @param {Screen} scr @param {UiNode} root @param {{ node: string, clip: string } | undefined} r @param {import('../anim.js').PlayOptions} [o]
 */
function playRef(scr, root, r, o) {
  const n = r ? refNode(root, r.node) : null;
  return n && r ? scr.anim.play(n, r.clip, o) : Promise.resolve();
}

/**
 * A side going down or coming back (界面-40): its revive timer comes in, or its lives.
 * @param {Screen} scr @param {UiNode} root @param {Record<string, any> | undefined} e the pack's entry clips @param {CoopState} was @param {CoopState} s
 */
function sideEntries(scr, root, e, was, s) {
  if (!e) return;
  for (const [k, revive, life] of /** @type {const} */ ([['me', 'reviveMe', 'lifeMe'], ['mate', 'reviveMate', 'lifeMate']])) {
    const down = s[k].revive >= 0;
    if (down !== was[k].revive >= 0) void playRef(scr, root, e[down ? revive : life]);
  }
}

/** Whether a state's timer is in its warning (界面-16, 界面-39). @param {CoopState | null} s @param {number} warn */
const warned = (s, warn) => { const x = s?.fortress ?? s?.task; return !!x && x.left <= warn; };

/** Whether a task's count has reached a goal. @param {Task | null | undefined} t @param {number | undefined} goal */
const reached = (t, goal) => !!t && goal !== undefined && goal > 0 && t.count >= goal;

/**
 * The task's changes (界面-40): the timer pulses through its warning; a new stage sweeps its label across; a goal
 * reached marks its count accomplished, the mark taken back when the count falls below again.
 * @param {Screen} scr @param {UiNode} root @param {Record<string, any>} c @param {CoopState | null} was @param {CoopState} s
 */
function taskMotion(scr, root, c, was, s) {
  const tc = c.taskClips, warn = c.timerWarn ?? TIMER_WARN;
  if (!tc) return;
  if (tc.timer && warned(s, warn) !== warned(was, warn)) {
    const n = refNode(root, tc.timer.node);
    if (warned(s, warn)) void scr.anim.play(n, tc.timer.clip, { loop: true });
    else scr.anim.stop(n, tc.timer.clip);
  }
  const t = s.fortress ? null : s.task ?? null, p = was?.fortress ? null : was?.task ?? null;
  if (t) goals(scr, root, tc, { t, p, first: !was });
}

/**
 * A new stage on the bar (界面-40): the marks taken back at once, the last stage's label swept across with the clip.
 * @param {Screen} scr @param {UiNode} root @param {Record<string, any>} tc @param {Task} p the last stage's task
 */
function newStage(scr, root, tc, p) {
  const bar = refNode(root, tc.stage?.node);
  if (bar) scr.text('text_stage_info_middle', `STAGE.${p.stage}`, bar);
  for (const r of [tc.basic, tc.advanced]) if (r) void playRef(scr, root, r, { reverse: true, rate: 1e4 });
  void playRef(scr, root, tc.stage);
}

/**
 * A task's goals on the bar (界面-40): a new stage first takes the marks back and sweeps its label across; then each goal
 * reached since the last frame shown is marked — at once on the first frame shown.
 * @param {Screen} scr @param {UiNode} root @param {Record<string, any>} tc @param {{ t: Task, p: Task | null, first: boolean }} o
 */
function goals(scr, root, tc, o) {
  const { t, p } = o, adv = t.advanced !== undefined, basic = adv ? tc.basic : tc.advanced, same = !!p && p.stage === t.stage;
  if (p && !same) newStage(scr, root, tc, p);
  const at = o.first ? { from: 1e9 } : {}, had = (/** @type {number | undefined} */ g) => same && reached(p, g);
  if (reached(t, t.goal) && !had(t.goal)) void playRef(scr, root, basic, at);
  else if (!reached(t, t.goal) && had(t.goal) && basic && tc.basicRevert) void playRef(scr, root, { node: basic.node, clip: tc.basicRevert.clip });
  if (adv && reached(t, t.advanced) && !had(t.advanced)) void playRef(scr, root, tc.advanced, at);
}

/**
 * The stage's task (界面-16): the stage number, the objective's line, the count against the goal on the bar and in
 * figures (the advanced goal beside it when there is one), the time left (its warning in the last `warn` seconds). The
 * stage's label: the first stage shown on its first line, the current one on the line a new stage brings in (界面-40).
 * @param {Screen} scr @param {UiNode} status the status panel @param {Task | null} t @param {{ warn: number, first: number }} o
 */
function showTask(scr, status, t, o) {
  const warn = o.warn;
  const task = scr.one('task', status);
  if (!task) return;
  task.active = t !== null;
  if (!t) return;
  scr.text('text_stage_info_01', `STAGE.${o.first || t.stage}`, task);
  scr.text('text_stage_info_02', `STAGE.${t.stage}`, task);
  // nothing counted yet: the bar stays at its minimum, empty (the original at 0/46); then the count over the goal
  scr.slider('normal', t.goal > 0 && t.count > 0 ? Math.min(1, t.count / t.goal) : -Infinity, task);
  // with an advanced goal the count over the goal stands left of the line and the count over the advanced goal at the
  // right end; without one only the count over the goal, at the right end, no line (the original's stages 2 and 1)
  const adv = t.advanced !== undefined;
  scr.show('split_line', adv, task);
  scr.text('split_line/group_text/text_monster', `${t.count}/${t.goal}`, task);
  scr.show('group_text_02', true, task);
  scr.text('group_text_02/text_monster', `${t.count}/${adv ? t.advanced : t.goal}`, task);
  for (const o of OBJECTIVES) scr.show(`taskInfo/${o}`, o === t.objective, task);
  const late = t.left <= warn;
  scr.show('group_timeout', late, task);
  scr.show('text_timer', late, task);
  scr.show('text_timer_normal', !late, task);
  scr.text(late ? 'text_timer' : 'text_timer_normal', clockText(t.left), task);
}

/**
 * 堡垒守御's wave (界面-39): the pack's 堡垒守御 panel in place of the stage's bar and objective — the wave of the waves,
 * the enemies gone of those it spawns; the last wave's panel with its damage instead; the time left as a stage's.
 * @param {Screen} scr @param {UiNode} status the status panel @param {FortressTask} f @param {number} warn
 */
function showFortress(scr, status, f, warn) {
  const task = scr.one('task', status);
  if (!task) return;
  task.active = true;
  scr.show('normal', false, task);
  for (const o of OBJECTIVES) scr.show(`taskInfo/${o}`, false, task);
  scr.show('fortress', !f.last, task);
  scr.show('fortress_lastWave', f.last, task);
  if (f.last) scr.text('fortress_lastWave/waveDmg', String(Math.floor(f.damage)), task);
  else {
    scr.text('curWave/maxWave/waveCnt', String(f.wave), task);
    scr.text('curWave/maxWave', String(f.waves), task);
    scr.text('maxEnemy/enemyCnt', String(f.out), task);
    scr.text('maxEnemy', String(f.total), task);
  }
  const late = f.left <= warn;
  scr.show('group_timeout', late, task);
  scr.show('text_timer', late, task);
  scr.show('text_timer_normal', !late, task);
  scr.text(late ? 'text_timer' : 'text_timer_normal', clockText(f.left), task);
}

/** @param {Screen} scr @param {UiNode} root @param {string} ref @param {() => void} fn */
function tapHit(scr, root, ref, fn) { const n = refNode(root, ref); if (n) scr.tap('', fn, n); }

/**
 * 2v2 的比分：两队剩余生命合计，夹在四席中间那条官方圆角底板上。只有四席才显示 —— 两人局（以及素材包
 * 没有这组节点的情形）一个像素都不动，保持原样式。
 * @param {Screen} scr @param {UiNode} root @param {Record<string, any>} c the pack's score refs
 * @param {CoopState} s @param {UiNode} group
 */
function showScore(scr, root, c, s, group) {
  const on = !!s.score && (s.sides?.length ?? 2) > 2;
  if (group.active !== on) group.active = on;
  if (!on) return;
  const mine = refNode(root, c.mine), theirs = refNode(root, c.theirs);
  if (mine) scr.text('', String(s.score?.mine ?? 0), mine);
  if (theirs) scr.text('', String(s.score?.theirs ?? 0), theirs);
}

/**
 * A side's lives, and its countdown instead while it is down.
 * @param {Screen} scr @param {UiNode} root @param {string} lifeRef @param {Side} s
 */
function showSide(scr, root, lifeRef, s) {
  const life = refNode(root, lifeRef), point = life?.parent, panel = point?.parent;
  if (!life || !point || !panel) return;
  scr.text('', String(s.life), life);
  const timer = panel.kids.find((k) => k.n.name === point.n.name.replace('icon_life_point', 'revive_timer'));
  point.active = s.revive < 0;
  if (timer) { timer.active = s.revive >= 0; if (s.revive >= 0) scr.text('timer', reviveText(s.revive), timer); }
}

/**
 * The speed icon and each side's 2× mark (界面-12, 界面-40): a side turning its switch on brings its mark in and flashes
 * its light, which fades after the pack's fade time; turning it off takes the mark away. At once on the first frame
 * shown or without the pack's clips.
 * @param {Screen} scr @param {UiNode} root @param {Record<string, any>} sp @param {CoopState} s @param {CoopState | null} was
 */
function showSpeed(scr, root, sp, s, was) {
  const icon = refNode(root, sp.image), cl = sp.clips ?? {};
  if (icon) { icon.sprite = coopSpeedSprite(sp, s.speed); icon.paintKey = ''; }
  for (const k of /** @type {const} */ (['me', 'mate'])) {
    const n = refNode(root, sp[k]), on = s[k].fast, panel = n?.parent ?? null;
    if (!was || !cl[`${k}Select`] || !panel) { if (n?.color) n.color[3] = on ? 1 : 0; continue; }
    if (on !== was[k].fast) speedLight(scr, panel, sp, { k, on });
  }
}

/**
 * A side's 2× switch turned (界面-40): its mark comes in or goes; turned on, its light flashes and fades after the
 * pack's fade time. @param {Screen} scr @param {UiNode} panel @param {Record<string, any>} sp @param {{ k: 'me' | 'mate', on: boolean }} o
 */
function speedLight(scr, panel, sp, o) {
  const cl = sp.clips ?? {}, k = o.k;
  void scr.anim.play(panel, cl[`${k}Select`], { reverse: !o.on });
  if (!o.on) return;
  if (cl[`${k}LightShow`]) void scr.anim.play(panel, cl[`${k}LightShow`]);
  if (cl[`${k}LightHide`]) void scr.anim.play(panel, cl[`${k}LightHide`], { delay: sp.fade ?? 0 });
}
