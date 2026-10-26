// The keys a browser tab holds for the server: one per battle seat of a one-match server, one for the lobby (its rooms'
// matches take the lobby key as the seat key, docs/spec/room.md 房间-6). They stay in sessionStorage, so a reload keeps
// them and two tabs are two players. Keys come from crypto.getRandomValues, which a page opened by a LAN address — not a
// secure context — still has (docs/spec/page.md 页面-3).

/** The lobby key's name in sessionStorage. */
export const LOBBY_KEY = 'ice.lobby.key';

/** 128 random bits as hex. */
export const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** This tab's key of a name, made on first use. @param {string} name */
export function tabKey(name) {
  try {
    const k = sessionStorage.getItem(name) ?? randomKey();
    sessionStorage.setItem(name, k);
    return k;
  } catch { return randomKey(); }
}

/** This device's localStorage, or null where the page may not use it. @returns {Storage | null} */
export function localStore() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
