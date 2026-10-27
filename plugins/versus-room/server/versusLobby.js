// plugins/mota/server/versusLobby.js — 对抗房（2V2/4V4）的**房间层**逻辑，纯插件实现。
//
// 挂载面：manifest 2 的 `code.lobby`（server/plugins/lobbyModules.js）。它只做三件核心不认识的事：
//   1. roomInit：给 versus 房补一个默认分边人数（2 = 4 席，4 = 8 席）；
//   2. matchOptions：把分边人数交给对局（plugins/mota/server/match 的 teamOfSeat 按它分边）；
//   3. beforeStart：开局前按分边人数收窄座位表、补满 AI 席 —— 缺这一步就是「开局只有 1 个真人、没有对手」。
//
// 座位表在核心里固定是 MAX_SEATS 长、空位为 null；这里只把前 want 个位置填上，超出的位置保持 null 并在有人占位时拒绝开局，
// 因此不需要核心认识「对抗房座位上限」。

const TEAM_SIZES = new Set([2, 4]);

/** 分边人数的规范值：只认 2 / 4，其余回落 2。 */
const teamSizeOf = (room) => (TEAM_SIZES.has(room?.teamSize) ? room.teamSize : 2);

/**
 * @param {{ roomInit: Function, matchOptions: Function, beforeStart: Function }} api
 */
export function setup(api) {
  api.roomInit((room) => {
    if (room && room.mode === 'versus' && !TEAM_SIZES.has(room.teamSize)) room.teamSize = 2;
  });

  // 规则档（业主 2026-10-26）：「赏金」= 当前线上那套（官方波次 + 替换份额）；「对抗」= 完全由玩家控制出怪。
  // 走 room.variant（客户端 room.create 带过来），不进 modeId —— 避免动 data/config.json 的模式表。
  const RULES = new Set(['bounty', 'confront']);
  const ruleOf = (room) => (RULES.has(room && room.variant) ? room.variant : 'bounty');
  api.matchOptions((room) => {
    if (!room || room.mode !== 'versus') return null;
    // 只走 versusRule（经 MatchProxy 的 wireOptions 白名单转发给子进程）。
    // 不走 modeId 前缀：实测 mode_confront_* 会让 GameData 找不到该模式，波次价值塌成 0。
    return { teamSize: teamSizeOf(room), versusRule: ruleOf(room), versusAlt: room.versusAlt !== false };
  });

  api.beforeStart((room, session, lobby) => {
    if (!room || room.mode !== 'versus') return null;
    if (!lobby || typeof lobby.addBot !== 'function') return { error: 'INTERNAL', detail: 'lobby.addBot is not available' };
    const want = teamSizeOf(room) * 2;
    // 分边之外的座位上有人：不静默踢人，直接把话说明白（房主可以先把人移走）
    if (room.seats.slice(want).some(Boolean)) {
      return { error: 'BAD_MSG', detail: `seats beyond the team size are taken (2V2 keeps 4, 4V4 keeps 8)` };
    }
    for (let i = 0; i < want; i++) {
      if (room.seats[i]) continue;
      const added = lobby.addBot(session);
      if (added && added.error) return added;
    }
    return null;
  });
}
