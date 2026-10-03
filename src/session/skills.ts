import type { GameplayConfig } from './config';

export const SkillId = { Heal: 'heal', Explosion: 'explosion' } as const;
export type SkillId = (typeof SkillId)[keyof typeof SkillId];
export const SKILL_IDS: readonly SkillId[] = [SkillId.Heal, SkillId.Explosion];

export type SkillLevels = Record<SkillId, number>;

/** Pure skill math; levels are passed in so nothing here touches storage. */
export const healAmount = (c: GameplayConfig, level: number): number => c.healChargerBaseAmount * level;
export const hasHealOverTime = (c: GameplayConfig, level: number): boolean => level >= c.healHotUnlockLevel;
export const explosionRadius = (level: number): number => Math.max(1, level);
export const damagesEnemiesOnExplode = (c: GameplayConfig, level: number): boolean =>
  level >= c.explosionEnemyDamageUnlockLevel;
export const explosionEnemyDamage = (c: GameplayConfig, level: number): number => c.explosionEnemyDamage * level;
export const upgradeCost = (c: GameplayConfig, level: number): number =>
  c.skillUpgradeBaseCost + level * c.skillUpgradeCostPerLevel;

export function describeSkill(c: GameplayConfig, id: SkillId, level: number): string {
  if (id === SkillId.Heal) {
    const hot = hasHealOverTime(c, level)
      ? ` Then +${c.healHotPerTick}/s for ${c.healHotDuration}s.`
      : ` Level ${c.healHotUnlockLevel} adds heal over time.`;
    return `Heals ${healAmount(c, level)} HP when a marked green tile clears.${hot}`;
  }
  const dmg = damagesEnemiesOnExplode(c, level)
    ? ` Also hits the enemy for ${explosionEnemyDamage(c, level)}.`
    : ` Level ${c.explosionEnemyDamageUnlockLevel} also damages the enemy.`;
  const r = explosionRadius(level);
  return `A marked red tile clears a ${2 * r + 1}×${2 * r + 1} square around it.${dmg}`;
}
