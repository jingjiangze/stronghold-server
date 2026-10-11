# 创空间边缘层（ms-edge）

素材请求**只做 302**，字节从不经过这个容器。三个进程共用一个对外端口——这与 Stardust 的
compose 同构（游戏 3120 / 素材解析器 3130 / 一个 nginx 在前面）。

```
                    ┌─ /assets/** /fonts/** ─► edge-sidecar :3130 ──302──► 源
玩家 ──:7860──► nginx┤                                              ↑ 字节不过任何进程
                    └─ 其余（页面/data/js/vendor/media/ws/healthz）─► 游戏 :3120
```

## 为什么是 Node sidecar + 普通 nginx，而不是 nginx 的 Lua 模块

Stardust 也是这么分的：素材跳转在 `openi-resolver`（一个 dependency-free 的 Node sidecar），
Lua 只剩 `material-lb/` 两个文件。跟着走有三个具体好处：

- **少一类起不来**：nginx 的 Lua 是动态模块，配置里少一行 `include /etc/nginx/modules/*.conf`
  就会让所有 `lua_*` 变成未知指令、nginx 直接起不来。不装这个模块就没有这个失败模式。
- **能直接测**：`node --test` 跑真实决策函数，不需要为了测 Lua 去装一个 Lua VM。
- **后端故障有兜底**：`@sp_asset_fallback` 是 nginx 自己 `return 302`，照抄 Stardust 的
  `@ark_proto_asset_fallback`。sidecar 挂了玩家也不会吃到错误页。

## 为什么 nginx 占 7860

创空间把对外端口写死成 7860（`deploy_schema.json` 的 `port.const`），容器里没有第二个
公网口。所以 nginx 占住 7860，游戏与 sidecar 退到内部端口（`HOST=127.0.0.1`）。
反过来（游戏占 7860、nginx 另开端口）在平台上没有公网口可用。

## 监督语义是故意不对称的

`entrypoint.sh`：

| 进程 | 退出后果 | 为什么 |
|---|---|---|
| 游戏 | 整体退出，让平台重启容器 | 没有它就没有服务 |
| nginx | 整体退出 | 同一个理由 |
| **sidecar** | **只记日志，继续跑** | nginx 的 fallback 还能供素材；为一个只影响「素材选哪条路」的进程去重启整个容器，会把游戏一起停掉——拿小故障换大故障 |

## 分流策略：静态顺序 + 客户端兜底

`order` 是**静态顺序**，不是实时测速。容器在 ModelScope 机房，玩家在全国各地，容器量出来的
链路速度不代表玩家的。真正按玩家网络选最快是客户端 `pick.js` 的事——两者分工，而不是让
服务端假装自己知道。

客户端可以用 `?sp_source=<id>` 覆盖顺序（`id` 取自 `sources.json` 的 `sources[].id`）。

## 例外表

数据集不是逐字节完整的：平台的**内容审核会拒收个别文件**（实测提交被平台 revert：
`assets/skins/char_340_shwaz_snow_1/illustration.png`）。这类路径必须点名改道，否则玩家
拿到 404。`sources.json` 的 `exceptions` 就是这张表。Stardust 的 `MATERIAL-SOURCES.md` 里
有**同一个文件的同一条例外**，说明这是会复发的类型——**新增镜像后要核对覆盖率**。

## 游戏进程内的同款跳转（平台不一定执行我们的 CMD）

2026-10-11 实测：创空间按提交重建了镜像（`LastDeployConfig.ImageId = independent-service:…-<commit>-…`），
容器在跑游戏，但 nginx **不在链路上**——`/assets` 请求直接落到游戏进程的 404。这层 nginx 能不能
生效取决于平台怎么跑容器，跳转不该押在它上面。

所以 `server/http/asset-jump.js` 在**游戏进程内**做同一件事：`static.js` 对**本机不存在**的
`/assets|fonts` 文件回 302（本地优先——有文件仍走文件）。判定与 sidecar 共用
`edge-sidecar.mjs` 的纯函数与同一份 `sources.json`（白名单 / 路径校验 / 例外表 / `?sp_source`），
**没有第二份实现**；配置读不到就把自己关掉（只记日志），不会把游戏拖下水。
环境变量：`SP_EDGE_SOURCES` 换配置、`SP_ASSET_JUMP=0` 直接关闭。
两处先到先得：nginx 在线时它先答，nginx 缺席时游戏进程兜住。

## 文件

| 文件 | 角色 |
|---|---|
| `sources.json` | 源表与例外表（**唯一的真源**） |
| `edge-sidecar.mjs` | 决策：路径校验、选源、302、CORS、方法限制 |
| `nginx.conf` | 分流 + 后端故障兜底（不含任何 Lua） |
| `render-nginx.mjs` | 构建期从 `sources.json` 渲染 `sources-nginx.conf`（定义兜底基址） |
| `entrypoint.sh` | 三个进程的启动顺序与监督 |

`render-nginx.mjs` 的原因：nginx 里有一个地方必须自己知道主源基址（fallback），而手写第二份
会在换 release pin 时与 sidecar 漂移。nginx 没有变量赋值指令，所以常量用 `map` 表达。

## 测试

```sh
node --test deploy/stardust/ms-edge/test/edge-sidecar.test.mjs
```

直接测 `edge-sidecar.mjs` 的决策函数（无 socket、无时钟）。覆盖：分流/顺序/强制源/例外改道/
查询串逐字节保留（含「以 sp_source 结尾但不是它的键」）/路径穿越与畸形路径拒绝/方法限制/
配置校验（非 https、`..`、未知例外目标、无可用源）/以及 shipped `sources.json` 的形状。

nginx 那侧有**两道同样内容的闸门**：构建期 `nginx -t`（坏了就让构建失败，旧镜像继续服务），
运行期 `entrypoint.sh` 里再判一次（过不了就整体退回「游戏直接占 7860」）。
