# 开服

开一台促融共竞的服务器，让局域网里的玩家用浏览器加入。有两种方式，选一种就行：

| 方式 | 适合 | 要准备的 |
|---|---|---|
| **完整包**（推荐） | 想直接玩 | Node.js 22.12 或更新的版本（22 或 24） |
| **源代码 + 素材包** | 要改代码，或想跟着仓库更新 | Node.js、pnpm 11、Git |

两种方式都只能用于非商业用途，见 [NOTICE.md](../NOTICE.md)。

## 1. 完整包

1. 在仓库的 [Releases](https://github.com/ArknightsDevs/Icebreaker-Games/releases) 页面下载 `Icebreaker-Games-v<版本>.zip`。完整包里有：
   - 平台和引擎的程序；
   - 运行需要的第三方库；
   - 全部素材：战斗界面、Spine 模型、特效、音效、关卡战斗曲，还有中文-普通话、日语和联动三种干员语音；
   - 对局运行的干员 kit；
   - 启动脚本。
2. 解压，把里面的 `Icebreaker-Games` 文件夹放到一个路径较短的地方。Windows 上不要放进 OneDrive 同步的文件夹。
3. 启动：
   - Windows：双击 `scripts\start-windows.bat`；
   - macOS / Linux：在这个文件夹里运行 `sh scripts/start.sh`。
4. 窗口里会列出地址：本机打开 `http://localhost:8700/`，局域网里的其他电脑打开 `http://<这台电脑的局域网 IP>:8700/`。
5. 停止：在窗口里按 Ctrl+C，或关掉窗口。

补充说明：

- 第一次启动时，脚本在 `node_modules/` 里为平台和引擎的各个包建立链接（zip 存不了链接）。移动文件夹之后，下次启动会重新建立。
- 启动脚本的参数会传给服务器。例如 `start-windows.bat --port 8800` 换一个端口，`--host 127.0.0.1` 只让本机打开。
- 其他电脑打不开时，检查这台电脑的防火墙是否放行了 Node.js 的入站连接，以及端口（默认 8700）。
- 素材和 kit 默认用完整包自带的：`assets/` 和 `kits/stronghold-<提交>/`。要换成别的目录，在启动前设置环境变量 `AUE_ASSETS_DIR`、`AUE_KITS_DIR`。

### 1.1 检查文件

完整包的根目录有一份 `MANIFEST.json`，列出每个文件的大小和 sha256。运行 `node scripts/verify.js` 检查所有文件是否完整、没有被改动。第一次启动时建立的链接不在清单里，不算改动。

## 2. 源代码 + 素材包

1. 取得源代码，安装依赖：

   ```sh
   git clone --recurse-submodules https://github.com/ArknightsDevs/Icebreaker-Games.git
   cd Icebreaker-Games
   pnpm install
   ```

2. 素材：在 [Releases](https://github.com/ArknightsDevs/Icebreaker-Games/releases) 下载与代码**同一版本**的 `Icebreaker-Games-v<版本>-assets.zip`，解压到任意位置，得到 `Icebreaker-Games-assets/assets/skeleton/…`。不同版本的素材和代码可能对不上。
3. 干员 kit：运行 `pnpm exec aue-check oracle`。它把引擎固定的 [Stronghold Protocol](https://github.com/sganggs/Stronghold-Protocol) 提交取到 `engine/.cache/oracle/`，服务器默认就从那里读。也可以自己取一份这个提交，用 `AUE_KITS_DIR` 指过去。没有 kit 时，干员按引擎自己的实现作战。
4. 启动：

   ```sh
   AUE_ASSETS_DIR=<解压的位置>/Icebreaker-Games-assets/assets node packages/server/src/main.js --host 0.0.0.0
   ```

   Windows 的 PowerShell 里先运行 `$env:AUE_ASSETS_DIR = "<解压的位置>\Icebreaker-Games-assets\assets"`，再运行后半句。

没有素材时，服务器照样能开，对局照常进行，只是战场不绘制、没有声音。

## 3. 打包（维护者）

完整包和素材包由 `tools/package.js` 生成：

```sh
node tools/package.js --version <版本> --assets <素材仓库> --kits <Stronghold Protocol 在固定提交的检出> [--out <仓库外的目录>] [--force] [--keep-stage]
```

- **内容**：
  - 打包的是当前提交（HEAD）和它固定的引擎提交，不是工作区；
  - 平台和引擎都只取服务器和页面运行需要的包，不含测试；
  - 第三方库按已安装的版本复制成普通文件夹；
  - 素材取自素材仓库的 `skeleton/`，kit 只取运行需要的文件。
- **检查**：打包前逐个文件检查，发现问题就停止，并列出出问题的文件：
  - 拒绝名单：版本库、缓存、工作文件、交接材料、本机设置、测试；
  - 链接；
  - 只差大小写的同名路径；
  - 个人信息：本机的用户目录和盘符路径、本机账号名、noreply 以外的电子邮件地址。
- **输出**：默认写到系统临时目录下的 `icebreaker-games-release/`，`--out` 必须在仓库外面。发布时把两个 zip 上传到 Release。

## 4. 公网部署（反向代理之后）

把服务器放在 nginx 这类反向代理后面，对外提供 https。平台可以挂在域名的根目录，也可以挂在一个子路径下，比如 `https://example.org/icebreaker/`。相关规则见 [站点规范](spec/site.md)。

1. 照第 1 节装好完整包。如果程序目录对运行服务的用户是只读的，先用有写权限的用户在包的目录里运行一次 `node scripts/launch.js --link-only`，建立 `node_modules` 的链接。
2. 服务器只监听本机，并信任代理转来的地址：

   ```sh
   node scripts/launch.js --host 127.0.0.1 --port 8700 --trust-proxy --max-rooms 60 --max-battles 12
   ```

   `--max-rooms`、`--max-battles` 是同时存在的房间数和对局数的上限，默认 500 和 100，机器小就调低。
3. 代理（nginx）：

   ```nginx
   map $http_upgrade $ig_upgrade { default upgrade; '' ""; }

   location = /icebreaker { return 301 /icebreaker/; }
   location /icebreaker/ {
       proxy_pass http://127.0.0.1:8700/;           # 结尾的 / 让 nginx 去掉前缀
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;       # 改写成代理看到的地址，不要原样转发
       proxy_set_header Upgrade $http_upgrade;        # 大厅和对局是 WebSocket
       proxy_set_header Connection $ig_upgrade;
       proxy_read_timeout 1h;
   }
   ```

   挂在根目录时把 `/icebreaker/` 换成 `/`。前面还有一层 CDN 时，`$remote_addr` 要先按 CDN 给的真实地址还原（nginx 的 `real_ip` 模块），否则所有玩家都算成 CDN 的地址。
4. 缓存：`assets/~<版本号>/` 下的素材回复允许保存一年，可以交给 CDN 长期缓存；页面、脚本、kit 每次都会校验，CDN 缓存它们的话，每次部署后清一次。
5. 限制：每个地址同时最多 24 条连接，一分钟内最多输错 10 次房间编号，超过的请求会被拒绝。
