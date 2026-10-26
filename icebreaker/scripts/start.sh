#!/bin/sh
# 促融共竞：启动完整包的服务器（docs/deploy.md）。需要 Node.js 22.12 或更新的版本。
# 用法：sh scripts/start.sh [服务器参数，例如 --port 8800]
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先安装 Node.js 22 或 24：https://nodejs.org/"
  exit 1
fi
exec node scripts/launch.js "$@"
