// What the original lobby screens show for a room (docs/spec/page.md 页面-6): which page and step a room's state is
// on, the step's countdown and when it warns, the banner a change of phase brings, the stage choose panel's parts by
// the player's role, whose pick it is, the lineup's options in order. Pure; the lobby page draws it.
import { STEP_MS, STEP_HINT_MS, PICTURES } from '@icebreaker/mode-regular';

/** The pack's pages (页面-6). */
export const PAGES = Object.freeze({
  entry: 'dynload/act_multi_v3_entry_page', prepare: 'dynload/act_multi_v3_prepare_page', squad: 'dynload/act_multi_v3_squad_page',
  finish: 'dynload/act_multi_v3_battle_finish_view', notify: 'dynload/act_multi_v3_notify_view', dialog: 'dialog/confirm_dialog_view',
  match: 'dynload/act_multi_v3_match_page', train: 'dynload/act_multi_v3_training_room_page',
});

/** The step screens of the prepare page by step (页面-6). */
export const STEP_SCREENS = Object.freeze({
  stage: 'prepare/steps/multiv3_prepare_stage_choose_panel', confirm: 'prepare/steps/multiv3_prepare_entrance_show_panel',
  pick: 'prepare/steps/multiv3_prepare_char_pick_panel',
  sel: 'prepare/steps/multiv3_prepare_squad_check_panel', skill: 'prepare/steps/multiv3_prepare_squad_check_panel',
  check: 'prepare/steps/multiv3_prepare_squad_check_panel',
});

/** The proc views of the lineup steps, in the squad check panel's order of its `procViewPrefab`. */
export const LINEUP_VIEWS = Object.freeze({
  sel: 'prepare/steps/squadprocview/act_multi_v3_prepare_squad_sel_view', skill: 'prepare/steps/squadprocview/act_multi_v3_prepare_squad_skill_view',
  check: 'prepare/steps/squadprocview/act_multi_v3_prepare_squad_check_view',
});

/**
 * What the lobby page keeps of its own: the lineup's sub-step, whether the stage list or the squad page is open, the
 * result to show after a match, whether the entry page shows its room panel, whether the quick match page or the
 * training room page is open.
 * @typedef {{ sub: 'sel' | 'skill' | 'check', list: boolean, squad: boolean, finish: MatchResult | null, room: boolean, match: boolean, train: boolean }} Local
 */
/**
 * A match's result as the battle page leaves it: won, the level, each stage's stamps, when it ended (ms), the field's
 * last frame blurred (a data URL), whether it was in 互选模式 (房间-8), whether it was a training (房间-11).
 * @typedef {{ match: string, result: number, level: string, difficulty?: string, stamps: number[], fortress?: { defended: number, damage: number }, at?: number, bg?: string,
 *   inverse?: boolean, training?: boolean }} MatchResult
 */

/** A new lobby page's own state. @returns {Local} */
export const newLocal = () => ({ sub: 'sel', list: false, squad: false, finish: null, room: false, match: false, train: false });

/**
 * The page a room state shows (页面-6): a match's result first; without a room the entry page (or the squad page, the
 * quick match page or the training room page the player opened from it, 房间-9, 房间-11); in a room the prepare page.
 * @param {{ view: any }} S @param {Local} L @returns {'finish' | 'entry' | 'squad' | 'prepare' | 'match' | 'train'}
 */
export function pageOf(S, L) {
  if (L.finish) return 'finish';
  if (!S.view) return L.squad ? 'squad' : L.match ? 'match' : L.train ? 'train' : 'entry';
  return 'prepare';
}

/**
 * The prepare page's step for a room's phase (页面-6): 项目调整 the stage choose panel, 项目确认 the stage confirm part
 * of the entrance show panel, 高顺位干员协调 the char pick panel, 组建上场阵容 the squad check panel at the page's
 * sub-step, still there while the match's countdown plays over it.
 * @param {{ phase: string }} v @param {Local} L
 */
export function stepOf(v, L) {
  /** @type {Record<string, string>} */
  const by = { setup: 'stage', confirm: 'confirm', pick: 'pick' };
  return v.phase === 'lineup' || v.phase === 'battle' ? L.sub : by[v.phase] ?? 'stage';
}

/**
 * A step's countdown (页面-6): its time left and in all, and whether it warns (from the activity's `hintTime` on);
 * null for a phase without one.
 * @param {{ phase: string, step: number }} v @param {number} since milliseconds since the view came
 * @returns {{ left: number, total: number, warn: boolean } | null}
 */
export function countdownOf(v, since) {
  const total = /** @type {Record<string, number>} */ (STEP_MS)[v.phase], hint = /** @type {Record<string, number>} */ (STEP_HINT_MS)[v.phase];
  if (!total) return null;
  const left = Math.max(0, v.step - since);
  return { left, total, warn: left <= hint };
}

/**
 * The banner a change of phase brings (页面-6): entering the pick, first or second pick by who picks first; going from
 * 项目确认 straight to the lineup, no coordination needed; entering the lineup from the pick, the lineup's. Null when
 * the phase does not change into one of these.
 * @param {string | null} prev @param {{ phase: string, you: number, picking: { by: number } | null }} v
 * @returns {'first' | 'second' | 'skip' | 'lineup' | null}
 */
export function bannerOf(prev, v) {
  if (prev === v.phase) return null;
  if (v.phase === 'pick' && v.picking) return v.picking.by === v.you ? 'first' : 'second';
  if (v.phase === 'lineup') return prev === 'pick' ? 'lineup' : prev === 'confirm' ? 'skip' : null;
  return null;
}

/**
 * The stage choose panel's state (页面-6): the player is the owner (房主) or the guest; the guest has prepared; the
 * owner may go on (the guest there and prepared).
 * @param {{ you: number, prepared: boolean, members: unknown[] }} v
 */
export const stagePanel = (v) => ({ owner: v.you === 0, prepared: v.prepared, canEnter: v.members.length > 1 && v.prepared, full: v.members.length > 1 });

/**
 * The owner's status line on the stage choose panel (页面-6).
 * @param {{ prepared: boolean, members: unknown[] }} v
 */
export const ownerStatus = (v) => (v.members.length < 2 ? '等待协作者加入项目...' : v.prepared ? '协作者已准备，可以进入备赛' : '等待协作者准备...');

/** A stage's preview picture: its sprite key in the pack's art, or null. @param {any} art @param {string} level */
export const pictureOf = (art, level) => (Object.hasOwn(PICTURES, level) ? art?.stageBig?.[PICTURES[level]] ?? null : null);

/**
 * The pick step as the player sees it (房间-4): its turn; whether it may hand the pick over; what is left; what each
 * side keeps.
 * @param {{ you: number, picking: { by: number, yielded: boolean, left: string[], won: string[][] } }} v
 */
export function pickView(v) {
  const p = v.picking, mine = p.by === v.you;
  return { mine, yielded: p.yielded, canYield: mine && !p.yielded && p.left.length >= 2, left: p.left, kept: p.won[v.you], theirs: p.won[1 - v.you] };
}

/**
 * The lineup's options in order (房间-5): the kept operators, those drawn from the low pool, then the extra ones (the
 * temporary recruits among them).
 * @param {{ kept: string[], drawn: string[], extra: string[] }} o @param {ReadonlySet<string>} recruits
 * @returns {{ id: string, tag: 'kept' | 'drawn' | 'recruit' | 'extra' }[]}
 */
export const lineupOptions = (o, recruits) => [
  ...o.kept.map((id) => ({ id, tag: /** @type {const} */ ('kept') })), ...o.drawn.map((id) => ({ id, tag: /** @type {const} */ ('drawn') })),
  ...o.extra.map((id) => ({ id, tag: recruits.has(id) ? /** @type {const} */ ('recruit') : /** @type {const} */ ('extra') })),
];

/** The battle page's result left for the room page (页面-6), or null when there is none or it is broken. @param {string | null} raw @returns {MatchResult | null} */
export function resultOf(raw) {
  try {
    const r = raw ? JSON.parse(raw) : null;
    if (!(r && typeof r.match === 'string' && typeof r.result === 'number' && Array.isArray(r.stamps))) return null;
    const f = r.fortress && Number.isFinite(r.fortress.defended) ? { fortress: { defended: Number(r.fortress.defended), damage: Number(r.fortress.damage) || 0 } } : {};
    return { match: r.match, result: r.result, level: String(r.level ?? ''), ...(typeof r.difficulty === 'string' ? { difficulty: r.difficulty } : {}), stamps: r.stamps.map(Number), ...f,
      ...(Number.isFinite(r.at) ? { at: r.at } : {}) };
  } catch {
    return null;
  }
}
