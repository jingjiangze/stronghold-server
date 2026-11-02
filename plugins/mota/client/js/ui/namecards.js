// plugins/mota/client/js/ui/namecards.js — 座位/大厅的名片卡面层（业主 2026-11-02）。
//
// 原文件是「本仓没有 public/js/ui/namecards.js 时装上」的兼容桩（直接 return null），所以房间座位卡、
// 大厅身份 chip 都不会出现名片。现在服务端在 room.state 里下发 seats[].nc（卡面素材 id，见 hello 的 nc 字段），
// 这里把它画成座位卡底图。素材路径由 cdn-local 兜底：本机没有就 302 到 CDN。

import { html } from '../ui/components.js';

/** 卡面素材目录（与账号插件 plugins/accounts 的 namecards.js 同一套 id） */
export const NAMECARD_DIR = '/assets/local/sp-namecards-20261014';

/** @param {string} id */
export const namecardUrl = (id) => (typeof id === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(id) ? `${NAMECARD_DIR}/${id}.webp` : '');

/**
 * 名片底图：铺满父容器（父容器需带 .has-nc）。card 可以是 { skin } 或裸 id。
 * @param {{ card?: { skin?: string } | string | null }} props
 */
export function NameCardLayer({ card }) {
  const id = typeof card === 'string' ? card : card && typeof card === 'object' ? card.skin : '';
  const url = namecardUrl(id);
  if (!url) return null;
  return html`<span class="nc-layer" aria-hidden="true" style=${`background-image:url(${url})`}></span>`;
}
