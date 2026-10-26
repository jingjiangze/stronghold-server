# 引擎面：包的 `server.modules`（0.3.1 基座 + 管理器）

> 本文描述**已落地**的服务端模块面（DESIGN §28.14 / MOD-SURFACE B 层）。它是「mod 管理器增加引擎面」的
> 第一层：包不再只能改数据与界面，还能挂启动/停机钩子、给 `/healthz` 加字段、包装 `MatchClass`、
> 注册只读动态端点——全部通过声明，不改引擎任何文件。

## 1. 声明位置（plugin.json）

```json
{
  "id": "demo",
  "server": {
    "modules": [
      {
        "id": "demo-core",
        "entry": "server/core.mjs",
        "uses": ["matchClass", "healthz", "route"],
        "write": true,
        "channels": ["watch"]
      }
    ]
  }
}
```

也接受命名空间写法 `engine.server.modules`（与 `entry.server`（trusted 插件入口）不冲突）。
`uses` 的取值是闭枚举：

| use | 宿主方法 | 语义 |
|---|---|---|
| `boot` | `host.onBoot(fn)` | 服务 listen 之后跑一次，收到**冻结只读**配置快照 `{port,host,stateDir,env}`（env 只含 4 个 `SP_*` 白名单变量） |
| `shutdown` | `host.onShutdown(fn)` | 停机时跑一次（失败只记日志，不阻塞） |
| `healthz` | `host.healthz(fn)` | 返回扁平标量对象，合并进 `/healthz` 的 `modHealth["<包id>"]`（≤12 字段 / ≤2048 字符） |
| `matchClass` | `host.matchClass(fn)` | `fn(Base) => Subclass`，**进程级**层层包装对局类；要求包声明 `combat: true`；房间门控责任在包侧（`this.mods.packs`） |
| `metrics` | `host.metrics()` | 只读指标快照（uptime/rss/heap/elu/事件循环延迟；`server/hostMetrics.js`） |
| `route` | `host.route(path, fn, {cache})` | 只读动态端点，路径强制 `/mod/<包id>/…`，GET/HEAD，返回 JSON，≤64 KiB |

`write: true` 才拿到 `host.io`：被限定在 `<SP_STATE_DIR|repo/var>/mod/<包id>/` 里（`write/append/read/exists/remove/list`）。
`channels` 声明本模块**收得到**的包通道（`pack.msg`），与客户端面板的 `messages` 同名。

## 2. 装载管线

```
plugin.json (server.modules)
  → server/modHostAdapter.js   （形状判据 + 只读清单，不 import 包内代码）
  → server/modModules.js       （源码静态扫描 → 动态 import → registerServer(host)）
  → server/index.js            （boot/shutdown / matchClass 包装 / healthz / routes）
  → server/http/routes.js      （/healthz 合并 + 动态端点分发）
  → server/lobby.js            （pack.msg：先问 Match.handlePackMsg，未消费则同房转发）
```

关键性质：

* **装载失败不抛**：`loadServerModules` 返回 `errors[]`，`server/index.js` 逐条 `log.warn` 并跳过该条模块声明；
  一个坏包不拖垮启动。
* **import 之前先扫源码**：`serverModuleSourceIssues`（`shared/kitAuthoring.js` 的
  `SERVER_CODE_FORBIDDEN_GLOBALS`）拒绝 `process` / `globalThis` / `require` / `eval` / `new Function`；
  要读进程指标走 `host.metrics`，要落盘走 `host.io`。
* **模块 URL 带包摘要**：`import(url?v=<hash>)` —— 包换版即新 URL，不会拿回旧模块。
* **MatchClass 包装顺序按包 id**，任一层抛错/返回非函数只记日志并跳过。
* **动态端点**：`/mod/<包id>/…` 前缀由 `server/http/routeMount.js` 判死；两个包同路径按「包 id 小者赢 + warn」。
* **pack.msg**：C2S 形状在 `shared/protocol.js`（`pack` 插件 id、`channel` 正则、`data` ≤4096 B）；
  `lobby.packMsg` 先投给 `Match.handlePackMsg`（返回 `true` = 消费，不广播），否则转发给同房已连接席位与旁观者
  （`from`/`seat` 由服务端从会话解析，载荷里写的不作数）。
* **干净安装零负担**：没有任何包声明时，`modMount` 的 healthz 返回 `{}`、routes 返回空 Map、包装器列表为空，
  `/healthz` 与请求路径的行为逐字节不变。

## 3. 与既有面的关系

* `code`（无损插件，`contentSet.js` 的多代码根）：`code.match` 是**整包替换对局**；`server.modules.matchClass`
  是**包装对局类**。两者可共存，`code.match` 优先（替换基类后仍可被包装）。

* `code.lobby`（2026-10-23，lobby 级插件面）：指向插件里的一个 JS 模块，导出 `setup(api)`，由
  `server/plugins/lobbyModules.js` 在**启动时**挂进 `Lobby`（只有 `class: "trusted"` 且 `status: "loaded"` 的插件会挂）。
  `api` 提供：`protocol(spec)` 新增 C2S 键（不覆盖引擎已有键）、`on(type, fn)` 处理一条 C2S 消息
  （`(session, msg, ctx, lobby)`，与 `handleMessage` 同形）、`roomInit(room)` 房间默认字段、
  `roomState(room)` 平铺进 `room.state`、`matchOptions(room)` 合并进 Match opts、
  `onRoom(event, fn)`（`created` / `joined` / `left` / `disposed` / `resync` / `started`）。
  钩子抛错只记日志；实例见 `plugins/room-chat/`（同盟通讯 + 随机地图开关）。
* `script` / `trusted` 插件：那两条是**插件系统**的沙箱/信任面（SES、lock pin、玩家同意），与本面并行；
  本面面向的是**包（mod）**的服务端逻辑，按 `combat: true` 与房间包集合门控。
* `routes`（顶层静态路由，`pack.json.routes`）尚未在管理器中启用；本面提供的是**动态**端点（`host.route`）。

## 4. 尚未启用（后续面）

| 面 | 状态 | 落点 |
|---|---|---|
| `lane`（模块 WebSocket 通道） | 代码已随 `server/modLanes.js` 落盘，但 `uses` 闭枚举未含 | `shared/modSurface.js` + `attachWebSocket` 的 lane 表 |
| `client.screens` / `screen.room.aside` / `room.mods` | 未做 | `public/js/ui/extensions.js` + 宿主容器 |
| `callBudget` / `matchKinds` | 未做（`modModules` 已透传 `pack.matchKinds` 数据） | manifest 字段 + 对局分派 |
| `docs/MOD-SURFACE.md` 守卫表 | 未做 | 新增文档 + `test/modSurface.test.js` |

## 5. 相关文件

| 文件 | 作用 |
|---|---|
| `server/modModules.js` | 装载器 + 宿主对象 + `/healthz`/`routes`/`matchClassWrappers` 装配 |
| `server/modHostAdapter.js` | `plugin.json` → `{id,dir,hash,server:{modules},matchKinds}`（只读清单） |
| `server/hostMetrics.js` | `uses:["metrics"]` 的只读指标快照（惰性启用） |
| `server/modLanes.js` | `lane` 面的路径认领表（预留，未启用） |
| `shared/modSurface.js` | `SERVER_MODULE_USES` 闭枚举 + 通道名正则（运行时真源） |
| `server/index.js` | 装配：包装 `MatchClass`、`modHealth`、动态路由、`boot`/`shutdown` |
| `server/http/routes.js` | `/healthz` 合并 `modHealth`；动态端点分发（`runDynamicRoute`） |
| `server/lobby.js` | `pack.msg` 投递（`Match.handlePackMsg` → 同房转发） |
| `shared/protocol.js` | `pack.msg` C2S/S2C 形状 + `PACK_MSG_LIMITS` |
