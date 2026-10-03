import type { GameplayConfig } from './config';

export type EnemyKind = 'Zombie' | 'Orc' | 'Skeleton';
const KINDS: readonly EnemyKind[] = ['Zombie', 'Orc', 'Skeleton'];

export interface Unit {
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
}
export interface Enemy extends Unit {
  kind: EnemyKind;
}

export type Outcome = 'playing' | 'won' | 'lost';

export type CombatEvent =
  | { kind: 'damage'; amount: number; target: 'enemy' | 'hero' }
  | { kind: 'heal'; amount: number }
  | { kind: 'enemyDied'; enemy: Enemy }
  | { kind: 'outcome'; outcome: Outcome };

/** Hero vs a queue of enemies. Pure: time only moves through tick(dt). */
export class CombatModel {
  readonly hero: Unit;
  readonly enemies: Enemy[];
  outcome: Outcome = 'playing';

  private attackTimer = 0;
  private hot: { left: number; nextTick: number; perTick: number } | null = null;
  private listeners = new Set<(e: CombatEvent) => void>();

  constructor(private readonly config: GameplayConfig) {
    this.hero = { name: 'Hero', hp: config.heroMaxHp, maxHp: config.heroMaxHp, attack: config.heroAttack };
    this.enemies = Array.from({ length: config.enemiesPerRound }, (_, i) => ({
      kind: KINDS[i % KINDS.length],
      name: KINDS[i % KINDS.length],
      hp: config.enemyMaxHp,
      maxHp: config.enemyMaxHp,
      attack: config.enemyAttack,
    }));
  }

  on(l: (e: CombatEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(e: CombatEvent): void {
    for (const l of this.listeners) l(e);
  }

  get currentEnemy(): Enemy | undefined {
    return this.enemies.find((e) => e.hp > 0);
  }
  /** Alive enemies shown in the arena, current one first. */
  get visibleEnemies(): Enemy[] {
    return this.enemies.filter((e) => e.hp > 0).slice(0, this.config.visibleEnemySlots);
  }
  get enemiesLeft(): number {
    return this.enemies.filter((e) => e.hp > 0).length;
  }
  get playing(): boolean {
    return this.outcome === 'playing';
  }

  /** Counts per tile type destroyed this wave; green heals, everything else attacks. */
  onTilesMatched(counts: ReadonlyMap<number, number>, cascadeStack: number): void {
    if (!this.playing) return;
    const mult = Math.max(1, cascadeStack);
    let healTiles = 0;
    let attackTiles = 0;
    for (const [type, n] of counts) {
      if (type === this.config.healTileType) healTiles += n;
      else attackTiles += n;
    }
    if (healTiles > 0) this.healHero(healTiles * this.config.healPerTile * mult);
    if (attackTiles > 0) this.damageCurrentEnemy(attackTiles * this.hero.attack * mult);
  }

  healHero(amount: number): void {
    if (!this.playing || amount <= 0) return;
    const healed = Math.min(amount, this.hero.maxHp - this.hero.hp);
    this.hero.hp += healed;
    this.emit({ kind: 'heal', amount });
  }

  damageCurrentEnemy(amount: number): void {
    const enemy = this.currentEnemy;
    if (!this.playing || !enemy || amount <= 0) return;
    enemy.hp = Math.max(0, enemy.hp - amount);
    this.emit({ kind: 'damage', amount, target: 'enemy' });
    if (enemy.hp === 0) {
      this.emit({ kind: 'enemyDied', enemy });
      if (this.enemiesLeft === 0) this.finish('won');
    }
  }

  private damageHero(amount: number): void {
    this.hero.hp = Math.max(0, this.hero.hp - amount);
    this.emit({ kind: 'damage', amount, target: 'hero' });
    if (this.hero.hp === 0) this.finish('lost');
  }

  /** Restarting replaces any running heal over time. */
  startHealOverTime(): void {
    const c = this.config;
    this.hot = { left: c.healHotDuration, nextTick: c.healHotTickInterval, perTick: c.healHotPerTick };
  }

  tick(dt: number): void {
    if (!this.playing) return;
    const c = this.config;

    if (this.hot) {
      const hot = this.hot;
      let remaining = dt;
      while (remaining > 0 && hot.left > 0) {
        const step = Math.min(remaining, hot.nextTick, hot.left);
        remaining -= step;
        hot.nextTick -= step;
        hot.left -= step;
        if (hot.nextTick <= 1e-9) {
          hot.nextTick = c.healHotTickInterval;
          this.healHero(hot.perTick);
        }
      }
      if (hot.left <= 1e-9) this.hot = null;
    }

    this.attackTimer += dt;
    while (this.attackTimer >= c.enemyAttackInterval && this.playing) {
      this.attackTimer -= c.enemyAttackInterval;
      const enemy = this.currentEnemy;
      if (enemy) this.damageHero(enemy.attack);
    }
  }

  private finish(outcome: 'won' | 'lost'): void {
    if (!this.playing) return;
    this.outcome = outcome;
    this.emit({ kind: 'outcome', outcome });
  }
}
