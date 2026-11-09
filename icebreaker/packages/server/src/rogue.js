// 集成战略（肉鸽）的运行态：一次 run 的节点图、资源、藏品，以及每个战斗节点开出的普通对局。
// run 的规则在 @icebreaker/mode-rogue（纯函数），这里只做会话与对局接线：谁在哪个 run、选点、开赛、战后回写。
// 与 rooms.js 并列：肉鸽不走「项目确认/协调/编队」那套房间阶段，直接在地图页里推进。
import { createHash } from 'node:crypto';
import { createRun, columnView, chooseNode, applyBattle, rewardChoices, takeReward, resolveNode, advance, runView, topicData, topicList, battleFromRun, buyOffer } from '@icebreaker/mode-rogue';

/** 一个 run 最多几名玩家（协作：两人共守一张地图）。 */
export const RUN_SEATS = 2;
/** 单场战斗的墙钟上限：官方关卡有出怪/时限，引擎这边遇到卡住的单位没有超时，超时按「守住了」结算。 */
export const BATTLE_LIMIT_MS = Number(process.env['AUE_ROGUE_BATTLE_LIMIT_MS']) || 240_000;

/**
 * @param {{ send: (id: number, msg: Record<string, unknown>) => void, startMatch: (match: any, keys: string[]) => Promise<string> | string,
 *   now: () => number, random: () => number, log?: (line: string) => void }} o
 */
export function createRogue(o) {
  /** @type {Map<string, any>} */
  const runs = new Map();
  /** @type {Map<string, string>} */
  const byKey = new Map();
  /** @type {Map<string, string>} */
  const byMatch = new Map();
  /** 这一局专用的关卡变体（敌方倍率/初始费用不同）：id → 文档。 */
  const variants = new Map();

  const code = () => { for (;;) { const c = String(Math.floor(o.random() * 900000) + 100000); if (!runs.has(c)) return c; } };
  const runOf = (id) => { const r = [...runs.values()].find((x) => x.members.some((m) => m.id === id)); return r ?? null; };

  /** 给一名玩家的视图：run + 当前列 + 奖励候选 + 阶段。 */
  function view(r, forId) {
    const col = r.run.status === 'running' ? columnView(r.run) : null;
    const choices = r.phase === 'reward' ? (r.choices ?? rewardChoices(r.run)) : null;
    if (choices) r.choices = choices;
    return {
      t: 'rogue', code: r.code, you: r.members.findIndex((m) => m.id === forId), phase: r.phase,
      members: r.members.map((m) => m.name), host: r.members.findIndex((m) => m.id === r.host),
      column: col, run: runView(r.run), choices: choices ? choices.map((x) => ({ id: x.id, name: x.name, usage: x.usage, rarity: x.rarity, icon: x.icon })) : null,
      match: r.phase === 'battle' ? { id: r.matchId, seat: r.seats.length > 1 ? r.members.findIndex((m) => m.id === forId) : 0 } : null,
      last: r.last ?? null,
      shop: r.phase === 'shop' ? r.run.shop ?? [] : null,
      error: null,
    };
  }
  const push = (r) => r.members.forEach((m) => o.send(m.id, view(r, m.id)));

  /** 建房：主题/难度/分队 + 这名玩家的阵容（引擎的 decks 形状）。 */
  async function create(id, key, name, m) {
    if (runOf(id)) return o.send(id, { t: 'error', msg: '已在一次探索里' });
    let topic;
    try { topic = topicData(m.topic); } catch { return o.send(id, { t: 'error', msg: '没有这个主题' }); }
    const squad = topic.squads.some((s) => s.id === m.squad) ? m.squad : undefined;
    const run = createRun({ topicId: m.topic, seed: Math.floor(o.random() * 0x7fffffff), squadId: squad, grade: m.grade | 0 });
    const r = { code: code(), members: [{ id, key, name }], host: id, run, phase: 'map', matchId: null, seats: [m.deck], choices: null };
    runs.set(r.code, r);
    byKey.set(key, r.code);
    o.log?.(`rogue ${r.code}: ${m.topic} by ${name}`);
    push(r);
  }

  /** 加入一次探索（同一 run 的第二名玩家）。 */
  function join(id, key, name, m) {
    const r = runs.get(String(m.code ?? '').trim());
    if (!r) return o.send(id, { t: 'error', msg: '没有这个探索编号' });
    if (r.members.length >= RUN_SEATS) return o.send(id, { t: 'error', msg: '这次探索已经满员' });
    if (runOf(id)) return o.send(id, { t: 'error', msg: '已在一次探索里' });
    r.members.push({ id, key, name });
    r.seats.push(m.deck ?? null);
    byKey.set(key, r.code);
    push(r);
  }

  /** 断线：只标记离线，run 留着（页面可能只是去了对局页）。 */
  function disconnect(id) {
    const r = runOf(id);
    if (!r) return;
    const m = r.members.find((x) => x.id === id);
    if (m) m.id = -1;
  }

  function leave(id) {
    const r = runOf(id);
    if (!r) return;
    const gone = r.members.find((m) => m.id === id);
    if (gone) byKey.delete(gone.key);
    r.members = r.members.filter((m) => m.id !== id);
    if (!r.members.length) { runs.delete(r.code); return; }
    if (r.host === id) r.host = r.members[0].id;
    push(r);
  }

  /** 选一个节点：战斗节点立刻开局（对局 id 回给客户端），其余节点当场结算并推进一列。 */
  async function pick(id, m) {
    o.log?.(`rogue pick ${m.id} by ${id}`);
    const r = runOf(id);
    if (!r || r.phase !== 'map') return;
    if (r.run.status !== 'running') { push(r); return; }
    const what = chooseNode(r.run, String(m.id ?? ''));
    if (!what) return o.send(id, { t: 'error', msg: '这个节点现在选不了' });
    if (what.kind !== 'battle') {
      const res = resolveNode(r.run, what.node);
      if (res.kind === 'shop') {
        r.phase = 'shop';
        r.last = res.text ?? null;
        push(r);
        return;
      }
      r.run.column++;
      r.phase = r.run.status === 'lost' ? 'over' : 'map';
      r.last = res.text ?? null;
      push(r);
      return;
    }
    const decks = r.seats.map((d, i) => (Array.isArray(d) && d.length ? d : r.seats[0]));
    if (!Array.isArray(decks[0]) || !decks[0].length) return o.send(id, { t: 'error', msg: '没有可用的阵容' });
    const keys = r.members.map((x) => x.key);
    // 藏品/分队 → 战斗：属性走 seat runes，敌方倍率与初始费用走这一局的关卡变体
    const eff = battleFromRun(r.run);
    const level = o.variant?.(what.node.stage.level, eff.scale, eff.cost) ?? what.node.stage.level;
    const match = { level, difficulty: 'NORMAL', seed: Math.floor(o.random() * 0x7fffffff), decks, runes: decks.map(() => eff.runes) };
    try {
      r.matchId = await o.startMatch(match, keys);
      o.log?.(`rogue battle ${r.matchId} level ${match.level}`);
    } catch (e) {
      o.log?.(`rogue battle failed: ${/** @type {Error} */ (e).message}`);
      return o.send(id, { t: 'error', msg: `对局没能开始：${/** @type {Error} */ (e).message}` });
    }
    byMatch.set(r.matchId, r.code);
    // 超时保险：卡住的对局（有单位永远不消失）也要能回探索页
    const id0 = r.matchId;
    clearTimeout(r.limit);
    r.limit = setTimeout(() => { if (r.matchId === id0) o.forceEnd?.(id0); }, BATTLE_LIMIT_MS);
    r.phase = 'battle';
    r.node = what.node;
    push(r);
    r.members.forEach((x, seat) => o.send(x.id, { t: 'rogueStart', match: r.matchId, seat, back: 'rogue' }));
  }

  /** 在商店买一件。 */
  function buy(id, m) {
    const r = runOf(id);
    if (!r || r.phase !== 'shop') return;
    const got = buyOffer(r.run, String(m.id ?? ''));
    if (!got) return o.send(id, { t: 'error', msg: '买不起或已售出' });
    r.last = `买下「${got.name}」（-${got.price} 源石锭）`;
    push(r);
  }

  /** 离开商店：进下一列。 */
  function leaveShop(id) {
    const r = runOf(id);
    if (!r || r.phase !== 'shop') return;
    r.run.shop = [];
    r.run.column++;
    r.phase = r.run.status === 'lost' ? 'over' : 'map';
    push(r);
  }

  /** 领一个奖励（战斗胜利后 / 宝箱）。 */
  function reward(id, m) {
    o.log?.(`rogue reward ${m.id} by ${id}`);
    const r = runOf(id);
    if (!r || r.phase !== 'reward') return;
    const got = takeReward(r.run, String(m.id ?? ''));
    if (!got) return o.send(id, { t: 'error', msg: '没有这件藏品' });
    r.phase = 'map';
    r.choices = null;
    push(r);
  }

  /** 对局结束：回写这一节点。result 1 = 胜，其余（0 负 / -1 引擎失败）都算失败。 */
  function ended(matchId, result) {
    o.log?.(`rogue end ${matchId} result=${result}`);
    const c = byMatch.get(matchId);
    const r = c ? runs.get(c) : null;
    if (!r) return false;
    byMatch.delete(matchId);
    clearTimeout(r.limit);
    r.matchId = null;
    const res = applyBattle(r.run, result === 1);
    r.last = result === 1 ? '战斗胜利' : `战斗失败：失去 1 点生命（剩 ${r.run.hp}）`;
    r.phase = r.run.status === 'lost' ? 'over' : res.next === 'reward' ? 'reward' : 'map';
    r.choices = r.phase === 'reward' ? null : null;
    push(r);
    return true;
  }

  /** 给 main.js 的 onEnd 用：先按对局 id 找 run，再读结果。 */
  function endHandler(matchId, result) { return ended(matchId, result); }

  /** 页面重连（同一 key 的新连接）：把成员绑到新连接并推一次视图。 */
  function hello(id, key, name) {
    const c = byKey.get(key);
    const r = c ? runs.get(c) : null;
    if (!r) return false;
    const m = r.members.find((x) => x.key === key);
    if (!m) return false;
    m.id = id; m.name = name ?? m.name;
    push(r);
    return true;
  }

  /** 主题一览（选择页用）。 */
  const topics = () => topicList();

  /** 关卡变体的读取（http 的 /rogue/level 先问这里）。 */
  const levelOf = (lid) => variants.get(lid) ?? null;

  return { runs, byKey, topics, levelOf, variants, create, join, leave, disconnect, hello, buy, leaveShop, pick, reward, push, ended, endHandler, runOf };
}
