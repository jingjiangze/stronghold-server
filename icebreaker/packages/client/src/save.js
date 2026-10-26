// The player's local save (docs/spec/page.md 页面-2, room.md 房间-1, 房间-3): a name and a name card — its 代号, avatar
// and assistant —, the box — operators with their training, entered by hand —, the 常规队: box operators in a
// high-priority and a low-priority list, and the play style. It lives in this browser's localStorage and copies out and
// back in as text. Every change makes a new save; nothing here touches the page.
import { entryProblem, SQUAD, STYLES, DEFAULT_STYLE } from '@icebreaker/mode-regular';

/** The save's name in localStorage, and where an unreadable one is kept rather than lost. */
export const SAVE_KEY = 'ice.save', BAD_SAVE_KEY = 'ice.save.unreadable';
/** The most operators a box holds. */
const MAX_BOX = 600;

/** @typedef {import('@icebreaker/mode-regular').BoxEntry} BoxEntry */
/** A name card's assistant: a box operator and its art (1: elite 1, 2: elite 2). @typedef {{ id: string, art: 1 | 2 }} AssistPick */
/**
 * @typedef {{ v: 1, name: string, tag: string, avatar: string, assist: AssistPick | null, box: BoxEntry[], squad: { high: string[], low: string[] },
 *   style: string }} Save the name card: `tag` its 代号 (four digits; '' not given yet), `avatar` a box operator's id ('' the
 *   assistant's), `assist` the chosen assistant (null: the 常规队's first)
 */

/** @returns {Save} */
export const emptySave = () => ({ v: 1, name: '', tag: '', avatar: '', assist: null, box: [], squad: { high: [], low: [] }, style: DEFAULT_STYLE });

/** A new 代号: four random digits. @param {() => number} [random] */
export const newTag = (random = Math.random) => String(Math.floor(random() * 10000) % 10000).padStart(4, '0');

/** @param {unknown} x @returns {x is Record<string, any>} */
const isRecord = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

/** @param {unknown} q @param {Set<string>} ids */
function squadIdsProblem(q, ids) {
  if (!isRecord(q) || !Array.isArray(q.high) || !Array.isArray(q.low) || q.high.length > SQUAD.high || q.low.length > SQUAD.low) return '常规队的格式不对';
  const all = [...q.high, ...q.low];
  if (new Set(all).size !== all.length || !all.every((id) => ids.has(id))) return '常规队里有 box 之外或重复的干员';
  return null;
}

/** Why a save's name card is not one, or null: the 代号, and an avatar and an assistant from the box. @param {Record<string, any>} x @param {Set<string>} ids */
function cardProblem(x, ids) {
  if (x.avatar !== '' && !ids.has(x.avatar)) return '头像不是 box 里的干员';
  if (x.assist !== null && !(isRecord(x.assist) && ids.has(x.assist.id) && (x.assist.art === 1 || x.assist.art === 2))) return '助理干员不是 box 里的干员';
  return null;
}

/** Why something is not a save, or null. @param {unknown} x @returns {string | null} */
export function saveProblem(x) {
  if (!isRecord(x) || x.v !== 1) return '不是促融共竞的存档';
  if (typeof x.name !== 'string' || x.name.length > 16) return '名字不能超过 16 个字';
  if (!STYLES.some((s) => s.id === x.style)) return '没有这种比赛风格';
  if (typeof x.tag !== 'string' || !/^(\d{4})?$/.test(x.tag)) return '代号是 4 位数字';
  if (!Array.isArray(x.box) || x.box.length > MAX_BOX) return `box 最多 ${MAX_BOX} 名干员`;
  const ids = new Set();
  for (const e of x.box) {
    const why = entryProblem(e);
    if (why) return why;
    if (ids.has(e.id)) return `${e.id} 在 box 里出现了两次`;
    ids.add(e.id);
  }
  return cardProblem(x, ids) ?? squadIdsProblem(x.squad, ids);
}

/** A storage's save text, or null when it has none or refuses. @param {Storage | null} store */
function stored(store) {
  try { return store?.getItem(SAVE_KEY) ?? null; } catch { return null; }
}

/** The save in a storage; an empty one when there is none, and when it is unreadable (kept aside). @param {Storage | null} store @returns {Save} */
export function readSave(store) {
  const raw = stored(store);
  if (raw === null) return emptySave();
  const got = importSave(raw);
  if ('save' in got) return got.save;
  try { store?.setItem(BAD_SAVE_KEY, raw); } catch { /* nowhere to keep it */ }
  return emptySave();
}

/** Writes a save; false when the storage refused it. @param {Storage | null} store @param {Save} s */
export function writeSave(store, s) {
  try { store?.setItem(SAVE_KEY, JSON.stringify(s)); return store !== null; } catch { return false; }
}

/** A save from its text (exportSave's, or a backup). @param {string} text @returns {{ save: Save } | { error: string }} */
export function importSave(text) {
  let x;
  try { x = JSON.parse(text); } catch { return { error: '不是存档的文本' }; }
  if (isRecord(x)) {
    // saves from before the styles and the name cards
    if (x.style === undefined) x.style = DEFAULT_STYLE;
    if (x.tag === undefined) x.tag = '';
    if (x.avatar === undefined) x.avatar = '';
    if (x.assist === undefined) x.assist = null;
  }
  const why = saveProblem(x);
  return why ? { error: why } : { save: /** @type {Save} */ (x) };
}

/** A save as text. @param {Save} s */
export const exportSave = (s) => JSON.stringify(s);

/** The save with an operator added, or its entry replaced. @param {Save} s @param {BoxEntry} e @returns {Save} */
export function putEntry(s, e) {
  const box = s.box.some((x) => x.id === e.id) ? s.box.map((x) => (x.id === e.id ? e : x)) : [...s.box, e];
  return { ...s, box };
}

/** The save without an operator: in the box, the squad and the name card. @param {Save} s @param {string} id @returns {Save} */
export function removeEntry(s, id) {
  return { ...s, avatar: s.avatar === id ? '' : s.avatar, assist: s.assist?.id === id ? null : s.assist,
    box: s.box.filter((x) => x.id !== id), squad: { high: s.squad.high.filter((x) => x !== id), low: s.squad.low.filter((x) => x !== id) } };
}

/**
 * The save with a box operator moved to a list of the squad (or out of it), or null when that list is full.
 * @param {Save} s @param {string} id @param {'high' | 'low' | null} list @returns {Save | null}
 */
export function place(s, id, list) {
  const next = { high: s.squad.high.filter((x) => x !== id), low: s.squad.low.filter((x) => x !== id) };
  if (list) {
    if (next[list].length >= SQUAD[list]) return null;
    next[list] = [...next[list], id];
  }
  return { ...s, squad: next };
}

/**
 * The name card a room shows (房间-1): the 代号, the assistant — the chosen one, else the 常规队's first (the first of
 * the high priority, else of the low), else the box's first — at its art (the elite-2 art only once it is elite 2 in
 * the box; not chosen: its highest), and the avatar — the chosen box operator's, else the assistant's.
 * @param {Save} s @returns {{ tag: string, avatar: string, assist: AssistPick | null }}
 */
export function profileOf(s) {
  const by = new Map(s.box.map((e) => [e.id, e])), pick = s.assist && by.has(s.assist.id) ? s.assist : null;
  const lead = pick ? by.get(pick.id) : by.get(s.squad.high[0] ?? s.squad.low[0] ?? '') ?? s.box[0];
  const top = lead && lead.elite >= 2 ? 2 : 1, art = /** @type {1 | 2} */ (pick ? Math.min(pick.art, top) : top);
  const assist = lead ? { id: lead.id, art } : null;
  return { tag: s.tag, avatar: s.avatar && by.has(s.avatar) ? s.avatar : assist?.id ?? '', assist };
}

/** The 常规队 a room takes (房间-3): the squad's operators with their box training. @param {Save} s */
export function squadOf(s) {
  const by = new Map(s.box.map((e) => [e.id, e]));
  const of = (/** @type {string[]} */ ids) => ids.map((id) => /** @type {BoxEntry} */ (by.get(id)));
  return { high: of(s.squad.high), low: of(s.squad.low) };
}
