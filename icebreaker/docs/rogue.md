# 集成战略（肉鸽）

促融共竞里的单人/双人 roguelike 模式。战斗仍然是本引擎的普通对局（一节点一局），局外的层/节点/藏品/资源由 `mode-rogue` 的规则与 `packages/server/src/rogue.js` 的 run 表维护。

## 数据从哪来

官方 `ArknightsGameData`（`Kengxxiao/ArknightsGameData`）的：

| 内容 | 来源 | 产物 |
|---|---|---|
| 635 张关卡 | `zh_CN/gamedata/levels/obt/roguelike/ro1..ro6/**` | `engine/packages/content/data/levels/rogue*.json`（用 `tools/extract-rogue.mjs` 抽，`@aue/data` 的 `extractLevel`） |
| 主题/区域/关卡池/藏品/分队/难度/事件 | `excel/roguelike_topic_table.json` | `packages/mode-rogue/data/rogue_1..6.json`（`tools/rogue-data.mjs`） |

抽完后 635 张关卡都通过了引擎的加载闸（`levelAt`）：未实现的敌人能力、99 个 IS 装置的场地行为、部分关卡符文按 `testing` 通道放行（不生效但不阻塞）。

## 玩法规则（`packages/mode-rogue/src/index.js`）

- **地图**：按官方结构生成，每层 4–8 列、每列 2–4 个候选；第一列必为作战，最后一列为首领（最后一层）。
- **节点**：作战 / 紧急作战 / 险路恶敌 / 诡意行商 / 安全的角落 / 不期而遇 / 得偿所愿 / 娱乐 / 未知。
- **资源**：生命、源石锭、携带上限来自主题的 `init`（按难度档）；分队是开局 buff（`initialBandRelic`）。
- **战斗**：每个战斗节点开一局普通对局；胜利后三选一藏品并进下一列，失败扣 1 点生命、留在本列，生命归零则探索结束。
- **藏品**：官方 576 种 buff 键里，映射到引擎能生效的一档——属性乘/加算、阻挡、部署上限、出生技力、伤害/治疗系数 → 对局的 seat runes；敌方血量/攻防/移速 → 这一局的关卡变体（`enemyMul`）；初始费用 → 关卡变体的 `options.initialCost`；生命/源石锭/携带上限 → 领取时结算。奖励池只放「至少一样能生效」的藏品。
- **超时保险**：单场战斗超过 `AUE_ROGUE_BATTLE_LIMIT_MS`（默认 240s）仍未结束就按「守住」结算——引擎遇到卡住的单位没有自己的超时。

## 页面与接口

- 页面 `/rogue`：主题/难度/分队 → 地图（官方节点卡面与底板）→ 选点 → 跳到 `/play?match=…&seat=…&back=rogue` → 打完回探索页。
- 大厅 socket（`/lobby`）新增消息：`rogueTopics`、`rogueCreate`、`rogueJoin`、`rogueLeave`、`roguePick`、`rogueReward`。
- `GET /rogue/level/<id>.json`：按需取关卡；藏品改变敌方倍率/初始费用时，服务端生成一次性的**关卡变体**（id 形如 `rogue1_1-1__s1a2b3c4d`），同一个地址也能取到。
- 双人：第二名玩家用探索编号加入，两人共享同一张图/藏品/生命；战斗开两个座位（每人一份阵容、同一份 runes）。

## 本机怎么跑

```bash
# 源码树（关卡默认在 engine/packages/content/data/levels）
AUE_ASSETS_DIR=<assets 目录> node packages/server/src/main.js --port 8700

# 完整包：把关卡放到 data/rogue-levels，scripts/launch.js 会自动指过去
mkdir -p data/rogue-levels && cp <抽出来的 rogue*.json> data/rogue-levels/
```

素材：官方 Releases 的 `Icebreaker-Games-v0.1.3-assets.zip`（约 504 MB）。节点卡面/图标/底板另取 `ui/rogue/`（`img_node_bkg*`、`img_*_active`、`map/*.webp`）；没有它们地图页会降级成纯色块。

## 引擎侧改动（patches/）

- `patches/0002-rogue-levels-and-runes.patch`：随机出怪组空 key、`testing` 关卡放行关卡符文、99 个 IS 装置的场地档案、seat runes 支持 `char_attribute_add`。
- `patches/0003-worker-rogue-levels.patch`：页面把 `/rogue/level/` 目录传给 worker；worker 遇到不在静态内容里的肉鸽关卡时按 id 取，再 `matchContent`（藏品会改敌方倍率/初始费用，同一关卡 id 在不同 run 里可能是不同的关卡变体）。

两处都建立在 `0001-engine-coop-four-seats-and-backdrop.patch` 之上，顺序 0001 → 0002 → 0003。

## 打包

```bash
node tools/extract-rogue.mjs --gamedata <ArknightsGameData 检出>
node tools/export-rogue-levels.mjs        # 把 635 张收进 data/rogue-levels
```

`tools/rogue-data.mjs` 生成 `packages/mode-rogue/data/rogue_1..6.json`（官方主题表在 `excel/roguelike_topic_table.json`）。
