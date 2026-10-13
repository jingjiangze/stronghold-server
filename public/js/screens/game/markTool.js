// public/js/screens/game/markTool.js — the 促融共竞 标记 tool (P6, PRTS main.raw 699–703): pick a kind, then tap a tile
// on the field (screens/game.js tileClick → g.mark). Both sides see the marks — the partner's in green — and each side
// keeps one active mark (the server replaces the previous one). The button lives in the gm__corner cluster beside the
// emote wheel; the kind menu is a small popover so the field stays visible while placing.

import { html } from '../../ui/components.js';
import { GIcon } from '../../ui/gameComponents.js';
import { t, N_ } from '../../../../shared/i18n.js';
import { cx, MARK_KINDS } from './marks.js';

const KIND_NAME = { mark: N_('标记'), note: N_('注意'), retreat: N_('撤退') };

/**
 * @param {{ open: boolean, kind: string|null, disabled?: boolean, onOpen: (open: boolean) => void, onPick: (kind: string|null) => void }} props
 *   kind: the armed kind (the next field tap places it); onPick(null) disarms.
 */
export function MarkTool({ open, kind, disabled = false, onOpen, onPick }) {
  const tip = kind ? t('点选战场格子放置标记（点击按钮可收起）') : t('标记：点选格子放置，双方可见');
  return html`<div class="marktool">
    ${open ? html`<div class="marktool__menu" role="menu" aria-label=${t('放置标记')}>
      ${MARK_KINDS.map((k) => html`<button key=${k} type="button" role="menuitem" class=${cx('marktool__kind', `is-${k}`, kind === k && 'is-active')}
          data-testid=${`mark-kind-${k}`} onClick=${() => onPick(k)}>${t(KIND_NAME[k])}</button>`)}
      <button type="button" role="menuitem" class="marktool__kind is-cancel" data-testid="mark-cancel" onClick=${() => onPick(null)}>${t('收起')}</button>
    </div>` : null}
    <button type="button" class=${cx('gm__gear', 'marktool__btn', kind && 'is-armed')} aria-label=${t('标记')} aria-expanded=${open ? 'true' : 'false'}
        title=${tip} disabled=${disabled} data-testid="mark-tool" onClick=${() => onOpen(!open)}><${GIcon} name="flag" /></button>
  </div>`;
}
