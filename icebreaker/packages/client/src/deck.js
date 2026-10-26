// The deploy bar (M0.5): one button per operator (its avatar), four facing buttons. Clicking a tile deploys the selected
// operator there with the selected facing; the selection then clears.
import { DIR } from '@aue/schema';

const DIRS = [['→', DIR.RIGHT, '朝右'], ['↑', DIR.UP, '朝上'], ['←', DIR.LEFT, '朝左'], ['↓', DIR.DOWN, '朝下']];

/**
 * @param {HTMLElement} root
 * @param {{ id: string, name: string, avatar: string }[]} operators
 * @param {() => void} [changed] called when the selection or the facing changes
 * @returns {{ selected(): { op: string, dir: number } | null, clear(): void }}
 */
export function createDeck(root, operators, changed = () => {}) {
  let op = /** @type {string | null} */ (null), dir = /** @type {number} */ (DIR.RIGHT);
  /** @param {string} sel @param {(b: HTMLButtonElement) => boolean} on */
  const mark = (sel, on) => root.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-pressed', String(on(/** @type {HTMLButtonElement} */ (b)))));
  for (const o of operators) {
    const b = document.createElement('button');
    b.className = 'op';
    b.id = `op-${o.id.replace('#', '-')}`;
    b.title = o.name;
    b.dataset.op = o.id;
    b.setAttribute('aria-pressed', 'false');
    const img = document.createElement('img');
    img.src = o.avatar;
    img.alt = o.name;
    b.append(img);
    b.addEventListener('click', () => { op = op === o.id ? null : o.id; mark('.op', (x) => x.dataset.op === op); changed(); });
    root.append(b);
  }
  for (const [label, d, name] of DIRS) {
    const b = document.createElement('button');
    b.className = 'dir';
    b.id = `dir-${d}`;
    b.textContent = String(label);
    b.title = String(name);
    b.setAttribute('aria-pressed', String(d === dir));
    b.addEventListener('click', () => { dir = Number(d); mark('.dir', (x) => x.id === `dir-${dir}`); changed(); });
    root.append(b);
  }
  return {
    selected: () => (op ? { op, dir } : null),
    clear: () => { op = null; mark('.op', () => false); changed(); },
  };
}
