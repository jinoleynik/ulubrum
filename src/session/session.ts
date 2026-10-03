import { Charger, Game, type DestroyedTile, type GameEvent, type Match3Config } from '../core';
import { mulberry32, type Rng } from '../core';
import { CombatModel, type CombatEvent, type Outcome } from './combat';
import type { GameplayConfig } from './config';
import type { Progress } from './progress';
import { ScoreService } from './score';
import {
  damagesEnemiesOnExplode,
  explosionEnemyDamage,
  hasHealOverTime,
  healAmount,
  SkillId,
  type SkillLevels,
} from './skills';

export interface SessionOptions {
  seed: number;
  progress: Progress;
  board: Match3Config;
  gameplay: GameplayConfig;
  /** Fixed starting layout, for tests. */
  layout?: string[];
  /** Rolls the victory coins. Defaults to a PRNG seeded from `seed`. */
  rng?: Rng;
}

export interface Reward {
  baseCoins: number;
  timeBonus: number;
  total: number;
}

export type SessionEvent =
  | { kind: 'combat'; event: CombatEvent }
  | { kind: 'ended'; outcome: Exclude<Outcome, 'playing'>; reward: Reward | null };

/**
 * One round: wires the board's destroy waves into score, combat and charger effects,
 * runs the countdown, and halts the board when the round is decided.
 */
export class Session {
  readonly game: Game;
  readonly combat: CombatModel;
  readonly score: ScoreService;
  readonly skills: SkillLevels;
  reward: Reward | null = null;

  private elapsed = 0;
  private readonly rng: Rng;
  private listeners = new Set<(e: SessionEvent) => void>();

  constructor(private readonly opts: SessionOptions) {
    const { progress, gameplay } = opts;
    this.skills = progress.skillLevels();
    this.rng = opts.rng ?? mulberry32(opts.seed ^ 0x9e3779b9);
    this.combat = new CombatModel(gameplay);
    this.score = new ScoreService(gameplay.pointsPerTile, (s) => progress.submitScore(s));
    this.game = new Game(opts.board, {
      seed: opts.seed,
      layout: opts.layout,
      chargerSkills: { heal: this.skills[SkillId.Heal], explosion: this.skills[SkillId.Explosion] },
    });

    this.game.on((e) => this.onGameEvent(e));
    this.combat.on((e) => {
      this.emit({ kind: 'combat', event: e });
      if (e.kind === 'outcome') this.end(e.outcome);
    });
  }

  on(l: (e: SessionEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }

  get outcome(): Outcome {
    return this.combat.outcome;
  }
  /** Seconds left on the display clock; hits 0 without ending the round. */
  get timeRemaining(): number {
    return Math.max(0, this.opts.gameplay.roundDurationSeconds - this.elapsed);
  }

  tick(dt: number): void {
    if (!this.combat.playing) return;
    this.elapsed += dt;
    this.game.tick(dt);
    this.combat.tick(dt);
  }

  /** Leaving mid-round: stop the board and bank the score. */
  leave(): void {
    this.game.halt();
    this.opts.progress.submitScore(this.score.score);
  }

  private onGameEvent(e: GameEvent): void {
    if (e.kind === 'waveDestroying') this.onWave(e.wave, e.tiles);
    else if (e.kind === 'chainFinished') this.score.clearCombo();
  }

  /** Score, then match damage/heal, then charger effects, in that order. */
  private onWave(wave: number, tiles: DestroyedTile[]): void {
    if (!this.combat.playing) return;
    const gp = this.opts.gameplay;

    this.score.add(tiles.length, wave);

    const counts = new Map<number, number>();
    for (const t of tiles) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
    this.combat.onTilesMatched(counts, wave);

    const healLevel = this.skills[SkillId.Heal];
    const boomLevel = this.skills[SkillId.Explosion];
    let boomHit = false;
    for (const t of tiles) {
      if (t.charger === Charger.Heal) {
        this.combat.healHero(healAmount(gp, healLevel));
        if (hasHealOverTime(gp, healLevel)) this.combat.startHealOverTime();
      } else if (t.charger === Charger.Explosion && !boomHit && damagesEnemiesOnExplode(gp, boomLevel)) {
        boomHit = true;
        this.combat.damageCurrentEnemy(explosionEnemyDamage(gp, boomLevel));
      }
    }
  }

  /** Freezes the board, then pays out once on victory. */
  private end(outcome: Outcome): void {
    if (outcome === 'playing') return;
    const { progress, gameplay: gp } = this.opts;
    this.game.halt();
    progress.submitScore(this.score.score);
    if (outcome === 'won') {
      const baseCoins = gp.winCoinsMin + Math.floor(this.rng() * (gp.winCoinsMax - gp.winCoinsMin + 1));
      const timeBonus = Math.floor(this.timeRemaining) * gp.coinBonusPerSecondLeft;
      this.reward = { baseCoins, timeBonus, total: baseCoins + timeBonus };
      progress.addCoins(this.reward.total);
    }
    this.emit({ kind: 'ended', outcome, reward: this.reward });
  }
}
