# syntax=docker/dockerfile:1
# 卫戍协议：盟约 · production image (server + static client). Docs: docs/DEPLOY.md「Docker」.
#
# Code: GPL-3.0-or-later (LICENSE). Game art/audio is © Hypergryph / Yostar, not covered by the GPL, non-commercial use
# only (NOTICE.md), and never part of the repository. Two ways to get it into a container:
#   A) download it while building (~250 MB, needs internet during the build):
#        docker build -t stronghold-protocol --build-arg FETCH_ASSETS=1 .
#   B) build without it and mount the host's copy (prepared with `node tools/setup.mjs` on the host):
#        docker build -t stronghold-protocol .
#        docker run -d --name stronghold -p 3000:3000 --restart unless-stopped \
#          -v "$PWD/public/assets:/app/public/assets:ro" stronghold-protocol
#      (public/fonts, data/assets.json and data/local-assets.json are copied from the build context when present)
# Without any art the game still runs with placeholder visuals.
#
# Run:  docker run -d --name stronghold -p 3000:3000 --restart unless-stopped stronghold-protocol
# Env:  PORT (3000), HOST (0.0.0.0), SP_COMBAT (client|server), SP_VERIFY (off|sample|all), TRUST_PROXY (auto|1|0), DEBUG

ARG NODE_IMAGE=node:22-alpine

# ---- 1. production dependencies (cached while package*.json are unchanged) -------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the postinstall (tools/vendor.mjs) runs in the next stage, once the sources are there
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

# ---- 2. vendor libs + optional art download ---------------------------------------------------------
FROM deps AS build
ARG FETCH_ASSETS=0
COPY shared ./shared
# Canonical offline name moderation, shared with the isolated auth image. No auth UI/secrets/game data.
COPY deploy/stardust/auth/name-policy.mjs \
     deploy/stardust/auth/name-dictionary.mjs \
     deploy/stardust/auth/name-sensitive-dictionary.mjs \
     deploy/stardust/auth/name-filter-vendor.mjs \
     deploy/stardust/auth/name-filter-node.mjs \
     deploy/stardust/auth/NAME-DICTIONARY-LICENSE.txt \
     deploy/stardust/auth/NAME-FILTER-LICENSE.txt \
     deploy/stardust/auth/NAME-CATEGORIES-LICENSE.txt \
     deploy/stardust/auth/NAME-POLITICAL-LICENSE.txt ./deploy/stardust/auth/
COPY server ./server
COPY tools ./tools
COPY data ./data
COPY public ./public
COPY docs/research ./docs/research
RUN node tools/vendor.mjs \
 && if [ "$FETCH_ASSETS" = "1" ]; then \
      node tools/fetch-assets.mjs || echo "WARNING: art download incomplete; the image falls back to placeholder art"; \
    fi \
 && rm -rf .cache

# ---- 3. runtime ---------------------------------------------------------------------------------------
FROM ${NODE_IMAGE}
# 边缘层：nginx + lua-nginx-module 做素材的 302 分流（deploy/stardust/ms-edge/）。
# OpenResty 官方不提供 alpine 包、也没有 Windows 构建；nginx-mod-http-lua 就是同一套
# lua-nginx-module（OpenResty = nginx + 该模块 + LuaJIT），所以这里直接装等价组件。
# 用 aliyun 镜像源：构建机在境内，alpine 官方源实测不可达；万一 aliyun 也不通就退回原源，
# 不让一个镜像站的可用性把整个构建钉死。
RUN cp /etc/apk/repositories /tmp/repos.bak \
 && sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories \
 && (apk add --no-cache nginx nginx-mod-http-lua luajit lua-resty-core lua-resty-lrucache lua5.1-cjson \
     || { cp /tmp/repos.bak /etc/apk/repositories; \
          apk add --no-cache nginx nginx-mod-http-lua luajit lua-resty-core lua-resty-lrucache lua5.1-cjson; }) \
 && mkdir -p /tmp/sp-edge \
 && chown -R node:node /tmp/sp-edge

# ModelScope 创空间要求容器监听 0.0.0.0:7860，且端口不可改
# (deploy_schema.json: port.const = 7860；8080 被平台进程占用)
# nginx 占 7860（对外），游戏本体退到 127.0.0.1:3000（enrtypoint.sh 里导出 PORT）。
ENV NODE_ENV=production \
    SP_PUBLIC_PORT=7860 \
    SP_GAME_PORT=3000 \
    PORT=3000 \
    HOST=127.0.0.1
WORKDIR /app
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/deploy/stardust/auth ./deploy/stardust/auth
COPY --from=build /app/server ./server
COPY --from=build /app/data ./data
COPY --from=build /app/public ./public
# research tables: read by server/sim/nodeData.js as a fallback
COPY --from=build /app/docs/research ./docs/research
# 边缘层：配置、分流脚本与入口。nginx.conf/sources.json 是数据，edge.lua 是决策。
COPY deploy/stardust/ms-edge/nginx.conf /app/deploy/stardust/ms-edge/nginx.conf
COPY deploy/stardust/ms-edge/edge.lua /app/deploy/stardust/ms-edge/edge.lua
COPY deploy/stardust/ms-edge/sources.json /app/deploy/stardust/ms-edge/sources.json
COPY deploy/stardust/ms-edge/entrypoint.sh /app/deploy/stardust/ms-edge/entrypoint.sh
RUN chmod +x /app/deploy/stardust/ms-edge/entrypoint.sh

# 构建期就验一次，而不是让容器上线后崩在起不来：一个坏的 nginx 配置或一段编译不过的 Lua
# 应该让这次构建失败（旧镜像继续服务），而不是产出一个 restart 循环的镜像。
#   luajit -e loadfile : 只编译不执行——edge.lua 顶层就调 ngx.*，执行需要 nginx 环境。
#   nginx -t           : 解析整个配置（含 load_module）。
# 注意 nginx -t 不读 *_by_lua_file 的内容，所以这两条缺一不可。
RUN luajit -e "assert(loadfile('/app/deploy/stardust/ms-edge/edge.lua'))" \
 && nginx -t -c /app/deploy/stardust/ms-edge/nginx.conf

USER node
EXPOSE 7860
# 探的是对外那个口，因为现在 7860 是 nginx：它活着且能代理到游戏，才算这个容器健康。
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:7860/healthz" || exit 1
CMD ["/app/deploy/stardust/ms-edge/entrypoint.sh"]
