/** Tunables for score, combat, skills, timer and coins. Board tunables live in core/config. */
export interface GameplayConfig {
  pointsPerTile: number;

  heroMaxHp: number;
  heroAttack: number;
  healPerTile: number;
  /** Tile type that heals the hero instead of damaging the enemy. */
  healTileType: number;

  enemiesPerRound: number;
  enemyMaxHp: number;
  enemyAttack: number;
  visibleEnemySlots: number;
  /** Seconds between hits from the current enemy. */
  enemyAttackInterval: number;

  /** Display and coin bonus only; running out never loses the round. */
  roundDurationSeconds: number;
  coinBonusPerSecondLeft: number;
  winCoinsMin: number;
  winCoinsMax: number;

  healChargerBaseAmount: number;
  healHotUnlockLevel: number;
  healHotDuration: number;
  healHotTickInterval: number;
  healHotPerTick: number;
  explosionEnemyDamageUnlockLevel: number;
  explosionEnemyDamage: number;
  maxSkillLevel: number;
  skillUpgradeBaseCost: number;
  skillUpgradeCostPerLevel: number;
}

export const defaultGameplay: Readonly<GameplayConfig> = {
  pointsPerTile: 10,
  heroMaxHp: 100,
  heroAttack: 5,
  healPerTile: 4,
  healTileType: 2,
  enemiesPerRound: 8,
  enemyMaxHp: 30,
  enemyAttack: 4,
  visibleEnemySlots: 3,
  enemyAttackInterval: 1,
  roundDurationSeconds: 90,
  coinBonusPerSecondLeft: 2,
  winCoinsMin: 15,
  winCoinsMax: 40,
  healChargerBaseAmount: 12,
  healHotUnlockLevel: 3,
  healHotDuration: 5,
  healHotTickInterval: 1,
  healHotPerTick: 3,
  explosionEnemyDamageUnlockLevel: 3,
  explosionEnemyDamage: 8,
  maxSkillLevel: 5,
  skillUpgradeBaseCost: 40,
  skillUpgradeCostPerLevel: 25,
};
