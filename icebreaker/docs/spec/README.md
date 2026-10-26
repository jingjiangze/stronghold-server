# 玩法规范

促融共竞各模式的规则写在这里，比如常规项目的关卡目标、一局两关的流程、嘉奖印章、比赛风格。条款格式和检查方式与引擎相同，见 [引擎的规范说明](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/main/docs/spec/README.md)。

- 每条都有编号（`<领域>-<序号>`）和 `- 来源：` 一行。
- 测试名里写上它验证的条款编号。
- `pnpm run check`（`aue-check`）检查编号、来源、测试引用和登记表。

引擎负责的通用机制（伤害、索敌、多玩家能力等）写在引擎仓库的 `docs/spec/`，这里只写模式自己的规则，以及页面自己的行为（如画面设置）。

## 目录

- [page.md](page.md)：页面：画面设置、本地存档与 box 录入、局域网打开的页面、声音、主机的 mod
- [room.md](room.md)：房间：房间号、项目、赛前编队、干员分配、开赛
- [site.md](site.md)：站点：挂在任意路径下、公网上的限制、素材的缓存、数据 mod
