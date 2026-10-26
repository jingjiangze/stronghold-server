// The box and the 常规队 on the room page (docs/spec/room.md 房间-3): the player's name card — nickname, 代号, assistant
// and its art, avatar (房间-1) —, operators entered by hand with their training (kept within each operator's limits,
// training.js), each placed in the high-priority or the low-priority list, the play style (房间-3; with the activity's
// icons when the assets have them, 页面-5), and the save copied out or in as text (save.js). The save changes only
// through `setSave`.
import { squadProblem, SQUAD, STYLES } from '@icebreaker/mode-regular';
import { h } from './dom.js';
import { putEntry, removeEntry, place, squadOf, exportSave, importSave, profileOf } from './save.js';
import { plain } from './roomtext.js';
import { fullEntry, clampEntry, openSkills, skillCap, moduleOpen, maxPotential, skillLevelText, trainingText } from './training.js';

/** @typedef {import('./save.js').Save} Save @typedef {import('./save.js').BoxEntry} BoxEntry @typedef {import('./training.js').Training} Training */
/** @typedef {Record<string, { name: string, rarity: number, profession: string }>} Roster */
/**
 * @typedef {object} BoxViewOptions
 * @property {Roster} roster every operator's name and rarity
 * @property {(id: string) => Promise<Training>} training an operator's training data
 * @property {() => Save} getSave @property {(s: Save) => void} setSave
 * @property {(text: string) => void} toast
 * @property {(icon: string, variant: '' | '_tiny') => string | null} [icon] a style icon's URL (页面-5), null without it
 */
/**
 * The view's state: the host, the options, the operators' training once loaded, the entry being edited.
 * @typedef {{ host: HTMLElement, o: BoxViewOptions, trainings: Map<string, Training>, editing: { draft: BoxEntry, training: Training } | null, byName: Map<string, string> }} Box
 */

/** @param {number} lo @param {number} hi */
const range = (lo, hi) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);

/** A select of numbers. @param {number} value @param {number[]} values @param {(v: number) => string} text @param {(v: number) => void} on @param {boolean} [disabled] */
const numberSelect = (value, values, text, on, disabled = false) =>
  h('select', { disabled, onchange: (/** @type {Event} */ e) => on(Number(/** @type {HTMLSelectElement} */ (e.target).value)) },
    values.map((v) => h('option', { value: String(v), selected: v === value }, text(v))));

/** @param {Box} B @param {string} id */
const nameOf = (B, id) => B.o.roster[id]?.name ?? id;

/** An operator's training, loaded once. @param {Box} B @param {string} id */
async function trainingOf(B, id) {
  if (!B.trainings.has(id)) B.trainings.set(id, await B.o.training(id));
  return /** @type {Training} */ (B.trainings.get(id));
}

/** Opens the editor on a box operator, or on a new one at full training. @param {Box} B @param {string} id */
async function edit(B, id) {
  const t = await trainingOf(B, id), have = B.o.getSave().box.find((e) => e.id === id);
  B.editing = { draft: have ? clampEntry(have, t) : fullEntry(id, t), training: t };
  render(B);
}

/** Adds an operator by its name (or id). @param {Box} B @param {string} text */
function add(B, text) {
  const t = text.trim(), id = B.byName.get(t) ?? (B.o.roster[t] ? t : null);
  if (!id) { B.o.toast(`没有叫「${t}」的干员`); return; }
  edit(B, id).catch((e) => B.o.toast(`读不到 ${nameOf(B, id)} 的数据：${e.message}`));
}

/** @template T @param {T[]} list */
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Fills the 常规队 up to 10 high and 20 in all with six-stars at full training, at random. @param {Box} B */
async function fill(B) {
  const s = B.o.getSave(), inSquad = new Set([...s.squad.high, ...s.squad.low]);
  const pool = shuffled(Object.entries(B.o.roster).filter(([id, r]) => r.rarity === 6 && !inSquad.has(id)).map(([id]) => id));
  const high = SQUAD.high - s.squad.high.length, low = Math.max(0, SQUAD.min - SQUAD.high - s.squad.low.length);
  let next = s;
  for (const [i, id] of pool.slice(0, high + low).entries()) {
    const have = next.box.some((e) => e.id === id);
    next = /** @type {Save} */ (place(have ? next : putEntry(next, fullEntry(id, await trainingOf(B, id))), id, i < high ? 'high' : 'low'));
  }
  B.o.setSave(next);
}

/** @param {string} label @param {HTMLElement} el */
const field = (label, el) => h('label', { class: 'field' }, h('span', {}, label), el);
/** @param {Event} e */
const valueOf = (e) => Number(/** @type {HTMLInputElement} */ (e.target).value);

/** The fields of the entry being edited. @param {BoxEntry} d @param {Training} t @param {(p: Partial<BoxEntry>) => void} set */
function fields(d, t, set) {
  const at = (/** @type {number[]} */ list, /** @type {number} */ i, /** @type {number} */ v) => list.map((x, j) => (j === i ? v : x));
  return [
    field('精英化', numberSelect(d.elite, range(0, t.phases.length - 1), (v) => `精英${v}`, (v) => set({ elite: v }))),
    field('等级', h('input', { type: 'number', min: 1, max: t.phases[d.elite].maxLevel, value: String(d.level), onchange: (/** @type {Event} */ e) => set({ level: valueOf(e) }) })),
    field('潜能', numberSelect(d.potential, range(1, maxPotential(t)), (v) => `潜能${v}`, (v) => set({ potential: v }))),
    field('信赖', h('input', { type: 'number', min: 0, max: 200, value: String(d.trust), onchange: (/** @type {Event} */ e) => set({ trust: valueOf(e) }) })),
    openSkills(t, d.elite).map((s, i) => field(`技能${i + 1}`, numberSelect(d.skills[i], range(1, skillCap(d.elite, s.levels.length)), skillLevelText, (v) => set({ skills: at(d.skills, i, v) })))),
    t.modules.map((m, i) => field(`模组 ${m.type ?? i + 1}`, numberSelect(d.modules[i], range(0, m.levels.length), (v) => (v === 0 ? '未解锁' : `${v}级`),
      (v) => set({ modules: at(d.modules, i, v) }), !moduleOpen(m, d.elite, d.level)))),
  ];
}

/** The editor of the entry being edited, or null. @param {Box} B */
function editor(B) {
  if (!B.editing) return null;
  const { draft: d, training: t } = B.editing;
  const set = (/** @type {Partial<BoxEntry>} */ p) => { if (B.editing) B.editing.draft = clampEntry({ ...d, ...p }, t); render(B); };
  const close = () => { B.editing = null; render(B); };
  return h('div', { class: 'editor', 'aria-label': `编辑 ${nameOf(B, d.id)}` },
    h('h3', {}, nameOf(B, d.id)), h('div', { class: 'fields' }, ...fields(d, t, set)),
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { B.o.setSave(putEntry(B.o.getSave(), d)); close(); } }, '保存'), h('button', { onclick: close }, '取消')));
}

/** A box operator's row: its training, its list, its buttons. @param {Box} B @param {Save} s @param {BoxEntry} e */
function row(B, s, e) {
  const list = s.squad.high.includes(e.id) ? 'high' : s.squad.low.includes(e.id) ? 'low' : null;
  const put = (/** @type {'high' | 'low' | null} */ to) => {
    const n = place(B.o.getSave(), e.id, to);
    if (n) B.o.setSave(n); else B.o.toast(to === 'high' ? `高顺位已满（${SQUAD.high} 名）` : `低顺位已满（${SQUAD.low} 名）`);
  };
  return h('tr', { 'data-id': e.id },
    h('td', {}, nameOf(B, e.id), h('small', {}, ` ${'★'.repeat(B.o.roster[e.id]?.rarity ?? 0)}`)),
    h('td', {}, trainingText(e)), h('td', {}, `潜能${e.potential} · 信赖${e.trust}%`), h('td', {}, e.skills.map(skillLevelText).join(' / ') || '—'),
    h('td', { class: 'place' },
      h('button', { 'aria-pressed': String(list === 'high'), onclick: () => put('high') }, '高顺位'),
      h('button', { 'aria-pressed': String(list === 'low'), onclick: () => put('low') }, '低顺位'),
      h('button', { disabled: list === null, onclick: () => put(null) }, '移出')),
    h('td', {}, h('button', { onclick: () => edit(B, e.id) }, '编辑'), h('button', { onclick: () => B.o.setSave(removeEntry(B.o.getSave(), e.id)) }, '删除')));
}

/** An icon of a style (页面-5), or nothing without it. @param {Box} B @param {string} icon @param {'' | '_tiny'} variant @param {string} cls */
const iconOf = (B, icon, variant, cls) => {
  const src = B.o.icon?.(icon, variant);
  return src ? h('img', { class: cls, src, alt: '' }) : null;
};

/**
 * The play style to bring (房间-3): one button a style (its small icon, 页面-5), what the chosen one gives, costs and
 * carries, beside its full icon. @param {Box} B @param {Save} s
 */
function stylePicker(B, s) {
  const chosen = STYLES.find((x) => x.id === s.style) ?? STYLES[0];
  return h('div', { class: 'styles' },
    h('div', { class: 'row', role: 'group', 'aria-label': '比赛风格' }, STYLES.map((x) =>
      h('button', { 'aria-pressed': String(x.id === chosen.id), 'data-style': x.id, style: `border-left: 4px solid ${x.color}`, onclick: () => B.o.setSave({ ...B.o.getSave(), style: x.id }) },
        iconOf(B, x.icon, '_tiny', 'style-tiny'), x.name))),
    h('div', { class: 'style-chosen' }, iconOf(B, chosen.icon, '', 'style-card'),
      h('p', { class: 'muted' }, `${chosen.name}：${plain(chosen.buff)}${chosen.debuff === '无' ? '' : `；${plain(chosen.debuff)}`}。携带物 ${chosen.device.name}：${plain(chosen.device.desc)}`)));
}

/** Copying the save out and in. @param {Box} B */
function saveTools(B) {
  const area = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: 4, 'aria-label': '存档文本' }));
  const load = () => { const got = importSave(area.value); if ('save' in got) { B.o.setSave(got.save); B.o.toast('存档已导入'); } else B.o.toast(`导入失败：${got.error}`); };
  return h('details', { class: 'save' }, h('summary', {}, '导出 / 导入存档'), area,
    h('div', { class: 'row' }, h('button', { onclick: () => { area.value = exportSave(B.o.getSave()); area.select(); } }, '导出到文本框'), h('button', { onclick: load }, '从文本框导入')));
}

/**
 * A select of the box's operators after a first choice of none.
 * @param {Box} B @param {Save} s @param {[string, string, string]} choice the first choice's text, the value, the label @param {(id: string) => void} on
 */
const operatorSelect = (B, s, [none, value, label], on) =>
  h('select', { 'aria-label': label, onchange: (/** @type {Event} */ e) => on(/** @type {HTMLSelectElement} */ (e.target).value) },
    h('option', { value: '', selected: value === '' }, none), s.box.map((e) => h('option', { value: e.id, selected: e.id === value }, nameOf(B, e.id))));

/**
 * The name card (房间-1): the nickname and its 代号 (four digits, shown as 昵称#代号), the assistant — the operator the
 * start show draws — and its art, the avatar; the room shows them as they are now (profileOf).
 * @param {Box} B @param {Save} s
 */
function nameCard(B, s) {
  const set = (/** @type {Partial<Save>} */ p) => B.o.setSave({ ...B.o.getSave(), ...p }), now = profileOf(s);
  const e = s.box.find((x) => x.id === now.assist?.id), art = s.assist?.art ?? now.assist?.art ?? 1;
  const tag = /** @type {HTMLInputElement} */ (h('input', { value: s.tag, inputMode: 'numeric', maxLength: 4, size: 4, pattern: '[0-9]{4}',
    onchange: (/** @type {Event} */ ev) => {
      const v = /** @type {HTMLInputElement} */ (ev.target).value.trim();
      if (/^\d{4}$/.test(v)) set({ tag: v }); else { B.o.toast('代号是 4 位数字'); tag.value = s.tag; }
    } }));
  return h('div', { class: 'namecard' },
    h('div', { class: 'row' },
      field('昵称', h('input', { value: s.name, maxLength: 16, onchange: (/** @type {Event} */ ev) => set({ name: /** @type {HTMLInputElement} */ (ev.target).value.trim().slice(0, 16) }) })),
      field('代号', tag)),
    h('div', { class: 'row' },
      field('助理干员', operatorSelect(B, s, ['常规队第一名', s.assist?.id ?? '', '助理干员'], (id) => set({ assist: id ? { id, art: 1 } : null }))),
      field('立绘', numberSelect(art, e && e.elite >= 2 ? [1, 2] : [1], (v) => (v === 2 ? '精英二' : '精英一'),
        (v) => { if (now.assist) set({ assist: { id: now.assist.id, art: /** @type {1 | 2} */ (v) } }); }, !now.assist)),
      field('头像', operatorSelect(B, s, ['同助理干员', s.avatar, '头像'], (id) => set({ avatar: id })))),
    h('p', { class: 'muted' }, `房间里显示为 ${s.name || '博士'}#${s.tag}；`, now.assist ? `助理干员 ${nameOf(B, now.assist.id)}（${now.assist.art === 2 ? '精英二' : '精英一'}立绘）` : '还没有助理干员（box 里没有干员）',
      now.avatar ? `，头像 ${nameOf(B, now.avatar)}` : ''));
}

/** @param {Box} B */
function render(B) {
  const s = B.o.getSave(), why = squadProblem(squadOf(s)), q = s.squad;
  const input = /** @type {HTMLInputElement} */ (h('input', { list: 'roster-names', placeholder: '输入干员名', 'aria-label': '干员名' }));
  B.host.replaceChildren(
    h('h2', {}, '干员 box 与常规队'),
    h('h3', {}, '名片'), nameCard(B, s),
    h('p', { class: why ? 'squad bad' : 'squad ok' }, `常规队：高顺位 ${q.high.length}/${SQUAD.high} · 低顺位 ${q.low.length}/${SQUAD.low} · 合计 ${q.high.length + q.low.length}（至少 ${SQUAD.min}）`, why ? ` · ${why}` : ' · 可以参赛'),
    h('h3', {}, '比赛风格'), stylePicker(B, s),
    h('div', { class: 'row' }, input, h('button', { onclick: () => add(B, input.value) }, '加入 box'),
      h('button', { onclick: () => fill(B).catch((e) => B.o.toast(`填充失败：${e.message}`)) }, '随机填满常规队')),
    h('datalist', { id: 'roster-names' }, Object.values(B.o.roster).map((r) => h('option', { value: r.name }))),
    editor(B) ?? '', h('table', { class: 'box' }, h('tbody', {}, s.box.map((e) => row(B, s, e)))), saveTools(B));
}

/** The box view on a host element. @param {HTMLElement} host @param {BoxViewOptions} o */
export function createBoxView(host, o) {
  /** @type {Box} */
  const B = { host, o, trainings: new Map(), editing: null, byName: new Map(Object.entries(o.roster).map(([id, r]) => [r.name, id])) };
  return { render: () => render(B) };
}
