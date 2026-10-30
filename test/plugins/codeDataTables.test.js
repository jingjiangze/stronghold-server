// test/plugins/codeDataTables.test.js — `code.data` 的顶替面到底有多大。
//
// 2026-10-30 之前引擎只认死 `data/config.json`；其它 `data/<name>.json` 一律跳过，
// 于是「整份替换 data/assets.json」这类真实需求（线上包 `nlc-skins` 的素材清单）在引擎层无路可走。
// 本文件钉住泛化之后的语义：
//   ① `config` 行为逐字节不变（回归保护）
//   ② 其它表也能整份顶替
//   ③ 只认 `data/<name>.json` 这一种形态，别的路径静默跳过（不抛错、不当成表）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { fixture } from '../helpers/contentFixtures.js';

const build = (f, ids) => buildContentSet({ registry: f.registry, ids });

test('code.data 换 config：行为与从前一致', t => {
  const f = fixture(t);
  f.put('cfg', { code: { data: ['data/config.json'] } }, { 'data/config.json': { modes: {}, marker: 'cfg' } });
  const s = build(f, ['cfg']);
  assert.deepEqual(s.problems, []);
  assert.equal(s.data.config.marker, 'cfg');
});

test('code.data 能整份顶替任意 data/<name>.json（不只 config）', t => {
  const f = fixture(t);
  const doc = { hello: 1, list: ['a', 'b'] };
  f.put('notes-pack', { code: { data: ['data/notes.json'] } }, { 'data/notes.json': doc });
  const s = build(f, ['notes-pack']);
  assert.deepEqual(s.problems, []);
  assert.deepEqual(s.data.notes, doc, '非 config 的表也要整份顶替进来');
});

test('code.data 里不是 data/<name>.json 的路径静默跳过（不抛错、不建表）', t => {
  const f = fixture(t);
  // ⚠️ 这里**不能**放 `assets/*.png`：`class: content` 的 parts 不允许 assets 文件，
  // 插件会先被类闸拦成 `PLUGIN_UNKNOWN`，测的就不是 `code.data` 的路径过滤了（第一版踩过）。
  f.put('weird', { code: { data: ['data/sub/x.json', 'data/noext', 'noop', 'data/'] } },
    { 'data/sub/x.json': { a: 1 }, 'data/noext': { b: 1 }, 'noop.txt': 'x' });
  const s = build(f, ['weird']);
  assert.deepEqual(s.problems, [], '非法路径不该让插件装载失败');
  assert.equal(s.data.sub, undefined, 'data/sub/x.json 不是 data/<name>.json');
  assert.equal(s.data.noext, undefined, '缺 .json 后缀的不是表');
  assert.equal(s.data.noop, undefined, '不在 data/ 下的不是表');
});
