// The host's data mods (docs/spec/site.md 站点-7, the engine's mod-10): read once at start from the mods folder — the
// --mods option, else AUE_MODS_DIR, else <root>/mods — and laid over the official content in their load order; what
// became of each is logged. The page and its Worker read the list at /mods/index.json and each listed data file at
// /mods/<id>/<path>, served from memory as the server read it; nothing else under /mods/.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENGINE_VERSION, MOD_INDEX_VERSION } from '@aue/schema';
import { OFFICIAL_SOURCE, createSource, modIndex } from '@aue/content';
import { readModFolders } from '@aue/sdk';
import { rawPathname } from './paths.js';
import { allowReadOnly, sendBody, sendText } from './respond.js';

/** Where the mods are served. */
export const MODS_PREFIX = '/mods/';
const JSON_TYPE = 'application/json; charset=utf-8';

/**
 * The host's mods: the content source the battles use, the list the pages read, the files by their path on the site,
 * and the log's lines.
 * @typedef {{ source: import('@aue/content').ContentSource, index: import('@aue/content').ModIndex, files: Map<string, Buffer>, lines: string[], reports?: readonly import('@aue/content').ModReport[], skipped?: { id: string, problems: string[] }[] }} HostMods
 */

/** No mods: the official content and an empty list. @type {HostMods} */
export const NO_MODS = Object.freeze({ source: OFFICIAL_SOURCE, index: { version: MOD_INDEX_VERSION, engine: ENGINE_VERSION, mods: [] }, files: new Map(), lines: [] });

/**
 * The mods folder (站点-7): the --mods option, else AUE_MODS_DIR, else <root>/mods; null when it is not there.
 * @param {string} rootDir @param {readonly string[]} argv @param {Record<string, string | undefined>} env @returns {string | null}
 */
export function modsDir(rootDir, argv, env) {
  const i = argv.indexOf('--mods'), dir = i >= 0 ? argv[i + 1] : env['AUE_MODS_DIR'] || join(rootDir, 'mods');
  return dir && existsSync(dir) ? resolve(dir) : null;
}

/** @param {import('@aue/content').ModReport} r @returns {string[]} a mod's lines in the log */
const reportLines = (r) => [
  `mod ${r.id}${r.version ? ` ${r.version}` : ''}: ${r.loaded ? `loaded, adds ${r.added?.length ?? 0} and changes ${r.changed?.length ?? 0} records` : 'not loaded'}`,
  ...r.problems.map((p) => `  problem: ${p}`), ...r.warnings.map((w) => `  warning: ${w}`),
];

/**
 * The mods of a folder laid over the official content (站点-7); none, or no folder: the official content and an empty list.
 * @param {string | null} dir @returns {Promise<HostMods>}
 */
export async function loadHostMods(dir) {
  const { inputs, skipped } = dir ? readModFolders(dir) : { inputs: [], skipped: [] };
  const source = inputs.length > 0 ? await createSource(inputs) : OFFICIAL_SOURCE, index = modIndex(inputs, source);
  const byId = new Map(inputs.map((i) => [i.id, i])), files = new Map();
  for (const m of index.mods) for (const f of m.files) files.set(`${MODS_PREFIX}${m.id}/${f.path}`, Buffer.from(byId.get(m.id)?.files[f.path] ?? '', 'utf8'));
  const lines = [
    ...skipped.flatMap((s) => [`mod ${s.id}: not loaded`, ...s.problems.map((p) => `  problem: ${p}`)]),
    ...source.reports.flatMap(reportLines), ...source.conflicts.map((c) => `mod conflict: ${c}`),
    `mods: ${index.mods.length ? index.mods.map((m) => `${m.id} ${m.version}`).join(', ') : 'none'}${dir ? ` (${dir})` : ''}`,
  ];
  // reports / skipped are for the mod manager's page (what loaded, what did not and why); the wire keeps only `index`.
  return { source, index, files, lines, reports: source.reports, skipped };
}

/**
 * The /mods/ handler (站点-7): the list, and the files it names; anything else under /mods/ is 404.
 * `mods` may be a function (the mod manager swaps the whole set on reload): every request reads the current set.
 * @param {HostMods | (() => HostMods)} mods
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean}
 */
export function createModsHandler(mods) {
  // `mods` may be a function: the mod manager swaps the whole set on reload, and every request reads the current one
  // (the list and the files are small; serializing the index per request keeps a reload from needing a new handler).
  const current = () => (typeof mods === 'function' ? mods() : mods);
  return (req, res) => {
    const path = rawPathname(req.url);
    if (!path.startsWith(MODS_PREFIX)) return false;
    if (!allowReadOnly(req, res)) return true;
    const now = current();
    const body = path === `${MODS_PREFIX}index.json` ? Buffer.from(JSON.stringify(now.index), 'utf8') : now.files.get(path);
    if (body) sendBody(req, res, { body, type: JSON_TYPE });
    else sendText(res, 404, 'not found');
    return true;
  };
}
