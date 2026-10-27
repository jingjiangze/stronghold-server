#!/bin/sh
# 边缘层容器的入口：四个进程共用一个对外端口（7860）。
#
#   nginx :7860  ──/assets|fonts──►  sidecar :3130  ──302──► 源
#                ├──/icebreaker/──►  Icebreaker :8700
#                └──其余─────────►  游戏       :3120
#
# 为什么不让 nginx 直接代理游戏：创空间只给一个对外端口（7860，写死在 deploy_schema.json），
# 所以 nginx 占住它，另外几个退到内部端口。反过来做（游戏占 7860、nginx 另开端口）在平台上
# 没有公网口可用。
#
# 监督语义是**故意不对称**的：
#   * 游戏或 nginx 退出 → 整体退出，让平台重启容器。这两者少一个就没有服务。
#   * sidecar / Icebreaker 退出 → 只记日志、继续跑。它们只影响素材选路和附加玩法，
#     而为一个附加进程去重启整个容器，会把主游戏一起停掉——拿小故障换大故障。
set -u

EDGE_DIR=/app/deploy/stardust/ms-edge
EDGE_CONF="$EDGE_DIR/nginx.conf"
PUBLIC_PORT="${SP_PUBLIC_PORT:-7860}"
GAME_PORT="${SP_GAME_PORT:-3120}"
EDGE_PORT="${SP_EDGE_PORT:-3130}"

# 非 root 运行（镜像里是 USER node），而且平台的运行容器可能把 /app 挂成只读：
# pid 与 temp 必须探测出一个**真的能写**的目录，再把 nginx.conf 渲染到那里（include 都是绝对路径）。
EDGE_STATE=""
for d in "${SP_EDGE_STATE:-}" /dev/shm/sp-edge /tmp/sp-edge "${HOME:-/home/node}/.sp-edge" /app/.sp-edge; do
    [ -n "$d" ] || continue
    if mkdir -p "$d/client_body" "$d/proxy" "$d/fastcgi" "$d/uwsgi" "$d/scgi" 2>/dev/null \
       && touch "$d/.w" 2>/dev/null; then
        rm -f "$d/.w"
        EDGE_STATE="$d"
        break
    fi
done
if [ -z "$EDGE_STATE" ]; then
    echo "sp-edge: no writable state dir; serving the game directly on ${PUBLIC_PORT}" >&2
    exec env PORT="$PUBLIC_PORT" HOST=0.0.0.0 node server/index.js
fi
NGINX_CONF="$EDGE_STATE/nginx.conf"
sed "s|/app/.sp-edge|$EDGE_STATE|g" "$EDGE_CONF" > "$NGINX_CONF" 2>/dev/null || NGINX_CONF="$EDGE_CONF"

if ! nginx -t -c "$NGINX_CONF" >/dev/null 2>&1; then
    echo "sp-edge: nginx config rejected; serving the game directly on ${PUBLIC_PORT}" >&2
    nginx -t -c "$NGINX_CONF" >&2 || true
    exec env PORT="$PUBLIC_PORT" HOST=0.0.0.0 node server/index.js
fi

# 素材解析器：故意不参与退出判定（见文件头的监督语义）。
SP_EDGE_PORT="$EDGE_PORT" node "$EDGE_DIR/edge-sidecar.mjs" &
EDGE_PID=$!

export PORT="$GAME_PORT"
export HOST="${SP_GAME_HOST:-127.0.0.1}"

# CF 隧道（可选）：CF_TUNNEL_TOKEN 存在且有 cloudflared 才起。它是出站连接，不需要平台开端口。
# 退出只记一次日志，绝不影响游戏——隧道只是多一条入口，不是服务本体。
CF_PID=''
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
    if [ -x /app/bin/cloudflared ]; then
        /app/bin/cloudflared tunnel --no-autoupdate run --token "$CF_TUNNEL_TOKEN" > /dev/stderr 2>&1 &
        CF_PID=$!
        echo "sp-edge: cloudflared started (pid $CF_PID) → CF 入口指向 127.0.0.1:$PUBLIC_PORT"
    else
        echo 'sp-edge: CF_TUNNEL_TOKEN is set but /app/bin/cloudflared is missing; CF entry stays off' >&2
    fi
fi
node server/index.js &
GAME_PID=$!

# 等游戏真正开始监听再放 nginx 进来，否则头几个请求会撞上 502。
# 用 node 自己探（容器里必有 node），不依赖 wget/curl 的实现细节。
node -e '
const port = Number(process.env.SP_GAME_PORT || 3120);
const net = require("net");
const deadline = Date.now() + 60000;
(function probe() {
  const sock = net.connect(port, "127.0.0.1");
  sock.on("connect", () => { sock.destroy(); process.exit(0); });
  sock.on("error", () => {
    sock.destroy();
    if (Date.now() > deadline) { console.error("sp-edge: game did not listen in time"); process.exit(1); }
    setTimeout(probe, 250);
  });
})();
' || { kill "$GAME_PID" "$EDGE_PID" 2>/dev/null || true; exit 1; }

# ---- 促融共竞（Icebreaker）：独立进程，挂在前缀 /icebreaker/ 下 ------------------------------------
# 监督语义与 sidecar 同类：它死只记日志、不拖垮容器。这个容器的服务本体是主游戏；为一个附加玩法
# 把主游戏一起重启，是拿大故障换小故障。依赖/源码缺失时干脆不起，日志里写清原因，/icebreaker/ 回 502。
ICE_PORT="${SP_ICEBREAKER_PORT:-8700}"
ICE_DIR="${SP_ICEBREAKER_DIR:-/app/icebreaker}"
ICE_PID=''
ICE_WHY=''
# pnpm 的隔离布局：第三方包挂在各自包的 node_modules 下，不在仓库根（ws 在 packages/server 下，three 在
# engine/packages/render 下）。两种布局都认，免得换 --node-linker 时把启动条件写死。
have_dir() { for d in "$@"; do [ -d "$d" ] && return 0; done; return 1; }
[ -f "$ICE_DIR/packages/server/src/main.js" ] || ICE_WHY='source not installed'
[ -n "$ICE_WHY" ] || have_dir "$ICE_DIR/packages/server/node_modules/ws" "$ICE_DIR/node_modules/ws" || ICE_WHY='dependencies not installed'
[ -n "$ICE_WHY" ] || have_dir "$ICE_DIR/engine/packages/render/node_modules/three" "$ICE_DIR/node_modules/three" || ICE_WHY='dependency three missing'

# mod 目录：优先用镜像里那个（创空间的 /app 可写，重新部署时重置），不可写就退到 /tmp。
if [ -z "$ICE_WHY" ]; then
    ICE_MODS="${AUE_MODS_DIR:-$ICE_DIR/mods}"
    if mkdir -p "$ICE_MODS" 2>/dev/null && touch "$ICE_MODS/.w" 2>/dev/null; then
        rm -f "$ICE_MODS/.w"
    else
        ICE_MODS=/tmp/icebreaker-mods
        mkdir -p "$ICE_MODS" 2>/dev/null || ICE_MODS=/dev/shm/icebreaker-mods
        mkdir -p "$ICE_MODS" 2>/dev/null || true
        echo "sp-edge: icebreaker mods dir falls back to $ICE_MODS (reads/uploads live until the next restart)" >&2
    fi
    export AUE_MODS_DIR="$ICE_MODS"
fi

start_ice() {
    # --seats 4：四人房（2v2）。默认是 2 —— 上游的合作人数。四人局按奇偶分队（0/2 与 1/3），
    # 顶栏四席 + 中间比分、房间页按「我 + 我的搭档」显示，都是按这个座位数做的。
    ( cd "$ICE_DIR" && exec node packages/server/src/main.js --host 127.0.0.1 --port "$ICE_PORT" \
        --trust-proxy --max-rooms 30 --max-battles 6 --seats 4 ) &
    ICE_PID=$!
    echo "sp-edge: icebreaker on 127.0.0.1:$ICE_PORT (pid $ICE_PID) seats=4"
}

# 刻意**不等**它监听：等就等于把主站的首个请求押在附加玩法上。nginx 先起，/icebreaker/ 头几秒可能 502。
if [ -n "$ICE_WHY" ]; then
    echo "sp-edge: icebreaker off ($ICE_WHY); /icebreaker/ stays unavailable" >&2
else
    start_ice
fi

# 素材：**前台同步预载**（2026-10-25 改）。实测 gh-proxy 拉上游 v0.1.3 assets.zip
# 504,452,614 B 只要 17 秒（三次 16 MiB 采样 2962/5044/6241 KB/s），所以不值得为它
# 引入「先启动再重启」的那套复杂度 —— 预载在 Icebreaker 首次启动之前跑完，
# assetVersion() 一次算对，页面 <meta name="ig-assets"> 直接带正确版本段。
#
# 位置：夹在「游戏已能服务」（上面的监听探测）与「nginx 起」之间。主游戏不受影响，
# 阻塞的只有 /icebreaker/ —— 与文件头「不拿大故障换小故障」的监督语义一致。
#
# 幂等门保留：容器重启时素材已在 /app/icebreaker/assets，跳过下载立即启动。
ICE_ASSETS_URL="${SP_ICEBREAKER_ASSETS_URL-https://gh-proxy.com/https://github.com/ArknightsDevs/Icebreaker-Games/releases/download/v0.1.3/Icebreaker-Games-v0.1.3-assets.zip}"
ICE_ASSETS_WHY=''
if [ -n "$ICE_WHY" ]; then
    :                                                    # 源码/依赖缺失：与素材无关，交给下面的启动判定
elif [ -z "$ICE_ASSETS_URL" ]; then
    ICE_ASSETS_WHY='no assets url (set SP_ICEBREAKER_ASSETS_URL)'
elif [ -f "$ICE_DIR/assets/skeleton/fx/units.json" ]; then
    echo "sp-edge: icebreaker assets already in place ($(find "$ICE_DIR/assets" -type f | wc -l) files)"
else
    echo "sp-edge: icebreaker assets missing; preloading from ${ICE_ASSETS_URL##*//} (this does not block the game)"
    if ! mkdir -p "$ICE_DIR/assets" 2>/dev/null; then
        ICE_ASSETS_WHY="cannot create $ICE_DIR/assets (read-only?)"
    elif ! wget -q -T 600 -O /tmp/ice-assets.zip "$ICE_ASSETS_URL" 2>/dev/null; then
        ICE_ASSETS_WHY="download failed from $ICE_ASSETS_URL"
    elif ! unzip -q /tmp/ice-assets.zip -d /tmp/ice-assets 2>/dev/null \
            && ! busybox unzip -q /tmp/ice-assets.zip -d /tmp/ice-assets 2>/dev/null; then
        ICE_ASSETS_WHY='unzip failed'
        rm -rf /tmp/ice-assets
    elif ! cp -a /tmp/ice-assets/Icebreaker-Games-assets/assets/. "$ICE_DIR/assets/" 2>/dev/null; then
        ICE_ASSETS_WHY="copy into $ICE_DIR/assets failed"
        rm -rf /tmp/ice-assets
    else
        rm -rf /tmp/ice-assets /tmp/ice-assets.zip
        echo "sp-edge: icebreaker assets ready ($(find "$ICE_DIR/assets" -type f | wc -l) files)"
    fi
    # 下载失败也清掉半成品，免得下次启动被幂等门误判成「素材已在」
    [ -z "$ICE_ASSETS_WHY" ] || rm -rf /tmp/ice-assets /tmp/ice-assets.zip
fi

# 素材没到位：照常启动（Icebreaker 自己会降级成「无美术但可玩」），但**必须把话说清楚** ——
# 它的降级原本是完全静默的（服务端日志一个字都不打，只有浏览器里弹一条 notice）。
if [ -n "$ICE_ASSETS_WHY" ]; then
    echo "sp-edge: icebreaker starts WITHOUT art ($ICE_ASSETS_WHY); battles run, the field is not drawn" >&2
fi

nginx -c "$NGINX_CONF" -g 'daemon off;' &
NGINX_PID=$!

shutdown() {
    kill "$NGINX_PID" "$GAME_PID" "$EDGE_PID" ${ICE_PID:+"$ICE_PID"} 2>/dev/null || true
    wait "$NGINX_PID" 2>/dev/null || true
    wait "$GAME_PID" 2>/dev/null || true
    wait "$EDGE_PID" 2>/dev/null || true
    exit 0
}
trap shutdown TERM INT

EDGE_REPORTED=0
ICE_REPORTED=0
while :; do
    if ! kill -0 "$GAME_PID" 2>/dev/null; then
        echo "sp-edge: game process exited; stopping everything" >&2
        kill "$NGINX_PID" "$EDGE_PID" "${CF_PID:-}" 2>/dev/null || true
        wait "$NGINX_PID" 2>/dev/null || true
        exit 1
    fi
    if ! kill -0 "$NGINX_PID" 2>/dev/null; then
        echo "sp-edge: nginx exited; stopping everything" >&2
        kill "$GAME_PID" "$EDGE_PID" 2>/dev/null || true
        wait "$GAME_PID" 2>/dev/null || true
        exit 1
    fi
    # 只报一次，避免刷屏；不重启它，也不因此停容器。
    if [ "$EDGE_REPORTED" = "0" ] && ! kill -0 "$EDGE_PID" 2>/dev/null; then
        echo "sp-edge: sidecar exited; /assets|fonts now served by the nginx fallback" >&2
        EDGE_REPORTED=1
    fi
    # 与 sidecar 同一套语义：附加玩法挂了只记一次日志，不拖垮主游戏。
    if [ "$ICE_REPORTED" = "0" ] && [ -n "$ICE_PID" ] && ! kill -0 "$ICE_PID" 2>/dev/null; then
        echo "sp-edge: icebreaker exited; /icebreaker/ stays down until the next container start" >&2
        ICE_REPORTED=1
        ICE_PID=''
    fi
    sleep 2
done
