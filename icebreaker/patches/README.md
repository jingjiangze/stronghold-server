# engine 改动的去向

`engine/` 是 git submodule，指向上游 `ArknightsDevs/Arknights-Universal-Engine`（固定提交 `c8af98d`）。
我们对它的改动**无法提交到那个仓**（没有上游写权限），所以：

| 位置 | 状态 |
|---|---|
| `patches/0001-engine-coop-four-seats-and-backdrop.patch` | 本 fork 里的完整 patch（`git -C engine diff` 的原文） |
| 部署树 `studio/icebreaker/engine/...` | **已应用**，那是 vendor 进去的普通文件，随镜像走 |

## patch 里的三处改动

1. `packages/render/src/renderer.js` — 战场背景：纯灰 `0x404040` → 垂直渐变 + 远处雾化（`skyBackdrop` / `applySky` / `SKY_FOG_*`），
   并新增 `backdrop` 选项：给了官方场景图就用它（`SKY_BACKDROP_INTENSITY = 0.16` 压暗），没给仍退回渐变
2. `packages/sim/src/coop.js` — `goalSeats` 支持四座位（一侧由同奇偶两座共守）、新增 `partnerOf`、
   `askProblem` / `answerCost` 用伙伴座位而非 `1 - seat`
3. `packages/net/src/host.js` — `frameCommands` 去掉 `seats !== 2` 早退与写死的 `[0, 1]`
4. `packages/ui/src/battle/coop.js` — 顶栏从「我 + 队友」泛化到 N 席：`SEAT_TAGS` / `seatRef`，
   `CoopState.sides` 逐席 `showSide`；两人局的节点与行为不变

## 怎么用

```bash
# 重新 vendor fork 到部署树、或换一份 engine 检出之后，重新打上：
git -C engine apply ../patches/0001-engine-coop-four-seats-and-backdrop.patch

# 确认已应用：
grep -c skyBackdrop engine/packages/render/src/renderer.js   # 期望 4
grep -c partnerOf  engine/packages/sim/src/coop.js           # 期望 3
```

## 为什么不做成正式 submodule fork

按 `docs/adr/0007`（引擎按 git tag 消费）与 ADR 0052（engine 是 submodule），
要让改动进 fork 的 submodule 就得 fork 引擎仓、改 `.gitmodules`、再推 19 MiB。
本轮只动了 3 个文件 162 行，先用 patch 保证不丢；真要长期维护（比如 P3 的基建会继续动引擎）
再 fork 更划算。

## 0002 · 集成战略（肉鸽）关卡

`patches/0002-rogue-levels-and-runes.patch` —— **建立在 0001 之上**（先打 0001 再打 0002）：

1. `packages/data/src/waves.js` — 随机出怪组的空 key 行：官方 IS 关卡用「空 key + randomSpawnGroupKey + weight」表示「抽到它时什么都不发生」，
   原实现按非空字符串校验会整张图抽取失败；现在降为 NONE 并保留 group/pack/weight（`sim/src/waves.js` 的 beginWave 本来就按权重抽一行）。
2. `packages/content/src/levels.js` — `testing:true` 的关卡同时放行「未支持的关卡符文」（此前只放行敌人能力）。
3. `packages/content/src/devices.js` — 99 个集成战略装置的空 profile（不动的场地物，可玩但无行为）。
4. `packages/content/src/runes.js` — seat runes 新增 `char_attribute_add`（藏品用加算写属性；剧情关的风格 runes 仍是乘算）。

```bash
git -C engine apply ../patches/0001-engine-coop-four-seats-and-backdrop.patch
git -C engine apply ../patches/0002-rogue-levels-and-runes.patch
```

## 0003 · worker 按需取肉鸽关卡

`patches/0003-worker-rogue-levels.patch` —— 建立在 0001/0002 之上：

- `packages/worker/src/main.js` — 页面 `startBattle` 的 `levels`（以 `/` 结尾的目录）透传给 worker。
- `packages/worker/src/worker.js` — `match.level` 以 `rogue<数字>` 开头、且不在静态内容里时，从该目录取 `<id>.json` 合进内容源再 `matchContent`。
  藏品会改变敌方倍率/初始费用，所以同一个关卡 id 在不同 run 里可能是不同的「关卡变体」，必须按 id 现取，不能写进静态 import。
