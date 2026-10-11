import { Bonus, Game, type DestroyedTile, type GameEvent, type Match3Config } from '../core';
import { mulberry32, type Rng } from '../core';
import { BONUS_BY_ID, BONUS_IDS, bonusFx, type BonusLevels } from './bonuses';
import { COLOR_IDS } from './colors';
import { ColorSystem } from './colorSystem';
import { CombatModel, type CombatEvent, type Outcome } from './combat';
import type { GameplayConfig } from './config';
import { assignBonuses, campaignRoster, dynamicRoster, type EnemyBonusId, type EnemyId } from './enemies';
import { enemiesForLevel, spawnAssistForLevel } from './levels';
import { passiveFx } from './passives';
import type { Progress } from './progress';
import { ScoreService } from './score';
import { fx, type SkillLevels } from './skills';
import { ULTIMATES, type UltimateOwned } from './ultimates';

export interface SessionOptions {
  seed: number;
  /** 1-based level; when set, it decides the enemy count. */
  level?: number;
  progress: Progress;
  board: Match3Config;
  gameplay: GameplayConfig;
  /** Campaign levels use a fixed roster; the timed modes draw a random one (rising debuffers). */
  mode?: 'campaign' | 'timeLimit' | 'survival';
  /** Overrides the roster the level and mode would pick. */
  roster?: EnemyId[];
  /** Time bonuses add seconds in a time-limit round and take them off in a survival round. */
  timeMode?: 'limit' | 'survival';
  /** Fixed starting layout, for tests. */
  layout?: string[];
  /** Rolls the victory coins. Defaults to a PRNG seeded from `seed`. */
  rng?: Rng;
}

export interface Reward {
  baseCoins: number;
  timeBonus: number;
  bonusCoins: number;
  total: number;
}

export type SessionEvent =
  | { kind: 'combat'; event: CombatEvent }
  | { kind: 'ended'; outcome: Exclude<Outcome, 'playing'>; reward: Reward | null };

/**
 * One round: wires the board's destroy waves into score, combat, bonus tiles and color skills,
 * runs the countdown, and halts the board when the round is decided.
 */
export class Session {
  readonly game: Game;
  readonly combat: CombatModel;
  readonly colors: ColorSystem;
  readonly score: ScoreService;
  readonly skills: SkillLevels;
  readonly level: number;
  /** Coins from bounties and Coin tiles this round. */
  bonusCoins = 0;
  readonly bonusSkills: BonusLevels;
  readonly ultimates: UltimateOwned;
  reward: Reward | null = null;

  private elapsed = 0;
  private readonly rng: Rng;
  private listeners = new Set<(e: SessionEvent) => void>();

  constructor(private readonly opts: SessionOptions) {
    const { progress } = opts;
    this.level = opts.level ?? 1;
    const mode = opts.mode ?? 'campaign';
    const roster =
      opts.roster ??
      (opts.level === undefined
        ? undefined
        : mode === 'campaign'
          ? campaignRoster(opts.level)
          : dynamicRoster(mulberry32(opts.seed ^ 0x7f4a7c15), enemiesForLevel(opts.level), opts.level));
    const count = roster?.length ?? (opts.level === undefined ? opts.gameplay.enemiesPerRound : enemiesForLevel(opts.level));
    // The hero stands on the first two columns above the board; the enemy queue fills the rest.
    const gameplay = { ...opts.gameplay, enemiesPerRound: count, visibleEnemySlots: Math.max(1, opts.board.width - 2) };
    const bonuses: EnemyBonusId[][] =
      roster && opts.level !== undefined ? assignBonuses(mulberry32(opts.level * 104729 + opts.seed * (mode === 'campaign' ? 0 : 1)), roster.length, opts.level) : [];
    this.skills = progress.skillLevels();
    this.bonusSkills = progress.bonusLevels();
    this.ultimates = progress.ultimates();
    this.rng = opts.rng ?? mulberry32(opts.seed ^ 0x9e3779b9);
    this.combat = new CombatModel(gameplay, mulberry32(opts.seed ^ 0x51ed270b), roster, opts.level ?? 0, bonuses);
    const passives = progress.passiveLevels();
    const { hero } = this.combat;
    hero.maxHp += passiveFx.maxHp(passives.maxhp);
    hero.hp = hero.maxHp;
    hero.attack += passiveFx.attack(passives.damage);
    this.combat.healMult = passiveFx.healMult(passives.heal);
    this.combat.shieldMult = passiveFx.shieldMult(passives.shield);
    this.score = new ScoreService(gameplay.pointsPerTile, (s) => progress.submitScore(s));
    const bonusSkills: Partial<Record<Bonus, number>> = {};
    for (const id of BONUS_IDS) bonusSkills[BONUS_BY_ID[id]] = this.bonusSkills[id];
    const board =
      opts.level === undefined ? opts.board : { ...opts.board, spawnAssist: spawnAssistForLevel(gameplay, opts.level) };
    this.game = new Game(board, { seed: opts.seed, layout: opts.layout, bonusSkills });
    // Orange's ultimate makes its Line tiles always fire a beam up at the enemies.
    this.game.forceBeamUp = (type) => this.ultimates[COLOR_IDS[type]] && ULTIMATES[COLOR_IDS[type]].bonus === Bonus.Line;
    this.colors = new ColorSystem({
      gp: gameplay,
      levels: this.skills,
      combat: this.combat,
      rng: mulberry32(opts.seed ^ 0x2545f491),
      marker: this.game,
      colorCount: opts.board.colorCount,
      onBounty: (coins) => (this.bonusCoins += coins),
    });

    this.game.on((e) => this.onGameEvent(e));
    this.combat.on((e) => {
      this.emit({ kind: 'combat', event: e });
      if (e.kind === 'steal') {
        const taken = Math.min(this.bonusCoins, e.amount);
        this.bonusCoins -= taken;
        e.enemy.loot += taken;
      } else if (e.kind === 'enemyDied') {
        this.bonusCoins += e.enemy.loot + e.enemy.coins; // a dead thief gives its loot back; bonus enemies pay more
        e.enemy.loot = 0;
      }
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
  /** Spends a full bucket on its color's timed buff. */
  activate(type: number): boolean {
    return this.combat.playing && this.colors.activate(type);
  }

  /**
   * Re-shuffle button: a fresh board, and the hero's buffs, every bucket and its buff
   * and every bonus on the board are cleared with it.
   */
  reshuffle(): boolean {
    if (!this.combat.playing || !this.game.reshuffle()) return false;
    this.colors.reset();
    this.combat.clearHeroBuffs();
    return true;
  }

  /** Seconds left on the display clock; hits 0 without ending the round. */
  get timeRemaining(): number {
    return Math.max(0, this.opts.gameplay.roundDurationSeconds - this.elapsed);
  }

  tick(dt: number): void {
    if (!this.combat.playing) return;
    this.elapsed += dt;
    this.game.locked = this.combat.hero.stunLeft > 0;
    this.game.tick(dt);
    this.colors.tick(dt);
    this.combat.tick(dt);
  }

  // ── debug actions (Debug menu) ───────────────────────────────

  debugHealHero(): void {
    this.combat.healHero(this.combat.hero.maxHp);
  }

  debugAddMoney(amount = 500): void {
    this.opts.progress.addCoins(amount);
  }

  debugKillFirstEnemy(): void {
    const e = this.combat.currentEnemy;
    if (e) this.combat.execute(e);
  }

  /** Kills every enemy, which wins the round through the normal path (reward, unlock, result). */
  debugKillAll(): void {
    for (let e = this.combat.currentEnemy; e; e = this.combat.currentEnemy) this.combat.execute(e);
  }

  /** Leaving mid-round: stop the board and bank the score. */
  leave(): void {
    this.game.halt();
    this.opts.progress.submitScore(this.score.score);
  }

  private onGameEvent(e: GameEvent): void {
    if (e.kind === 'waveDestroying') this.onWave(e.wave, e.tiles, e.player);
    else if (e.kind === 'chainFinished') {
      this.score.clearCombo();
      this.colors.endMove();
    }
  }

  /** Score, then bonus tiles, then the color skills (damage, procs, gauges). */
  private onWave(wave: number, tiles: DestroyedTile[], player: boolean): void {
    if (!this.combat.playing) return;

    this.score.add(tiles.length, wave);
    for (const t of tiles) this.onBonusTile(t);
    this.colors.onWave({ wave, tiles, player });
  }

  /**
   * Tile bonuses pay out as their tile is destroyed (Bomb and Line already acted on the board).
   * If the tile's color has its ultimate and it is the paired bonus, the ultimate fires too.
   */
  private onBonusTile(t: DestroyedTile): void {
    const gp = this.opts.gameplay;
    const id = BONUS_IDS[t.bonus - 1];
    if (!id) return;
    const skill = this.bonusSkills[id];
    if (skill <= 0) return;
    const color = COLOR_IDS[t.type];
    const ult = ULTIMATES[color];
    const owned = this.ultimates[color] && ult.bonus === t.bonus;
    const spatial = t.bonus === Bonus.Bomb || t.bonus === Bonus.Line;

    // The matching ultimate triples what these pay.
    const triple = owned && [Bonus.Coin, Bonus.Time, Bonus.MaxHp, Bonus.Damage].includes(t.bonus as never);
    if (!spatial) this.payBonus(t.bonus, t.bonusLevel, skill, triple ? 3 : 1, t.type);
    const { combat } = this;
    if (t.bonus === Bonus.Line) this.beamEnemies(t, owned);
    if (!owned) return;

    switch (t.bonus) {
      case Bonus.Bomb:
        for (const e of combat.enemies.filter((e) => e.hp > 0)) combat.damageEnemy(e, combat.tileDamage(1) * Math.max(1, t.blast));
        break;
      case Bonus.Heal:
        combat.healHero(combat.hero.maxHp);
        break;
      case Bonus.Damage:
        for (const e of combat.visibleEnemies) combat.poison(e, fx.violet.perTick(3), gp.debuffDuration);
        break;
      case Bonus.Bucket:
        this.colors.fillAllBuckets();
        break;
    }
  }

  /**
   * A Line's upward beam flies on into the enemy rows. The enemy standing in that column is hit;
   * with Orange's ultimate the hit is instant death (an unstoppable one loses 30% of its HP instead).
   */
  private beamEnemies(t: DestroyedTile, kills: boolean): void {
    if (t.beamColumn < 0) return;
    const { combat } = this;
    const e = combat.visibleEnemies[t.beamColumn - 2]; // columns 0-1 are the hero
    if (!e) return;
    if (!kills) combat.damageEnemy(e, combat.tileDamage(1) * (t.bonusLevel + 1));
    else if (e.template.traits.immune?.length === 4) combat.damageEnemy(e, e.maxHp * 0.3);
    else combat.execute(e);
  }

  private payBonus(bonus: Bonus, level: number, skill: number, mult: number, type: number): void {
    const gp = this.opts.gameplay;
    switch (bonus) {
      case Bonus.Coin: this.bonusCoins += bonusFx.coins(gp, level, skill) * mult; break;
      case Bonus.Heal: this.combat.healHero(bonusFx.heal(gp, level, skill) * mult); break;
      case Bonus.Time: this.shiftTime(bonusFx.seconds(gp, level, skill) * mult); break;
      case Bonus.MaxHp: this.combat.addMaxHp(bonusFx.maxHp(gp, level, skill) * mult); break;
      case Bonus.Damage: this.combat.addAttack(bonusFx.damage(gp, level, skill) * mult); break;
      case Bonus.Bucket: this.colors.fillBucket(type, bonusFx.bucket(gp, level, skill)); break;
    }
  }

  /** Moves the clock toward more time (limit) or toward the end (survival). */
  private shiftTime(seconds: number): void {
    this.elapsed += ((this.opts.timeMode ?? (this.opts.mode === 'survival' ? 'survival' : 'limit')) === 'survival' ? 1 : -1) * seconds;
  }

  /** Freezes the board, then pays out once on victory. */
  private end(outcome: Outcome): void {
    if (outcome === 'playing') return;
    const { progress, gameplay: gp } = this.opts;
    this.game.halt();
    progress.submitScore(this.score.score);
    if (outcome === 'won') {
      progress.completeLevel(this.level);
      const baseCoins = gp.winCoinsMin + Math.floor(this.rng() * (gp.winCoinsMax - gp.winCoinsMin + 1));
      const timeBonus = Math.floor(this.timeRemaining) * gp.coinBonusPerSecondLeft;
      const bonusCoins = this.bonusCoins;
      this.reward = { baseCoins, timeBonus, bonusCoins, total: baseCoins + timeBonus + bonusCoins };
      progress.addCoins(this.reward.total);
    } else {
      progress.addCoins(this.bonusCoins); // coins already collected are kept
    }
    this.emit({ kind: 'ended', outcome, reward: this.reward });
  }
}
