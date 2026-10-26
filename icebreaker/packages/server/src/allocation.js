// Operator allocation (docs/spec/room.md 房间-4, 房间-5): which seat keeps an operator both squads hold, the turns of
// picking the contested high-priority ones, and the operators each seat may field — its high-priority ones, half its
// low-priority pool drawn at random, 2–6 more with at least 2 temporary recruits. Pure: the random numbers come in.

/** @typedef {import('@icebreaker/mode-regular').Squad} Squad @typedef {import('@icebreaker/mode-regular').BoxEntry} BoxEntry */
/**
 * The picking of contested high-priority operators: those left, the seat that picks now, where the turns stand in the
 * first-second-second-first round, and whether this turn was handed over (then it cannot be handed back).
 * @typedef {{ left: string[], first: number, at: number, by: number, yielded: boolean, won: string[][], players?: number }} Picking
 */
/**
 * What coordination leaves each seat: the high-priority operators it keeps for sure, its low-priority pool, and the
 * picking of the contested ones (none when there are none).
 * @typedef {{ kept: string[][], pools: string[][], picking: Picking | null }} Coordination
 */

/** A list shuffled in place by Fisher–Yates with the given random numbers. @template T @param {T[]} list @param {() => number} random */
export function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const ids = (/** @type {BoxEntry[]} */ list) => list.map((e) => e.id);

/** The seat whose turn is at `at` (房间-4). Two seats keep the first-second-second-first round; more seats take turns
 *  in order from the first picker. @param {number} first @param {number} at @param {number} n */
const roundSeat = (first, at, n) => (n <= 2 ? ([0, 3].includes(at % 4) ? first : 1 - first) : (first + at) % n);

/**
 * Coordination of the squads (房间-4): an operator two or more seats hold high is contested and picked in turns, the
 * first picker at random; one seat's high against another's low goes to the high side; an operator in two low pools is
 * dealt to one of them at random.
 *
 * Two seats behave exactly as before (the first-second-second-first round). More seats take turns in order, and every
 * seat keeps its own entry in `kept` / `pools` / `won`.
 * @param {Squad[]} squads @param {() => number} random @returns {Coordination}
 */
export function coordinate(squads, random) {
  const n = squads.length;
  const high = squads.map((s) => ids(s.high)), low = squads.map((s) => ids(s.low));
  /** How many seats hold each operator in their high list. @type {Map<string, number>} */
  const held = new Map();
  for (const list of high) for (const id of new Set(list)) held.set(id, (held.get(id) ?? 0) + 1);
  const contested = [...held].filter(([, c]) => c >= 2).map(([id]) => id);
  const kept = high.map((list) => list.filter((id) => !contested.includes(id)));
  const pools = squads.map((_, i) => low[i].filter((id) => !high.some((h, j) => j !== i && h.includes(id))));
  // 同一个干员落在两个以上座位的低优先池：随机挑一个座位失去它，其余保留。两座时与原来逐字一致 ——
  // 随机数 < 0.5 就是座位 0 失去。
  /** @type {Map<string, number[]>} */
  const inPools = new Map();
  pools.forEach((pool, i) => { for (const id of pool) inPools.set(id, [...(inPools.get(id) ?? []), i]); });
  for (const [id, seats] of inPools) {
    if (seats.length < 2) continue;
    const loser = seats[Math.floor(random() * seats.length)];
    pools[loser] = pools[loser].filter((x) => x !== id);
  }
  if (contested.length === 0) return { kept, pools, picking: null };
  const first = Math.floor(random() * n);
  return { kept, pools, picking: { left: contested, first, at: 0, by: first, yielded: false, won: squads.map(() => []), players: n } };
}

/**
 * A pick of a contested operator by the seat whose turn it is; null when it may not. @param {Picking} p @param {number} seat
 * @param {string} id @returns {Picking | null}
 */
export function pick(p, seat, id) {
  if (seat !== p.by || !p.left.includes(id)) return null;
  const won = p.won.map((w) => [...w]);
  won[seat].push(id);
  return { ...p, left: p.left.filter((x) => x !== id), at: p.at + 1, by: roundSeat(p.first, p.at + 1, p.players ?? p.won.length), yielded: false, won };
}

/**
 * The seat whose turn it is hands this turn to the next seat (房间-4): only with at least 2 left, and not a turn it was
 * handed; null when it may not. @param {Picking} p @param {number} seat @returns {Picking | null}
 */
export function handOver(p, seat) {
  if (seat !== p.by || p.yielded || p.left.length < 2) return null;
  return { ...p, by: (p.by + 1) % (p.players ?? p.won.length), yielded: true };
}

/**
 * What a seat may field (房间-5): from its pool, half (rounded down) drawn at random; then 2–6 more from the temporary
 * recruits and the rest of its pool, at least 2 of them recruits.
 * @param {string[]} pool @param {string[]} recruits @param {() => number} random @returns {{ drawn: string[], extra: string[] }}
 */
export function offer(pool, recruits, random) {
  const order = shuffle([...pool], random), drawn = order.slice(0, Math.floor(pool.length / 2)), rest = order.slice(drawn.length);
  const temps = shuffle([...recruits], random), n = 2 + Math.floor(random() * 5);
  const sure = temps.slice(0, Math.min(2, temps.length)), more = shuffle([...temps.slice(sure.length), ...rest], random);
  return { drawn, extra: [...sure, ...more.slice(0, Math.max(0, n - sure.length))] };
}
