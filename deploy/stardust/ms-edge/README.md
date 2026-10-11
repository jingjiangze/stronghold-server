# 创空间边缘层（ms-edge）

这个目录让容器在素材请求上**只做 302**，字节从不经过容器。

```
玩家 ──GET /assets/xxx──► nginx@7860 ──302──► 源（数据集 / R2）
                              │
                              └─ 其余一切 ──► 游戏本体 @127.0.0.1:3000
```

## 为什么是 nginx 而不是 OpenResty

OpenResty 官方不提供 alpine 包，也没有 Windows 构建。`nginx-mod-http-lua` 就是同一套
`lua-nginx-module`（OpenResty = nginx + 该模块 + LuaJIT），所以这里直接装等价组件，
不引一个装不上的依赖。

## 为什么 nginx 占 7860

创空间把对外端口写死成 7860（`deploy_schema.json` 的 `port.const`），容器里没有第二个
公网口。所以 nginx 占住 7860，游戏退到内部 3000，按路径分流。反过来（游戏占 7860、
nginx 另开端口）在平台上没有公网口可用。

关停语义：**任一侧退出就整体退出**，让平台重启容器——而不是留一个「前端活着、后端没了」
的半死状态在那儿骗人（`entrypoint.sh`）。

## 分流策略：静态顺序 + 客户端兜底

`order` 是**静态顺序**，不是实时测速。容器在 ModelScope 机房，玩家在全国各地，容器量出来的
链路速度不代表玩家的。真正按玩家网络选最快是客户端 `pick.js` 的事——两者分工，而不是让
服务端假装自己知道。

客户端可以用 `?sp_source=<id>` 覆盖顺序（`id` 取自 `sources.json` 的 `sources[].id`）。

## 例外表

数据集不是逐字节完整的：平台的**内容审核会拒收个别文件**（实测提交被平台 revert：
`assets/skins/char_340_shwaz_snow_1/illustration.png`）。这类路径必须点名改道，否则玩家
拿到 404。`sources.json` 的 `exceptions` 就是这张表。Stardust 的 `material-lb` 有同一张表，
说明这是会复发的类型，不是一次性事故——**新增镜像后要核对覆盖率**。

## 测试

决策逻辑跑在 fengari（Node 上的 Lua VM）里，直接测的是这个目录下的 `edge.lua` 本体：

```sh
npm install fengari@0.1.5
node test/edge.test.cjs
```

`fengari` 刻意不是应用依赖：容器运行时用的是 nginx 自带的 LuaJIT，这个 VM 只是为了
在没有 nginx 的机器上也能验证分支。注意 fengari 是 Lua 5.3、运行时是 5.1（LuaJIT），
本文件用到的语法两者都有，但别在里面用 5.2+ 的东西。

覆盖：分流/顺序/强制源/例外改道/查询串处理（`sp_source` 剥离、`v` 保留）/拒绝 `..`、双斜杠、
控制字符/方法限制/非素材路径放行。
