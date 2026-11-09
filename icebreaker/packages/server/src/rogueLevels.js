// 肉鸽关卡的懒加载内容源：635 张官方集成战略关卡以文件形式放在磁盘上（不进 LEVELS 的静态 import），
// 按 id 读一次并缓存。包装官方内容源，其余字段（roster/training/token/mods）原样透传。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} dir 关卡 JSON 所在目录（文件名 <id>.json）
 * @param {any} base 官方内容源（OFFICIAL_SOURCE）
 */
export function withRogueLevels(dir, base, variants = new Map()) {
  /** @type {Map<string, any>} */
  const cache = new Map();
  const fileOf = (k) => join(dir, `${k}.json`);
  // 变体（这一局的敌方倍率/初始费用）与磁盘上的关卡都在这里认
  const has = (k) => typeof k === 'string' && /^rogue\d/i.test(k) && (variants.has(k) || existsSync(fileOf(k)));
  const load = (k) => {
    if (variants.has(k)) return variants.get(k);
    if (!cache.has(k)) cache.set(k, JSON.parse(readFileSync(fileOf(k), 'utf8')));
    return cache.get(k);
  };
  // LEVELS 是 Object.freeze 的（不可扩展），代理的 target 必须是可扩展的普通对象，否则 getOwnPropertyDescriptor 会报不变量冲突
  const target = { ...(base.levels ?? {}) };
  const levels = new Proxy(target, {
    has: (t, k) => k in t || has(k),
    get: (t, k) => (k in t ? t[k] : has(k) ? load(/** @type {string} */ (k)) : undefined),
    getOwnPropertyDescriptor: (t, k) => (k in t ? Object.getOwnPropertyDescriptor(t, k) : has(k) ? { value: load(/** @type {string} */ (k)), writable: false, enumerable: true, configurable: true } : undefined),
    ownKeys: (t) => [...Reflect.ownKeys(t)],
  });
  return { ...base, levels };
}
