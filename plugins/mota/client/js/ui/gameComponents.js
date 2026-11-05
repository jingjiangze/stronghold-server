// Shared in-match building blocks (Preact + htm): data hook, images with fallbacks, rich text,
// unit thumbnails, LP tower, coin badge, official UI sprites. Styles: css/screens/game*.css.

import { useState, useMemo } from '../../vendor/hooks.module.js';
import { html, Icon, TierChip, Tooltip } from './components.js';
import { data, useData, localAsset } from '../data.js';
import { parseRichText, rtClassName } from './richText.js';
import { t as tr } from '../../../shared/i18n.js';
import {
  uiUrl, itemIconUrl, tokenAvatarUrl, enemyIconUrl, bondIconUrl, bandIconUrl,
} from './assetUrls.js';
// 头像统一走解析链（皮肤层）：`UnitThumb` 是结算页 / 队伍面板 / 手牌共用的小头像组件，
// 所以接这一处就等于把「时装也影响小头像」这件事一次接对所有消费点。
import { avatarUrlOf, currentAppearanceLookup } from './portraitChain.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Data files the in-match screens use (`backups`: the 补位 stand-ins' bodies — cards, the board model, the detail card). */
export const GAME_FILES = ['config', 'assets', 'chess', 'bonds', 'items', 'bands', 'enemies', 'bosses', 'stages', 'tokens',
  'choices', 'effects', 'garrisons', 'factions', 'local', 'backups'];

/**
 * Load every in-match data file; returns lookups (sync, null until loaded).
 * @returns {{ ready: boolean, m: any, config: any, chess: (id:string)=>any, bond: (id:string)=>any, item: (id:string)=>any,
 *   band: (id:string)=>any, enemy: (k:string)=>any, boss: (id:string)=>any, stage: (id:string)=>any, token: (id:string)=>any,
 *   effect: (id:string)=>any, garrison: (id:string)=>any, factions: any, choices: any, backups: any, list: (name:string)=>any[] }}
 */
export function useGameData() {
  const ready = useData(...GAME_FILES);
  // (config / factions / choices are read once per memo: a language switch reads them again in the new locale)
  return useMemo(() => makeLookups(ready), [ready, data.locale()]);
}

/** A 自选 operator's summon record (data/backups.json `tokens`, 0.2.0), or null. */
export function diyToken(id) {
  const t = typeof id === 'string' ? data.get('backups')?.tokens : null;
  return t && Object.hasOwn(t, id) ? t[id] : null;
}

/** Non-hook lookups (for event handlers). */
export function makeLookups(ready = true) {
  return {
    ready,
    m: data.get('assets'),
    config: data.get('config'),
    chess: (id) => data.lookup('chess', id),
    bond: (id) => data.lookup('bonds', id),
    item: (id) => data.lookup('items', id),
    band: (id) => data.lookup('bands', id),
    enemy: (k) => data.lookup('enemies', k),
    boss: (id) => data.lookup('bosses', id),
    stage: (id) => data.lookup('stages', id),
    // (a 自选 operator's summons are data/backups.json tokens — 0.2.0, the hand piece of a placeable one)
    token: (id) => data.lookup('tokens', id) || diyToken(id),
    effect: (id) => data.lookup('effects', id),
    garrison: (id) => data.lookup('garrisons', id),
    factions: data.get('factions'),
    choices: data.get('choices'),
    backups: data.get('backups'),
    list: (name) => data.list(name),
  };
}

/**
 * <img> that swaps to a fallback node when the URL is missing or fails.
 * @param {{ src?: string|null, class?: string, alt?: string, fallback?: any, style?: string }} props
 */
export function Img({ src, class: cls, alt = '', fallback = null, style, eager = false }) {
  const [bad, setBad] = useState(null);
  if (!src || bad === src) return fallback;
  // `eager` (2026-10-17): a picture that is on screen from the first frame — the shop cards — must not wait for the lazy
  // observer. Lazy loading pushed their first request to the busiest moment (shop refresh), which is why a card face
  // could trail the battle models even though the bytes are the same size.
  return html`<img class=${cls} src=${src} alt=${alt} draggable=${false} loading=${eager ? 'eager' : 'lazy'} style=${style}
    onError=${() => setBad(src)} />`;
}

/** Official UI sprite by 'group/key' with a fallback. */
export function Sprite({ k, class: cls, fallback = null }) {
  return html`<${Img} src=${uiUrl(data.get('assets'), k)} class=${cx('sprite', cls)} fallback=${fallback} />`;
}

/**
 * Official sprite from the local-client extraction (data/local-assets.json, DESIGN §13) with a fallback node when the
 * manifest / entry is missing or the image fails.
 * @param {{ group?: string, name: string, class?: string, fallback?: any }} props
 */
export function LocalSprite({ group = 'ui/battle', name, class: cls, fallback = null }) {
  return html`<${Img} src=${localAsset(group, name)} class=${cx('lsprite', cls)} fallback=${fallback} />`;
}

/**
 * Rich text (official markup) → spans. Newlines become <br>.
 * @param {{ text: any, class?: string, as?: string }} props
 */
export function RichText({ text, class: cls, as = 'span' }) {
  const segs = useMemo(() => parseRichText(text), [text]);
  const Tag = as;
  return html`<${Tag} class=${cx('rt', cls)}>${segs.map((s, i) => (s.br
    ? html`<br key=${i} />`
    : s.cls.length || s.term
      ? html`<span key=${i} class=${cx(s.cls.map((c) => rtClassName(c)), s.term && 'rt-term')}>${s.text}</span>`
      : s.text))}<//>`;
}

/** Golden (elite) chess? */
export const isGoldenPiece = (piece, chess) => !!(piece?.golden || chess?.isGolden || (typeof piece?.id === 'string' && /_b$/.test(piece.id) && piece.kind !== 'item'));

/**
 * Square unit thumbnail for a piece / chess / item / token / enemy: art + tier chip + elite frame.
 * @param {{ kind?: 'chess'|'item'|'token'|'enemy', id: string, golden?: boolean, size?: 'xs'|'sm'|'md'|'lg', tier?: number,
 *   showTier?: boolean, class?: string, dim?: boolean, badge?: any, title?: string, rec?: any }} props
 *   `rec`: the chess record to draw instead of the data's (a 自选 piece's composed record — 0.2.0, gameLogic/diy.js; a
 *   补位 stand-in's — gameLogic/standIn.js: drawn with a small 「替补」 mark in the corner)
 */
export function UnitThumb({ kind = 'chess', id, golden, size = 'md', tier, showTier = true, class: cls, dim = false, badge = null, title, rec = null }) {
  const m = data.get('assets');
  let src = null;
  let name = '';
  let t = tier;
  let si = null;
  if (kind === 'chess') {
    const c = rec || data.lookup('chess', id);
    si = rec && typeof rec.standInFor === 'string' && rec.standInFor ? rec : null;
    // 头像走**统一解析链**（皮肤层设计稿的开放问题 2：时装也影响小头像这一类）：
    // 这条链同时认「官方的内置皮肤」与「包声明的时装」，所以一个干员换了装之后，
    // 结算页 / 队伍面板 / 手牌 / 详情页看到的是**同一张**；没有外观提供者时与 `chessAvatarUrl` 逐字相同。
    src = avatarUrlOf(m, c, { lookup: currentAppearanceLookup() });
    name = c?.name || '';
    t = t ?? c?.tier;
    golden = golden ?? !!c?.isGolden;
  } else if (kind === 'item') {
    const it = data.lookup('items', id);
    src = itemIconUrl(m, it);
    name = it?.name || '';
    t = t ?? it?.tier;
    golden = golden ?? !!it?.isGolden;
  } else if (kind === 'token') {
    const tk = data.lookup('tokens', id);
    src = tokenAvatarUrl(m, id);
    name = tk?.name || '';
  } else if (kind === 'enemy') {
    const e = data.lookup('enemies', id);
    src = enemyIconUrl(m, id);
    name = e?.name || '';
  }
  const glyph = [...(name || '?')][0] || '?';
  return html`<span class=${cx('uthumb', `uthumb--${size}`, `uthumb--${kind}`, golden && 'is-golden', dim && 'is-dim', t && `uthumb--t${Math.max(1, Math.min(6, t | 0))}`, cls)}
      title=${title ?? name}>
    <span class="uthumb__art">
      <${Img} src=${src} fallback=${html`<span class="uthumb__glyph">${glyph}</span>`} />
    </span>
    ${showTier && t && kind !== 'enemy' && kind !== 'token' ? html`<${TierChip} tier=${t} golden=${golden} size="sm" class="uthumb__tier" />` : null}
    ${kind === 'token' ? html`<span class="uthumb__tag">${tr('召唤')}</span>` : null}
    ${si ? html`<span class="uthumb__si" data-standin=${si.charId} aria-hidden="true">${tr('替补')}</span>` : null}
    ${badge}
  </span>`;
}

/** Thumbnail for an m.private Piece. */
export function PieceThumb({ piece, size = 'md', class: cls, badge }) {
  if (!piece) return null;
  return html`<${UnitThumb} kind=${piece.kind === 'item' ? 'item' : piece.kind === 'token' ? 'token' : 'chess'} id=${piece.id}
    golden=${!!piece.golden} tier=${piece.tier} size=${size} class=${cls} badge=${badge} />`;
}

/**
 * A regular gear centred in the 24×24 box (even-odd path): `teeth` trapezoid teeth (width tipW at the tip circle
 * rTip, rootW at the root circle rRoot; the first one straight up), arcs along both circles, and a round hole. The
 * settings button's gear (user playtest #5 item 8): the hand-written path it replaces had teeth of different sizes
 * and spacing on a rim that was not round (it bulged at 9 o'clock and was cut flat elsewhere) — a deformed icon.
 * @param {{ teeth?: number, rTip?: number, rRoot?: number, tipW?: number, rootW?: number, rHole?: number }} [o]
 */
export function gearPath({ teeth = 8, rTip = 10, rRoot = 7.4, tipW = 3.2, rootW = 4.4, rHole = 3.3 } = {}) {
  const c = 12;
  const f = (v) => String(Math.round(v * 100) / 100 + 0);
  const pt = (a, r) => `${f(c + r * Math.cos(a))} ${f(c + r * Math.sin(a))}`;
  const at = Math.asin(tipW / 2 / rTip), ar = Math.asin(rootW / 2 / rRoot), step = (2 * Math.PI) / teeth;
  let d = `M${pt(-Math.PI / 2 - ar, rRoot)}`;
  for (let i = 0; i < teeth; i++) {
    const t = -Math.PI / 2 + i * step;
    d += `L${pt(t - at, rTip)}A${f(rTip)} ${f(rTip)} 0 0 1 ${pt(t + at, rTip)}L${pt(t + ar, rRoot)}`
      + `A${f(rRoot)} ${f(rRoot)} 0 0 1 ${pt(t + step - ar, rRoot)}`;
  }
  return `${d}ZM${f(c)} ${f(c - rHole)}A${f(rHole)} ${f(rHole)} 0 1 0 ${f(c)} ${f(c + rHole)}`
    + `A${f(rHole)} ${f(rHole)} 0 1 0 ${f(c)} ${f(c - rHole)}Z`;
}

/** Extra 24×24 glyphs used by the in-match HUD (original shapes). */
export const GLYPHS = Object.freeze({
  gear: gearPath(),
  eye: 'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  emote: 'M8.2 2h7.6L22 8.2v7.6L15.8 22H8.2L2 15.8V8.2zM8.5 8.5v3h2v-3zm5 0v3h2v-3zM7.8 14.2a5.5 5.5 0 0 0 8.4 0l-1.5-1.3a3.5 3.5 0 0 1-5.4 0z',
  dp: 'M13 2 4 13.5h6.2L9 22l11-12.5h-6.4z',
  skull: 'M12 2a8.5 8.5 0 0 0-5 15.4V21h3v-2h1v2h2v-2h1v2h3v-3.6A8.5 8.5 0 0 0 12 2zM8.5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  sell: 'M12 2 3 7v10l9 5 9-5V7zm-1 5h2v2.1c1.3.3 2.3 1.2 2.4 2.4h-2c-.1-.4-.6-.7-1.4-.7-.9 0-1.3.3-1.3.7 0 .4.3.6 1.6.9 1.9.4 3.2 1 3.2 2.6 0 1.2-1 2.1-2.5 2.4V19h-2v-1.6c-1.4-.3-2.5-1.2-2.6-2.6h2c.1.5.7.9 1.6.9 1 0 1.5-.3 1.5-.8 0-.4-.4-.6-1.8-.9-1.8-.4-3-1-3-2.5 0-1.2 1-2 2.3-2.3z',
  trash: 'M9 2h6l1 2h4v2H4V4h4zM5 7h14l-1.2 15H6.2zm4 3v9h2v-9zm4 0v9h2v-9z',
  back: 'M10 5 3 12l7 7 1.4-1.4L6.8 13H21v-2H6.8l4.6-4.6z',
  flag: 'M5 2h2v20H5zm3 1h11l-2.5 4.5L19 12H8z',
  target: 'M11 2h2v3.1A7 7 0 0 1 18.9 11H22v2h-3.1A7 7 0 0 1 13 18.9V22h-2v-3.1A7 7 0 0 1 5.1 13H2v-2h3.1A7 7 0 0 1 11 5.1zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  // ---- 怪物盟约图标（2026-11-05）：8 个没有官方 campLogo 的阵营 + 3 条通用 ----
  // 服务端 server/match/monsterBonds.js 的 MONSTER_BOND_GLYPH 下发的就是这些名字；有官方 PNG 的 14 个阵营走
  // `.mbond__img`，不在这里。全部是 24×24 单色原创剪影（与上面同风格），不是官方 logo 的描摹。
  // 整合运动：破碎盾形（盾面被一道锯齿裂缝劈开）
  'mb-reunion': 'M12 2.2 20.6 5.4V11.1L18.7 15.3 15.9 18.8 12 21.9 8.3 18.8 5.5 15.2 3.4 11.1V5.4ZM11.3 4.1 13.5 9.2 11.1 12.5 13.7 16 12 20.2 10.6 16.1 12.7 12.6 10.2 9.3Z',
  // 深池：水滴（环）+ 下方三道波纹
  'mb-deeppool': 'M12 1.6C12 1.6 6.6 7.4 6.6 11.2A5.4 5.4 0 0 0 17.4 11.2C17.4 7.4 12 1.6 12 1.6ZM12 5.6C12 5.6 9.3 8.7 9.3 10.7A2.7 2.7 0 0 0 14.7 10.7C14.7 8.7 12 5.6 12 5.6ZM4.2 18.8h4v2h-4zM10.2 18.8h4v2h-4zM16.2 18.8h4v2h-4z',
  // 萨卡兹：一对角 + 中间带棱的竖刃
  'mb-sarkaz': 'M4 2.4C6.9 3.9 8.8 6.6 9.2 10.1L6.9 10.6C6.5 7.6 5.5 5.4 3.2 4.1ZM20 2.4C17.1 3.9 15.2 6.6 14.8 10.1L17.1 10.6C17.5 7.6 18.5 5.4 20.8 4.1ZM11 8.6h2v11.6h-2zM8.5 10.2h1.3v8.6H8.5zM14.2 10.2h1.3v8.6h-1.3zM6.8 19.6h10.4v1.8H6.8z',
  // 海嗣：中央触手核 + 四根伸出的触须
  'mb-seaborn': 'M12 9.2A3.4 3.4 0 0 0 12 16A3.4 3.4 0 0 0 12 9.2ZM11 16.1C10.3 17.9 9 19.4 7.5 20.6 6.5 21.4 5.9 22.3 5.8 23.5L7.7 23.8C7.8 23 8.2 22.4 8.9 21.8 10.6 20.4 12.1 18.7 12.9 16.4ZM13 16.1C13.7 17.9 15 19.4 16.5 20.6 17.5 21.4 18.1 22.3 18.2 23.5L16.3 23.8C16.2 23 15.8 22.4 15.1 21.8 13.4 20.4 11.9 18.7 11.1 16.4ZM9 10.4C7.6 10.6 6.4 10.1 5.4 9.1 4.7 8.4 3.9 8.1 2.9 8.1L2.7 9.9C3.6 9.9 4.2 10.1 4.8 10.7 6.1 12 7.8 12.7 9.7 12.4ZM15 10.4C16.4 10.6 17.6 10.1 18.6 9.1 19.3 8.4 20.1 8.1 21.1 8.1L21.3 9.9C20.4 9.9 19.8 10.1 19.2 10.7 17.9 12 16.2 12.7 14.3 12.4Z',
  // 汐斯塔安保：盾 + 镂空五角星
  'mb-siesta': 'M12 2 21 5.2V11.3C21 16.5 17.4 20.4 12 22 6.6 20.4 3 16.5 3 11.3V5.2ZM12 7.2 13.06 9.94 15.99 10.1 13.71 11.96 14.47 14.8 12 13.2 9.53 14.8 10.29 11.96 8.01 10.1 10.94 9.94Z',
  // 杜林：小圆盾（外环 + 中心盾钉）
  'mb-durin': 'M12 3.6A8.4 8.4 0 0 0 12 20.4A8.4 8.4 0 0 0 12 3.6ZM12 5.4A6.6 6.6 0 0 1 12 18.6A6.6 6.6 0 0 1 12 5.4ZM12 9.4A2.6 2.6 0 0 0 12 14.6A2.6 2.6 0 0 0 12 9.4Z',
  // 源石协议：中央晶体（带一条刻面）+ 两侧碎块
  'mb-originium': 'M12 2.4 17 9.2 12 21.6 7 9.2ZM12 5.8 14.2 9.4 12 16.4 9.8 9.4ZM4.2 7.8 6.4 11.6 4.8 17.6 2.6 12.2ZM19.8 7.2 21.6 11.6 19.4 17.4 17.6 10.6Z',
  // 假想敌协议：虚线框 + 问号（缺口式轮廓，没有实物）
  'mb-imaginary': 'M3 3h4.4v1.8H3zM9.8 3h4.4v1.8H9.8zM16.6 3H21v1.8h-4.4zM3 6.6h1.8v4.4H3zM3 13.4h1.8v4H3zM19.2 6.6H21v4.4h-1.8zM19.2 13.4H21v4h-1.8zM3 19.2h4.4v1.8H3zM9.8 19.2h4.4v1.8H9.8zM16.6 19.2H21v1.8h-4.4zM9.4 9.4c0-2 1.3-3.3 3-3.3 1.9 0 3 1.1 3 2.8 0 1.5-.8 2.3-2.1 3-.9.5-1.2.9-1.2 1.9h-2c0-1.7.6-2.5 2-3.3.8-.4 1.1-.8 1.1-1.4 0-.6-.5-1-1.1-1-.7 0-1.1.5-1.1 1.3zM11.2 16.3h2v2h-2z',
  // 增援：向上箭头 + 右下加号
  'mb-reinforce': 'M12 2.6 19 10.4H14.6V15.4H9.4V10.4H5ZM16.8 16.4h2.2v2.2h2.2v2.2h-2.2v2.2h-2.2v-2.2h-2.2v-2.2h2.2z',
  // 会战：交叉双剑（中间一块菱形护手压住交点）
  'mb-concert': 'M19.8 2.8 21.2 4.2 5.2 20.2 3.8 18.8ZM4.2 2.8 2.8 4.2 18.8 20.2 20.2 18.8ZM12 9.8 14.2 12 12 14.2 9.8 12Z',
  // 回收：缺口圆环 + 箭头（循环）
  'mb-recover': 'M7.6 19.62A8.8 8.8 0 1 1 16.4 19.62L15.1 17.37A6.2 6.2 0 1 0 8.9 17.37ZM15.1 17.37 16.4 19.62 12.2 20.6Z',
});

/** Extra HUD glyph. */
export function GIcon({ name, class: cls, title }) {
  const d = GLYPHS[name];
  if (!d) return html`<${Icon} name=${name} class=${cls} title=${title} />`;
  return html`<svg class=${cx('icon', cls)} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden=${title ? undefined : 'true'} focusable="false">
    ${title ? html`<title>${title}</title>` : null}<path d=${d} fill-rule="evenodd" /></svg>`;
}

/**
 * Green LP tower + number. `pending` (> 0): the loss the running battle's leaks will cost at settlement (user
 * playtest #3 item 2) — the number keeps the settled LP (owner-approved #479 / #504),
 * shown in red with a −N tick that pops again on every change (keyed); `note` a
 * small tag after it (联防中); `tip` the title text.
 * @param {{ value: any, size?: 'sm'|'md'|'lg', class?: string, tone?: string|null, pending?: number, note?: string|null, tip?: string|null }} props
 */
export function LpTower({ value, size = 'md', class: cls, tone, pending = 0, note = null, tip = null }) {
  const ok = Number.isFinite(value);
  const p = ok && Number(pending) > 0 ? Math.min(value, Math.trunc(Number(pending))) : 0;
  return html`<span class=${cx('lp', `lp--${size}`, tone && `lp--${tone}`, p > 0 && 'is-pending', cls)} title=${tip || tr('目标生命值')}
      data-pending=${p > 0 ? p : null}>
    <${Sprite} k="hudPanel/icon_hp" class="lp__icon" fallback=${html`<${Icon} name="rook" class="lp__icon" />`} />
    <b class="num lp__val">${ok ? Math.max(0, value) : '--'}</b>
    ${p > 0 ? html`<span key=${p} class="lp__pend num" aria-label=${tr('结算时扣除 {p}', { p })}>−${p}</span>` : null}
    ${note ? html`<span class="lp__note">${note}</span>` : null}
  </span>`;
}

/** Coin glyph (three stacked gold triangles). */
export function CoinGlyph({ class: cls }) {
  return html`<svg class=${cx('coin-glyph', cls)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.5 16.2 10H7.8z" /><path d="M7 11.5 11.2 18H2.8z" /><path d="M17 11.5 21.2 18h-8.4z" />
  </svg>`;
}

/** Bond glyph image (white mask tinted by CSS) or first-letter fallback. */
export function BondGlyph({ bondId, class: cls }) {
  const b = data.lookup('bonds', bondId);
  const src = bondIconUrl(data.get('assets'), bondId);
  return html`<span class=${cx('bglyph', cls)} title=${b?.name || bondId}>
    <${Img} src=${src} fallback=${html`<span class="bglyph__txt">${[...(b?.name || '?')][0]}</span>`} />
  </span>`;
}

/** Band (strategy) icon. */
export function BandIcon({ bandId, class: cls, size = 'md' }) {
  const b = data.lookup('bands', bandId);
  return html`<span class=${cx('bandicon', `bandicon--${size}`, cls)} title=${b?.name || ''}>
    <${Img} src=${bandIconUrl(data.get('assets'), bandId)} fallback=${html`<span class="bandicon__txt">${[...(b?.name || '?')][0]}</span>`} />
  </span>`;
}

/** Item (equipment) icon with tier chip. */
export function ItemIcon({ itemId, class: cls, size = 'md', showTier = true }) {
  return html`<${UnitThumb} kind="item" id=${itemId} size=${size} class=${cls} showTier=${showTier} />`;
}

/** Tooltip-wrapped help text with rich markup. */
export function RichTip({ text, children, placement = 'top' }) {
  return html`<${Tooltip} text=${text ? html`<${RichText} text=${text} />` : null} placement=${placement}>${children}<//>`;
}

/**
 * Seat-coloured player avatar: band icon when a band is picked, else glyph/robot.
 * @param {{ player: any, size?: 'sm'|'md', self?: boolean, class?: string }} props
 */
export function PlayerAvatar({ player, size = 'md', self = false, class: cls }) {
  const src = player?.bandId ? bandIconUrl(data.get('assets'), player.bandId) : null;
  const glyph = [...(player?.name || '').trim()][0] || '?';
  // 促融共竞 (DESIGN §29): 被救援窗口扣住的座位是 `alive:false + pendingDeath:true` —— 画「等待救援」的沙漏，
  // 不画那个表示出局的 ✕（`pendingDeath` 只在开救援的模式里下发，普通模式没有这个键）。
  const waiting = player?.pendingDeath === true;
  const dead = !waiting && (player?.alive === false || player?.status === 'dead');
  const left = player?.status === 'left';
  const hue = [162, 196, 38, 280][((player?.seat | 0) % 4 + 4) % 4];
  return html`<span class=${cx('pavatar', `pavatar--${size}`, self && 'is-self', dead && 'is-dead', waiting && 'is-waiting', left && 'is-left', player?.isBot && 'is-bot',
      player?.connected === false && !player?.isBot && 'is-offline', cls)} style=${`--seat-hue:${hue}`}>
    <span class="pavatar__img">
      <${Img} src=${src} fallback=${player?.isBot ? html`<${Icon} name="robot" class="pavatar__bot" />` : html`<span class="pavatar__glyph">${glyph}</span>`} />
    </span>
    ${waiting ? html`<span class="pavatar__wait" aria-label=${tr('等待救援')}><${Icon} name="hourglass" /></span>` : null}
    ${dead ? html`<span class="pavatar__x" aria-label=${tr('已淘汰')}><${Icon} name="close" /></span>` : null}
    ${left ? html`<span class="pavatar__door" aria-label=${tr('已离开')}><${Icon} name="exit" /></span>` : null}
  </span>`;
}
