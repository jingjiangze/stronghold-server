// 组建上场阵容 and 准备就绪 on the squad check panel (docs/spec/page.md 页面-6, room.md 房间-5, 房间-6): first the
// operators drawn for this player (随机分配了以下干员), then three views — choosing the lineup from the options (6–10),
// each one's skill and module, and both lineups with 准备就绪 / 取消准备. The lineup goes to the room when the player
// leaves the skill view; 上一步 goes back a view.
import { place, fillList, setSwitch, showInvert } from './lobbykit.js';
import { INVERSE } from '@icebreaker/mode-regular';
import { holderCard, fillCard } from './lobbycards.js';
import { LINEUP_VIEWS, lineupOptions } from './lobbymap.js';
import { lineupCount } from './roomtext.js';
import { cardOf } from './lobbypick.js';

/** @typedef {import('./lobbykit.js').Part} Part @typedef {import('./lobbystage.js').StepCtx} StepCtx @typedef {import('./roomtext.js').Pick} Pick */

/** @param {Part} p @param {StepCtx} X */
export function createLineup(p, X) {
  const f = p.view();
  /** @type {{ sub: string, part: Part | null, key: string }} */
  let cur = { sub: '', part: null, key: '' };
  let alloc = false;
  void p.anim(f.entryAnim);
  return {
    /** @param {any} S @param {any} L */
    update(S, L) {
      const v = S.view, o = v.options?.[v.you];
      if (!o) return;
      if (!alloc) { alloc = true; void allocated(p, f, S, o, X); }
      if (cur.sub !== L.sub) {
        cur = { sub: L.sub, part: place(p, f.procViewContainer, /** @type {Record<string, string>} */ (LINEUP_VIEWS)[L.sub]), key: '' };
        const view = cur.part?.view();
        if (cur.part && view) {
          showInvert(cur.part, view.invertTips, !!v.inverse, INVERSE.hint);
          showInvert(p, p.view('@main_view').invertClrBkg, !!v.inverse);
          void cur.part.anim(view.entryAnim);
          // choosing the lineup: the options' row comes up too
          if (L.sub === 'sel') void cur.part.anim(view.reserveAnim);
        }
      }
      if (!cur.part) return;
      const key = JSON.stringify([S.draft, v.lineups, v.ready, X.version()]);
      if (key === cur.key) return;
      cur.key = key;
      if (L.sub === 'sel') select(cur.part, S, o, X);
      else if (L.sub === 'skill') skills(cur.part, S, X);
      else check(cur.part, S, X);
    },
  };
}

/** The operators drawn for this player, shown a moment as the step begins. @param {Part} p @param {Record<string, any>} f @param {any} S @param {any} o @param {StepCtx} X */
async function allocated(p, f, S, o, X) {
  const ids = [...o.drawn, ...o.extra], af = p.view(f.sysAllocView), recruits = new Set(S.lobby?.recruits?.map((/** @type {any} */ e) => e.id) ?? []);
  if (!ids.length || !f.sysAllocView) { p.show(f.sysAllocView, false); return; }
  p.show(f.sysAllocView, true);
  const opts = lineupOptions({ kept: [], drawn: o.drawn, extra: o.extra }, recruits);
  fillList(p, af.cardListContent, opts.length, (item, i) => holderCard(item, place, cardOf(X, S, S.view.you, opts[i].id, opts[i].tag), X.cards));
  await p.anim(af.entryAnim);
  await new Promise((done) => { setTimeout(done, 1800); });
  p.show(f.sysAllocView, false);
}

/** Whether a skill view shows the modules (its 技能 / 模组 tab). @type {WeakMap<Part, boolean>} */
const tabs = new WeakMap();

/** The lineup being set, never null. @param {any} S @returns {Pick[]} */
const draftOf = (S) => S.draft ?? [];

/** Each option's card's place in the row below (not chosen: in) and whether its clip has played, for its clip when that changes. @type {WeakMap<Part, { on: boolean, settled: boolean }>} */
const RESERVE = new WeakMap();

/**
 * An option's card in the row below: a chosen one is taken out of the row (its clip backwards: it slides away and the
 * row closes up), one given back comes in (forwards); the first time it stands as the clip leaves it. One taken out
 * takes no taps once it has gone (its card stays where it slid to, unseen).
 * @param {Part} item @param {boolean} on
 */
function reserveSwitch(item, on) {
  const was = RESERVE.get(item);
  if (was?.on === on) { if (!on && was.settled) item.root.active = false; return; }
  const st = { on, settled: false };
  RESERVE.set(item, st);
  const a = item.view().animInOut;
  if (on) item.root.active = true;
  void item.play(a?.animationWrapper ?? '@', a?.animationName ?? 'multi_v3_prepare_squad_reserve_char_card_switch', { reverse: !on, rate: was ? 1 : 1e4 })
    .then(() => { st.settled = true; if (RESERVE.get(item) === st && !on) item.root.active = false; });
}

/**
 * Choosing the lineup: the chosen ones as small cards (a tap takes one out), the options not chosen below (a tap puts
 * one in; a chosen one leaves the row), the count's hint, 下一步 while the count is right.
 * @param {Part} v @param {any} S @param {any} o @param {StepCtx} X
 */
function select(v, S, o, X) {
  const f = v.view(), draft = draftOf(S), recruits = new Set(S.lobby?.recruits?.map((/** @type {any} */ e) => e.id) ?? []);
  const opts = lineupOptions(o, recruits), tagOf = new Map(opts.map((x) => [x.id, x.tag])), why = lineupCount(draft);
  /** @param {string} id */
  const toggle = (id) => {
    const at = draft.findIndex((x) => x.id === id), e = X.entryOf(S.view.you, id);
    X.setDraft(at >= 0 ? draft.filter((x) => x.id !== id) : draft.length >= 10 ? draft
      : [...draft, { id, skill: e ? e.skills.length - 1 : -1, module: e ? e.modules.findIndex((m) => m > 0) : -1 }]);
  };
  fillList(v, f.squad, draft.length, (item, i) => {
    const id = draft[i].id;
    holderCard(item, place, cardOf(X, S, S.view.you, id, tagOf.get(id) ?? 'extra'), X.cards);
    item.tap('@panel_card/click_hotspot', () => toggle(id));
  });
  fillList(v, f.reserveList, opts.length, (item, i) => {
    const { id, tag } = opts[i];
    holderCard(item, place, cardOf(X, S, S.view.you, id, tag), X.cards, () => toggle(id));
    reserveSwitch(item, !draft.some((x) => x.id === id));
  });
  v.text(f.minCntTips, why ? '编队至少6人' : `已选择 ${draft.length} 名`);
  setSwitch(v, f.btnNext, !why);
  v.tap('@btn_next/normal/hot_spot', () => { if (!lineupCount(draftOf(S))) X.sub('skill'); });
}

/**
 * Each chosen operator's skill and module: its large card, its skills (a tap chooses one) and its unlocked modules (a
 * tap chooses or drops one); 下一步 sends the lineup to the room.
 * @param {Part} v @param {any} S @param {StepCtx} X
 */
function skills(v, S, X) {
  const f = v.view(), draft = draftOf(S), tab = f.tabSwitchAnim;
  // the tab's clip runs from 模组 chosen to 技能 chosen: the step opens on 技能 (the clip's end), 模组 plays it back
  if (!tabs.has(v)) { tabs.set(v, false); if (tab?.animationName) void v.play(tab.animationWrapper, tab.animationName, { rate: 1e4 }); }
  const modules = tabs.get(v) ?? false;
  v.tap('@tab_show_switch/hotspot', () => {
    tabs.set(v, !modules);
    if (tab?.animationName) void v.play(tab.animationWrapper, tab.animationName, { reverse: !modules });
    skills(v, S, X);
  });
  /** @param {number} i @param {Partial<Pick>} change */
  const set = (i, change) => X.setDraft(draft.map((x, k) => (k === i ? { ...x, ...change } : x)));
  fillList(v, f.charCardContent, draft.length, (item, i) => {
    const d = draft[i], e = X.entryOf(S.view.you, d.id), vf = item.view(), r = X.rosterOf(d.id);
    const card = vf.container && vf.cardPrefab ? place(item, vf.container, vf.cardPrefab) : null;
    // the skill view's card prefab is the large card itself, not a holder
    if (card) fillCard(card, { id: d.id, entry: e, name: X.nameOf(d.id), rarity: r?.rarity ?? 1, profession: r?.profession ?? '', skill: d.skill, module: d.module, skillId: X.skillId(d.id, d.skill) }, X.cards);
    // the skills and modules are chosen on the right: the card's own panel of them is not shown here (the original)
    if (card) card.show(card.view().skillEquipPanelGO, false);
    fillList(item, vf.contentSkill, e?.skills.length ?? 0, (s, k) => {
      const sf = s.view(), lv = e?.skills[k] ?? 0;
      s.show(sf.emptyPartGo, false); s.show(sf.lockPartGo, false); s.show(sf.normalPartGo, true);
      s.show(sf.selectBgGo, d.skill === k);
      s.picture(sf.imgSkill, X.cards.skill(X.skillId(d.id, k) ?? ''));
      s.text(sf.textSkillLv, lv > 7 ? '' : String(lv));
      s.show(sf.imgSpecializeLv, lv > 7);
      if (lv > 7 && sf.skillLevelImages) s.sprite(sf.imgSpecializeLv, sf.skillLevelImages[lv - 7] ?? null);
      s.tap('@normal_part/click_area', () => set(i, { skill: k }));
    });
    // each of its modules: its type's icon, the type's name and its extra-type mark (EXE + Y), its stage; one not
    // unlocked in the box is locked; a tap chooses one or drops it
    const count = Math.max(X.moduleCount(d.id), e?.modules.length ?? 0);
    item.show(vf.objSkillPanel, !modules);
    item.show(vf.objModulePanel, modules);
    fillList(item, vf.contentModule, count, (m, k) => {
      const mf = m.view(), st = e?.modules[k] ?? 0, type = X.moduleType(d.id, k) ?? '', [name, mark] = type.split('-');
      m.show(mf.emptyPartGo, false); m.show(mf.lockPartGo, st === 0); m.show(mf.normalPartGo, st > 0);
      if (st === 0) return;
      m.show(mf.selectBgGo, d.module === k);
      m.picture(mf.imgEquipIcon, type ? X.cards.equip(type) : null);
      m.text(mf.textEquipName, name ?? '');
      m.show(mf.imgEquipType, !!mark);
      if (mark) m.picture(mf.imgEquipType, X.cards.equipMark(mark));
      m.text(mf.textLv, String(st));
      m.tap('@normal_part/click_area', () => set(i, { module: d.module === k ? -1 : k }));
    });
  });
  v.tap('@btn_next/hot_spot', () => { X.send({ t: 'lineup', lineup: draftOf(S) }); X.sub('check'); });
}

/**
 * Both lineups: this player's and the mate's as large cards (the mate's once it has set one; meanwhile its waiting
 * hint), 准备就绪 / 取消准备.
 * @param {Part} v @param {any} S @param {StepCtx} X
 */
function check(v, S, X) {
  const f = v.view(), me = S.view.you, mate = 1 - me, mine = S.view.lineups[me] ?? draftOf(S).map((x) => x.id), theirs = S.view.lineups[mate];
  // this player's cards with the skills and modules of its draft
  const chosen = new Map(draftOf(S).map((x) => [x.id, x]));
  fillList(v, f.mySquad, mine.length, (item, i) => {
    const d = chosen.get(mine[i]);
    setSwitch(item, '@', true);
    holderCard(item, place, { ...cardOf(X, S, me, mine[i], 'extra'), ...(d ? { skill: d.skill, module: d.module, skillId: X.skillId(d.id, d.skill), moduleType: X.moduleType(d.id, d.module) } : {}) }, X.cards);
  });
  // the mate's cards with the skills and modules it chose (房间-6)
  fillList(v, f.partnerSquad, theirs?.length ?? 0, (item, i) => {
    const c = S.view.choices?.[mate]?.[i], id = theirs[i];
    setSwitch(item, '@', true);
    holderCard(item, place, { ...cardOf(X, S, mate, id, 'extra'), ...(c ? { skill: c.skill, module: c.module, skillId: X.skillId(id, c.skill), moduleType: X.moduleType(id, c.module) } : {}) }, X.cards);
  });
  v.show(f.waitingTips, !theirs);
  const ready = !!S.view.ready[me];
  setSwitch(v, f.btnPrepare, !ready);
  v.tap('@btn_check/normal/hot_spot', () => X.send({ t: 'ready', on: true }));
  v.tap('@btn_check/cancel/hot_spot', () => X.send({ t: 'ready', on: false }));
}
