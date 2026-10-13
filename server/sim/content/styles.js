// server/sim/content/styles.js — battle side of the 促融共竞 比赛风格 (match styles; 玩法-PRTS.md §4, main.raw 148-179).
// A style rides on the player's battle input (`players[].styleId`, shared/constants.js MATCH_STYLES) and buffs THAT
// player's own units. The numbers are the official main effects; the 携带物 (the deployable items) land with P6.
//
// Determinism (docs/SIM.md): the style id never enters the battle seed, and a style must not change how many times
// `battle.rng()` is consumed — the 攻坚 10 % roll is drawn for every qualifying attack, its branch only decides the
// outcome. Timers (`battle.every`) are the same machinery the content domains already use.
import { playerOps, passiveBuff, directMods, inRange, isOp, onField } from './support/index.js';

const keyOf = (styleId, part = '') => `style:${styleId}${part ? `:${part}` : ''}`;

/** The crowd-control statuses 控制's conditional reads as 「异常状态」 (catalogue keys; [ASSUMED] the reading). */
const ABNORMAL = ['stun', 'sleep', 'freeze', 'cold', 'levitate', 'fear', 'attract'];
const underStatus = (u) => !!u && typeof u.findBuff === 'function' && ABNORMAL.some((k) => u.findBuff(k));

/** Run `fn` for each of the player's operators (already on the field at install, and every later deployment). */
const ownOps = (battle, ps, fn) => {
  for (const u of playerOps(battle, ps.playerId)) fn(u);
  battle.on('deploy', (c) => {
    const u = c.unit;
    if (isOp(u) && u.ownerId === ps.playerId && u.alive) fn(u);
  });
};

const STYLES = {
  /** 基础: 我方干员攻击力 +10%. */
  basic: {
    install(battle, ps) {
      ownOps(battle, ps, (u) => passiveBuff(battle, u, keyOf('basic', 'atk'), directMods({ atk: 0.10 })));
    },
  },

  /**
   * 驻场: while on the field the owner's operators gain ATK and max HP gradually (placeholder pacing +6 % per 5 s,
   * cap +60 % — the official growth curve is not in the extracted data); redeploy +15 %.
   */
  anchoring: {
    install(battle, ps) {
      let step = 0;
      const apply = (u) => passiveBuff(battle, u, keyOf('anchoring', 'ramp'),
        directMods({ atk: 0.06 * step, hp: 0.06 * step }, { redeployMul: 1.15 }));
      ownOps(battle, ps, apply);
      battle.every(5, () => {
        if (step >= 10) return;
        step += 1;
        for (const u of playerOps(battle, ps.playerId, { fieldOnly: true })) apply(u);
      });
    },
  },

  /** 游走: 再部署时间 -20%，初始技力 +10（可部署人数 -1 是 match 侧：cujongInitPlayer 扣 deployCapBonus）. */
  roaming: {
    install(battle, ps) {
      battle.on('deploy', (c) => {
        const u = c.unit;
        if (!isOp(u) || u.ownerId !== ps.playerId || !u.alive) return;
        battle.addBuff(u, { key: keyOf('roaming', 'redeploy'), mods: { redeployMul: 0.8 }, refresh: 'replace', persist: true, allowDead: true });
        if (u.skill && typeof u.skill.gainSp === 'function') u.skill.gainSp(10, 'init', true);
      });
    },
  },

  /** 攻坚: 攻击速度 +20（点数），造成伤害 10 % 概率回复 1 技力（固定抽一次 rng）；受到伤害 +20 %. */
  offensive: {
    install(battle, ps) {
      ownOps(battle, ps, (u) => passiveBuff(battle, u, keyOf('offensive'), { aspd: 20, dmgTakenMul: 1.2 }));
      battle.on('attack', (c) => {
        const u = c.attacker;
        if (!isOp(u) || u.ownerId !== ps.playerId || !u.alive || !u.skill) return;
        if (battle.rng() < 0.1) u.skill.gainSp(1, 'style', true);
      });
    },
  },

  /** 支援: 治疗 +40 %，攻击范围内的友方每秒技力 +1（同一秒不叠加）；造成伤害 -10 %. */
  supportive: {
    install(battle, ps) {
      ownOps(battle, ps, (u) => passiveBuff(battle, u, keyOf('supportive'), { healingDealtMul: 1.4, dmgDealtMul: 0.9 }));
      battle.every(1, () => {
        const touched = new Set();
        for (const u of playerOps(battle, ps.playerId, { fieldOnly: true })) {
          if (!u.alive || !u.rangeKeySet) continue;
          for (const v of battle.allies(ps.playerId)) {
            if (!v.alive || v === u || touched.has(v)) continue;
            if (inRange(u, v)) {
              touched.add(v);
              if (v.skill && typeof v.skill.gainSp === 'function') v.skill.gainSp(1, 'style', true);
            }
          }
        }
      });
    },
  },

  /** 控制: 我方施加的异常状态时间 +150 %；对不处于异常状态的敌人伤害 -15 %. */
  disabling: {
    install(battle, ps) {
      battle.on('beforeStatus', (c) => {
        if (!c.source || c.source.ownerId !== ps.playerId) return;
        if (!c.target || c.target.side !== 'enemy') return;
        if (Number.isFinite(c.duration) && c.duration > 0) c.duration *= 2.5;
      });
      battle.on('hpDamage', (c) => {
        if (!c.source || c.source.ownerId !== ps.playerId) return;
        if (!c.target || c.target.side !== 'enemy') return;
        if (underStatus(c.target)) return;
        c.amount = c.amount * 0.85;
      });
    },
  },
};

// ---- 携带物 (style carries, P6; PRTS main.raw 148–179 携带物列) ---------------------------------------------------
// Each 比赛风格 carries one item whose effect opens with the battle ("部署后效果" adapted: it fires at every battle's
// start). Durations/amounts beyond the short official lines are [ASSUMED] remake values; both-sides effects follow the
// official 「双方干员」 wording. Deterministic: only 汽水机 draws rng, once per interval, and never conditionally on
// the style suite.

/** [ASSUMED] "一段时间内" pacing for the windowed carries. */
const CARRY_WINDOW = 30;

/** Every operator of every player on the field (carries call out BOTH sides — PRTS 「双方干员」). */
const allOps = (battle) => {
  const out = [];
  for (const ps of battle.players) out.push(...playerOps(battle, ps.playerId));
  return out;
};

/** fn(u) for every operator now, and for each operator deployed while the window lasts. `allowDead`: at content install
 * the operators exist but are not deployed yet (alive flips at the battle-start deployment), like passiveBuff. */
const bothOps = (battle, fn, seconds = 0) => {
  for (const u of allOps(battle)) fn(u);
  if (!(seconds > 0)) return;
  const until = battle.time + seconds;
  battle.on('deploy', (c) => { if (battle.time <= until && c.unit && c.unit.kind === 'op' && c.unit.side === 'ally') fn(c.unit); });
};

const CARRIES = {
  /** 基础 → 赛场啦啦队: 一段时间内双方干员攻击力 +20 %. */
  basic: {
    install(battle) {
      bothOps(battle, (u) => battle.addBuff(u, { key: 'carry:cheer:atk', mods: { atkPct: 0.20 }, duration: CARRY_WINDOW, refresh: 'replace', allowDead: true }), CARRY_WINDOW);
    },
  },

  /** 驻场 → 护具分发员: 一段时间内为在场双方干员提供 6000 屏障. */
  anchoring: {
    install(battle) {
      // refresh 'replace': the initial sweep and the t=0 `deploy` hooks both touch the opening units — one shield each.
      // No shieldType: per PRTS 术语释义 屏障 "若无特殊说明，屏障可吸收全种类伤害" (damage.js absorbShields).
      bothOps(battle, (u) => battle.addBuff(u, {
        key: 'carry:gear:shield', refresh: 'replace', duration: CARRY_WINDOW, allowDead: true,
        shield: 6000, visible: true,
      }), CARRY_WINDOW);
    },
  },

  /** 游走 → 混乱烟花箱: 对全体敌人造成伤害，并将再部署中双方干员的重部署时间减至 0. */
  roaming: {
    install(battle) {
      // battleStart fires BEFORE the first tick's spawn phase (Battle.js), so the sweep alone would miss the opening
      // wave: it runs at battleStart over whatever exists and the `enemySpawn` hook catches the wave landing in the
      // first OPENING seconds. [ASSUMED] 3000 damage / 2 s window.
      const OPENING = 2;
      const hit = (e) => { if (e && e.alive) battle.dealDamage(null, e, { amount: 3000, type: 'true', canDodge: false, sourceless: true, tags: ['carry'] }); };
      battle.on('battleStart', () => {
        for (const e of battle.enemies) hit(e);
        for (const u of allOps(battle)) if (Number.isFinite(u.respawnAt)) u.respawnAt = battle.time; // 立即可再部署
      });
      battle.on('enemySpawn', (c) => { if (battle.time <= OPENING) hit(c && c.enemy); });
    },
  },

  /** 攻坚 → 猛兽能量饮料: 大幅增加双方攻速，但防御力与法术抗性减至 0. */
  offensive: {
    install(battle) {
      bothOps(battle, (u) => battle.addBuff(u, { key: 'carry:drink:stats', mods: { aspd: 100, defMul: 0, resMul: 0 }, duration: CARRY_WINDOW, refresh: 'replace', allowDead: true }), CARRY_WINDOW); // [ASSUMED] aspd +100
    },
  },

  /** 支援 → 喷射汽水机: 不断喷出汽水瓶砸到随机双方干员，使其获得 +3 技力 (每 4 秒一次；确定性抽签). */
  supportive: {
    install(battle) {
      battle.every(4, () => {
        const pool = allOps(battle).filter((u) => u.alive && onField(u));
        if (!pool.length) return;
        const pick = battle.rng.pick(pool);
        if (pick.skill && typeof pick.skill.gainSp === 'function') pick.skill.gainSp(3, 'carry', true);
      });
    },
  },

  /** 控制 → 迷幻反射镜: 一段时间内全场异常状态敌人受物法伤 +40 %; 每 10 秒使攻击范围内敌人晕眩 5 秒. */
  disabling: {
    install(battle) {
      const until = battle.time + CARRY_WINDOW;
      const open = () => battle.time < until;
      // the +40 % taken-damage amplifier: a short self-expiring buff refreshed on afflicted enemies while the window lasts
      battle.every(0.5, () => {
        if (!open()) return;
        for (const e of battle.enemies) {
          if (!e.alive || !underStatus(e)) continue;
          battle.addBuff(e, { key: 'carry:mirror:amp', mods: { physTakenMul: 1.4, artsTakenMul: 1.4 }, duration: 1, refresh: 'replace' });
        }
      });
      battle.every(10, () => {
        if (!open()) return;
        for (const ps of battle.players) {
          for (const u of playerOps(battle, ps.playerId, { fieldOnly: true })) {
            if (!u.alive || !u.rangeKeySet) continue;
            for (const e of battle.enemies) {
              if (!e.alive || !inRange(u, e)) continue;
              battle.applyStatus(e, 'stun', { duration: 5, source: u });
            }
          }
        }
      });
    },
  },
};

export function install(battle) {
  // the 携带物 is one item per STYLE: both players picking the same style must not install the same carry twice (a
  // 「双方干员」 carry would otherwise double its window buffs and its rng draws).
  const carriesDone = new Set();
  for (const ps of battle.players || []) {
    const id = ps.styleId;
    if (!id) continue;
    const style = STYLES[id];
    if (style && typeof style.install === 'function') {
      try { style.install(battle, ps); } catch (e) { battle._handlerError?.(`style:${id}`, null, e); }
    }
    const carry = CARRIES[id];
    if (carry && !carriesDone.has(id)) {
      carriesDone.add(id);
      try { carry.install(battle, ps); } catch (e) { battle._handlerError?.(`carry:${id}`, null, e); }
    }
  }
}
