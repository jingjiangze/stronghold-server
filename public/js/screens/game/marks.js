// public/js/screens/game/marks.js — class-name join and the field highlight styles the match screen passes to the view.

export const cx = (...p) => p.flat().filter(Boolean).join(' ');

export const HUD_HZ_MS = 200;

/** Range tiles of the selected unit (its own highlight group: the wheel's 'facing' group may be up at the same time). */
export const SEL_RANGE = Object.freeze({ group: 'selRange', color: 0xff9c33, fill: 0.3, line: 0.95 });

/** The tile an armed merge-completing card's elite will take (its own group; gold like the promotion cue, render/fx.js). */
export const MERGE_HL = Object.freeze({ group: 'mergeTile', color: 0xffd45a, fill: 0.34, line: 1 });

/**
 * 促融共竞 标记 (P6, PRTS main.raw 699–703): own marks draw per kind — 标记 gold, 注意 blue, 撤退 red — and the partner's
 * all green (the official reading; kind still rides the wire). Each (side, kind) is its own highlight group so one group
 * never mixes colors; the server's m.public.marks is the single source (ui/matchStatus.js markSides).
 */
export const MARK_KINDS = Object.freeze(['mark', 'note', 'retreat']);
export const MARK_OWN_KIND = Object.freeze({
  mark: Object.freeze({ group: 'markOwnMark', color: 0xffd45a, fill: 0.32, line: 1 }),
  note: Object.freeze({ group: 'markOwnNote', color: 0x66b8ff, fill: 0.32, line: 1 }),
  retreat: Object.freeze({ group: 'markOwnRetreat', color: 0xff6b5a, fill: 0.32, line: 1 }),
});
export const MARK_PARTNER = Object.freeze({ group: 'markPartner', color: 0x4fd07a, fill: 0.32, line: 1 });
