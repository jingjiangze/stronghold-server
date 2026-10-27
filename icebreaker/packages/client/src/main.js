// The battle page: the battle worker, the three.js field, the HUD, the controls, the skill bar and the deploy bar. The
// seat comes from ?seat=<n>, a room's match from ?match=<id> (docs/spec/room.md 房间-6: the seat key is the lobby key,
// and the page leads back to the room); the keys stay in sessionStorage so a reload rejoins the same seat. The match
// settings come with the server's welcome (engine spec 同步-9): the field and the decks are built once its content is
// ready. Assets come from the site's assets/skeleton/ (a local directory, AUE_ASSETS_DIR); without them the page says
// so and draws nothing — the battle runs either way. Units are Spine figures when the assets have their models
// (spine/index.json), else cards; the map is built from the level's tile kit (kits/index.json), else flat tiles. The
// player's picture settings (settings.js, 页面-1) shape the drawing only.
import { startBattle } from '@aue/worker';
import { createBattleRenderer, loadTextures, matchTextureKeys, loadSpineModels, loadDeviceMeshes, loadTileKit, loadEffectPack, createBattleAudio, leaderOf } from '@aue/render';
import { matchContent } from '@aue/content';
import { SOURCE, ROSTER, lookOf, moddedText } from './mods.js';
import { createDeck } from './deck.js';
import { createSkillBar, skillRows } from './skills.js';
import { createControls, costAskerAfter } from './controls.js';
import { matchText } from './stage.js';
import { createUi, createBattleHud, createStart, cardViews } from '@aue/ui';
import { loadUiPack, deckCards, hudState, requestsAfter, unitBars } from './battlehud.js';
import { Hand } from './gestures.js';
import { readSettings, writeSettings, createSettingsPanel, frameGate, fpsMeter } from './settings.js';
import { LOBBY_KEY, tabKey, localStore } from './session.js';
import { controlSounds } from './sound.js';
import { assetsUrl, kitsUrl, modsUrl, moduleUrl, socketUrl, pageNode } from './site.js';
import { bootCounter, bootDone, bootFail, bootStep } from './boot.js';
import { createTutorial } from './tutorial.js';
import { createSignals, loadEmoteArt } from './battlesignals.js';
import { startTurn } from './turn.js';
import { TRAINING, TRAINING_LEVELS } from '@icebreaker/mode-regular';

// a phone plays in landscape (页面-7), before anything measures the page
startTurn(/** @type {HTMLButtonElement | null} */ (document.getElementById('full')));
const ASSETS = assetsUrl();

const params = new URLSearchParams(location.search);
const seat = Math.max(0, Math.min(7, Number(params.get('seat') ?? 0) || 0));
/** A room's match (房间-6), or null on a server of one match. */
const MATCH = params.get('match');
/** ?bars: the page's own bars even when the assets have the original UI. */
const BARS = params.has('bars');
const key = MATCH ? tabKey(LOBBY_KEY) : tabKey(`ice.key.${seat}`);
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const store = localStore();
/** The player's picture settings (页面-1). */
let settings = readSettings(store);

/** @param {string} text */
function notice(text) { const n = $('notice'); n.textContent = text; n.hidden = false; }

/** @param {import('@aue/schema').View} view @param {string} net @param {string} match */
function drawHud(view, net, match) {
  $('hud').innerHTML = '';
  view.players.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = i === seat ? 'player me' : 'player';
    d.textContent = `${i === seat ? '我方' : '协作者'} · 生命 ${p.life} · 费用 ${p.cost}`;
    $('hud').append(d);
  });
  for (const [cls, text] of [['match', match], ['net', `第 ${view.frame} 帧 · ${net}`]]) {
    const n = document.createElement('div');
    n.className = cls;
    n.textContent = text;
    $('hud').append(n);
  }
}

/**
 * The local assets: their manifest, or null (and a notice) when the host has none; the textures come with the match
 * (fieldArt: only the match's, the engine's 渲染-23).
 */
async function assets() {
  const res = await fetch(new URL('manifest.json', ASSETS)).catch(() => null);
  if (!res?.ok) { notice('没有找到本地素材（主机需要设置 AUE_ASSETS_DIR）。没有贴图的东西不显示，所以战场不绘制，对局照常进行。'); return null; }
  return { manifest: /** @type {{ files: Record<string, { file: string }> }} */ (await res.json()) };
}

/**
 * The content keys of a match's units: operators by character ID — an operator a mod adds by the one it looks like
 * (页面-10) —, enemies and devices by key. @param {any} content
 */
const unitKeysOf = (content) => ({ operators: Object.entries(content.operators).map(([k, o]) => /** @type {any} */ (o).look ?? /** @type {any} */ (o).char ?? k.split('#')[0]),
  enemies: Object.keys(content.enemies), devices: Object.keys(content.devices ?? {}) });

/**
 * The Spine models of a match's operators, enemies and level devices the assets have; none without a model index.
 * @param {{ operators: Record<string, { char?: string, look?: string }>, enemies: Record<string, unknown>, devices?: Record<string, unknown> }} content
 */
async function spineModels(content) {
  const res = await fetch(new URL('spine/index.json', ASSETS)).catch(() => null);
  if (!res?.ok) return new Map();
  const ids = [...Object.entries(content.operators).map(([k, o]) => o.look ?? o.char ?? k), ...Object.keys(content.enemies), ...Object.keys(content.devices ?? {})];
  return loadSpineModels(await res.json(), new URL('spine/', ASSETS).href, ids);
}

/** The mesh models of the level's devices (the engine's 渲染-20: 堡垒守御's facilities), none without the assets' index. @param {any} content */
async function deviceMeshes(content) {
  const res = await fetch(new URL('devices/index.json', ASSETS)).catch(() => null);
  if (!res?.ok) return new Map();
  return loadDeviceMeshes(await res.json(), ASSETS.href, Object.keys(content.devices ?? {}));
}

/**
 * Levels the shipped `kits/index.json` does not map, and the theme that fits each. The assets carry 13 tile kits
 * but the index only points six levels at one of them; every other level fell back to flat unlit 128×128 tiles
 * (渲染-7's `createTerrain`). The kits below are already in the same assets package, so this is a mapping, not new art.
 *
 * The assets' own mapping wins (`...index.levels` last): if a later assets release covers these levels itself,
 * that choice replaces this table.
 */
const KIT_BY_LEVEL = Object.freeze({
  act1multi_tr01: 'map_training',
  act1multi_fortress_rm01: 'map_lungmen',
  'act1multi_fortress_hard-01': 'map_chernobog_b',
});

/** The map theme's tile kit a level uses (the engine's 渲染-7), or null when the assets have no kit index. @param {string} level */
async function tileKit(level) {
  const res = await fetch(new URL('kits/index.json', ASSETS)).catch(() => null);
  if (!res?.ok) return null;
  const index = await res.json();
  const levels = { ...KIT_BY_LEVEL, ...(index.levels ?? {}) };
  return loadTileKit({ ...index, levels }, new URL('kits/', ASSETS).href, level);
}

/** Each deck operator's skill (1-based) by its character, for its skill's own effects (the engine's 渲染-11). @param {import('@aue/schema').Match} match */
const skillSlots = (match) => Object.fromEntries((match.decks ?? []).flat().filter((d) => d.build.skill >= 0).map((d) => [lookOf(d.id.split('#')[0]), d.build.skill + 1]));

/**
 * The attack effects of a match's units (the engine's 渲染-10): the host's pack cut down to them (站点-6), or null when
 * the assets have none. @param {string[]} units
 */
async function effectPack(units) {
  const url = new URL('fx/units.json', ASSETS);
  url.searchParams.set('for', [...new Set(units)].sort().join(','));
  const res = await fetch(url).catch(() => null);
  return res?.ok ? loadEffectPack(await res.json()) : null;
}

/**
 * The page's side of a match once its content is ready: the field, the deck (own operators with an avatar only — a
 * thing without a texture is not shown) and the content for the skill bar and the HUD.
 * @param {import('@aue/schema').Match} match @param {Awaited<ReturnType<typeof assets>>} art
 * @param {() => void} changed called when the deck's selection or facing changes
 * @param {number} joined the last frame sealed when the page joined (−1 before the battle began)
 * @param {ReturnType<typeof openEarlyUi> | null} opening the original UI the page opened at once, if it did
 */
async function setUp(match, art, changed, joined, opening) {
  const content = await matchContent(match, { source: SOURCE });
  // the original UI opens first: its start panel is the loading screen while the field, the models and the effects load
  // (opened already when the room page left the stage for it)
  const early = opening ?? earlyUi(art, stageOf(match, content, joined)), artOf = fieldArt(art, match, content);
  const enemies = /** @type {Record<string, { levelType?: string, motion?: string }>} */ (/** @type {any} */ (content).enemies);
  const leaders = new Set(Object.entries(enemies).filter(([, e]) => e.levelType === 'BOSS').map(([k]) => k));
  // the flying enemies, drawn in the air (the engine's 渲染-21)
  const flyers = new Set(Object.entries(enemies).filter(([, e]) => e.motion === 'FLY').map(([k]) => k));
  // the level devices on the enemies' side (the engine's 装置-3): their bars and stand-in blocks in the enemies' colour
  const devices = /** @type {Record<string, { side?: string }>} */ (/** @type {any} */ (content).devices ?? {});
  const foeDevices = new Set(Object.entries(devices).filter(([, d]) => d.side === 'ENEMY').map(([k]) => k));
  // with the original UI the units' bars are its own (the engine's 界面-19), not the renderer's
  const opened = await early, pack = opened?.loaded ?? null;
  const { models, meshes, kit, effects, textures, backdrop } = await artOf;
  const renderer = art ? createBattleRenderer({ canvas: /** @type {HTMLCanvasElement} */ ($('field')), level: content.level, textures, view: content.level.view, models, leaders, foeDevices,
    kit, effects, backdrop, skills: skillSlots(match), seat, bars: !pack, pixelScale: settings.scale, attackEffects: settings.attackEffects, deviceMeshes: meshes, flyers }) : null;
  const avatar = (/** @type {string} */ id) => art?.manifest.files[`avatar:${lookOf(id)}`] ? new URL(art.manifest.files[`avatar:${lookOf(id)}`].file, ASSETS).href : null;
  const ops = (content.decks?.[seat] ?? []).map((k) => ({ id: k, name: content.operators[k].name, avatar: avatar(content.operators[k].char ?? k) }))
    .filter((o) => o.avatar !== null).map((o) => ({ ...o, avatar: /** @type {string} */ (o.avatar) }));
  const ui = renderer && opened ? originalUi(match, content, avatar, opened) : null;
  // a level being tested (房间-13, the engine's 关卡-8): its enemies' abilities not all there yet
  $('testing').hidden = !(/** @type {any} */ (content.level).uncovered?.length > 0);
  // a host with mods (页面-10): the match is marked
  const modded = moddedText();
  $('modded').hidden = modded === null;
  $('modded').textContent = modded ?? '';
  return { content, renderer, deck: ui ? null : createDeck($('deck'), ops, changed), ui, match, leaders, foeDevices, early: joined < 0, avatar };
}

/**
 * What the field draws with from the assets, loaded at once: the match's textures (the engine's 渲染-23), the units'
 * Spine models, the devices' meshes, the map theme's kit, the units' attack effects; none without the assets.
 * @param {Awaited<ReturnType<typeof assets>>} art @param {import('@aue/schema').Match} match @param {any} content
 */
/**
 * The battle's backdrop: the game's own blurred arena picture — the lobby's background art
 * (`ui/lobby/BG_176ce236.webp`, 1559×960). The assets' manifest does not list that file, so it is fetched by path;
 * no assets, or a failed fetch, leaves the renderer's built-in gradient in place.
 */
async function backdropArt() {
  const one = { files: { backdrop: { file: 'ui/lobby/BG_176ce236.webp' } } };
  const loaded = await loadTextures(one, ASSETS.href).catch(() => null);
  return loaded?.get('backdrop') ?? null;
}

/**
 * What the field draws with from the assets, loaded at once: the match's textures (the engine's 渲染-23), the units'
 * Spine models, the devices' meshes, the map theme's kit, the units' attack effects, the backdrop; none without the assets.
 * @param {Awaited<ReturnType<typeof assets>>} art @param {import('@aue/schema').Match} match @param {any} content
 */
async function fieldArt(art, match, content) {
  if (!art) return { models: new Map(), meshes: new Map(), kit: null, effects: null, textures: new Map(), backdrop: null };
  const units = unitKeysOf(content), part = bootCounter('正在载入干员、敌人与赛场', 0.55, 0.98, 5);
  const each = (/** @type {Promise<any>} */ p) => p.finally(part);
  const [textures, models, meshes, kit, effects, backdrop] = await Promise.all([each(loadTextures(art.manifest, ASSETS.href, matchTextureKeys(content.level, units))),
    each(spineModels(content)), each(deviceMeshes(content)), each(tileKit(match.level)), each(effectPack([...units.operators, ...units.enemies, ...units.devices])),
    each(backdropArt())]);
  return { models, meshes, kit, effects, textures, backdrop };
}

/**
 * The stage a match's start panel shows (the engine's 界面-21): in a match of two joined before it began, the level's
 * code and name; else none. @param {import('@aue/schema').Match} match @param {any} content @param {number} joined
 */
function stageOf(match, content, joined) {
  const lv = content.level;
  return joined < 0 && (match.decks?.length ?? 1) === 2 && lv.code ? { code: lv.code, name: lv.name ?? '' } : null;
}

/** The original UI to open with the assets and no pages' bars, else none. @param {Awaited<ReturnType<typeof assets>>} art @param {{ code: string, name: string } | null} stage */
const earlyUi = (art, stage) => (art && !BARS ? openEarlyUi(stage) : Promise.resolve(null));

/**
 * The original battle UI opened before the rest loads (the engine's 界面-21), when the assets have its pack, else null:
 * given a stage (a match of two joined before it began), its start panel with the stage's code and name over the page
 * — the original's loading screen — played on its own clock until the page's loop takes over.
 * @param {{ code: string, name: string } | null} stage
 */
async function openEarlyUi(stage) {
  bootStep('正在载入战斗界面', 0.32);
  const loaded = await loadUiPack(ASSETS);
  if (!loaded) return null;
  const ui = createUi({ pack: loaded.pack, host: $('ui'), base: new URL('ui/', ASSETS).href });
  const start = stage ? createStart(ui, stage) : null;
  const field = $('field');
  ui.resize(field.clientWidth, field.clientHeight);
  let at = performance.now(), on = true;
  const loop = (/** @type {number} */ now) => { if (!on) return; ui.tick(Math.min(0.1, (now - at) / 1000)); at = now; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  await ui.load(bootCounter('正在载入战斗界面', 0.35, 0.5, Object.keys(loaded.pack.sprites).length));
  // the original's own loading screen, the start panel, takes over (the engine's 界面-21)
  if (start) bootDone();
  return { loaded, ui, start, stop: () => { on = false; } };
}

/**
 * The original battle UI over the field (the engine's 界面-10…14) on the UI opened early: the HUD, with the start panel
 * already showing (界面-21); the early clock stops for the page's loop.
 * @param {import('@aue/schema').Match} match @param {any} content @param {(id: string) => string | null} avatar
 * @param {NonNullable<Awaited<ReturnType<typeof openEarlyUi>>>} opened
 */
function originalUi(match, content, avatar, opened) {
  const { ui, loaded, start } = opened, base = new URL('ui/', ASSETS).href;
  const deck = deckCards(match, content, seat, avatar, ROSTER);
  const hud = createBattleHud(ui, { deck, coop: (match.decks?.length ?? 1) > 1, start });
  opened.stop();
  document.body.classList.add('original-ui');
  return { ui, hud, deck, icons: loaded.icons, iconBase: new URL('skills/', base).href };
}

let markSeq = 0;

/**
 * The deploy highlight and the range (engine 渲染-8, 渲染-9) for the deck's selection and the pointer's tile, as the
 * worker works them out from its world; only the latest answer is shown.
 * @param {Awaited<ReturnType<typeof setUp>> | null} game @param {{ row: number, col: number } | null} pointer
 * @param {ReturnType<typeof startBattle>['marks']} marks
 */
function markField(game, pointer, marks) {
  const r = game?.renderer;
  if (!game || !r || !game.deck) return;
  const sel = game.deck.selected(), seq = ++markSeq;
  marks({ op: sel?.op ?? null, dir: sel?.dir ?? 0, tile: pointer }).then((m) => {
    if (seq !== markSeq) return;
    r.highlight(sel ? m.deployable : null);
    r.range(m.range ? m.range.keys : null, m.range?.heal);
  });
}

/**
 * The page's state: the match's side once ready, the connection, the speed and pause state, the last frame, the
 * content keys of the units seen, the pointer's tile, the original UI's state and hand.
 * @typedef {{ game: Awaited<ReturnType<typeof setUp>> | null, net: string, costAsker: number, players: number,
 *   control: import('./controls.js').Control | null, lastView: import('@aue/schema').View | null, unitKeys: Map<number, string>,
 *   pointer: { row: number, col: number } | null, hudNow: import('@aue/ui').HudState | null, hand: Hand | null,
 *   requests: import('./battlehud.js').Requests, audio: Awaited<ReturnType<typeof createBattleAudio>>, music: boolean, stamps: number[],
 *   battle: ReturnType<typeof startBattle>, mark: () => void, skills: ReturnType<typeof createSkillBar>, bar: () => void,
 *   panel: ReturnType<typeof createSettingsPanel> | undefined, tutorial: ReturnType<typeof createTutorial> | null, signals: ReturnType<typeof createSignals> | null }} Page
 */

/** Where the room page leaves the stage of the match it sends the page to, for the loading screen at once (页面-6). */
const LOADING_KEY = 'ice.loading';

/** The stage the room page left for this match, once (a reload has none), or null. @returns {{ code: string, name: string } | null} */
function takeLoading() {
  try {
    const raw = sessionStorage.getItem(LOADING_KEY);
    sessionStorage.removeItem(LOADING_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && v.match === MATCH && typeof v.code === 'string' && typeof v.name === 'string' ? { code: v.code, name: v.name } : null;
  } catch { return null; }
}

async function main() {
  // straight from the room: the loading screen opens before anything loads (页面-6, the engine's 界面-21)
  const loading = BARS ? null : takeLoading(), opening = loading ? openEarlyUi(loading) : null;
  const art = await assets();
  bootStep('正在连接对局', 0.52);
  /** @type {Page} */
  const P = /** @type {any} */ ({ game: null, net: '连接中', costAsker: -1, players: 1, control: null, lastView: null, unitKeys: new Map(), pointer: null, hudNow: null, hand: null,
    requests: { answer: null, pauseSince: -1, now: 0 }, audio: null, music: false, stamps: [], tutorial: null, signals: null });
  if (art) void startAudio(P);
  P.mark = () => markField(P.game, P.pointer, (q) => P.battle.marks(q));
  $('fps').hidden = !settings.showFps;
  P.panel = createSettingsPanel($('settings'), settings, (s) => {
    settings = s;
    writeSettings(store, s);
    P.game?.renderer?.setPixelScale(s.scale);
    P.game?.renderer?.setAttackEffects(s.attackEffects);
    $('fps').hidden = !s.showFps;
    P.audio?.volumes(s);
    P.audio?.dub(s.dub || null);
    prepareVoices(P);
  });
  P.skills = createSkillBar($('skills'), (id) => P.battle.command({ type: 'skill', unit: id }), (id) => P.battle.command({ type: 'retreat', unit: id }));
  /** @type {Record<string, () => void>} */
  const acts = {
    'speed-on': () => P.battle.speed(true), 'speed-off': () => P.battle.speed(false), pause: () => P.battle.pause(), resume: () => P.battle.resume(),
    'pause-yes': () => P.battle.pauseReply(true), 'pause-no': () => P.battle.pauseReply(false), ask: () => P.battle.command({ type: 'ask' }),
    'cost-yes': () => P.battle.command({ type: 'answer', accept: 1 }), 'cost-no': () => P.battle.command({ type: 'answer', accept: 0 }),
  };
  const controls = createControls($('controls'), (a) => acts[a]?.());
  P.bar = () => controls({ control: P.control, costAsker: P.costAsker, seat, mate: P.players === 2 ? 1 - seat : -1 });
  P.battle = startBattle({
    workerUrl: moduleUrl('@aue/worker/src/worker.js'),
    // the battle is on its room's node (站点-6): the page's `server` when the room was on another one
    wsUrl: socketUrl(`battle?${MATCH ? `match=${encodeURIComponent(MATCH)}&` : ''}seat=${seat}`, location.href, pageNode()),
    seat, key, kits: kitsUrl(), mods: modsUrl(),
    onFrame: (view, events, keys, status) => onFrame(P, { view, events, keys, status }),
    onNet: (s) => {
      P.net = s.state === 'open' || s.state === 'match' ? '已连接' : s.state === 'closed' ? '重连中' : `消息有误：${s.reason}`;
      // loaded: the server may begin the battle (the engine's 同步-11)
      if (s.state === 'match' && s.match && !P.game) {
        setUp(s.match, art, () => P.mark(), s.frame ?? -1, opening).then((g) => { P.game = g; start(P, g); bootDone(); prepareVoices(P); P.battle.ready(); }, (e) => {
          const why = e instanceof Error ? e.message : String(e);
          notice(`出错了：${why}`);
          bootFail(`载入对局失败：${why}。刷新页面重试`);
        });
      }
    },
    onControl: (c) => { for (const bank of controlSounds(P.control, c, seat)) void P.audio?.play(bank); P.control = c; P.bar(); },
    onSignal: (from, s) => P.signals?.onSignal(from, s),
  });
  // for end-to-end tests and the console
  const b = P.battle;
  Object.assign(globalThis, { __battle: { seat, debug: b.debug, command: b.command, speed: b.speed, ready: () => P.game !== null, ui: () => (P.game?.ui ? 'original' : 'bars'),
    sound: () => ({ banks: P.audio ? Object.keys(P.audio.index.banks).length : 0, music: P.music, voices: P.audio?.voices ? Object.keys(P.audio.voices.chars).length : 0,
      said: P.audio?.said() ?? [] }) } });
}

/**
 * The page's sound (页面-4): the audio of the assets (none without its index) and their voices at the player's
 * volumes and dub, let sound from the first touch or key. @param {Page} P
 */
async function startAudio(P) {
  P.audio = await createBattleAudio({ base: new URL('audio/', ASSETS).href, voiceBase: new URL('voice/', ASSETS).href }).catch(() => null);
  P.audio?.volumes(settings);
  P.audio?.dub(settings.dub || null);
  P.panel?.dubs(P.audio?.voices?.dubs ?? []);
  prepareVoices(P);
  const resume = () => { void P.audio?.resume(); };
  addEventListener('pointerdown', resume);
  addEventListener('keydown', resume);
}

/** Loads the lines of this seat's operators in their dubs (页面-4), once the audio and the match are both here. @param {Page} P */
function prepareVoices(P) {
  if (P.audio?.voices && P.game) void P.audio.prepare((P.game.content.decks?.[seat] ?? []).map((k) => lookOf(k.split('#')[0])));
}

/**
 * A frame's sound (页面-4, engine 音频-2, 音频-3): its events' banks; the level's music from the first frame of the battle
 * until it ends; none before the match's side is ready or without audio. @param {Page} P @param {{ view: import('@aue/schema').View, events: Record<string, string | number>[] }} f
 */
function frameSound(P, f) {
  const audio = P.audio, game = P.game;
  if (!audio || !game) return;
  const level = /** @type {any} */ (game.content.level);
  audio.frame(f.events, { keyOf: (id) => P.unitKeys.get(id), operators: /** @type {any} */ (game.content.operators), enemies: /** @type {any} */ (game.content).enemies, seat, stages: level.stages?.length ?? 0 });
  if (!P.music && f.view.frame >= 0) {
    P.music = true;
    void audio.startMusic(level.bgm);
    // the battle's start, said by the deck's leader (engine 音频-5) on a page that was there when it began
    const leader = audio.voices && game.early ? leaderOf(audio.voices, (game.content.decks?.[seat] ?? []).map((k) => lookOf(k.split('#')[0]))) : null;
    if (leader) void audio.say(leader, 'BATTLE_START');
  }
  if (f.events.some((e) => e['type'] === 'end')) audio.stopMusic();
}

/**
 * A frame: the field, the HUD line, and the original UI (or the page's bars).
 * @param {Page} P @param {{ view: import('@aue/schema').View, events: Record<string, string | number>[], keys: Record<string, string>, status: import('@aue/worker').Status }} f
 */
function onFrame(P, f) {
  const { view, events, status } = f, game = P.game;
  const end = events.find((e) => e['type'] === 'end');
  stampsOf(P.stamps, events);
  if (end && MATCH) ended(Number(end['result']), P, status);
  for (const [id, k] of Object.entries(f.keys)) P.unitKeys.set(Number(id), k);
  tutorialFrame(P.tutorial, f, end !== undefined);
  frameSound(P, f);
  P.players = view.players.length;
  P.costAsker = costAskerAfter(P.costAsker, events);
  drawField(P, f);
  drawHud(view, P.net, matchText(status, /** @type {any} */ (game?.content.level)?.stages ?? [], view.frame));
  if (game?.ui) {
    P.requests = requestsAfter(P.requests, { events, control: P.control, seat, frame: view.frame, now: performance.now() });
    const level = /** @type {any} */ (game.content.level);
    P.hudNow = hudState({ view, status, control: shownControl(P), seat, options: level.options, selected: P.hand?.selected() ?? null, stages: level.stages, waves: level.waves.length, requests: P.requests,
      offline: P.net === '重连中', training: TRAINING_LEVELS.includes(level.id) });
    const r = /** @type {NonNullable<typeof game.renderer>} */ (game.renderer), k = game.ui.ui.canvas.k;
    P.hudNow.units = unitBars(view, { leaders: game.leaders, foeDevices: game.foeDevices, keyOf: (id) => P.unitKeys.get(id)?.split('#')[0], shows: (id) => r.shows(id),
      at: (u) => r.barsAt(u).map((v) => v / k), operators: game.content.operators, unitKey: (id) => P.unitKeys.get(id), seat });
    game.ui.hud.update(P.hudNow);
    P.hand?.frame(view);
  } else {
    P.mark();
    if (game) P.skills.update(skillRows(view, P.unitKeys, seat, game.content.operators));
  }
  P.bar();
  P.lastView = view;
}

/**
 * The field of a frame: 堡垒守御's facilities at their levels (the engine's 渲染-20); every key seen so far — units that
 * appeared before the renderer was ready get their figures too.
 * @param {Page} P @param {{ view: import('@aue/schema').View, events: Record<string, string | number>[], status: import('@aue/worker').Status }} f
 */
function drawField(P, f) {
  const r = P.game?.renderer;
  if (!r) return;
  if (f.status.fortress) r.levels(f.status.fortress.levels);
  const ops = /** @type {Record<string, { look?: string }>} */ (P.game?.content.operators ?? {});
  r.update(f.view, Object.fromEntries([...P.unitKeys].map(([id, k]) => [id, ops[k]?.look ?? k.split('#')[0]])), f.events);
}

/** The control state the battle UI shows: a training's script holding the battle is not the player's pause (房间-11). @param {Page} P */
const shownControl = (P) => (P.tutorial?.holding() && P.control ? { ...P.control, held: 0 } : P.control);

/**
 * A frame for a training's tutorials (房间-11, engine 波次-8): its stories, the frame, the end; nothing outside a training.
 * @param {Page['tutorial']} t @param {{ view: import('@aue/schema').View, events: Record<string, string | number>[] }} f @param {boolean} end
 */
function tutorialFrame(t, f, end) {
  if (!t) return;
  for (const e of f.events) if (e['type'] === 'story') t.story(String(e['key']));
  t.frame(f.view.frame);
  if (end) t.end();
}

/** Each stage's stamps as it settles (engine 合作-6), for the room's result view (页面-6). @param {number[]} stamps @param {Record<string, string | number>[]} events */
function stampsOf(stamps, events) {
  for (const e of events) if (e['type'] === 'stage' && Number(e['on']) === 0) stamps[Number(e['index'])] = Number(e['stamps']);
}

/**
 * The field's last frame, small and blurred, for the room's result view to show behind its panels as the original's
 * blurred battle (页面-6): a JPEG data URL, or null. @param {Page} P
 */
function lastFrame(P) {
  const r = P.game?.renderer, field = /** @type {HTMLCanvasElement} */ ($('field'));
  if (!r || !field.width) return null;
  try {
    // the field's drawing is read in the same task it is drawn
    r.render();
    const c = document.createElement('canvas'), x = c.getContext('2d');
    if (!x) return null;
    c.width = 640; c.height = Math.round((640 * field.height) / field.width);
    x.filter = 'blur(6px)';
    x.drawImage(field, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch { return null; }
}

/**
 * A room's match ended (房间-6): the result and the way back to the room; the result kept for the room's result view
 * (页面-6), with the field's last frame — in 堡垒守御 the stamps of the waves defended, and those waves and the last
 * wave's damage (the engine's 守御-1). @param {number} result 1: won, 0: lost @param {Page} P @param {import('@aue/worker').Status} status
 */
function ended(result, P, status) {
  notice(`比赛结束：${result === 1 ? '胜利' : '失败'}。`);
  const level = /** @type {any} */ (P.game?.content.level)?.id ?? '', bg = lastFrame(P), f = status.fortress, difficulty = P.game?.match.difficulty ?? 'NORMAL';
  const stamps = f ? [f.stamps] : [...P.stamps].map((x) => x ?? 0), fortress = f ? { defended: f.defended, damage: Math.floor(f.damage) } : undefined;
  try { sessionStorage.setItem('ice.result', JSON.stringify({ match: MATCH, result, level, difficulty, stamps, fortress, at: Date.now() })); } catch { /* the room shows no result */ }
  try { if (bg) sessionStorage.setItem('ice.result.bg', bg); } catch { /* the result shows without it */ }
  const back = document.createElement('a');
  back.href = 'room';
  back.className = 'back';
  back.textContent = TRAINING_LEVELS.includes(level) ? '返回训练场' : '返回房间';
  $('notice').append(' ', back);
}

/** The match's side is ready: its input, its resize, its render loop. @param {Page} P @param {Awaited<ReturnType<typeof setUp>>} g */
function start(P, g) {
  if (!g.renderer) return;
  const renderer = g.renderer, field = /** @type {HTMLCanvasElement} */ ($('field'));
  P.tutorial = TRAINING_LEVELS.includes(/** @type {any} */ (g.content.level).id) ? tutorialOn(P, g, field) : null;
  // marks and battle emotes between the two seats (房间-12)
  if ((g.match.decks?.length ?? 1) === 2) void loadEmoteArt(ASSETS).then((emotes) => { P.signals = createSignals({ ui: g.ui?.ui ?? null, renderer, signal: (s) => P.battle.signal(s), seat, width: g.content.level.width, view: () => P.lastView, emotes }); });
  if (g.ui) P.hand = startOriginal(P, g, renderer, field);
  else startBars(P, g, renderer, field);
  // for end-to-end tests and measuring: where a point of the field is on the page; what the renderer and the UI hold
  Object.assign(/** @type {any} */ (globalThis).__battle, { pageOf: (/** @type {number} */ col, /** @type {number} */ row, /** @type {number} */ h) => {
    const p = renderer.screenOf(col, row, h), r = field.getBoundingClientRect();
    return [r.left + p[0], r.top + p[1]];
  }, stats: () => ({ ...renderer.stats(), uiNodes: g.ui ? g.ui.ui.screens.reduce((n, s) => n + s.all.length, 0) : 0 }), signals: () => P.signals?.state() ?? null });
  const fit = () => { renderer.resize(); g.ui?.ui.resize(field.clientWidth, field.clientHeight); };
  addEventListener('resize', fit);
  fit();
  let at = performance.now();
  /** milliseconds a frame spends drawing the field and laying the UI out (averaged), for measuring */
  const cost = { field: 0, ui: 0 };
  const gate = frameGate(() => settings.fpsCap), meter = fpsMeter(), fps = $('fps');
  const loop = (/** @type {number} */ now) => {
    if (!gate(now)) { requestAnimationFrame(loop); return; }
    if (settings.showFps) fps.textContent = `${meter(now)} 帧/秒`;
    const t0 = performance.now();
    P.signals?.frame();
    renderer.render();
    const t1 = performance.now();
    g.ui?.ui.tick(Math.min(0.1, (now - at) / 1000));
    const t2 = performance.now();
    cost.field += (t1 - t0 - cost.field) * 0.05; cost.ui += (t2 - t1 - cost.ui) * 0.05;
    at = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  /** @type {any} */ (globalThis).__battle.cost = () => ({ field: +cost.field.toFixed(2), ui: +cost.ui.toFixed(2) });
}

/**
 * A training's tutorials over the field (房间-11): its scripts and their variables, the battle's pause and resume, the
 * speaker's head (its avatar), the battle UI's nodes by name (the first one shown). @param {Page} P
 * @param {Awaited<ReturnType<typeof setUp>>} g @param {HTMLCanvasElement} field
 */
function tutorialOn(P, g, field) {
  const rectOf = (/** @type {string} */ name) => {
    for (const el of document.querySelectorAll(`#ui [data-name="${CSS.escape(name)}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return r;
    }
    return null;
  };
  return createTutorial($('app'), field, { stories: TRAINING.stories, vars: TRAINING.vars, pause: () => P.battle.pause(), resume: () => P.battle.resume(),
    held: () => !!P.control?.held, frame: () => P.lastView?.frame ?? 0, head: (char) => g.avatar(char), rectOf });
}

/**
 * The original UI's taps: speed, pause or resume (同步-7, 同步-8), and the hand on the field (gestures.js).
 * @param {Page} P @param {Awaited<ReturnType<typeof setUp>>} g @param {any} renderer @param {HTMLCanvasElement} canvas
 */
function startOriginal(P, g, renderer, canvas) {
  const o = /** @type {NonNullable<typeof g.ui>} */ (g.ui), b = P.battle;
  o.hud.on('speed', () => b.speed(P.control?.fast[seat] !== 1));
  o.hud.on('pause', () => (P.control?.held ? b.resume() : b.pause()));
  o.hud.on('ask', () => b.command({ type: 'ask' }));
  // 「跳过休整」 (the engine's 守御-2, 界面-39)
  o.hud.on('rest', () => b.command({ type: 'rest' }));
  o.hud.on('answer', (/** @type {string | undefined} */ v) => b.command({ type: 'answer', accept: v === 'yes' ? 1 : 0 }));
  o.hud.on('confirm', (/** @type {string | undefined} */ v) => b.pauseReply(v === 'yes'));
  const usable = (/** @type {string} */ id) => !!P.hudNow && cardViews(o.deck, P.hudNow).some((v) => v.id === id && v.usable);
  // a deployment is what a training's drag waits for (房间-11)
  const battle = { ...b, command: (/** @type {import('@aue/schema').Command} */ c) => { if (c.type === 'deploy') P.tutorial?.putDown(); b.command(c); } };
  return new Hand({ canvas, renderer, hud: o.hud, battle, level: g.content.level, seat, content: g.content, icons: o.icons, iconBase: o.iconBase,
    view: () => P.lastView, usable, unitKey: (id) => P.unitKeys.get(id), focus: (key) => { void P.audio?.say(lookOf(key.split('#')[0]), 'FOCUS_CHAR'); } });
}

/**
 * The page's own bars: a tile click deploys the deck's selection; the pointer's tile shows its marks.
 * @param {Page} P @param {Awaited<ReturnType<typeof setUp>>} g @param {any} renderer @param {HTMLCanvasElement} field
 */
function startBars(P, g, renderer, field) {
  field.addEventListener('click', (e) => {
    const tile = renderer.pick(e.clientX, e.clientY), sel = g.deck?.selected();
    if (tile && sel) { P.battle.command({ type: 'deploy', op: sel.op, row: tile.row, col: tile.col, dir: sel.dir }); P.tutorial?.putDown(); g.deck?.clear(); }
  });
  field.addEventListener('pointermove', (e) => { P.pointer = renderer.pick(e.clientX, e.clientY); P.mark(); });
  field.addEventListener('pointerleave', () => { P.pointer = null; P.mark(); });
}

main().catch((e) => notice(`出错了：${e instanceof Error ? e.message : String(e)}`));
