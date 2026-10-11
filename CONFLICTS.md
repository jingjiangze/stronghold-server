# 与上游的冲突清单（以后同步时看这份）

日期：2026-10-11 · 状态：`BASELINE`（已核实）／`PENDING`（待定）

**基线**
- 本仓源：`Stardust-minus/Stronghold-Protocol` master `f6d393e`（2026-10-11）· **v0.2.3**
- 上游：`sganggs/Stronghold-Protocol` · **v0.2.4**（2026-10-11 发布）
- 差异总量 439 条（Stardust 独有 166 / 上游独有 13 / 共有但不同 260）

**判据**：把 Stardust 独有的功能性概念做成标识符集合扫两棵树——上游 **0 命中**，
Stardust 命中 73 文件。零命中意味着"上游根本没有这块东西"，是真分叉而非版本落后。

---

## B 类 · 真分叉（同步必须人工处理）

### 1. 服务器部署 / 运维

| 路径 | Stardust 做了什么 | 冲突性质 |
|---|---|---|
| `server/cluster/**`（13 文件独有） | coordinator / game-node / ingress 集群层 | 上游**无此目录**；`server/index.js` **不引用**它 → 单容器部署不需要 |
| `server/healthMetrics.js`（独有） | 主线程 ELU / 延迟 / RSS 采样，`serverLoadState` | 上游无 `/healthz` 性能字段概念 |
| `server/wsCompression.js`（独有） | `SP_WS_COMPRESSION`，默认 off | 上游 WebSocket 硬编码不带 `perMessageDeflate` |
| `server/index.js` | 新增 CombatWorkerPool 双 Worker 池、4 个新环境变量 | 上游 `index.js` **一行 `process.env` 都不读**；启动/关停流程重写 |
| `server/http/routes.js` | `/healthz` 新增 combat/trial/performance 三段 + `GET /client-build` | 上游 `/healthz` 只有 ok/version/app/uptimeSec/build/maxRooms |
| `Dockerfile` | build/runtime 两处额外 COPY `deploy/stardust/auth/name-*.mjs` + 4 个 LICENSE | 上游无此 stage 内容 —— **部署硬依赖，见下** |
| `deploy/**`（139 文件独有） | nginx、compose×6、systemd×7、独立 auth 服务、material-lb、openi-resolver | 上游**完全没有 `deploy/` 目录** |

> **部署硬依赖（务必知悉）**：`server/net.js` → `shared/names.js` → `deploy/stardust/auth/name-policy.mjs`
> 是一条死的静态 import 链。缺了这四个 `.mjs`（+ 4 个 LICENSE）**启动直接崩溃**，
> 且无法用环境变量绕过。Dockerfile 里那两段 COPY 不能删。
> 注意：只要 `name-*.mjs`，不需要 `auth/server.mjs`、登录页、口令文件。

### 2. 战斗 / 对局

| 路径 | Stardust 做了什么 | 冲突性质 |
|---|---|---|
| `server/match/combat/**`（7 文件独有） | 固定战斗 Worker 池 + 独立试算池 | 上游无此目录，`server/index.js` 直接 import |
| `server/match/damageBoard.js` + `server/sim/damageBoard.js`（独有） | 伤害统计板，协议新增 `m.damage` | 上游无 |
| `server/match/match/settle.js` | 救援 / 复活状态机（`REVIVAL_*` 常量） | 上游死亡即 finalize，无 revival 分支 |
| `server/match/unite.js` | 联防二段中继（+68 行） | 上游联防是单轮 |
| `server/lobby.js` + `server/matchmaking.js`（557 行独有） | 公共匹配队列 `queue.join/cancel/accept` | 上游 `lobby.js` 里 grep `matchmaking`、`queue` 均**零命中** |
| `shared/playerCapacity.js` + `shared/experimental.js`（独有） | 房间容量扩到 20 人 | 上游硬编码 `MAX_SEATS = 4`，无 experimental 概念 |

### 3. 配置 / 数据

| 路径 | Stardust 做了什么 | 冲突性质 |
|---|---|---|
| `data/config.json` · `bossHpScale` | `perPlayer:false, solo:0.25, aliveScaling:true` | 上游 0.2.4 改成 `perPlayer:true, coop:1, solo:1, aliveScaling:false`（PR #209）。**规则分歧，Boss 血量差 4 倍量级 → 必须人工选边** |
| `data/config.json` · `economy.poolCopiesOverrides` | 只剩 `{"chess_char_6_11_a":4}` | 上游 0.2.4 新增一大份共享库存覆盖表（属 A 类，混入同一文件） |
| `data/assets.json` | 15980 文件 / **2.25 GB**（含 271 皮肤），`generator` 变成 `merge-generated-release.mjs` | 确证是**生成产物**非手改：`merge-generated-release.mjs` 有硬断言。主体 `chars`/`enemies`/`bonds`/`items`/`ui` 与上游字节相同 |
| `tools/merge-generated-release.mjs`（独有） | 三方清单合并器 | **同步地雷**：要求 fork 侧 config 变化恰好 33 条且全在 `bossHpScale.*` 前缀，否则抛错 |
| `data/announcements.json`（独有） | 大厅公告（含运营日期） | 上游无公告机制 |

### 4. 构建 / 依赖

- **`tools/vendor.mjs`** —— 与上游**字节完全相同**，不是冲突。
- **`package.json` / `package-lock.json`** —— 只有 `version` 一行不同（197 个包集合完全相同），A 类，跟随上游即可。
- **`tools/fetch-assets.mjs`** —— Stardust 支持多语言语音（`--voice-langs=L`、`retainManifestVoices`），上游只有单 `--voice-lang`。

### 5. 客户端（Stardust 独有 24 文件）

`public/js/ui/` 17 个（damageBoard、skinPicker、operatorPresetModel、voiceLanguage、matchmaking、
announcements、revival、themeSettings…）、`public/js/` 4 个（materialFallback、queueCancellation、
serviceTelemetry…）、`public/js/render/materialLoader.js`、`public/css/screens/` 2 个。

共有 public 文件里 35 条确证 B 类；按子目录聚合：`public/js/ui` 31、`public/js/screens` 10、
`public/js/render` 8、`public/js` 根 7、`public/css` 11、`public/i18n` 4。

---

## A 类 · 版本落后（追赶上游自动消失）

约 176 条 + 上游独有 13 文件。代表：
`docs/history/0.2.4.md`、`CHANGELOG.md` 的 0.2.4 章节、
`server/sim/content/kits/ops/op-clemnt.js` 等 0.2.4 规则修复、
`shared/summonPlacement.js`（上游独有）、大量 `test/**`（71 条）。

> A/B 是**改动级**而非文件级：`data/config.json` 里 `poolCopiesOverrides` 是 A、
> `bossHpScale` 是 B；`settle.js` 同理混杂上游结算改动与 Stardust revival。

---

## 模型空间部署侧的取舍（2 vCPU / 8G / 单容器 / 端口 7860）

**必需保留**
1. `deploy/stardust/auth/name-*.mjs` + 4 LICENSE —— 缺了崩溃
2. `PORT=7860`（原 3000，创空间硬约束）
3. `data/assets.json` 与 `public/assets/` 必须配对

**可关 / 不需要**
- `SP_COMBAT_WORKERS` / `SP_TRIAL_WORKERS` **不设**（默认 0/0 = 同步内联；2 vCPU 开 Worker 反抢主线程）
- `SP_WS_COMPRESSION` **不设**（默认 off，perMessageDeflate 在 2 vCPU 是纯开销）
- `server/cluster/**` 完全不参与
- `deploy/stardust/` 除 auth 字典外**全部不需要**（nginx/compose/systemd/material-lb/openi-resolver）
- `main-thread-priority` **不适用**（宿主级 `nice=-20`，容器无 `CAP_SYS_NICE`）
- auth 独立服务（独立容器）不需要 —— 游戏服只依赖它的字典文件
- 20 人扩容房间：2 vCPU / 8G 不建议开放，保持 4 人默认

---

## PENDING · 尚未判定

1. **`bossHpScale` 谁"对"** — 两边文档都自称有依据，无权威判据。本次保持 Stardust 原值。
2. **`server/match/match/` 下 11 个未命中标记文件的归属** — 只确认了
   `common.js`（REVIVAL_*）、`settle.js`、`spDraft.js` 三条是 B；
   `clientCombat.js`、`intents.js`、`messaging.js`、`pause.js`、`phases.js`、`watch.js`
   各有 1–4 行增量，大概率是 A 或微小适配，但**未逐行读完**。
3. **`public/` 下 39 个未命中标记的文件** — 同上，未逐个读 diff。
4. **NFS mount 路径** — ModelScope「创空间 + NAS」的挂载点未核实，影响素材方案（见 task_plan.md 阻塞项 B）。
5. **按 commit 归因** — 本地快照仓只有 1 个 commit、无 remote 历史，
   **无法区分"Stardust 自己写的"与"从别处合入的"**。上文 B 类判定仅基于工作树内容对比。
