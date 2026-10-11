import type { Rng } from '../core';
import type { GameplayConfig } from './config';
import { ENEMIES, ENEMY_BONUSES, enemyAtk, enemyHp, enemyRange, type EnemyBonusId, type EnemyId, type EnemyTemplate, type Immunity } from './enemies';

export interface Unit {
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
}

export interface Poison {
  ticksLeft: number;
  perTick: number;
  clock: number;
}

export interface Enemy extends Unit {
  template: EnemyTemplate;
  /** Seconds left on each status; 0 means off. */
  slowLeft: number;
  slowPct: number;
  frozenLeft: number;
  bounty: boolean;
  poison: Poison | null;
  attackTimer: number;
  /** Seconds between this enemy's hits, before slow and haste. */
  interval: number;
  bonuses: readonly EnemyBonusId[];
  /** Tiles from the hero this enemy can attack from (1 = melee: only the front enemy). */
  range: number;
  /** Coins dropped on death: more when the enemy carries bonuses. */
  coins: number;
  /** Coins a goblin has stolen; returned when it dies. */
  loot: number;
  mendClock: number;
}

export interface Hero extends Unit {
  shield: number;
  weakenLeft: number;
  poisonLeft: number;
  immuneLeft: number;
  stunLeft: number;
  silenceLeft: number;
}

export type Outcome = 'playing' | 'won' | 'lost';

export type Status =
  | 'slow' | 'freeze' | 'bounty' | 'poison' | 'weaken' | 'immune' | 'cleanse' | 'execute' | 'detonate'
  | 'stun' | 'silence' | 'mend';

export type CombatEvent =
  | { kind: 'damage'; amount: number; target: 'enemy' | 'hero'; crit?: boolean; enemy?: Enemy }
  | { kind: 'heal'; amount: number; target: 'hero' | 'enemy'; enemy?: Enemy }
  | { kind: 'shield'; amount: number }
  | { kind: 'absorbed'; amount: number }
  | { kind: 'status'; target: 'enemy' | 'hero'; status: Status }
  | { kind: 'enemyAttack'; enemy: Enemy; distance: number }
  | { kind: 'steal'; enemy: Enemy; amount: number }
  | { kind: 'enemyDied'; enemy: Enemy }
  | { kind: 'outcome'; outcome: Outcome };

/** Hero vs a queue of enemies. Pure: time only moves through tick(dt). */
export class CombatModel {
  readonly hero: Hero;
  readonly enemies: Enemy[];
  outcome: Outcome = 'playing';
  /** Damage multiplier against poisoned enemies (1 = none). Set by the color skills. */
  vulnerability = 1;
  /** Permanent passives scale every heal and shield (1 = none). */
  healMult = 1;
  shieldMult = 1;

  private hot: { left: number; clock: number; perTick: number } | null = null;
  private heroPoisonClock = 0;
  private listeners = new Set<(e: CombatEvent) => void>();

  /**
   * `roster` picks the enemies in order (default: plain grunts). `level` scales their HP and
   * attack; 0 means unscaled. The rng rolls on-hit effects; the default never triggers them.
   */
  constructor(
    private readonly config: GameplayConfig,
    private readonly rng: Rng = () => 1,
    roster: readonly EnemyId[] = Array.from({ length: config.enemiesPerRound }, () => 'grunt' as const),
    level = 0,
    bonuses: readonly (readonly EnemyBonusId[])[] = [],
  ) {
    this.hero = {
      name: 'Hero',
      hp: config.heroMaxHp,
      maxHp: config.heroMaxHp,
      attack: config.heroAttack,
      shield: 0,
      weakenLeft: 0,
      poisonLeft: 0,
      immuneLeft: 0,
      stunLeft: 0,
      silenceLeft: 0,
    };
    this.enemies = roster.map((id, i) => {
      const t = ENEMIES[id] as EnemyTemplate;
      const perks = bonuses[i] ?? [];
      const mult = (key: 'hp' | 'atk' | 'interval') => perks.reduce((m, b) => m * ENEMY_BONUSES[b][key], 1);
      const hp = Math.max(1, Math.round(enemyHp(config, t, level) * mult('hp')));
      return {
      template: t,
      name: t.name,
      hp,
      maxHp: hp,
      attack: Math.round(enemyAtk(config, t, level) * mult('atk')),
      interval: config.enemyAttackInterval * t.interval * mult('interval'),
      bonuses: perks,
      range: enemyRange(t, perks),
      coins: config.enemyCoinBase + perks.length * config.enemyBonusCoins,
      loot: 0,
      mendClock: 0,
      slowLeft: 0,
      slowPct: 0,
      frozenLeft: 0,
      bounty: false,
      poison: null,
      attackTimer: 0,
      };
    });
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

  /** Damage one tile deals this wave: attack × cascade stack, reduced while weakened. */
  tileDamage(cascadeStack: number): number {
    const weak = this.hero.weakenLeft > 0 ? this.config.weakenFactor : 1;
    return this.hero.attack * Math.max(1, cascadeStack) * weak;
  }

  // ── hero ─────────────────────────────────────────────────────

  healHero(amount: number): void {
    if (!this.playing || amount <= 0) return;
    const scaled = amount * this.healMult;
    this.hero.hp = Math.min(this.hero.maxHp, this.hero.hp + scaled);
    this.emit({ kind: 'heal', amount: Math.round(scaled), target: 'hero' });
  }

  addShield(amount: number): void {
    const scaled = Math.round(amount * this.shieldMult);
    if (!this.playing || scaled < 1) return;
    this.hero.shield += scaled;
    this.emit({ kind: 'shield', amount: scaled });
  }

  /** Raises max HP (and current HP by as much) for the rest of the round. */
  addMaxHp(amount: number): void {
    if (amount <= 0) return;
    this.hero.maxHp += amount;
    this.hero.hp += amount;
    this.emit({ kind: 'heal', amount: Math.round(amount), target: 'hero' });
  }

  /** Raises the hero's attack for the rest of the round. */
  addAttack(amount: number): void {
    this.hero.attack += amount;
  }

  /** Restarting replaces any running heal over time. */
  startHealOverTime(duration: number, perTick: number): void {
    this.hot = { left: duration, clock: 0, perTick };
  }

  /** Drops the hero's shield, immunity and heal over time. Debuffs stay. */
  clearHeroBuffs(): void {
    this.hero.shield = 0;
    this.hero.immuneLeft = 0;
    this.hot = null;
  }

  cleanseHero(): void {
    const h = this.hero;
    if (h.weakenLeft <= 0 && h.poisonLeft <= 0 && h.stunLeft <= 0 && h.silenceLeft <= 0) return;
    h.weakenLeft = 0;
    h.poisonLeft = 0;
    h.stunLeft = 0;
    h.silenceLeft = 0;
    this.emit({ kind: 'status', target: 'hero', status: 'cleanse' });
  }

  grantImmunity(duration: number): void {
    this.hero.immuneLeft = Math.max(this.hero.immuneLeft, duration);
    this.emit({ kind: 'status', target: 'hero', status: 'immune' });
  }

  /**
   * Shields soak damage first; `burn` (Orc) makes each point of damage eat that many shield points.
   * Returns the HP actually lost.
   */
  private damageHero(amount: number, burn = 1): number {
    const h = this.hero;
    const soaked = Math.min(amount, h.shield / burn);
    if (soaked > 0) {
      h.shield = Math.max(0, h.shield - soaked * burn);
      this.emit({ kind: 'absorbed', amount: soaked });
    }
    const through = Math.round(amount - soaked);
    if (through <= 0) return 0;
    h.hp = Math.max(0, h.hp - through);
    this.emit({ kind: 'damage', amount: through, target: 'hero' });
    if (h.hp === 0) this.finish('lost');
    return through;
  }

  private debuffHero(status: 'weaken' | 'poison' | 'stun' | 'silence', seconds = this.config.debuffDuration): void {
    const h = this.hero;
    if (h.immuneLeft > 0) return;
    if (status === 'weaken') h.weakenLeft = seconds;
    else if (status === 'poison') h.poisonLeft = seconds;
    else if (status === 'stun') h.stunLeft = Math.max(h.stunLeft, seconds);
    else h.silenceLeft = Math.max(h.silenceLeft, seconds);
    this.emit({ kind: 'status', target: 'hero', status });
  }

  private resists(enemy: Enemy, what: Immunity): boolean {
    return !!enemy.template.traits.immune?.includes(what);
  }

  // ── enemies ──────────────────────────────────────────────────

  damageCurrentEnemy(amount: number, crit = false): void {
    const enemy = this.currentEnemy;
    if (enemy) this.damageEnemy(enemy, amount, crit);
  }

  damageEnemy(enemy: Enemy, amount: number, crit = false, dot = false): void {
    if (!this.playing || enemy.hp <= 0) return;
    const scaled = enemy.poison && !dot ? amount * this.vulnerability : amount;
    const dealt = Math.round(scaled);
    if (dealt <= 0) return;
    enemy.hp = Math.max(0, enemy.hp - dealt);
    this.emit({ kind: 'damage', amount: dealt, target: 'enemy', crit, enemy });
    if (enemy.hp === 0) this.onEnemyDown(enemy);
  }

  /** Instant kill, e.g. a bounty execution. */
  execute(enemy: Enemy): void {
    if (!this.playing || enemy.hp <= 0) return;
    enemy.hp = 0;
    this.emit({ kind: 'status', target: 'enemy', status: 'execute' });
    this.onEnemyDown(enemy);
  }

  private onEnemyDown(enemy: Enemy): void {
    this.emit({ kind: 'enemyDied', enemy });
    if (this.enemiesLeft === 0) this.finish('won');
  }

  /** Re-applying keeps the stronger slow and the longer timer; the log fires only on a fresh slow. */
  slow(enemy: Enemy, pct: number, duration: number): void {
    if (enemy.hp <= 0 || this.resists(enemy, 'slow')) return;
    if (enemy.slowLeft <= 0) this.emit({ kind: 'status', target: 'enemy', status: 'slow' });
    enemy.slowPct = enemy.slowLeft > 0 ? Math.max(enemy.slowPct, pct) : pct;
    enemy.slowLeft = Math.max(enemy.slowLeft, duration);
  }

  freeze(enemy: Enemy, duration: number): void {
    if (enemy.hp <= 0 || this.resists(enemy, 'freeze')) return;
    if (enemy.frozenLeft <= 0) this.emit({ kind: 'status', target: 'enemy', status: 'freeze' });
    enemy.frozenLeft = Math.max(enemy.frozenLeft, duration);
  }

  markBounty(enemy: Enemy): void {
    if (enemy.hp <= 0 || enemy.bounty || this.resists(enemy, 'bounty')) return;
    enemy.bounty = true;
    this.emit({ kind: 'status', target: 'enemy', status: 'bounty' });
  }

  /** Poisons for `duration` whole-second ticks; a fresh poison replaces the old one. */
  poison(enemy: Enemy, perTick: number, duration: number): void {
    if (enemy.hp <= 0 || this.resists(enemy, 'poison')) return;
    if (!enemy.poison) this.emit({ kind: 'status', target: 'enemy', status: 'poison' });
    enemy.poison = { ticksLeft: Math.ceil(duration), perTick, clock: 0 };
  }

  /** Every remaining poison tick lands at once. */
  detonatePoison(): void {
    let any = false;
    for (const e of this.enemies) {
      const p = e.poison;
      if (!p || e.hp <= 0) continue;
      any = true;
      e.poison = null;
      this.damageEnemy(e, p.ticksLeft * p.perTick, false, true);
    }
    if (any) this.emit({ kind: 'status', target: 'enemy', status: 'detonate' });
  }

  // ── time ─────────────────────────────────────────────────────

  tick(dt: number): void {
    if (!this.playing) return;
    this.tickHero(dt);
    // Who can strike: the nth enemy in line stands n tiles from the hero, so it needs range ≥ n.
    // Statuses count down over this frame, but they still govern the whole of it.
    const shown = this.visibleEnemies;
    const haste = (self: Enemy) => 1 + Math.max(0, ...shown.filter((e) => e !== self).map((e) => e.template.traits.haste ?? 0));
    const attackers = shown
      .map((e, i) => ({ e, distance: i + 1, frozen: e.frozenLeft > 0, pace: (e.slowLeft > 0 ? 1 - e.slowPct : 1) * haste(e) }))
      .filter((a) => a.distance <= a.e.range);
    for (const e of this.enemies) this.tickEnemyStatus(e, dt);
    this.tickMend(dt);
    for (const a of attackers) {
      const { e } = a;
      if (!this.playing) return;
      if (e.hp <= 0 || a.frozen) continue;
      e.attackTimer += dt * a.pace;
      while (e.attackTimer >= e.interval && this.playing && e.hp > 0) {
        e.attackTimer -= e.interval;
        this.enemyHit(e, a.distance);
      }
    }
  }

  /** One hit from the front enemy, plus whatever its archetype adds. */
  private enemyHit(enemy: Enemy, distance = 1): void {
    const t = enemy.template.traits;
    this.emit({ kind: 'enemyAttack', enemy, distance });
    const through = this.damageHero(enemy.attack, t.shieldBurn ?? 1);
    if (!this.playing) return;
    if (t.lifesteal && through > 0) this.healEnemy(enemy, Math.round(through * t.lifesteal));
    if (t.steal) this.emit({ kind: 'steal', enemy, amount: t.steal });
    if (enemy.attack <= 0) return;
    if (t.stun && this.rng() < t.stun.chance) this.debuffHero('stun', t.stun.seconds);
    if (t.silence && this.rng() < t.silence.chance) this.debuffHero('silence', t.silence.seconds);
    if (t.weaken && this.rng() < t.weaken) this.debuffHero('weaken');
    if (t.ignite && this.rng() < t.ignite) this.debuffHero('poison');
  }

  private healEnemy(enemy: Enemy, amount: number): void {
    const healed = Math.min(amount, enemy.maxHp - enemy.hp);
    if (healed <= 0 || enemy.hp <= 0) return;
    enemy.hp += healed;
    this.emit({ kind: 'heal', amount: healed, target: 'enemy', enemy });
  }

  /** Necromancers patch up the most hurt ally on screen. */
  private tickMend(dt: number): void {
    const shown = this.visibleEnemies;
    for (const healer of shown) {
      const m = healer.template.traits.mend;
      if (!m) continue;
      healer.mendClock += dt;
      if (healer.mendClock < m.every) continue;
      healer.mendClock -= m.every;
      const hurt = shown.filter((e) => e !== healer && e.hp < e.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (!hurt) continue;
      this.healEnemy(hurt, Math.ceil(hurt.maxHp * m.pct));
      this.emit({ kind: 'status', target: 'enemy', status: 'mend' });
    }
  }

  private tickHero(dt: number): void {
    const h = this.hero;
    if (this.hot) {
      const hot = this.hot;
      const step = Math.min(dt, hot.left);
      hot.left -= step;
      hot.clock += step;
      while (hot.clock >= 1 - 1e-9) {
        hot.clock -= 1;
        this.healHero(hot.perTick);
      }
      if (hot.left <= 1e-9) this.hot = null;
    }
    h.weakenLeft = Math.max(0, h.weakenLeft - dt);
    h.stunLeft = Math.max(0, h.stunLeft - dt);
    h.silenceLeft = Math.max(0, h.silenceLeft - dt);
    h.immuneLeft = Math.max(0, h.immuneLeft - dt);
    if (h.poisonLeft > 0) {
      h.poisonLeft = Math.max(0, h.poisonLeft - dt);
      this.heroPoisonClock += dt;
      while (this.heroPoisonClock >= 1 && this.playing) {
        this.heroPoisonClock -= 1;
        this.damageHero(this.config.heroPoisonPerTick);
      }
    } else {
      this.heroPoisonClock = 0;
    }
  }

  private tickEnemyStatus(e: Enemy, dt: number): void {
    if (e.hp <= 0) return;
    e.slowLeft = Math.max(0, e.slowLeft - dt);
    e.frozenLeft = Math.max(0, e.frozenLeft - dt);
    const p = e.poison;
    if (!p) return;
    p.clock += dt;
    while (p.clock >= 1 && p.ticksLeft > 0 && e.hp > 0 && this.playing) {
      p.clock -= 1;
      p.ticksLeft--;
      this.damageEnemy(e, p.perTick, false, true);
    }
    if (p.ticksLeft <= 0) e.poison = null;
  }

  private finish(outcome: 'won' | 'lost'): void {
    if (!this.playing) return;
    this.outcome = outcome;
    this.emit({ kind: 'outcome', outcome });
  }
}
