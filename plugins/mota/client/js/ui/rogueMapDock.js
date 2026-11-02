import { useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { buildMinimapModel } from './rogueMapModel.js';

/**
 * 肉鸽「地图」浮层（业主 2026-11-02：「地图做成类似局内对话的逻辑，可收缩」）。
 *
 * 交互照 `roomChat` / `rogueHud` 的范式：**整条头部就是一个 button**，点一下收起/展开（`▾ / ▸`），
 * 收起后只留一行「地图 · 当前关卡名 · R3/14」，不挡战场。
 *
 * 数据：`m.public` 的 `stageId / nextStageId / round / lastRound`（服务端 views 已经下发），
 * 地形来自 `stages` 数据文件（`rows` = 19 行字符串、index 0 在最下行；`tiles[码].groundPassable` 判可走；
 * `deployTiles.normal` 给出可部署格）。**不启动第二个棋盘渲染器**——这里只是静态缩略图。
 */
export function RogueMapDock({ pub, disabled = false }) {
  const [open, setOpen] = useState(true);
  const ready = useData('stages');
  if (disabled || !pub || !pub.rogue) return null;   // 只在肉鸽里出现（服务端只给肉鸽房下发 pub.rogue）
  // lookup 而不是 get：内容集/版本会通过 view 换掉整份 stages（data.js 的 setView）
  const get = (id) => (ready && id ? data.lookup('stages', id) : null);
  const stageId = pub.stageId || null;
  const nextId = pub.nextStageId && pub.nextStageId !== stageId ? pub.nextStageId : null;
  const stage = get(stageId);
  const next = get(nextId);
  const round = Number(pub.round) || 0;
  const last = Number(pub.lastRound) || 0;
  const title = stage && stage.name ? stage.name : (stageId || t('未知战场'));

  const mini = open ? minimap(stage) : null;
  return html`<div class="rmap" data-testid="rogue-map-dock"
      // 位置用 inset + 百分比：对局页的祖先可能带 transform（fixed 会相对它定位），bottom 的 rem 偏移在开场阶段算错过，
      // 改成「右侧中部」后两种情况都落在可预期的位置，也不压底部商店栏
      style="position:fixed;right:.6rem;top:18%;z-index:40;width:min(240px,42vw);font-size:12px;
             background:rgba(12,14,20,.86);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#e8eaf0;overflow:hidden">
    <button type="button" data-testid="rogue-map-toggle" onClick=${() => setOpen((v) => !v)}
      aria-expanded=${open}
      style="all:unset;cursor:pointer;display:flex;gap:.45rem;align-items:center;width:100%;padding:.4rem .55rem;box-sizing:border-box">
      <${Icon} name="rook" />
      <b>${t('地图')}</b>
      <span style="opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</span>
      ${last ? html`<span class="num" style="margin-left:auto;opacity:.7">R${round}/${last}</span>` : null}
      <span style="opacity:.6">${open ? '▾' : '▸'}</span>
    </button>
    ${open ? html`<div style="padding:0 .55rem .5rem">
      ${mini || html`<div style="opacity:.6;padding:.2rem 0">${t('战场缩略图待载入…')}</div>`}
      ${next ? html`<div style="margin-top:.35rem;opacity:.75">${t('下一场：')}${next.name || nextId}</div>` : null}
    </div>` : null}
  </div>`;
}

function minimap(stage) {
  const model = buildMinimapModel(stage);
  if (!model) return null;
  const { width, height, floor, marks } = model;
  const px = 6;
  const W = width * px;
  const H = height * px;
  const cells = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) cells.push({ x: c, y: height - 1 - r, ok: floor[r][c] });
  }
  const dots = marks.map((m) => ({ x: m.c, y: height - 1 - m.r, kind: m.kind }));
  return html`<svg viewBox=${`0 0 ${W} ${H}`} width="100%"
      style=${`display:block;max-width:100%;height:auto;border-radius:4px;background:rgba(255,255,255,.04)`}
      role="img" aria-label=${t('战场缩略图')}>
    ${cells.map((cell) => html`<rect key=${`${cell.y},${cell.x}`} x=${cell.x * px} y=${cell.y * px} width=${px} height=${px}
      fill=${cell.ok ? 'rgba(120,200,255,.30)' : 'rgba(255,255,255,.05)'} />`)}
    ${dots.map((d) => html`<circle key=${`d${d.y},${d.x}`} cx=${d.x * px + px / 2} cy=${d.y * px + px / 2} r=${px * 0.28}
      fill=${d.kind === 'melee' ? 'rgba(255,196,84,.9)' : 'rgba(140,240,180,.85)'} />`)}
  </svg>`;
}
