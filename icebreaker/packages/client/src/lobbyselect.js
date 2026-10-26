// The operator select page (docs/spec/page.md 页面-9): the main game's operator select state over the squad page, opened
// by its 快捷编队 buttons for one list of the 常规队. Every operator stands as the game's common card in two rows — only
// the columns in view are built, the grid's padding keeping the others' place —, sorted by level or rarity (a second
// tap turns the order round). The profession bar at the right filters by profession and, in the chosen one's list,
// by branch; 稀有度筛选 opens the sort panel as the rarity filter. A tap on a card chooses it (its number in the list on
// it) or lets it go; an operator of the other list carries the mark 编队内已选择 and moves when chosen. The card last
// tapped shows on the left: name, level, attributes, range, its skills and its branch. 清空选择 empties the list,
// 确认 keeps it. The state fades in with its clip; the filter shows with its, the profession bar and the branch list
// switch with theirs.
import { scrollOf, scrollTo } from '@aue/ui';
import { statsAt, textPair } from '@aue/content';
import { Part, openPart, closePart, place, unplace, fillList, placeTopMenu, PICTURE } from './lobbykit.js';
import { rowsOf, filtered, sorted, firstOf, tapped, branchesOf, maxLevelOf, gameRich, PROFESSIONS } from './selectlist.js';

/** @typedef {import('./selectlist.js').Row} Row @typedef {import('@aue/content').Training} Training */
/** @typedef {import('@icebreaker/mode-regular').BoxEntry} BoxEntry */
/**
 * @typedef {object} SelectOptions
 * @property {'high' | 'low'} list the 常规队's list being chosen
 * @property {number} max how many it holds
 * @property {readonly string[]} chosen its operators now
 * @property {readonly string[]} other the other list's
 * @property {Readonly<Record<string, { name: string, rarity: number, profession: string, branch: string }>>} roster
 * @property {(id: string) => BoxEntry | null} entry the box's entry
 * @property {(id: string) => Promise<Training>} training
 * @property {import('./lobbycards.js').CardArt} cards
 * @property {any} art the lobby pack's art (the cards' pictures by rarity, the filter's glyphs, the branches, the attribute icons)
 * @property {(ids: string[]) => void} confirm keeps the list
 * @property {(text: string) => void} toast
 * @property {() => void} back @property {() => void} home
 */

/** The page's prefab. */
export const SELECT_STATE = 'charselect/dyn_char_select_state';
const STATE = SELECT_STATE, CELL = 'charselect/dyn_panel_char_selection_card', CARD = 'common/panel_char_card';
const SORT_BAR = 'charselect/dyn_panel_char_sort_custom', FILTER = 'charselect/dyn_char_sort_filter_panel', PROF_FILTER = 'charselect/profession_filter';
const PROF_ITEM = 'charselect/prof_item', SUBPROF_ITEM = 'charselect/subprof_item', SORT_ITEM = 'charselect/dyn_panel_custom_sort_item';
const TAG_TEXT = 'charselect/dyn_skill_tag_text', TAG_TIME = 'charselect/dyn_skill_tag_time', TALENT = 'charselect/dyn_panel_char_talent_item';
const PLUGIN = 'charselect/dyn_panel_squad_select_plugin';
const GRID = '@panel_card_list/panel_card_grid', LIST = '@panel_card_list';
/** The profession filter's colours of the chosen item and the others (its items' own). */
const BLUE = [0, 0.6941, 1, 1], GREY = [0.5216, 0.5216, 0.5216, 1];
/** The lists' names on the mark of an operator in the other one. */
const LIST_NAMES = { high: '高顺位', low: '低顺位' };
/** The stars' nodes on the common card, one to six. */
const STARS = ['image_one', 'image_two', 'image_three', 'image_four', 'image_five', 'image_six'];
/** The rarity filter's rows, from six stars down. */
const RARITIES = [6, 5, 4, 3, 2, 1];
/** A '#rrggbb' colour as 0–1 channels with full alpha. @param {string} c */
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).concat(1);

/**
 * A skill's tags: its SP type and its trigger, each its colour (攻击回复 the tag prefab's own; the others as PRTS shows
 * the game's). A passive skill has no SP type tag.
 */
const SP_TAGS = /** @type {Record<string, [string, number[]]>} */ ({ INCREASE_WITH_TIME: ['自动回复', hex('#8EC31F')], INCREASE_WHEN_ATTACK: ['攻击回复', hex('#FD7A3F')],
  INCREASE_WHEN_TAKEN_DAMAGE: ['受击回复', hex('#F4AF09')] });
const TRIGGER_TAGS = /** @type {Record<string, [string, number[]]>} */ ({ MANUAL: ['手动触发', hex('#808080')], AUTO: ['自动触发', hex('#808080')], PASSIVE: ['被动', hex('#808080')] });

/**
 * The page's state: its parts, the rows, the list shown, the operators chosen, the sort, the filter, the operator
 * looked at (and how many times one was), the detail's tab, the grid's first column built and its columns, each cell's
 * card, what the grid shows (drawn again when it changes), the sort bar, the filter panel and its profession filter,
 * whether the profession bar, the branch list and the rarity filter are open (and were when last drawn).
 * @typedef {{ p: Part, O: SelectOptions, rows: Row[], shown: Row[], chosen: string[], sort: import('./selectlist.js').Sort,
 *   filter: import('./selectlist.js').Filter, look: string | null, looked: number, tab: 'skill' | 'branch', first: number, pool: number,
 *   cards: Map<import('@aue/ui').UiNode, Part>, drawn: string, bar: Part | null, panel: Part | null, prof: Part | null,
 *   profOpen: boolean, subOpen: boolean, rarity: boolean, was: { prof?: boolean, sub?: boolean }, cursorSet?: boolean }} Sel
 */

/** The page. @param {any} ui @param {SelectOptions} O */
export function createCharSelect(ui, O) {
  const p = openPart(ui, STATE, 40), f = p.view();
  /** @type {Sel} */
  const S = { p, O, rows: rowsOf(O.roster, O.entry), shown: [], chosen: [...O.chosen], sort: { by: 'level', up: false },
    filter: { profession: null, branch: null, rarities: [] }, look: null, looked: 0, tab: 'skill', first: -1, pool: 0, cards: new Map(), drawn: '',
    bar: null, panel: null, prof: null, profOpen: true, subOpen: false, rarity: false, was: {} };
  placeTopMenu(p, f.topMenuHolder ?? '@panel_top_menu', { back: O.back, home: O.home });
  for (const r of ['@panel_sort_wrapper/star_mark_item_container', '@panel_predefined_tips', '@panel_attr_scroll/panel_attrs/panel_top_info/info_button']) p.show(r, false);
  ownGrid(p);
  S.bar = place(p, '@panel_sort_wrapper/sort_panel_container', SORT_BAR);
  openFilter(S);
  p.tap('@panel_bottom_btn_group/btn_clear/panel_hotspot', () => { S.chosen = []; redraw(S); });
  p.tap('@panel_bottom_btn_group/btn_confirm/panel_hotspot', () => O.confirm([...S.chosen]));
  for (const [i, tab] of /** @type {const} */ (['skill', 'branch']).entries()) p.tap(f.tabItems?.[i] ?? `@panel_attr_scroll/panel_attrs/layout_info_tab/${tab}_title`, () => { S.tab = tab; drawTabs(S); });
  relist(S);
  drawDetail(S);
  void p.anim(f.fadeInAnim);
  p.scr.ctx.tickers?.add({ scr: p.scr, step: (dt) => { drawGrid(S); moveCursor(S, dt); slideSort(S, dt); } });
  return {
    part: p,
    /** The page's back: closes the rarity filter first; false when there is nothing to close. */
    back: () => { if (!S.rarity) return false; S.rarity = false; drawRarity(S); return true; },
    close: () => closePart(p),
    /** What the page shows, for tests. */
    state: () => ({ shown: S.shown.map((r) => r.id), chosen: [...S.chosen], sort: { ...S.sort }, filter: { ...S.filter, rarities: [...S.filter.rarities] }, look: S.look, first: S.first, pool: S.pool }),
  };
}

/** The card grid's own copy of its grid (the page moves its padding), so the pack's prefab stays as it is. @param {Part} p */
function ownGrid(p) {
  const g = p.node(GRID);
  if (!g?.n.comps.grid) return;
  const grid = g.n.comps.grid;
  g.n = { ...g.n, comps: { ...g.n.comps, grid: { ...grid, pad: [...grid.pad], base: [...grid.pad] } } };
}

/** The list shown again (a new filter or sort): from its start. @param {Sel} S */
function relist(S) {
  // the list's operators of when the page opened stay first, as the game's squad select keeps the squad's
  S.shown = firstOf(sorted(filtered(S.rows, S.filter), S.sort), S.O.chosen);
  const list = S.p.node(LIST);
  if (list) scrollTo(list, 0, 0);
  S.p.show('@panel_card_list/panel_no_card', !S.shown.length);
  redraw(S);
  drawSortBar(S);
}

/** Everything drawn again on the next frame. @param {Sel} S */
function redraw(S) { S.drawn = ''; }

/**
 * The grid's columns in view (two operators a column), built from the pool: the grid's left padding stands for the
 * columns before them, its right padding for those after, so the scroll view keeps the whole list's width.
 * @param {Sel} S
 */
function drawGrid(S) {
  const g = S.p.node(GRID), list = S.p.node(LIST), grid = g?.n.comps.grid;
  if (!g || !list || !grid) return;
  const rows = Math.max(1, grid.count), pitch = grid.cell[0] + grid.spacing[0], total = Math.ceil(S.shown.length / rows);
  const pool = Math.ceil((list.w || 1600) / pitch) + 2, scrolled = -scrollOf(list)[0];
  const first = Math.max(0, Math.min(Math.floor((scrolled - grid.base[0]) / pitch), total - pool));
  const key = `${first}|${pool}|${S.chosen.join(',')}|${S.shown.length}|${S.looked}`;
  if (key === S.drawn) return;
  S.drawn = key; S.first = first; S.pool = pool;
  const items = S.shown.slice(first * rows, (first + pool) * rows), cols = Math.ceil(items.length / rows);
  grid.pad[0] = grid.base[0] + first * pitch;
  grid.pad[1] = grid.base[1] + Math.max(0, total - first - cols) * pitch;
  fillList(S.p, GRID, items.length, (cell, i) => drawCell(S, cell, items[i]), CELL);
}

/** A cell: the common card (built once a cell), its number when chosen, the other list's mark. @param {Sel} S @param {Part} cell @param {Row} r */
function drawCell(S, cell, r) {
  const f = cell.view();
  let card = S.cards.get(cell.root);
  if (!card || card.root.gone) {
    const at = cell.node(f.characterContainer ?? '@panel_char_card_container');
    if (!at) return;
    const root = S.p.scr.instantiate(at, CARD);
    const k = f.charCardScaler ?? 0.87;
    root.rt.scale = [k, k];
    card = new Part(S.p.ui, S.p.scr, root, CARD);
    S.cards.set(cell.root, card);
  }
  const c = card;
  fillCommonCard(c, r, S.O);
  const n = S.chosen.indexOf(r.id);
  cell.show(f.panelSelected ?? '@panel_selection', n >= 0);
  if (n >= 0) cell.text(f.selectOrder ?? '@panel_selection/label_select_order', String(n + 1));
  const other = S.O.other.includes(r.id) && n < 0;
  const mark = other ? place(cell, f.maskPluginContainer ?? '@panel_mask_plugin_container', PLUGIN) : null;
  if (mark) {
    const m = mark.view();
    mark.show(m.panelBlock, false);
    mark.text(m.textName, LIST_NAMES[S.O.list === 'high' ? 'low' : 'high']);
  } else unplace(cell, f.maskPluginContainer ?? '@panel_mask_plugin_container');
  c.tap('@', () => tap(S, r.id));
}

/**
 * The game's common card of an operator: its rarity's background, light, hubs and stars, its profession, half-length
 * portrait, level (the ring full at its top level), elite phase, potential from the second on, name.
 * @param {Part} c @param {Row} r @param {SelectOptions} O
 */
export function fillCommonCard(c, r, O) {
  const card = O.art?.card, k = Math.min(6, Math.max(1, r.rarity)) - 1;
  if (card) {
    c.sprite('@image_bkg', card.bg[k]); c.sprite('@img_light', card.light[k]);
    c.sprite('@panel_ftg/sprite_lowerhub', card.lower[k]); c.sprite('@panel_ftg/sprite_upperhub', card.upper[k]);
  }
  STARS.forEach((s, i) => c.show(`@panel_ftg/panel_rarity_star/${s}`, i === k));
  c.picture('@panel_ftg/image_pfn_icon', O.cards.profession(r.profession)?.url ?? null);
  const portrait = O.cards.portrait(r.id, r.elite);
  c.picture('@image_chr_portrait', portrait ?? O.cards.avatar(r.id));
  for (const at of ['@img_star_mark', '@custom_mark', '@panel_front/panel_uniequip', '@panel_front/panel_skill', '@panel_front/panel_no_skill']) c.show(at, false);
  c.text('@panel_front/panel_level/text_level_num', String(r.level));
  const ring = c.node('@panel_front/panel_exp/image_exp_fill');
  if (ring) c.scr.fill('', r.level >= maxLevelOf(r.rarity, r.elite) ? 1 : 0, ring);
  const elite = r.elite > 0 ? O.cards.elite(r.elite) : null;
  c.show('@panel_front/icon_elite', !!elite);
  if (elite) c.picture('@panel_front/icon_elite', elite);
  const pot = r.potential >= 2 ? O.cards.potential(r.potential) : null;
  c.show('@panel_front/panel_potential', !!pot);
  if (pot) c.picture('@panel_front/panel_potential/icon_potential', pot);
  c.text('@panel_front/text_name', r.name);
}

/** A tap on an operator: chosen or let go, and looked at. @param {Sel} S @param {string} id */
function tap(S, id) {
  const t = tapped(S.chosen, id, S.O.max);
  if (t.full) S.O.toast(`最多选择 ${S.O.max} 名干员`);
  S.chosen = t.chosen;
  S.look = id;
  redraw(S);
  drawDetail(S);
}

/**
 * The sort bar (the game's custom sort group): 等级 and 稀有度 — the one sorting by selected, its arrow by the order —,
 * 稀有度筛选 in the custom sort's place (selected while a rarity is filtered), the filter button.
 * @param {Sel} S
 */
function drawSortBar(S) {
  const b = S.bar;
  if (!b) return;
  for (const by of /** @type {const} */ (['level', 'rarity'])) {
    const at = `@btn_sort_${by}`, on = S.sort.by === by;
    b.show(`${at}/btn_sort_${by}_normal`, !on);
    b.show(`${at}/btn_sort_${by}_down`, on && !S.sort.up);
    b.show(`${at}/btn_sort_${by}_up`, on && S.sort.up);
    b.tap(at, () => { S.sort = { by, up: S.sort.by === by ? !S.sort.up : false }; relist(S); });
  }
  const on = S.filter.rarities.length > 0;
  for (const t of ['btn_sort_rarity_normal', 'btn_sort_up', 'btn_sort_down']) b.text(`@btn_sort_custom/${t}`, '稀有度筛选');
  b.show('@btn_sort_custom/btn_sort_rarity_normal', !on);
  b.show('@btn_sort_custom/btn_sort_down', on);
  b.show('@btn_sort_custom/btn_sort_up', false);
  b.show('@btn_sort_custom/btn_sort_down/icon', false);
  b.tap('@btn_sort_custom', () => { S.rarity = !S.rarity; drawRarity(S); });
  b.tap('@btn_filter', () => { S.profOpen = true; drawProf(S); });
}

/**
 * The filter panel (the game's sort and filter panel in its wrapper): the profession filter in its filter place, the
 * sort panel kept for the rarity filter; the state's filter clip makes room for the profession bar.
 * @param {Sel} S
 */
function openFilter(S) {
  const panel = place(S.p, '@panel_sort_filter_wrapper', FILTER);
  if (!panel) return;
  const pf = panel.view();
  panel.show(pf.sortPanel ?? '@panel_sort', false);
  for (const at of [pf.backBkg ?? '@panel_bg', '@panel_sort/btn_close/panel_hotspot']) panel.tap(at, () => { S.rarity = false; drawRarity(S); });
  S.prof = place(panel, pf.filterContainer ?? '@panel_filter', PROF_FILTER);
  void S.p.anim(S.p.view().fliterAnimLoc);
  S.panel = panel;
  drawProf(S);
  drawRarity(S);
}

/**
 * The profession filter: its top tab (职业, or the profession or branch chosen) while the bar is folded; the bar of 全部
 * and the professions with the cursor at the one chosen; the chosen one's branch list. Folding and unfolding play the
 * bar's switch clip, the branch list its own.
 * @param {Sel} S
 */
function drawProf(S) {
  const pf = S.prof;
  if (!pf) return;
  const v = pf.view(), chosen = S.filter.profession, name = chosenName(S);
  pf.show(v.panelSelected, !!name);
  pf.show(v.panelUnSelected, !name);
  pf.text(v.selectedName, name);
  // while a branch list is open, a tap anywhere else folds it
  pf.show(v.panelSubProfBlocker, S.subOpen && !!chosen);
  pf.tap(v.panelSubProfBlocker ?? '@blocker', () => { S.subOpen = false; drawProf(S); });
  if (S.was.prof !== S.profOpen) {
    void pf.play('@', 'prof_switch', { reverse: !S.profOpen, ...(S.was.prof === undefined ? { rate: 1e4 } : {}) });
    S.was.prof = S.profOpen;
  }
  pf.tap('@hotspot', () => { S.profOpen = true; drawProf(S); });
  pf.tap('@panel_prof/const', () => { S.profOpen = false; S.subOpen = false; drawProf(S); });
  pf.text('@panel_prof/panel_content/all_item/text', '全部');
  pf.color('@panel_prof/panel_content/all_item/text', chosen ? GREY : BLUE);
  pf.tap('@panel_prof/panel_content/all_item/hotspot', () => { S.filter = { ...S.filter, profession: null, branch: null }; S.subOpen = false; relist(S); drawProf(S); });
  fillList(pf, '@panel_prof/panel_content/content', PROFESSIONS.length, (item, i) => profItem(S, item, PROFESSIONS[i][0]), PROF_ITEM);
  drawBranches(S, pf);
}

/** The name the profession filter's tab shows: the branch chosen, else the profession, else none. @param {Sel} S */
function chosenName(S) {
  const { profession, branch } = S.filter;
  if (branch) return S.O.art?.branch?.[branch]?.name ?? '';
  return profession ? PROFESSIONS.find(([id]) => id === profession)?.[1] ?? '' : '';
}

/**
 * A profession on the bar: its glyph in the chosen or the other colour, the arrow of its branch list and the mark of
 * a branch chosen; a tap chooses it (its branch list opening) or, chosen, opens or folds its branch list.
 * @param {Sel} S @param {Part} item @param {string} id
 */
function profItem(S, item, id) {
  const on = id === S.filter.profession, iv = item.view();
  item.sprite(iv.profIcon, S.O.art?.profGlyph?.[id.toLowerCase()] ?? null);
  item.color(iv.profIcon, on ? iv.colorSelected : iv.colorUnSelected);
  item.show(iv.panelSubShow, on && !S.subOpen);
  item.show(iv.panelSubHide, on && S.subOpen);
  item.show(iv.panelSubSelected, on && !!S.filter.branch);
  item.tap(iv.panelHotSpot, () => {
    if (on) S.subOpen = !S.subOpen;
    else { S.filter = { ...S.filter, profession: id, branch: null }; S.subOpen = true; relist(S); }
    drawProf(S);
  });
}

/** A node's top below an ancestor's (their boxes added up). @param {import('@aue/ui').UiNode} s @param {import('@aue/ui').UiNode} top */
function relTop(s, top) {
  let y = 0;
  for (let n = /** @type {import('@aue/ui').UiNode | null} */ (s); n && n !== top; n = n.parent) y += n.box?.[1] ?? 0;
  return y;
}

/**
 * The profession bar's cursor sliding to the chosen profession (or 全部) once the bar is laid out.
 * @param {Sel} S @param {number} dt
 */
function moveCursor(S, dt) {
  const pf = S.prof, cur = pf?.node('@panel_prof/panel_content/panel_cursor/cursor'), box = cur?.parent;
  if (!pf || !cur || !box?.box) return;
  const k = S.filter.profession ? PROFESSIONS.findIndex(([id]) => id === S.filter.profession) : -1;
  const content = pf.node('@panel_prof/panel_content/content'), at = k >= 0 ? content?.kids[k] : pf.node('@panel_prof/panel_content/all_item');
  if (!at?.box) return;
  const to = box.h / 2 - (relTop(at, box) + at.h / 2), y = cur.rt.pos[1];
  cur.rt.pos[1] = Math.abs(to - y) < 0.5 || S.cursorSet !== true ? to : y + (to - y) * Math.min(1, dt * 18);
  S.cursorSet = true;
}

/** The chosen profession's branch list: 全部 and each branch the roster has, the chosen one marked. @param {Sel} S @param {Part} pf */
function drawBranches(S, pf) {
  const prof = S.filter.profession, open = !!prof && S.subOpen, view = '@panel_prof/panel_subProf/subProf_view';
  if (S.was.sub !== open) {
    pf.show(view, true);
    void pf.play(view, 'sub_prof_switch', { reverse: !open, ...(S.was.sub === undefined ? { rate: 1e4 } : {}) }).then(() => { if (!S.subOpen || !S.filter.profession) pf.show(view, false); });
    S.was.sub = open;
  }
  if (!prof) return;
  const all = `${view}/all_item`, branches = branchesOf(S.rows, prof), chosen = S.filter.branch;
  pf.color(`${all}/name`, !chosen ? [0, 0.6941, 1, 1] : [0.5843, 0.5843, 0.5843, 1]);
  pf.tap(`${all}/hotspot`, () => { S.filter = { ...S.filter, branch: null }; relist(S); drawProf(S); });
  fillList(pf, `${view}/panel_content/scroll_view/viewport/content`, branches.length, (item, i) => {
    const b = branches[i], on = b === chosen, iv = item.view(), info = S.O.art?.branch?.[b];
    const c = on ? iv.colorSelected ?? [0, 0.6941, 1, 1] : iv.colorUnSelected ?? [0.5216, 0.5216, 0.5216, 1];
    item.text(iv.name ?? '@name', info?.name ?? b);
    item.color(iv.name ?? '@name', c);
    item.sprite(iv.profIcon ?? '@icon', info?.icon ?? null);
    item.color(iv.profIcon ?? '@icon', c);
    item.show(iv.bg ?? '@bg', on);
    item.tap('@hotspt', () => { S.filter = { ...S.filter, branch: b }; relist(S); drawProf(S); });
  }, SUBPROF_ITEM);
}

/**
 * The rarity filter in the sort panel: a row a rarity, six stars down, each chosen or not (none chosen: all); the
 * panel closes on its close button or the page's back.
 * @param {Sel} S
 */
function drawRarity(S) {
  const panel = S.panel;
  if (!panel) return;
  // a tap beside the open panel closes it
  panel.show(panel.view().backBkg ?? '@panel_bg', S.rarity);
  if (!S.rarity) return;
  fillList(panel, '@panel_sort/panel_sort_grid', RARITIES.length, (item, i) => {
    const r = RARITIES[i], on = S.filter.rarities.includes(r), iv = item.view();
    item.show(iv.unselect ?? '@image_bkg_item_unselect', !on);
    item.show(iv.firstSelect ?? '@panel_select_down', on);
    item.show(iv.secondSelect ?? '@panel_select_up', false);
    for (const at of ['@image_bkg_item_unselect/icon_sort_uporder', '@image_bkg_item_unselect/icon_sort_down', '@panel_select_down/icon_sort_uporder', '@panel_select_down/icon_sort_down']) item.show(at, false);
    const style = (iv.colorStyles ?? []).find((/** @type {any} */ x) => x.styleId === (on ? 'selected' : 'unselected'));
    item.text(iv.sortTitle ?? '@name_layout/label_text_selected', `${r}星`);
    if (style) { item.color(iv.sortTitle ?? '@name_layout/label_text_selected', style.textColor); item.color(iv.sortIconBg ?? '@icon_layout', style.iconBgColor); }
    item.sprite(iv.sortIcon ?? '@icon_layout/icon_sort', 'sprite/sprite_star_1');
    item.color(iv.sortIcon ?? '@icon_layout/icon_sort', [1, 1, 1, 1]);
    item.tap('@', () => {
      const has = S.filter.rarities.includes(r);
      S.filter = { ...S.filter, rarities: has ? S.filter.rarities.filter((x) => x !== r) : [...S.filter.rarities, r].sort((a, b) => b - a) };
      relist(S); drawRarity(S);
    });
  }, SORT_ITEM);
}

/**
 * The sort panel sliding in from the right edge by its width while the rarity filter is open, and out again (hidden
 * once out), easing to a stop.
 * @param {Sel} S @param {number} dt
 */
function slideSort(S, dt) {
  const n = S.panel?.node('@panel_sort');
  if (!n) return;
  const to = S.rarity ? -n.rt.size[0] : 0, x = n.rt.pos[0];
  if (S.rarity) n.active = true;
  if (Math.abs(to - x) < 0.5) { n.rt.pos[0] = to; if (!S.rarity) n.active = false; return; }
  n.rt.pos[0] = x + (to - x) * Math.min(1, dt * 14);
}

/** The detail's tabs: 技能 or 分支, each its switch and its part. @param {Sel} S */
function drawTabs(S) {
  const { p } = S, base = '@panel_attr_scroll/panel_attrs';
  for (const t of ['skill', 'branch']) {
    p.show(`${base}/layout_info_tab/${t}_title/panel_selected`, S.tab === t);
    p.show(`${base}/layout_info_tab/${t}_title/panel_unselect`, S.tab !== t);
  }
  p.show(`${base}/layout_skill_desc`, S.tab === 'skill');
  p.show(`${base}/layout_branch`, S.tab === 'branch');
}

/**
 * The operator looked at, on the left: nothing yet — the hint to tap one —, else its name and code name, level, the
 * attributes at its training, its range, its skills and its branch (its training loaded first).
 * @param {Sel} S
 */
function drawDetail(S) {
  const { p } = S, a = p.view('@panel_attr_scroll/panel_attrs');
  p.show(a.panelEmptyInfo ?? '@image_bkg_left/panel_empty_info', !S.look);
  p.show('@panel_attr_scroll', !!S.look);
  if (!S.look) return;
  const id = S.look, r = S.rows.find((x) => x.id === id), n = ++S.looked;
  if (!r) return;
  p.text(a.name, r.name);
  p.text(a.currentLevel, String(r.level));
  p.text(a.maxLevel, `/${maxLevelOf(r.rarity, r.elite)}`);
  drawTabs(S);
  S.O.training(id).then((t) => { if (n === S.looked && !p.scr.dead) fillDetail(S, r, t); }, () => undefined);
}

/** The detail from an operator's training. @param {Sel} S @param {Row} r @param {Training} t */
function fillDetail(S, r, t) {
  const { p, O } = S, a = p.view('@panel_attr_scroll/panel_attrs'), e = O.entry(r.id);
  p.text(a.codeName, t.appellation ?? '');
  p.text(a.maxLevel, `/${t.phases[r.elite]?.maxLevel ?? maxLevelOf(r.rarity, r.elite)}`);
  // the branch's icon; no module shown as worn (the match chooses it)
  const sub = '@panel_attr_scroll/panel_attrs/panel_top_info/panel_sub_pro';
  p.sprite(`${sub}/sub_prof_bg/img_title`, O.art?.branch?.[r.branch]?.icon ?? null);
  for (const [at, on] of /** @type {const} */ ([['icon_non', true], ['icon_locked', false], ['uniq_equip_bg', false]])) p.show(`${sub}/equip_bg/${at}`, on);
  drawAttrs(S, a, statsAt(t, { elite: r.elite, level: r.level, potential: r.potential, trust: e?.trust ?? 100, skill: -1, skillLevel: 1 }, null));
  drawRange(S, a.attackRange, t.phases[r.elite]?.range ?? []);
  drawSkills(S, r, t, e);
  drawBranch(S, r, t, e);
}

/** The attribute icons a sort icon each, by the controller's field. */
const ATTR_ICONS = /** @type {Record<string, string>} */ ({ maxHpIcon: 'hp', atkIcon: 'atk', defIcon: 'def', resIcon: 'res_def', reviveIcon: 'respawn', costIcon: 'cost',
  blockIcon: 'block', attackSpeedIcon: 'atkspeed' });

/**
 * The attributes at a training, each with its icon: HP, attack, defence, resistance, cost and block as whole numbers,
 * the redeployment time and the attack interval in seconds.
 * @param {Sel} S @param {Record<string, any>} a the attribute controller's fields @param {Record<string, number>} s
 */
function drawAttrs(S, a, s) {
  const icon = S.O.art?.sortIcon ?? {}, n = (/** @type {number} */ v) => String(Math.round(v));
  /** @type {[string, string, string][]} */
  const attrs = [['maxHp', 'maxHpIcon', n(s.maxHp)], ['atk', 'atkIcon', n(s.atk)], ['def', 'defIcon', n(s.def)], ['res', 'resIcon', n(s.res)],
    ['reviveTimeDesc', 'reviveIcon', `${n(s.respawnTime)}s`], ['cost', 'costIcon', n(s.cost)], ['blockNum', 'blockIcon', n(s.blockCnt)],
    ['attackSpeedDesc', 'attackSpeedIcon', `${+(s.baseAttackTime * 100 / (s.aspd || 100)).toFixed(2)}s`]];
  for (const [v, ic, text] of attrs) { S.p.text(a[v], text); S.p.sprite(a[ic], icon[ATTR_ICONS[ic]] ?? null); }
}

/**
 * An attack range in its grid: a cell a tile — where the operator stands, where it attacks, empty —, in rows from the
 * top, as small as the range widget's largest size needs.
 * @param {Sel} S @param {string | undefined} at @param {{ row: number, col: number }[]} cells
 */
function drawRange(S, at, cells) {
  const { p } = S, node = at ? p.node(at) : null, w = p.view(at ?? '');
  if (!node?.n.comps.grid || !at) return;
  const all = [...cells, { row: 0, col: 0 }], rows = all.map((c) => c.row), cols = all.map((c) => c.col);
  const r0 = Math.min(...rows), r1 = Math.max(...rows), c0 = Math.min(...cols), c1 = Math.max(...cols), nr = r1 - r0 + 1, nc = c1 - c0 + 1;
  const g = node.n.comps.grid, max = w.maxSize ?? { x: 115, y: 54 }, gap = g.spacing[0];
  const cell = Math.min(13, (max.x - (nc - 1) * gap) / nc, (max.y - (nr - 1) * gap) / nr);
  node.n = { ...node.n, comps: { ...node.n.comps, grid: { ...g, cell: [cell, cell], constraint: 1, count: nc, axis: 0 } } };
  const has = new Set(cells.map((c) => `${c.row},${c.col}`));
  fillList(p, at, nr * nc, (tile, i) => {
    const row = r1 - Math.floor(i / nc), col = c0 + (i % nc), stand = row === 0 && col === 0;
    const sprite = stand ? w.tileStand : has.has(`${row},${col}`) ? w.tileAttack : null;
    tile.root.rt.size = [cell, cell];
    tile.sprite('@', sprite ?? null);
    tile.color('@', sprite ? [1, 1, 1, 1] : [1, 1, 1, 0]);
  }, PICTURE);
}

/**
 * The skills: each its icon, name, SP cost and start, its level or mastery mark, its tags (SP type, trigger,
 * duration) and its text at the box's level (the top one when it is not in the box); a skill its elite phase has not
 * opened is locked.
 * @param {Sel} S @param {Row} r @param {Training} t @param {BoxEntry | null} e
 */
function drawSkills(S, r, t, e) {
  const { p, O } = S, a = p.view('@panel_attr_scroll/panel_attrs'), skills = t.skills.filter((x) => x !== null);
  fillList(p, a.skillGroup ?? '@panel_attr_scroll/panel_attrs/layout_skill_desc/layout_skill_grid', skills.length, (item, i) => {
    const sk = /** @type {NonNullable<Training['skills'][number]>} */ (skills[i]), v = item.view(), open = sk.phase <= r.elite;
    const lv = Math.max(1, Math.min(sk.levels.length, e?.skills[i] ?? (r.elite >= 2 ? 10 : r.elite === 1 ? 7 : 4))), level = sk.levels[lv - 1];
    item.show(v.activePart, true); item.show(v.unActivePart, false); item.show(v.disablePart, false);
    item.show(v.panelLock, !open);
    if (!open) { item.sprite(v.unlockIcon, v.unlcokSprites?.[sk.phase - 1] ?? null); item.text(v.lockText, `精英${sk.phase}解锁`); }
    item.picture(v.skillIcon, O.cards.skill(sk.id));
    item.text(v.skillName, sk.name ?? '');
    item.text(v.spCost, String(level.spData.spCost));
    item.show(v.panelInitCost, true);
    item.text(v.textInitCost, String(level.spData.initSp));
    item.show(v.panelSkillLevel, lv <= 7);
    item.text(v.textSkillLevel, String(lv));
    item.show(v.skillLevelIcon, lv > 7);
    if (lv > 7) item.sprite(v.skillLevelIcon, v.skillLevelImages?.[lv - 7] ?? null);
    item.show(v.selectedAlpha, false);
    item.show(v.panelRange, false);
    const bb = Object.fromEntries(level.blackboard.map((/** @type {{ key: string, value: number }} */ x) => [x.key, x.value]));
    item.text(v.skillDesc, gameRich(textPair(level.description ?? '', bb).descRaw));
    skillTags(item, v, level);
  });
}

/**
 * A skill's tags in its tag group: its SP type and trigger, and its duration when it has one.
 * @param {Part} item @param {Record<string, any>} v @param {import('@aue/content').SkillLevel} level
 */
function skillTags(item, v, level) {
  const at = item.node(v.skillTagGroup ?? '@panel_content/layout_skill_content/layout_detail/panel_skill_tags');
  if (!at) return;
  for (const k of [...at.kids]) item.scr.remove(k);
  for (const tag of [SP_TAGS[String(level.spData.spType)], TRIGGER_TAGS[level.skillType]]) {
    if (!tag) continue;
    const s = item.scr.instantiate(at, TAG_TEXT);
    item.scr.text('label_content', tag[0], s);
    item.scr.color('', tag[1], s);
  }
  if (level.duration > 0) {
    const s = item.scr.instantiate(at, TAG_TIME);
    item.scr.text('label_content', `${+level.duration.toFixed(1)}秒`, s);
  }
}

/**
 * The branch tab: the branch's icon and name, its trait's text, and the talents at the box's training (each its name
 * and text, or the first one's unlock when none is open yet); the modules list is not shown.
 * @param {Sel} S @param {Row} r @param {Training} t @param {BoxEntry | null} e
 */
function drawBranch(S, r, t, e) {
  const { p, O } = S, g = p.view('@panel_attr_scroll/panel_attrs/layout_branch'), info = O.art?.branch?.[r.branch];
  p.show(g.panelUniequip ?? '@panel_attr_scroll/panel_attrs/layout_branch/panel_uniequip', false);
  p.text(g.subProfName, info?.name ?? '');
  p.sprite(g.subProfImg, info?.icon ?? null);
  p.text(g.subProfDetailBasic, gameRich(textPair(t.description ?? '', traitBb(t, r)).descRaw));
  p.text(g.subProfDetailAdditive, '');
  const talents = t.talents.map((/** @type {any[]} */ cands) => talentAt(cands, r, e)).filter((x) => x !== null);
  fillList(p, g.talentContainer, talents.length, (item, i) => {
    const { c, open } = /** @type {{ c: any, open: boolean }} */ (talents[i]), v = item.view();
    item.text(v.textName, c.name ?? '');
    item.text(v.textContent, gameRich(textPair(c.description ?? '', c.bb, c.text).descRaw));
    item.show('@title_container/active_evolve_container', !open);
    if (!open) item.text('@title_container/active_evolve_container/active_evolve_two_new_icon/detail_text', `精英${c.phase}解锁`);
  }, TALENT);
}

/** The blackboard of the trait candidate an operator has at its training (the last one open). @param {Training} t @param {Row} r */
function traitBb(t, r) {
  const open = t.traits.filter((/** @type {{ phase: number, level: number, potential: number }} */ c) => (c.phase < r.elite || (c.phase === r.elite && c.level <= r.level)) && c.potential <= r.potential - 1);
  return open.at(-1)?.bb ?? {};
}

/**
 * A talent's candidate at a training: the last one open (its elite phase and level reached, its potential), else the
 * first one to show its unlock; null for a hidden talent.
 * @param {any[]} cands @param {Row} r @param {BoxEntry | null} e
 */
function talentAt(cands, r, e) {
  const pot = (e?.potential ?? r.potential) - 1;
  const open = cands.filter((c) => (c.phase < r.elite || (c.phase === r.elite && c.level <= r.level)) && c.potential <= pot);
  const c = open.at(-1) ?? cands[0];
  return !c || c.hidden ? null : { c, open: open.length > 0 };
}
