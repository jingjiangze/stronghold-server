// shared/packs.js — content packs (docs/PACKS.md): one manifest format, one registry, one index for every kind of
// add-on content (the owner's decision of 2026-10-07: the language pack is the first type of a general mechanism). A
// pack is a manifest plus its files. Type "lang" (language packs, shared/i18nPacks.js) is the first and, in 0.2.0, the
// only type that loads; "assets" (art / audio / font replacements, client side) and "data" (data patches the server
// applies at start) are planned: their manifests already parse, a server lists them as not supported yet, and each will
// plug in as its entry in PACK_TYPES plus its loader (docs/PACKS.md "Adding a pack type"). No Node builtin: the
// browser, the server (server/packs.js) and the tools share it.
//
// Two layouts, read by the same registry (server/packs.js) and listed alike:
//   packs/<id>/pack.json + its files   a folder pack — any type; the manifest names its files (`files`)
//   public/i18n/<code>.json            a single-file language pack — its manifest is the file's `_meta` block
//                                      (+ data/i18n/<code>.json, its game texts, when present)
//
// Manifest (pack.json, or `_meta` of a single-file language pack; every field but type / lang optional):
//   id            a folder pack: its folder name; a single-file language pack: its language code (a manifest that names
//                 another id is reported; the place decides). Letters, digits, '.', '_', '-', ≤ 64; unique across types
//   type          "lang" (a single-file language pack may leave it out), "workshop" (a mod-manager / Forge pack; a
//                 folder pack that names no type defaults to it — Forge's pack.json has no "type"); planned: "assets", "data"
//   version       the pack's own version (e.g. "1.2.0")
//   app           the app versions it is made for, a range: ">=0.2.0", ">=0.2.0 <0.3.0", "0.2.x", "^0.2.0", "~0.2.1", "*"
//                 (a pre-release such as 0.2.0-dev counts as its release). Outside it a language pack still loads —
//                 what it lacks falls back — and is flagged `compatible: false`
//   name          the pack's name in its own language (a language pack: the language's own name, shown in the menu)
//   englishName   its English name
//   authors       a string or a list;  credits  free text;  license  an SPDX id or free text
//   files         a folder pack: role → path inside the folder (type "lang": { "ui": "ui.json", "data": "data.json" })
//   …             the type's own fields (type "lang": lang, base, fallback, complete, machineTranslated, numberUnits —
//                 shared/i18nPacks.js; a machineTranslated that is not a boolean is warned about and reads as false)
//
// Index (GET /packs/index.json — the server's live list; `node tools/packs.mjs index` writes packs/index.json for a
// static host): { version: 1, app: "<the server's app version>", packs: [entry …] } — the packs of supported types,
// sorted by type then id. An entry: id, type, name, englishName, version?, app?, compatible, authors?, credits?,
// license?, files (role → URL on this server) and the type's fields; a language entry: lang, base?, fallback,
// complete?, machineTranslated?, numberUnits?, strings (how many translations its UI file holds).

import { APP_VERSION } from './constants.js';
import { SOURCE_LANG, canonicalLang, isLangCode, languageName, langFields } from './i18nPacks.js';
// The mod-manager (Forge) workshop pack contract, vendored (shared/forgeContract.js + forgeContract.SOURCE.md). The
// "workshop" type below reads its field set and face enumerations from here instead of hand-copying them, so a Forge
// contract change is "re-extract + watch the drift test", never a hand edit that conflicts with upstream.
import {
  PACK_FIELDS as WORKSHOP_FIELDS, WORKSHOP_CONTENT_FILES, ROUTE_CACHE_POLICIES, CLIENT_PANEL_SLOTS,
  ART_TABLES, ART_SPINE_URLS, ART_SPINE_LISTS,
} from './forgeContract.js';

export const PACK_INDEX_VERSION = 1;
/** A folder pack's manifest file. */
export const PACK_MANIFEST = 'pack.json';
/** The index file next to the pack folders (packs/index.json, URL /packs/index.json). */
export const PACK_INDEX_FILE = 'index.json';
/** Where pack folders are served (server/http/static.js): /packs/<id>/<file>. */
export const PACKS_URL = '/packs/';

/**
 * @typedef {{ required?: boolean, ext: string[] }} FileRole a role of a folder pack's `files`
 * @typedef {{ status: 'supported' | 'planned', summary: string, live?: boolean, files?: Record<string, FileRole> }} PackType
 *   live: a server picks up its changes without a restart (lang: the client loads packs on demand; data will not —
 *   the simulation's data is fixed at start). files: the roles a folder pack of the type names, with the extensions a
 *   server may serve for them (nothing else in a pack folder is ever served)
 */

/** @type {Readonly<Record<string, PackType>>} the pack types (docs/PACKS.md "Adding a pack type") */
export const PACK_TYPES = Object.freeze({
  lang: Object.freeze({
    status: 'supported', live: true, summary: 'a language: UI strings and, optionally, game texts',
    files: Object.freeze({ ui: Object.freeze({ required: true, ext: ['.json'] }), data: Object.freeze({ ext: ['.json'] }) }),
  }),
  assets: Object.freeze({ status: 'planned', summary: 'art, audio and font replacements, client side' }),
  data: Object.freeze({ status: 'planned', summary: 'data patches the server applies at start' }),
  workshop: Object.freeze({
    status: 'supported', live: false, summary: 'a mod-manager (Forge) workshop pack', files: Object.freeze({}),
  }),
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');

/** A pack id: letters, digits, '.', '_', '-' (not first), at most 64. @param {unknown} v */
export const isPackId = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v);

/**
 * A path inside a pack folder ('ui.json', 'img/a.png'): relative, '/'-separated, no '.' / '..' / hidden / empty segment,
 * plain characters only.
 * @param {unknown} rel
 */
export const isPackPath = (rel) => typeof rel === 'string' && rel.length <= 200 && /^[A-Za-z0-9._ -]+(?:\/[A-Za-z0-9._ -]+)*$/.test(rel)
  && rel.split('/').every((s) => s.trim() === s && s && !s.startsWith('.'));

const extOf = (rel) => { const m = /\.[A-Za-z0-9]+$/.exec(rel); return m ? m[0].toLowerCase() : ''; };

// ---- app version ranges -------------------------------------------------------------------------------------------

/** [major, minor, patch] of a version ('0.2.0-dev' → [0, 2, 0]: a pre-release counts as its release), or null. */
const versionCore = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** One comparator of a range as [op, version] bounds, or null when it is not one. */
function bounds(c) {
  if (c === '*' || c === 'x') return [];
  const m = /^(\^|~|>=|<=|>|<|=)?v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(c);
  if (!m) return null;
  const [, op = '', a, b, d] = m;
  const wild = (s) => s === undefined || /^[xX*]$/.test(s);
  const M = Number(a);
  const N = wild(b) ? 0 : Number(b);
  const P = wild(d) ? 0 : Number(d);
  const partial = wild(b) ? 1 : wild(d) ? 2 : 3; // how many parts were given
  const lo = [M, N, P];
  if (op === '^') return [['>=', lo], ['<', M > 0 ? [M + 1, 0, 0] : partial >= 2 ? [0, N + 1, 0] : [1, 0, 0]]];
  if (op === '~') return [['>=', lo], ['<', partial >= 2 ? [M, N + 1, 0] : [M + 1, 0, 0]]];
  if (op === '' || op === '=') {
    if (partial === 3) return [['=', lo]];
    return [['>=', lo], ['<', partial === 2 ? [M, N + 1, 0] : [M + 1, 0, 0]]];
  }
  return [[op, lo]];
}

/** Whether `range` is a version range this file understands (an empty one is). @param {unknown} range */
export function isVersionRange(range) {
  const r = String(range ?? '').trim();
  if (!r) return true;
  return r.split('||').every((alt) => alt.trim().split(/\s+/).every((c) => bounds(c) !== null));
}

/**
 * Whether an app version is in a pack's `app` range (see the header). An empty range, an unreadable range or version
 * counts as a match: the range is advice, the pack's loader decides what an incompatible pack means.
 * @param {unknown} range
 * @param {unknown} [version] default: this build's APP_VERSION
 */
export function appVersionMatches(range, version = APP_VERSION) {
  const v = versionCore(version);
  const r = String(range ?? '').trim();
  if (!v || !r || !isVersionRange(r)) return true;
  return r.split('||').some((alt) => alt.trim().split(/\s+/).every((c) => bounds(c).every(([op, b]) => {
    const d = cmp(v, b);
    return op === '>=' ? d >= 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : op === '<' ? d < 0 : d === 0;
  })));
}

// ---- manifests ----------------------------------------------------------------------------------------------------

/**
 * @typedef {{ id: string, type: string, name: string, englishName: string, version: string, app: string,
 *   compatible: boolean, authors: string[], credits: string, license: string, files: Record<string, string>,
 *   lang?: string, base?: string|null, fallback?: string[], complete?: boolean, machineTranslated?: boolean,
 *   numberUnits?: string[]|null,
 *   declared?: string[], faces?: string[], routes?: { path: string, file: string, cache: string }[] }} PackManifest
 */

/**
 * Read a manifest: the common fields, the type's fields, a folder pack's file roles. `problems` keep the pack from
 * loading (manifest null); `warnings` do not.
 * @param {unknown} raw pack.json, or the `_meta` of a single-file language pack (undefined: none)
 * @param {{ id: string, type?: string, lang?: string, folder?: boolean, app?: string }} ctx
 *   id: the folder name / the file's code; type: the type of the layout (a single-file language pack: 'lang');
 *   lang: a single file's language code; folder: a folder pack (its `files` are read); app: the app version
 * @returns {{ manifest: PackManifest | null, problems: string[], warnings: string[] }}
 */
export function normalizeManifest(raw, ctx) {
  const problems = [];
  const warnings = [];
  if (raw !== undefined && !isObj(raw)) problems.push('the manifest is not a JSON object');
  const m = isObj(raw) ? /** @type {any} */ (raw) : {};
  // A folder pack whose manifest names no type is a mod-manager (Forge) workshop pack: Forge's pack.json carries no
  // "type" field at all (shared/forgeContract.js PACK_FIELDS), so this default is the line that lets a real workshop
  // pack load. A single-file language pack always arrives with ctx.type='lang' and never reaches the fallback.
  const type = str(m.type, 20) || ctx.type || (ctx.folder ? 'workshop' : '');
  const kind = Object.prototype.hasOwnProperty.call(PACK_TYPES, type) ? PACK_TYPES[type] : null;
  if (!type) problems.push('no "type"');
  else if (!kind) problems.push(`unknown type "${type}" (known: ${Object.keys(PACK_TYPES).join(', ')})`);
  if (ctx.type && type !== ctx.type) problems.push(`"type": "${type}" where a ${ctx.type} pack belongs`);
  const id = ctx.id;
  if (!isPackId(id)) problems.push(`"${id}" is not a pack id (letters, digits, . _ -)`);
  if (m.id !== undefined && m.id !== id) warnings.push(`"id": "${m.id}" is not "${id}" (the folder or file name decides)`);
  const range = str(m.app, 60);
  if (range && !isVersionRange(range)) warnings.push(`"app": "${range}" is not a version range (">=0.2.0", "0.2.x" …)`);
  const app = ctx.app ?? APP_VERSION;
  const compatible = appVersionMatches(range, app);
  if (!compatible) warnings.push(`made for app ${range}; this is ${app}`);
  const authors = (Array.isArray(m.authors) ? m.authors : typeof m.authors === 'string' ? [m.authors] : []).map((a) => str(a)).filter(Boolean).slice(0, 32);
  /** @type {PackManifest} */
  const out = {
    id, type, name: str(m.name, 60), englishName: str(m.englishName, 60), version: str(m.version, 40), app: range, compatible,
    authors, credits: str(m.credits, 500), license: str(m.license, 100), files: {},
  };
  if (type === 'lang') {
    const code = ctx.lang || canonicalLang(m.lang);
    if (ctx.lang && m.lang !== undefined && canonicalLang(m.lang) !== ctx.lang) warnings.push(`"lang": "${m.lang}" is not its file's code ${ctx.lang}`);
    if (!code) problems.push(m.lang === undefined ? 'no "lang" (the language code)' : `"lang": "${m.lang}" is not a language code`);
    else if (code === SOURCE_LANG) problems.push('"zh" is the source language (the msgids), never a pack');
    else {
      if (m.lang !== undefined && !isLangCode(m.lang) && !ctx.lang) warnings.push(`"lang": "${m.lang}" read as ${code}`);
      Object.assign(out, langFields(code, m));
      // anything but true reads as false: say so when another value was meant
      const mt = m.machineTranslated;
      if (mt !== undefined && typeof mt !== 'boolean') warnings.push(`"machineTranslated": ${String(JSON.stringify(mt)).slice(0, 40)} is not true or false (read as false)`);
      out.name ||= languageName(code);
      out.englishName ||= languageName(code, 'en');
    }
  } else if (type === 'workshop') {
    const w = workshopFields(m, ctx, out);
    problems.push(...w.problems);
    warnings.push(...w.warnings);
  }
  out.name ||= id;
  out.englishName ||= out.name;
  if (ctx.folder && kind && kind.files) {
    const given = isObj(m.files) ? m.files : {};
    for (const [role, spec] of Object.entries(kind.files)) {
      const rel = given[role];
      if (rel === undefined || rel === null || rel === '') { if (spec.required) problems.push(`no "files.${role}"`); continue; }
      if (!isPackPath(rel)) problems.push(`"files.${role}": "${rel}" is not a path inside the pack folder`);
      else if (!spec.ext.includes(extOf(rel))) problems.push(`"files.${role}" must be a ${spec.ext.join(' / ')} file`);
      else out.files[role] = rel;
    }
    for (const role of Object.keys(given)) if (!kind.files[role]) warnings.push(`"files.${role}" is not a role of a ${type} pack (ignored)`);
  }
  return { manifest: problems.length ? null : out, problems, warnings };
}

/**
 * The type's fields of a "workshop" pack — a mod-manager (Forge) 工坊包 (docs/PACKS.md). The contract is read from the
 * vendored Forge constants (shared/forgeContract.js + forgeContract.SOURCE.md), never hand-copied, so a Forge contract
 * change is "re-extract + watch the drift test". This server is the LOADING end, not the authoring end, and it draws
 * one line (the owner's ruling, 2026-10-12): a key or face it does not know is a WARNING — a newer Forge pack must
 * keep loading on an older server, and refusing would be exactly the behaviour-level conflict this work avoids — while
 * a KNOWN key whose value is malformed (wrong type, an `id` that is not the folder name, a path that leaves the folder,
 * a `routes[].file` that is not a pack-relative .json, a `cache` that is not one of the three, an `api`/`game` that is
 * not a version range) is a PROBLEM and refuses that pack: that is a broken pack, not a newer one.
 *
 * Only the read-only faces this layer can SERVE are mapped onto the pack's `files` roles (routes / notices / client
 * panels / assets / art / skins / i18n / content). The faces of later layers — `server` code, the data `overrides` /
 * `content` merge, the client injection — are recorded as metadata and warned about, never applied here.
 * @param {any} m the manifest object
 * @param {{ id: string, folder?: boolean }} ctx
 * @param {PackManifest} out the manifest being built (its `files` are filled here)
 * @returns {{ problems: string[], warnings: string[] }}
 */
function workshopFields(m, ctx, out) {
  const problems = [];
  const warnings = [];
  const faceSet = new Set();
  const declared = [];
  /** @type {{ path: string, file: string, cache: string }[]} */
  const routes = [];
  const assetRels = new Set();
  let assetN = 0;

  const addFile = (role, rel) => {
    if (!isPackPath(rel)) { problems.push(`"${String(rel)}" is not a path inside the pack folder (${role})`); return false; }
    if (out.files[role] !== undefined) { problems.push(`two files map to the role "${role}"`); return false; }
    out.files[role] = rel;
    return true;
  };
  /** A pack's own media: a path inside the pack's `assets/` folder (Forge isSafeAssetPath, the /workshop-assets route). */
  const addAsset = (declaredPath, face) => {
    if (typeof declaredPath !== 'string' || !declaredPath) return;
    const rel = `assets/${declaredPath}`;
    if (!isPackPath(rel)) { problems.push(`"${declaredPath}" (${face}) is not a path inside the pack's assets/ folder`); return; }
    faceSet.add(face);
    if (assetRels.has(rel)) return;
    assetRels.add(rel);
    out.files[`asset:${assetN++}`] = rel;
  };

  // ---- the closed field set: an unknown key warns, it never refuses (a newer Forge pack still loads) -----------
  for (const key of Object.keys(m)) {
    if (WORKSHOP_FIELDS.includes(key)) { declared.push(key); continue; }
    warnings.push(`"${key}" is not a field of a workshop pack (${WORKSHOP_FIELDS.join(', ')}) — ignored (PACK_UNKNOWN_FIELD)`);
  }

  // ---- id: the folder name decides (a mismatch is a broken pack, not a newer one) ------------------------------
  if (typeof m.id === 'string' && m.id && m.id !== ctx.id) problems.push(`"id": "${m.id}" is not the pack's folder name "${ctx.id}"`);

  // ---- version ranges: `api` / `game` / `gameVersion` share the `app` syntax (isVersionRange) ------------------
  for (const field of ['api', 'game', 'gameVersion']) {
    const range = str(m[field], 60);
    if (range && !isVersionRange(range)) problems.push(`"${field}": "${range}" is not a version range (">=0.2.0", "0.2.x", "^1 <2" …)`);
  }
  if (m.combat !== undefined && typeof m.combat !== 'boolean') problems.push('"combat" must be true or false (may this pack change a battle result?)');

  // ---- content: data file names -> <name>.json at the pack root (registered + served; NOT merged — that is L2) --
  if (m.content !== undefined) {
    if (!Array.isArray(m.content)) problems.push('"content" must be an array of data file names');
    else for (const name of m.content) {
      if (typeof name !== 'string' || !WORKSHOP_CONTENT_FILES.includes(name)) { warnings.push(`content: "${String(name)}" is not a data file of this format (${WORKSHOP_CONTENT_FILES.join(', ')})`); continue; }
      if (addFile(`content:${name}`, `${name}.json`)) faceSet.add('content');
    }
  }

  // ---- routes: absolute read-only HTTP paths -> pack-relative .json (the route:<path> role) --------------------
  if (m.routes !== undefined) {
    if (!Array.isArray(m.routes)) problems.push('"routes" must be an array of { path, file, cache? }');
    else {
      const seen = new Set();
      for (const [i, r] of m.routes.entries()) {
        if (!isObj(r)) { problems.push(`routes[${i}] must be an object: { path, file, cache? }`); continue; }
        for (const key of Object.keys(r)) if (key !== 'path' && key !== 'file' && key !== 'cache') warnings.push(`routes[${i}]: "${key}" is not a route field (path, file, cache)`);
        const p = r.path;
        if (typeof p !== 'string' || !p.startsWith('/') || p.length < 2 || p.includes('\\') || p.split('/').some((s) => s === '..' || s === '.')) { problems.push(`routes[${i}].path must be an absolute HTTP path (e.g. "/data/x.json")`); continue; }
        if (seen.has(p)) { problems.push(`routes: "${p}" is declared twice (one path, one file)`); continue; }
        seen.add(p);
        if (!isPackPath(r.file) || !r.file.endsWith('.json')) { problems.push(`routes["${p}"].file must be a pack-relative .json path`); continue; }
        const cache = r.cache === undefined ? 'no-cache' : r.cache;
        if (!ROUTE_CACHE_POLICIES.includes(cache)) { problems.push(`routes["${p}"].cache must be one of: ${ROUTE_CACHE_POLICIES.join(', ')}`); continue; }
        if (addFile(`route:${p}`, r.file)) { routes.push({ path: p, file: r.file, cache }); faceSet.add('routes'); }
      }
    }
  }

  // ---- notices: announcement / credits .json --------------------------------------------------------------------
  if (m.notices !== undefined) {
    if (!isObj(m.notices)) problems.push('"notices" must be an object: { announcement?, credits? }');
    else for (const [key, rel] of Object.entries(m.notices)) {
      if (key !== 'announcement' && key !== 'credits') { warnings.push(`notices: "${key}" is not a declared field (announcement, credits)`); continue; }
      if (!isPackPath(rel) || !rel.endsWith('.json')) { problems.push(`notices.${key} must be a pack-relative ".json" path`); continue; }
      if (addFile(`notices:${key}`, rel)) faceSet.add('notices');
    }
  }

  // ---- client: panel modules (.js) + their stylesheets (.css) ---------------------------------------------------
  if (m.client !== undefined) {
    if (!isObj(m.client)) problems.push('"client" must be an object: { panels?, requires?, theme? }');
    else {
      for (const key of Object.keys(m.client)) if (key !== 'panels' && key !== 'requires' && key !== 'theme') warnings.push(`client: "${key}" is not a declared field (panels, requires, theme)`);
      if (m.client.panels !== undefined) {
        if (!Array.isArray(m.client.panels)) problems.push('"client.panels" must be an array');
        else for (const [j, panel] of m.client.panels.entries()) {
          if (!isObj(panel)) { problems.push(`client.panels[${j}] must be an object: { id, slot, module, … }`); continue; }
          const panelId = typeof panel.id === 'string' && panel.id ? panel.id : `#${j}`;
          if (typeof panel.slot === 'string' && panel.slot && !CLIENT_PANEL_SLOTS.includes(panel.slot)) warnings.push(`client.panels["${panelId}"].slot "${panel.slot}" is not a slot this build renders (${CLIENT_PANEL_SLOTS.join(', ')})`);
          if (panel.module !== undefined) {
            if (isPackPath(panel.module) && panel.module.endsWith('.js')) { if (addFile(`client:${panelId}:module`, panel.module)) faceSet.add('client'); }
            else problems.push(`client.panels["${panelId}"].module must be a pack-relative ".js" path`);
          }
          if (panel.styles !== undefined) {
            if (!Array.isArray(panel.styles)) problems.push(`client.panels["${panelId}"].styles must be an array`);
            else for (const [k, style] of panel.styles.entries()) {
              if (isPackPath(style) && style.endsWith('.css')) { if (addFile(`client:${panelId}:styles:${k}`, style)) faceSet.add('client'); }
              else problems.push(`client.panels["${panelId}"].styles[${k}] must be a pack-relative ".css" path`);
            }
          }
        }
      }
    }
  }

  // ---- assets: the resource container + its flat file table (pack-root relative, Forge isSafeRelativePath) ------
  if (m.assets !== undefined) {
    if (!isObj(m.assets)) problems.push('"assets" must be an object: { container, manifest, serverPolicy?, verify? }');
    else {
      for (const key of Object.keys(m.assets)) if (!['container', 'manifest', 'serverPolicy', 'verify'].includes(key)) warnings.push(`assets: "${key}" is not a declared field (container, manifest, serverPolicy, verify)`);
      if (m.assets.container !== undefined) {
        if (isPackPath(m.assets.container) && m.assets.container.endsWith('.spresources')) { if (addFile('asset:container', m.assets.container)) faceSet.add('assets'); }
        else problems.push('assets.container must name a pack-relative ".spresources" file');
      }
      if (m.assets.manifest !== undefined) {
        if (isPackPath(m.assets.manifest) && m.assets.manifest.endsWith('.json')) { if (addFile('asset:manifest', m.assets.manifest)) faceSet.add('assets'); }
        else problems.push('assets.manifest must name a pack-relative ".json" file');
      }
    }
  }

  // ---- art / skins: a pack's own art (paths inside the pack's assets/ folder, per ART_TABLES) -------------------
  const addSpine = (spine, face) => {
    if (!isObj(spine)) return;
    for (const key of ART_SPINE_URLS) if (spine[key] !== undefined) addAsset(spine[key], face);
    for (const key of ART_SPINE_LISTS) if (Array.isArray(spine[key])) for (const p of spine[key]) addAsset(p, face);
  };
  const addArtEntry = (entry, shape, face) => {
    if (!isObj(entry) || !shape) return;
    if (shape.flat) { addAsset(entry, face); return; }
    for (const key of shape.urls) if (entry[key] !== undefined) addAsset(entry[key], face);
    const spine = entry.spine;
    if (spine === undefined) return;
    if (shape.spine === 'flat') addSpine(spine, face);
    else if (isObj(spine)) for (const side of ['front', 'back']) if (spine[side] !== undefined) addSpine(spine[side], face);
  };
  if (m.art !== undefined) {
    if (!isObj(m.art)) problems.push('"art" must be an object: { chars|enemies|tokens|skills|profSub: { "<id>": … } }');
    else for (const [table, entries] of Object.entries(m.art)) {
      const shape = ART_TABLES[table];
      if (!shape) { warnings.push(`art: "${table}" is not an art table (${Object.keys(ART_TABLES).join(', ')})`); continue; }
      if (!isObj(entries)) { problems.push(`art.${table} must be an object: { "<id>": … }`); continue; }
      for (const entry of Object.values(entries)) addArtEntry(entry, shape, 'art');
    }
  }
  if (m.skins !== undefined) {
    if (!Array.isArray(m.skins)) problems.push('"skins" must be an array of { id, charId, name, art? } entries');
    else for (const skin of m.skins) {
      if (!isObj(skin)) continue;
      if (skin.art !== undefined) addArtEntry(skin.art, ART_TABLES.chars, 'skins');
    }
  }

  // ---- i18n: add strings to an existing language -> pack-relative .json -----------------------------------------
  if (m.i18n !== undefined) {
    if (!isObj(m.i18n)) problems.push('"i18n" must be an object: { "<lang code>": "<path to a .json>" }');
    else for (const [code, rel] of Object.entries(m.i18n)) {
      if (!isLangCode(code)) { problems.push(`i18n: "${code}" is not a language code in its usual case (en, ja, zh-TW …)`); continue; }
      if (code === SOURCE_LANG) { problems.push(`i18n: "${SOURCE_LANG}" is the source language (the msgids), never a pack target`); continue; }
      if (!isPackPath(rel) || !rel.endsWith('.json')) { problems.push(`i18n["${code}"] must be a pack-relative ".json" path`); continue; }
      if (addFile(`i18n:${code}`, rel)) faceSet.add('i18n');
    }
  }

  // ---- faces this layer does NOT apply: registered as metadata + a warning, never a refusal --------------------
  // (the data merge is L2, the server-side code is L3, the client injection is L4 — the audit's layer table.)
  // `layer` and `combat` are pack METADATA (a layer letter, a boolean), not faces to apply: they are registered
  // above like any other declared field and must not produce an "not applied" warning on every real pack.
  const UNAPPLIED = ['server', 'overrides', 'operators', 'support', 'playtest', 'voices', 'voiceLangs', 'bondIcons', 'itemIcons'];
  const EXPECT = { server: 'object', overrides: 'array', operators: 'object', support: 'array', playtest: 'object', voices: 'object', voiceLangs: 'object', bondIcons: 'object', itemIcons: 'object' };
  for (const key of UNAPPLIED) {
    if (m[key] === undefined) continue;
    const want = EXPECT[key];
    const got = Array.isArray(m[key]) ? 'array' : typeof m[key];
    if (want && got !== want) problems.push(`"${key}" must be an ${want} (got ${got})`);
    else warnings.push(`"${key}" is declared but this server does not apply it — registered only (L1)`);
  }

  out.declared = declared.sort();
  out.faces = [...faceSet].sort();
  if (routes.length) out.routes = routes;
  return { problems, warnings };
}

// ---- the index ----------------------------------------------------------------------------------------------------

/**
 * The index entry of a pack (what a client may know): its manifest without the folder paths, `files` as URLs, plus the
 * type's extras (a language pack: `strings`).
 * @param {PackManifest} manifest
 * @param {{ files: Record<string, string>, strings?: number }} extra files: role → URL
 */
export function packIndexEntry(manifest, extra) {
  /** @type {Record<string, unknown>} */
  const e = { id: manifest.id, type: manifest.type, name: manifest.name, englishName: manifest.englishName };
  if (manifest.version) e.version = manifest.version;
  if (manifest.app) e.app = manifest.app;
  e.compatible = manifest.compatible;
  if (manifest.authors.length) e.authors = manifest.authors;
  if (manifest.credits) e.credits = manifest.credits;
  if (manifest.license) e.license = manifest.license;
  if (manifest.type === 'lang') {
    e.lang = manifest.lang;
    if (manifest.base !== undefined) e.base = manifest.base;
    e.fallback = manifest.fallback || [];
    if (manifest.complete) e.complete = true;
    if (manifest.machineTranslated) e.machineTranslated = true;
    if (manifest.numberUnits) e.numberUnits = manifest.numberUnits;
    e.strings = extra.strings ?? 0;
  }
  if (manifest.type === 'workshop') {
    // What a client (or an operator reading the index) may know of a workshop pack: the faces this server actually
    // applied / serves, and its read-only routes as declared path -> the URL on this server that answers it.
    if (manifest.faces?.length) e.faces = manifest.faces;
    if (manifest.routes?.length) {
      e.routes = manifest.routes.map((r) => ({ path: r.path, url: extra.files[`route:${r.path}`] ?? null, cache: r.cache }));
    }
  }
  e.files = { ...extra.files };
  return e;
}

/**
 * The index body from the entries of supported packs (packIndexEntry), sorted by type then id.
 * @param {Record<string, unknown>[]} entries
 * @param {{ app?: string }} [opts]
 */
export function buildPackIndex(entries, { app = APP_VERSION } = {}) {
  const key = (e) => `${e.type}\u0000${e.id}`;
  return { version: PACK_INDEX_VERSION, app, packs: [...entries].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)) };
}

/** A URL a client may fetch from an index: a path on this server ('/…', never '//host' or a scheme). */
const isLocalUrl = (u) => typeof u === 'string' && /^\/(?!\/)[^\s\\]*$/.test(u) && u.length <= 300;

/**
 * Read a received index (the client): the entries of supported types whose fields check out; anything else is dropped.
 * Optionally only one type.
 * @param {unknown} json
 * @param {string} [type]
 * @returns {Record<string, any>[]}
 */
export function readPackIndex(json, type) {
  const list = isObj(json) && Array.isArray(/** @type {any} */ (json).packs) ? /** @type {any} */ (json).packs : [];
  const out = [];
  for (const e of list) {
    if (!isObj(e) || !isPackId(e.id) || PACK_TYPES[e.type]?.status !== 'supported' || (type && e.type !== type)) continue;
    const files = {};
    for (const [role, url] of Object.entries(isObj(e.files) ? e.files : {})) if (isLocalUrl(url)) files[role] = url;
    if (e.type === 'lang' && (!isLangCode(e.lang) || e.lang === SOURCE_LANG || !files.ui)) continue;
    out.push({ ...e, files });
  }
  return out;
}

/**
 * The language a client registers for a language entry of the index (shared/i18n.js registerLangs).
 * @param {Record<string, any>} e a 'lang' entry of readPackIndex
 * @returns {import('./i18nPacks.js').LangMeta}
 */
export function langMetaOf(e) {
  const f = langFields(e.lang, e);
  return {
    ...f,
    code: e.lang,
    name: str(e.name, 60) || languageName(e.lang),
    englishName: str(e.englishName, 60) || languageName(e.lang, 'en'),
    authors: Array.isArray(e.authors) ? e.authors.map((a) => str(a)).filter(Boolean).slice(0, 32) : [],
    version: str(e.version, 40),
    app: str(e.app, 60),
    compatible: e.compatible !== false,
    strings: Number.isFinite(e.strings) ? e.strings : undefined,
    data: !!e.files?.data,
    ui: e.files?.ui,
    dataUrl: e.files?.data,
    packId: e.id,
  };
}
