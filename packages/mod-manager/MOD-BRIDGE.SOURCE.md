# Vendored: the mod-manager (Forge) server-side payload layer

Upstream: `XiaMo233M/Stronghold-Protocol-Forge` (a mod-manager fork of `jingjiangze/Stronghold-Protocol`).
Commit: `878d70638f0febefee310de3796122bc93d01b8c`

Why these three files can be copied verbatim: both repositories keep `shared/` at the repository root, so an upstream
`import { C2S } from '../shared/protocol.js'` resolves to the same relative path here. Nothing below needed rewriting
to fit — except the one import noted under `modModules.js`.

| File | Upstream source | Local edits |
|---|---|---|
| `server/modDispatch.js` | `server/modDispatch.js` | **none** (byte-identical, `git hash-object` `20ffae8bdd6c5b8e9e07054163cc0049272faadd`) |
| `server/modModules.js` | `server/modModules.js` | **one line**: `SERVER_MODULE_USES` imported from `../shared/forgeContract.js` instead of `../shared/workshop.js` |
| `server/modGate.js` | `server/workshop.js` **L419-458** (`preDispatchIssues`) + **L460-511** (`validateHookPolicy`) | **none** in the two functions; the file adds only its own header comment plus the `fs` / `path` / `C2S` imports upstream already had |

## Re-extracting after a Forge update

```bash
FORGE=/c/DDDD/Agent\ Work/Stronghold-Protocol-Forge
cd /c/DDDD/Agent\ Work/stronghold-server

# 1. the two whole files
cp "$FORGE/server/modDispatch.js" server/modDispatch.js
cp "$FORGE/server/modModules.js" server/modModules.js
# then re-apply the ONE import edit in modModules.js (see below)

# 2. the gate slice — verify the line numbers still bound the same two functions first
grep -n "^export function preDispatchIssues\|^export function validateHookPolicy\|^export function metaIssues" \
  "$FORGE/server/workshop.js"
# preDispatchIssues starts at L419 and ends at L458; validateHookPolicy is L460-511.
# Rebuild server/modGate.js: keep its local header (through the C2S import), then append those two ranges.

# 3. constants: shared/forgeContract.js carries the upstream line number of every value.
#    The drift test re-extracts them from the checkout and fails when one moves.
```

The one import edit in `server/modModules.js`:

```js
// upstream: import { SERVER_MODULE_USES } from '../shared/workshop.js';
import { SERVER_MODULE_USES } from '../shared/forgeContract.js';
```

`shared/workshop.js` is Forge's pack loader and game-data model (it pulls in `support.js` / `kitImports.js`); this
server has its own loader (`server/packs.js` + `server/modBridge.js`), so only the closed enumeration is vendored.

## What is deliberately NOT vendored

- `server/workshop.js` as a whole — it reads Forge's `workshop/` directory and builds its data overlay. This server has
  its own pack scan and (L2, later) its own merge.
- `server/data.js`, `server/match/metaPack.js`, `server/battlePack.js`, `server/roomPack.js` — the `server.meta` /
  `server.battle` / `server.room` faces. Out of scope for L3 here.
- Anything that would replace this server's own logic: matchmaking, the combat worker pool. (Nickname screening is
  deliberately NOT on that list anymore: R13's `moderateName` call site was removed 2026-10-12, and the screening is
  provided by the `name-guard` workshop pack through the vendored `preDispatch` surface — see CONFLICTS.md.)

## Local adaptation

`server/modBridge.js` is the adapter: it takes the server's own scanned packs, runs the vendored load-time gate,
calls the vendored loaders, prunes packs whose declared payload cannot be installed, and assembles the two Network
options, the boot/shutdown hooks, the `/healthz` contributions and the `MatchClass` wrappers. Never edit the three
files above to change server behaviour — change the adapter.
