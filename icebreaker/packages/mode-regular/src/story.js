// The game's texts as the mode's data keeps them (docs/spec/room.md 房间-11, page.md 页面-6): its markup as Unity rich
// text, and its story scripts as commands. Pure; tools/extract-activity.js uses them on the game's data.

/**
 * The game's markup `<@style>text</>` as Unity rich text by the game's styles (`richTextStyles`, e.g. `<color=#D4133C>{0}</color>`);
 * a style it does not know keeps only its text; the text's written line breaks (`\n`) as line breaks.
 * @param {string} s @param {Record<string, string>} styles
 */
export const richText = (s, styles) => s.replace(/<@([\w.]+)>([\s\S]*?)<\/>/g, (_, k, t) => (styles[k] ? styles[k].replace('{0}', t) : t)).replace(/\\n/g, '\n');

/** A story command's argument value: a quoted text, a number, true or false, else the text as written. @param {string} v */
function argValue(v) {
  const t = v.trim();
  if (/^".*"$/.test(t)) return t.slice(1, -1);
  if (t === 'true' || t === 'false') return t === 'true';
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

/** A story command's arguments (`a=1, b="x"`), split at the commas outside quotes. @param {string} s @returns {Record<string, string | number | boolean>} */
function argsOf(s) {
  /** @type {Record<string, string | number | boolean>} */
  const out = {};
  for (const part of s.match(/(?:[^,"]|"[^"]*")+/g) ?? []) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = argValue(part.slice(i + 1));
  }
  return out;
}

/**
 * A story script (房间-11): its commands in order, each with its arguments and its text (the game's markup as rich
 * text); a line ending in a backslash goes on in the next; the header and empty lines are left out.
 * @param {string} text @param {Record<string, string>} styles @returns {{ cmd: string, args: Record<string, string | number | boolean>, text?: string }[]}
 */
export function storyOf(text, styles) {
  const lines = text.replace(/\r/g, '').replace(/\\[ \t]*\n[ \t]*/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.flatMap((l) => {
    const m = /^\[([\w.]+)(?:\((.*)\))?\]\s*(.*)$/.exec(l);
    if (!m || m[1] === 'HEADER') return [];
    return [{ cmd: m[1], args: argsOf(m[2] ?? ''), ...(m[3] ? { text: richText(m[3], styles) } : {}) }];
  });
}
