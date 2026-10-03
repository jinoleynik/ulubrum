import type { GameplayConfig } from './config';
import { SKILL_IDS, SkillId, type SkillLevels, upgradeCost } from './skills';

/** The slice of localStorage the game needs. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const KEYS = {
  coins: 'Match3.Coins',
  highScore: 'Match3.HighScore',
  skill: (id: SkillId) => `Match3.SkillLevel.${id}`,
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

  addCoins(n: number): void {
    if (n > 0) this.write(KEYS.coins, this.coins + n);
  }

  /** Stores the score only if it beats the current high score. */
  submitScore(score: number): boolean {
    if (score <= this.highScore) return false;
    this.write(KEYS.highScore, score);
    return true;
  }

  /** Heal and Explosion are unlocked at level 1 from the first run. */
  skillLevel(id: SkillId): number {
    return Math.min(this.config.maxSkillLevel, Math.max(1, this.readInt(KEYS.skill(id), 1)));
  }

  skillLevels(): SkillLevels {
    const out = {} as SkillLevels;
    for (const id of SKILL_IDS) out[id] = this.skillLevel(id);
    return out;
  }

  upgradeCost(id: SkillId): number {
    return upgradeCost(this.config, this.skillLevel(id));
  }

  canUpgrade(id: SkillId): boolean {
    return this.skillLevel(id) < this.config.maxSkillLevel && this.coins >= this.upgradeCost(id);
  }

  /** Spends coins and raises the level. Returns false when maxed out or too poor. */
  upgrade(id: SkillId): boolean {
    if (!this.canUpgrade(id)) return false;
    const cost = this.upgradeCost(id);
    this.write(KEYS.coins, this.coins - cost);
    this.write(KEYS.skill(id), this.skillLevel(id) + 1);
    return true;
  }
}
