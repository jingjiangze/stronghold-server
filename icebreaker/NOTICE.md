# 版权与使用声明（NOTICE）

**促融共竞 · Icebreaker-Games** 是源自《明日方舟》限时玩法「促融共竞」的**非官方同人项目**，与上海鹰角网络科技有限公司（Hypergryph）、悠星（Yostar）及其关联方**没有任何关联**，也未获得其授权或认可。

## 1. 代码许可证：AGPL-3.0-or-later

Copyright (C) 2026 Icebreaker-Games contributors

本项目自己编写的源代码与文档文字以 **GNU Affero 通用公共许可证第 3 版或（由你选择）任何更新版本**（AGPL-3.0-or-later）发布，全文见 [LICENSE](LICENSE)。

- **第 13 条（远程网络交互）**：如果你修改了本项目，并让用户通过网络与修改后的版本交互（例如架设联机服务器），就必须向这些用户提供修改后版本的对应源代码。
- **引擎**：`engine/` 是明日方舟通用引擎（[Arknights-Universal-Engine](https://github.com/ArknightsDevs/Arknights-Universal-Engine)）的 git 子模块，以 GPL-3.0-or-later 发布，见它自己的 LICENSE 和 NOTICE。
- **第三方库**：通过 pnpm 安装的第三方库（Release 完整包的 `node_modules/` 里是 three.js、ws、es-module-lexer）各自保留原许可证。
- **干员 kit**：对局中运行的干员 kit 来自 [Stronghold Protocol](https://github.com/sganggs/Stronghold-Protocol)（GPL-3.0-or-later，版权归其作者）的一个固定提交（见引擎的 `packages/content/data/kits.json`）。它们不在本仓库中：开服时由主机另行取得，原样使用，服务器只改写其中的导入路径（引擎 ADR 0058）。Release 的完整包附带了这个提交里对局运行需要的文件（`kits/stronghold-<提交>/`，连同它的 LICENSE 和 NOTICE），仍按 GPL-3.0-or-later 授权；完整源代码见该文件夹里的 `SOURCE.md`。

## 2. 不属于本项目、不受 AGPL 约束的内容

《明日方舟》及「促融共竞」相关的全部**名称、角色、美术、Spine 模型、界面、特效、音乐音效、文本与游戏数据**，版权归上海鹰角网络科技有限公司及其授权方所有。

- 这些素材**不在本仓库中**。为了方便开服，[Releases](https://github.com/ArknightsDevs/Icebreaker-Games/releases) 里的完整包（`Icebreaker-Games-v<版本>.zip`）和素材包（`Icebreaker-Games-v<版本>-assets.zip`）附带了它们（`assets/**`），同样按本声明使用。**下载即视为同意本声明**；请勿把素材用于本项目以外的用途，也不要单独再分发。
- 素材的来源：
  - 干员与召唤物的战斗 Spine：[HX0922/ArknightsSpine](https://github.com/HX0922/ArknightsSpine)（固定提交 dc788e3）；
  - 敌人的 Spine：[isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models)（固定提交 8a3857c）；
  - 头像、敌人图标：[yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)（固定提交 9bf2396）；
  - 干员战斗语音、关卡的战斗曲：[ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2)（固定提交 33a5327）；
  - 音效库和语音的设定：由 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)（提交 17759cc）的游戏数据生成；
  - 拉丁字体 Montserrat（The Montserrat Project Authors）与 Chakra Petch（The Chakra Petch Project Authors）不是游戏素材，用来代替界面原用的两款显示字体，取自 [google/fonts](https://github.com/google/fonts)（固定提交 1d0e46c，`ofl/montserrat`、`ofl/chakrapetch`），只保留拉丁字符，按 [SIL Open Font License 1.1](https://openfontlicense.org) 分发，许可全文见 `assets/skeleton/fonts/OFL-Montserrat.txt`、`OFL-ChakraPetch.txt`；
  - 中文字体 Noto Sans SC（Google、Adobe）不是游戏素材，取自 [google/fonts](https://github.com/google/fonts)（固定提交 a85815a，`ofl/notosanssc`，来自 notofonts/noto-cjk 的 Sans2.004），只保留页面用到的字，按 [SIL Open Font License 1.1](https://openfontlicense.org) 分发，许可全文见 `assets/skeleton/fonts/OFL-NotoSansSC.txt`；
  - 其余（战斗界面、特效、音效、地块套件、阴影等）由维护者另行准备。
- 它们**不在 AGPL-3.0 授权范围内**，本项目也无权就它们向任何人授予任何权利。

## 3. 仅限非商业用途

- 本项目仅供**学习、研究和个人非商业娱乐**。
- 一切包含或依赖游戏素材与数据的使用方式，都**不得用于任何形式的盈利**，包括但不限于：
  - 出售或付费分发；
  - 收费开服或付费房间；
  - 广告、打赏、赞助；
  - 打包进收费产品或服务。

## 4. 联系

权利人如认为本项目侵犯其权益，请通过 Issue（选择「权利与法律」）或安全公告私下联系，我们会**立即删除**相关内容。

本项目按「现状」提供，**不提供任何担保**，使用风险自负。
