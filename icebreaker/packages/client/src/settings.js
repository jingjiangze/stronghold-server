// The player's picture settings (docs/spec/page.md 页面-1; engine ADR 0059): a frame-rate cap, the 清晰度, attack effects,
// an FPS readout, the music, sound and voice volumes and the dub (页面-4) — saved on this device, applied at once. Nothing here touches the battle: it runs 30 frames a second
// whatever the picture does (the engine's 时间-1).

/** @typedef {{ fpsCap: number, scale: number, attackEffects: boolean, showFps: boolean, music: number, sfx: number, voice: number, dub: string }} Settings */

/** The frame-rate caps; 0 follows the display (no cap of ours). */
export const FPS_CAPS = Object.freeze([0, 144, 120, 60, 30]);
/** The 清晰度 choices: the canvas's pixel ratio over the device's (the engine's 渲染-15). */
export const SCALES = Object.freeze([1, 0.75, 0.5]);
/** The volume choices of the music, the sounds and the voices (页面-4). */
export const VOLUMES = Object.freeze([1, 0.5, 0]);
/** The dub choices (页面-4, the engine's 音频-4): '' each operator's default, else a dub of the data with its name there. */
export const DUBS = Object.freeze([['', '默认'], ['CN_MANDARIN', '中文-普通话'], ['JP', '日语'], ['EN', '英语'], ['KR', '韩语']]);
/** No limits of ours by default. @type {Readonly<Settings>} */
export const DEFAULTS = Object.freeze({ fpsCap: 0, scale: 1, attackEffects: true, showFps: false, music: 1, sfx: 1, voice: 1, dub: '' });

const KEY = 'ice.settings.v1';

/** Settings from anything: each field kept when it is one of its choices, else its default. @param {unknown} v @returns {Settings} */
export function sanitize(v) {
  const o = v && typeof v === 'object' ? /** @type {Record<string, unknown>} */ (v) : {};
  return {
    fpsCap: FPS_CAPS.includes(/** @type {number} */ (o.fpsCap)) ? /** @type {number} */ (o.fpsCap) : DEFAULTS.fpsCap,
    scale: SCALES.includes(/** @type {number} */ (o.scale)) ? /** @type {number} */ (o.scale) : DEFAULTS.scale,
    attackEffects: typeof o.attackEffects === 'boolean' ? o.attackEffects : DEFAULTS.attackEffects,
    showFps: typeof o.showFps === 'boolean' ? o.showFps : DEFAULTS.showFps,
    music: VOLUMES.includes(/** @type {number} */ (o.music)) ? /** @type {number} */ (o.music) : DEFAULTS.music,
    sfx: VOLUMES.includes(/** @type {number} */ (o.sfx)) ? /** @type {number} */ (o.sfx) : DEFAULTS.sfx,
    voice: VOLUMES.includes(/** @type {number} */ (o.voice)) ? /** @type {number} */ (o.voice) : DEFAULTS.voice,
    dub: DUBS.some(([d]) => d === o.dub) ? /** @type {string} */ (o.dub) : DEFAULTS.dub,
  };
}

/** The saved settings, or the defaults (no storage, nothing saved, or broken). @param {Pick<Storage, 'getItem'> | null | undefined} storage */
export function readSettings(storage) {
  try {
    const raw = storage?.getItem(KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULTS };
  }
}

/** Saves the settings; a storage that refuses is ignored. @param {Pick<Storage, 'setItem'> | null | undefined} storage @param {Settings} s */
export function writeSettings(storage, s) {
  try { storage?.setItem(KEY, JSON.stringify(sanitize(s))); } catch { /* not saved: the choice still holds for this page */ }
}

/**
 * Which display frames to draw under a cap (页面-1): every one without a cap; with one, a frame when an interval has
 * passed since the last drawn one's slot — up to 1.5 ms early counts, since display frames come with jitter — and after
 * a long gap (over two intervals) the slots start again from that frame.
 * @param {() => number} cap the cap now (0: none) @returns {(now: number) => boolean}
 */
export function frameGate(cap) {
  let last = -Infinity;
  return (now) => {
    const c = cap();
    if (!(c > 0)) { last = now; return true; }
    const interval = 1000 / c, since = now - last;
    if (since < interval - 1.5) return false;
    last = since > 2 * interval ? now : last + interval;
    return true;
  };
}

/** Frames drawn in the last second, for the readout. @returns {(now: number) => number} */
export function fpsMeter() {
  /** @type {number[]} */
  const times = [];
  return (now) => {
    times.push(now);
    while (times.length > 0 && times[0] <= now - 1000) times.shift();
    return times.length;
  };
}

/** The panel's rows in their groups: each setting's label and its choices with their labels. */
const GROUPS = Object.freeze([
  { title: '画面', rows: [
    { field: 'fpsCap', label: '帧率上限', choices: FPS_CAPS.map((v) => [v, v === 0 ? '跟随屏幕' : String(v)]) },
    { field: 'scale', label: '清晰度', choices: SCALES.map((v) => [v, `${v * 100}%`]) },
    { field: 'attackEffects', label: '攻击特效', choices: [[true, '开'], [false, '关']] },
    { field: 'showFps', label: '显示帧率', choices: [[true, '开'], [false, '关']] },
  ] },
  { title: '声音', rows: [
    { field: 'music', label: '音乐', choices: VOLUMES.map((v) => [v, v === 0 ? '关' : `${v * 100}%`]) },
    { field: 'sfx', label: '音效', choices: VOLUMES.map((v) => [v, v === 0 ? '关' : `${v * 100}%`]) },
    { field: 'voice', label: '语音', choices: VOLUMES.map((v) => [v, v === 0 ? '关' : `${v * 100}%`]) },
    { field: 'dub', label: '配音', choices: DUBS },
  ] },
]);

/**
 * The dub choices the assets have (页面-4): 默认 always, the others when the voice index has them.
 * @param {readonly string[]} have the voice index's dubs @returns {(string)[][]}
 */
export const dubChoices = (have) => DUBS.filter(([d]) => d === '' || have.includes(d)).map((c) => [...c]);

/** @typedef {{ field: string, label: string, choices: readonly (readonly unknown[])[] }} Row */

/**
 * The settings tab and its drawer (页面-1): the 画面 and 声音 groups, each setting a track of its choices whose plate
 * slides to the one chosen; a choice applies at once and is saved. The dubs offered are those the assets have, told
 * once the voices are loaded (页面-4); the 配音 row shows when there is a choice. Esc closes the drawer.
 * @param {HTMLElement} root @param {Settings} initial @param {(s: Settings) => void} onChange
 * @returns {{ dubs: (have: readonly string[]) => void }}
 */
export function createSettingsPanel(root, initial, onChange) {
  let s = { ...initial }, dubs = dubChoices([]);
  const doc = root.ownerDocument, toggle = doc.createElement('button'), panel = doc.createElement('div');
  /** Each shown row's track and buttons by their values. @type {Map<string, { track: HTMLElement, plate: HTMLElement, buttons: [unknown, HTMLElement][] }>} */
  const tracks = new Map();
  toggle.type = 'button';
  toggle.className = 'tab';
  toggle.textContent = '设置';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'settings-panel');
  panel.className = 'panel';
  panel.id = 'settings-panel';
  panel.hidden = true;
  const open = (/** @type {boolean} */ on) => { panel.hidden = !on; toggle.setAttribute('aria-expanded', String(on)); if (on) mark(); };
  toggle.addEventListener('click', () => open(panel.hidden !== false));
  root.addEventListener('keydown', (e) => { if (/** @type {KeyboardEvent} */ (e).key === 'Escape' && !panel.hidden) { open(false); toggle.focus(); } });
  /** The chosen buttons pressed, each track's plate under its choice (laid out only while the drawer shows). */
  const mark = () => {
    for (const [field, t] of tracks) {
      let at = null;
      for (const [v, b] of t.buttons) { const on = /** @type {any} */ (s)[field] === v; b.setAttribute('aria-pressed', String(on)); if (on) at = b; }
      if (at && !panel.hidden) { t.plate.style.width = `${at.offsetWidth}px`; t.plate.style.transform = `translateX(${at.offsetLeft}px)`; }
    }
  };
  /** A setting's row: its name and its track. @param {Row} r */
  const row = (r) => {
    const el = doc.createElement('div'), name = doc.createElement('span'), track = doc.createElement('div'), plate = doc.createElement('span');
    el.className = 'row'; name.className = 'name'; track.className = 'track'; plate.className = 'plate';
    name.textContent = r.label;
    track.setAttribute('role', 'group');
    track.setAttribute('aria-label', r.label);
    plate.setAttribute('aria-hidden', 'true');
    /** @type {[unknown, HTMLElement][]} */
    const buttons = r.choices.map(([v, text]) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = String(text);
      b.addEventListener('click', () => { s = sanitize({ ...s, [r.field]: v }); mark(); onChange(s); });
      return [v, b];
    });
    track.append(plate, ...buttons.map(([, b]) => b));
    tracks.set(r.field, { track, plate, buttons });
    el.append(name, track);
    return el;
  };
  const build = () => {
    tracks.clear();
    panel.replaceChildren(...GROUPS.map((g) => {
      const sec = doc.createElement('section'), head = doc.createElement('h2');
      head.textContent = g.title;
      sec.append(head, ...g.rows.flatMap((r) => (r.field !== 'dub' ? [r] : dubs.length > 1 ? [{ ...r, choices: dubs }] : [])).map(row));
      return sec;
    }));
    mark();
  };
  build();
  root.replaceChildren(toggle, panel);
  return { dubs: (have) => { dubs = dubChoices(have); build(); } };
}
