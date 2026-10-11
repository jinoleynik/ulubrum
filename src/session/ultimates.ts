import { Bonus } from '../core';
import type { ColorId } from './colors';
import type { GameplayConfig } from './config';

/**
 * One expensive ultimate per color, bought once the color's base skill reaches
 * `ultimateUnlockLevel`. It fires when a tile bonus of the paired type is destroyed
 * while sitting on a tile of that color. The tile bonus's own level doesn't matter.
 */
export interface Ultimate {
  name: string;
  /** The tile bonus that triggers it. */
  bonus: Bonus;
  text: string;
}

export const ULTIMATES: Record<ColorId, Ultimate> = {
  red: { name: 'Red Bomb', bonus: Bonus.Bomb, text: 'A red Bomb hits every enemy, queued ones too, for attack × tiles it exploded.' },
  green: { name: 'Green Heal', bonus: Bonus.Heal, text: 'A green Heal tile restores the hero to full health.' },
  blue: { name: 'Blue Time', bonus: Bonus.Time, text: 'A blue Time tile shifts the clock three times as far.' },
  yellow: { name: 'Yellow Fortune', bonus: Bonus.Coin, text: 'A yellow Coin tile pays three times the coins.' },
  white: { name: 'White Bulwark', bonus: Bonus.MaxHp, text: 'A white Max HP tile gives three times the max HP.' },
  orange: { name: 'Orange Beam', bonus: Bonus.Line, text: "An orange Line always fires a beam up the board, and the enemy it hits dies instantly (a Golem loses 30% HP)." },
  violet: { name: 'Violet Fury', bonus: Bonus.Damage, text: 'A violet Damage tile gives three times the attack and poisons every enemy on screen.' },
  cyan: { name: 'Cyan Overflow', bonus: Bonus.Bucket, text: 'A cyan Bucket tile fills every bucket to the top.' },
};

export const ultimateText = (c: GameplayConfig, color: ColorId): string =>
  `${ULTIMATES[color].text} Needs base Lv ${c.ultimateUnlockLevel}.`;

export type UltimateOwned = Record<ColorId, boolean>;
