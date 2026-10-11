# Bounded WebSocket compression

This page describes the transport policy, not a deployed release or completed
acceptance. Keep actual commit/image pairs and checks in local private records;
see [record boundaries](releases/README.md).

`WS_COMPRESSION=on` opts this game process into the bounded transport preset. The default is `off`; any other value is refused before workers or listeners start. This is not an HTTP gzip setting or a hot reload. The historical name `SP_WS_COMPRESSION` is still accepted (and wins nothing: `WS_COMPRESSION` is read first).

The implementation is the **upstream module**, vendored verbatim at `server/ws-compression/` (`jingjiangze/stronghold-ws-compression`, MIT — see its `SOURCE.md`); `server/wsCompression.js` only binds it to this process. Do not re-declare the option set locally.

Preset: level 6, memLevel 5, a 64-byte threshold, client side without context takeover, server side WITH context takeover, and a ws zlib concurrency limit of 8. Two options are deliberately **not declared** — `serverNoContextTakeover` and `serverMaxWindowBits` — because `ws` turns a rejected offer into an HTTP 400 (no connection at all, not a degraded one); leaving them out means "negotiate", so a client that asks for less still connects. The mode `safe` exists for that one risk: it declares `serverNoContextTakeover` and still leaves the window negotiated.

Only `b.snap`, `b.ev`, `m.field`, `m.public`, `m.private` and `m.result` are eligible for server compression; `WS_COMPRESS_EXTRA` adds types on top (default `b.start`, the ~4.2 KB battle spec, the single largest frame on the wire) and `WS_COMPRESS_EXTRA=none` takes them back without a deploy. Credential-bearing `welcome`, unknown/control messages, presence and saved result replay default to `compress: false`, even if large. Already-encoded Worker frames retain the trusted message-type decision without parsing JSON again. Backpressure, inbound decompressed 64 KiB maximum, admission, rate limits and session behavior remain unchanged. Clients without the extension still receive ordinary messages.

Two read-only routes report the transport without holding a socket: `GET /ws-compression/status` (the active mode, the option set that will reach the wire — including the two undeclared options — the compressible types, the socket count) and `GET /ws-compression/stats` (frames sent/skipped, bytes, terminated sockets). Both are `no-store`, `GET`/`HEAD` only (`405 Allow: GET, HEAD` otherwise), and neither can change the mode — changing it is a restart with a different value.

## Verification boundaries

Measure deterministic transport fixtures separately from real game simulation.
Report compressed frame bytes, main and total CPU, delivery latency and RSS together;
do not infer capacity from one transport replay. TLS, WAN, WG, player identity count
and full-game work are separate dimensions. Short runs do not prove long-term zlib
fragmentation or stability. Eligible frames smaller than 64 bytes must remain plain.

The original scheduling/security policy stays unchanged: only Main is nice=-20
with SCHED_OTHER/reset-on-fork; all other threads remain0, with no container
CAP_SYS_NICE or game CPU/memory hard caps. A test command or this document does not
claim that any production verification passed.

## Activation and rollback

Use a fixed tested commit/image pair, record the actual deployed image ID and append only its approved pair to the approved owned profile. Add the flag to the fixed runtime.env and Compose environment with byte/hash CAS and fresh backups. Stop/start only the approved core manager; stopping it closes its own WG lease and stops its own game. Do not stop/restart WG, other managers, auth, resolver, OpenResty or unrelated services.

A game restart loses in-memory matches. Immediate maintenance requires explicit user authorization; an approval to develop or push is not that authorization. Old image/configuration and its allowlist pair remain rollback materials, not recovery of lost matches. The flag may be returned tooff in a later authorized restart, or the matched old image/config restored.

No frontend, package/lock, shared/data or public resource changes are required by this feature. Existing private JS/CSS and assets may be reused only after fixed-commit byte/tree equality is proved; do not upload or overwrite immutable resources merely to change this server-only option. Authentication keys, verifier and TLS are a separate unchanged release line.
