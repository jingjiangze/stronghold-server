// plugins/mota/server/match/botStrategies.js — 按模式独立的 AI 策略注册与解析。只做登记，不含实现。
// 调用方（match/prep.js、match/phases.js、match/spDraft.js）不 import 本文件：Match 构造期解析一次
// （this.botStrategy），方法模块只读这个对象，默认值回落到 botContract.js 的 LEGACY_BOT —— 无环。
import { createBotRegistry } from './botContract.js';

// 登记表：以后每个模式要独立 AI 就在这里加一行 defineBotStrategy({...})（再登记进下面的 REGISTRY）。
// 目前各模式的默认实现都是 legacy（行为与改造前完全一致）；这里是唯一需要改的地方。
// 对抗的三个规则档各有一格（2026-11-04 复验修复 4）：versusRule 三档（bounty / confront / ai）**各自**可独立配 AI；
// `versus` 只是「isVersus 但没有 versusRule」时的兜底键。`ai`（AI 对抗）与 `confront`（纯对抗）不要混用一格。
const MODES = Object.freeze({
  solo: 'legacy',
  coop: 'legacy',
  versus: 'legacy',
  bounty: 'legacy',
  confront: 'legacy',
  ai: 'legacy',
  rogue: 'legacy',
});

// legacy 由 createBotRegistry 恒含（把 LEGACY_BOT 再当 definition 传进去会被判「重复 id」抛错），
// 所以这里只登记额外策略；空表 = 只有 legacy，与改造前等价。
const REGISTRY = createBotRegistry([]);

/** 模式键：对抗档用 versusRule（bounty / confront / ai 三档各自独立配 AI），其余按 mode。 */
export function botModeKey(match) {
  if (!match) return 'solo';
  if (match.isVersus) return match.versusRule || 'versus';
  if (match.mode === 'solo') return 'solo';
  if (match.mode === 'rogue') return 'rogue';
  return 'coop';
}

/** 解析本局策略 id：显式 env / opts 覆盖 > 按模式表 > legacy。 */
export function botStrategyIdFor(match, override = null) {
  const id = override || process.env.SP_BOT_STRATEGY || MODES[botModeKey(match)] || 'legacy';
  return id;
}

/** @param {string} [id] @param {Record<string, Readonly<object>>} [registry] */
export function getBotStrategy(id = 'legacy', registry = REGISTRY) {
  // A missing registration is a configuration error, never a silent fallback (defaults are resolved by botStrategyIdFor).
  if (typeof id !== 'string' || !Object.hasOwn(registry, id)) throw new Error(`Unknown bot strategy: ${id}`);
  return registry[id];
}

/** 组合上面两步：先按模式/覆盖解析 id，再从注册表取策略对象。 */
export function botStrategyFor(match, override = null, registry = REGISTRY) {
  return getBotStrategy(botStrategyIdFor(match, override), registry);
}
