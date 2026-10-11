-- 素材请求的分流决策：只回答「这个请求该 302 到哪个源」，不代理一个字节。
--
-- 路径白名单与校验规则与 Stardust 的 material-lb/access.lua 同源（那是已在生产验证过的
-- 实现），但目标表更简单：这里没有本地库存，只有一张「源 → 基址」表。
--
-- 不猜「哪个源对当前玩家最快」：容器在 ModelScope 机房，玩家在全国各地，容器量出来的
-- 链路速度不代表玩家的。所以这里是静态顺序（可被客户端用 ?sp_source=<id> 覆盖），
-- 真正按玩家网络测速选择是客户端 pick.js 的事 —— 两者分工而不是互相假装。

local cjson = require "cjson.safe"

local CONFIG = "/app/deploy/stardust/ms-edge/sources.json"
local CACHE_KEY = "sp_edge_sources_v1"
local MAX_TARGET = 8192

-- 只分流确实可重定向的扩展名。清单/代码（js/css/json）留在游戏本体，因为它们可能
-- 与本地构建产物不同版本。
local EXT = {
    png = true, jpg = true, jpeg = true, webp = true, gif = true, svg = true,
    atlas = true, skel = true, obj = true, mtl = true,
    mp3 = true, m4a = true, aac = true, ogg = true, oga = true, opus = true, wav = true,
    ttf = true, otf = true, woff = true, woff2 = true,
}

-- 只允许 /assets/** 与 /fonts/**；其余（/data、/vendor、/js …）原样交给游戏本体。
local function splittable(path)
    return path:sub(1, 8) == "/assets/" or path:sub(1, 7) == "/fonts/"
end

-- 每段必须是 [A-Za-z0-9_[-] 开头、之后允许 . —— 于是 ".."、"尾点段"、控制字符全部被拒。
local function valid_path(path)
    if #path < 2 or #path > 2048 or path:find("//", 1, true) then return false end
    for seg in path:gmatch("[^/]+") do
        if not seg:match("^[A-Za-z0-9_%[%]-][A-Za-z0-9_.%[%]-]*$") or seg:sub(-1) == "." then
            return false
        end
    end
    return true
end

local function load_sources()
    local cached = package.loaded[CACHE_KEY]
    if cached ~= nil then return cached end

    local file = io.open(CONFIG, "rb")
    if not file then
        ngx.log(ngx.ERR, "sp-edge: cannot open ", CONFIG)
        package.loaded[CACHE_KEY] = false
        return false
    end
    local raw = file:read("*a")
    file:close()

    local doc = cjson.decode(raw)
    if type(doc) ~= "table" or type(doc.sources) ~= "table" or type(doc.order) ~= "table" then
        ngx.log(ngx.ERR, "sp-edge: sources.json shape invalid")
        package.loaded[CACHE_KEY] = false
        return false
    end

    local by_id = {}
    for _, src in ipairs(doc.sources) do
        -- 基址必须是 https、且不含 .. —— 那张表是构建期产物，这里再钉一次，
        -- 免得一个手改的配置文件把容器变成开放重定向。
        if type(src.id) == "string" and type(src.base) == "string"
            and src.base:sub(1, 8) == "https://" and not src.base:find("..", 1, true) then
            by_id[src.id] = src.base
        end
    end

    -- 个别路径任何一个源都供不了（平台的审核会把它们挡下），必须点名改道。
    -- 只接受指向已知源的 id：这张表也是构建期产物，但不能让一个手改的例外变成任意 URL。
    local exceptions = {}
    if type(doc.exceptions) == "table" then
        for path, id in pairs(doc.exceptions) do
            if type(path) == "string" and type(id) == "string" and by_id[id] then
                exceptions[path] = by_id[id]
            end
        end
    end

    local loaded = { by_id = by_id, order = doc.order, exceptions = exceptions }
    package.loaded[CACHE_KEY] = loaded
    return loaded
end

-- id 为 nil 时：先看这张路径有没有点名改道，再按 order 取第一个可用的源。
local function pick(id, path)
    local cfg = load_sources()
    if not cfg then return nil end
    if id then
        return cfg.by_id[id]
    end
    local forced_by_path = cfg.exceptions[path]
    if forced_by_path then return forced_by_path end
    for _, want in ipairs(cfg.order) do
        if cfg.by_id[want] then return cfg.by_id[want] end
    end
    return nil
end

local method = ngx.req.get_method()
if method == "OPTIONS" then
    ngx.header["Access-Control-Allow-Origin"] = "*"
    ngx.header["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS"
    ngx.header["Access-Control-Max-Age"] = "86400"
    ngx.header["Cache-Control"] = "no-store"
    return ngx.exit(204)
end
if method ~= "GET" and method ~= "HEAD" then
    return ngx.exit(405)
end

local path = ngx.var.uri or ""
if not splittable(path) or not valid_path(path) then
    return -- 不归这一层管，交给游戏本体
end

local ext = path:match("%.([A-Za-z0-9]+)$")
if not ext or not EXT[ext:lower()] then
    return
end

local forced = ngx.var.arg_sp_source
local base = pick(forced, path)
if not base then
    -- 配置缺失时明确失败：静默 404 会让「边缘层有没有在工作」变成一个只能靠猜的问题。
    ngx.log(ngx.ERR, "sp-edge: no usable source for ", path)
    return ngx.exit(503)
end

local target = base .. path
if ngx.var.is_args and ngx.var.args then
    -- sp_source 是本层的控制参数，不能带下去；其余查询参数原样转发。
    -- 分两步删而不是一个模式搞定：Lua 的模式没有 `|` 交替，`(^|&)` 会去匹配字面量。
    -- 先删开头的、再删 & 后面的，否则 `xsp_source=1` 这种参数会被误伤。
    local rest = (ngx.var.args:gsub("^sp_source=[^&]*", ""))
    rest = rest:gsub("&sp_source=[^&]*", "")
    rest = rest:gsub("^&", "")
    if rest ~= "" then target = target .. "?" .. rest end
end
if #target > MAX_TARGET then
    return ngx.exit(414)
end

ngx.header["Access-Control-Allow-Origin"] = "*"
ngx.header["Cache-Control"] = "public, max-age=300"
ngx.header["X-SP-Edge"] = forced and ("forced:" .. forced) or "order"
return ngx.redirect(target, 302)
