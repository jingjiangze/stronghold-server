# 百度轻量应用服务器部署（baidu 分支）

本分支 = `ms` 分支（魔搭线上版本）**逐字节相同的内容** + 本目录的部署物。
运行时代码与魔搭完全一致，差异只在 `deploy/baidu/`。

## 目标机

| 项 | 值 |
|---|---|
| 云 | 百度智能云 · 轻量应用服务器（华北-北京） |
| 实例 | `instance-jq64f5hu` / 公网 `120.48.56.189` |
| OS | Rocky Linux 9.4 (Blue Onyx) / kernel 5.14 |
| 规格 | 2 vCPU Xeon Gold 6271C / 3.9 GB RAM / 197 GB 盘 |
| Node | `/usr/local/node-v22.11.0/bin/node` v22.11.0（镜像自带） |
| nginx | 1.20.1（appstream） |
| SELinux | Disabled |
| firewalld | inactive（端口放行由百度控制台防火墙管） |

## 对外入口

| 端口 | 用途 | 暴露面 |
|---|---|---|
| **80/tcp** | nginx 反代 → `127.0.0.1:3000` | 公网已放行，但**域名走 80 会被备案网关拦**（见下） |
| **8443/tcp** | 同上（同一 server 块） | **已配好，待控制台放行**；非标端口可绕备案扫描 |
| 3000/tcp | Node 直连 | **仅 loopback，不对外开放** |
| 7890/tcp | mihomo 代理 | 仅 loopback（`allow-lan: false`） |
| 22/tcp | SSH | 公网（百度自带 HEYEAGENT/HOSTEYE_DENY 链） |
| 443/tcp | — | 防火墙放行但未监听（实测被备案网关按 SNI 重置） |

当前可用入口：
- `http://120.48.56.189/`（裸 IP，已验证 200）
- `http://supercup.jiangjiangze.icu:8443/`（**待控制台放行 8443 后可用**）
- `http://supercup.jiangjiangze.icu/`（**不可用**：302 到 `domainwall.cloud.baidu.com/block.html`）

## ⚠️ 备案拦截（2026-10-28 实测）

`jiangjiangze.icu` **没有 ICP 备案**。百度云对该域名做了 **domainwall 拦截**，且是**异步生效**的（刚绑的几分钟内能通，随后开始拦）：

| 探测 | 结果 |
|---|---|
| `supercup.jiangjiangze.icu:80`（Host 命中） | **302 → `domainwall.cloud.baidu.com/block.html`** |
| `supercup.jiangjiangze.icu:443`（SNI 命中） | **TLS 连接被 RST** |
| 裸 IP `120.48.56.189:80` | **200**（不受影响） |
| 换成别的 SNI 打 443（`notfiled.example.com`） | **200**（说明是「域名↔本 IP」定向拉黑，不是全网扫描） |
| CF 橙云代理（回源仍是 80 + 域名 Host） | **520 / 302**（同样被拦） |

结论：**未备案域名在这台机器的 80/443 上有解，只能走非标端口**（这也是 `order/gongxue` 在阿里云 ECS 上用 `:8443` 的同一原因）。
备选：CF 隧道（`cloudflared` 主动出站，已在同 zone 的 `*.jiangjiangze.icu` 上验证可用），代价是流量绕 CF 边缘。

## 目录约定

| 路径 | 用途 |
|---|---|
| `/opt/stronghold` | 应用根（git 检出，branch=`baidu`） |
| `/opt/mihomo` | mihomo 代理，`127.0.0.1:7890` |
| `/etc/systemd/system/stronghold.service` | 服务单元 |
| `/etc/systemd/system/mihomo.service` | 代理单元 |
| `/etc/nginx/conf.d/stronghold.conf` | 反代站点 |
| `/etc/nginx/nginx.conf` | 整份替换版（默认版有个 `listen 80 default_server` 会抢站点） |

## 部署步骤

```bash
# 1. 前置
dnf install -y git

# 2. 取代码（GitHub 直连约 17KB/s，必须走本机 mihomo）
git -c http.proxy=http://127.0.0.1:7890 \
    clone --branch baidu --depth 1 \
    https://github.com/jingjiangze/stronghold-server.git /opt/stronghold

# 3. 安装 + 启动 + 反代（幂等，可重复执行）
bash /opt/stronghold/deploy/baidu/install.sh --with-nginx
```

## 运行契约（与魔搭一致，改一处要两边同步）

| 环境变量 | 值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `127.0.0.1` | **只绑 loopback**，对外统一走 nginx |
| `SP_PLUGIN_SCRIPTS` | `trusted-force` | **必设**。不设则 `cdn-local`（`class:"trusted"`）加载不了，素材直接 404 |
| `TRUST_PROXY` | 不设（默认 `auto`） | 反代同机时 `auto` 已能从 `X-Real-IP` 取真客户端 IP。**不要设 `0/false`**，否则每网络限流塌缩成 127.0.0.1 |

就绪判据：
- `curl -s http://127.0.0.1/healthz` 返回 200 且含 `"ok":true`
- `journalctl -u stronghold | grep "client overlay"` 文件数 > 100（实测 267）

## nginx 反代的四条硬约束（改动前务必读）

1. **`gzip off`**：应用自己按 `Accept-Encoding` 协商 br/gzip（`server/http/files.js:294,315`），nginx 再压会双压。
2. **`/mod` 已关闭（`return 403`）**：该路径允许 210MB zip 上传，而服务跑在 `SP_PLUGIN_SCRIPTS=trusted-force`，trusted 插件在服务端执行 ⇒ 上传插件等于远程命令执行。**不要为了"能用 mod 管理器"就整体放开**；如确需，只放读：`client_max_body_size 210m; proxy_pass …; limit_except GET HEAD { deny all; }`（`pluginBytes = 200MB`，`shared/plugins/manifest.js:76`）。
3. **`/ws` 必须 `Upgrade`/`Connection` 透传 + `proxy_read_timeout 3600s`**：WS 是长连接且有心跳；应用层已开 permessage-deflate（`websocket.js:134`），**不要剥离 `Sec-WebSocket-Extensions`**。
4. **`proxy_redirect off`**：`cdn-local` 会把本机缺失的 `/assets|/fonts|/media` 302 到 CDN（`static.js:216-221`），302 必须原样下发。

另：`/studio` 在应用侧有 Host 白名单（仅本机/内网），反代里直接 `return 404` 不对外。

## 资源与容量（2026-10-28 实测）

| 项 | 实测值 |
|---|---|
| 负载 | load 0.00 / 0.02 / 0.00（2 vCPU） |
| 内存 | 3905MB 总，常驻占用 839MB，可用 3065MB |
| Swap | **2GB `/swapfile`**（swappiness=10，OOM 保险） |
| 磁盘 | 5.3G / 197G |
| `stronghold` 进程 | RSS **234MB**，11 线程，`--max-old-space-size=1536` |
| `nginx` | 3.2MB | `mihomo` 54MB | `cloudflared` 48MB | 百度 `heyeAgent` 82MB |
| 服务端响应 | `/healthz` 10ms、首页 1.2ms、`lobby.js` 0.57ms、`lobby.css` 0.75ms |
| 启动 warm-up | ~9.1s（重启空窗；`sync.sh` 已用「有人在线不重启」规避） |

**首屏慢（DCL 7–8s / load 16s / 3.9MB / 280 请求）不是服务器造成的**，是客户端与 CDN 链路；服务端每个请求都在亚毫秒级。

### 为后续 QQ 机器人预留
- 剩余可用内存 ~3.0GB、CPU 基本空闲 ⇒ 常见 QQ 协议端（NapCat/Lagrange 类，~150–300MB）绰绰有余
- 机器人建议：只监听 `127.0.0.1`，由本机进程 connect；**不要**为它单独开公网端口
- 若与游戏服互相调用，走 `http://127.0.0.1:3000` 即可，不经 nginx

## 分支与同步（2026-10-29 翻转：**百度为主**）

```
本机工作区（唯一编辑环境）
   └─push─> GitHub baidu（主干）──(branch-sync: sync-ms)──> GitHub ms
                                                            └──(push-to-modelscope)──> 魔搭 Studio 仓库
                                                                                        └─ 需在控制台点一次「部署」
GitHub baidu ──(服务器 stronghold-sync.timer :07/:37)──> /opt/stronghold（只读消费端）
```

| 分支 | 内容 | 谁写 |
|---|---|---|
| `baidu` | 运行时内容 + `deploy/baidu/**`，**主干** | 本机推送（Git Data API，本机 git 协议不通） |
| `ms` | `baidu` 的 tree **去掉 `deploy/baidu/**`** | 只由 `branch-sync` 的 `sync-ms` 写 |

**workflow**

| 文件 | 触发 | 作用 |
|---|---|---|
| `branch-sync.yml` | push baidu/ms、手动 | `guard`（插件跟踪 + ms 只能是 baidu 去掉 deploy/baidu）+ `sync-ms`（重建 ms 并 dispatch 下游） |
| `push-to-modelscope.yml` | ms push（由 sync-ms dispatch）、手动 | 用 `MODELSCOPE_TOKEN` 把 ms 推到魔搭 Studio；**推完仍需控制台点「部署」** |
| `sync-from-ms.yml` | **仅手动**（schedule 已停用） | 抢救用：把魔搭现网内容拉回 baidu 主干 |

**服务器侧**：`stronghold-sync.timer` 每 30 分钟（:07/:37）跑 `sync.sh`，纯拉取应用；
**服务器上直接改代码会被自动 stash 并告警**（编辑请在 本机 → GitHub 做完）。


## CDN

客户端素材 CDN 配置**沿用不改**：`plugins/cdn-local/config/sources.json`
（当前 order = `modelscope → ghfast-assets → jsdelivr-assets`；`speedcdn.jiangjiangze.icu` 仍可解析并回 302，由 CF Redirect Rule 直达数据集）。

## 常用运维

```bash
systemctl status stronghold --no-pager
journalctl -u stronghold -f
systemctl restart stronghold
systemctl status nginx --no-pager && nginx -t
systemctl status mihomo --no-pager
curl -s http://127.0.0.1/healthz
```

## 回滚

```bash
systemctl disable --now stronghold
# nginx：还原 /etc/nginx/nginx.conf.bak-<时间戳>
# 代码回退到任一 commit 后重跑 install.sh
```

## 已知坑

- **`SP_PLUGIN_SCRIPTS` 漏设** → 插件覆盖层整层不生效，表现为 UI/素材异常，但 `/healthz` 仍 200。
- **`HOST` 改回 `0.0.0.0`** → 绕过 nginx 直连 3000，但该端口在百度防火墙上没放行，表现为"时好时坏"。
- `node_modules` 不入库，换机必须 `npm ci`。
- `plugins/` 在 `.gitignore` 里但有 847 个文件已被跟踪；**新增插件文件必须 `git add -f`**，否则线上缺文件（历史上因此把 mota 插件弄挂过）。
- `data/local-assets.json` 是生成物但必须存在，缺了会导致 3D 场景只建部分行。
- GitHub 直连约 17 KB/s，必须走 `127.0.0.1:7890`。
