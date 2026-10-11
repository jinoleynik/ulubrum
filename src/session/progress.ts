import type { GameplayConfig } from './config';
import { LEVEL_COUNT } from './levels';
import { BONUS_IDS, type BonusId, type BonusLevels } from './bonuses';
import { COLOR_IDS, type ColorId } from './colors';
import { PASSIVE_IDS, type PassiveId, type PassiveLevels } from './passives';
import type { UltimateOwned } from './ultimates';
import { BRANCHES, defaultSkillLevels, endlessCost, type Branch, type SkillLevels, upgradeCost } from './skills';

/** The slice of localStorage the game needs. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const KEYS = {
  coins: 'Match3.Coins',
  highScore: 'Match3.HighScore',
  levelsCompleted: 'Match3.LevelsCompleted',
  skill: (color: ColorId, branch: Branch) => `Match3.Skill.${color}.${branch}`,
  bonus: (id: BonusId) => `Match3.Bonus.${id}`,
  passive: (id: PassiveId) => `Match3.Passive.${id}`,
  ultimate: (color: ColorId) => `Match3.Ultimate.${color}`,
} as const;

export class MemoryStore implements KeyValueStore {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** Coins, skill levels and high score, persisted through a key-value store. */
export class Progress {
  constructor(
    private readonly store: KeyValueStore,
    private readonly config: GameplayConfig,
  ) {}

  private readInt(key: string, fallback: number): number {
    let raw: string | null = null;
    try {
      raw = this.store.getItem(key);
    } catch {
      return fallback;
    }
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  private write(key: string, value: number): void {
    try {
      this.store.setItem(key, String(value));
    } catch {
      // Storage unavailable (private mode, quota): progress lasts for the page only.
    }
  }

  get coins(): number {
    return Math.max(0, this.readInt(KEYS.coins, 0));
  }
  get highScore(): number {
    return Math.max(0, this.readInt(KEYS.highScore, 0));
  }

  /** Highest level beaten, 0..LEVEL_COUNT. */
  get levelsCompleted(): number {
    return Math.min(LEVEL_COUNT, Math.max(0, this.readInt(KEYS.levelsCompleted, 0)));
  }

  /** Beating a level unlocks the next; replaying an old level never moves progress back. */
  completeLevel(level: number): void {
    if (level > this.levelsCompleted) this.write(KEYS.levelsCompleted, Math.min(LEVEL_COUNT, level));
  }

  isUnlocked(level: number): boolean {
    return level >= 1 && level <= LEVEL_COUNT && level <= this.levelsCompleted + 1;
  }

  addCoins(n: number): void {
    if (n > 0) this.write(KEYS.coins, this.coins + n);
  }

  /** Stores the score only if it beats the current high score. */
  submitScore(score: number): boolean {
    if (score <= this.highScore) return false;
    this.write(KEYS.highScore, score);
    return true;
  }

  /** Every branch starts at level 1, so each color works from the first run. */
  skillLevel(color: ColorId, branch: Branch): number {
    const level = Math.max(1, this.readInt(KEYS.skill(color, branch), 1));
    return branch === 'base' ? level : Math.min(this.config.maxSkillLevel, level); // the base branch is endless
  }

  /** The base branch never maxes out and gets dearer every level; the others stop at the max level. */
  isMaxed(color: ColorId, branch: Branch): boolean {
    return branch !== 'base' && this.skillLevel(color, branch) >= this.config.maxSkillLevel;
  }

  skillLevels(): SkillLevels {
    const out = defaultSkillLevels();
    for (const c of COLOR_IDS) for (const b of BRANCHES) out[c][b] = this.skillLevel(c, b);
    return out;
  }

  upgradeCost(color: ColorId, branch: Branch): number {
    const level = this.skillLevel(color, branch);
    return branch === 'base' ? endlessCost(this.config, level) : upgradeCost(this.config, level);
  }

  canUpgrade(color: ColorId, branch: Branch): boolean {
    return !this.isMaxed(color, branch) && this.coins >= this.upgradeCost(color, branch);
  }

  /** Spends coins and raises the level. Returns false when maxed out or too poor. */
  upgrade(color: ColorId, branch: Branch): boolean {
    if (!this.canUpgrade(color, branch)) return false;
    const cost = this.upgradeCost(color, branch);
    this.write(KEYS.coins, this.coins - cost);
    this.write(KEYS.skill(color, branch), this.skillLevel(color, branch) + 1);
    return true;
  }

  /** Bonus skills start locked (0); level 1 unlocks spawning. */
  bonusLevel(id: BonusId): number {
    return Math.min(this.config.maxSkillLevel, Math.max(0, this.readInt(KEYS.bonus(id), 0)));
  }

  bonusLevels(): BonusLevels {
    const out = {} as BonusLevels;
    for (const id of BONUS_IDS) out[id] = this.bonusLevel(id);
    return out;
  }

  bonusCost(id: BonusId): number {
    return upgradeCost(this.config, this.bonusLevel(id));
  }

  canUpgradeBonus(id: BonusId): boolean {
    return this.bonusLevel(id) < this.config.maxSkillLevel && this.coins >= this.bonusCost(id);
  }

  upgradeBonus(id: BonusId): boolean {
    if (!this.canUpgradeBonus(id)) return false;
    const cost = this.bonusCost(id);
    this.write(KEYS.coins, this.coins - cost);
    this.write(KEYS.bonus(id), this.bonusLevel(id) + 1);
    return true;
  }

  // ── passives: permanent, endless, coin-bought ──────────────────

  passiveLevel(id: PassiveId): number {
    return Math.max(0, this.readInt(KEYS.passive(id), 0));
  }

  passiveLevels(): PassiveLevels {
    const out = {} as PassiveLevels;
    for (const id of PASSIVE_IDS) out[id] = this.passiveLevel(id);
    return out;
  }

  passiveCost(id: PassiveId): number {
    return endlessCost(this.config, this.passiveLevel(id));
  }

  canUpgradePassive(id: PassiveId): boolean {
    return this.coins >= this.passiveCost(id);
  }

  upgradePassive(id: PassiveId): boolean {
    if (!this.canUpgradePassive(id)) return false;
    const cost = this.passiveCost(id);
    this.write(KEYS.coins, this.coins - cost);
    this.write(KEYS.passive(id), this.passiveLevel(id) + 1);
    return true;
  }

  // ── ultimates ────────────────────────────────────────────────

  hasUltimate(color: ColorId): boolean {
    return this.readInt(KEYS.ultimate(color), 0) === 1;
  }

  ultimates(): UltimateOwned {
    const out = {} as UltimateOwned;
    for (const c of COLOR_IDS) out[c] = this.hasUltimate(c);
    return out;
  }

  /** Buyable once the color's base skill reaches the unlock level; owned ultimates can't be bought again. */
  canBuyUltimate(color: ColorId): boolean {
    return (
      !this.hasUltimate(color) &&
      this.skillLevel(color, 'base') >= this.config.ultimateUnlockLevel &&
      this.coins >= this.config.ultimateCost
    );
  }

  buyUltimate(color: ColorId): boolean {
    if (!this.canBuyUltimate(color)) return false;
    this.write(KEYS.coins, this.coins - this.config.ultimateCost);
    this.write(KEYS.ultimate(color), 1);
    return true;
  }
}
