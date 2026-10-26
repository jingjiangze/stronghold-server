// The tutorials of a training level (docs/spec/room.md 房间-11, engine 波次-8): when the battle tells a story the page
// plays its script over the field — pausing and resuming the battle as it says (the seat plays alone, so both take hold
// at once: engine 同步-14), the lines in a dialog with the speaker's head, the part a line is about lit in a dark mask —
// and goes on when the player taps (after the line's protect time) or, for a drag, once the player has put a unit down.
// The script's places are in a 1280 × 720 screen from its centre, y up, scaled with the screen's width; the dialog's
// look is the page's own (the game's tutorial screens are not in the assets; INF-0023).

/** @typedef {{ cmd: string, args: Record<string, string | number | boolean>, text?: string }} StoryCommand */
/**
 * What the tutorials work with: the scripts and their variables, pausing and resuming, whether the battle is held, the
 * current frame, a speaker's head picture, the rect of a node of the battle UI by its name.
 * @typedef {{ stories: Readonly<Record<string, readonly StoryCommand[]>>, vars: Readonly<Record<string, string | number>>, pause: () => void, resume: () => void,
 *   held: () => boolean, frame: () => number, head: (char: string) => string | null, rectOf: (name: string) => DOMRect | null }} TutorialCtx
 */
/**
 * A tutorial's state: its context, the field, its elements, the frames waited for, the deployment waited for, whether
 * the battle ended, whether the script keeps the player's input from the battle between its lines (InputBlocker),
 * whether the script holds the battle.
 * @typedef {{ o: TutorialCtx, field: HTMLElement, E: ReturnType<typeof elements>, frameWaits: { frame: number, done: () => void }[], putDown: (() => void) | null,
 *   over: boolean, block: boolean, holding: boolean }} Tut
 */

/** The script's screen (1280 × 720, scaled by the screen's width). */
const REF = Object.freeze({ w: 1280, h: 720 });
/** Frames a second of battle; how long the page waits for a pause or a resume to take hold before going on, in ms. */
const FPS = 30, HOLD_MS = 3000;
/** Where a line goes without a place of its own (a popup's), in the script's screen; the dialog's size there. */
const POPUP = Object.freeze({ x: -320, y: -217 }), DIALOG = Object.freeze({ w: 640, h: 132 });

/** @param {number} ms */
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

/**
 * A script's value with its variable resolved (`$name`, story_variables.json); a value without one as it is.
 * @param {TutorialCtx} o @param {string | number | boolean | undefined} v
 */
const valueOf = (o, v) => (typeof v === 'string' && v.startsWith('$') ? o.vars[v.slice(1)] : v);

/**
 * A point of the script's screen in the page's pixels: from the screen's centre, or from a corner or edge by its anchor
 * (Unity's y up); `k` the page's pixels to one of the script's. @param {DOMRect} box the field @param {number} x @param {number} y @param {string} [anchor]
 */
export function screenPoint(box, x, y, anchor = 'Center') {
  const k = box.width / REF.w, hh = box.height / k / 2, hw = REF.w / 2;
  const ox = /Left/.test(anchor) ? -hw : /Right/.test(anchor) ? hw : 0, oy = /Bottom/.test(anchor) ? -hh : /Top/.test(anchor) ? hh : 0;
  return { x: box.left + box.width / 2 + (ox + x) * k, y: box.top + box.height / 2 - (oy + y) * k, k };
}

/** Unity rich text as HTML: its colours as spans, everything else as text. @param {string} t */
export function richHtml(t) {
  const esc = (/** @type {string} */ s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return t.split(/(<color=#[0-9a-fA-F]{6,8}>|<\/color>)/).map((part) => {
    const m = /^<color=(#[0-9a-fA-F]{6,8})>$/.exec(part);
    return m ? `<span style="color:${m[1]}">` : part === '</color>' ? '</span>' : esc(part).replace(/\n/g, '<br>');
  }).join('');
}

/** The tutorial's elements over the field. @param {HTMLElement} root */
function elements(root) {
  const el = (/** @type {string} */ cls, /** @type {string} */ tag = 'div') => { const e = document.createElement(tag); e.className = cls; return e; };
  const box = el('tutorial'), shade = el('tut-shade'), hole = el('tut-hole'), hand = el('tut-hand'), dialog = el('tut-dialog');
  const head = /** @type {HTMLImageElement} */ (el('tut-head', 'img')), text = el('tut-text'), more = el('tut-more');
  head.alt = '';
  dialog.append(head, text, more);
  box.append(shade, hole, hand, dialog);
  box.hidden = true;
  root.append(box);
  return { box, shade, hole, hand, dialog, head, text, more };
}

/** Until the battle has run n frames (or a while longer than they take, should it not). @param {Tut} T @param {number} n */
const frames = (T, n) => Promise.race([new Promise((done) => { T.frameWaits.push({ frame: T.o.frame() + n, done: () => done(undefined) }); }), sleep((n / FPS) * 3000 + HOLD_MS)]);

/** Until the battle is held or runs as wanted (or a while). @param {Tut} T @param {boolean} on */
async function held(T, on) { for (let t = 0; t < HOLD_MS && T.o.held() !== on; t += 50) await sleep(50); }

/** Until a tap on the overlay, once the line's protect time has gone by. @param {Tut} T @param {number} protect seconds */
async function tapped(T, protect) {
  await sleep(protect * 1000);
  T.E.more.hidden = false;
  await new Promise((done) => T.E.box.addEventListener('pointerdown', () => done(undefined), { once: true }));
  T.E.more.hidden = true;
}

/**
 * The dialog: its speaker's head and its line, its left edge and middle at a point of the script's screen.
 * @param {Tut} T @param {string | number | boolean | undefined} who @param {string} line @param {number} x @param {number} y
 */
function say(T, who, line, x, y) {
  const E = T.E, p = screenPoint(T.field.getBoundingClientRect(), x, y), char = String(who ?? ''), pic = char ? T.o.head(char) : null;
  E.head.hidden = !pic;
  if (pic) E.head.src = pic;
  E.text.innerHTML = richHtml(line);
  Object.assign(E.dialog.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${DIALOG.w * p.k}px`, minHeight: `${DIALOG.h * p.k}px`, fontSize: `${Math.max(12, 20 * p.k)}px` });
  E.dialog.hidden = false;
}

/** The mask: a hole at a rect (a circle or a rect) in a shade of black, or the shade alone. @param {Tut} T @param {DOMRect | null} r @param {string} shape @param {number} black */
function mask(T, r, shape, black) {
  const E = T.E;
  E.shade.hidden = !!r;
  E.shade.style.background = `rgb(0 0 0 / ${black})`;
  E.hole.hidden = !r;
  if (!r) return;
  Object.assign(E.hole.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: shape === 'HighlightCircle' ? '50%' : '6px',
    boxShadow: `0 0 0 200vmax rgb(0 0 0 / ${black})` });
}

/** The rect a Tutorial line lights: its target node's, else its focus in the script's screen. @param {Tut} T @param {Record<string, any>} a */
function focusOf(T, a) {
  if (a.target) return T.o.rectOf(String(a.target));
  if (a.focusWidth === undefined) return null;
  const c = screenPoint(T.field.getBoundingClientRect(), Number(a.focusX ?? 0), Number(a.focusY ?? 0), String(a.anchor ?? 'Center'));
  const w = Number(a.focusWidth) * c.k, h = Number(a.focusHeight ?? a.focusWidth) * c.k;
  return new DOMRect(c.x - w / 2, c.y - h / 2, w, h);
}

/** A drag's hint: a hand going from its start to its end, over and over. @param {Tut} T @param {Record<string, any>} a */
function drag(T, a) {
  const box = T.field.getBoundingClientRect(), from = screenPoint(box, Number(a.startX ?? 0), Number(a.startY ?? 0), String(a.startAnchor ?? 'Center'));
  const to = screenPoint(box, Number(a.endX ?? 0), Number(a.endY ?? 0), String(a.endAnchor ?? 'Center')), s = T.E.hand.style;
  T.E.hand.hidden = false;
  for (const [k, v] of [['--from-x', from.x], ['--from-y', from.y], ['--to-x', to.x], ['--to-y', to.y]]) s.setProperty(String(k), `${v}px`);
}

/** A Tutorial line: its mask and lit part, its hand, its dialog; then a tap, or for a drag the deployment. @param {Tut} T @param {StoryCommand} c */
async function tutorialLine(T, c) {
  const a = c.args, wait = a.waitForSignal === 'put_down', o = T.o;
  T.E.box.hidden = false;
  // a drag waits for the player's deployment: the overlay lets the hand through
  T.E.box.classList.toggle('passing', wait);
  if (a.animStyle === 'Drag') drag(T, a);
  mask(T, wait ? null : focusOf(T, a), String(a.focusStyle ?? 'HighlightRect'), wait ? 0 : Number(valueOf(o, a.black) ?? 0.5));
  say(T, valueOf(o, a.dialogHead), c.text ?? '', Number(valueOf(o, a.dialogX) ?? POPUP.x), Number(valueOf(o, a.dialogY) ?? POPUP.y));
  if (wait) await new Promise((done) => { T.putDown = () => done(undefined); });
  else await tapped(T, Number(a.protectTime ?? 0.5));
  T.E.box.classList.remove('passing');
}

/** What each of a script's commands does (the others, such as locking the pause button, nothing). @type {Record<string, (T: Tut, c: StoryCommand) => Promise<unknown> | void>} */
const COMMANDS = {
  'Battle.Pause': async (T, c) => { const on = c.args.pause !== false; T.holding = on; if (on) T.o.pause(); else T.o.resume(); await held(T, on); },
  Delay: (T, c) => frames(T, Math.round(Number(c.args.time ?? 0) * FPS)),
  // a blocker that leaves a card open goes with a drag, which lets the input through anyway
  InputBlocker: (T, c) => { T.block = c.args.blockInput !== false && c.args.cardIndex === undefined; },
  PopupDialog: async (T, c) => {
    T.E.box.hidden = false;
    mask(T, null, '', Number(valueOf(T.o, c.args.black) ?? 0.3));
    say(T, valueOf(T.o, c.args.dialogHead), c.text ?? '', POPUP.x, POPUP.y);
    await tapped(T, Number(c.args.protectTime ?? 0.5));
  },
  Tutorial: tutorialLine,
};

/** A script, then the battle runs again: the game's stories end with it running. @param {Tut} T @param {readonly StoryCommand[]} script */
async function play(T, script) {
  const E = T.E;
  for (const c of script) {
    if (T.over) break;
    await COMMANDS[c.cmd]?.(T, c);
    for (const e of [E.dialog, E.hand, E.shade, E.hole]) e.hidden = true;
    E.box.hidden = !T.block;
  }
  T.block = false;
  E.box.hidden = true;
  if (!T.over) { T.o.resume(); await held(T, false); }
  T.holding = false;
}

/**
 * The tutorials over a field. @param {HTMLElement} root where the overlay goes @param {HTMLElement} field the field
 * (its rect is the script's screen) @param {TutorialCtx} o
 */
export function createTutorial(root, field, o) {
  /** @type {Tut} */
  const T = { o, field, E: elements(root), frameWaits: [], putDown: null, over: false, block: false, holding: false };
  const told = new Set(), queue = /** @type {string[]} */ ([]);
  let running = false;
  async function next() {
    if (running) return;
    running = true;
    while (queue.length && !T.over) await play(T, o.stories[/** @type {string} */ (queue.shift())] ?? []);
    running = false;
  }
  return {
    /** The battle told a story (engine 波次-8): its script plays once, after those before it. @param {string} key the story's path */
    story(key) {
      const name = key.split('/').pop() ?? key;
      if (told.has(name) || !Object.hasOwn(o.stories, name)) return;
      told.add(name);
      queue.push(name);
      void next();
    },
    /** A frame of the battle went by. @param {number} f */
    frame(f) {
      const due = T.frameWaits.filter((w) => f >= w.frame);
      T.frameWaits = T.frameWaits.filter((w) => f < w.frame);
      for (const w of due) w.done();
    },
    /** The player put a unit down: a drag's line goes on. */
    putDown() { const f = T.putDown; T.putDown = null; f?.(); },
    /** The battle ended: no more lines. */
    end() { T.over = true; T.E.box.hidden = true; this.putDown(); },
    /** Whether a script is playing, for tests. */
    busy: () => running,
    /** Whether a script holds the battle: the battle UI does not show it as the player's pause. */
    holding: () => T.holding,
  };
}
