import { Bonus } from '../core';
import type { GameplayConfig } from './config';

/** The 4+ match bonuses. Each must be unlocked in the skill tree (level ≥ 1) before it can spawn. */
export const BONUS_IDS = ['bomb', 'line', 'coin', 'heal', 'time', 'maxhp', 'damage', 'bucket'] as const;
export type BonusId = (typeof BONUS_IDS)[number];

export const BONUS_NAME: Record<BonusId, string> = {
  bomb: 'Bomb',
  line: 'Line',
  coin: 'Coin',
  heal: 'Heal',
  time: 'Time',
  maxhp: 'Max HP',
  damage: 'Damage',
  bucket: 'Bucket',
};

export const BONUS_BY_ID: Record<BonusId, Bonus> = {
  bomb: Bonus.Bomb,
  line: Bonus.Line,
  coin: Bonus.Coin,
  heal: Bonus.Heal,
  time: Bonus.Time,
  maxhp: Bonus.MaxHp,
  damage: Bonus.Damage,
  bucket: Bonus.Bucket,
};

export const bonusId = (b: Bonus): BonusId | null => BONUS_IDS[b - 1] ?? null;

export type BonusLevels = Record<BonusId, number>;

/** `level` is the tile level (1..4 from match length); `skill` is the skill-tree level. */
export const bonusFx = {
  bombTiles: (level: number, skill: number) => level + skill,
  coins: (gp: GameplayConfig, level: number, skill: number) => level * skill * gp.bonusCoinBase,
  heal: (gp: GameplayConfig, level: number, skill: number) => level * skill * gp.bonusHealBase,
  seconds: (gp: GameplayConfig, level: number, skill: number) => level * skill * gp.bonusTimeUnit,
  /** Max HP gained for the rest of the round. */
  maxHp: (gp: GameplayConfig, level: number, skill: number) => level * skill * gp.bonusMaxHpBase,
  /** Attack gained for the rest of the round. */
  damage: (gp: GameplayConfig, level: number, skill: number) => level * skill * gp.bonusDamageBase,
  /** Gauge points added to the bucket of the tile's color. */
  bucket: (gp: GameplayConfig, level: number, skill: number) => level * skill * gp.bonusBucketBase,
};

const LINE_PATTERN = ['', 'one ray', 'a row or column', 'a T-shaped beam', 'a full cross'] as const;
export const TILE_LEVEL_LENGTH = ['', '4', '5', '6', '7+'] as const;

export function describeBonus(gp: GameplayConfig, id: BonusId, skill: number): string {
  const s = Math.max(1, skill);
  const row = (f: (level: number) => string) => [1, 2, 3, 4].map((l) => `${TILE_LEVEL_LENGTH[l]}: ${f(l)}`).join(' · ');
  switch (id) {
    case 'bomb':
      return `Destroys random neighbours. ${row((l) => `${bonusFx.bombTiles(l, s)} tiles`)}`;
    case 'line':
      return `Fires beams on destruction. ${[1, 2, 3, 4].map((l) => `${TILE_LEVEL_LENGTH[l]}: ${LINE_PATTERN[l]}`).join(' · ')}`;
    case 'coin':
      return `Pays coins when destroyed. ${row((l) => `${bonusFx.coins(gp, l, s)}`)}`;
    case 'heal':
      return `Heals the hero when destroyed. ${row((l) => `${bonusFx.heal(gp, l, s)} HP`)}`;
    case 'time':
      return `Adds seconds to the clock (survival rounds take them off). ${row((l) => `${bonusFx.seconds(gp, l, s)}s`)}`;
    case 'maxhp':
      return `Raises max HP for this round. ${row((l) => `+${bonusFx.maxHp(gp, l, s)}`)}`;
    case 'damage':
      return `Raises attack for this round. ${row((l) => `+${Math.round(bonusFx.damage(gp, l, s) * 100) / 100}`)}`;
    case 'bucket':
      return `Fills the bucket of its own color. ${row((l) => `+${bonusFx.bucket(gp, l, s)}%`)}`;
  }
}
