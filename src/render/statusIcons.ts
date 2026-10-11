import type { Enemy, Hero } from '../session';

/** Compact status badges for the board's hero and enemy slots. */
export const enemyIcons = (e: Enemy): string =>
  `${e.frozenLeft > 0 ? '❄️' : ''}${e.slowLeft > 0 ? '🐌' : ''}${e.bounty ? '💰' : ''}${e.poison ? '☠️' : ''}`;

export const heroIcons = (h: Hero): string =>
  `${h.shield > 0 ? `🔰${h.shield}` : ''}${h.immuneLeft > 0 ? '✨' : ''}${h.weakenLeft > 0 ? '⬇️' : ''}${h.poisonLeft > 0 ? '☠️' : ''}${h.stunLeft > 0 ? '⚡' : ''}${h.silenceLeft > 0 ? '🔇' : ''}`;
