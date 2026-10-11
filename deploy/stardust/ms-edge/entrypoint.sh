#!/bin/sh
# 边缘层容器的入口：先起游戏本体，再起 nginx 在前面做 302 分流。
#
# 为什么不让 nginx 直接代理游戏：创空间只给一个对外端口（7860，写死在 deploy_schema.json），
# 所以 nginx 占住它，游戏退到内部 3000，按路径分开。反过来做（游戏占 7860、nginx 另开端口）
# 在平台上没有公网口可用。
#
# 关停语义：任一侧退出就整体退出——让平台重启容器，而不是留一个「前端活着、后端没了」
# 的半死状态在那儿骗人。
set -eu

GAME_PORT="${SP_GAME_PORT:-3000}"
export PORT="$GAME_PORT"
export HOST="${HOST:-127.0.0.1}"

# 非 root 运行（镜像里是 USER node）：nginx 的 pid 与临时目录都得是可写路径。
mkdir -p /tmp/sp-edge/client_body /tmp/sp-edge/proxy /tmp/sp-edge/fastcgi \
         /tmp/sp-edge/uwsgi /tmp/sp-edge/scgi

node server/index.js &
GAME_PID=$!

# 等游戏真正开始监听再放 nginx 进来，否则头几个请求会撞上 502。
# 用 node 自己探（容器里必有 node），不依赖 wget/curl 是否装了对应实现。
node -e '
const port = Number(process.env.PORT || 3000);
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
' || { kill "$GAME_PID" 2>/dev/null || true; exit 1; }

nginx -c /app/deploy/stardust/ms-edge/nginx.conf -g 'daemon off;' &
NGINX_PID=$!

# 谁先退出就收掉另一个。trap 覆盖平台发来的 TERM/INT。
shutdown() {
    kill "$NGINX_PID" "$GAME_PID" 2>/dev/null || true
    wait "$NGINX_PID" 2>/dev/null || true
    wait "$GAME_PID" 2>/dev/null || true
    exit 0
}
trap shutdown TERM INT

while :; do
    if ! kill -0 "$GAME_PID" 2>/dev/null; then
        echo "sp-edge: game process exited; stopping nginx" >&2
        kill "$NGINX_PID" 2>/dev/null || true
        wait "$NGINX_PID" 2>/dev/null || true
        exit 1
    fi
    if ! kill -0 "$NGINX_PID" 2>/dev/null; then
        echo "sp-edge: nginx exited; stopping game" >&2
        kill "$GAME_PID" 2>/dev/null || true
        wait "$GAME_PID" 2>/dev/null || true
        exit 1
    fi
    sleep 2
done
