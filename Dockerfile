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
# NOTE (ModelScope deploy of the OFFICIAL upstream tree): the fork's offline name-moderation chain
# (deploy/stardust/auth/name-*.mjs + shared/names.js) does not exist upstream, so it is not copied here.
COPY server ./server
COPY plugins ./plugins
COPY tools ./tools
COPY data ./data
COPY public ./public
COPY docs/research ./docs/research
RUN node tools/vendor.mjs \
 && if [ "$FETCH_ASSETS" = "1" ]; then \
      node tools/fetch-assets.mjs || echo "WARNING: art download incomplete; the image falls back to placeholder art"; \
    fi \
 && rm -rf .cache

# ---- 2b. Icebreaker（促融共竞）-------------------------------------------------------------------------
# 与上面的游戏本体完全独立的一段：源码与 v0.2.4 的 kits 随镜像走，运行期第三方只有 ws / es-module-lexer /
# three，按 pnpm 锁文件装成生产依赖。这一段**失败不会**让构建失败：entrypoint.sh 会发现依赖不全而跳过
# 启动（/icebreaker/ 只回 502），主游戏不受影响。反过来做（缺依赖就让构建红）等于拿小功能换整个站点。
FROM ${NODE_IMAGE} AS icebreaker
WORKDIR /ice
COPY icebreaker ./icebreaker
COPY icebreaker-kits ./icebreaker-kits
RUN (corepack enable \
     && corepack prepare pnpm@11.28.0 --activate \
     && cd icebreaker && pnpm install --prod --frozen-lockfile --ignore-scripts --reporter=silent \
     && rm -rf /root/.cache/node/corepack) \
    || echo "WARNING: icebreaker dependencies not installed; the platform stays off" >&2
# 素材（约 504 MB）：官方 assets.zip。构建机到 GitHub 往往只有几百 KB/s，所以这里只给 8 分钟预算、
# 失败不算错 —— entrypoint.sh 会在容器里用同一个地址再后台拉一次，拉完自动重启 Icebreaker。
ARG ICEBREAKER_ASSETS_URL=https://gh-proxy.com/https://github.com/ArknightsDevs/Icebreaker-Games/releases/download/v0.1.3/Icebreaker-Games-v0.1.3-assets.zip
RUN set -e; \
    mkdir -p /ice/icebreaker/assets; \
    if ! command -v unzip >/dev/null 2>&1; then \
      apk add --no-cache unzip >/dev/null 2>&1 \
        || { sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories && apk add --no-cache unzip >/dev/null 2>&1; } \
        || true; \
    fi; \
    if wget -q -T 480 -O /tmp/ice-assets.zip "$ICEBREAKER_ASSETS_URL" \
       && ( unzip -q /tmp/ice-assets.zip -d /tmp/ice-assets 2>/dev/null || busybox unzip -q /tmp/ice-assets.zip -d /tmp/ice-assets ); then \
      cp -a /tmp/ice-assets/Icebreaker-Games-assets/assets/. /ice/icebreaker/assets/; \
      echo "icebreaker: assets $(find /ice/icebreaker/assets -type f | wc -l) files"; \
    else \
      echo "WARNING: icebreaker assets not fetched at build time; the entrypoint retries in the background" >&2; \
    fi; \
    rm -rf /tmp/ice-assets /tmp/ice-assets.zip

# ---- 3. runtime ---------------------------------------------------------------------------------------
FROM ${NODE_IMAGE}
# 边缘层：普通的 nginx 做分流，素材的判定在 edge-sidecar.mjs（一个 Node 进程）里。
# 刻意**不用** nginx 的 Lua 模块（Stardust 的 openi-resolver 也是这个形状）：那是动态模块，
# 配置里少一行 include 就会让所有 lua_* 变成未知指令、nginx 直接起不来；换成普通 nginx
# 就没有这个失败模式，而且那段逻辑能用 node --test 直接测。
# 用 aliyun 镜像源：构建机在境内，alpine 官方源实测不可达；万一 aliyun 也不通就退回原源，
# 不让一个镜像站的可用性把整个构建钉死。
RUN cp /etc/apk/repositories /tmp/repos.bak \
 && sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories \
 && (apk add --no-cache nginx \
     || { cp /tmp/repos.bak /etc/apk/repositories; apk add --no-cache nginx; }) \
 && mkdir -p /app/.sp-edge \
 && chown -R node:node /app/.sp-edge

# ModelScope 创空间要求容器监听 0.0.0.0:7860，且端口不可改
# (deploy_schema.json: port.const = 7860；8080 被平台进程占用)
# nginx 占 7860（对外）；游戏与素材解析器退到内部端口，端口号照抄 Stardust 的
# compose（游戏 3120 / 解析器 3130），这样两边配置能逐行对照。
ENV NODE_ENV=production \
    SP_PUBLIC_PORT=7860 \
    SP_GAME_PORT=3120 \
    SP_EDGE_PORT=3130 \
    SP_ICEBREAKER_PORT=8700 \
    AUE_ASSETS_DIR=/app/icebreaker/assets \
    AUE_KITS_DIR=/app/icebreaker-kits \
    AUE_MODS_DIR=/app/icebreaker/mods \
    AUE_NO_BROTLI=1 \
    PORT=3120 \
    HOST=127.0.0.1 \
    SP_PLUGIN_SCRIPTS=trusted-force \
    SP_PLUGIN_AUTOCONSENT=1 \
    SP_MODS=off \
    SP_STUDIO=off \
    SP_HTTP_COMPRESS=off
WORKDIR /app
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/plugins ./plugins
COPY --from=build /app/data ./data
COPY --from=build /app/public ./public
# research tables: read by server/sim/nodeData.js as a fallback
COPY --from=build /app/docs/research ./docs/research
# 0.3.0: server/studio/index.js imports tools/assets/atlas.mjs + tools/golden.mjs at boot — the
# runtime image needs the tools tree too (0.2.6-era Dockerfile.ms predates the studio).
COPY --from=build /app/tools ./tools
# Icebreaker（促融共竞）：源码 + v0.2.4 kits + 构建期能拿到的素材。/icebreaker/ 由 nginx 转到 127.0.0.1:8700，
# mods 目录留给运行期上传（/app 在创空间里可写，重建时重置）。
# assets 目录必须 chown 给 node：COPY 进来的属主是 root，而运行期是 USER node —— 不授权的话
# entrypoint 的强制预载往 /app/icebreaker/assets 写字节会 EACCES（2026-10-25 审计标记的必改项）。
COPY --from=icebreaker /ice/icebreaker /app/icebreaker
COPY --from=icebreaker /ice/icebreaker-kits /app/icebreaker-kits
RUN mkdir -p /app/icebreaker/mods /app/icebreaker/assets \
 && chown -R node:node /app/icebreaker/mods /app/icebreaker/assets
# 边缘层：配置、解析器与入口。nginx.conf / sources.json 是数据，edge-sidecar.mjs 是决策。
COPY deploy/stardust/ms-edge/nginx.conf /app/deploy/stardust/ms-edge/nginx.conf
COPY deploy/stardust/ms-edge/edge-sidecar.mjs /app/deploy/stardust/ms-edge/edge-sidecar.mjs
COPY deploy/stardust/ms-edge/render-nginx.mjs /app/deploy/stardust/ms-edge/render-nginx.mjs
COPY deploy/stardust/ms-edge/sources.json /app/deploy/stardust/ms-edge/sources.json
COPY deploy/stardust/ms-edge/entrypoint.sh /app/deploy/stardust/ms-edge/entrypoint.sh

# 构建期就验一次，而不是让容器上线后崩在起不来：一个坏的 nginx 配置或一份渲染不出的
# sources.json 应该让这次构建失败（旧镜像继续服务），而不是产出一个 restart 循环的镜像。
# 顺序要紧：先渲染 sources-nginx.conf，否则 nginx.conf 里的 include 扑空、nginx -t 必红。
# （还有一道运行期同款检查在 entrypoint.sh：过不了就整体退回「游戏直接占 7860」。）
# CF 隧道入口（可选）：把 cloudflared 一起打进镜像。拉不到就让构建继续 —— 没有它容器照常跑，
# 只是 CF_TUNNEL_TOKEN 那条入口不可用（启动时会打印原因）。
RUN mkdir -p /app/bin \
 && (wget -q -T 120 -O /app/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
     && chmod +x /app/bin/cloudflared && /app/bin/cloudflared --version) \
 || echo 'WARNING: cloudflared unavailable at build time; the CF tunnel entry stays off'
RUN chmod +x /app/deploy/stardust/ms-edge/entrypoint.sh \
 && node /app/deploy/stardust/ms-edge/render-nginx.mjs /app/deploy/stardust/ms-edge/sources-nginx.conf \
 && nginx -t -c /app/deploy/stardust/ms-edge/nginx.conf

USER node
EXPOSE 7860
# 探的是对外那个口，因为现在 7860 是 nginx：它活着且能代理到游戏，才算这个容器健康。
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:7860/healthz" || exit 1
CMD ["/app/deploy/stardust/ms-edge/entrypoint.sh"]
