// The room page with the original lobby screens (docs/spec/page.md 页面-6, engine ADR 0063): when the assets have the
// lobby UI pack (ui/lobby.json), the room is drawn on it — the entry page, the squad page, the prepare page through
// the room's steps, the result after a match — over the whole page, with toasts in its notify view and leaving asked
// in its confirm dialog. The page logic stays the platform's room flow; without the pack (or with ?html) the page's
// own HTML room stays.
import { createUi } from '@aue/ui';
import { bootCounter, bootStep } from './boot.js';
import { ROSTER, loadTraining, lookOf } from './mods.js';
import { STYLES, TOASTS, TRAINING_LEVELS } from '@icebreaker/mode-regular';
import { openPart, closePart, setSwitch, SEASON, PAGE_SCREENS } from './lobbykit.js';
import { PAGES, pageOf, newLocal } from './lobbymap.js';
import { createEntry } from './lobbyentry.js';
import { createSquad } from './lobbysquad.js';
import { createPrepare } from './lobbyprepare.js';
import { createFinish } from './lobbyfinish.js';
import { createMatch } from './lobbymatch.js';
import { createTraining, trainingProject } from './lobbytrain.js';
import { createLobbySound } from './lobbysound.js';
import { AFTER_TICK } from './lobby3d.js';
import { startLobbyFx } from './lobbyfx.js';
import { entryIn } from './roomview.js';
import { styleIcon, loadRoomAtlas, spriteUrl, MODE_ICONS } from './roomart.js';
import { assetsUrl } from './site.js';

/** @typedef {import('./roomview.js').RoomState} RoomState @typedef {import('./roomview.js').RoomActions} RoomActions */
/**
 * What the room page gives the lobby: its state and actions, the save's box entries, setting the style, setting a list
 * of the 常规队 (the operator select page, 页面-9), its back button shown or not, the invitation text, the sound volume.
 * @typedef {{ S: RoomState, A: RoomActions, entry: (id: string) => import('@icebreaker/mode-regular').BoxEntry | null, setStyle: (id: string) => void,
 *   setList: (list: 'high' | 'low', ids: string[]) => Promise<void>, backButton: (on: boolean) => void, invite: () => string,
 *   sfx: number, card: () => any }} LobbyHost
 */

const ASSETS = assetsUrl(), UI = new URL('ui/', ASSETS).href, ROOM_ART = new URL('ui/room/', ASSETS).href;

/** @param {URL | string} url */
const fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

/** A picture of the lobby pack's common art by its number (0–5), or null. @param {any} lobby @param {string} kind @param {number} i */
function lobbyArt(lobby, kind, i) {
  const key = lobby?.art?.[kind]?.[Math.max(0, Math.min(5, i))];
  return key && lobby.sprites?.[key] ? new URL(lobby.sprites[key].uri, UI).href : null;
}

/**
 * The pictures cards take (页面-6): avatars from the manifest, profession and elite icons from the battle UI pack, the
 * rarity strips and potential marks the lobby pack carries (the game's common ones; the battle pack's rarity sprites
 * are the deploy cards' glows), skill icons from the skill icon index, the operators' half-length portraits from the
 * portrait index (by elite phase: the elite-2 one from elite 2 when there is one), the modules' type icons and marks
 * from the module icon index (a type's icon is named by it in lower case, a few in its own case), the illustrations
 * from the art index (the elite-2 art when asked and there is one; each with its rect in an illust loader). An operator a
 * mod adds has the pictures of the one it looks like (页面-10).
 * @param {any} battle @param {any} manifest @param {any} skills @param {any} lobby the lobby pack
 * @param {{ portraits: any, equips: any, illusts: any }} indexes the portrait index, the module icon index and the art index
 * @returns {import('./lobbycards.js').CardArt}
 */
function cardArt(battle, manifest, skills, lobby, { portraits, equips, illusts }) {
  const equipUrl = (/** @type {string | undefined} */ file) => (file ? new URL(`uniequip/${file}`, ASSETS).href : null);
  const card = battle?.hud?.card, url = (/** @type {string | null | undefined} */ key) => (key && battle?.sprites?.[key] ? new URL(battle.sprites[key].uri, UI).href : null);
  return {
    avatar: (id) => (manifest?.files?.[`avatar:${lookOf(id)}`] ? new URL(manifest.files[`avatar:${lookOf(id)}`].file, ASSETS).href : null),
    portrait: (id, elite) => {
      const p = portraits?.portraits?.[lookOf(id)], file = p ? (elite >= 2 && p['2']) || p['1'] : null;
      return file ? new URL(`portraits/${file}`, ASSETS).href : null;
    },
    profession: (p) => (card?.professions?.[p] ? { url: url(card.professions[p].sprite), color: card.professions[p].color } : null),
    elite: (phase) => url(card?.elite?.[phase]),
    rarity: (r) => lobbyArt(lobby, 'rarity', r - 1),
    potential: (p) => lobbyArt(lobby, 'potential', p - 1),
    skill: (id) => (skills?.icons?.[id] ? new URL(skills.icons[id], new URL('skills/', UI)).href : null),
    equip: (type) => equipUrl(equips?.type?.[type.toLowerCase()] ?? equips?.type?.[type]),
    equipMark: (mark) => equipUrl(equips?.extra?.[mark.toLowerCase()]),
    illust: (id, art) => {
      const p = illusts?.illusts?.[lookOf(id)], a = p ? (art >= 2 && p['2']) || p['1'] : null;
      return a ? { url: new URL(`charillust/${a.file}`, ASSETS).href, pos: a.pos, size: a.size } : null;
    },
  };
}

/**
 * What the lobby pack gets from the other indexes before the UI starts (页面-6): the season's logos as its sprites
 * (season/<name>, INF-0018), and the templates the page makes its own nodes from (a picture at a rect of its own, a
 * player's avatar in its frame).
 * @param {any} pack @param {any} season the season index
 */
function addArt(pack, season) {
  for (const [name, v] of Object.entries(season ?? {})) {
    if (v && typeof v === 'object' && typeof v.file === 'string') pack.sprites[SEASON + name] = { w: v.w, h: v.h, uri: `../season/${v.file}` };
  }
  Object.assign(pack.screens, structuredClone(PAGE_SCREENS));
}

/**
 * Starts the lobby screens over a host element, or null when the assets have no lobby pack (or the page asks for its
 * HTML room with ?html).
 * @param {HTMLElement} el @param {LobbyHost} H
 */
export async function startLobby(el, H) {
  if (new URLSearchParams(location.search).has('html')) return null;
  bootStep('正在载入大厅界面', 0.32);
  const pack = await fetchJson(new URL('lobby.json', UI));
  if (!pack?.screens) return null;
  bootStep('正在载入大厅界面', 0.45);
  const [battle, manifest, skills, atlas, portraits, equips, illusts, season, emoticons] = await Promise.all([fetchJson(new URL('battle.json', UI)), fetchJson(new URL('manifest.json', ASSETS)),
    fetchJson(new URL('skills/index.json', UI)), loadRoomAtlas(ROOM_ART), fetchJson(new URL('portraits/index.json', ASSETS)),
    fetchJson(new URL('uniequip/index.json', ASSETS)), fetchJson(new URL('charillust/index.json', ASSETS)), fetchJson(new URL('season/index.json', ASSETS)),
    fetchJson(new URL('emoticons/index.json', UI))]);
  addArt(pack, season);
  const sound = createLobbySound(new URL('audio/', ASSETS).href, H.sfx);
  const ui = createUi(/** @type {any} */ ({ pack, host: el, base: UI, sound: (/** @type {string} */ b) => sound.play(b) }));
  await ui.load(bootCounter('正在载入大厅界面', 0.55, 0.97, Object.keys(pack.sprites).length));
  // the screens' particle effects, when the assets have them (页面-6)
  const effects = startLobbyFx(ui, UI).catch(() => null);
  const emotes = emoticons?.themes ? { base: new URL('emoticons/', UI).href, index: emoticons } : null;
  return lobbyOn(ui, H, { cards: cardArt(battle, manifest, skills, pack, { portraits, equips, illusts }), atlas, sound, pack, effects, emotes });
}

/**
 * Copies a text through a hidden text box (the page runs on LAN addresses, where the clipboard API is not there:
 * 页面-3); false when the browser would not copy. @param {string} text
 */
function copyText(text) {
  const box = document.createElement('textarea');
  box.value = text;
  box.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(box);
  box.select();
  /** @type {boolean} */
  let ok;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  box.remove();
  return ok;
}

/** A toast in the notify view, gone after 3 seconds. @param {any} ui @param {string} text */
function toastOn(ui, text) {
  const n = openPart(ui, PAGES.notify, 80);
  n.text(n.view().txtNotify ?? '@txt_notify', text);
  setTimeout(() => closePart(n), 3000);
}

/** A question in the confirm dialog: confirm runs fn. @param {any} ui @param {string} text @param {string} yes @param {() => void} fn */
function askOn(ui, text, yes, fn) {
  const d = openPart(ui, PAGES.dialog, 70), f = d.view();
  d.text(f.dialogContentText, text);
  d.text(f.confirmBtnText, yes);
  d.text(f.cancelBtnText, '取消');
  setSwitch(d, f.confirmOnlyToggle, false);
  d.tap('@obj_btns/panel_two_options/panel_confirm/hotspot', () => { closePart(d); fn(); });
  d.tap('@obj_btns/panel_two_options/panel_cancel/hotspot', () => closePart(d));
}

/** The UI's clock, its size following the page, and a few ticks a second. @param {any} ui @param {() => void} tick */
function runUi(ui, tick) {
  let at = performance.now();
  const loop = (/** @type {number} */ now) => {
    ui.tick(Math.min(0.1, (now - at) / 1000));
    at = now;
    for (const f of AFTER_TICK) f();
    // a focused or clicked node can scroll the clipped layer: it never scrolls
    if (ui.layer.scrollLeft || ui.layer.scrollTop) { ui.layer.scrollLeft = 0; ui.layer.scrollTop = 0; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const fit = () => ui.resize(innerWidth, innerHeight);
  addEventListener('resize', fit);
  fit();
  setInterval(tick, 250);
}

/**
 * The skill ids and module types of operators, loaded on first ask (null until then); `changed` when some came.
 * @param {() => void} changed
 */
function skillIdsOf(changed) {
  /** @type {Map<string, { skills: string[], modules: string[] }>} */
  const ids = new Map();
  let version = 0;
  /** @param {string} id */
  const of = (id) => {
    if (!ids.has(id)) {
      ids.set(id, { skills: [], modules: [] });
      void loadTraining(id).then((t) => {
        ids.set(id, { skills: t.skills.map((s) => s?.id ?? ''), modules: t.modules.map((m) => /** @type {any} */ (m).type ?? '') });
        version++; changed();
      }, () => undefined);
    }
    return /** @type {{ skills: string[], modules: string[] }} */ (ids.get(id));
  };
  return {
    /** @param {string} id @param {number} k */
    get: (id, k) => of(id).skills[k] || null,
    /** A module's type (EXE-Y…). @param {string} id @param {number} k */
    module: (id, k) => of(id).modules[k] || null,
    /** How many modules an operator has (0 until its data came). @param {string} id */
    modules: (id) => of(id).modules.length,
    version: () => version,
  };
}

/**
 * The context the prepare page's steps work with.
 * @param {LobbyHost} H @param {any} G @param {import('./lobbymap.js').Local} L
 * @param {{ draw: () => void, back: () => void, toast: (t: string) => void, ask: (t: string, y: string, fn: () => void) => void, icon: any, skills: ReturnType<typeof skillIdsOf> }} K
 * @returns {import('./lobbystage.js').StepCtx}
 */
function stepCtx(H, G, L, K) {
  const S = H.S, A = H.A;
  return {
    send: A.send, projects: () => S.lobby?.projects ?? [], art: () => G.pack.art, cards: G.cards, styleIcon: K.icon, toast: K.toast,
    leave: () => K.ask('确定要离开房间吗？', '离开', () => A.send({ t: 'leave' })), kick: () => K.ask('确定要请离协作者吗？', '请离', () => A.send({ t: 'kick' })),
    back: K.back, offline: () => S.conn !== '已连接', list: (open) => { L.list = open; K.draw(); }, sub: (sub) => { L.sub = sub; K.draw(); },
    copy: () => K.toast(copyText(H.invite()) ? TOASTS.roomIdCopySuccess : H.invite()),
    nameOf: A.nameOf, rosterOf: (id) => ROSTER[id] ?? null, squad: A.squad, squadProblem: A.squadProblem, style: A.style, setDraft: A.setDraft,
    entryOf: (seat, id) => entryIn(S, seat, id) ?? (seat === S.view?.you ? H.entry(id) : null), skillId: K.skills.get, moduleType: K.skills.module, moduleCount: K.skills.modules, version: K.skills.version,
    modeIcon: (color, type = 'NORMAL') => spriteUrl(G.atlas, ROOM_ART, `${/** @type {Record<string, string>} */ (MODE_ICONS)[type] ?? MODE_ICONS.NORMAL}${color ? '_color' : ''}`),
    emoteArt: () => G.emotes, emote: A.emote,
  };
}

/**
 * Each page's maker. @param {any} ui @param {LobbyHost} H @param {any} G @param {import('./lobbymap.js').Local} L
 * @param {{ X: import('./lobbystage.js').StepCtx, draw: () => void }} K @returns {Record<string, () => any>}
 */
function pageMakers(ui, H, G, L, K) {
  const { X, draw } = K;
  const A = H.A;
  return {
    entry: () => createEntry(ui, { create: () => A.send({ t: 'create' }), join: (code) => A.send({ t: 'join', code }), squad: () => { L.squad = true; draw(); },
      match: () => { L.match = true; draw(); }, train: () => { L.train = true; draw(); },
      squadProblem: A.squadProblem, roomPanel: (on) => { L.room = on; }, effects: G.effects }),
    squad: () => createSquad(ui, { squad: A.squad, style: A.style, setStyle: H.setStyle, nameOf: A.nameOf,
      rosterOf: (id) => ROSTER[id] ?? null, cards: G.cards, styleIcon: X.styleIcon, back: X.back, home: () => { L.squad = false; draw(); },
      roster: ROSTER, entry: H.entry, training: loadTraining, art: G.pack.art, toast: X.toast, setList: H.setList }),
    prepare: () => createPrepare(ui, X),
    match: () => createMatch(ui, {
      classes: () => [...new Map((H.S.lobby?.projects ?? []).filter((p) => p.mode !== 'DEFENCE').map((p) => [p.class, p.className])).entries()].map(([c, name]) => ({ class: c, name })),
      send: A.send, seek: A.seek, seeking: () => H.S.seeking, toast: X.toast,
      modeIcon: (type) => spriteUrl(G.atlas, ROOM_ART, /** @type {Record<string, string>} */ (MODE_ICONS)[type] ?? ''),
      back: () => { if (H.S.seeking) A.send({ t: 'unseek' }); L.match = false; draw(); },
    }),
    train: () => createTraining(ui, {
      train: A.train, X, modeIcon: (type) => spriteUrl(G.atlas, ROOM_ART, /** @type {Record<string, string>} */ (MODE_ICONS)[type] ?? ''),
      back: () => { L.train = false; draw(); },
    }),
    finish: () => createFinish(ui, /** @type {any} */ (L.finish), { X, project: (level, difficulty) => X.projects().find((p) => p.level === level && p.difficulty === (difficulty ?? 'NORMAL'))
      ?? (TRAINING_LEVELS.includes(level) ? trainingProject(level) : null),
      players: () => playersOf(H), likes: () => likesOf(H), like: () => A.send({ t: 'like' }),
      together: () => togetherOf(H), playTogether: () => A.send({ t: 'together' }),
      // after a training its room page again (房间-11)
      done: () => { L.train = !!L.finish?.training; L.finish = null; draw(); },
      quit: () => { L.train = !!L.finish?.training; L.finish = null; if (H.S.view) A.send({ t: 'leave' }); draw(); } }),
  };
}

/**
 * The room's players for the finish view (页面-6): this player and the other as the room shows them, this player's
 * own name card while the room has not come back yet. @param {LobbyHost} H @returns {[any, any]}
 */
function playersOf(H) {
  const v = H.S.view;
  return v ? [v.members[v.you] ?? null, v.members[1 - v.you] ?? null] : [H.card(), null];
}

/**
 * 继续一起玩 after a matched match (房间-10): whether the room is still the matched one waiting for it, each seat's
 * choice, and whether the room is there at all. @param {LobbyHost} H
 */
function togetherOf(H) {
  const v = H.S.view;
  return { matched: !!v?.matched, mine: !!v?.together?.[v.you], mate: !!v?.together?.[1 - v.you], room: !!v };
}

/** The likes on the last match's result (房间-6): whether this player gave one, and got one. @param {LobbyHost} H @returns {[boolean, boolean]} */
function likesOf(H) {
  const v = H.S.view;
  return v?.likes ? [!!v.likes[v.you], !!v.likes[1 - v.you]] : [false, false];
}

/** The owner's toast when the mate joins or leaves (页面-6); the count now. @param {any} v @param {number} was @param {(t: string) => void} toast */
function memberToast(v, was, toast) {
  const n = v?.members.length ?? 0;
  if (v && v.you === 0 && was && n !== was) toast(n > was ? TOASTS.roomCollaboratorJoinRoom : TOASTS.roomCollaboratorExitRoom);
  return n;
}

/**
 * The lobby on a loaded UI.
 * @param {any} ui @param {LobbyHost} H @param {{ cards: import('./lobbycards.js').CardArt, atlas: any, sound: ReturnType<typeof createLobbySound>, pack: any, effects: Promise<unknown>,
 *   emotes: { base: string, index: any } | null }} G
 */
function lobbyOn(ui, H, G) {
  const L = newLocal(), S = H.S;
  /** @type {{ key: string, c: any }} */
  let page = { key: '', c: null };
  let members = 0;
  /** @param {string} style @param {'' | '_tiny' | '_show'} variant */
  const icon = (style, variant) => { const s = STYLES.find((x) => x.id === style); return s ? styleIcon(G.atlas, ROOM_ART, s.icon, /** @type {any} */ (variant)) : null; };
  const toast = (/** @type {string} */ t) => toastOn(ui, t), skills = skillIdsOf(() => draw());
  const X = stepCtx(H, G, L, { draw: () => draw(), back: () => back(), toast, ask: (t, y, fn) => askOn(ui, t, y, fn), icon, skills });
  const makers = pageMakers(ui, H, G, L, { X, draw: () => draw() });

  function draw() {
    const key = pageOf(S, L);
    if (key !== page.key) {
      page.c?.close();
      page = { key, c: makers[key]() };
      // the pages' own top menus (the game's common one) do the going back: the page's button stays hidden
      H.backButton(false);
    }
    if (S.view?.phase !== 'lineup') L.sub = 'sel';
    // a room — a matched one too — ends the quick match page and the training room page (房间-9, 房间-11)
    if (S.view) { L.match = false; L.train = false; }
    members = memberToast(S.view, members, toast);
    page.c?.update?.(S, L);
  }

  /** The page's back (页面-6): the result on, out of the squad page or the room panel, the stage list, a lineup view back, else leaving. */
  function back() {
    if (page.key === 'finish') { L.finish = null; draw(); return; }
    if (page.key === 'squad') { if (!page.c.back()) { L.squad = false; draw(); } return; }
    if (page.key === 'entry') { void page.c.back(); return; }
    if (page.key === 'train') { L.train = false; draw(); return; }
    if (L.list) { L.list = false; draw(); return; }
    if (S.view?.phase !== 'lineup' || L.sub === 'sel') { X.leave(); return; }
    if (S.view.ready[S.view.you]) H.A.send({ t: 'ready', on: false });
    L.sub = L.sub === 'check' ? 'skill' : 'sel';
    draw();
  }

  runUi(ui, () => { if (page.key === 'prepare' || page.key === 'match') page.c?.tick(S); });
  return {
    ui, draw, toast, back,
    /** A match's result to show first. @param {import('./lobbymap.js').MatchResult} r */
    result: (r) => { L.finish = r; draw(); },
    /** An emote came (房间-7): its bubble shows on the next drawing. */
    emote: () => draw(),
    /** The search for a mate started (房间-9): its banner. */
    seeking: () => draw(),
    /** The search ended (房间-9): its banner. @param {{ how: string, mate?: string }} m */
    sought: (m) => { if (page.key === 'match') page.c?.sought(m); draw(); },
    /** A join that came to nothing. */
    failed: () => { if (page.key === 'entry') page.c.failed(); },
    /** Before the match: the countdown and its logo, then black (at most 8 seconds). */
    start: () => Promise.race([page.key === 'prepare' ? page.c.start() : Promise.resolve(), new Promise((done) => { setTimeout(done, 8000); })]),
    /** The player's sound volume, 0–1. @param {number} v */
    volume: (v) => G.sound.volume(v),
    resume: () => G.sound.resume(),
    /** What the lobby shows, for tests. */
    state: () => ({ page: page.key, local: { ...L }, sounds: G.sound.heard(), chat: page.key === 'prepare' ? page.c?.chat?.state?.() ?? null : null }),
  };
}
