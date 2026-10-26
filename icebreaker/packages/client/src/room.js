// The room page (docs/spec/room.md): the lobby connection, the room as the server tells it, and the box and 常规队 of
// the local save. When the room's match starts the page goes to the battle page with the match and the seat; the
// battle page comes back here when it ends. The lobby key stays in this tab (session.js), so a reload or the way back
// takes the same seat. With the assets the page shows the activity's icons and plays its menu music (页面-5); with their
// lobby UI pack the room is drawn on the original lobby screens (页面-6), the page's HTML room staying the fallback.
import { LEVELS } from '@aue/content';
import { ROSTER, loadTraining, moddedText } from './mods.js';
import { squadProblem, MODE, EMOTES, MATCH } from '@icebreaker/mode-regular';
import { bootDone } from './boot.js';
import { LOBBY_KEY, tabKey, localStore } from './session.js';
import { readSave, writeSave, squadOf, profileOf, newTag, putEntry } from './save.js';
import { fullEntry } from './training.js';
import { createBoxView } from './boxview.js';
import { renderRoom, entryIn } from './roomview.js';
import { CLOSED, SOUGHT, clock, startingLineup, inviteText } from './roomtext.js';
import { loadRoomAtlas, styleIcon, modeIcon } from './roomart.js';
import { createRoomMusic } from './roommusic.js';
import { readSettings, writeSettings, VOLUMES } from './settings.js';
import { startLobby } from './lobbypage.js';
import { resultOf } from './lobbymap.js';
import { assetsUrl, socketUrl, nodeHost } from './site.js';
import { startTurn } from './turn.js';

/** Where this tab's last match is kept, for a way back into it; where the battle page leaves its result (页面-6). */
const MATCH_KEY = 'ice.match', RESULT_KEY = 'ice.result';
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const store = localStore(), key = tabKey(LOBBY_KEY);
let save = readSave(store);
/** The match this tab was sent to when the page opened: its result shows first (页面-6). */
const STARTED_AT_LOAD = readStarted();
// a 代号 of its own from the first visit on (房间-1), kept with the save
if (!save.tag) { save = { ...save, tag: newTag() }; writeSave(store, save); }
// a phone plays in landscape (页面-7), before anything measures the page
startTurn(/** @type {HTMLButtonElement | null} */ (document.getElementById('full')));
// a host with mods (页面-10): the header says which
const modded = moddedText();
if (modded) Object.assign($('modded'), { hidden: false, textContent: modded });
const ASSETS = assetsUrl(), ART = new URL('ui/room/', ASSETS).href;
/** @type {import('./roomart.js').RoomAtlas | null} */
let atlas = null;
const music = createRoomMusic(new URL('audio/', ASSETS).href, readSettings(store).music);
/** @type {import('./roomview.js').RoomState} */
const S = { conn: '连接中', lobby: null, view: null, at: 0, draft: null, started: readStarted(), ping: null, emotes: [null, null], chatAt: -Infinity, seeking: null };
/** How often the page measures the lobby's latency (页面-6). */
const PING_MS = 2000;
/** @type {WebSocket | null} */
let ws = null;
let retry = 0;
/** Where the room is (站点-6): another node's host this tab keeps while its room is there, else null (this node). */
let server = keptServer();
/** A code to join once connected to its node (站点-6). @type {string | null} */
let pendingJoin = null;

/** The node this tab keeps for its room (sessionStorage ice.server), when it is one the page may connect to. */
function keptServer() {
  try { const h = sessionStorage.getItem('ice.server'); return nodeHost(h) ? h : null; } catch { return null; }
}
/** Connects the lobby to a node — another one's host, or null for this one — at once (站点-6). @param {string | null} host */
function moveTo(host) {
  server = host;
  try { if (host) sessionStorage.setItem('ice.server', host); else sessionStorage.removeItem('ice.server'); } catch { /* this tab only */ }
  retry = 0;
  ws?.close(1000);
}
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;
/** The original lobby screens when the assets have them (页面-6). @type {Awaited<ReturnType<typeof startLobby>>} */
let lobby = null;

/** @returns {{ match: string, seat: number, inverse?: boolean, training?: string } | null} */
function readStarted() {
  try { return JSON.parse(sessionStorage.getItem(MATCH_KEY) ?? 'null'); } catch { return null; }
}
/** @param {{ match: string, seat: number, inverse?: boolean, training?: string } | null} s */
function writeStarted(s) {
  try { if (s) sessionStorage.setItem(MATCH_KEY, JSON.stringify(s)); else sessionStorage.removeItem(MATCH_KEY); } catch { /* the way back is a convenience */ }
}

/** @param {string} text */
function toast(text) {
  if (lobby) { lobby.toast(text); return; }
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

const playerName = () => save.name || '博士';
/** @param {Record<string, unknown>} m */
const send = (m) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); else toast('还没有连上服务器'); };
/** The name card last sent, so a save that does not change it sends nothing. */
let sentCard = '';
/** The save's name card to the lobby (房间-1): after hello, and whenever it changes. @param {boolean} [again] */
function sendCard(again = false) {
  const card = JSON.stringify(profileOf(save));
  if (ws?.readyState !== WebSocket.OPEN || (card === sentCard && !again)) return;
  sentCard = card;
  ws.send(JSON.stringify({ t: 'profile', ...profileOf(save) }));
}

/** @type {import('./roomview.js').RoomActions} */
const A = {
  send, squad: () => squadOf(save), squadProblem: () => squadProblem(squadOf(save)),
  nameOf: (id) => ROSTER[id]?.name ?? id,
  setDraft: (d) => { S.draft = d; draw(); },
  style: () => save.style,
  icon: (icon, variant) => styleIcon(atlas, ART, icon, variant),
  modeIcon: (type = MODE.type) => modeIcon(atlas, ART, type),
  // 表情交流 (房间-7): the server sends it back to both seats; the page holds its buttons for the cooldown
  emote: (id, theme) => { S.chatAt = performance.now(); send({ t: 'emote', id, theme }); draw(); setTimeout(draw, EMOTES.cd * 1000 + 50); },
  // 快速匹配 (房间-9): with the save's 常规队 and style, which the room confirms with when 项目确认 runs out (房间-10)
  seek: (classes, pos, inverse) => send({ t: 'seek', classes, pos, inverse, squad: squadOf(save), style: save.style }),
  // 训练场 (房间-11): a training level's match of this player alone
  train: (level) => send({ t: 'train', level }),
};

/** The end of a search (房间-9): found — the room comes next —, not found, cancelled. @param {any} m */
function onSought(m) {
  S.seeking = null;
  lobby?.sought(m);
  if (lobby) return;
  if (m.how === 'found') toast(MATCH.positions.find((p) => p.id === m.mate)?.found ?? '匹配成功');
  else toast(SOUGHT[/** @type {'fail' | 'cancel'} */ (m.how)] ?? '');
}

/** An emote a seat sent (房间-7): shown by that seat for its time. @param {any} m */
function onEmote(m) {
  if (m.seat !== 0 && m.seat !== 1) return;
  S.emotes[m.seat] = { id: String(m.id), theme: String(m.theme), until: performance.now() + EMOTES.time * 1000 };
  lobby?.emote();
  setTimeout(draw, EMOTES.time * 1000 + 50);
}

/** The save changed (the box view, the lobby's select page): kept, the name card sent, both views drawn. @param {import('./save.js').Save} s */
function setSave(s) {
  const renamed = s.name !== save.name;
  save = s;
  if (!writeSave(store, s)) toast('这个浏览器不让保存，关闭页面后 box 会丢失');
  if (renamed && ws?.readyState === WebSocket.OPEN) send({ t: 'hello', key, name: playerName() });
  sendCard();
  box.render();
  draw();
}

const box = createBoxView($('boxbody'), { roster: ROSTER, training: (id) => loadTraining(id), getSave: () => save, toast, icon: A.icon, setSave });

/**
 * A list of the 常规队 as the operator select page chose it (页面-9): operators not in the box join it at full training
 * (页面-2), the other list lets go of the ones chosen here. @param {'high' | 'low'} list @param {string[]} ids
 */
async function setList(list, ids) {
  let next = save;
  for (const id of ids) if (!next.box.some((e) => e.id === id)) next = putEntry(next, fullEntry(id, await loadTraining(id)));
  const other = list === 'high' ? 'low' : 'high';
  setSave({ ...next, squad: { ...next.squad, [list]: [...ids], [other]: next.squad[other].filter((x) => !ids.includes(x)) } });
}

/** The music button (页面-5): the music volume of the settings, 100% → 50% → 关 → 100%, saved for both pages. */
function drawMusic() {
  const v = readSettings(store).music;
  $('music').textContent = `音乐 ${v === 0 ? '关' : `${v * 100}%`}`;
}

function draw() {
  $('conn').textContent = S.conn;
  drawMusic();
  if (lobby) { lobby.draw(); return; }
  renderRoom($('screen'), S, A);
  $('box').hidden = !!S.view && !['setup', 'confirm'].includes(S.view.phase);
}

/** The box editor over the lobby screens (页面-6), the page's own tool. @param {boolean} on */
function boxOpen(on) {
  document.body.classList.toggle('box-open', on);
  $('box').hidden = !on;
}

/** The battle page's result, once (页面-6). */
function takeResult() {
  let raw = null, bg = null;
  try {
    raw = sessionStorage.getItem(RESULT_KEY); bg = sessionStorage.getItem(`${RESULT_KEY}.bg`);
    sessionStorage.removeItem(RESULT_KEY); sessionStorage.removeItem(`${RESULT_KEY}.bg`);
  } catch { /* no result kept */ }
  const r0 = resultOf(raw), mine = !!r0 && STARTED_AT_LOAD?.match === r0.match;
  const r = r0 && mine ? { ...r0, ...(STARTED_AT_LOAD?.inverse ? { inverse: true } : {}), ...(STARTED_AT_LOAD?.training ? { training: true } : {}) } : r0;
  return r && bg?.startsWith('data:image/') ? { ...r, bg } : r;
}

/** The lobby screens when the assets have them; else the HTML room stays. */
async function lobbyMode() {
  lobby = await startLobby($('lobby'), {
    S, A, entry: (id) => save.box.find((e) => e.id === id) ?? null, setList, invite: () => inviteText(S.view?.code ?? '', S.view?.members[0]?.name ?? '', S.view?.members[0]?.tag ?? ''),
    setStyle: (id) => { save = { ...save, style: id }; if (!writeSave(store, save)) toast('这个浏览器不让保存，关闭页面后 box 会丢失'); sendCard(); box.render(); draw(); },
    backButton: (on) => { $('back').hidden = !on; }, sfx: readSettings(store).sfx, card: () => ({ name: playerName(), ...profileOf(save) }),
  }).catch((e) => { console.error(e); return null; });
  // the lobby's entry screen, or the page's own room without the lobby pack, takes over from the loading screen (页面-8)
  bootDone();
  if (!lobby) return;
  document.body.classList.add('lobby-on');
  $('lobby').hidden = false;
  $('boxbtn').hidden = false;
  $('boxclose').hidden = false;
  boxOpen(false);
  const r = takeResult();
  if (r) lobby.result(r);
  draw();
}

/** A room view: the lineup a player starts from once the lineups are set (房间-5). @param {any} v */
function onRoom(v) {
  if (v.phase !== 'lineup') S.draft = null;
  else if (!S.draft) S.draft = startingLineup(v.options[v.you], (id) => entryIn({ ...S, view: v }, v.you, id));
  if (v.phase === 'setup' && S.started) { S.started = null; writeStarted(null); }
  S.view = v;
  S.at = performance.now();
}

/** The room's match started: to the battle page with the match and the seat (房间-6). @param {any} m */
function onStart(m) {
  const training = typeof m.training === 'string' && Object.hasOwn(LEVELS, m.training) ? m.training : null;
  S.started = { match: m.match, seat: m.seat, ...(S.view?.inverse ? { inverse: true } : {}), ...(training ? { training } : {}), ...(server ? { server } : {}) };
  writeStarted(S.started);
  // the stage for the battle page's loading screen, shown before it has loaded the match (页面-6); a training's its level's
  const lv = training ? /** @type {any} */ (LEVELS[training]).level : null;
  const pr = lv ? { code: lv.code, name: lv.name, level: training } : S.view ? S.lobby?.projects[S.view.project] : null;
  // its level too: the loading screen's picture is the mode's (页面-8)
  try { if (pr) sessionStorage.setItem('ice.loading', JSON.stringify({ match: m.match, code: pr.code, name: pr.name, level: pr.level })); } catch { /* the battle page waits for the match */ }
  const to = `play?match=${encodeURIComponent(m.match)}&seat=${m.seat}${server ? `&server=${encodeURIComponent(server)}` : ''}`;
  // with the lobby screens the countdown and the start play first (页面-6)
  void Promise.all([lobby?.start(), music.leave()]).then(() => location.assign(to));
}

/** The lobby's messages, each drawn after. @type {Record<string, (m: any) => void>} */
const ON = {
  lobby: (m) => { S.lobby = m; }, room: onRoom, emote: onEmote, start: onStart, sought: onSought,
  seeking: (m) => { S.seeking = { classes: m.classes, pos: m.pos, inverse: m.inverse, until: performance.now() + m.left }; lobby?.seeking(); },
  error: (m) => { lobby?.failed(); toast(m.msg); },
  closed: (m) => { S.view = null; S.draft = null; toast(CLOSED[m.why] ?? '房间已关闭'); if (server) moveTo(null); },
  // the room is on another node (站点-6): connect there and join it; a node the page may not connect to is a code of no room here
  elsewhere: (m) => {
    if (!nodeHost(m.host) || typeof m.code !== 'string') { lobby?.failed(); toast('这个房间在另一台服务器上，请从游戏入口页进入后再加入'); return; }
    pendingJoin = m.code;
    moveTo(m.host);
  },
};

/** @param {any} m */
function onMessage(m) {
  if (m.t === 'pong') { if (typeof m.at === 'number') S.ping = performance.now() - m.at; return; }
  if (Object.hasOwn(ON, m.t)) ON[m.t](m);
  draw();
}

function connect() {
  const sock = new WebSocket(socketUrl('lobby', location.href, server));
  ws = sock;
  sock.onopen = () => {
    retry = 0; S.conn = '已连接'; sock.send(JSON.stringify({ t: 'hello', key, name: playerName() })); sendCard(true); ping();
    if (pendingJoin) { sock.send(JSON.stringify({ t: 'join', code: pendingJoin })); pendingJoin = null; }
    draw();
  };
  sock.onmessage = (e) => onMessage(JSON.parse(String(e.data)));
  sock.onclose = (e) => {
    S.conn = '重连中';
    S.ping = null;
    if (e.reason) toast(`连接断开：${e.reason}`);
    draw();
    setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
  };
}

/** The lobby's latency: the page's time sent and back (页面-6). */
function ping() { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping', at: performance.now() })); }

setInterval(ping, PING_MS);
setInterval(() => {
  for (const el of document.querySelectorAll('[data-until]')) el.textContent = clock(Number(/** @type {HTMLElement} */ (el).dataset['until']) - performance.now());
}, 250);
$('music').addEventListener('click', () => {
  const s = readSettings(store), next = VOLUMES[(VOLUMES.indexOf(s.music) + 1) % VOLUMES.length];
  writeSettings(store, { ...s, music: next });
  music.volume(next);
  drawMusic();
});
// a page may sound only after a gesture: the music starts on the first touch or key
addEventListener('pointerdown', () => { music.start(); lobby?.resume(); });
addEventListener('keydown', (e) => { music.start(); lobby?.resume(); if (e.key === 'Escape' && lobby) lobby.back(); });
$('back').addEventListener('click', () => lobby?.back());
$('boxbtn').addEventListener('click', () => boxOpen(!document.body.classList.contains('box-open')));
$('boxclose').addEventListener('click', () => { boxOpen(false); draw(); });
void loadRoomAtlas(ART).then((a) => { atlas = a; box.render(); draw(); });
box.render();
draw();
connect();
void lobbyMode();
// for end-to-end tests and the console
Object.assign(globalThis, { __room: { state: () => S, save: () => save, art: () => atlas !== null, lobby: () => lobby?.state() ?? null } });
