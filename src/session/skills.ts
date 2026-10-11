import type { GameplayConfig } from './config';
import { COLOR_IDS, type ColorId } from './colors';

/** Every color has three separately upgraded branches. */
export const BRANCHES = ['base', 'empowered', 'activation'] as const;
export type Branch = (typeof BRANCHES)[number];

export const BRANCH_NAME: Record<Branch, string> = {
  base: 'Base',
  empowered: 'Full bucket',
  activation: 'Activation',
};

export type SkillLevels = Record<ColorId, Record<Branch, number>>;

export function defaultSkillLevels(): SkillLevels {
  const out = {} as SkillLevels;
  for (const c of COLOR_IDS) out[c] = { base: 1, empowered: 1, activation: 1 };
  return out;
}

/** Endless levels get steadily dearer: base × growth^level. */
export const endlessCost = (c: GameplayConfig, level: number): number =>
  Math.round(c.skillUpgradeBaseCost * c.skillCostGrowth ** level);

export const upgradeCost = (c: GameplayConfig, level: number): number =>
  c.skillUpgradeBaseCost + level * c.skillUpgradeCostPerLevel;

const up = (level: number): number => Math.max(0, level - 1);

/**
 * How destroyed tiles feed a proc. The skill level never changes a proc chance, only how big the
 * effect is. Each tile beyond the third in the matching group adds a little chance and scales the effect.
 */
export const PROC = { perExtraTile: 0.06, valuePerExtraTile: 0.2, cap: 0.95, freeTiles: 3 } as const;

/** Tiles beyond the free three; 4 matched tiles = 1 extra. */
export const extraTiles = (count: number): number => Math.max(0, count - PROC.freeTiles);
export const procChance = (base: number, extra: number): number => Math.min(PROC.cap, base + PROC.perExtraTile * extra);
/**
 * Filling a color's bucket (out of `bucketCapacity`, 100). Each extra tile in a destroy is worth more
 * than the one before, and every consecutive destroy of the same color raises the whole amount.
 */
export const FILL = { perTile: 5, growth: 0.25, streak: 0.25 } as const;

/** Gauge points from destroying `n` tiles of a color that has been destroyed `streak` times in a row. */
export const fillAmount = (n: number, streak = 0): number =>
  n <= 0 ? 0 : FILL.perTile * (n + (FILL.growth * n * (n - 1)) / 2) * (1 + FILL.streak * streak);

export const tileScale = (extra: number): number => 1 + PROC.valuePerExtraTile * extra;

/**
 * Pure skill math. `L` is the branch level; chances are fixed numbers, values grow with it.
 * Base: own-color procs (endless levels). Empowered: needs a full bucket. Activation: the timed buff.
 */
export const fx = {
  /** Shared by every color's activation branch. */
  duration: (L: number) => 6 + up(L),
  /** Fraction shaved off this color's bucket size by its activation level. */
  bucketCut: (L: number) => Math.min(0.5, 0.05 * up(L)),

  green: {
    chance: 0.25,
    heal: (L: number) => 10 + 3 * up(L),
    anyChance: 0.15,
    hotPerTick: (L: number) => 3 + up(L),
  },
  red: {
    chance: 0.2,
    critMult: (L: number) => 2 + 0.2 * up(L),
    splashChance: 0.3,
    splashPct: (L: number) => Math.min(1.5, 0.5 + 0.1 * up(L)),
  },
  blue: {
    chance: 0.25,
    slowPct: (L: number) => Math.min(0.9, 0.4 + 0.02 * up(L)),
    slowDuration: (L: number) => 4 + 0.5 * up(L),
    freezeChance: 0.5,
    freezeDuration: (L: number) => 1.5 + 0.3 * up(L),
  },
  yellow: {
    chance: 0.25,
    coins: (L: number) => 5 + 3 * up(L),
    /** Bounty enemies at or below this share of max HP are executed. */
    executeBelow: (L: number) => Math.min(0.9, 0.4 + 0.1 * up(L)),
  },
  white: {
    chance: 0.3,
    shieldPct: (L: number) => 0.6 + 0.1 * up(L),
    anyChance: 0.2,
    /** Gauge points added to every gauge per absorbed point of damage. */
    refuel: (L: number) => 0.25 + 0.1 * up(L),
    shieldBoost: (L: number) => 1.5 + 0.15 * up(L),
  },
  orange: {
    chance: 0.25,
    /** Gauge points added to a random bucket (out of 100). */
    charge: (L: number) => 15 + 5 * up(L),
    anyChance: 0.15,
    potency: (L: number) => 1.3 + 0.1 * up(L),
    /** Cut to every bucket's size while the buff runs. */
    bucketCut: (L: number) => Math.min(0.7, 0.5 + 0.05 * up(L)),
  },
  violet: {
    chance: 0.25,
    perTick: (L: number) => 2 + up(L),
    anyChance: 0.15,
    vulnerability: (L: number) => 1.25 + 0.05 * up(L),
  },
  cyan: {
    chance: 0.25,
    /** Universal tiles made per proc. */
    count: (L: number) => 1 + Math.floor(up(L) / 5),
    buffChance: 0.6,
    perMatch: (L: number) => (L >= 4 ? 2 : 1),
  },
} as const;

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const secs = (v: number): string => `${Math.round(v * 10) / 10}s`;
const x = (v: number): string => `×${Math.round(v * 100) / 100}`;

/** Appended to every base description: how matching more tiles helps. */
const GROWTH = ` Each tile beyond ${PROC.freeTiles} adds +${Math.round(PROC.perExtraTile * 100)}% chance and +${Math.round(PROC.valuePerExtraTile * 100)}% effect.`;

export function describeSkill(c: GameplayConfig, color: ColorId, branch: Branch, L: number): string {
  const cut = L > 1 ? ` Bucket needs ${pct(fx.bucketCut(L))} fewer tiles.` : '';
  switch (`${color}.${branch}` as const) {
    case 'green.base':
      return `${pct(fx.green.chance)} chance to heal ${fx.green.heal(L)} HP when green tiles clear.${GROWTH}`;
    case 'green.empowered':
      return `Full bucket: ${pct(fx.green.anyChance)} chance to heal on any color.`;
    case 'green.activation':
      return `Heal over time: ${fx.green.hotPerTick(L)} HP/s for ${secs(fx.duration(L))}.${cut}`;
    case 'red.base':
      return `${pct(fx.red.chance)} chance that red tiles hit critically for ${x(fx.red.critMult(L))}.${GROWTH}`;
    case 'red.empowered':
      return `Full bucket: crits have ${pct(fx.red.splashChance)} chance to splash ${pct(fx.red.splashPct(L))} damage to all enemies.`;
    case 'red.activation':
      return `Red tiles always crit and splash for ${secs(fx.duration(L))}.${cut}`;
    case 'blue.base':
      return `${pct(fx.blue.chance)} chance to slow the enemy ${pct(fx.blue.slowPct(L))} for ${secs(fx.blue.slowDuration(L))}.${GROWTH}`;
    case 'blue.empowered':
      return `Full bucket: slow becomes a ${secs(fx.blue.freezeDuration(L))} freeze ${pct(fx.blue.freezeChance)} of the time.`;
    case 'blue.activation':
      return `Slows every enemy and blue tiles always freeze, for ${secs(fx.duration(L))}.${cut}`;
    case 'yellow.base':
      return `${pct(fx.yellow.chance)} chance to put a bounty on the enemy: +${fx.yellow.coins(L)} coins when it dies.${GROWTH}`;
    case 'yellow.empowered':
      return `Full bucket: a bounty enemy below ${pct(fx.yellow.executeBelow(L))} HP is executed when hit; bounty coins double.`;
    case 'yellow.activation':
      return `Every enemy on screen carries a bounty for ${secs(fx.duration(L))}.${cut}`;
    case 'white.base':
      return `${pct(fx.white.chance)} chance that white tiles grant a shield worth ${pct(fx.white.shieldPct(L))} of match damage.${GROWTH}`;
    case 'white.empowered':
      return `Full bucket: shield chance ${pct(fx.white.anyChance)} on any color; absorbed damage refuels every gauge.`;
    case 'white.activation':
      return `Cleanse debuffs, block new ones, and shields ${x(fx.white.shieldBoost(L))} stronger for ${secs(fx.duration(L))}.${cut}`;
    case 'orange.base':
      return `${pct(fx.orange.chance)} chance that orange tiles fill a random bucket by ${fx.orange.charge(L)}%.${GROWTH}`;
    case 'orange.empowered':
      return `Full bucket: ${pct(fx.orange.anyChance)} chance on any color; a charged color gets ${x(fx.orange.potency(L))} potency for ${secs(c.potencyDuration)}.`;
    case 'orange.activation':
      return `Every bucket needs ${pct(fx.orange.bucketCut(L))} fewer tiles for ${secs(fx.duration(L))}.${cut}`;
    case 'violet.base':
      return `${pct(fx.violet.chance)} chance to poison the enemy for ${fx.violet.perTick(L)}/s.${GROWTH}`;
    case 'violet.empowered':
      return `Full bucket: ${pct(fx.violet.anyChance)} chance on any color; poisoned enemies take ${x(fx.violet.vulnerability(L))} damage.`;
    case 'violet.activation':
      return `Poison all enemies; violet tiles detonate every poison tick, for ${secs(fx.duration(L))}.${cut}`;
    case 'cyan.base':
      return `${pct(fx.cyan.chance)} chance that cyan tiles turn ${fx.cyan.count(L)} random tile(s) Universal (wild on your swaps).${GROWTH}`;
    case 'cyan.empowered':
      return `Full bucket: matching a Universal tile gives a random tile a buff (${pct(fx.cyan.buffChance)}).`;
    case 'cyan.activation':
      return `After each of your matches, ${fx.cyan.perMatch(L)} random tile(s) become Universal or Improved, for ${secs(fx.duration(L))}.${cut}`;
  }
}
