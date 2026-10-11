import type { GameplayConfig } from './config';

/** Permanent, coin-bought upgrades that apply to every round. Endless: no maximum level. */
export const PASSIVE_IDS = ['maxhp', 'damage', 'shield', 'heal'] as const;
export type PassiveId = (typeof PASSIVE_IDS)[number];
export type PassiveLevels = Record<PassiveId, number>;

export const PASSIVE_NAME: Record<PassiveId, string> = {
  maxhp: '+ Max HP',
  damage: '+ Damage',
  shield: '+ Shield bonus',
  heal: '+ Heal bonus',
};

/** What `level` of each passive adds. Level 0 adds nothing. */
export const passiveFx = {
  maxHp: (level: number) => 10 * level,
  attack: (level: number) => 0.5 * level,
  shieldMult: (level: number) => 1 + 0.1 * level,
  healMult: (level: number) => 1 + 0.1 * level,
};

export function describePassive(_c: GameplayConfig, id: PassiveId, level: number): string {
  switch (id) {
    case 'maxhp':
      return `Hero max HP +${passiveFx.maxHp(level)} (+10 per level).`;
    case 'damage':
      return `Tile damage +${passiveFx.attack(level)} (+0.5 per level).`;
    case 'shield':
      return `Shields are ${Math.round((passiveFx.shieldMult(level) - 1) * 100)}% stronger (+10% per level).`;
    case 'heal':
      return `Healing is ${Math.round((passiveFx.healMult(level) - 1) * 100)}% stronger (+10% per level).`;
  }
}
