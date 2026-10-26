// The room on the room page (docs/spec/room.md): making or joining a room, then each step as the server's room view
// says — 项目调整, 项目确认, 高顺位干员协调, 组建上场阵容 — and the match. Countdowns carry `data-until` (a
// performance.now() time) and are kept up by room.js. Everything a player does goes out through `send`. The mode and
// the styles carry the activity's icons when the assets have them (页面-5).
import { STYLES, EMOTES, INVERSE, MATCH, emoteSceneOf, modeOf } from '@icebreaker/mode-regular';
import { h } from './dom.js';
import { PHASE_TITLES, clock, inviteText, turnText, lineupCount, styleText, cardName } from './roomtext.js';
import { skillLevelText, trainingText } from './training.js';

/** @typedef {import('@icebreaker/mode-regular').BoxEntry} BoxEntry @typedef {import('./roomtext.js').Pick} Pick */
/**
 * A project as the lobby gives it (房间-2): its stage, mode, level and difficulty, code, name, class, its stages' tasks
 * (常规项目) or its waves (堡垒守御), missions, description, whether it is being tested.
 * @typedef {{ stage: string, mode: 'NORMAL' | 'DEFENCE', level: string, difficulty: string, code: string, name: string, class: string, className: string,
 *   stages: { title: string, basic: string, advanced?: string, seconds: number }[], waves?: number, missions?: readonly string[], detail?: string, testing?: boolean }} ProjectView
 */
/**
 * What the page knows: the lobby's projects and recruits, the room as last seen and when, the lineup being set, the
 * match this tab was sent to, the lobby's latency in ms (null until measured), the emote each seat sent last and until
 * when it shows, and when this player sent its last (房间-7; performance.now() times).
 * @typedef {{ conn: string, lobby: { name: string, projects: ProjectView[], recruits: BoxEntry[] } | null, view: any, at: number, draft: Pick[] | null,
 *   started: { match: string, seat: number, inverse?: boolean, server?: string } | null, ping: number | null, emotes: ({ id: string, theme: string, until: number } | null)[], chatAt: number,
 *   seeking: { classes: string[], pos: string, inverse: boolean, until: number } | null }} RoomState
 */
/**
 * @typedef {object} RoomActions
 * @property {(m: Record<string, unknown>) => void} send
 * @property {() => import('@icebreaker/mode-regular').Squad} squad the 常规队 of the save
 * @property {() => string | null} squadProblem why the save's 常规队 cannot be confirmed
 * @property {(id: string) => string} nameOf
 * @property {(draft: Pick[]) => void} setDraft
 * @property {() => string} style the play style of the save
 * @property {(icon: string, variant: '' | '_tiny') => string | null} icon a style icon's URL (页面-5), null without it
 * @property {(type?: string) => string | null} modeIcon a mode's icon URL (页面-5; 常规项目's unless a type is given), null without it
 * @property {(id: string, theme: string) => void} emote sends an emote (房间-7)
 * @property {(classes: string[], pos: string, inverse: boolean) => void} seek starts 快速匹配 with the save's 常规队 and style (房间-9)
 * @property {(level: string) => void} train starts a training level (房间-11)
 */

/** A style as the room shows it: its small icon (页面-5) and its text. @param {RoomActions} A @param {string} id */
const styleLine = (A, id) => {
  const s = STYLES.find((x) => x.id === id), src = s ? A.icon(s.icon, '_tiny') : null;
  return h('span', { class: 'style-line' }, src ? h('img', { class: 'style-tiny', src, alt: '' }) : null, styleText(id));
};

/** A project's mode, with its icon and colour (页面-5). @param {RoomActions} A @param {ProjectView} p */
const modeTag = (A, p) => {
  const m = modeOf(p), src = A.modeIcon(m.type);
  return h('span', { class: 'mode', style: `color: ${m.color}` }, src ? h('img', { class: 'mode-icon', src, alt: '' }) : null, m.name);
};

/** A countdown to `ms` after the view came. @param {RoomState} S @param {number} ms */
const countdown = (S, ms) => h('span', { class: 'clock', 'data-until': String(S.at + ms) }, clock(ms));

/** The box entry of an operator in a seat's squad or among the recruits. @param {RoomState} S @param {number} seat @param {string} id @returns {BoxEntry | null} */
export function entryIn(S, seat, id) {
  const q = S.view?.squads?.[seat];
  return [...(q?.high ?? []), ...(q?.low ?? []), ...(S.lobby?.recruits ?? [])].find((e) => e.id === id) ?? null;
}

/** Making a room or joining one, or 快速匹配. @param {RoomState} S @param {RoomActions} A */
function noRoom(S, A) {
  const code = /** @type {HTMLInputElement} */ (h('input', { placeholder: '房间编号或邀请文字', 'aria-label': '房间编号' }));
  return h('div', {},
    h('div', { class: 'card' },
      h('h2', {}, '组队参赛'),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => A.send({ t: 'create' }) }, '创建房间')),
      h('div', { class: 'row' }, code, h('button', { onclick: () => A.send({ t: 'join', code: code.value }) }, '加入房间'))),
    quickMatch(S, A));
}

/**
 * 快速匹配 (房间-9): the classes of the lobby's projects (初级赛 checked at first), the position (教练 locked), 互选模式;
 * while looking, the time left and 取消匹配. @param {RoomState} S @param {RoomActions} A
 */
function quickMatch(S, A) {
  const sk = S.seeking;
  if (sk) {
    return h('div', { class: 'card seeking' }, h('h2', {}, '快速匹配'),
      h('p', {}, '正在匹配协作者', h('span', { class: 'clock', 'data-until': String(sk.until) }, clock(sk.until - performance.now()))),
      h('button', { onclick: () => A.send({ t: 'unseek' }) }, '取消匹配'));
  }
  const classes = [...new Map((S.lobby?.projects ?? []).filter((p) => p.mode !== 'DEFENCE').map((p) => [p.class, p.className])).entries()];
  const first = new Set(MATCH.classes.filter((c) => c.first).map((c) => c.class));
  const boxes = classes.map(([c, name]) => h('label', {}, h('input', { type: 'checkbox', value: c, checked: first.has(c), 'aria-label': name }), ` ${name}`));
  const pos = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': '参赛身份' }, MATCH.positions.map((p) => h('option', { value: p.id, disabled: p.locked }, p.locked ? `${p.name}（${p.hint}）` : p.name))));
  const inverse = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', 'aria-label': '匹配互选模式' }));
  const go = () => A.seek(boxes.map((b) => /** @type {HTMLInputElement} */ (b.firstChild)).filter((b) => b.checked).map((b) => b.value), pos.value, inverse.checked);
  return h('div', { class: 'card' }, h('h2', {}, '快速匹配'),
    h('div', { class: 'row' }, ...boxes), h('div', { class: 'row' }, '参赛身份 ', pos, h('label', {}, inverse, ' 互选模式')),
    h('button', { class: 'primary', onclick: go }, '开始匹配'));
}

/** The room's code, members and countdown. @param {RoomState} S @param {RoomActions} A */
function header(S, A) {
  const v = S.view, host = v.you === 0;
  return h('div', { class: 'card head' },
    h('h2', {}, `${PHASE_TITLES[v.phase]}`, v.step ? h('span', { class: 'step' }, ' 剩余 ', countdown(S, v.step)) : null),
    v.matched ? h('p', { class: 'muted' }, '快速匹配的比赛：任何一方离开，房间就解散') : h('p', {}, '房间编号 ', h('strong', { class: 'code' }, v.code), v.phase !== 'battle' ? h('span', { class: 'muted' }, '　房间剩余 ', countdown(S, v.left)) : null),
    v.matched ? null : h('input', { class: 'invite', readOnly: true, value: inviteText(v.code, v.members[0]?.name ?? '', v.members[0]?.tag ?? ''), 'aria-label': '邀请文字', onfocus: (/** @type {Event} */ e) => /** @type {HTMLInputElement} */ (e.target).select() }),
    h('ul', { class: 'members' }, v.members.map((/** @type {any} */ m, /** @type {number} */ i) =>
      h('li', { class: m.online ? '' : 'offline' }, `${i === 0 ? '房主' : '参加者'} · ${cardName(m)}${i === v.you ? '（你）' : ''}${m.online ? '' : ' · 掉线'}`, bubble(S, i)))),
    emoteBar(S, A),
    h('div', { class: 'row' },
      h('button', { onclick: () => A.send({ t: 'leave' }) }, host || v.matched ? '解散房间' : '离开房间'),
      host && !v.matched && v.phase === 'setup' && v.members.length > 1 ? h('button', { onclick: () => A.send({ t: 'kick' }) }, '请离房间') : null));
}

/** The emote a seat sent, while it shows (房间-7). @param {RoomState} S @param {number} seat */
function bubble(S, seat) {
  const e = S.emotes[seat];
  return e && e.until > performance.now() ? h('span', { class: 'emote' }, ` 「${EMOTES.text[e.id] ?? e.id}」`) : null;
}

/** The phase's emotes as buttons (房间-7), held for a second after one went; none at 项目确认 and in the match. @param {RoomState} S @param {RoomActions} A */
function emoteBar(S, A) {
  const scene = emoteSceneOf(S.view.phase);
  if (!scene) return null;
  const wait = performance.now() - S.chatAt < EMOTES.cd * 1000;
  return h('div', { class: 'row emotes', 'aria-label': '交流' }, EMOTES.scenes[scene].map((id) =>
    h('button', { class: 'emote-btn', disabled: wait, onclick: () => A.emote(id, EMOTES.themes[0] ?? '') }, EMOTES.text[id] ?? id)));
}

/**
 * A project's mode (页面-5), code, name, class and its stages' tasks (房间-2) — 堡垒守御's its waves —, the note of a
 * project being tested. @param {ProjectView} p @param {RoomActions} A
 */
const projectInfo = (p, A) => h('div', { class: 'project' },
  h('h3', {}, modeTag(A, p), ` ${p.code} ${p.name}`, h('small', {}, ` ${p.className}`)),
  p.testing ? h('p', { class: 'testing' }, '测试中：部分敌人能力未实现') : null,
  p.mode === 'DEFENCE' ? h('p', {}, `共 ${p.waves} 波，防御阶段与休整阶段轮替`)
    : h('ol', {}, p.stages.map((s) => h('li', {}, `${s.title}：${s.basic}${s.advanced ? `（进阶：${s.advanced}）` : ''} · ${s.seconds} 秒`))));

/** 项目调整 (房间-2). @param {RoomState} S @param {RoomActions} A */
function setup(S, A) {
  const v = S.view, projects = S.lobby?.projects ?? [], host = v.you === 0;
  return h('div', { class: 'card' },
    h('div', { class: 'projects' }, projects.map((p, i) => h('button', { 'aria-pressed': String(v.project === i), disabled: !host, onclick: () => A.send({ t: 'project', index: i }) }, `${p.code} ${p.name}`))),
    projects[v.project] ? projectInfo(projects[v.project], A) : null,
    inverseSwitch(v, A),
    host
      ? h('button', { class: 'primary', disabled: v.members.length < 2 || !v.prepared, onclick: () => A.send({ t: 'go' }) }, v.members.length < 2 ? '等待参加者加入' : v.prepared ? '前往' : '等待参加者准备')
      : h('button', { class: 'primary', 'aria-pressed': String(v.prepared), onclick: () => A.send({ t: 'prepare', on: !v.prepared }) }, v.prepared ? '取消准备' : '准备参赛'));
}

/** 互选模式 (房间-8): the host's switch, the guest's view of it, and its hint while it is on. @param {any} v @param {RoomActions} A */
function inverseSwitch(v, A) {
  const box = h('input', { type: 'checkbox', checked: !!v.inverse, disabled: v.you !== 0, 'aria-label': '互选模式', onchange: () => A.send({ t: 'inverse', on: !v.inverse }) });
  return h('p', { class: v.inverse ? 'inverse on' : 'inverse' }, h('label', {}, box, ' 互选模式'), v.inverse ? h('small', {}, ` ${INVERSE.hint}`) : null);
}

/** The hint of 互选模式 on the later steps (房间-8). @param {any} v */
const inverseHint = (v) => (v.inverse ? h('p', { class: 'inverse on' }, INVERSE.hint) : null);

/** 项目确认 (房间-2, 房间-3). @param {RoomState} S @param {RoomActions} A */
function confirm(S, A) {
  const v = S.view, p = S.lobby?.projects[v.project], why = A.squadProblem(), mine = v.confirmed[v.you];
  return h('div', { class: 'card' },
    p ? projectInfo(p, A) : null,
    inverseHint(v),
    h('p', {}, v.confirmed.map((/** @type {boolean} */ c, /** @type {number} */ i) => `${i === v.you ? '你' : '对方'}${c ? '已确认' : '未确认'}`).join(' · ')),
    why ? h('p', { class: 'bad' }, `常规队不能参赛：${why}`) : null,
    h('p', {}, '比赛风格：', styleLine(A, A.style())),
    h('button', { class: 'primary', disabled: mine || !!why, onclick: () => A.send({ t: 'confirm', squad: A.squad(), style: A.style() }) }, mine ? '已确认参赛' : '确认参赛'));
}

/** 高顺位干员协调 (房间-4). @param {RoomState} S @param {RoomActions} A */
function pick(S, A) {
  const v = S.view, p = v.picking, mine = p.by === v.you;
  return h('div', { class: 'card' },
    h('p', { class: mine ? 'turn' : 'muted' }, turnText(p, v.you)),
    h('div', { class: 'ops' }, p.left.map((/** @type {string} */ id) => h('button', { disabled: !mine, onclick: () => A.send({ t: 'pick', id }) }, A.nameOf(id)))),
    h('button', { disabled: !mine || p.yielded || p.left.length < 2, onclick: () => A.send({ t: 'handover' }) }, '让出这次选择'),
    h('p', {}, `你保留：${p.won[v.you].map(A.nameOf).join('、') || '—'}`),
    h('p', {}, `对方保留：${p.won[1 - v.you].map(A.nameOf).join('、') || '—'}`));
}

/** A lineup option's row: in or out, its skill and module. @param {RoomState} S @param {RoomActions} A @param {string} id @param {string} tag */
function optionRow(S, A, id, tag) {
  const v = S.view, e = entryIn(S, v.you, id), draft = S.draft ?? [], at = draft.findIndex((x) => x.id === id), x = draft[at];
  const set = (/** @type {Pick | null} */ next) => A.setDraft(next ? (at >= 0 ? draft.map((y, i) => (i === at ? next : y)) : [...draft, next]) : draft.filter((y) => y.id !== id));
  const skills = (e?.skills ?? []).map((lv, i) => h('option', { value: String(i), selected: x?.skill === i }, `技能${i + 1} ${skillLevelText(lv)}`));
  const modules = (e?.modules ?? []).map((st, i) => (st > 0 ? h('option', { value: String(i), selected: x?.module === i }, `模组${i + 1} ${st}级`) : null));
  const pickOf = (/** @type {Partial<Pick>} */ p) => ({ id, skill: x?.skill ?? (e ? e.skills.length - 1 : -1), module: x?.module ?? -1, ...p });
  return h('tr', { class: x ? 'in' : '', 'data-id': id },
    h('td', {}, h('label', {}, h('input', { type: 'checkbox', checked: !!x, onchange: (/** @type {Event} */ ev) => set(/** @type {HTMLInputElement} */ (ev.target).checked ? pickOf({}) : null) }), ` ${A.nameOf(id)}`)),
    h('td', { class: 'muted' }, tag), h('td', {}, e ? trainingText(e) : ''),
    h('td', {}, h('select', { disabled: !x, 'aria-label': '技能', onchange: (/** @type {Event} */ ev) => set(pickOf({ skill: Number(/** @type {HTMLSelectElement} */ (ev.target).value) })) },
      h('option', { value: '-1', selected: x?.skill === -1 }, '不带技能'), skills)),
    h('td', {}, h('select', { disabled: !x, 'aria-label': '模组', onchange: (/** @type {Event} */ ev) => set(pickOf({ module: Number(/** @type {HTMLSelectElement} */ (ev.target).value) })) },
      h('option', { value: '-1', selected: (x?.module ?? -1) === -1 }, '不带模组'), modules)));
}

/** 组建上场阵容 and 准备就绪 (房间-5, 房间-6). @param {RoomState} S @param {RoomActions} A */
function lineup(S, A) {
  const v = S.view, o = v.options[v.you], other = v.options[1 - v.you], draft = S.draft ?? [], why = lineupCount(draft);
  const recruits = new Set((S.lobby?.recruits ?? []).map((e) => e.id)), set = v.lineups[v.you], ready = v.ready[v.you];
  const rows = [...o.kept.map((/** @type {string} */ id) => optionRow(S, A, id, '编队')), ...o.drawn.map((/** @type {string} */ id) => optionRow(S, A, id, '可选')),
    ...o.extra.map((/** @type {string} */ id) => optionRow(S, A, id, recruits.has(id) ? '临时招募' : '可选'))];
  return h('div', { class: 'card' },
    inverseHint(v),
    h('table', { class: 'lineup' }, h('tbody', {}, rows)),
    h('p', { class: why ? 'bad' : 'ok' }, why ?? `上场 ${draft.length} 名`),
    h('div', { class: 'row' },
      h('button', { disabled: !!why, onclick: () => A.send({ t: 'lineup', lineup: draft }) }, set ? '重新提交阵容' : '提交阵容'),
      h('button', { class: 'primary', disabled: !set, 'aria-pressed': String(ready), onclick: () => A.send({ t: 'ready', on: !ready }) }, ready ? '取消准备' : '准备就绪')),
    h('p', { class: 'muted' }, '你的比赛风格：', styleLine(A, v.styles[v.you]), ' · 对方：', styleLine(A, v.styles[1 - v.you])),
    h('p', { class: 'muted' }, `对方编队：${other.kept.map(A.nameOf).join('、') || '—'}`),
    h('p', { class: 'muted' }, `对方${v.ready[1 - v.you] ? '已准备就绪' : v.lineups[1 - v.you] ? '已提交阵容' : '正在组建阵容'}`));
}

/** After a matched match (房间-10): 继续一起玩, and whether the mate chose it. @param {RoomState} S @param {RoomActions} A */
function together(S, A) {
  const v = S.view, mine = !!v.together?.[v.you], mate = !!v.together?.[1 - v.you];
  return h('div', { class: 'card' },
    h('p', {}, '比赛结束。两人都选「继续一起玩」，就留在同一个房间里接着组队；否则房间解散。'),
    h('p', { class: 'muted' }, mate ? '协作者想继续一起玩' : '协作者还没有选择'),
    h('button', { class: 'primary', disabled: mine, onclick: () => A.send({ t: 'together' }) }, mine ? '等待协作者' : '继续一起玩'));
}

/** The match (房间-6): a way back into it. @param {RoomState} S */
function battle(S) {
  const s = S.started;
  return h('div', { class: 'card' },
    h('p', {}, '比赛进行中。比赛结束后，房间回到项目调整。'),
    s ? h('a', { class: 'button primary', href: `play?match=${encodeURIComponent(s.match)}&seat=${s.seat}${s.server ? `&server=${encodeURIComponent(s.server)}` : ''}` }, '回到比赛') : null);
}

/** Draws the room page's room part. @param {HTMLElement} host @param {RoomState} S @param {RoomActions} A */
export function renderRoom(host, S, A) {
  const v = S.view;
  if (!v) { host.replaceChildren(noRoom(S, A)); return; }
  /** @type {Record<string, () => HTMLElement>} */
  const steps = { setup: () => setup(S, A), confirm: () => confirm(S, A), pick: () => pick(S, A), lineup: () => lineup(S, A), battle: () => battle(S), together: () => together(S, A) };
  host.replaceChildren(header(S, A), steps[v.phase]());
}
