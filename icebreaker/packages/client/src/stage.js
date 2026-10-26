// What the HUD says about the match (engine spec 合作-6, 结束-1): the current stage, its objective and the seconds left,
// the team's stamps, and the result — from the match status the worker sends with every frame.

/** Simulation frames per second (the engine's 时间-1). */
const FPS = 30;

/** The objectives' names (合作-7). */
const OBJECTIVES = Object.freeze({ protect: '营救', target: '渗透', kill: '清除', survive: '生存', boss: '突击', tower: '占垒', car: '护送' });

/** @typedef {{ objective: string, goal: number, advanced?: number, time: number, rest: number }} Stage */
/** @typedef {{ wave: number, stage: number, start: number, stamps: number, passed: number, result: number }} Status */

/**
 * The HUD's line about the match.
 * @param {Status | null} s @param {Stage[]} stages @param {number} frame @returns {string}
 */
export function matchText(s, stages, frame) {
  if (!s) return '';
  if (s.result >= 0) return `${s.result === 1 ? '比赛胜利' : '比赛结束'} · 嘉奖印章 ${s.stamps}`;
  const st = stages[s.stage];
  if (!st) return '比赛即将开始';
  const name = /** @type {Record<string, string>} */ (OBJECTIVES)[st.objective] ?? st.objective;
  const target = st.advanced !== undefined ? `${st.goal} → ${st.advanced}` : `${st.goal}`;
  if (frame < s.start) return `第 ${s.stage + 1} 阶段 · 中场休整 ${Math.ceil((s.start - frame) / FPS)} 秒 · ${name} ${target}`;
  if (s.passed > s.stage) return `第 ${s.stage + 1} 阶段完成 · 印章 ${s.stamps}`;
  const left = Math.max(0, Math.ceil((s.start + st.time * FPS - frame) / FPS));
  return `第 ${s.stage + 1} 阶段 · ${name} ${target} · 剩余 ${left} 秒 · 印章 ${s.stamps}`;
}
