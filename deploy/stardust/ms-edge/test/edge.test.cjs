// Runs the real edge.lua against a mocked `ngx`, in fengari (a Lua VM on Node).
// The point is to exercise the shipped file, not a copy of its logic.
//
// Run:  npm install fengari@0.1.5 && node test/edge.test.cjs
// fengari is deliberately NOT a dependency of the app: this container ships nginx's own
// LuaJIT at runtime, and the VM here only exists so the decision logic can be tested on a
// machine that has no nginx at all. Beware: fengari is Lua 5.3, the runtime is 5.1 (LuaJIT)
// -- everything this file uses is common to both, but do not reach for 5.2+ syntax here.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const path = require('path');
const HERE = path.join(__dirname, '..');
const EDGE = path.join(HERE, 'edge.lua');
const SOURCES = path.join(HERE, 'sources.json');
const CONFIG = fs.readFileSync(SOURCES, 'utf8');
const CODE = fs.readFileSync(EDGE, 'utf8');

function jsonToLua(L, v) {
  if (v === null || v === undefined) return lua.lua_pushnil(L);
  if (typeof v === 'number') return lua.lua_pushnumber(L, v);
  if (typeof v === 'boolean') return lua.lua_pushboolean(L, v);
  if (typeof v === 'string') return lua.lua_pushstring(L, to_luastring(v));
  if (Array.isArray(v)) {
    lua.lua_newtable(L);
    v.forEach((item, i) => { jsonToLua(L, item); lua.lua_rawseti(L, -2, i + 1); });
    return;
  }
  lua.lua_newtable(L);
  for (const [k, val] of Object.entries(v)) {
    jsonToLua(L, val);
    lua.lua_setfield(L, -2, to_luastring(k));
  }
}

function setField(L, key, pushFn) { pushFn(); lua.lua_setfield(L, -2, to_luastring(key)); }

// Returns {action:'redirect'|'exit'|'fallthrough', url?, code?}
function run(uri, { args = null, method = 'GET' } = {}) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  // package.loaded["cjson.safe"] = { decode = <our JSON.parse bridge> }
  lua.lua_getglobal(L, to_luastring('package'));
  lua.lua_getfield(L, -1, to_luastring('loaded'));
  lua.lua_pushstring(L, to_luastring('cjson.safe'));
  lua.lua_newtable(L);
  setField(L, 'decode', () => lua.lua_pushjsfunction(L, (L2) => {
    const s = lua.lua_tojsstring(L2, 1);
    try { jsonToLua(L2, JSON.parse(s)); return 1; } catch { lua.lua_pushnil(L2); return 1; }
  }));
  // stack: [package, loaded, "cjson.safe", tbl] -> settable(-3) assigns loaded["cjson.safe"] = tbl
  lua.lua_settable(L, -3);
  lua.lua_pop(L, 1);

  const outcome = { action: 'fallthrough' };
  lua.lua_newtable(L); // ngx

  setField(L, 'var', () => {
    lua.lua_newtable(L);
    setField(L, 'uri', () => lua.lua_pushstring(L, to_luastring(uri)));
    setField(L, 'is_args', () => lua.lua_pushstring(L, to_luastring(args ? '?' : '')));
    setField(L, 'args', () => args ? lua.lua_pushstring(L, to_luastring(args)) : lua.lua_pushnil(L));
    const q = args ? /(?:^|&)sp_source=([^&]*)/.exec(args) : null;
    setField(L, 'arg_sp_source', () => q ? lua.lua_pushstring(L, to_luastring(q[1])) : lua.lua_pushnil(L));
  });
  setField(L, 'header', () => lua.lua_newtable(L));
  setField(L, 'req', () => {
    lua.lua_newtable(L);
    setField(L, 'get_method', () => lua.lua_pushjsfunction(L, (L2) => {
      lua.lua_pushstring(L2, to_luastring(method)); return 1;
    }));
  });
  setField(L, 'log', () => lua.lua_pushjsfunction(L, () => 0));
  lua.lua_pushnumber(L, 8); lua.lua_setfield(L, -2, to_luastring('ERR'));
  // exit/redirect record the outcome and return zero values: the Lua code always calls them
  // as `return ngx.exit(...)`, so the chunk ends there exactly as it would inside nginx.
  setField(L, 'exit', () => lua.lua_pushjsfunction(L, (L2) => {
    outcome.action = 'exit'; outcome.code = lua.lua_tonumber(L2, 1); return 0;
  }));
  setField(L, 'redirect', () => lua.lua_pushjsfunction(L, (L2) => {
    outcome.action = 'redirect';
    outcome.url = lua.lua_tojsstring(L2, 1);
    outcome.code = lua.lua_tonumber(L2, 2);
    return 0;
  }));
  lua.lua_setglobal(L, 'ngx');

  // io.open: only sources.json is ever opened
  lua.lua_getglobal(L, to_luastring('io'));
  setField(L, 'open', () => lua.lua_pushjsfunction(L, (L2) => {
    const p = lua.lua_tojsstring(L2, 1);
    if (p !== '/app/deploy/stardust/ms-edge/sources.json') { lua.lua_pushnil(L2); return 1; }
    lua.lua_newtable(L2);
    setField(L, 'read', () => lua.lua_pushjsfunction(L, () => { lua.lua_pushstring(L, to_luastring(CONFIG)); return 1; }));
    setField(L, 'close', () => lua.lua_pushjsfunction(L, () => 0));
    return 1;
  }));
  lua.lua_pop(L, 1);

  const st = lauxlib.luaL_loadbuffer(L, to_luastring(CODE), null, to_luastring('@edge.lua'));
  if (st !== lua.LUA_OK) {
    return { action: 'LOAD_ERROR', err: lua.lua_tojsstring(L, -1) };
  }
  const call = lua.lua_pcall(L, 0, 0, 0);
  if (call !== lua.LUA_OK) {
    return { action: 'RUNTIME_ERROR', err: lua.lua_tojsstring(L, -1) };
  }
  return outcome;
}

const MS = 'https://modelscope.cn/datasets/jingjiangze/Stronghold-Protocol-Assets/resolve/master/releases/v1-trial';
const R2 = 'https://weishucdn.jiangjiangze.icu';
const REJECTED = '/assets/skins/char_340_shwaz_snow_1/illustration.png';

const cases = [
  ['plain asset -> modelscope', '/assets/char/avatar/char_003_kalts.png', {}, 'redirect', MS + '/assets/char/avatar/char_003_kalts.png'],
  ['font -> modelscope', '/fonts/bender-regular.woff2', {}, 'redirect', MS + '/fonts/bender-regular.woff2'],
  ['?v= is preserved', '/assets/char/avatar/x.png', { args: 'v=abc123' }, 'redirect', MS + '/assets/char/avatar/x.png?v=abc123'],
  ['?sp_source=r2 forces r2', '/assets/char/avatar/x.png', { args: 'sp_source=r2' }, 'redirect', R2 + '/assets/char/avatar/x.png'],
  ['sp_source stripped, v kept', '/assets/char/avatar/x.png', { args: 'sp_source=r2&v=abc' }, 'redirect', R2 + '/assets/char/avatar/x.png?v=abc'],
  ['unknown sp_source -> 503', '/assets/char/avatar/x.png', { args: 'sp_source=bogus' }, 'exit', 503],
  ['exception path -> r2', REJECTED, {}, 'redirect', R2 + REJECTED],
  ['exception ignores order', REJECTED, { args: 'v=9' }, 'redirect', R2 + REJECTED + '?v=9'],
  ['/data/** not ours', '/data/assets.json', {}, 'fallthrough'],
  ['/js/** not ours', '/js/main.js', {}, 'fallthrough'],
  ['non-asset ext falls through', '/assets/foo.js', {}, 'fallthrough'],
  ['dotdot rejected', '/assets/../../etc/passwd', {}, 'fallthrough'],
  ['trailing-dot segment rejected', '/assets/foo./bar.png', {}, 'fallthrough'],
  ['double slash rejected', '/assets//x.png', {}, 'fallthrough'],
  ['control char rejected', '/assets/x\u0001y.png', {}, 'fallthrough'],
  ['OPTIONS -> 204', '/assets/x.png', { method: 'OPTIONS' }, 'exit', 204],
  ['POST -> 405', '/assets/x.png', { method: 'POST' }, 'exit', 405],
  ['empty-ish uri falls through', '/', {}, 'fallthrough'],
];

let pass = 0, fail = 0;
for (const [name, uri, opts, wantAction, wantVal] of cases) {
  const got = run(uri, opts);
  const actionOk = got.action === wantAction;
  const valOk = wantAction === 'redirect' ? got.url === wantVal
    : wantAction === 'exit' ? got.code === wantVal : true;
  if (actionOk && valOk) { pass++; console.log(`  PASS  ${name}`); }
  else {
    fail++;
    console.log(`  FAIL  ${name}\n         want ${wantAction} ${wantVal ?? ''}\n         got  ${got.action} ${got.url ?? got.code ?? got.err ?? ''}`);
  }
}
console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
