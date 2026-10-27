// public/js/ui/meltdownOverlay.js — 海克斯熔毁协议 (this fork, 无尽模式)。
//
// 隐秘 Boss 打完后，服务端（server/match/match/meltdown.js）在 m.private.meltdown 里下发四栏：
//   ① 主盟约专属 6 阶装备 / ② 炫彩海克斯 / ③ 黄金海克斯 / ④ 白银海克斯
// 每栏限购 1 件（买过即「已售罄」），可以一件都不买直接关店。代价永久累计并写进敌人属性。
// 动作：`g.meltPick { slot }` / `g.meltClose`（MatchIntents）。
//
// 视觉：紫红配色，标题带 glitch 失真；点卡片时播放「红光 + 扫描 + 碎片飞散 + 数据流字符」。

import { html } from './components.js';
import { GIcon, Img } from './gameComponents.js';
import { bondIconUrl, itemIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { hexById } from '../../../shared/hexes.js';
import { HexGlyphIcon } from './hexGlyph.js';
import { useState } from '../../vendor/hooks.module.js';
import { t } from '../../../shared/i18n.js';

const COST_SHORT = { dmg: '敌方减伤', allStats: '敌方全属性', round: '每回合全属性', deploy: '部署回复' };
const COST_LABEL = {
  dmg: '敌方受到伤害减免',
  allStats: '本局剩余回合 · 敌方全属性',
  round: '敌方每回合全属性',
  deploy: '干员部署费用回复',
};
const GRADE_LABEL = { prismatic: '炫彩', gold: '黄金', silver: '白银' };
const GRADE_TIER = { prismatic: 'PRISMATIC', gold: 'GOLD', silver: 'SILVER' };

/** 熔毁动效：径向红闪 + 碎片飞散 + 数据流字符 + 扫描带。与原型一致，不依赖框架。 */
export function meltFx(cardEl, freeze) {
  if (!cardEl || typeof document === 'undefined') return;
  const r = cardEl.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'melt-layer';
  document.body.appendChild(layer);

  const flash = document.createElement('div');
  flash.className = 'melt-flash';
  flash.style.setProperty('--fx', r.left + r.width / 2 + 'px');
  flash.style.setProperty('--fy', r.top + r.height / 2 + 'px');
  document.body.appendChild(flash);

  const colors = ['rgba(168,85,247,.9)', 'rgba(255,45,85,.85)', 'rgba(232,121,201,.8)', 'rgba(120,60,180,.9)'];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('i');
    s.className = 'melt-shard';
    s.style.cssText = `left:${r.left + Math.random() * r.width}px;top:${r.top + Math.random() * r.height}px;`
      + `width:${14 + Math.random() * 36}px;height:${10 + Math.random() * 28}px;background:${colors[i % colors.length]};`
      + `--dx:${(Math.random() - 0.5) * 320}px;--dy:${30 + Math.random() * 220}px;`
      + `--rot:${(Math.random() - 0.5) * 240}deg;animation-delay:${Math.random() * 100}ms`;
    layer.appendChild(s);
  }

  const glyphs = '01░▒█¦│▚▞■□';
  for (let i = 0; i < 26; i++) {
    const b = document.createElement('span');
    b.className = 'melt-bit';
    b.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
    b.style.cssText = `left:${r.left + Math.random() * r.width}px;top:${r.top + Math.random() * r.height * 0.7}px;`
      + `--fall:${60 + Math.random() * 170}px;opacity:0;animation-delay:${Math.random() * 180}ms`;
    layer.appendChild(b);
  }

  const scan = document.createElement('div');
  scan.className = 'melt-scan';
  cardEl.appendChild(scan);
  cardEl.classList.add('is-melting');

  if (!freeze) {
    setTimeout(() => { cardEl.classList.remove('is-melting'); scan.remove(); }, 620);
    setTimeout(() => { flash.remove(); layer.remove(); }, 1000);
  }
}

/**
 * 卡面图标。装备用物品图；海克斯用**单色剪影** —— 盟约专属走 `iconBond` 的盟约形象（CSS mask），
 * 其余走 shared/hexes.js 的 `icon` 字形（GIcon，currentColor 天然是剪影）。与普通海克斯选择界面同一套规则。
 */
function cardIcon(c) {
  if (c.kind === 'gear') {
    const gearUrl = c.iconId ? itemIconUrl(data.get('assets'), c.iconId) : null;
    return html`<div class="melt__icon">
      ${gearUrl
        ? html`<${Img} src=${gearUrl} fallback=${html`<div class="melt__hex melt__hex--prismatic">✦</div>`} />`
        : html`<div class="melt__hex melt__hex--prismatic">✦</div>`}
    </div>`;
  }
  const h = c.hexId ? hexById(c.hexId) : null;
  // 双盟约 (v0.04.3)：两个盟约图标各一半 + 粒子（HexGlyphIcon 统一处理）
  return html`<div class=${`melt__icon melt__icon--hex melt__icon--${c.grade}`}>
    <${HexGlyphIcon} card=${h} cls="melt__glyph" assets=${data.get('assets')} />
  </div>`;
}

function cardBody(c, ctx = null) {
  if (c.exhausted) {
    return html`<div class="melt__dead">
      <div class="melt__dead-x">✕</div>
      <div class="melt__dead-t">${t('该品阶已售罄')}</div>
      <div class="melt__dead-s">${GRADE_LABEL[c.grade] || ''}${t('本栏装备已经全部登场')}<br />${t('本栏不再提供选项')}</div>
    </div>`;
  }
  const sign = c.cost && c.cost.type === 'deploy' ? '-' : '+';
  const tagCls = c.kind === 'gear' || c.grade === 'prismatic' ? 'melt__tag--violet' : c.grade === 'gold' ? 'melt__tag--red' : '';
  return html`
    <div class="melt__gain">
      <div class="melt__row">
        <span class="melt__tier">${c.kind === 'gear' ? 'EQUIP · VI' : c.kind === 'item' ? `EQUIP · ${c.tier || ''}` : GRADE_TIER[c.grade]}</span>
        <span class="melt__owner">${c.kind === 'gear' ? (c.owner || t('主盟约专属')) : GRADE_LABEL[c.grade]}</span>
      </div>
      ${cardIcon(c)}
      <h3 class="melt__name">${c.name}</h3>
      <div class="melt__tags">
        <span class=${`melt__tag ${tagCls}`}>${c.kind === 'gear' ? t('6 阶装备') : `${GRADE_LABEL[c.grade]}${t('装备')}`}</span>
        <span class="melt__tag">${c.kind === 'gear' ? t('主盟约专属') : t('装备')}</span>
      </div>
      <p class="melt__desc">${c.desc || ''}</p>
    </div>
    <div class="melt__cost">
      <div class="melt__cost-k">${t('代价 · 本局永久叠加')}</div>
      <div class="melt__cost-v">${sign}${c.cost ? c.cost.value : 0}<small>%</small></div>
      <div class="melt__cost-l">${COST_LABEL[c.cost ? c.cost.type : 'dmg'] || ''}</div>
    </div>
    ${ctx && ctx.pay === 'funds' ? html`<div class="melt__cost melt__cost--funds">
      <div class="melt__cost-k">${t('个人储备')}</div>
      <div class="melt__cost-v">${ctx.price}<small>${t(' 块')}</small></div>
      <div class="melt__cost-l">${ctx.funds >= ctx.price ? t('余额充足') : t('资金不足')}</div>
    </div>` : null}
    <div class="melt__stamp">${t('已售罄')}</div>`;
}

/**
 * @param {{ view: any, onPick?: (slot:number)=>void, onClose?: ()=>void }} props
 */
export function MeltdownOverlay({ view, onPick = () => {}, onClose = () => {} }) {
  const [pay, setPay] = useState('debuff');
  if (!view || !Array.isArray(view.cards) || !view.cards.length) return null;
  const prices = Array.isArray(view.prices) ? view.prices : [];
  const funds = Number(view.funds) || 0;
  const cards = view.cards;
  const sold = cards.filter((c) => c && c.sold).length;
  const debt = view.debt || {};
  const chips = [];
  if (debt.allStats > 0) chips.push({ gear: true, label: COST_SHORT.allStats, text: `+${debt.allStats}%` });
  if (debt.dmg > 0) chips.push({ label: COST_SHORT.dmg, text: `+${debt.dmg}%` });
  if (debt.round > 0) chips.push({ label: COST_SHORT.round, text: `+${debt.round}%` });
  if (debt.deploy > 0) chips.push({ label: COST_SHORT.deploy, text: `-${debt.deploy}%` });

  return html`<div class="melt" role="dialog" aria-modal="true" aria-label=${t('熔毁协议')}>
    <div class="melt__veil" aria-hidden="true"></div>
    <div class="melt__inner">
      <div class="melt__micro">MELTDOWN // PROTOCOL</div>
      <h2 class="melt__title" data-text=${t('熔毁协议')}>${t('熔毁协议')}</h2>
      <p class="melt__sub">${`${t('第')} ${view.wave || 1} ${t('次开启')}`}<span class="sep">·</span>${t('四栏各限购 1 件')}<span class="sep">·</span>${t('可以不买直接离开')}</p>

      <div class="melt__debts">
        <div class="melt__debts-k">${t('本局已激活代价')}</div>
        <div class="melt__chips">
          ${chips.length
            ? chips.map((c) => html`<span key=${c.label} class=${`melt__chip ${c.gear ? 'melt__chip--gear' : ''}`}>${c.label} <b>${c.text}</b></span>`)
            : html`<span class="melt__empty">${t('尚未激活任何代价')}</span>`}
        </div>
      </div>

      <div class="melt__grid">
        ${cards.map((c, i) => (c.exhausted
          ? html`<div key=${`dead${i}`} class="melt__card melt__card--dead">${cardBody(c)}</div>`
          : html`<div key=${c.kind === 'gear' ? 'gear' : c.itemId || c.hexId || `h${i}`}
              class=${`melt__card melt__card--${c.kind === 'gear' ? 'gear' : c.grade} ${c.sold ? 'is-sold' : ''}`}
              role="button" tabindex=${c.sold ? -1 : 0}
              onClick=${(e) => {
                if (c.sold) return;
                if (pay === 'funds' && !(funds >= (prices[i] || 0))) return;
                meltFx(e.currentTarget); onPick(i, pay);
              }}
              onKeyDown=${(e) => {
                if (c.sold) return;
                if (pay === 'funds' && !(funds >= (prices[i] || 0))) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(i, pay); }
              }}>
            ${cardBody(c, { pay, price: prices[i] || 0, funds })}
          </div>`))}
      </div>

      <div class="melt__foot">
        <button type="button" class="melt__close" onClick=${() => onClose()}>${t('关闭商店')}</button>
        <div class="melt__hint">
          <label class="melt__pay"><input type="checkbox" checked=${pay === 'funds'}
            onChange=${(e) => setPay(e.currentTarget.checked ? 'funds' : 'debuff')} />
            ${t('用个人储备购买（不叠代价）')}</label>
          <span class="melt__funds">${t('个人储备')} <b>${funds}</b></span>
        </div>
        <div class="melt__count">${t('已签')} <b>${sold}</b> / ${cards.length}</div>
      </div>
    </div>
  </div>`;
}
