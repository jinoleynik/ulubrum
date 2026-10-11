/** Tunables for score, combat, skills, timer and coins. Board tunables live in core/config. */
export interface GameplayConfig {
  pointsPerTile: number;
  /** Tiles of one color that fill its bucket. */
  bucketCapacity: number;

  heroMaxHp: number;
  heroAttack: number;
  /** Bonus tiles: coins / HP / seconds / max HP / attack per (tile level × skill level). */
  bonusCoinBase: number;
  bonusMaxHpBase: number;
  bonusDamageBase: number;
  /** Bucket tile: gauge points per (tile level × skill level), out of `bucketCapacity`. */
  bonusBucketBase: number;
  bonusHealBase: number;
  bonusTimeUnit: number;

  enemiesPerRound: number;
  /** Coins an enemy drops when it dies, and the extra for each bonus it carries. */
  enemyCoinBase: number;
  enemyBonusCoins: number;
  enemyMaxHp: number;
  enemyAttack: number;
  /** Mild per-level growth: stat × (1 + scale × level). */
  enemyHpScale: number;
  enemyAtkScale: number;
  visibleEnemySlots: number;
  /** Seconds between hits from the current enemy. */
  enemyAttackInterval: number;

  /** Display and coin bonus only; running out never loses the round. */
  roundDurationSeconds: number;
  coinBonusPerSecondLeft: number;
  winCoinsMin: number;
  winCoinsMax: number;

  debuffDuration: number;
  heroPoisonPerTick: number;
  /** Hero damage multiplier while weakened. */
  weakenFactor: number;
  /** Seconds a color keeps its potency boost after an orange charge. */
  potencyDuration: number;
  /** Board spawn assist (see Match3Config.spawnAssist): level 1 value, and how much each level takes off. */
  spawnAssistStart: number;
  spawnAssistPerLevel: number;
  /** Endless skills (color base, passives) cost base × growth^level. */
  skillCostGrowth: number;
  /** Color base level that lets a color's ultimate be bought, and its price. */
  ultimateUnlockLevel: number;
  ultimateCost: number;
  maxSkillLevel: number;
  skillUpgradeBaseCost: number;
  skillUpgradeCostPerLevel: number;
}

export const defaultGameplay: Readonly<GameplayConfig> = {
  pointsPerTile: 10,
  bucketCapacity: 100,
  heroMaxHp: 100,
  heroAttack: 5,
  bonusCoinBase: 2,
  bonusMaxHpBase: 2,
  bonusDamageBase: 0.5,
  bonusBucketBase: 10,
  bonusHealBase: 3,
  bonusTimeUnit: 2,
  enemiesPerRound: 8,
  enemyCoinBase: 1,
  enemyBonusCoins: 3,
  enemyMaxHp: 30,
  enemyAttack: 4,
  enemyHpScale: 0.08,
  enemyAtkScale: 0.05,
  visibleEnemySlots: 3,
  enemyAttackInterval: 1,
  roundDurationSeconds: 90,
  coinBonusPerSecondLeft: 2,
  winCoinsMin: 15,
  winCoinsMax: 40,
  debuffDuration: 5,
  heroPoisonPerTick: 1,
  weakenFactor: 0.7,
  potencyDuration: 5,
  spawnAssistStart: 0.8,
  spawnAssistPerLevel: 0.01,
  skillCostGrowth: 1.15,
  ultimateUnlockLevel: 10,
  ultimateCost: 1500,
  maxSkillLevel: 5,
  skillUpgradeBaseCost: 40,
  skillUpgradeCostPerLevel: 25,
};
