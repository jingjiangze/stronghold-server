// Box entries and squads for the room tests (docs/spec/room.md 房间-3).

/** A box entry numbered `n`. @param {number} n @param {Partial<import('@icebreaker/mode-regular').BoxEntry>} [v] */
export const entry = (n, v = {}) => ({ id: `char_${String(100 + n).padStart(3, '0')}_op${n}`, elite: 2, level: 60, potential: 1, trust: 100, skills: [7, 10], modules: [0, 3], ...v });

/** A squad of `high` high-priority and `low` low-priority entries, numbered from `from`. */
export const squadOf = (high = 10, low = 10, from = 0) => ({
  high: Array.from({ length: high }, (_, i) => entry(from + i)), low: Array.from({ length: low }, (_, i) => entry(from + high + i)),
});
