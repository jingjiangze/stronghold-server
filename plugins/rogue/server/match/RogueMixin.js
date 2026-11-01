// plugins/rogue/server/match/RogueMixin.js — 肉鸽玩法的对局类叠加层（2026-11-01，业主「肉鸽做成插件」）。
//
// 挂载方式：plugin.json 的 `code.matchMixin` → `server/plugins/contentSet.js` 收进内容集的
// `code.matchMixins` → 对局宿主 `server/match/host/entry.js` 调 `applyMatchMixins()`，
// 把这些方法按插件加载顺序拷到「种子 Match（mota 的 Match）」那个类的原型上。
//
// 约束（管理器侧强制）：
//   · 只加方法，不碰构造函数 —— 叠加层拿不到 super()，需要初始化就写成惰性（第一次调用时建）。
//   · 方法名不许与种子 Match 重名，重名直接抛错（`a name defined twice is an error`）。
//   · 因此与 mota 的接口必须走「约定名 + typeof 守卫」：mota 的 `phases.js` / `views.js` 里已经在调
//     `this.rogueEventOffer()` / `this.rogueRoundAffix()` / `this.rogueEmergencyRound()` 前先判 typeof，
//     本插件不在时它们自动跳过，而不是崩。
//
// 本文件目前是 S2 骨架：先证明「管理器真的把插件方法叠上了」，肉鸽的七个函数在 S3 迁入。

export class Mixin {
  /** 探针：宿主日志与真机自检都用它确认叠加层到位（不参与玩法）。 */
  roguePluginInfo() {
    return { id: 'rogue', mixin: true, round: this.round ?? null, mode: this.mode ?? null };
  }
}
