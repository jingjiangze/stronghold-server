// /m/<pkg>/<path>: files of the workspace and third-party packages for the page and its module Worker, with bare
// import specifiers rewritten to the /m/ URLs, relative to the importing module (站点-1). /m/~<version>/<pkg>/<path> is
// the same file under the code's version (站点-4): kept for a year when the version is today's, so a page loaded
// again asks for none of its modules; an old version's URL gets today's file without being kept.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'es-module-lexer';
import { versionOf } from './build.js';
import { IMMUTABLE } from './assets.js';
import { isRejection, locateFile, rawPathname, splitPath } from './paths.js';
import { resolveSpecifier, splitSpecifier } from './resolve.js';
import { allowReadOnly, etagOf, sendBody, sendRejection, sendText } from './respond.js';
import { isBare, jsonImport, relativeUrl, rewriteImports, JSON_SCRIPT } from './rewrite.js';
import { reachablePackages } from './workspace.js';

const PREFIX = '/m/';

/** @type {ReadonlyMap<string, string>} */
const MODULE_TYPES = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
]);

/** @param {string} path @returns {string} the URL of a package file */
export function moduleUrl(path) {
  return PREFIX + path.split('/').map((s, i) => (s.startsWith('@') && i === 0 ? s : encodeURIComponent(s))).join('/');
}

/**
 * A module URL path without its version: "/m/~abc/@x/y.js" → { path: "/m/@x/y.js", version: "abc" }.
 * @param {string} path @returns {{ path: string, version: string | null }}
 */
export function unversioned(path) {
  const m = /^\/m\/~([0-9a-f]{1,32})\//.exec(path);
  return m ? { path: PREFIX + path.slice(m[0].length), version: m[1] } : { path, version: null };
}

/**
 * @param {ReadonlyMap<string, string>} workspace
 * @returns {(spec: string) => string | null}
 */
function urlResolver(workspace) {
  return (spec) => {
    const r = resolveSpecifier(spec, workspace);
    return r === null ? null : moduleUrl(`${r.pkg}/${r.subpath}`);
  };
}

/**
 * Splits "@aue/sim/src/x.js" into the package and the path inside it.
 * @param {string[]} segments
 * @returns {{ pkg: string, inner: string[] } | null}
 */
function splitPackage(segments) {
  const s = splitSpecifier(segments.join('/'));
  if (s === null || s.rest === '') return null;
  return { pkg: s.name, inner: segments.slice(s.name.split('/').length) };
}

/**
 * The modules a module imports statically (its import and export ... from declarations), as unversioned /m/ paths.
 * @param {string} source @param {string} from its own /m/ path @param {(spec: string) => string | null} resolveUrl
 */
function staticImports(source, from, resolveUrl) {
  const [imports] = parse(source), base = new URL(from, 'http://m.invalid');
  /** @type {string[]} */
  const out = [];
  for (const imp of imports) {
    const spec = imp.specifier;
    if (imp.type !== 'static' || typeof spec !== 'string' || imp.typeOnly) continue;
    const url = isBare(spec) ? resolveUrl(spec) : new URL(spec, base).pathname;
    // a JSON import is served as its script (站点-4), which is what the page then asks for
    if (url && url.startsWith(PREFIX)) out.push(jsonImport(imp) && url.endsWith('.json') ? url + JSON_SCRIPT : url);
  }
  return out;
}

/**
 * A JSON file as a script (站点-4): `export default` of its data, read by JSON.parse (the same object JSON.parse
 * gives, a key "__proto__" too); kept in `cache` while the mtime holds.
 * @param {Map<string, { mtimeMs: number, body: Buffer, etag: string, deps: string[] }>} cache @param {string} file @param {number} mtimeMs
 */
async function jsonScript(cache, file, mtimeMs) {
  const key = `${file}${JSON_SCRIPT}`, hit = cache.get(key);
  if (hit?.mtimeMs === mtimeMs) return hit;
  const text = (await readFile(file)).toString('utf8');
  const body = Buffer.from(`export default JSON.parse(${JSON.stringify(text)});\n`);
  const entry = { mtimeMs, body, etag: etagOf(body), deps: [] };
  cache.set(key, entry);
  return entry;
}

/**
 * The handler of /m/, with `version()` — the code's version (站点-4) — and `graph(entry)`: the modules an entry module
 * imports statically, at any depth, breadth first (the entry first), as unversioned /m/ paths.
 * @param {{ workspace: ReadonlyMap<string, string>, browserPackages: Iterable<string> }} o
 * @returns {((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean)
 *   & { version: () => string, graph: (entry: string) => Promise<string[]> }}
 */
export function createModuleHandler({ workspace, browserPackages }) {
  const servable = reachablePackages(new Map(workspace), browserPackages);
  const resolveUrl = urlResolver(workspace);
  const dirs = [...servable].map((p) => /** @type {string} */ (workspace.get(p)));
  const version = versionOf(dirs.filter((d) => !/[\\/]node_modules[\\/]/.test(d)), dirs.filter((d) => /[\\/]node_modules[\\/]/.test(d)).map((d) => join(d, 'package.json')));
  /** Rewritten bodies by real file path; valid while the mtime holds. @type {Map<string, { mtimeMs: number, body: Buffer, etag: string, deps: string[] }>} */
  const cache = new Map();

  /** @param {string} file @param {number} mtimeMs @param {string} type @param {string} from the module's unversioned URL path */
  async function load(file, mtimeMs, type, from) {
    const hit = cache.get(file);
    if (hit?.mtimeMs === mtimeMs) return hit;
    const raw = await readFile(file);
    const toUrl = (/** @type {string} */ spec) => { const url = resolveUrl(spec); return url === null ? null : relativeUrl(from, url); };
    const js = type.startsWith('text/javascript'), text = js ? raw.toString('utf8') : '';
    const body = js ? Buffer.from(rewriteImports(text, toUrl)) : raw;
    const entry = { mtimeMs, body, etag: etagOf(body), deps: js ? staticImports(text, from, resolveUrl) : [] };
    cache.set(file, entry);
    return entry;
  }

  /** A servable file by its unversioned path (the part after /m/), or why not. @param {string} rest */
  async function locate(rest) {
    const segments = splitPath(rest);
    if (isRejection(segments)) return segments;
    const target = splitPackage(segments);
    const dir = target === null ? undefined : workspace.get(target.pkg);
    if (target === null || dir === undefined || !servable.has(target.pkg)) return { status: 404, message: 'not found' };
    return locateFile(dir, target.inner, MODULE_TYPES);
  }

  /** A module by its unversioned path, or why not: `x.json.js` is the script of `x.json` (站点-4). @param {string} rest the path after /m/ */
  async function find(rest) {
    const script = rest.endsWith(`.json${JSON_SCRIPT}`);
    const found = await locate(script ? rest.slice(0, -JSON_SCRIPT.length) : rest);
    if (isRejection(found)) return found;
    if (script) return { ...(await jsonScript(cache, found.file, found.mtimeMs)), type: 'text/javascript; charset=utf-8' };
    return { ...(await load(found.file, found.mtimeMs, found.type, PREFIX + rest)), type: found.type };
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {string} path */
  async function serve(req, res, path) {
    if (!allowReadOnly(req, res)) return;
    const u = unversioned(path), m = await find(u.path.slice(PREFIX.length));
    if (isRejection(m)) return sendRejection(res, m);
    sendBody(req, res, { body: m.body, type: m.type, etag: m.etag, ...(u.version !== null && u.version === version() ? { cache: IMMUTABLE } : {}) });
  }

  /** @param {string} entry */
  async function graph(entry) {
    const seen = new Set([entry]), order = [entry];
    for (let i = 0; i < order.length; i++) {
      const m = await find(order[i].slice(PREFIX.length));
      if (isRejection(m)) continue;
      for (const d of m.deps) if (!seen.has(d)) { seen.add(d); order.push(d); }
    }
    return order;
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  const handler = (req, res) => {
    const path = rawPathname(req.url);
    if (!path.startsWith(PREFIX)) return false;
    serve(req, res, path).catch((err) => {
      if (res.headersSent) return res.destroy();
      sendText(res, 500, err instanceof Error ? err.message : 'internal error');
    });
    return true;
  };
  return Object.assign(handler, { version, graph });
}
