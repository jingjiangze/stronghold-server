#!/usr/bin/env bash
# Stronghold Protocol — 百度轻量应用服务器 部署脚本（幂等）
# 目标机：Rocky Linux 9.4 x86_64 / Node v22.11.0 (/usr/local/node-v22.11.0)
# 前提：代码已位于 $APP_DIR（git clone 或 tarball 解包均可）
# 用法：bash deploy/baidu/install.sh [--with-nginx]
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/stronghold}
USER_NAME=${USER_NAME:-stronghold}
NODE_DIR=${NODE_DIR:-/usr/local/node-v22.11.0}
PORT=${PORT:-3000}
WITH_NGINX=0
for a in "$@"; do [ "$a" = "--with-nginx" ] && WITH_NGINX=1; done
SERVICE_SRC="$APP_DIR/deploy/baidu/stronghold.service"

say() { printf '\n=== %s ===\n' "$*"; }

say "0. 前置检查"
test -f "$APP_DIR/server/index.js" || { echo "FAIL: $APP_DIR/server/index.js 不存在（代码没就位）"; exit 1; }
test -x "$NODE_DIR/bin/node" || { echo "FAIL: $NODE_DIR/bin/node 不存在"; exit 1; }
"$NODE_DIR/bin/node" -v

say "1. SELinux / 时区（只报告，不改）"
getenforce 2>/dev/null || echo "selinux: none"
timedatectl 2>/dev/null | sed -n '3,4p' || true

say "2. 服务账号"
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin "$USER_NAME"
  echo "created user $USER_NAME"
else
  echo "user $USER_NAME exists"
fi

say "3. 依赖安装（npm ci，纯 JS 依赖，无需 gcc）"
cd "$APP_DIR"
export PATH="$NODE_DIR/bin:$PATH"
if [ -f package-lock.json ]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi

say "4. 目录归属与运行时可写目录"
mkdir -p "$APP_DIR/data/.cache" "$APP_DIR/plugins/_incoming" "$APP_DIR/plugins/_replaced" "$APP_DIR/mods"
# chown -R 会把 .git 的属主也改成服务账号，导致 root 执行 git 时报 dubious ownership
# 先登记 safe.directory，否则后续 git fetch/reset 全部失败
git config --system --add safe.directory "$APP_DIR" 2>/dev/null || true
chown -R "$USER_NAME":"$USER_NAME" "$APP_DIR"

say "4b. 系统层：swap / 内核参数 / nginx 句柄（幂等）"
if swapon --show 2>/dev/null | grep -q swapfile; then
  echo "swap 已启用"
else
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile > /dev/null          # 注意：mkswap 没有 -q 参数（Rocky 会报 invalid option）
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "已创建并启用 /swapfile 2G"
fi
cat > /etc/sysctl.d/90-stronghold.conf <<'SYSCTL'
vm.swappiness = 10
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 1024
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
SYSCTL
sysctl -q -p /etc/sysctl.d/90-stronghold.conf
if [ -f /etc/nginx/nginx.conf ] && ! grep -q '^worker_rlimit_nofile' /etc/nginx/nginx.conf; then
  sed -i '1i worker_rlimit_nofile 65535;' /etc/nginx/nginx.conf
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
fi
echo "swap=$(swapon --show --noheadings | wc -l) 条 | swappiness=$(sysctl -n vm.swappiness) | syn_backlog=$(sysctl -n net.ipv4.tcp_max_syn_backlog)"

say "5. systemd 单元（HOST=127.0.0.1，对外走 nginx）"
test -f "$SERVICE_SRC" || { echo "FAIL: 缺少 $SERVICE_SRC"; exit 1; }
install -m 0644 "$SERVICE_SRC" /etc/systemd/system/stronghold.service
systemctl daemon-reload
systemctl enable --now stronghold
sleep 4

if [ "$WITH_NGINX" = "1" ]; then
  say "5b. nginx 反代"
  command -v nginx >/dev/null 2>&1 || dnf install -y -q nginx
  TS=$(date +%Y%m%d-%H%M%S)
  if [ ! -f /etc/nginx/nginx.conf.bak-applied ]; then
    cp -a /etc/nginx/nginx.conf "/etc/nginx/nginx.conf.bak-$TS"
    install -m 0644 "$APP_DIR/deploy/baidu/nginx/nginx.conf" /etc/nginx/nginx.conf
    touch /etc/nginx/nginx.conf.bak-applied
    echo "已替换 nginx.conf（原文件备份为 nginx.conf.bak-$TS）"
  else
    echo "nginx.conf 之前已替换过，跳过"
  fi
  mkdir -p /etc/nginx/conf.d
  install -m 0644 "$APP_DIR/deploy/baidu/nginx/stronghold.conf" /etc/nginx/conf.d/stronghold.conf
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
fi

if [ -f "$APP_DIR/deploy/baidu/stronghold-sync.timer" ]; then
  say "5c. 定时同步（stronghold-sync.timer，每 30 分钟，有人在线自动推迟）"
  install -m 0644 "$APP_DIR/deploy/baidu/stronghold-sync.service" /etc/systemd/system/stronghold-sync.service
  install -m 0644 "$APP_DIR/deploy/baidu/stronghold-sync.timer"    /etc/systemd/system/stronghold-sync.timer
  systemctl daemon-reload
  systemctl enable --now stronghold-sync.timer
  systemctl list-timers stronghold-sync.timer --no-pager | head -3
fi

say "6. 状态"
systemctl is-active stronghold || true
ss -lntp | grep -E ":$PORT " || echo "WARN: 端口 $PORT 未监听"
if command -v nginx >/dev/null 2>&1; then
  systemctl is-active nginx || true
  ss -lntp | grep -E ":80 " || echo "WARN: nginx 未监听 80"
fi

say "7. 就绪探测"
curl -sS -m 10 "http://127.0.0.1:$PORT/healthz" || echo "WARN: /healthz（直连）未通"
echo
if command -v nginx >/dev/null 2>&1; then
  curl -sS -m 10 -o /dev/null -w "nginx /healthz -> %{http_code}\n" http://127.0.0.1/healthz || true
fi
journalctl -u stronghold --no-pager -n 20 --output=cat 2>/dev/null | grep -E "plugins|overlay" || true
