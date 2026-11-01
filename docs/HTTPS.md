# HTTPS 改造手册（2026-11-01 审计）

> 本文是**可执行方案**，不是已执行记录。执行前先看「一、现状实测」与「四、回滚」。

## 一、现状实测（2026-11-01，百度轻量服务器）

| 项 | 实测 | 含义 |
|---|---|---|
| 外网 `443` | `Connection refused`（不是超时） | 云防火墙**已放行**，只是 nginx 没监听 |
| `80` | 可连 | 现网入口 |
| `ss -ltnp` | 只有 `0.0.0.0:80` / `[::]:80` | 没有任何 TLS 监听 |
| 公网 IP | `120.48.56.189`（盒子自己 `curl ifconfig.me` 同值） | **静态 IP ⇒ 不需要 DDNS** |
| 证书工具 | `certbot` / `acme.sh` 均未安装 | 需装一个（本文用 acme.sh） |
| `sp.jiangjiangze.icu` | 解析到 `104.21.87.130 / 172.67.143.94` | 该名字走 Cloudflare 反代，**不是**直连盒子 |
| 客户端 | `public/js/net.js:99-105` 按 `location.protocol` 选 `ws/wss` | 上 HTTPS 后 WSS **自动生效**，客户端零改动 |
| 蓝绿探活 | `health_ok` 走 `http://127.0.0.1:<port>/healthz` | 内网探活，**不受** HTTPS 影响 |

## 一·五、本次选定（业主 2026-11-01）

域名：**superbigcup.jiangjiangze.icu**。

实测（本机、绕开 Clash 时）：
- `http://superbigcup.jiangjiangze.icu/` → **200**（CF 橙云转发到源站 80）。
- 该名字当前解析到 Cloudflare（104.21.87.130 / 172.67.143.94），即**已经在 CF 后面**。
- 因此若接受 CF 代理，HTTPS 由 CF 边缘终结，盒子上**不需要证书**；代价是 WS 空闲约 100s 断、国内延迟不可控（见方案 B）。
- 若要「直连 + 自签证书」（方案 A），需把该记录改成**灰云 A → 120.48.56.189** 再走 acme.sh。

## 二、方案对比

| | A. 子域名直连 + Let's Encrypt | B. 保持 Cloudflare 橙云 | C. 纯 IP 证书 |
|---|---|---|---|
| 证书位置 | 盒子（acme.sh 自动续） | CF 边缘，盒子无需证书 | 盒子 |
| 延迟 | 最低（直连） | 多一跳，国内不稳 | 最低 |
| WS | 原生支持 | CF Free 版空闲约 100s 断，需心跳更频 | 原生 |
| 有效期 | 90 天自动续 | CF 代管 | **仅 6 天**（LE 的 IP SAN 短期证书） |
| 依赖 | 一个能改 DNS 的子域名 | CF 账号 | 工具链不成熟 |
| 结论 | **推荐** | 备选 | 不推荐 |

## 三、方案 A 执行步骤

### 1. DNS（在 Cloudflare 面板）
- 新建 `A` 记录：名称 `game`（即 `game.jiangjiangze.icu`）→ `120.48.56.189`，**代理状态必须关（灰云 / DNS only）**。
  - 橙云会让流量回到 CF，第 3 步的 HTTP-01 校验会失败。
- 生效判据：`nslookup game.jiangjiangze.icu` 返回 `120.48.56.189`。

### 2. 盒子装 acme.sh
```bash
ssh root@120.48.56.189
curl https://get.acme.sh | sh -s email=<你的邮箱>
source ~/.bashrc            # 之后用 ~/.acme.sh/acme.sh
```

### 3. 签发证书（webroot 模式，复用已在跑的 nginx 的 80）
```bash
mkdir -p /var/www/acme/.well-known/acme-challenge
~/.acme.sh/acme.sh --issue -d game.jiangjiangze.icu -w /var/www/acme --keylength ec-256
```
nginx 需要先把 `/.well-known/acme-challenge/` 指到 `/var/www/acme`（临时 server 块或加到 80 的站点里），否则 HTTP-01 会 404。

### 4. 安装证书 + 配置 443
```bash
~/.acme.sh/acme.sh --install-cert -d game.jiangjiangze.icu --ecc \
  --key-file       /etc/nginx/ssl/game.key \
  --fullchain-file /etc/nginx/ssl/game.crt \
  --reloadcmd      "systemctl reload nginx"
```

`deploy/baidu/nginx/stronghold.conf` 里新增（与现有 80 站点并存，**不要动 upstream / `/ws` / `gzip off`**）：

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name game.jiangjiangze.icu;

    ssl_certificate     /etc/nginx/ssl/game.crt;
    ssl_certificate_key /etc/nginx/ssl/game.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    add_header Strict-Transport-Security "max-age=31536000" always;

    # 与 80 站点同构：/ws 保留 Upgrade，/ 反代到 stronghold_app，/studio 404，/mod 403
    location /ws { proxy_pass http://stronghold_app; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade;
                   proxy_set_header Connection "upgrade"; proxy_read_timeout 3600s; proxy_send_timeout 3600s; }
    location /studio { return 404; }
    location /mod { return 403; }
    location / { proxy_pass http://stronghold_app; proxy_redirect off; proxy_set_header X-Real-IP $remote_addr; }
}
```
80 站点再加一条跳转（**保留 `/.well-known/` 给续期**）：
```nginx
location /.well-known/acme-challenge/ { root /var/www/acme; }
location / { return 301 https://$host$request_uri; }
```

### 5. 验证
```bash
curl -sI https://game.jiangjiangze.icu/ | head -3           # 200 + HSTS
curl -s  https://game.jiangjiangze.icu/healthz | head -c 120 # ok:true
openssl s_client -connect game.jiangjiangze.icu:443 -servername game.jiangjiangze.icu </dev/null 2>/dev/null | grep "Verify return code"   # 0 (ok)
```
浏览器里开一局，DevTools → Network → WS 应显示 `wss://game.jiangjiangze.icu/ws` 且 101。

### 6. 续期
acme.sh 安装时已写 cron（`~/.acme.sh/acme.sh --cron`），90 天前自动续；`--reloadcmd` 负责 reload nginx。
判据：`~/.acme.sh/acme.sh --list` 里的 `Renew` 日期，以及 `openssl x509 -enddate -noout -in /etc/nginx/ssl/game.crt`。

## 四、回滚

任何一步失败都只影响新入口，旧入口（`http://120.48.56.189/`）不动：
```bash
# 撤 443 站点
mv /etc/nginx/conf.d/stronghold-ssl.conf /root/stronghold-ssl.conf.bak
nginx -t && systemctl reload nginx
# 80 的 301 改回直反代（若已改）
```
DNS 侧把灰云记录删掉即可。

## 五、DDNS 结论

**不需要**。百度轻量给的是静态公网 IP（实测 `ifconfig.me` = 服务器自身 IP）。DDNS 只适用于家庭宽带动态 IP 的场景；将来若迁到家里，再考虑 `ddclient` / `cloudflare-ddns`。

## 六、与蓝绿的交互

- `deploy/baidu/sync.sh` 的 `health_ok` 探 `127.0.0.1:<port>/healthz`，**不受** HTTPS 影响，蓝绿照常。
- 切流文件 `/etc/nginx/stronghold-upstream.conf` 被 443 站点同样 include（`upstream stronghold_app` 已定义），所以 HTTPS 与蓝绿天然兼容。
- 部署脚本安装 nginx 站点用的是 `deploy/baidu/nginx/stronghold.conf` 整份覆盖；**443 站点要写进这份文件**（或另建 `stronghold-ssl.conf` 并确保 `sync.sh` 不覆盖它）。

## 七、最终落地（2026-11-01）：Cloudflare Tunnel（不需要备案）

### 硬约束（实测，不可绕）
- 未备案域名在**百度备案墙**后面：任何 `*.jiangjiangze.icu` 指到本机时，
  HTTP 一律 302 → `http://domainwall.cloud.baidu.com/block.html`（LE 的 HTTP-01 校验也因此失败）；
  HTTPS 握手直接被 RST（`errno=10054`）。**与 nginx/证书无关**。
- Cloudflare 代理（橙云）也不行：CF→源站仍带该域名 Host/SNI，拿到的是同一张拦截页。

### 采用的链路
```
浏览器 ──https──▶ game.jiangjiangze.icu（CF 边缘，Universal SSL）
        ◀─tunnel── baidu 隧道 49c5c300-274c-4dd7-af66-4be0570769e9（盒子上 cloudflared.service，出站）
                   └─▶ http://127.0.0.1:80（httpHostHeader: supercup.jiangjiangze.icu）→ nginx → 应用
```
- DNS：`game` = **CNAME → `49c5c300-….cfargotunnel.com`（proxied）**。
- ingress 在 CF 端管理：`PUT /accounts/{acc}/cfd_tunnel/{id}/configurations`（remote-managed，盒子无需改配置）。

### 外网验收（2026-11-01）
| 项 | 结果 |
|---|---|
| `https://game.jiangjiangze.icu/` | **200**（游戏首页） |
| `…/healthz` | **200** `{ok:true, app:0.3.3, plugins:13}` |
| `…/js/main.js` | **200**，30126 B |
| `wss://game.jiangjiangze.icu/ws` | **hello → welcome**（返回 playerId） |

### 没走成的两条（留档，别再试）
- **CF Pages 内嵌**：`POST /pages/projects` + 直传部署 API 都返回成功，但 `*.pages.dev` 与自定义域一概 **500**（部署 `deploy:success` 却无内容可服务）。
- **Worker 反代到 IP**：CF 在回源处直接拒绝 —— **error 1003（不允许直连 IP）**。

### 附带：IP 证书（直连备用）
- `120.48.56.189` 已签 **Let's Encrypt IP 证书**（`--cert-profile shortlived`，SAN=IP，7 天一轮；acme.sh cron + ARI 自动续）。
- `/etc/nginx/conf.d/game-ssl.conf`（**手工安装、不在仓库**）：443 `default_server` 用 IP 证书、另有一个 `server_name game…` 的域名证书块、80 只为 `Host: 120.48.56.189` 提供 ACME。
- 为此仓库里的 `deploy/baidu/nginx/stronghold.conf` 增加了 `listen 80 default_server`（两条）与
  `location /.well-known/acme-challenge/ { root /var/www/acme; }`。
- 若将来备案下来：把 `game` 的 CNAME 换回 `A → 120.48.56.189`（灰云）即可切回直连；域名证书已到 **2027-01-29**。

### 运维
- 盒子侧：`systemctl status cloudflared`（隧道出站，断线自动重连）；CF 侧看 tunnel `baidu` 的 health。
- 证书：域名 90 天（DNS-01，需 `CF_Token` 在 `~/.acme.sh/account.conf` 才算能自动续——**目前未落盘，需手工续**）；IP 证书 7 天（HTTP-01，已能自动续）。
