# 对抗模式：怪物卡池 + 对称血量 + 怪物方 AI 契约（2026-11-03 改造）

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

> `[DESIGN]` 本文性质：**设计文档（对抗模式 / versus 改造）**。
> 状态：**代码已实现、未上线**（2026-11-03 口径）。攻方投放失败扣攻方自己血这一条是对既有设计的**改判**，不是修 bug，见 §3.1。
> 范围：只覆盖「怪物卡池 + 对称血量 + 怪物方 AI 契约 + 按模式独立 AI 策略 + 三个 bug 修复」五块；卫戍原有机制的其它细节以 `docs/design/match.md`、`docs/research/01-core-rules.md`、`docs/PLAYING.md` 为准。
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

下表为改造前审计出的七处缺口，行号指向**当前代码中的机制位置**（即缺口曾存在的代码点；§3 已逐项修复）。

| # | 缺口 | 证据（`file:line`） | 玩家感知 |
|---|---|---|---|
| 1 | 没有「按模式分流」的 AI：唯一选择点是 `SP_BOT_STRATEGY` / `opts.botStrategy`，lobby 从不传；插件 `bot.js` 里 `difficulty` 出现 **0 次** | `server/match/Match.js:341`（`this.bot = getBotStrategy(opts.botStrategy ?? env('SP_BOT_STRATEGY'))`）；`plugins/mota/server/match/bot.js`（grep `difficulty` = 0 命中） | 所有模式共用同一套 AI，无法为对抗档单独换策略 |
| 2 | 投放怪「免费泄漏」：`countInTotal: false` 让对手投放的怪漏过去不扣任何目标生命值（注释原文 *"a placed monster leaks FOR FREE"*） | `plugins/mota/server/match/match/confront.js:935`、`1679`、`1713`（`countInTotal: false`） | 「怪物方赢了对面不扣血」 |
| 3 | 攻方在 R1–R13 没有战场（`isRoleRound()` 下攻方不进 `fields`），结构上不可能掉血 | `plugins/mota/server/match/match/combat.js:173`（`fighters = this.isRoleRound() ? alive.filter((ps) => this.isDefender(ps)) : alive`） | 「怪物方无血量」 |
| 4 | `versusRule` 只认 `'confront'`，versus-room 下发的 `'ai'` 被静默降级成 `'bounty'` | `plugins/mota/server/match/Match.js:309-314`（现三档均保留原值；改造前仅 `'confront'` 被识别，见 §3.5） | 选择 AI 对抗档无效 |
| 5 | R14 把两队 `lp` 合并成单一 `teamLp` 且不回写 `teamLps`，两队血池从 R13 起冻结 | `plugins/mota/server/match/match/bossRounds.js:148-158`（`_openTeamLp` 合并 `teamLp`；改造前无 `_syncTeamLp` 回写，见 §3.5） | 顶栏两队血条不再变化 |
| 6 | 客户端只渲染本队池，敌方池全客户端零渲染 | `plugins/mota/client/js/ui/hud.js:473-477`（`poolOf` / `pools`；改造前仅取 `myTeam`，见 §3.5） | 看不到对手剩余血量 |
| 7 | coop 的联防没有对抗闸门，会把「一人漏一人不漏」误判成联防并改算扣血 | `plugins/mota/server/match/unite.js:46`（改造前无条件进入 co-op 联防；现为 `if (m.isSolo || m.isVersus) return null;`，见 §3.5） | 对抗局被错误触发联防扣血 |

---

## 3. 本次落地的设计（对应已实现代码）

### 3.1 对称血量（业主 2026-11-03 口径：攻方投放失败要扣攻方自己的血）

> 这是**对既有设计的改判**（原设计是「免费泄漏、只为击杀赏金」，见 §2 #2/#3），不是修 bug。

- **守方**：对手投放的怪每漏一只扣 `1` 点守方队伍共享池，与官方漏怪合并后吃 `lpCapPerRound`（= 10）。位置：`plugins/mota/server/match/match/settle.js:59-77`（汇总 `fr.confrontLeaks` 到 `placedLeaksByPlayer`，`loss = min(cap, counted + placedLeaks)`）。
- **攻方**：自己投放的怪每被击杀一只扣 `1` 点攻方队伍共享池，同样封顶 10。位置：`plugins/mota/server/match/match/settle.js:150-152`（按 `placedKillsByTeam` 从 `confrontKills` 汇总后扣）。
- **归属实现**：`confrontSeat` 从投放 spec 透传到战斗单位（`plugins/mota/server/match/match/confront.js:1676`、`1712` 写入 `confrontSeat: sentBy`）；sim 侧新增两张按席位计数表（`plugins/mota/server/sim/Battle.js:159-160` 的 `confrontKills` / `confrontLeaks`），分别在 `plugins/mota/server/sim/battle/deploy.js:159-161`（击杀）与 `279-281`（泄漏）自增，随 `battle/lifecycle.js:249-250` 的结果返回；`match/settle.js` 汇总到队并走 `_versusTeamLpLoss`。

```js
// plugins/mota/server/sim/battle/deploy.js:279-281
if (e.confrontSeat != null) {
  const k = String(e.confrontSeat);
  this.confrontLeaks[k] = (this.confrontLeaks[k] || 0) + 1;
}
```

### 3.2 怪物卡池

| 项目 | 数值 / 出处 |
|---|---|
| 卡价 | `confrontValueOf(enemyKey)`（与波次价值同量纲；`plugins/mota/server/match/match/confront.js:352`） |
| 阶位切点 | `[25, 50, 100, 200]` → tier1..5（`plugins/mota/server/match/monsterPool.js:26` `MONSTER_TIER_BANDS`） |
| 每阶份数 | `tier1→8, tier2→6, tier3→4, tier4→2, tier5→1`（`monsterPool.js:30` `MONSTER_COPIES_BY_TIER`） |
| 商店格数 | 攻方每人 **5 格**（`monsterShop.js:20` `MONSTER_SHOP_SLOTS = 5`） |
| 刷新价 | **2**（1 次免费 + 最多 2 次自费：`monsterShop.js:22/24/26` `MONSTER_REFRESH_PRICE` / `MONSTER_FREE_REFRESHES` / `MONSTER_MAX_PAID_REFRESHES`） |
| 冻结 | 可冻结单格（`monsterShop.js:128` 跳过 `frozen === true`） |
| 预算 | 复用 `confrontBudget()`：赏金档 `waveValue × ratio × budgetMul`；**对抗档 `waveValue × 1.5 ÷ 攻方人数`**，另有下限（`confront.js:622-660`） |
| 池共享 | 按**队**共享，买走即少（`monsterPool.js` `entries` 的 `cap`/`left`） |
| 开关 | `opts.monsterShop === false` 时 `monsterShopOn` 为假，卡池分支全不执行，行为与改造前逐字节一致（`confront.js:545`） |

- **购买 → 进 `ps.monsterDraft.picks`** → 提交仍走既有 `g.confront`，预算 / 上限 / 合法怪集合校验一条没改（`plugins/mota/server/match/match/confront.js:1156-1175` 的 `submitConfront`：先 `confrontPlaceCap()`、`VERSUS_CONFRONT.maxBosses`、`_confrontMember` 合法怪判定，全部沿用）。

### 3.3 怪物方 AI 契约（`plugins/mota/server/match/monsterContract.js`）

| hook | 签名 | 返回 `null` 含义 |
|---|---|---|
| `pickTargets` | `(m, ps) → playerId \| null` | 交回引擎的 `assignConfrontTarget` |
| `shopPlan` | `(m, ps) → 本回合买了哪些格` | 引擎不读返回值，副作用是 `ps.monsterDraft.picks` |
| `deployPlan` | `(m, ps) → picks[] \| null` | 交回引擎既有的贪心填充（legacy 行为） |

- **契约约束**：`MONSTER_HOOKS = ['pickTargets','shopPlan','deployPlan']`（`monsterContract.js:18`）；id 规则 `/^[a-z][a-z0-9-]*$/`（`monsterContract.js:21` `validId`）；构造期强校验 + 冻结（`defineMonsterStrategy`，`monsterContract.js:43`）；`base` 可继承（缺省 = `MONSTER_LEGACY_SENTINEL`，`monsterContract.js:30-36` 三个 hook 一律 `() => null`）。
- **内置两套**：
  - `legacy`：三 hook 返回 `null` = 交回引擎，行为与改造前一致。
  - `cardpool`（`plugins/mota/server/match/monsterStrategies.js:119`）：开商店 → 按「威胁值 / 价格」买入（`cardpoolShopPlan`，`monsterStrategies.js:75`）→ 交回引擎定路线/时刻（`cardpoolDeployPlan`，`monsterStrategies.js:95`）。
- **选择优先级**：`SP_MONSTER_STRATEGY` > 缺省「对抗档 `cardpool` / 其它 versus 档 `legacy`」（`monsterStrategies.js:149-154` `monsterStrategyFor`）。

### 3.4 按模式独立 AI 策略（`plugins/mota/server/match/botStrategies.js` + `botContract.js`）

- 与根仓库 `server/match/botStrategyContract.js` 同构的 **5 hook**（`plugins/mota/server/match/botContract.js:15` `HOOKS = ['pickBand','pickCard','prepBegin','prepEnd','bountyKillChance']` + 可选 `decide`）。
- **模式表**（当前全部指向 `legacy`，即行为不变；这是唯一需要改的地方）：

| mode | 策略 | 出处 |
|---|---|---|
| `solo` | `legacy` | `plugins/mota/server/match/botStrategies.js:9` |
| `coop` | `legacy` | `botStrategies.js:10` |
| `versus` | `legacy` | `botStrategies.js:11` |
| `bounty` | `legacy` | `botStrategies.js:12` |
| `rogue` | `legacy` | `botStrategies.js:13` |

- **三个调用点**从直接 import 改成走 `this.botStrategy`（构造期 `plugins/mota/server/match/Match.js:316` `this.botStrategy = botStrategyFor(this, opts.botStrategy ?? null)`），`legacy` 时取到的就是同一个函数对象（已实测）：
  - `plugins/mota/server/match/match/prep.js:129`、`153`
  - `plugins/mota/server/match/match/phases.js:168-169`
  - `plugins/mota/server/match/match/spDraft.js:84`、`167`

### 3.5 三 bug 修复

| 修复 | 落地位置 |
|---|---|
| `'ai'` 规则保留原值（不再降级成 `'bounty'`） | `plugins/mota/server/match/Match.js:313`（`'bounty' \| 'confront' \| 'ai'` 三档原值保留） |
| R14 两队池继续可读（`_openTeamLp` 合并的同时按 `lpAtFinal` 拆回，`_syncTeamLp` 每次回写 `teamLps`） | `plugins/mota/server/match/match/bossRounds.js:148-158`（`_openTeamLp`）、`486`（`_syncTeamLp`） |
| 顶栏显示两队剩余（本队 `is-own` / 对手 `is-foe`），观战席两队中立 | `plugins/mota/client/js/ui/hud.js:473-477`（`poolOf` / `pools`）、`513-514`（渲染 `is-own` / `is-foe`） |
| 联防在对抗局不触发 | `plugins/mota/server/match/unite.js:46`（`if (m.isSolo || m.isVersus) return null;`） |

---

## 4. 明确「不做 / 待定」

- 2024 首期那套「敌方策略按回合解锁」**没有实现**（单源、且当前卡池已提供更细的玩法；见 §1.1）。
- 攻方没有手牌上限（买即进草稿），没有跨回合持有。
- 敌方队伍血条目前只在顶栏，没有做成独立血条面板。
- `lpCapPerRound` 是「守方每人 10 + 攻方每队 10」，不是「每队合计 10」——如需改成合计封顶要另行裁决（`[ASSUMED]`，待业主确认语义）。

---

## 5. 验收方式

四项生效的确认路径（本地 `npm start` 或线上均可）：

1. **对称血量（§3.1）**：开一局对抗（versusRoom，规则档 `confront` / `ai`），攻方投放怪被守方全歼 → 顶栏攻方数值下降；守方漏掉攻方投放的怪 → 守方数值下降。二者均每回合封顶 10（`lpCapPerRound`）。可对照 `plugins/mota/server/match/match/settle.js:59-77` 与 `150-152` 的扣减分支。
2. **怪物卡池（§3.2）**：攻方休整期出现 5 格商店，怪按阶位 `[25,50,100,200]` 分 5 档、份数 `8/6/4/2/1`，刷新价 2（1 免费 + 2 自费），可冻结单格；买走后同队他人商店同格减少。关 `opts.monsterShop === false` → 回到旧平铺面板、无任何卡池副作用。
3. **怪物方 AI 契约（§3.3）**：设 `SP_MONSTER_STRATEGY=cardpool`（对抗档缺省即此）时，攻方 AI 自动开商店买入并按威胁值/价格投放；设 `legacy` 时回落引擎原逻辑。id 不满足 `/^[a-z][a-z0-9-]*$/` 的策略在构造期抛 `TypeError`。
4. **按模式独立 AI + 三 bug（§3.4 / §3.5）**：`versusRule='ai'` 不再降级为 `bounty`；R14 顶栏两队血条持续随战斗变化（不再冻结）；观战席两队均按中立渲染；对抗局不触发 co-op 联防。
