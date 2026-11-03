# 对抗模式：怪物卡池 + 对称血量 + 怪物方 AI 契约（2026-11-04 v2 改造）

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

> v2（2026-11-04）：投放并入准备阶段、卡池改为本回合官方出怪、两档规则、点卡即投放、相机预设。v1 的「草稿+提交+独立投放窗口+三档」已作废。

> `[DESIGN]` 本文性质：**设计文档（对抗模式 / versus 改造）**。
> 状态：**代码已实现、未上线**（2026-11-04 v2 口径）。攻方投放失败扣攻方自己血这一条是对既有设计的**改判**，不是修 bug，见 §3.1；对称血量是 2026-11-03 已落地的部分，v2 沿用。
> 范围：只覆盖「两档规则 + 攻方进准备阶段 + 投放窗口在 PREP + 卡池=本回合官方出怪 + 点卡即投放 + 界面 + 共有/单人怪物 + 对称血量 + 怪物方 AI 契约」；卫戍原有机制的其它细节以 `docs/design/match.md`、`docs/research/01-core-rules.md`、`docs/PLAYING.md` 为准。
> 标记约定：`[DATA]` = 来自 PRTS / 仓库既有文档的可核实事实；`[ASSUMED]` = 无法从材料确认、需另行裁决；`[单源]` = 仅一个外部来源记载、PRTS 无记录，不作为既定事实。

---

## 1. 卫戍原有机制（PRTS 对照）

模式本质（[DATA]，PRTS「卫戍协议」页面）：

- **1–4 人合作 PvE 自走棋 + 塔防，无 PvP**；R14 最终攻势击破领袖即胜。
- **阶段循环**（[DATA]）：确认本局信息 → 选策略 → 每回合 `[机变]` → 休整期 → 作战 → `[联防]` → 结算 → R14 最终攻势 →（条件）R15 隐秘核心。
- **部署与费用**（[DATA]）：免费部署；部署顺序「从上到下 > 从左到右」；部署位初始 8；DP 初始 10、`+1/s`、上限 99，**只用于再部署**。
- **漏怪扣血**（[DATA]）：每只 `−1`，每回合最多 `−10`；`LP ≤ 0` 淘汰。
- **起始 LP**（[DATA]）：20–45（由「策略 / 分队」决定，**默认 28**）。
- **最终攻势**（[DATA]）：全队 LP 合并、共享领袖血池 = `bloodPoint × 开战存活人数`；超时每秒 `−1`。
- **敌方**（[DATA]）：**官方盟约没有敌方策略**，只有随回合的属性缩放（`atk×1.1^k`、`hp×1.2^k`）；AI 仅寻路 + 被阻挡即交战。

### 1.1 唯一先例（必须标注为单源）

2024 首期「卫戍协议」曾有敌方策略（R3/R4 拿初始策略、R5/R7/R8 起每偶数轮拿通用策略，一档带「+」强化）。

> **`[单源]` 仅 `arknights.wiki.gg` 一源记载；PRTS 四个页面（帮助 / 卫戍协议 / 卫戍协议：盟约 / 研究文档）均无记录。本文不作为既定事实，仅作历史背景，且本改造未实现它（见 §4）。**

### 1.2 来源标注

- PRTS：`https://prts.wiki/w/卫戍协议/帮助`、`https://prts.wiki/w/卫戍协议`、`https://prts.wiki/w/卫戍协议：盟约`
- 仓库侧：`docs/PLAYING.md`、`docs/research/01-core-rules.md`、`docs/design/match.md`

---

## 2. 本仓库改造前的缺口（审计结论，全部带 file:line）

> 此表是 **2026-11-03 v1 改造前**的审计结论，行号已按当前代码复核（v2 仍沿用同一批修复）。#4 的「`'ai'` 档」在 v2 已删除，现只有 `bounty`/`confront` 两档（见 §3.0 / §3.5）。

| # | 缺口 | 证据（`file:line`） | 玩家感知 |
|---|---|---|---|
| 1 | 没有「按模式分流」的 AI：唯一选择点是 `SP_BOT_STRATEGY` / `opts.botStrategy`，lobby 从不传；插件 `bot.js` 里 `difficulty` 出现 **0 次** | `plugins/mota/server/match/Match.js:315`（`this.botStrategy = botStrategyFor(opts.botStrategy ?? null)`）；`plugins/mota/server/match/bot.js`（grep `difficulty` = 0 命中） | 所有模式共用同一套 AI，无法为对抗档单独换策略 |
| 2 | 投放怪「免费泄漏」：`countInTotal: false` 让对手投放的怪漏过去不扣任何目标生命值（注释原文 *"a placed monster leaks FOR FREE"*） | `plugins/mota/server/match/match/confront.js:969`、`1766`、`1800`（`countInTotal: false`） | 「怪物方赢了对面不扣血」 |
| 3 | 攻方在 R1–R13 没有战场（`isRoleRound()` 下攻方不进 `fields`），结构上不可能掉血 | `plugins/mota/server/match/match/combat.js:173`（另 `:187`）（`fighters = this.isRoleRound() ? alive.filter((ps) => this.isDefender(ps)) : alive`） | 「怪物方无血量」 |
| 4 | v1 时 `versusRule` 只认 `'confront'`，versus-room 下发的 `'ai'` 被静默降级成 `'bounty'`（v2 已删除第三档，见 §3.0） | `plugins/mota/server/match/Match.js:311-313`（v2 只认 `'bounty'`/`'confront'`，其余回落 `bounty`；`versusLobby.js:30-31` 的 `RULES` 集合） | 选择 AI 对抗档无效（v1） |
| 5 | R14 把两队 `lp` 合并成单一 `teamLp` 且不回写 `teamLps`，两队血池从 R13 起冻结 | `plugins/mota/server/match/match/bossRounds.js:148`（`_openTeamLp` 合并 `teamLp`；`_syncTeamLp` 在 `:486` 回写，见 §3.5） | 顶栏两队血条不再变化 |
| 6 | 客户端只渲染本队池，敌方池全客户端零渲染 | `plugins/mota/client/js/ui/hud.js:473-480`（`poolOf` / `pools`；见 §3.5） | 看不到对手剩余血量 |
| 7 | coop 的联防没有对抗闸门，会把「一人漏一人不漏」误判成联防并改算扣血 | `plugins/mota/server/match/unite.js:49`（现为 `if (m.isSolo || m.isVersus) return null;`，见 §3.5） | 对抗局被错误触发联防扣血 |

---

## 3. 本次落地的设计（对应已实现代码）

### 3.0 两档规则（v2：撤掉第三档 `'ai'`）

- **档位集合**：`RULES = new Set(['bounty','confront'])`（`plugins/versus-room/server/versusLobby.js:30`）。未知档（含已删除的 `'ai'`）一律回落 `bounty`：`ruleOf(room)` 命中才用原值，否则 `'bounty'`（`versusLobby.js:31`）；服务端 `Match.js` 同样只认 `'bounty'`/`'confront'`，`mode_confront_*` 前缀映射到 `confront`，其余回落 `bounty`（`Match.js:311-313`）。
- **`bounty`（赏金，线上那套）**：每回合**强制轮换攻守**（`versusAlt: rule === 'bounty'`，`versusLobby.js:39`，服务端兜底 `Match.js:319`），倍速透传 `1 / 1.5 / 2`（只放大敌方数量，`versusLobby.js:41` / `Match.js:317`）。
- **`confront`（对抗，纯玩家出怪）**：**强制固定阵营**（`versusAlt:false`，攻守不换边），倍速**恒 1**。
- 房间层经 `wireOptions` 把 `versusRule` / `versusAlt` / `versusSpeed` / `monsterMode` / `monsterShop` 透传给子进程（`plugins/mota/server/match/host/proxy.js:46` 白名单）。

### 3.1 对称血量（业主 2026-11-03 口径：攻方投放失败要扣攻方自己的血）

> 这是**对既有设计的改判**（原设计是「免费泄漏、只为击杀赏金」，见 §2 #2/#3），不是修 bug。

- **守方**：对手投放的怪每漏一只扣 `1` 点守方队伍共享池，与官方漏怪合并后吃 `lpCapPerRound`（= 10）。位置：`plugins/mota/server/match/match/settle.js:52-88`（先汇总 `fr.confrontLeaks` 到 `placedLeaksByPlayer`，再 `loss = min(cap, counted + placedLeaks)`，其中 `cap = gd.lpCapPerRound`）。
- **攻方**：自己投放的怪每被击杀一只扣 `1` 点攻方队伍共享池，同样封顶 10。位置：`plugins/mota/server/match/match/settle.js:151-155`（按 `placedKillsByTeam` 从 `confrontKills` 汇总后扣）。
- **归属实现**：`confrontSeat` 从投放 spec 透传到战斗单位（`plugins/mota/server/match/match/confront.js:1763`、`1799` 写入 `confrontSeat: sentBy`）；sim 侧两张按席位计数表（`plugins/mota/server/sim/Battle.js:159-160` 的 `confrontKills` / `confrontLeaks`），分别在 `plugins/mota/server/sim/battle/deploy.js:159-161`（击杀）与 `279-281`（泄漏）自增，随 `plugins/mota/server/sim/battle/lifecycle.js:249-250` 的结果返回；`match/settle.js` 汇总到队并走 `_versusTeamLpLoss`。

```js
// plugins/mota/server/sim/battle/deploy.js:279-281
if (e.confrontSeat != null) {
  const k = String(e.confrontSeat);
  this.confrontLeaks[k] = (this.confrontLeaks[k] || 0) + 1;
}
```

### 3.2 怪物卡池（v2：来源 = 本回合官方出怪，点卡即投放）

| 项目 | 数值 / 出处 |
|---|---|
| 卡价 | `confrontValueOf(enemyKey)`（与波次价值同量纲；`plugins/mota/server/match/match/confront.js:352`） |
| 阶位切点 | `[25, 50, 100, 200]` → tier1..5（`plugins/mota/server/match/monsterPool.js:30` `MONSTER_TIER_BANDS`） |
| 每阶份数 | `tier1→8, tier2→6, tier3→4, tier4→2, tier5→1`（`monsterPool.js:33` `MONSTER_COPIES_BY_TIER`） |
| 商店格数 | 攻方每人 **5 格**（`monsterShop.js:37` `MONSTER_SHOP_SLOTS = 5`） |
| 刷新价 | **2**（1 次免费 + 最多 2 次自费：`monsterShop.js:39/41/43` `MONSTER_REFRESH_PRICE` / `MONSTER_FREE_REFRESHES` / `MONSTER_MAX_PAID_REFRESHES`） |
| 冻结 | 可冻结单格（`monsterShop.js` 的 `freezeMonster`，跳过 `frozen === true`） |
| 预算 | 复用 `confrontBudget()`：赏金档 `waveValue × ratio × budgetMul`；**对抗档 `waveValue × 1.5 ÷ 攻方人数`**，另有下限（`confront.js:656-690`，`/ attackingTeamSize()` 在 `:669`） |
| 池共享 | 按**队**共享（shared）/ 按**人**共享（solo），买走即少（`monsterPool.js` `entries` 的 `cap`/`left`，`monsterPoolFor` 决定键） |
| 开关 | `opts.monsterShop === false` 时 `monsterShopOn` 为假，卡池分支全不执行，行为与改造前逐字节一致（`confront.js:555`） |

- **卡池真源（v2 口径）**：每回合卡池 = **本回合的官方出怪**。`plugins/mota/server/match/match/phases.js:500` 建波后写只读快照 `m._roundOfficialSpawns`（`{enemyKey, count}`，`count = max(1, …)`）；`monsterPool.js` 的 `monsterCardKeys` / `legalKeys` / `buildMonsterPool` 全部以它为优先来源，没有快照（boss 回合 / 老对局）才回落 `confrontGroups`。**份数 = `min(阶位上限, max(官方合计, 1))`**（`monsterPool.js:267-271`），保证「官方只出过 1 只」也能买到。
- `_confrontMember` 的合法集调用同一个 `legalKeys`（`confront.js:1275-1278`），买得到一定交得上，与提交校验同源。
- **点卡即投放（替代 v1 的「买→草稿→提交」）**：`g.monsterPlace { index, gate:'upper'|'lower', count? 1..20 }`（路由 `plugins/mota/server/match/match/intents.js:28` → `placeMonster`）。服务端夹紧 `units = min(20, 库存 left, floor(剩余预算/单价), 想要)`（`monsterShop.js:371-373`），夹到 0 → `CONFRONT_BUDGET` 且不动库存；投放后该格**立即补位**（`refillSlot`，`monsterShop.js:209-239`，由 `placeMonster` 在 `:383` 调用）。旧的 `buyMonster`（投到 lower、1 只）与 `g.confront` 提交路径仍保留，但新客户端只走 `g.monsterPlace`。

### 3.3 怪物方 AI 契约（`plugins/mota/server/match/monsterContract.js`）

| hook | 签名 | 返回 `null` 含义 |
|---|---|---|
| `pickTargets` | `(m, ps) → playerId \| null` | 交回引擎的 `assignConfrontTarget` |
| `shopPlan` | `(m, ps) → 本回合买了哪些格` | 引擎不读返回值，副作用是 `ps.monsterDraft.picks` |
| `deployPlan` | `(m, ps) → picks[] \| null` | 交回引擎既有的贪心填充（legacy 行为） |

- **契约约束**：`MONSTER_HOOKS = ['pickTargets','shopPlan','deployPlan']`（`monsterContract.js:18`）；id 规则 `/^[a-z][a-z0-9-]*$/`（`monsterContract.js:21` `validId`）；构造期强校验 + 冻结（`defineMonsterStrategy`，`monsterContract.js:43`）；`base` 可继承（缺省 = `MONSTER_LEGACY_SENTINEL`，`monsterContract.js:30-36` 三个 hook 一律 `() => null`）。
- **内置两套**：
  - `legacy`：三 hook 返回 `null` = 交回引擎，行为与改造前一致。
  - `cardpool`（`plugins/mota/server/match/monsterStrategies.js:115`）：开商店 → 按「威胁值 / 价格」买入（`cardpoolShopPlan`，`monsterStrategies.js:75`）→ 交回引擎定路线/时刻（`cardpoolDeployPlan`，`monsterStrategies.js:91`）。
- **选择优先级**：`SP_MONSTER_STRATEGY` > 缺省「**对抗档（`isConfrontRule()`，即 `versusRule==='confront'`）`cardpool` / 其它档 `legacy`**」（`monsterStrategies.js:145-151` `monsterStrategyFor`）。注意：v2 只有 `bounty` / `confront` 两档，缺省口径看的是 `isConfrontRule()`，与 `versusRule` 是否等于 `'confront'` 挂钩，不再有 `'ai'` 档的特例。

### 3.4 按模式独立 AI 策略（`plugins/mota/server/match/botStrategies.js` + `botContract.js`）

- 与根仓库 `server/match/botStrategyContract.js` 同构的 **5 hook**（`plugins/mota/server/match/botContract.js:15` `HOOKS = ['pickBand','pickCard','prepBegin','prepEnd','bountyKillChance']` + 可选 `decide`）。
- **模式表**（当前全部指向 `legacy`，即行为不变；这是唯一需要改的地方）：

| mode | 策略 | 出处 |
|---|---|---|
| `solo` | `legacy` | `plugins/mota/server/match/botStrategies.js:11` |
| `coop` | `legacy` | `botStrategies.js:12` |
| `versus` | `legacy` | `botStrategies.js:13` |
| `bounty` | `legacy` | `botStrategies.js:14` |
| `confront` | `legacy` | `botStrategies.js:15` |
| `rogue` | `legacy` | `botStrategies.js:17` |

- **调用点**走 `this.botStrategy`（构造期 `plugins/mota/server/match/Match.js:315` `this.botStrategy = botStrategyFor(this, opts.botStrategy ?? null)`），`legacy` 时取到的就是同一个函数对象（已实测）：
  - `plugins/mota/server/match/match/prep.js:126`、`150`（`scheduleBotPrep` 调 `this.botStrategy?.prepEnd` / `prepBegin`）
  - `plugins/mota/server/match/match/phases.js:168-169`（`pickBand`）
  - `plugins/mota/server/match/match/spDraft.js:84`、`167`（`pickCard`）

### 3.5 两档规则 + 三 bug 修复（v2 口径）

| 修复 / 落地 | 位置 |
|---|---|
| **两档规则**：`RULES = new Set(['bounty','confront'])`，未知档回落 `bounty` | `plugins/versus-room/server/versusLobby.js:30-31`（`RULES` + `ruleOf`，`ruleOf(room)` 命中才用原值，否则 `'bounty'`）；`plugins/mota/server/match/Match.js:311-313`（`versusRule` 取值：只认 `'bounty'`/`'confront'`，`mode_confront_*` 前缀映射到 `confront`，其余回落 `bounty`；`'ai'` 档已删除） |
| `versusAlt`：攻守每回合轮换只在 `bounty` 档强制为 `true`；`confront` 档强制固定阵营（`versusAlt:false`）；服务端兜底、不信客户端 | `plugins/versus-room/server/versusLobby.js:39`（`versusAlt: rule === 'bounty'`）；`plugins/mota/server/match/Match.js:319`（`this.versusAlt = this.isVersus ? opts.versusAlt !== false : null`） |
| 倍速：`bounty` 档透传 `1 / 1.5 / 2`（仅放大敌方数量），`confront` 档恒 `1` | `plugins/versus-room/server/versusLobby.js:41`（`versusSpeed`）；`plugins/mota/server/match/Match.js:317` |
| R14 两队池继续可读（`_openTeamLp` 合并的同时按 `lpAtFinal` 拆回，`_syncTeamLp` 每次回写 `teamLps`） | `plugins/mota/server/match/match/bossRounds.js:148`（`_openTeamLp`）、`486`（`_syncTeamLp`） |
| 顶栏显示两队剩余（本队 `is-own` / 对手 `is-foe`），观战席两队中立 | `plugins/mota/client/js/ui/hud.js:473-480`（`poolOf` / `pools`）、`513-514`（渲染 `is-own` / `is-foe`） |
| 联防在对抗局不触发 | `plugins/mota/server/match/unite.js:49`（`if (m.isSolo || m.isVersus) return null;`） |

### 3.6 界面（v2）

- **怪物卡进现有商店条**：复用 `.scard` 外壳（卡面是怪物图标，不是干员立绘），攻方商店条在 PREP 里渲染（`shopBar.js:117` 的 `class="scard scard--t{tier}"`，`:53/:125/:192/:229` 的价格/库存/选门浮层）。只有攻方（且商店帧 `open===true`）才看得到（`game.js:370` 的 `showShop` 闸门、`1851` 的 `<MonsterShop>`）。
- **「选门 + 选数量」浮层**：点一张怪卡 → 下方弹浮层，两个门按钮（upper/lower）+ 数量步进（`shopBar.js:229-232` 的 `GatePick`/`count` 字段、`561` 发 `g.monsterPlace { index, gate, count }`）；不弹占屏 modal。
- **出击遮罩改为按钮 + 非遮挡清单卡片**：旧「选目标/出击」遮罩改成游戏页状态条里一个「查看投放 / 继续投放」入口（`confrontOverlay.js:6-7` 的 `ConfrontDoneCard`），已投清单用非遮挡卡片展示，不再挡住干员与聊天/观战。
- **相机新增 `spawn` 预设**：攻方（`myRole==='attack'`）在 PREP 与观战里镜头对准守方棋盘右上出怪口（`spawnCam('L')`，`game.js:209-218`；`618` / `816` 的 `attackView ? spawnCam('L') : prepCameraFor(...)`），`fit: true` 走既有拟合路径。

### 3.7 共有出怪 / 单人怪物（`opts.monsterMode`）

- **`shared`（默认，共有出怪）**：池按**队**共享（`monsterPoolFor` 用 `teamIdOf(ps)` 作键，`confront.js:1200-1204`），同队攻方共用**同一个 target**（`confront.js:1132-1155` 的 `teamTarget()`，先取本队第一个已分配目标）；
- **`solo`（单人怪物）**：池按**人**（`playerId` 作键，`confront.js:1202-1203`），只有该队**第一位存活攻方**能开店 / 能买能投，其余攻方一律 `WRONG_PHASE`（`confront.js:572-574` `monsterPlaceActor`；`monsterShop.js:87-88` 的 `placeActorOk`）。
- 房间层已透传 `monsterMode`（`versusLobby.js:44`：`room.monsterMode==='solo' ? 'solo' : 'shared'`），worker 白名单已加 `monsterMode` / `monsterShop`（`proxy.js:46`）。

---

## 4. 明确「不做 / 待定」

- 2024 首期那套「敌方策略按回合解锁」**没有实现**（单源、且当前卡池已提供更细的玩法；见 §1.1）。
- v1 的「草稿+提交+独立投放窗口+三档（`ai`）」**已作废**（2026-11-04 改判）：现在投放即点即投、窗口并入 PREP、规则只剩 `bounty`/`confront`。
- 敌方队伍血条目前只在顶栏，没有做成独立血条面板。
- `lpCapPerRound` 是「守方每人 10 + 攻方每队 10」，不是「每队合计 10」——如需改成合计封顶要另行裁决（`[ASSUMED]`，待业主确认语义）。

---

## 5. 验收方式

在本地 `npm start` 起一局 versusRoom（或线上），逐项确认：

1. **两档规则（§3.5）**：房间 `variant` 填 `bounty` → 每个攻守回合攻守互换、`versusSpeed` 可选 1/1.5/2；填 `confront` → 攻守固定（不换边）、倍速恒 1。故意传 `'ai'` 或其它未知串 → 服务端 `ruleOf` / `Match.js` 回落 `bounty`（看 `versusLobby.js:31`、`Match.js:313`）。
2. **攻方进 PREP（§3 / §2）**：攻守回合里，攻方出现在同一个 PREP（`prepPlayers()` 返回全体存活，`prep.js:19-21`），不再被强制 `ready=true`；`enterPrep` 起算单一 `deadline = gd.prepTime(round)`（`prep.js:49`），攻守同一起算；`PHASE.CONFRONT` 只剩「选目标 10 秒」（`confront.js:1068` `setDeadline(VERSUS_CONFRONT.targetSeconds)`，`constants.js:422` `targetSeconds: 10`）。
3. **点卡即投放 + 补位（§3.2）**：PREP 里攻方商店条点怪 → 弹「选门（upper/lower）+ 选数量」浮层（`shopBar.js:229-232` 的 `GatePick`/`count` 浮层、`561` 发 `g.monsterPlace`）→ 该格怪立刻进 `ps.monsterDraft.picks` 并**用掉后该格立即补位**（`monsterShop.js:352-385` `placeMonster` + `refillSlot`；夹紧 `Math.min(20, 库存, floor(预算/单价), 想要)`）。
4. **卡池 = 本回合官方出怪（§3.2）**：建波后 `m._roundOfficialSpawns` 被写入（`phases.js:500`），`monsterCardKeys`/`legalKeys`/`buildMonsterPool` 全部以它为优先（`monsterPool.js:231-274`）；份数 = `min(阶位上限, max(官方合计,1))`。可在 PREP 卡池里看到的正好是本回合官方出的怪种。
5. **相机预设（§3.6）**：攻方（`myRole==='attack'`）在 PREP / 观战里镜头落在守方棋盘右上出怪口（`spawnCam`，`game.js:209-218`；`618` / `816` 的 `attackView ? spawnCam('L')`）。
6. **界面（§3.6）**：攻方商店条复用 `.scard` 外壳、卡面是怪物图标（`shopBar.js:117`），点卡弹「选门+选数量」浮层而非占屏 modal（`shopBar.js:229-232`）；出击遮罩改成状态条里一个非遮挡的「查看投放」按钮 + 已投清单卡片（`confrontOverlay.js:6-7`）。
7. **共有/单人怪物（§3.7）**：房间 `monsterMode` 填 `shared`（默认）→ 同队攻方共用一个池、共用一个 target（一人选了目标，队友自动跟随）；填 `solo` → 只有该队第一位存活攻方能开店投放，其余攻方点商店一律 `WRONG_PHASE`（`confront.js:572-574`、`monsterShop.js:87-88`）。
