// shared/forgeContract.js — the pure constants of the mod-manager (Forge) workshop pack contract, vendored so this
// server never hand-copies them (see forgeContract.SOURCE.md: upstream repository, the commit they were taken from,
// and the line of each). `shared/packs.js` reads its "workshop" type fields and face enumerations from HERE, so when
// Forge moves a field set the fix is "re-extract + watch the drift test", not a hand edit that conflicts with upstream.
//
// Why a separate file and not a copy of Forge's shared/workshop.js: that module imports ./support.js, ./kitImports.js
// and other game-data-model files this server does not have, so the whole file cannot be copied. Only the constants
// are lifted out — verbatim, no imports (this file has none at all, by design: it is data).
//
// The drift test (test/workshop-packs.test.js) re-extracts each of these from the Forge checkout and compares; when
// the checkout is not present it skips rather than fails. Do not add a value by hand here that is not in Forge.

/** Data files a pack may contribute to (Forge shared/workshop.js L28). */
export const WORKSHOP_CONTENT_FILES = Object.freeze([
  'chess', 'units', 'items', 'enemies', 'stages', 'waves', 'tokens', 'bosses', 'factions', 'garrisons', 'bands', 'bonds', 'effects', 'choices',
]);

/** Pack ids: a short filesystem- and URL-safe slug (Forge L89). */
export const PACK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/**
 * The closed top-level key set of `pack.json` (Forge L111). A key outside it is a field this format does not know.
 * (This server warns and ignores rather than refusing the whole pack — a real Forge pack must not be turned away.)
 */
export const PACK_FIELDS = Object.freeze([
  // 身份与元信息
  'id', 'name', 'version', 'author', 'license', 'description', 'gameVersion', 'game', 'api', 'layer', 'combat',
  // 内容与覆盖
  'content', 'overrides',
  // 素材与声明（贡献项）
  'voices', 'voiceLangs', 'bondIcons', 'itemIcons', 'art', 'skins', 'support', 'operators', 'i18n',
  // 纯文本声明（公告 / 鸣谢）
  'notices',
  // 行为开关（不是贡献项）
  'playtest',
  // 中间层四组能力声明
  'assets', 'client', 'server', 'routes',
]);

/** The refusal code for an unknown top-level key (Forge L127). */
export const PACK_UNKNOWN_FIELD_CODE = 'PACK_UNKNOWN_FIELD';

/** One `pack.json.overrides` entry: `"<file>:<id>"` (Forge L136). */
export const OVERRIDE_ENTRY_RE = /^([a-z]+):([A-Za-z0-9_\-.:]{1,64})$/;

/** The URL prefix a pack's own media is served under (Forge L143). */
export const WORKSHOP_MEDIA_PREFIX = '/workshop-assets/';
/** The URL prefix a pack's C-layer panel module is served under (Forge L152). */
export const WORKSHOP_PANEL_PREFIX = '/workshop-panels/';
/** The URL prefix a pack's declared resource container and manifest are served under (Forge L163). */
export const WORKSHOP_RESOURCE_PREFIX = '/workshop-resources/';

/** `client.panels[*].slot`, a closed enumeration (Forge L254). */
export const CLIENT_PANEL_SLOTS = Object.freeze([
  'root.overlays', 'root.guide', 'screen.game.aside', 'screen.result.footer',
  'screen.game.shopCard', 'screen.game.bondStrip', 'screen.game.hud', 'screen.game.overlay',
  'screen.loadout.detail',
]);
/** Hosts the engine renders more than one container for (Forge L266). */
export const CLIENT_PANEL_REPEATABLE = Object.freeze(['screen.game.shopCard']);
/** The engine's named components a panel may wrap/replace (Forge L279). */
export const CLIENT_WRAP_COMPONENTS = Object.freeze([
  'game.bondStrip', 'game.hud.topBar', 'game.shopCard', 'loadout.detail',
]);
/** Wrap modes (Forge L283). */
export const CLIENT_WRAP_MODES = Object.freeze(['wrap', 'replace']);
/** A pack channel name (`client.panels[].messages` / `server.modules[].channels`, Forge L294): a lower-case slug. */
export const PACK_CHANNEL_RE = /^[a-z][a-z0-9_-]{0,63}$/;
/** The data tables a panel may read (Forge L309). */
export const CLIENT_PANEL_DATA_TABLES = Object.freeze([
  'chess', 'bonds', 'items', 'bands', 'enemies', 'bosses',
  'stages', 'tokens', 'choices', 'config', 'assets', 'backups', 'local', 'notices',
]);
/** Browser capabilities a pack may require (Forge L314). */
export const CLIENT_REQUIRES = Object.freeze(['serviceWorker', 'cacheStorage', 'webCrypto']);

/** `server.modules[*].uses`, the mount points (Forge L384). */
export const SERVER_MODULE_USES = Object.freeze(['boot', 'shutdown', 'matchClass', 'healthz']);
/** The closed field set of one `server.modules[*]` entry (Forge L386). */
export const SERVER_MODULE_FIELDS = Object.freeze(['id', 'entry', 'uses', 'write', 'channels']);
/** How many server modules one pack may declare (Forge L388). */
export const MAX_SERVER_MODULES = 8;
/** How many receive channels one server module may declare (`server.modules[].channels`, Forge L394, DESIGN §28.23). */
export const MAX_SERVER_MODULE_CHANNELS = 8;
/** A server module is ESM the SERVER loads: the browser and the battle sim never do (Forge L390). */
export const SERVER_MODULE_EXT = '.mjs';
/** A `server.modules[*].id` — the same pattern upstream calls RECORD_ID_RE (Forge L165), exported under that name. */
export const RECORD_ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;
/** `/healthz`: how many fields and how many bytes one pack may contribute (Forge server/modModules.js L136). */
export const HEALTHZ_LIMITS = Object.freeze({ fields: 12, bytes: 2048 });

/** `server.preDispatch`: the closed field set (Forge L338) and the module extension (Forge L411). */
export const PRE_DISPATCH_FIELDS = Object.freeze(['module', 'policy', 'intercepts']);
export const PRE_DISPATCH_MODULE_EXT = '.mjs';

/** The registry classes of `server.meta.registers` (Forge L400). */
export const META_KEY_CLASSES = Object.freeze(['garrison', 'band', 'bond', 'item', 'choice', 'effect', 'global']);
/** `routes[*].cache`, the three cache semantics (Forge L414). */
export const ROUTE_CACHE_POLICIES = Object.freeze(['no-cache', 'no-store', 'public']);
/** The members of the `server` block (Forge L759). */
export const SERVER_MEMBERS = Object.freeze(['preDispatch', 'meta', 'modules', 'battle', 'room']);

/** `pack.json.skins[*]` fields, one too many or too few refused (Forge L1130). */
export const SKIN_FIELDS = Object.freeze(['id', 'charId', 'name', 'series', 'desc', 'art', 'voices']);

/** A spine object's path fields (Forge L1155). */
export const ART_SPINE_URLS = Object.freeze(['skel', 'atlas']);
/** A spine object's path-list fields (Forge L1156). */
export const ART_SPINE_LISTS = Object.freeze(['textures']);
/**
 * The appearance tables and what each entry may carry (Forge L1135): `urls` are pack-relative paths inside the pack's
 * `assets/`, `spine` is `'sides'` (chars: `spine.front` / `spine.back`) or `'flat'` (enemies / tokens), and `flat`
 * means the entry itself is one path string (skills / profSub).
 */
export const ART_TABLES = Object.freeze({
  chars: Object.freeze({ urls: Object.freeze(['avatar', 'avatarE2', 'portrait', 'portraitE2']), strings: Object.freeze([]), spine: 'sides' }),
  enemies: Object.freeze({ urls: Object.freeze(['icon']), strings: Object.freeze(['spineAliasOf']), spine: 'flat' }),
  tokens: Object.freeze({ urls: Object.freeze(['avatar', 'portrait']), strings: Object.freeze(['owner', 'spineVariant']), spine: 'flat' }),
  skills: Object.freeze({ flat: true, target: Object.freeze(['skills']) }),
  profSub: Object.freeze({ flat: true, target: Object.freeze(['prof', 'sub']) }),
});
/** A spine object's pass-through fields and the types each may take (Forge L1157). */
export const ART_SPINE_PASSTHROUGH = Object.freeze({
  pma: Object.freeze(['boolean']),
  anims: Object.freeze(['object']),
  animations: Object.freeze(['object']),
  events: Object.freeze(['array']),
  hits: Object.freeze(['object']),
  bounds: Object.freeze(['object', 'array']),
});
/** `pack.json.skins[*].id` (Forge L1133). */
export const SKIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/** `assets.serverPolicy` (Forge L215). */
export const ASSETS_SERVER_POLICIES = Object.freeze(['serve', 'cache-only']);
/** `assets.verify` (Forge L218). */
export const ASSETS_VERIFY_ALGORITHMS = Object.freeze(['sha256']);
/** The `assets` file-level refusal codes (Forge L239). */
export const ASSETS_FILE_CODES = Object.freeze({
  CONTAINER: 'ASSETS_BAD_CONTAINER',
  MANIFEST: 'ASSETS_BAD_MANIFEST',
  VERIFY_FAILED: 'ASSETS_VERIFY_FAILED',
  VERIFY_UNAVAILABLE: 'ASSETS_VERIFY_UNAVAILABLE',
});

/** Record fields an override replaces wholesale instead of merging field by field (Forge L2134). */
export const OVERRIDE_REPLACE_KEYS = Object.freeze([
  'skill', 'skills', 'trait', 'traitBase', 'traitOverride', 'modules',
  'rangeGrid', 'attackRangeGrid', 'assets', 'diy', 'bonds',
]);
/** Lists whose entries carry a stable identity key, merged entry by entry (Forge L2163). */
export const OVERRIDE_KEYED_LISTS = Object.freeze({ talents: 'index', talentsBase: 'index', talentChanges: 'talentIndex' });

