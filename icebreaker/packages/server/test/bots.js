// Bots for whole-match tests: each seat deploys its deck to hold the goals — the free tile its operator's type allows
// nearest a route's end, in its own half of the map when it can (so two bots do not race for one tile), facing where
// the routes come from — and starts its ready manual skills.
import { deployProblem } from '@aue/sim';
import { KIND, DIR } from '@aue/schema';

/** The direction from a tile towards a point. @param {number} dx @param {number} dy */
export const facing = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? DIR.RIGHT : DIR.LEFT) : dy >= 0 ? DIR.UP : DIR.DOWN);

/** The routes' ends and the mean of their starts. @param {import('@aue/sim').Content} c */
function goalsOf(c) {
  const routes = /** @type {{ start: { row: number, col: number }, end: { row: number, col: number } }[]} */ (/** @type {any} */ (c.level).routes);
  const ends = [...new Map(routes.map((r) => [`${r.end.row},${r.end.col}`, r.end])).values()];
  const from = { row: routes.reduce((s, r) => s + r.start.row, 0) / routes.length, col: routes.reduce((s, r) => s + r.start.col, 0) / routes.length };
  return { ends, from };
}

/**
 * The deploy of an operator: the best free tile for it, or null.
 * @param {import('@aue/sim').World} w @param {import('@aue/sim').Content} c @param {number} seat @param {string} op
 */
function tileFor(w, c, seat, op) {
  const { ends, from } = goalsOf(c);
  let best = null;
  for (let row = 0; row < c.level.height; row++) {
    for (let col = 0; col < c.level.width; col++) {
      const g = ends.reduce((a, b) => (Math.hypot(b.col - col, b.row - row) < Math.hypot(a.col - col, a.row - row) ? b : a));
      const cmd = { type: /** @type {const} */ ('deploy'), op, row, col, dir: facing(from.col - col, from.row - row) };
      const own = (col < c.level.width / 2) === (seat === 0), d = Math.hypot(g.col - col, g.row - row) + (own ? 0 : 100);
      if ((!best || d < best.d) && deployProblem(w, c, seat, cmd) === null) best = { d, cmd };
    }
  }
  return best?.cmd ?? null;
}

/**
 * A bot's deploy for this frame, or null: the first operator of its deck it can place, once enemies are on the field.
 * @param {import('@aue/sim').World} w @param {import('@aue/sim').Content} c @param {number} seat
 */
export function deployOf(w, c, seat) {
  if (!w.units.some((u) => u.kind === KIND.ENEMY && u.base?.neutral !== true)) return null;
  for (const op of c.decks?.[seat] ?? []) {
    const cmd = tileFor(w, c, seat, op);
    if (cmd) return cmd;
  }
  return null;
}

/** A bot's skill commands: every own manual skill that is ready. @param {import('@aue/sim').World} w @param {import('@aue/sim').Content} c @param {number} seat */
export const skillsOf = (w, c, seat) => w.units
  .filter((u) => u.kind === KIND.OPERATOR && u.owner === seat && u.skill && u.skill.sp >= u.skill.cost && !u.skill.active && c.operators[u.key].skill?.type === 'MANUAL')
  .map((u) => ({ type: /** @type {const} */ ('skill'), unit: u.id }));

/** A bot's commands for this frame. @param {import('@aue/sim').World} w @param {import('@aue/sim').Content} c @param {number} seat */
export function botCommands(w, c, seat) {
  const dep = deployOf(w, c, seat);
  return [...(dep ? [dep] : []), ...skillsOf(w, c, seat)];
}

/** The elite-2 six-star decks, each with its first module at level 3, for a stronger match on the same level. */
const STRONG = { elite: 2, level: 90, potential: 1, trust: 100, skill: 0, skillLevel: 7, module: 0, moduleLevel: 3 };
/** @param {string[]} ids */
const deck = (ids) => ids.map((id) => ({ id, build: { ...STRONG } }));
/** @type {import('@aue/schema').Match['decks']} */
export const STRONG_DECKS = ([
  deck(['char_202_demkni', 'char_017_huang', 'char_103_angel', 'char_134_ifrit', 'char_2014_nian']),
  deck(['char_010_chen', 'char_263_skadi', 'char_222_bpipe', 'char_180_amgoat', 'char_291_aglina']),
]);
