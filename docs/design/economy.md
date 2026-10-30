# DESIGN §37, §38, §39 — 协同经济（合作模式团队经济）、协同共竞 与 房间文字聊天

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

> 这两节写的是**规则**：什么条件下发生什么、数值是多少、边界在哪里。实现（哪个文件、哪个方法、怎么记账）
> 属于代码本身，不写在这里。面向玩家的同一套规则见 [玩法指南](../PLAYING.md#14-协同共竞合作经济)。

## 37. 协同经济 — the co-op team economy

一套默认关闭的合作规则集（按优先级取：模式自己的 `teamEconomy` → 肉鸽的 `config.economy.rogueTeam` →
全局 `config.economy.team`），**只在合作模式生效，独立模拟永远没有**。经济模型只有**一层**：

> **肉鸽并入协同（2026-10-30）**：肉鸽房（`roomVariant: 'rogue'`）的 `modeId` 是 `mode_rogue_*`，`config.modes` 里
> 没有这一条，所以以前是靠 `teamEconomy` 里的 `matchIsRogue` 闸门**显式关掉**团队经济。现在改为由
> `config.economy.rogueTeam` 单独给出一份规则块（数值与协同共竞同档）。差别只有一处：**肉鸽没有熔毁商店**
> （`meltdown.js:246` 只对 `mode_xie_*` 开放），所以那份配置的 `projects` 只列 `teamIncome` 一项——
> `shopLevel` / `equipCost` 在肉鸽里买了也用不上，干脆不卖。没有这条配置时肉鸽仍无团队经济。

- **团队储备 `teamReserve`**：全队共有的一个池子，来源与出口都写在下面；
- **个人储备已删除**——玩家自己的钱每回合末照常清零（`econSplitLeftover` 对非豁免阵营无条件 `ps.funds = 0`，
  `economy.js:848`），只有坎诺特阵营整额保留（`leftoverFundsKeptByBands: ["band_cannot"]`，`gamedata.js:64`）。
  配置里的 `leftoverFundsLost`（`data/config.json:7508`）现在**没有代码读取**，只是随原版数据留着；改它不会影响清零。
- **债务**只在「向队友借」时产生，且不再是「挂在下一回合收入上」——由借款人手动还清（见 §37.3）。

整层是可关的：关掉时模式表现与原来完全一致。

### 37.1 团队储备 — 钱从哪来

| 来源 | 规则 |
|---|---|
| **防守奖励** | 结算时防住就给协同资金：`perfectReward`（联防没漏）= 1、`fullDefenceReward`（全员都防住，取代上一档、不叠加）= 1，每回合封顶 `perfectRewardCapPerRound` = 1（`econDefenceReward`，`economy.js:885`；封顶叠加 `teamIncome` 升级，见 §37.2）。判据是结算算出的穿透，所以联防漏怪方不挡的人会挡掉奖励；**本轮刚被淘汰的玩家仍在判定集合里**，它的扣血会挡住奖励 |
| **玩家主动存入** | 休整期内每人每回合最多存 1 点进团队储备（意图 `g.econ.deposit`，`economy.js:198` · `intents.js:71`），直接从自己的钱里扣 |

> 旧的「休整期末按比例把结余转进储备」机制已删除——回合末没花完的钱直接清零（`econSplitLeftover`，
> `economy.js:848`），团队储备**只**由上面两路获得。这是「个人缓冲 vs 团队池」取舍的终版：个人这一层不再保留。

### 37.2 团队储备 — 钱到哪去

储备只有一个出口类型组合；**玩家级生死由 §38.5 的救援窗口处理**（从共享池按人头扣款，不是「储备直接复活」，
战斗内的干员复活——阿戈尔五层、M3茧甲、埃芒加德——不受影响）。

1. **商店升级项**（全队共享，等级永久保留，**直接花团队储备**；业主 2026-10-30「升级项搬到商店」）：
   - 三项，全部从 `teamReserve` 扣款（`econBuyProject`，`economy.js:628` · `intents.js:65`），钱够就生效，**任何人可点、
     不需要提案或投票**（旧的「升级提案 + 全票同意」已于 2026-10-17 取消，`econBuyProject` 注释见 `economy.js:639`）。
   - 效果由纯函数 `projectEffects.js`（`shopLevelOf` / `teamIncomeCapOf` / `equipPriceOf`）计算，落点在 `meltdown.js`：
     `shopLevel` → `meltShopLevel()`（`meltdown.js:298`）、`equipCost` → `meltItemPrice()`（`meltdown.js:47`，两处调用
     `meltdown.js:319` 与 `meltdown.js:660`）、`teamIncome` → 防守奖励封顶（`economy.js:893`）。
   - 原「应急仓储 `storehouse`」「后勤调度 `logistics`」两个项目**已删除**（它们加的是已不存在的个人/团队获取），
     `teamTransferCap` 对 `logistics` 仍做兼容读取（`economy.js:213`）。
2. **救济**（见 §37.4）。
3. 没有第三个出口：储备**不能**直接发钱给个人。

> **平衡口径**（调参依据）：三项全点满共 48 协同资金——`shopLevel` 4+5+6+8 = 23、`teamIncome` 3+5+7 = 15、
> `equipCost` 4+6 = 10。14 回合 4 人桌，团队池收入约 14（防守奖励，每回合最多 1）+ 每人每回合存 1（≈56），
> 通常只够点满「一棵半」升级树，别指望全开。

### 37.3 借钱（调拨协议）

只在**休整期**发生。四步：请求 → 对方同意 / 拒绝 → 钱立刻到账 → **借款人手动还清**。

| 规则 | 值 |
|---|---|
| 单次上限 | `maxPerRequest`（默认 1；协同共竞 1 资金） |
| 每人每回合次数 | `requestsPerRound`（默认 2；协同共竞 2） |
| 全队每回合总额 | `teamCapPerRound`（4） |
| 请求存活时间 | `ttlSec`（30 秒） |
| 利息 | `repayInterest`（协同共竞 0 = 只还本金） |

- **借钱优先从团队储备出，队友只是兜底**：一次借款先由 `teamReserve` 垫付（团队自己的钱，不产生债务），池子不够的部分
  才去问队友。垫付额同时受请求金额、储备余额、本回合团队资金流动剩余额度三者钳制，逻辑是纯函数
  `splitPoolFill({ amount, teamReserve, capLeft })`（`poolFill.js:15`，测试 `test/match/econ-pool-first.test.js`），
  在 `econRequest` 里调用（`economy.js:497`）。队友额度因此被收紧。
- **债务只来自「向队友借」的部分**：团队储备垫付的 `fromPool` 不记账；只有 `remaining`（队友出借）进 `econDebts`。
  **借款人手动用 `g.econ.repay` 结清**（`econRepay`，`economy.js:926` · `intents.js:76`），队友可 `g.econ.nudge` 催
  （`econNudge`，`economy.js:968` · `intents.js:77`）。旧的「下回合开局从收入自动扣还」已于 2026-10-17 取消
  （`econSettleDebts` 现只提醒，不再扣款，`economy.js:912`）。
- 任何一方同时只能有一笔请求在飞行中（做请求方或做目标都一样）；**一个请求发出后不能撤回**（用户 2026-10-08）。
- **`to` 现在可选**：意图 `g.econ.request` 的 `to` **缺席或 `null` = 广播**——问遍其余**全部存活队友**；给了队友 id = 指定队友（v1 的旧语义，借还牌上有队友选择器）。一条广播**每个人各自可以借 1 资金**；**一个人同意不会关闭其他人的应答**——要**全员都应答**、或 **30 秒 TTL 到期**才关单。广播会带一句**随机「借钱喊话」**（服务端从 8 句里挑一句挂着，供客户端的借还牌显示）。
- **拒绝只记名、不关单**：被拒的人只从**发起人自己的**候选名单里去掉（同一回合不能再问他）；一个都没借到，这次请求的额度会**退回**给发起人。**超时（没人应答）也退回额度，且不算「被拒」**——同一个人之后仍然可以再问。拒绝/超时的说明文案（客户端 detail）：`pending`（已有一条在途）、`budget`（次数用完）、`no target`（没人可问）、`already refused`（他本回合拒过你）、`target ready`（对方已就绪）、`team cap`（全队额度用完）、`amount`（金额超上限）。
- **双方都必须存活、在休整期、且未就绪**：已就绪的人发出的请求会被撤掉，已就绪的人**不能作为被请求方**（他答不了，
  白白烧掉请求方的次数）。AI 座位当场答复（带 0.6–2.2 秒的「犹豫」）。
- **钱在对方同意的那一刻当场转移**（团队储备垫付当场扣 `teamReserve`；队友出借当场进借款人钱包并记债）。
- **借款人在还清之前被淘汰，这笔债作废**，出借人只收到一条提示；钱不由任何第三方承担。
- **被拒后可以换人再借**：指定队友（v1 语义）时，一次拒绝只把对方从本次候选名单去掉（记住拒绝者，本回合内不能
  再问同一个人，但可转找另一个队友）；**广播时这笔请求的额度在「全员都应答或 TTL 到期」仍未借到任何资金时
  退回发起人**，超时退回额度但**不算被拒**，同一个人之后仍可再问。AI 借钱者也会自己换人（拒绝后 300–800 毫秒）。
- **所有计数按回合重置**：每回合开始，每人次数、全队总额、被谁拒绝过，全部归零（`econNewRound`，`economy.js:172`）。
- **请求关闭的方式**：对方答复、超时、休整期结束、有人离开、有人被淘汰。
- **AI 也会主动开口借**（`botEconMaybeRequest`，`bot.js:2071`）：平时 8%、没钱时 48%，遇到「差一点就能升调度中心 /
  差一点就能买下精锐」这种关键节点 68%；上限分别是 50% 和 80%。借的是它缺的那个数。拒绝后它自己换个队友再问。

### 37.4 救济 — 快死的人从储备里取钱

- **由血最少的玩家自己决定取不取**（用户 2026-10-09：「血最少的人自己选择取还是不取」），**每次取 1 资金**，
  **直接给发起的人自己**，**不用还**（意图 `g.econ.relief`，`economy.js:768` · `intents.js:73`；资格判定
  `econReliefEligible`，`economy.js:747`）。
- 门禁很严，全都在服务端判定，队伍健康时一个人都领不到：
  存活 + 在休整期 + 未就绪 + **生命值 ≤ `lpThreshold`（10 = 一回合最多扣血量，即「再挨一轮最坏情况就淘汰」）**
  + **是（并列）全队生命值最低的那个**。
- 上限：每人每回合 `perPlayerPerRound`、全队每回合 `teamPerRound`，且储备里得有钱。协同共竞实装
  `perPlayerPerRound: 1`、`teamPerRound: 2`（`data/config.json:4080`）。
- 客户端只负责显示：服务器说你能领，按钮才亮。

### 37.5 已下线 — 兜底利率（`coverInterest`）

联防里替漏怪玩家挡下敌人的「兜底利率 / 兜底率分红」机制已删除。它本是**无调用者的死码**：配置结构仍保留
（`economy.js` 仍读 `teamEcon.coverInterest` 的字段，直接删键会让还款路径报错），但 `enabled` 在 `gamedata.js`
里**恒为 false**（`gamedata.js:676`）——老配置写 `true` 也打不开。不再有「覆盖率分红」「落后溢价」任何说法。

### 37.6 已下线 — 阵亡分红（`deathDividend`）

队友被淘汰时「把它的待发收入掷骰分给存活者」的机制已删除，同样是**无调用者的死码**；配置结构保留但 `enabled`
在 `gamedata.js` 里**恒为 false**（`gamedata.js:672`）。淘汰时未还完的借款仍按 §37.3 作废。

### 37.7 已下线 — 应急仓储 / 后勤调度（个人储备相关项目）

原「应急仓储 `storehouse`（提高结余保留额）」「后勤调度 `logistics`（提高全队调拨额度、Lv3 额外 +1 次借钱）」两个
后勤项目已删除——它们加的是已不存在的个人/团队获取层。`teamProjects.storehouse` / `teamProjects.logistics`
读取处一律按 0 兼容（`teamKeepFor` 恒 0，`economy.js:223`；`teamTransferCap` 的 `logistics` 加成同理
`economy.js:213`）。现行项目只有 §37.2 的三项商店升级。

### 37.8 借款意愿 — AI 出借人不再无条件借

`botLend` 打开后，AI 不再用「我富余就借」这条死规则，而是先「想一会儿」（0.6–2.2 秒）再按概率答复：

```
概率 = basePct + weakPct × 落后程度 + solventPct × 还得起 + coverPct × 我自己的覆盖率   上限 maxPct
```

- **落后程度**：借款人的阵容比队伍中位数差多少（0..1；不到中位数的一半就是 1）；
- **还得起**：借款人阵容和生命值都在队伍中位数之上时为 1——债务本身按构造还得起，所以**只有死亡才会赖账**；
- **我自己的覆盖率**：自己替队伍挡了多少——**挡得多的那个，正是把钱借出去的那个**。
- 借款会吃掉 AI 自己买东西的钱时，整体再乘一个折扣（50%）。
- 协同共竞实装 `{ basePct: 75, 20, 10, 10, 上限 50}`：`basePct` 配置值已改 **75**，但解析时会被 `maxPct` **50** 钳到 **50**，所以**有效值仍是「普通开口最高 50%」**（普通开口 10% 不变，一个「兜底拉满 + 借款人烂摊子」的出借人最高 50%）。旧文档写 `{10,20,10,10}` 的「10」正是现在的 `basePct` 项。
- 默认关闭，所以其他所有模式仍是那条旧的死规则。

### 37.9 能力发现

`m.public.econ` **只在规则集打开时存在**。这是客户端的能力探针：**没有它，什么都不渲染、什么都不发**。
所以这一整套（借钱面板、储备条、救济按钮）在其他模式里是零存在感，不需要额外的开关。

### 37.10 实现索引（规则 ⇄ 代码）

规则写在哪一条由上面的小节决定；下面只是「这条规则在代码里叫什么」，便于检索。

| 规则 | 服务端入口 / 方法 |
|---|---|
| 能力探针 | `m.public.econ`（`economy.js:252`） · `m.private.econ`（`economy.js:309`） |
| 团队储备收入 | `econDefenceReward`（`economy.js:885`，数值 `gamedata.js:78`）· `econDeposit`（`economy.js:198`，意图 `g.econ.deposit` · `intents.js:71`） |
| 借钱 / 答复 | `econRequest`（`economy.js:486`）· `econRespond`（`economy.js:559`），意图 `g.econ.request` / `g.econ.respond`（`intents.js:63,64`）；池优先垫付 `splitPoolFill`（`poolFill.js:15`，`economy.js:497` 调用） |
| 债务 / 还款 | `econSettleDebts`（`economy.js:912`，现只提醒）· `econRepay`（`economy.js:926`，意图 `g.econ.repay` · `intents.js:76`）· `econNudge`（`economy.js:968`，意图 `g.econ.nudge` · `intents.js:77`） |
| 救济 | `econRelief`（`economy.js:768`）· `econReliefEligible`（`economy.js:747`），意图 `g.econ.relief`（`intents.js:73`） |
| 商店升级项 | `econBuyProject`（`economy.js:628`，意图 `g.econ.project` · `intents.js:65`）；效果 `projectEffects.js`（`shopLevelOf` / `teamIncomeCapOf` / `equipPriceOf`）→ 落点 `meltdown.js` `meltShopLevel()`（`meltdown.js:298`）/ `meltItemPrice()`（`meltdown.js:47`） |
| 已删机制（安全默认） | `coverInterest` / `deathDividend` `enabled` 恒 false（`gamedata.js:676` / `gamedata.js:672`）；`storehouse` / `logistics` 项目不再列出 |
| AI 出借意愿 / AI 开口 | `econBotLendChance`（`economy.js:460`）· `botEconMaybeRequest`（`bot.js:2071`）· `botEconRespond`（`bot.js:2030`） |
| 每回合重置 | `econNewRound`（`economy.js:172`） |

## 38. 协同共竞 — the co-op mode

一个站在**原封不动的标准经济**之上的独立模式：玩家之间可以在休整期借钱、把闲钱存入团队储备、快死时领救济、
在商店用协同资金买三项升级，**除此之外什么都不变**。模式 id `mode_xie_funny|normal|hard|abyss`，逐字段克隆对应的
`mode_multi_*`，另挂一个 `teamEconomy` 块（见 `data/config.json:4066`）。其他所有模式都没有这个块，表现与原来完全一致。

### 38.1 这一模式实装的数值

```
transfer  maxPerRequest 1 · requestsPerRound 2 · teamCapPerRound 4 · ttlSec 30 · repayInterest 0
reserve   perfectReward 1 · fullDefenceReward 1 · perfectRewardCapPerRound 1
relief    enabled · amount 1 · lpThreshold 10 · perPlayerPerRound 1 · teamPerRound 2
projects  shopLevel  costs [4,5,6,8] · teamIncome costs [3,5,7] · equipCost costs [4,6]
deathDividend   enabled 恒 false（死码，gamedata.js:672）
coverInterest   enabled 恒 false（死码，gamedata.js:676）
botLend / botAsk  见 §37.8 · basePct 75（被 maxPct 50 钳到 50）
revival  { enabled, costPer: 5, step: 5 }
```
（以上 `transfer` / `reserve` / `relief` / `projects` 取自 `data/config.json` 的 `mode_xie_*` 块，如
`data/config.json:4066`；`deathDividend` / `coverInterest` 的 `enabled` 在 `gamedata.js` 里被强制 false。）

**升级项只卖三项**（不再有应急仓储 / 后勤调度 / 联合采购）：`shopLevel` 升商店等级上限、`teamIncome` 升团队储备每回合
收入上限、`equipCost` 降装备价。这个模式**不再是「只加借钱」**——储备、防守奖励、主动存入、救济、商店升级全部生效。

### 38.2 借钱额度为什么是 4

全队每回合借钱总额 `teamCapPerRound` = **4**，而单次上限 `maxPerRequest` = **1**、利息 `repayInterest` = **0**
（只还本金，不滋生额外资金）。这两个收紧都是为了一句话：**队友只是兜底角色，钱优先从团队储备出**
（§37.3 的 `splitPoolFill`）。

4 的来源是「团队储备每回合能流动的上限」量级——它同时是 `teamTransferCap()` 的基数（`economy.js:213`），
一个人反复请求最多抽干这一档，不会越过团队储备去无限问队友。相比旧值 8，4 让单人无法独占全队额度，也更贴合
「垫付优先、队友补差」的新模型（旧文档里「第 1 回合收入下限 5 → 配置 12 被削」那套推理已不再适用，因为借款不再
挂在收入上、也不再自动从收入还）。

### 38.3 入口与大厅

标题画面「开始」右边多一个 **协同共竞** 按钮；大厅出现第三张模式卡。创建房间时第二个座位**立刻填一个 AI 队友**
（目前是双人桌）。模式自己的房间页带一个「02 加入同盟」面板——邀请码输入框 + 加入 + 最近房间，
复用大厅同一套取码 / 规范化 / `room.join` 逻辑，两个入口不会走偏。

### 38.4 界面

- **借钱**是 HUD 上的一个控件（商店栏按钮行、整备区那一排的右边）：资金图标 + 次数 + 「借钱」字样。
  点开是借还牌：多一个**「广播 · 向大家借 {金额}」**按钮（v1 的**逐个队友选择器仍在**，一个队友一行），
  以及一句**喊话**的显示位（服务端从 8 句随机挑的「借钱喊话」）。有请求在飞时，发起侧显示「已向 … 请求 …」
  （广播时显示「已向全体请求 …」），接收侧显示 **同意 / 拒绝**，**没有「撤回」**。
  **欠 N / 应收 N / 兜底 N%** 三个小标签显示债务与覆盖率。
- **协同经济条**直接显示**三项升级**及其当前等级 / 下一级价格（花团队储备）：任何人点一下、钱够就升级，
  不需要提案或投票（旧「升级提案 + 全票同意」已下线，`economy.js:639`）。
- **救济**在商店栏的「协同经济」条上，就在它要动用的储备旁边：**领取救济**按钮，只有服务器说你能领时才亮。
- **救援牌**不再是「花钱救 / 等待救援」两态，改成 **「同意 n/总数」** 的计数 + **「同意救援」** 按钮
  （已同意的人显示「已同意，等待其他人」，不在名单里的人显示「等待队友同意」）。
- **聊天**是 HUD 左下角的一个发言齿轮（房间页自带触发按钮），见 §39。

### 38.5 救援（促融共竞）

队友 LP 归零时**不在当场淘汰**：结算阶段开救援窗口，把它按 0 LP 扣住（`PlayerState.pendingDeath`，棋盘与商店原样保留），并告知全房间。
**其余全体存活队友各自表态同意**（意图仍是 `g.revive { playerId, round }`；bot 席位延迟 500–1200 毫秒**自动同意**）。
**全票到齐才结算**：**从共享池按人头扣款**，每人 = `costPer + step × 已复活次数`，即 **5 / 10 / 15 …**
（常量 `REVIVAL_COST_PER = 5`、`REVIVAL_COST_STEP = 5`，可由模式的 `revival` 块覆盖）。共享池不够，救援不成立。
被救者带 **1 点 LP** 回场。
**不再有「谁够格捐」这条规则**——旧版「只有本回合替队友挡过怪且自己防线打干净的人才能救」的限制已删除，任何存活队友都有权表决。
窗口一关，还挂着的就**真淘汰**，并把原因记在玩家身上（`REVIVAL_UNAVAILABLE_REASONS` 现在是
`left / already-used / disabled / match-ended / no-voter / pool / window-closed / window-expired`）。
公共视图 `m.public.revival` 的形状：`{ open, round, costPer, costNext, revives, pool, targets: [{ playerId, name, need, agreed }] }`
（`need` = 需要同意的 playerId 列表，`agreed` = 已同意的）。
这条规则属于**模式本身**（`mode.revival.enabled`、`GameData.revival`），不是房间选项：促融共竞开启，其它模式与单人都不会触发。
服务端 `plugins/mota/server/match/match/revival.js`，结算钩子在 `settle.js`（`revivalDefer` / `eliminatePlayer` / `afterSettle`），
窗口经 `m.public.revival` 广播，客户端 `plugins/mota/client/js/ui/revivePlate.js` 渲染。
**这一块目前没有专门测试**（`grep REVIVAL_COST_PER test/` 与 `grep revivalDefer test/` 均 0 命中；
`test/content/feedback5-*revive*` 那几篇测的是战斗内的干员复活机制，不是这里的救援窗口）。

### 38.6 测试

`test/match/econ-pool-first.test.js`（借钱优先从团队储备出、队友只兜底、纯函数 `splitPoolFill`）、
`test/match/econ-projects.test.js`（三项升级的效果纯函数 `projectEffects.js` 与购买扣款）、
`test/match/economy.test.js`（收入、商店买卖、刷新与就绪门禁，带 `checkInvariants`）。
注意 `test/match/coop-three-layer-funds.test.js` 测的是已下线的 `splitLeftoverShares`（§37 的「结余按比例分流」），
它仍随 `pureShares.js` 留着，但已不代表现行规则。

## 39. 房间与局内文字聊天（`room.chat`）

一条与团队经济同一批交付的独立功能（移植自 `Paper-Yuan/Stronghold-Protocol`，上游与本仓原本都没有）。

- **只在房间里能发**：不在房间里的发言直接被拒。
- **每秒一行**：同一个会话 1 秒内只能发一条。
- **内容**：控制字符一律剥掉，两端空白去掉后裁剪到 **80 字**；空的不发。
- **广播给整间房**：等待室和对局中都算，**玩家与观战者都收得到，发送者自己也收**。观战者的发言带观战标记、
  不占座位号。
- **没有历史、没有私聊**：房间就是唯一频道，**后进房的人只看得到他进来之后的发言**。
- 换房间、房间关闭时清空记录；日志只留最近 40 行。
- **不做**：浮在干员头上的聊天气泡（用户 2026-10-09 明确不要）。
