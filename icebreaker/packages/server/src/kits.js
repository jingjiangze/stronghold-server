// The pinned Stronghold kits (ADR 0058 of the engine, its compat spec 兼容-6): where the server finds the pinned commit,
// the /k/ route that serves its content files to the page's Worker with their imports of Stronghold engine modules
// rewritten to the engine's compat modules (by the engine's own mapping table, so the browser never rewrites), and the
// kits loaded under Node for the arbiter.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { init, parse } from 'es-module-lexer';
import { KIT_SOURCE, loadKits, mappedUrl } from '@aue/content';
import { isRejection, locateFile, rawPathname, splitPath } from './paths.js';
import { allowReadOnly, etagOf, sendBody, sendRejection, sendText } from './respond.js';
import { relativeUrl } from './rewrite.js';
import { IMMUTABLE } from './assets.js';

await init;

/** The URL prefix of the kits' content files. */
export const KIT_PREFIX = '/k/';
/** The content files of the pinned commit: only these are served. */
const CONTENT = 'server/sim/content/';
/** A made-up origin to resolve imports against; only the paths are kept. */
const ORIGIN = 'http://kit.invalid';
const JS = new Map([['.js', 'text/javascript; charset=utf-8']]);

/**
 * Where the pinned commit is: AUE_KITS_DIR, else the engine's oracle cache; null when it is not there.
 * @param {string} rootDir the platform repository root
 */
export function kitDir(rootDir) {
  const dir = process.env['AUE_KITS_DIR'] || join(rootDir, 'engine', '.cache', 'oracle', `stronghold-${KIT_SOURCE.sha.slice(0, 12)}`);
  return existsSync(join(dir, CONTENT)) ? dir : null;
}

/**
 * A content file's source with its imports of Stronghold engine modules pointed at the engine's compat modules under
 * /m/, relative to the file's own URL (站点-1); imports of other content files stay as they are. Under a version of the
 * code (/k/~<version>/, 站点-4) the compat modules are those under /m/~<version>/, the ones the page's modules import.
 * @param {string} source @param {string} rel the file's path from the commit's root @param {string | null} [version]
 */
export function rewriteKitImports(source, rel, version = null) {
  const [imports] = parse(source), at = version ? `~${version}/` : '';
  const prefix = `${KIT_PREFIX}${at}`, root = `${ORIGIN}${prefix}`, compat = `${ORIGIN}/m/${at}@aue/content/src/compat/`;
  let out = source;
  for (const imp of [...imports].reverse()) {
    const spec = imp.specifier;
    if (typeof spec !== 'string' || !(spec.startsWith('./') || spec.startsWith('../'))) continue;
    const to = mappedUrl(root, new URL(spec, root + rel).href, compat);
    if (to === null) continue;
    const path = relativeUrl(prefix + rel, to.slice(ORIGIN.length));
    out = out.slice(0, imp.start) + (imp.type === 'dynamic' ? JSON.stringify(path) : path) + out.slice(imp.end);
  }
  return out;
}

/**
 * The /k/ route: the pinned commit's content files, rewritten (cached by file and version while its mtime holds);
 * /k/~<version>/ under a version of the code (站点-4), kept for a year when it is today's.
 * @param {string | null} dir the pinned commit, or null: every /k/ request is 404
 * @param {() => string} [version] the code's version
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean}
 */
export function createKitHandler(dir, version = () => '') {
  /** @type {Map<string, { mtimeMs: number, body: Buffer, etag: string }>} */
  const cache = new Map();
  return (req, res) => {
    const raw = rawPathname(req.url);
    if (!raw.startsWith(KIT_PREFIX)) return false;
    const m = /^\/k\/~([0-9a-f]{1,32})\//.exec(raw), v = m ? m[1] : null, path = m ? KIT_PREFIX + raw.slice(m[0].length) : raw;
    if (dir === null || !path.startsWith(KIT_PREFIX + CONTENT)) { sendText(res, 404, 'not found'); return true; }
    serve(req, res, path.slice(KIT_PREFIX.length + CONTENT.length), v).catch(() => sendText(res, 500, 'internal error'));
    return true;
  };

  /**
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {string} rest
   * @param {string | null} v the version in the URL
   */
  async function serve(req, res, rest, v) {
    if (!allowReadOnly(req, res)) return;
    const segments = splitPath(rest);
    if (isRejection(segments)) return sendRejection(res, segments);
    const found = await locateFile(join(/** @type {string} */ (dir), CONTENT), segments, JS);
    if (isRejection(found)) return sendRejection(res, found);
    const key = `${v ?? ''}:${found.file}`;
    let hit = cache.get(key);
    if (hit?.mtimeMs !== found.mtimeMs) {
      const body = Buffer.from(rewriteKitImports(await readFile(found.file, 'utf8'), CONTENT + segments.join('/'), v));
      hit = { mtimeMs: found.mtimeMs, body, etag: etagOf(body) };
      cache.set(key, hit);
    }
    sendBody(req, res, { body: hit.body, type: found.type, etag: hit.etag, ...(v !== null && v === version() ? { cache: IMMUTABLE } : {}) });
  }
}

/** Whether the compat hook is registered in this process. */
let hooked = '';

/**
 * The kits of the given operators loaded under Node for the arbiter (兼容-6): the compat hook registered once for the
 * pinned commit, then the engine's loader.
 * @param {string} dir the pinned commit @param {Iterable<string>} charIds
 */
export async function nodeKits(dir, charIds) {
  const root = pathToFileURL(`${dir}/`).href;
  if (hooked !== root) {
    const compat = new URL('./compat/', import.meta.resolve('@aue/content')).href;
    register(new URL('hook.js', compat), { data: { root, compat } });
    hooked = root;
  }
  return loadKits(root, charIds);
}
