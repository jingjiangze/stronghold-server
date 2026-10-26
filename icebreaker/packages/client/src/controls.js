// The battle controls (engine spec 同步-7, 同步-8, 合作-5): the 2× switch, pause and resume, answering the mate's pause
// request, asking the mate for cost and answering their request. What to show is a pure function of the control
// state and the open requests; the DOM part rebuilds the bar only when that changes.

/** @typedef {{ fast: number[], held: number, asker: number, resuming: number }} Control */
/**
 * The bar's state: the server's control state, the cost requests seen in the events (the seat asking, −1 for none),
 * this seat and the mate (−1 alone).
 * @typedef {{ control: Control | null, costAsker: number, seat: number, mate: number }} BarState
 */
/** @typedef {{ id: string, label: string, act: string, on?: boolean, disabled?: boolean }} Button */

/**
 * The buttons to show.
 * @param {BarState} s @returns {Button[]}
 */
export function controlButtons(s) {
  return [speedButton(s), ...pauseButtons(s), ...costButtons(s)];
}

/** The 2× switch, saying when only the mate has theirs on (同步-7). @param {BarState} s @returns {Button} */
function speedButton(s) {
  const c = s.control, mine = c?.fast[s.seat] === 1, theirs = s.mate >= 0 && c?.fast[s.mate] === 1;
  return { id: 'speed', label: `2倍速${theirs && !mine ? '（协作者已开启）' : ''}`, act: mine ? 'speed-off' : 'speed-on', on: mine };
}

/** Resume while paused; the answers to the mate's pause request; else asking to pause (同步-8). @param {BarState} s @returns {Button[]} */
function pauseButtons(s) {
  const c = s.control;
  if (c?.held) return [{ id: 'resume', label: c.resuming ? '即将继续…' : '继续', act: 'resume', disabled: c.resuming === 1 }];
  if (c && s.mate >= 0 && c.asker === s.mate) return [{ id: 'pause-yes', label: '同意暂停', act: 'pause-yes' }, { id: 'pause-no', label: '拒绝', act: 'pause-no' }];
  const asked = c?.asker === s.seat;
  return [{ id: 'pause', label: asked ? '已申请暂停…' : '暂停', act: 'pause', disabled: asked }];
}

/** The answers to the mate's cost request, else asking for cost; nothing alone (合作-5). @param {BarState} s @returns {Button[]} */
function costButtons(s) {
  if (s.mate < 0) return [];
  if (s.costAsker === s.mate) return [{ id: 'cost-yes', label: '同意划拨费用', act: 'cost-yes' }, { id: 'cost-no', label: '拒绝', act: 'cost-no' }];
  const asked = s.costAsker === s.seat;
  return [{ id: 'ask', label: asked ? '已请求费用…' : '请求费用', act: 'ask', disabled: asked }];
}

/**
 * The cost request open after a frame's events (合作-5): an `ask` opens one, an `answer` closes it.
 * @param {number} asker the seat asking before, −1 for none @param {Record<string, string | number>[]} events @returns {number}
 */
export function costAskerAfter(asker, events) {
  let out = asker;
  for (const e of events) {
    if (e.type === 'ask') out = Number(e.owner);
    else if (e.type === 'answer' && Number(e.owner) === out) out = -1;
  }
  return out;
}

/**
 * The bar in `root`; `act` runs a button's action. Returns an update taking the bar state.
 * @param {HTMLElement} root @param {(act: string) => void} act
 */
export function createControls(root, act) {
  let last = '';
  return (/** @type {BarState} */ s) => {
    const buttons = controlButtons(s), key = JSON.stringify(buttons);
    if (key === last) return;
    last = key;
    root.replaceChildren(...buttons.map((b) => {
      const el = document.createElement('button');
      el.id = `ctl-${b.id}`;
      el.textContent = b.label;
      el.disabled = b.disabled === true;
      if (b.on !== undefined) el.setAttribute('aria-pressed', String(b.on));
      el.addEventListener('click', () => act(b.act));
      return el;
    }));
  };
}
