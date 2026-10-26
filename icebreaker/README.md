# 促融共竞 · Icebreaker-Games

> [!IMPORTANT]
> 非官方同人项目，与鹰角网络、悠星无关，源自《明日方舟》，禁止商用。游戏素材与数据的版权归原权利人所有，不适用本项目的代码许可证，详见 [NOTICE.md](NOTICE.md)。
> 仓库源码不包含游戏素材；[Releases](../../releases/latest) 里的包为了方便开服附带了素材，下载即视为同意 NOTICE 的声明：仅限非商业用途，素材不得用于本项目以外的用途，也不要单独再分发。

![license](https://img.shields.io/badge/code%20license-AGPL--3.0--or--later-blue)
![node](https://img.shields.io/badge/node-22%20%7C%2024-339933)
[![CI](https://github.com/ArknightsDevs/Icebreaker-Games/actions/workflows/ci.yml/badge.svg)](https://github.com/ArknightsDevs/Icebreaker-Games/actions/workflows/ci.yml)

《明日方舟》限时玩法「促融共竞」（国际服名 *Icebreaker Games*）的同人复刻。两名玩家在局域网里组队参赛，在同一张地图上实时合作打完一场比赛。活动界面、战斗画面和比赛流程都按原版还原，战斗由 [明日方舟通用引擎](https://github.com/ArknightsDevs/Arknights-Universal-Engine) 计算。

## 开始游玩

1. 在 [Releases](../../releases/latest) 下载完整包 `Icebreaker-Games-v<版本>.zip`。
2. 装好 [Node.js](https://nodejs.org/) 22 或 24。
3. 解压后，Windows 双击 `scripts\start-windows.bat`；macOS / Linux 在解压出的文件夹里运行 `sh scripts/start.sh`。
4. 用浏览器打开窗口里列出的地址。另一名玩家在同一局域网的电脑上打开「局域网」那一行的地址。
5. 先在「干员 box」里录入自己的干员、编好常规队（也可以一键随机填满），然后一人创建房间，把房间编号或邀请文字发给另一人加入。

运行 `node scripts/verify.js` 可以检查下载的文件是否完整。换端口、只让本机打开、从源代码运行等其他开服方式，见 [开服说明](docs/deploy.md)。

## 能玩什么

- **完整的比赛流程**：创建与加入房间、确认项目、赛前编队与比赛风格、高顺位干员协调、组建上场阵容（选技能和模组）、开赛、结算。打完一局回到房间，可以接着下一局。
- **关卡**：常规项目的 IG-1 逃离火线、IG-10 匪帮集会、IG-14 创造与繁殖，特级的 IG-S-2 爬高上低。每场比赛两个阶段，两人分守地图两侧，互相支援。
- **堡垒守御（测试中）**：IG-DF-1、IG-DF-4 团体战竞技场和 IG-S-5 请买纪念品，防御与休整轮替，可以建造和升级设施。
- **训练场**：一个人打规则教学关卡，用关卡给的干员和协作者一起作战。
- **比赛风格**：基础、驻场、游走、攻坚、支援，各有自己的增益与代价，并带一张携带物卡。
- **干员**：全部 461 名干员都能上场，练度在干员 box 里录入，可以导出、导入。
- **名片**：自定义昵称和 4 位代号，选择助理干员（开赛展示和结算里出现的立绘）和头像；结算时可以给队友点赞。
- **表情与标记**：在房间里、干员分配时和比赛中，用原版的两套表情（基础、源石虫）和队友打招呼；比赛中可以把场地上的格子标记给队友看。
- **互选模式**：房主可以打开互选模式，开赛时双方交换上场阵容和比赛风格，用对方给的队伍作战。
- **快速匹配**：选好赛级、参赛身份和是否互选，由服务器自动配对协作者；赛后两人都愿意，可以「继续一起玩」。
- **画面与声音**：原版的活动主界面、赛前流程、干员选择页、开赛展示和结算界面，3D 战场和 Spine 小人；原版音效、各关卡的战斗曲和干员语音（日语、中文-普通话和联动配音）。帧率、清晰度、攻击特效和各项音量都可以在设置里调。
- **手机**：手机浏览器横屏也能玩，竖着拿时画面自动转成横屏。
- **数据 mod**：开服的人可以在 `mods` 文件夹里放数据 mod，改干员、关卡、敌人和召唤物的数值，或者加入新的干员；玩家打开页面时自动拿到同一份。写法见引擎的 [做数据 mod](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/main/docs/mods.md)。

## 还没有的

- 其余常规项目关卡，以及阵地足球模式；堡垒守御还在测试；
- 好友邀请等联机功能；mod 新加的关卡还没有大厅入口；
- 少数干员的天赋和一部分技能只有部分效果，不少干员的攻击还没有特效，普通攻击和命中的音效暂时空着。

每个版本的变化见 [CHANGELOG.md](CHANGELOG.md)。

## 常见问题

- **另一台电脑打不开地址**：确认两台电脑在同一个局域网里，并在开服电脑的防火墙里允许 Node.js 的入站连接（默认端口 8700）。Windows 第一次启动时会弹出防火墙询问，选择允许即可。
- **我的干员和设置存在哪里**：干员 box、名片和设置都存在各自电脑的浏览器里。换浏览器或清除网站数据之前，先在干员 box 里导出。
- **画面卡顿**：在设置里调低帧率上限或清晰度，或者关掉攻击特效。

## 从源代码运行

需要 Node.js 22.12 或更新的版本、pnpm（版本由 `package.json` 的 `packageManager` 固定；装了 corepack 会自动使用，没有时运行 `npx pnpm@11.28.0`）和 Git。

```sh
git clone --recurse-submodules https://github.com/ArknightsDevs/Icebreaker-Games.git
cd Icebreaker-Games
pnpm install
pnpm run ci
```

素材不在仓库里：在 [Releases](../../releases/latest) 下载与代码同一版本的素材包 `Icebreaker-Games-v<版本>-assets.zip`，解压后用 `AUE_ASSETS_DIR` 指给服务器：

```sh
AUE_ASSETS_DIR=<解压的位置>/Icebreaker-Games-assets/assets node packages/server/src/main.js --port 8700
# 浏览器打开 http://127.0.0.1:8700/ ；开两个标签页就是两名玩家
```

- **局域网联机**：加 `--host 0.0.0.0`（默认只允许本机打开）。
- **直接开一局**（不经过房间）：加 `--match packages/server/matches/ig-1.json`，再打开 `http://127.0.0.1:8700/?seat=0` 和 `?seat=1`。`matches/` 里有三张关卡的示例对局。
- **干员脚本**（可选）：运行 `pnpm exec aue-check oracle` 取得引擎固定版本的 Stronghold Protocol，服务器会自动使用；没有时，干员都按引擎通用的实现作战。
- **端到端测试**：`pnpm run e2e`（`E2E_CHROME` 指定本机 Chrome 的路径）。
- **升级引擎**：引擎是 `engine/` 下的 git 子模块。在 `engine/` 里切换到新的发布标签，提交子模块的变化，再跑 CI 和端到端测试；引擎本身的改动请提交到引擎仓库。

没有素材时服务器照样能开，对局照常进行，只是不绘制战场、没有声音。完整的说明见 [开服说明](docs/deploy.md)。

## 项目结构

| 位置 | 内容 |
|---|---|
| `engine/` | 明日方舟通用引擎（git 子模块） |
| `packages/server` | 服务器：网页与模块、大厅与房间、每场比赛的战斗实例与复算 |
| `packages/client` | 网页：房间页（组队流程、干员 box、存档）、对局画面、设置 |
| `packages/mode-regular` | 常规项目的规则：项目、各步骤的时限、临时招募干员、编队规则、比赛风格（取自活动数据） |

页面和房间的行为写在 [docs/spec/](docs/spec/) 里。

## 参与

欢迎报告问题、提出改进或提交代码，请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。指出和原版不一致的地方时，附上 PRTS 页面或实机录像会很有帮助。

## 致谢

- [明日方舟通用引擎](https://github.com/ArknightsDevs/Arknights-Universal-Engine)：战斗、画面、界面和联机。
- [Stronghold Protocol](https://github.com/sganggs/Stronghold-Protocol)：72 名六星干员的脚本（GPL-3.0-or-later）。
- [PRTS](https://prts.wiki/) 与 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)：机制与游戏数据。
- Release 包里素材的各个来源，列在 [NOTICE.md](NOTICE.md)。

## 许可

本项目自己编写的代码以 [AGPL-3.0-or-later](LICENSE) 发布，引擎以 GPL-3.0-or-later 发布。游戏素材与数据不在其中，见 [NOTICE.md](NOTICE.md)。
