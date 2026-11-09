// 集成战略页（/rogue）：主题选择 → 地图推进 → 战斗（普通对局）→ 奖励 → 结局。
// 运行态在服务端（packages/server/src/rogue.js，规则在 @icebreaker/mode-rogue）；这里只渲染它推来的 view。
import { socketUrl, assetsUrl } from './site.js';
import { LOBBY_KEY, tabKey, localStore } from './session.js';
import { readSave, squadOf, profileOf } from './save.js';
import { buildOf } from '@icebreaker/mode-regular';

/** 页面上的素材基址（服务端注入版本号；没有素材时 404，节点卡降级为纯色块）。 */
const ASSETS = assetsUrl();
const store = localStore(), key = tabKey(LOBBY_KEY);
/** @type {any} */
let save = null;
try { save = readSave(store); } catch { save = null; }

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const esc = (/** @type {unknown} */ s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** 节点类型 → 官方素材与中文名。 */
const NODE = {
  BATTLE_NORMAL: { name: '作战', icon: 'battle', tag: 'battle' },
  BATTLE_ELITE: { name: '紧急作战', icon: 'elite', tag: 'elite' },
  BATTLE_BOSS: { name: '险路恶敌', icon: 'boss', tag: 'boss' },
  INCIDENT: { name: '不期而遇', icon: 'incident', tag: 'incident' },
  ENTERTAINMENT: { name: '娱乐', icon: 'entertainment', tag: 'entertainment' },
  UNKNOWN: { name: '未知', icon: 'unknown', tag: 'unknown' },
  SHOP: { name: '诡意行商', icon: 'shop', tag: 'shop' },
  REST: { name: '安全的角落', icon: 'rest', tag: 'rest' },
  TREASURE: { name: '得偿所愿', icon: 'treasure', tag: 'treasure' },
};
const asset = (/** @type {string} */ path) => new URL(path, ASSETS).href;
const iconOf = (/** @type {string} */ node) => (node === 'UNKNOWN' ? asset('ui/rogue/img_unknown.png') : asset(`ui/rogue/img_${NODE[node]?.icon ?? 'unknown'}_active.png`));
/** 官方节点标签条（img_tag_<type>.png，206×21 的白色美术字，按 132px 显示）。没有的（得偿所愿）退回中文文本。 */
const tagOf = (/** @type {string} */ node) => (NODE[node]?.tag ? asset(`ui/rogue/img_tag_${NODE[node].tag}.png`) : null);
const cardBg = asset('ui/rogue/img_node_bkg.png');

/** @type {WebSocket | null} */
let ws = null;
let retry = 0;
/** 当前这次探索的编号（从对局页回来时用它重新拿到 view）。 */
let runCode = (() => { try { return sessionStorage.getItem('ice.rogue.code'); } catch { return null; } })();
/** @type {any} */
let topics = null, view = null, chosen = null;

function toast(/** @type {string} */ text) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(/** @type {any} */ (toast.timer)); toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function connect() {
  $('conn').textContent = retry ? `重连中（${retry}）` : '连接中';
  ws = new WebSocket(socketUrl('lobby'));
  ws.addEventListener('open', () => {
    retry = 0; $('conn').textContent = '已连接';
    ws?.send(JSON.stringify({ t: 'hello', key, name: (save?.name || '博士').slice(0, 16) }));
    ws?.send(JSON.stringify({ t: 'rogueTopics' }));
    if (runCode) ws?.send(JSON.stringify({ t: 'rogueJoin', code: runCode, deck: deck() }));
  });
  ws.addEventListener('message', (e) => { let m; try { m = JSON.parse(String(e.data)); } catch { return; } onMessage(m); });
  ws.addEventListener('close', (e) => {
    $('conn').textContent = '断开';
    retry++; setTimeout(connect, Math.min(8000, 500 * 2 ** Math.min(retry, 4)));
  });
}

/** 这名玩家的阵容（引擎的 decks 形状）：常规队的高优先 + 低优先，最多 12 名。 */
function deck() {
  const s = squadOf(save), all = [...s.high, ...s.low].filter(Boolean);
  return all.map((/** @type {any} */ e) => ({ id: e.id, build: buildOf(e, e.skills?.length ? 0 : -1, -1) })).slice(0, 12);
}

/** @param {any} m */
let lastShown = null;
function onMessage(m) {
  if (m.t === 'rogueTopics') { topics = m.topics; renderSetup(); return; }
  if (m.t === 'rogueStart') {
    try { sessionStorage.setItem('ice.rogue.code', runCode ?? ''); } catch { /* 仅本标签页 */ }
    const q = new URLSearchParams({ match: m.match, seat: String(m.seat ?? 0), back: 'rogue' });
    const limit = new URLSearchParams(location.search).get('limit');
    if (limit) q.set('limit', limit);
    location.assign(`play?${q}`);
    return;
  }
  if (m.t === 'rogue') {
    view = m; runCode = m.code;
    if (m.last && m.last !== lastShown) { lastShown = m.last; toast(String(m.last)); }
    try { sessionStorage.setItem('ice.rogue.code', m.code); } catch { /* 仅本标签页 */ }
    renderRun();
    return;
  }
  if (m.t === 'error') { toast(String(m.msg ?? '出错了')); }
}

function renderSetup() {
  if (view) return;
  $('setup').hidden = false; $('run').hidden = true;
  $('setup-hint').textContent = deck().length ? `阵容：${deck().length} 名干员（来自干员 box 的常规队）` : '干员 box 里还没有可上场的干员：先去「组队参赛」页录入 box 与常规队。';
  const list = $('topics'); list.replaceChildren();
  for (const t of topics ?? []) {
    const d = document.createElement('button');
    d.type = 'button'; d.className = `card${chosen?.id === t.id ? ' on' : ''}`;
    d.innerHTML = `<h3>${esc(t.name)}</h3><p>${esc(t.line ?? '')}</p><span class="tag">${t.zones} 区域 · ${t.stages} 关</span>`;
    d.addEventListener('click', () => { chosen = t; renderSetup(); });
    list.append(d);
  }
  const grade = $('grade');
  grade.replaceChildren();
  const grades = chosen?.difficulties?.filter((/** @type {any} */ x) => x.mode === 'NORMAL') ?? [];
  for (const g of grades) {
    const o = document.createElement('option'); o.value = String(g.grade); o.textContent = `${g.name}${g.grade ? `（${g.grade}）` : ''}${g.rule ? ` · ${g.rule}` : ''}`;
    grade.append(o);
  }
  const squad = $('squad');
  squad.replaceChildren();
  for (const s of chosen?.squads ?? []) {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.name ?? s.id;
    squad.append(o);
  }
  if (!chosen && topics?.length) { chosen = topics[0]; renderSetup(); }
}

function renderRun() {
  if (!view) return;
  $('setup').hidden = true; $('run').hidden = false;
  const r = view.run;
  $('hp').textContent = `${r.hp} / ${r.maxHp}`;
  const zoneTitle = view.column ? `${view.column.zone.time ? `${view.column.zone.time} · ` : ''}${view.column.zone.name}` : '';
  const zt = $('zonetitle'); if (zt) zt.textContent = zoneTitle;
  $('gold').textContent = String(r.gold);
  $('relics').textContent = String(r.relicCount);
  $('zone').textContent = view.column ? `${view.column.zone.name} ${view.column.column + 1}/${view.column.columns}` : '—';
  const bg = view.column?.zone?.bg;
  if (bg) $('mapwrap').style.backgroundImage = `linear-gradient(rgba(8,10,9,.55), rgba(8,10,9,.75)), url("${asset(`ui/rogue/map/${bg}.webp`)}")`;
  renderMap();
  if (view.phase === 'reward' && view.choices) renderReward(view.choices);
  else $('reward').hidden = true;
  if (view.phase === 'shop' && view.shop) renderShop(view.shop);
  else $('shop').hidden = true;
  if (r.status !== 'running') renderOver(r);
  if (view.column && view.column.nodes?.length === 1 && view.phase === 'map') { /* 单候选列不自动选，交给玩家 */ }
}

/** 地图：只画当前区域；每列一组候选，列间画连线。 */
function renderMap() {
  const map = $('map');
  for (const old of [...map.querySelectorAll('.col')]) old.remove();
  const col = view?.column;
  if (!col) return;
  const svg = /** @type {SVGSVGElement} */ ($('links'));
  svg.replaceChildren();
  const cols = [];
  for (const nodes of view.run.graph[col.index]?.columns ?? []) {
    const c = document.createElement('div'); c.className = 'col';
    for (const n of nodes) {
      const d = document.createElement('button'); d.type = 'button';
      const current = n.state === 'current';
      d.className = `node${n.node === 'BATTLE_BOSS' ? ' boss' : ''}${current ? ' current' : ''}${n.state === 'locked' ? ' locked' : ''}${n.state === 'done' ? ' done' : ''}`;
      const info = NODE[n.node] ?? { name: n.node };
      const tag = tagOf(n.node);
      d.innerHTML = `<span class="t">${esc(info.name)}</span>` + (n.stage ? `<span class="s">${esc(n.stage.name)}</span>` : '')
        + (tag ? `<span class="tagimg" style="background-image:url('${tag}')"></span>` : '');
      d.style.backgroundImage = `url('${cardBg}')`;
      if (current) d.addEventListener('click', () => ws?.send(JSON.stringify({ t: 'roguePick', id: n.id })));
      c.append(d);
    }
    map.append(c); cols.push(c);
  }
  // 列间连线：相邻两列的中间到中间，走一条折线
  requestAnimationFrame(() => {
    const box = map.getBoundingClientRect();
    const mid = (/** @type {Element} */ el) => { const b = el.getBoundingClientRect(); return { x: b.left - box.left + 10, y: b.top - box.top + b.height / 2, r: b.right - box.left - 10 }; };
    for (let i = 0; i + 1 < cols.length; i++) {
      const a = mid(cols[i]), b = mid(cols[i + 1]);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M ${a.r} ${a.y} C ${a.r + 32} ${a.y}, ${b.x - 32} ${b.y}, ${b.x} ${b.y}`);
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#3f5a4c'); p.setAttribute('stroke-width', '2');
      p.setAttribute('dasharray', i < view.run.column ? '' : '5 5');
      svg.append(p);
    }
  });
}

/** @param {any[]} offers */
function renderShop(offers) {
  const box = $('shop'); box.hidden = false;
  const cards = $('shopcards'); cards.replaceChildren();
  for (const o of offers) {
    const d = document.createElement('button'); d.type = 'button'; d.className = 'card';
    d.innerHTML = `<h3>${esc(o.name)}</h3><p>${esc(o.usage ?? '')}</p><span class="rarity">${esc(o.rarity ?? '')} · ${o.price} 源石锭</span>`;
    d.addEventListener('click', () => ws?.send(JSON.stringify({ t: 'rogueBuy', id: o.id })));
    cards.append(d);
  }
}

/** @param {any[]} choices */
function renderReward(choices) {
  const box = $('reward'); box.hidden = false;
  const cards = $('rewardcards'); cards.replaceChildren();
  for (const c of choices) {
    const d = document.createElement('button'); d.type = 'button'; d.className = 'card';
    d.innerHTML = `<h3>${esc(c.name)}</h3><p>${esc(c.usage ?? '')}</p><span class="rarity">${esc(c.rarity ?? '')}</span>`;
    d.addEventListener('click', () => { box.hidden = true; ws?.send(JSON.stringify({ t: 'rogueReward', id: c.id })); });
    cards.append(d);
  }
}

/** @param {any} r */
function renderOver(r) {
  $('over').hidden = false;
  $('overtitle').textContent = r.status === 'won' ? '探索完成' : '探索结束';
  $('overtext').textContent = r.status === 'won' ? `走到了终点，获得 ${r.relicCount} 件藏品。` : `生命耗尽。获得 ${r.relicCount} 件藏品。`;
}

$('start').addEventListener('click', () => {
  if (!chosen) return toast('先选一个主题');
  const d = deck();
  if (d.length < 1) return toast('先去组队参赛页录入干员 box 与常规队');
  ws?.send(JSON.stringify({ t: 'rogueCreate', topic: chosen.id, grade: Number($('grade').value || 0), squad: $('squad').value || '', deck: d }));
});
$('joinbtn').addEventListener('click', () => {
  const code = /** @type {HTMLInputElement} */ ($('code')).value.trim();
  const d = deck();
  ws?.send(JSON.stringify({ t: 'rogueJoin', code, deck: d }));
});
$('relicbtn').addEventListener('click', () => {
  const list = $('reliclist'); list.replaceChildren();
  for (const r of view?.run?.relicList ?? []) { const li = document.createElement('li'); li.textContent = `${r.name}${r.usage ? ` — ${r.usage}` : ''}`; list.append(li); }
  if (!view?.run?.relicList?.length) { const li = document.createElement('li'); li.textContent = '还没有藏品'; list.append(li); }
  $('relicbox').hidden = false;
});
$('relicclose').addEventListener('click', () => { $('relicbox').hidden = true; });
$('leavebtn').addEventListener('click', () => {
  ws?.send(JSON.stringify({ t: 'rogueLeave' }));
  try { sessionStorage.removeItem('ice.rogue.code'); } catch { /* ignore */ }
  runCode = null; view = null; $('run').hidden = true; $('setup').hidden = false; renderSetup();
});
$('shopleave').addEventListener('click', () => { $('shop').hidden = true; ws?.send(JSON.stringify({ t: 'rogueLeaveShop' })); });
$('again').addEventListener('click', () => { $('over').hidden = true; try { sessionStorage.removeItem('ice.rogue.code'); } catch { /* ignore */ } runCode = null; view = null; $('run').hidden = true; $('setup').hidden = false; renderSetup(); });

connect();
