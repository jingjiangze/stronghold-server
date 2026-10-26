// A small element builder for the room page: h('button', { onclick, disabled }, '文字').

/** @typedef {Node | string | number | null | undefined | false} Child */

/** Properties an element has only as getters: set as attributes. */
const READ_ONLY = new Set(['list', 'form']);

/** One property: a listener, the class, a property the element has, or an attribute. @param {any} el @param {string} k @param {any} v */
function setProp(el, k, v) {
  if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
  else if (k === 'class') el.className = v;
  else if (k in el && !READ_ONLY.has(k)) el[k] = v;
  else if (v !== false) el.setAttribute(k, v === true ? '' : String(v));
}

/**
 * An element with its properties (on…: listeners; class; properties the element has, like value or disabled; else
 * attributes) and children (null, undefined and false are skipped; arrays are flattened).
 * @param {string} tag @param {Record<string, any>} [props] @param {...(Child | Child[])} kids @returns {HTMLElement}
 */
export function h(tag, props = {}, ...kids) {
  const el = /** @type {any} */ (document.createElement(tag));
  for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== null) setProp(el, k, v);
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}
