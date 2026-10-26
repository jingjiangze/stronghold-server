// The room page's images (docs/spec/page.md 页面-5): the activity's icons — the playing styles' (their icon ids from the
// activity table) and the mode's — from the assets' room atlas (ui/room/index.json). Without the atlas there are none
// and the page shows the names alone.

/** The room atlas: each sprite's file (relative to the index) and size. @typedef {{ sprites: Record<string, { file: string, w: number, h: number }> }} RoomAtlas */

/**
 * Each mode type's icon (页面-5): the atlas's icon_mode_<n>, n by the mode — its tinted variant has the mode's colour
 * of the activity table (常规项目 d2284b, 阵地足球 b9eb3b, 堡垒守御 3cbfd0, 漂航 51e1c4).
 */
export const MODE_ICONS = Object.freeze({ NORMAL: 'icon_mode_1', FOOTBALL: 'icon_mode_2', DEFENCE: 'icon_mode_3', RAFT: 'icon_mode_4' });

/** A sprite's URL, or null when the atlas does not have it. @param {RoomAtlas | null} atlas @param {string} base @param {string} name */
export function spriteUrl(atlas, base, name) {
  const s = atlas && Object.hasOwn(atlas.sprites, name) ? atlas.sprites[name] : null;
  return s ? new URL(s.file, base).href : null;
}

/**
 * A style's icon (页面-5): the full card ('') or the small one ('_tiny'), named by the style's icon id.
 * @param {RoomAtlas | null} atlas @param {string} base @param {string} icon @param {'' | '_tiny'} variant
 */
export const styleIcon = (atlas, base, icon, variant) => spriteUrl(atlas, base, `${icon}${variant}`);

/** A mode's tinted icon (页面-5). @param {RoomAtlas | null} atlas @param {string} base @param {string} type */
export const modeIcon = (atlas, base, type) => {
  const name = /** @type {Record<string, string>} */ (MODE_ICONS)[type];
  return name ? spriteUrl(atlas, base, `${name}_color`) : null;
};

/** The room atlas of the assets, or null. @param {string} base the URL of ui/room/ @returns {Promise<RoomAtlas | null>} */
export async function loadRoomAtlas(base) {
  const res = await fetch(new URL('index.json', base)).catch(() => null);
  if (!res?.ok) return null;
  const a = await res.json().catch(() => null);
  return a && typeof a.sprites === 'object' ? a : null;
}
