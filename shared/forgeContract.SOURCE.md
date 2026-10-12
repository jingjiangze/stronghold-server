# forgeContract.js — source and provenance

The constants in `forgeContract.js` are **vendored verbatim** from the mod-manager (Forge) workshop pack contract. They
are copied, not imported, because Forge's `shared/workshop.js` imports game-data-model modules this server does not
have (`./support.js`, `./kitImports.js`, …) and therefore cannot be copied whole. See the file header of
`forgeContract.js` for why.

## Upstream

- Repository: `https://github.com/jingjiangze/Stronghold-Protocol-Forge-mirror-archive.git` (local checkout:
  `../Stronghold-Protocol-Forge`)
- File: `shared/workshop.js`
- Commit extracted from: `878d70638f0febefee310de3796122bc93d01b8c`
  (`fix(mod-xie): 标题页入口不再压住「开始」按钮（真浏览器检查发现）`, 2026-10-10)
- Command: `git -C ../Stronghold-Protocol-Forge rev-parse HEAD`

## Extracted constants (line in `shared/workshop.js` at that commit)

| Constant | Line |
|---|---|
| `WORKSHOP_CONTENT_FILES` | 28 |
| `PACK_ID_RE` | 89 |
| `PACK_FIELDS` | 111 |
| `PACK_UNKNOWN_FIELD_CODE` | 127 |
| `OVERRIDE_ENTRY_RE` | 136 |
| `WORKSHOP_MEDIA_PREFIX` | 143 |
| `WORKSHOP_PANEL_PREFIX` | 152 |
| `WORKSHOP_RESOURCE_PREFIX` | 163 |
| `ASSETS_SERVER_POLICIES` | 215 |
| `ASSETS_VERIFY_ALGORITHMS` | 218 |
| `ASSETS_FILE_CODES` | 239 |
| `CLIENT_PANEL_SLOTS` | 254 |
| `CLIENT_PANEL_REPEATABLE` | 266 |
| `CLIENT_WRAP_COMPONENTS` | 279 |
| `CLIENT_WRAP_MODES` | 283 |
| `CLIENT_PANEL_DATA_TABLES` | 309 |
| `CLIENT_REQUIRES` | 314 |
| `SERVER_MODULE_USES` | 384 |
| `META_KEY_CLASSES` | 400 |
| `ROUTE_CACHE_POLICIES` | 414 |
| `SERVER_MEMBERS` | 759 |
| `SKIN_FIELDS` | 1130 |
| `SKIN_ID_RE` | 1133 |
| `ART_TABLES` | 1135 |
| `ART_SPINE_URLS` | 1155 |
| `ART_SPINE_LISTS` | 1156 |
| `ART_SPINE_PASSTHROUGH` | 1157 |
| `OVERRIDE_REPLACE_KEYS` | 2134 |
| `OVERRIDE_KEYED_LISTS` | 2163 |

`UNIT_REQUIRED_FIELDS` (L49) is deliberately NOT vendored: it holds predicate functions, not data. `byPackId` (L2077)
is a comparator function, not a constant.

## How to re-extract (when the drift test is red)

1. `git -C ../Stronghold-Protocol-Forge rev-parse HEAD` — record the new commit in this file.
2. For each constant in the table above, read its line in `shared/workshop.js` and copy the literal **verbatim** into
   `forgeContract.js` (keep `Object.freeze(...)` nesting as upstream writes it).
3. Re-run `node --test test/workshop-packs.test.js` — the drift test re-extracts and deep-compares; it also fails when
   upstream has a pure-data `export const` that is not vendored here (a new contract constant to decide about).


## Keeping this honest

`test/workshop-packs.test.js` has a drift test: it re-extracts each constant above from
`../Stronghold-Protocol-Forge/shared/workshop.js` by evaluating the upstream literal and deep-compares it with the
vendored value. When the checkout is absent the test skips. When Forge changes a constant the test fails with
"upstream contract changed — re-extract" — re-run the extraction, update the commit above, and commit.
