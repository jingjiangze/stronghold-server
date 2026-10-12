// server/modGate.js — the LOAD-TIME half of a pack's `server.preDispatch` declaration, vendored verbatim from
// Stronghold-Protocol-Forge (see MOD-BRIDGE.SOURCE.md for the commit, the line range and the re-extraction steps).
//
// Why a slice and not the whole file: upstream lives in server/workshop.js, which is Forge's pack LOADER (it also reads
// the workshop directory, builds the data overlay and lists packs). This server has its own loader (server/packs.js +
// server/modBridge.js), so only the two pure judgements are lifted out — `preDispatchIssues` (the files) and
// `validateHookPolicy` (the module's opinion of its own policy file). Both are pure: no imports beyond fs / path / C2S.
//
// Why load-time at all (upstream's own reason, MOD-SURFACE.md §13.3 in the Forge repo): a pack that declares an admission gate and loads
// without one is a server whose operator believes the gate is shut while every entry message reaches the lobby. Every
// failure below is a property of the FILES, so it is decidable before the pack is listed.
//
// One local rule, stated here because both functions obey it: `intercepts` is judged against the protocol THIS server
// runs (shared/protocol.js C2S), not against a copied list. A type this server has no message for is refused
// (PREDISPATCH_UNKNOWN_TYPE) rather than silently dropped — silently dropping one is a gate that shuts only part of
// the door.

import fs from 'node:fs';
import path from 'node:path';

import { C2S } from '../shared/protocol.js';

export function preDispatchIssues(pack, packDir, { c2s = C2S } = {}) {
  const decl = pack && pack.server && pack.server.preDispatch;
  if (!decl || typeof packDir !== 'string' || !packDir) return [];
  const dir = path.resolve(packDir);
  const moduleAbs = path.join(dir, ...String(decl.module).split('/'));
  const policyAbs = path.join(dir, ...String(decl.policy).split('/'));
  const inside = (abs) => abs === dir || abs.startsWith(dir + path.sep);
  if (!inside(moduleAbs) || !inside(policyAbs)) {
    return [{
      code: 'PREDISPATCH_BAD_PATH',
      reason: `server.preDispatch paths must resolve inside the pack (module "${decl.module}", policy "${decl.policy}")`,
    }];
  }
  const readable = (abs) => { try { return fs.statSync(abs).isFile(); } catch { return false; } };
  if (!readable(moduleAbs)) {
    return [{ code: 'PREDISPATCH_BAD_MODULE', reason: `server.preDispatch.module "${decl.module}" is not a readable file inside the pack` }];
  }
  if (!readable(policyAbs)) {
    return [{ code: 'PREDISPATCH_BAD_POLICY', reason: `server.preDispatch.policy "${decl.policy}" is not a readable file inside the pack` }];
  }
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(policyAbs, 'utf8'));
  } catch (e) {
    return [{ code: 'PREDISPATCH_BAD_POLICY', reason: `server.preDispatch.policy "${decl.policy}" is not readable JSON: ${e && e.message ? e.message : String(e)}` }];
  }
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return [{ code: 'PREDISPATCH_BAD_POLICY', reason: `server.preDispatch.policy "${decl.policy}" must be a JSON object (the hook's own data)` }];
  }
  const known = c2s && typeof c2s === 'object' ? c2s : {};
  // 名单里有协议不认识的名字 → 整个包被点名拒绝（不是静默丢掉那一条 —— 静默丢掉就是一道只拦一部分入口的闸门）。
  const unknown = (Array.isArray(decl.intercepts) ? decl.intercepts : []).filter((t) => typeof t !== 'string' || !Object.hasOwn(known, t));
  if (unknown.length) {
    return [{
      code: 'PREDISPATCH_UNKNOWN_TYPE',
      reason: `server.preDispatch.intercepts: ${unknown.map((t) => `"${String(t)}"`).join(', ')} — not a message type of the protocol this server runs (shared/protocol.js C2S)`,
    }];
  }
  return [];
}

/**
 * 读一个钩子模块对**自己那份策略**的意见（`module.validatePolicy(policy)`，可选导出）。
 *
 * **为什么需要它。** 装载期（`preDispatchIssues`）只保证 `policy` 能解析成一个 JSON **对象** —— 它不认识包自己的
 * 数据格式（`version` / `files` 是钩子的方言）。所以「策略文件的**内部形状**是坏的」这一格，装载期判不出来。
 * 没有这道自检时，唯一的信号是工厂在**每个连接**上抛异常，而工厂抛异常的姿态是「这条连接上这个钩子不存在，
 * 消息照常分发」（`server/modDispatch.js` 文件头）—— 也就是「包看着装好了、闸门其实一条都没拦」，正是
 * MOD-SURFACE.md §13.3（Forge 仓）要消灭的那一类失败。
 *
 * 有了它，一份用不了的策略与「策略不是 JSON 对象」得到**同一个结局**：点名拒绝（`PREDISPATCH_BAD_POLICY`）并把
 * 这个包移出已加载集合（`dropUnavailablePreDispatchPacks`）。
 *
 * **契约，一个都不含糊**（未列出的返回值一律**拒绝**并说明，而不是当它通过 —— 装载期是响亮拒绝该在的地方）：
 *
 * | 模块返回 | 判定 |
 * |---|---|
 * | `undefined` / `null` / `true` | 通过 |
 * | `{ ok: true }` | 通过 |
 * | `false` | 拒绝 |
 * | 非空字符串 | 拒绝，字符串就是理由（给作者看的话就写在这里） |
 * | `{ ok: false, detail? / reason? / error? }` | 拒绝，取其中第一个字符串当理由 |
 * | 其它任何值 | 拒绝，理由写「返回了一个不认识的判定」 |
 * | 抛异常 | 拒绝，理由取异常信息 |
 *
 * **没有导出 `validatePolicy` 的模块一个字节都不受影响**（返回 `null`，调用方什么都不做）—— 与 §28.13 的 A 段
 * 同一口径：声明了才生效。
 *
 * @param {any} mod `await import()` 出来的模块命名空间
 * @param {any} policy 已经解析好的策略对象（`JSON.parse` 过、来自包内声明的那个文件）
 * @returns {string|null} 拒绝的理由；`null` = 通过
 */
export function validateHookPolicy(mod, policy) {
  const fn = mod && typeof mod.validatePolicy === 'function' ? mod.validatePolicy : null;
  if (!fn) return null;
  let verdict;
  try {
    verdict = fn(policy);
  } catch (e) {
    return `validatePolicy threw: ${e && e.message ? e.message : String(e)}`;
  }
  if (verdict === undefined || verdict === null || verdict === true) return null;
  if (verdict === false) return 'validatePolicy returned false';
  if (typeof verdict === 'string') return verdict.trim() || 'validatePolicy returned an empty string';
  if (verdict && typeof verdict === 'object' && !Array.isArray(verdict)) {
    if (verdict.ok === true) return null;
    if (verdict.ok === false) {
      const why = [verdict.detail, verdict.reason, verdict.error].find((v) => typeof v === 'string' && v.trim());
      return why || 'validatePolicy refused the policy (ok: false)';
    }
  }
  return `validatePolicy returned an unrecognised verdict (${JSON.stringify(verdict) ?? String(verdict)}) — return true / a rejection string / { ok: false, detail }`;
}
