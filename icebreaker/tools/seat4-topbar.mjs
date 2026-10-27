// 四人局的协作顶栏：官方 prefab 只有两个座位（[my] / [you]），这里按同一套美术复制出 [mate2] / [mate3]。
//
// 为什么是复制而不是新画：仓库没有 prefab 制作工具链，官方也没有 4 人版的顶栏。复制官方节点能保证图标、
// 字号、间距、九宫格底图全部沿用原作，新增的两席只换 tint 与 x 位置；左右两席各自向内让 172px，正好落在
// 生命数字与中央 `icon_you_with_info` 之间的空档里（左空档 -297..-50.3，右空档 76.7..292.6）。
//
// 幂等：目标节点已存在时先删掉再插，重复跑不会叠加。
// 用法：node tools/seat4-topbar.mjs <in battle.json> <out battle.json>
import fs from 'node:fs';

const PANEL = 'panel_cooperate_normal_and_fortress_status';
/** 官方两席的 tint：我 = 蓝，队友 = 绿（`[my]/[you]icon_life_point` 的 text 与 group_icon）。 */
const MY_TINT = [0, 0.5961, 0.8627, 1];
const YOU_TINT = [0, 0.5725, 0.5137, 1];
/** 新增两席沿用同色系、只提亮度：左侧一席偏亮蓝，右侧一席偏亮青绿，蓝=左侧、绿=右侧的语义不变。 */
const MATE2_TINT = [0.3373, 0.7922, 0.9412, 1];
const MATE3_TINT = [0.3608, 0.8078, 0.7098, 1];
/** 新席位的 x：左右各一席，对称。 */
const MATE2_X = -227.5;
const MATE3_X = 227.5;

/** 把子树里等于 `from` 的颜色全换成 `to`（只比对 rgb，alpha 保持）。 */
function retint(node, from, to) {
  for (const c of Object.values(node.comps ?? {})) {
    if (Array.isArray(c?.color) && c.color.slice(0, 3).every((v, i) => Math.abs(v - from[i]) < 1e-4)) c.color = [...to];
  }
  for (const k of node.children ?? []) retint(k, from, to);
}

/**
 * 复制一个座位节点到新的 x、新前缀与新 tint。子树位置不动（都是相对父节点），只改根节点的 pos，
 * 这样图标与生命数字、复活计时的相对关系原封不动。
 * @param {any} src @param {string} tag @param {number} x @param {number[]} tint
 */
function seat(src, tag, x, tint) {
  const cp = structuredClone(src);
  cp.name = src.name.replace(/^\[(my|you)\]/, `[${tag}]`);
  cp.rt.pos = [x, cp.rt.pos[1]];
  retint(cp, src.name.startsWith('[my]') ? MY_TINT : YOU_TINT, tint);
  return cp;
}

/** 比分节点名，也是 `hud.coopTop.score` 那三个 ref 的最后一段。 */
const SCORE = 'score';
/** 比分的横向中心：四席之间那段空档的正中。 */
const SCORE_CENTER = 38;
/** 与生命数字同一行。 */
const SCORE_Y = 18;
/** 底板宽度：空档约 322，两端各留一点呼吸。 */
const SCORE_W = 250;

/** 一个节点的最小 rt（四个数字都是相对父节点的像素）。 @param {number} x @param {number} y @param {number} w @param {number} h */
const rect = (x, y, w, h) => ({ amin: [0.5, 0.5], amax: [0.5, 0.5], pos: [x, y], size: [w, h], pivot: [0.5, 0.5], scale: [1, 1], rotz: 0 });

/**
 * 一个数字节点：官方字体 Novecentowide-Bold、居中、与生命数字同级字号，颜色取官方双色。
 * @param {string} name @param {number} x @param {number} size @param {number[]} color @param {string} [text]
 */
function num(name, x, size, color, text = '0') {
  return {
    name, active: true, children: [], rt: rect(x, SCORE_Y, 96, 60),
    comps: { text: { text, size, style: 0, align: 4, line: 1, best: 0, min: 0, max: 40, rich: 0, hwrap: 1, color, font: 'Novecentowide-Bold' } },
  };
}

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error('usage: node tools/seat4-topbar.mjs <in battle.json> <out battle.json>');
  process.exit(2);
}

const pack = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const panel = pack.screens?.['coop.topbar']?.children?.find((c) => c.name === PANEL);
if (!panel) {
  console.error(`no ${PANEL} under screens["coop.topbar"] in ${inFile}`);
  process.exit(1);
}

/** 每一席要复制哪几个节点：图标、带生命数字的节点、复活计时（`showSide` 靠名字后缀找它）。 */
const SEATS = [
  ['mate2', MATE2_X, MATE2_TINT, 'my'],
  ['mate3', MATE3_X, MATE3_TINT, 'you'],
];

/** 删掉上一次生成的节点，保证重跑幂等。 */
panel.children = panel.children.filter((c) => !/^\[mate[23]\]/.test(c.name) && c.name !== SCORE);

for (const [tag, x, tint, like] of SEATS) {
  const src = (/** @type {string} */ n) => panel.children.find((c) => c.name === `[${like}]${n}`);
  // 复活计时的 x 不是图标 x，而是图标旁边那个位置；按原始两席的相对关系等比搬过去。
  const srcIcon = src('icon_life_point');
  const srcTimer = src('revive_timer');
  const timerX = x + (srcTimer.rt.pos[0] - srcIcon.rt.pos[0]);
  const added = [
    seat(src('img_icon_life_point'), tag, x, tint),
    seat(src('icon_life_point'), tag, x, tint),
    seat(srcTimer, tag, timerX, tint),
    // 复活计时默认隐藏，`showSide` 在倒地时才打开；这里补一条与图标同名的兄弟关系检查用的节点名即可。
  ];
  added[2].active = false;
  panel.children.push(...added);
}

// ── 2v2 的比分 ────────────────────────────────────────────────────────────────────────────────────────
// 四席之间剩下的空档：`[mate2]` 的右缘（-122.3）到 `[mate3]` 的左缘（119.8）之间，中心约 x=+38。
// 官方没有比分/数字图集素材（sprites 里搜 score/versus/0-9 全是倍速与稀有度图标），所以这里只用官方两样东西：
// 底板 `actmultiV3_sprite_battle_round_rectangle`（text_lag 用的那条圆角条）+ 官方字体与官方双色（我=蓝、对方=绿）。
// 两席（1v1）时整组 `active:false`，原样式一个像素不动。
panel.children.push({
  name: SCORE, active: false, comps: {}, children: [
    { name: 'plate', active: true, children: [], rt: rect(SCORE_CENTER, SCORE_Y, SCORE_W, 46),
      comps: { img: { kind: 'image', ref: 'sprite/actmultiV3_sprite_battle_round_rectangle', color: [0.2275, 0.2275, 0.2275, 0.6],
        type: 1, fill: 1, fillMethod: 4, fillOrigin: 0, clockwise: 1, preserve: 0, center: 1, border: [20, 0, 20, 0] } } },
    num('mine', SCORE_CENTER - 56, 34, MY_TINT),
    num('sep', SCORE_CENTER, 30, [1, 1, 1, 0.75], ':'),
    num('theirs', SCORE_CENTER + 56, 34, YOU_TINT),
  ],
  rt: rect(0, 0, 0, 0),
});

/** 引擎侧靠这几个 ref 找比分，和 `status` / `speed` 放在一起。 */
pack.hud.coopTop.score = { panel: `@${PANEL}/${SCORE}`, mine: `@${PANEL}/${SCORE}/mine`, theirs: `@${PANEL}/${SCORE}/theirs` };

fs.writeFileSync(outFile, JSON.stringify(pack));
console.log(`seat4-topbar: ${panel.children.length} children -> ${outFile}`);
