// Bare import specifiers to URLs. Module Workers ignore import maps, so the server rewrites the source it serves; the
// lexer (es-module-lexer) reads real syntax, so comments and strings that mention "import" are never touched.
import { init, parse } from 'es-module-lexer';

await init;

/** A bare specifier is a package name: not relative, not absolute, not a URL. @param {string} spec */
export function isBare(spec) {
  return !spec.startsWith('.') && !spec.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(spec);
}

/**
 * A site path relative to the module at another site path (站点-1: the site may sit under any path, so what the
 * server writes into a module never starts from the root): "./x.js", "../../y/z.js".
 * @param {string} from the importing module's path, from the root ("/m/@aue/sim/src/a.js")
 * @param {string} to the imported path, from the root
 */
export function relativeUrl(from, to) {
  const a = from.split('/').slice(0, -1), b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.length - i;
  return (up === 0 ? './' : '../'.repeat(up)) + b.slice(i).join('/');
}

/**
 * The suffix of a JSON module served as a script (站点-4): `x.json.js` is `export default` of `x.json`, so a page
 * imports its data the same way in every engine — Chromium before 123 reads no import attributes (`with { type:
 * 'json' }`) and refused the whole page for one such line.
 */
export const JSON_SCRIPT = '.js';

/**
 * Whether a static import loads JSON (its attribute `type: 'json'`). @param {{ type: string, attributes?: ReadonlyArray<readonly [string, string]> | null }} imp
 */
export const jsonImport = (imp) => imp.type === 'static' && Array.isArray(imp.attributes) && imp.attributes.some(([k, v]) => k === 'type' && v === 'json');

/**
 * What replaces one import's specifier (and, for a JSON import, its attributes), or null to leave it: a bare
 * specifier's URL; a JSON file's script (站点-4). @param {any} imp @param {(spec: string) => string | null} resolveUrl
 * @returns {{ text: string, json: boolean } | null}
 */
function replacementOf(imp, resolveUrl) {
  const spec = imp.specifier, dynamic = imp.type === 'dynamic';
  if (typeof spec !== 'string' || (dynamic && imp.glob)) return null;
  const bare = isBare(spec);
  if (!bare && !jsonImport(imp)) return null;
  const url = bare ? resolveUrl(spec) : spec;
  if (url === null) throw new Error(`cannot resolve the bare specifier "${spec}"`);
  const json = jsonImport(imp) && url.endsWith('.json');
  if (!bare && !json) return null;
  // A dynamic import's range includes the quotes; a static one's does not.
  return { text: dynamic ? JSON.stringify(url) : json ? `${url}${JSON_SCRIPT}` : url, json };
}

/**
 * @param {string} source
 * @param {(spec: string) => string | null} resolveUrl the URL for a bare specifier, or null when it cannot be resolved
 * @returns {string} the source with every literal bare specifier replaced, and every JSON import made the import of
 *   its script (`x.json.js`, without the attributes)
 */
export function rewriteImports(source, resolveUrl) {
  const [imports] = parse(source);
  let out = source;
  // From the end so the earlier offsets stay valid.
  for (const imp of [...imports].reverse()) {
    const r = replacementOf(imp, resolveUrl);
    if (r === null) continue;
    // the attributes go first, after the specifier's closing quote: they lie after what the next line replaces
    if (r.json) out = out.slice(0, imp.end + 1) + out.slice(out.lastIndexOf('}', imp.importEnd) + 1);
    out = out.slice(0, imp.start) + r.text + out.slice(imp.end);
  }
  return out;
}
