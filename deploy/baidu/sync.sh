#!/usr/bin/env bash
# 百度服务器侧同步：拉取最新 baidu 分支并安全应用。
# 由 stronghold-sync.timer 定时驱动（日志进 journal），也可手动执行。
#
# 设计约束：
#   1. 有人在线（humans/rooms/sessions/matches 任一非 0）→ 本轮推迟，不打断对局
#   2. 重启后健康检查不过 → 自动回滚到上一个 commit 并重启
#   3. 仓库里的 systemd 单元 / nginx 配置变更会一并落到 /etc（否则改了不生效）
#   4. 只动 deploy/baidu 文档/脚本（不含服务端运行时代码）→ 不重启 node 进程
# 退出码：0 = 正常（含"本轮推迟"）；非 0 = FAIL（已尝试回滚）
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/stronghold}
NODE_DIR=${NODE_DIR:-/usr/local/node-v22.11.0}
BRANCH=${BRANCH:-baidu}
PROXY=${PROXY:-http://127.0.0.1:7890}
PORT=${PORT:-3000}
SERVICE=stronghold

say(){ printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die(){ say "FAIL: $*"; exit 1; }

cd "$APP_DIR"
# install.sh 的 chown -R 会把 .git 属主改成服务账号，root 跑 git 需先登记
git config --system --add safe.directory "$APP_DIR" 2>/dev/null || true
OLD=$(git rev-parse HEAD)

# 有人在线 = /healthz 的 humans/rooms/matches 任一非 0。
# **不数 sessions**：它是 SessionRegistry 的大小，含「已断开但仍在 10 分钟重连窗口里」的会话
# （server/net.js 的 reconnectWindowMs），所以只要有人来过又走了，sessions 会持续非 0 达 10 分钟——
# 用它判忙会让部署在活跃时段永远 DEFER（2026-10-30 实测：00:07 与 00:37 两轮都因此被挡）。
# 真正要保护的是"有人在房间里 / 有对局在跑"，humans/rooms/matches 三项就够。
# healthz 拿不到（服务已挂）→ 按"不忙"处理：服务挂了更要尽快修。
busy() {
  local s k v
  s=$(curl -sf -m 10 "http://127.0.0.1:$(active_port)/healthz" || true)
  [ -n "$s" ] || return 1
  for k in humans rooms matches; do
    v=$(printf '%s' "$s" | grep -o "\"$k\":[0-9]*" | head -1 | cut -d: -f2)
    [ "${v:-0}" != "0" ] && return 0
  done
  return 1
}

# 计数快照，只用于日志：DEFER 时要能一眼看出是哪个字段挡的
counts() {
  local s out=""
  s=$(curl -sf -m 10 "http://127.0.0.1:$(active_port)/healthz" || true)
  for k in humans rooms matches sessions; do
    out="$out $k=$(printf '%s' "$s" | grep -o "\"$k\":[0-9]*" | head -1 | cut -d: -f2)"
  done
  printf '%s' "${out# }"
}

# 健康判据：healthz ok:true + plugins 数量正常(>=8，实测 11) + 首屏 JS 可取
# 传端口时检查该端口（蓝绿要用它对「待上线的那一色」做体检），缺省 3000。
health_ok() {
  local port="${1:-$PORT}" s p
  s=$(curl -sf -m 15 "http://127.0.0.1:$port/healthz" || true)
  printf '%s' "$s" | grep -q '"ok":true' || return 1
  p=$(printf '%s' "$s" | grep -o '"plugins":[0-9]*' | head -1 | cut -d: -f2)
  [ "${p:-0}" -ge 8 ] || return 1
  curl -sf -m 15 -o /dev/null "http://127.0.0.1:$port/js/screens/lobby.js"
}

# 该端口上「有多少活动」= humans + rooms + matches（0 表示可以安全停掉这一色）
counts_at() {
  local s n=0 v
  s=$(curl -sf -m 8 "http://127.0.0.1:$1/healthz" || true)
  for k in humans rooms matches; do
    v=$(printf '%s' "$s" | grep -o "\"$k\":[0-9]*" | head -1 | cut -d: -f2)
    n=$((n + ${v:-0}))
  done
  printf '%s' "$n"
}

# 蓝绿热更新（业主 2026-10-30「热更新换端口」）：
#   ① 在**空闲的那一色**上起新版 → ② 体检通过 → ③ 原子改写 nginx 上游并 reload →
#   ④ 旧一色继续服务在线玩家与进行中对局，等它自己排空（humans+rooms+matches 归零）再停。
# 任何一步失败都 return 1，调用方退回「直接重启」；旧实例始终在线服务，宁可这次不更新。
# 开关是文件 /etc/stronghold-bluegreen（存在即启用），不放进 unit —— 改它不需要重启任何东西。
UPSTREAM_CONF=/etc/nginx/stronghold-upstream.conf
# 真正在接流量的端口 = nginx 上游文件里那一个（蓝绿会在 3000 / 3001 之间来回切）。
# 2026-10-31 修：无新提交分支原先用 health_ok（默认探 $PORT=3000），蓝绿切到 3001 后
# 3000 已停 ⇒ 每轮都打一条假的「健康检查不过」。这里复用 bg_swap 同一行 sed，别再造第三套口径。
active_port() {
  local a
  a=$(sed -n 's/^server 127\.0\.0\.1:\([0-9]\+\).*/\1/p' "$UPSTREAM_CONF" 2>/dev/null | head -1)
  printf '%s' "${a:-$PORT}"
}
bg_swap() {
  local act idle idleunit wait left
  act=$(sed -n 's/^server 127\.0\.0\.1:\([0-9]\+\).*/\1/p' "$UPSTREAM_CONF" 2>/dev/null | head -1)
  [ -n "$act" ] || { say "     读不到当前上游（$UPSTREAM_CONF）"; return 1; }
  if [ "$act" = "3000" ]; then idle=3001; idleunit="stronghold@green"; else idle=3000; idleunit="$SERVICE"; fi
  say "5a. 蓝绿：当前上游 $act → 在 $idle 上起新版（$idleunit）"
  # 上一轮若没排空，这一色可能还在跑旧代码：restart 保证拿到新代码（会终结它残留的房间，日志里会记数量）
  systemctl restart "$idleunit" >/dev/null 2>&1 || { say "     启动 $idleunit 失败"; return 1; }
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 5; health_ok "$idle" && break; done
  if ! health_ok "$idle"; then
    say "     新一色体检不过 → 停掉它，旧实例继续服务"
    systemctl stop "$idleunit" >/dev/null 2>&1
    return 1
  fi
  say "5b. 新一色健康（$idle）→ 切上游"
  local tmp="$UPSTREAM_CONF.tmp.$$"
  printf 'server 127.0.0.1:%s;\n' "$idle" > "$tmp" || return 1
  mv -f "$tmp" "$UPSTREAM_CONF" || return 1
  if ! nginx -t >/dev/null 2>&1; then
    printf 'server 127.0.0.1:%s;\n' "$act" > "$UPSTREAM_CONF"
    systemctl stop "$idleunit" >/dev/null 2>&1
    say "     nginx -t 失败 → 上游回滚到 $act，新版已停"
    return 1
  fi
  systemctl reload nginx
  say "5c. 已切流到 $idle（在线玩家与进行中的对局都留在旧实例 $act，不受影响）"
  wait=0
  while [ "$wait" -lt "${SP_DRAIN_MAX:-1800}" ]; do
    left=$(counts_at "$act")
    [ "$left" = "0" ] && break
    [ $((wait % 300)) -eq 0 ] && [ "$wait" -gt 0 ] && say "     旧实例还有 $left 处活动，已等 ${wait}s（上限 ${SP_DRAIN_MAX:-1800}s）"
    sleep 15
    wait=$((wait + 15))
  done
  left=$(counts_at "$act")
  if [ "$left" = "0" ]; then
    [ "$act" = "3000" ] && systemctl stop "$SERVICE" >/dev/null 2>&1 || systemctl stop stronghold@green >/dev/null 2>&1
    say "5d. 旧实例已排空并停止（$act）"
  else
    say "WARN: 旧实例仍有 $left 处活动，本次先留着（下次部署再收）"
  fi
  say "PASS: 已应用 $(git log -1 --format='%h %s')"
  return 0
}

say "0. 当前 $(git log -1 --format='%h %s')"

# 2026-10-29 起服务器是**只读消费端**（主干在 GitHub baidu）。工作树若有本地改动，
# 说明有人直接在服务器上动了代码 —— 自动 stash 保留后继续，避免被 reset 静默抹掉。
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  say "WARN: 工作树有本地改动（本机才是编辑环境）→ 自动 stash 保留"
  git stash push -u -m "auto-stash $(date '+%F %T')" >/dev/null 2>&1 \
    && say "     已 stash，可用 'git -C $APP_DIR stash list' 找回" \
    || say "     stash 失败，请人工检查"
fi

say "1. 拉取 origin/$BRANCH（GitHub 直连 17KB/s，走本机 mihomo）"
git -c http.proxy="$PROXY" fetch --depth 1 origin "$BRANCH"
NEW=$(git rev-parse FETCH_HEAD)

if [ "$OLD" = "$NEW" ]; then
  say "2. 无新提交"
  # 探「正在接流量的那一色」，不是写死的 3000（蓝绿切到 green=3001 后 3000 已停）
  AP=$(active_port)
  if health_ok "$AP"; then say "健康检查 PASS（端口 $AP）"; else say "WARN: 健康检查不过（端口 $AP，无变更，未动作）"; fi
  exit 0
fi

CHANGED=$(git diff --name-only "$OLD" "$NEW" || true)
say "2. 有新提交 $(git log -1 --format='%h %s' FETCH_HEAD)，变更 $(printf '%s\n' "$CHANGED" | wc -l) 个文件"

# 运行时代码变更 → 必须重启；只动 deploy/baidu 文档/脚本、或 .github/（CI 定义）→ 不重启
RUNTIME=$(printf '%s\n' "$CHANGED" | grep -v -e '^deploy/baidu/' -e '^\.github/' || true)
NEED_RESTART=0
[ -n "$RUNTIME" ] && NEED_RESTART=1

# 蓝绿可用时不 DEFER：bg_swap 是「先在空闲那一色起新版 → 体检 → 切流 → 旧实例排空后才停」，
# 在线玩家与进行中的对局始终留在旧实例上，根本不需要为了「有人在线」把整轮部署推掉。
# （2026-10-31 业主：部署不是有热切吗，哪个端口没人用就先部署到那里。）
BLUEGREEN=0
[ -f /etc/stronghold-bluegreen ] && command -v nginx >/dev/null 2>&1 && BLUEGREEN=1
if [ "$NEED_RESTART" = 1 ] && [ "$BLUEGREEN" = 0 ] && busy; then
  # 把四个计数都印出来：没有数字时只能靠猜是哪个字段挡的（2026-10-30 排查就卡在这里）
  say "3. DEFER: 有人在线（$(counts)）且蓝绿不可用，保留 $(git rev-parse --short "$OLD")，本轮不应用"
  exit 0
fi
if [ "$NEED_RESTART" = 1 ] && [ "$BLUEGREEN" = 1 ] && busy; then
  say "3. 有人在线（$(counts)）但蓝绿可用 → 照常部署到空闲一色（在线玩家与对局留在旧实例）"
fi

say "3. 应用 $(git rev-parse --short "$NEW")（$([ "$NEED_RESTART" = 1 ] && echo 需重启 || echo 无需重启)）"
git reset --hard FETCH_HEAD

# --- 配置类产物落 /etc（与是否重启进程无关） ---
UNIT_CHANGED=0
for u in stronghold.service stronghold-sync.service stronghold-sync.timer 'stronghold@.service'; do
  if { printf '%s\n' "$CHANGED" | grep -q "^deploy/baidu/$u\$" || [ ! -f "/etc/systemd/system/$u" ]; } && [ -f "$APP_DIR/deploy/baidu/$u" ]; then
    install -m 0644 "$APP_DIR/deploy/baidu/$u" "/etc/systemd/system/$u"
    UNIT_CHANGED=1
    say "3a. 已更新 /etc/systemd/system/$u"
  fi
done
# 蓝绿绿实例的端口文件（只在缺的时候放，避免覆盖现场手调的值）
mkdir -p "$APP_DIR/deploy/baidu/instances"
[ -f "$APP_DIR/deploy/baidu/instances/green.env" ] || printf 'PORT=3001\n' > "$APP_DIR/deploy/baidu/instances/green.env"
[ "$UNIT_CHANGED" = 1 ] && systemctl daemon-reload
# daemon-reload 会重算 timer，但显式重启一次才确定拿到新的 OnCalendar（改了频率就该立刻生效）
if [ "$UNIT_CHANGED" = 1 ] && printf '%s\n' "$CHANGED" | grep -q '^deploy/baidu/stronghold-sync\.timer$'; then
  systemctl restart stronghold-sync.timer && say "3a. timer 已按新频率重启"
fi

if printf '%s\n' "$CHANGED" | grep -q '^deploy/baidu/nginx/' && command -v nginx >/dev/null 2>&1; then
  # 上游地址先落盘：新站点配置 include 它，缺了 nginx -t 必失败（会把整站打挂）
  if [ ! -f "$UPSTREAM_CONF" ]; then
    # 别写死 3000：蓝绿切到 green 后 3000 是停的，写错会把整站导到死端口。先看哪一色真的在答话。
    ap=""
    for p in "$PORT" 3001; do curl -sf -m 3 "http://127.0.0.1:$p/healthz" >/dev/null 2>&1 && { ap=$p; break; }; done
    printf 'server 127.0.0.1:%s;\n' "${ap:-$PORT}" > "$UPSTREAM_CONF"
    say "3a. 已建立上游文件 $UPSTREAM_CONF（→ ${ap:-$PORT}）"
  fi
  install -m 0644 "$APP_DIR/deploy/baidu/nginx/stronghold.conf" /etc/nginx/conf.d/stronghold.conf
  if nginx -t >/dev/null 2>&1; then systemctl reload nginx; say "3a. 已更新并重载 nginx 站点配置"
  else say "WARN: nginx -t 失败，已写入但未重载"; fi
fi

if [ "$NEED_RESTART" = 0 ]; then
  chown -R stronghold:stronghold "$APP_DIR" 2>/dev/null || true
  say "PASS: 配置类变更已应用（未重启进程）"
  exit 0
fi

# --- 运行时代码变更：依赖 → 重启 → 健康检查 → 回滚 ---
if [ -f package-lock.json ] && { [ ! -f node_modules/.package-lock.json ] || ! cmp -s package-lock.json node_modules/.package-lock.json; }; then
  say "4b. 依赖有变化 → npm ci --omit=dev"
  PATH="$NODE_DIR/bin:$PATH" npm ci --omit=dev --no-audit --no-fund || die "npm ci 失败（旧服务仍在跑，未受影响）"
fi
mkdir -p "$APP_DIR/data/.cache" "$APP_DIR/plugins/_incoming" "$APP_DIR/plugins/_replaced" "$APP_DIR/mods"
chown -R stronghold:stronghold "$APP_DIR"

# 蓝绿热更新：/etc/stronghold-bluegreen 存在即启用（改它不需要重启任何东西）。
# 失败退回下面的直接重启路径 —— 旧实例全程在线，最坏就是「这次没更新」。
if [ -f /etc/stronghold-bluegreen ] && command -v nginx >/dev/null 2>&1; then
  if bg_swap; then exit 0; fi
  say "WARN: 蓝绿未完成 → 退回直接重启（旧实例仍在服务）"
fi

say "5. 重启 $SERVICE"
systemctl restart $SERVICE
for i in 1 2 3 4 5 6; do sleep 5; curl -sf -m 5 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; done

if health_ok; then
  say "PASS: 已应用 $(git log -1 --format='%h %s')"
  exit 0
fi

say "FAIL: 重启后健康检查不过 → 回滚到 $(git rev-parse --short "$OLD")"
git reset --hard "$OLD"
if [ -f package-lock.json ] && { [ ! -f node_modules/.package-lock.json ] || ! cmp -s package-lock.json node_modules/.package-lock.json; }; then
  PATH="$NODE_DIR/bin:$PATH" npm ci --omit=dev --no-audit --no-fund || true
fi
chown -R stronghold:stronghold "$APP_DIR" 2>/dev/null || true
systemctl restart $SERVICE
sleep 10
if health_ok; then
  say "已回滚并恢复到 $(git log -1 --format='%h %s')"
  exit 1
fi
die "回滚后仍不健康，需要人工介入（服务未恢复）"
