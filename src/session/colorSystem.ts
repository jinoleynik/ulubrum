import { Bonus, type DestroyedTile, type Rng } from '../core';
import { COLOR_IDS, typeOfColor } from './colors';
import type { CombatModel, Enemy } from './combat';
import type { GameplayConfig } from './config';
import { extraTiles, fillAmount, fx, procChance, tileScale, type Branch, type SkillLevels } from './skills';

/** What the color skills need from the board. Implemented by Game. */
export interface TileMarker {
  queueUniversal(count?: number): void;
  queueBonus(bonus: Bonus, level?: number): void;
  unlockedBonuses(): Bonus[];
}

export interface WaveInfo {
  wave: number;
  tiles: DestroyedTile[];
  /** The wave a player swap started (not an auto-cascade). */
  player: boolean;
}

export interface ColorSystemDeps {
  gp: GameplayConfig;
  levels: SkillLevels;
  combat: CombatModel;
  rng: Rng;
  marker: TileMarker;
  colorCount: number;
  /** Bounty coins earned from a kill. */
  onBounty: (coins: number) => void;
}

const T = {
  red: typeOfColor('red'),
  blue: typeOfColor('blue'),
  green: typeOfColor('green'),
  yellow: typeOfColor('yellow'),
  white: typeOfColor('white'),
  orange: typeOfColor('orange'),
  violet: typeOfColor('violet'),
  cyan: typeOfColor('cyan'),
};

/**
 * Per-color buckets and skills. Tiles of a color fill its gauge; a full gauge turns on the
 * color's empowered passive and can be spent on its timed activation buff.
 */
export class ColorSystem {
  /** Tiles collected per color. */
  readonly gauges: number[];
  /** Seconds left on each color's activation buff. */
  readonly buffs: number[];
  /** Consecutive destroys of each color; other colors' waves never reset it, only a player move that skips the color. */
  readonly streaks: number[];
  private readonly seenThisMove: boolean[];
  private playerMove = false;
  /** Seconds left on each color's orange potency boost. */
  private readonly boosts: number[];

  constructor(private readonly d: ColorSystemDeps) {
    this.gauges = new Array<number>(d.colorCount).fill(0);
    this.buffs = new Array<number>(d.colorCount).fill(0);
    this.boosts = new Array<number>(d.colorCount).fill(0);
    this.streaks = new Array<number>(d.colorCount).fill(0);
    this.seenThisMove = new Array<boolean>(d.colorCount).fill(false);
    d.combat.on((e) => {
      if (e.kind === 'enemyDied') this.onEnemyDied(e.enemy);
      else if (e.kind === 'absorbed') this.onAbsorbed(e.amount);
    });
  }

  // ── state ────────────────────────────────────────────────────

  level(type: number, branch: Branch): number {
    return this.d.levels[COLOR_IDS[type]][branch];
  }

  /** Tiles needed to fill a bucket, after the color's own cut and orange's buff. */
  capacity(type: number): number {
    let cap = this.d.gp.bucketCapacity * (1 - fx.bucketCut(this.level(type, 'activation')));
    if (this.buffs[T.orange] > 0) cap *= 1 - fx.orange.bucketCut(this.level(T.orange, 'activation'));
    return Math.max(1, Math.round(cap));
  }

  ready(type: number): boolean {
    return this.gauges[type] >= this.capacity(type);
  }

  active(type: number): boolean {
    return this.buffs[type] > 0;
  }

  private has(type: number): boolean {
    return type < this.d.colorCount;
  }

  /** Bucket tile / ultimate: adds gauge points to one color's bucket. */
  fillBucket(type: number, amount: number): void {
    if (this.has(type)) this.addGauge(type, amount);
  }

  /** Cyan's ultimate: every bucket to the top. */
  fillAllBuckets(): void {
    for (let t = 0; t < this.gauges.length; t++) this.gauges[t] = this.capacity(t);
  }

  /** The player's move has fully resolved: colors it never destroyed lose their streak. */
  endMove(): void {
    if (this.playerMove) {
      for (let t = 0; t < this.streaks.length; t++) if (!this.seenThisMove[t]) this.streaks[t] = 0;
    }
    this.seenThisMove.fill(false);
    this.playerMove = false;
  }

  /** Orange can leave a color's gauge above the (now smaller) capacity; keep it displayable. */
  private addGauge(type: number, amount: number): void {
    this.gauges[type] = Math.min(this.capacity(type), this.gauges[type] + amount);
  }

  private potency(type: number): number {
    return this.boosts[type] > 0 ? fx.orange.potency(this.level(T.orange, 'empowered')) : 1;
  }

  /** Empties every gauge and ends every buff and boost. */
  reset(): void {
    this.gauges.fill(0);
    this.buffs.fill(0);
    this.boosts.fill(0);
    this.streaks.fill(0);
    this.seenThisMove.fill(false);
    this.applyOngoing();
  }

  // ── activation ───────────────────────────────────────────────

  /** Spends a full bucket and starts the color's buff. Nothing on the board is destroyed. */
  activate(type: number): boolean {
    if (!this.has(type) || !this.ready(type) || !this.d.combat.playing) return false;
    if (this.d.combat.hero.silenceLeft > 0) return false; // silenced: buckets stay shut
    const { combat } = this.d;
    const L = this.level(type, 'activation');
    const dur = fx.duration(L);
    this.gauges[type] = 0;
    this.buffs[type] = dur;
    switch (type) {
      case T.green:
        combat.startHealOverTime(dur, fx.green.hotPerTick(L));
        break;
      case T.white:
        combat.cleanseHero();
        combat.grantImmunity(dur);
        break;
      case T.violet:
        for (const e of combat.visibleEnemies) combat.poison(e, fx.violet.perTick(this.level(T.violet, 'base')), dur);
        break;
    }
    this.applyOngoing();
    return true;
  }

  /** Buff effects that cover whoever is on screen, including enemies that arrive later. */
  private applyOngoing(): void {
    const { combat } = this.d;
    if (this.buffs[T.blue] > 0) {
      const L = this.level(T.blue, 'activation');
      for (const e of combat.visibleEnemies) combat.slow(e, fx.blue.slowPct(L), 0.5);
    }
    if (this.buffs[T.yellow] > 0) for (const e of combat.visibleEnemies) combat.markBounty(e);
    combat.vulnerability = this.has(T.violet) && this.ready(T.violet) ? fx.violet.vulnerability(this.level(T.violet, 'empowered')) : 1;
  }

  tick(dt: number): void {
    for (let i = 0; i < this.buffs.length; i++) {
      this.buffs[i] = Math.max(0, this.buffs[i] - dt);
      this.boosts[i] = Math.max(0, this.boosts[i] - dt);
    }
    this.applyOngoing();
  }

  // ── waves ────────────────────────────────────────────────────

  onWave(info: WaveInfo): void {
    const { combat, rng, gp } = this.d;
    if (!combat.playing) return;
    this.applyOngoing();

    const n = new Array<number>(this.d.colorCount).fill(0);
    for (const t of info.tiles) n[t.type]++;
    const full = this.gauges.map((_, t) => this.ready(t)); // state as the wave starts
    const roll = (chance: number) => chance > 0 && rng() < Math.min(1, chance);
    const total = info.tiles.length;
    /** Tiles beyond the free three that feed this color's proc: its own, or the whole wave for an off-color proc. */
    const extra = (t: number) => extraTiles(n[t] > 0 ? n[t] : total);
    /** Own-color chance, or the empowered any-color chance once the bucket is full; both grow per extra tile. */
    const chance = (t: number, base: number, any: number) =>
      Math.max(n[t] > 0 ? procChance(base, extra(t)) : 0, full[t] ? procChance(any, extra(t)) : 0) * this.potency(t);
    /** Effect size: grows per extra tile, and with orange potency. */
    const scale = (t: number) => tileScale(extra(t)) * this.potency(t);

    const target = combat.currentEnemy;
    const unit = combat.tileDamage(info.wave);

    // Red: criticals and splash
    let crit = false;
    if (this.has(T.red) && n[T.red] > 0) {
      crit = this.buffs[T.red] > 0 || roll(chance(T.red, fx.red.chance, 0));
    }
    const critMult = crit ? (1 + (fx.red.critMult(this.level(T.red, 'base')) - 1) * tileScale(extra(T.red))) * this.potency(T.red) : 1;
    const redDamage = n[T.red] * unit * critMult;
    const damage = (info.tiles.length - n[T.red]) * unit + redDamage;

    if (target) {
      const bounty = this.has(T.yellow) && full[T.yellow] && target.bounty;
      if (bounty && target.hp / target.maxHp <= fx.yellow.executeBelow(this.level(T.yellow, 'empowered'))) {
        combat.execute(target);
      } else {
        combat.damageEnemy(target, damage, crit);
      }
    }
    if (crit) {
      const L = this.level(T.red, 'empowered');
      const always = this.buffs[T.red] > 0;
      if (always || (full[T.red] && roll(fx.red.splashChance * this.potency(T.red)))) {
        for (const e of combat.visibleEnemies) if (e !== target) combat.damageEnemy(e, redDamage * fx.red.splashPct(L));
      }
    }

    // Green: heal
    if (this.has(T.green) && roll(chance(T.green, fx.green.chance, fx.green.anyChance))) {
      combat.healHero(fx.green.heal(this.level(T.green, 'base')) * scale(T.green));
    }

    // Blue: slow, or freeze
    const current = combat.currentEnemy;
    if (this.has(T.blue) && n[T.blue] > 0 && current) {
      const L = this.level(T.blue, 'base');
      const guaranteed = this.buffs[T.blue] > 0;
      if (guaranteed || roll(chance(T.blue, fx.blue.chance, 0))) {
        const E = this.level(T.blue, 'empowered');
        const freezeDur = fx.blue.freezeDuration(E) * scale(T.blue);
        if (guaranteed || (full[T.blue] && roll(fx.blue.freezeChance))) combat.freeze(current, freezeDur);
        else combat.slow(current, fx.blue.slowPct(L), fx.blue.slowDuration(L) * scale(T.blue));
      }
    }

    // Yellow: bounty mark
    if (this.has(T.yellow) && current && n[T.yellow] > 0 && roll(chance(T.yellow, fx.yellow.chance, 0))) {
      combat.markBounty(current);
    }

    // White: shield
    if (this.has(T.white) && roll(chance(T.white, fx.white.chance, fx.white.anyChance))) {
      const boost = this.buffs[T.white] > 0 ? fx.white.shieldBoost(this.level(T.white, 'activation')) : 1;
      combat.addShield(damage * fx.white.shieldPct(this.level(T.white, 'base')) * boost * scale(T.white));
    }

    // Orange: charge a gauge
    if (this.has(T.orange) && roll(chance(T.orange, fx.orange.chance, fx.orange.anyChance))) {
      const open: number[] = [];
      for (let t = 0; t < this.d.colorCount; t++) if (!this.ready(t)) open.push(t);
      if (open.length) {
        const t = open[Math.floor(rng() * open.length)];
        this.addGauge(t, fx.orange.charge(this.level(T.orange, 'base')) * scale(T.orange));
        if (full[T.orange]) this.boosts[t] = gp.potencyDuration;
      }
    }

    // Violet: poison, and detonation during its buff
    if (this.has(T.violet)) {
      const cur = combat.currentEnemy;
      if (cur && roll(chance(T.violet, fx.violet.chance, fx.violet.anyChance))) {
        combat.poison(cur, Math.round(fx.violet.perTick(this.level(T.violet, 'base')) * scale(T.violet)), gp.debuffDuration);
      }
      if (this.buffs[T.violet] > 0 && n[T.violet] > 0) combat.detonatePoison();
    }

    // Cyan: universal tiles and tile buffs
    if (this.has(T.cyan)) {
      const { marker } = this.d;
      /** An Improved tile carries a random unlocked bonus; with none unlocked it is a Universal tile instead. */
      const improve = () => {
        const unlocked = marker.unlockedBonuses();
        if (unlocked.length) marker.queueBonus(unlocked[Math.floor(rng() * unlocked.length)], 1);
        else marker.queueUniversal(1);
      };
      if (roll(chance(T.cyan, fx.cyan.chance, 0))) marker.queueUniversal(fx.cyan.count(this.level(T.cyan, 'base')));
      const matchedUniversal = info.player && info.tiles.some((t) => t.universal);
      if (matchedUniversal && full[T.cyan] && roll(fx.cyan.buffChance * this.potency(T.cyan))) {
        improve();
      }
      if (info.player && this.buffs[T.cyan] > 0) {
        for (let k = 0; k < fx.cyan.perMatch(this.level(T.cyan, 'activation')); k++) {
          if (rng() < 0.5) marker.queueUniversal(1);
          else improve();
        }
      }
    }

    // Fill each destroyed color's bucket: more per extra tile, more again for every destroy in a row.
    for (let t = 0; t < n.length; t++) {
      if (n[t] === 0) continue;
      this.addGauge(t, fillAmount(n[t], this.streaks[t]));
      this.streaks[t]++;
      this.seenThisMove[t] = true;
    }
    if (info.player) this.playerMove = true;
    this.applyOngoing();
  }

  // ── combat feedback ──────────────────────────────────────────

  private onEnemyDied(enemy: Enemy): void {
    if (!enemy.bounty || !this.has(T.yellow)) return;
    const coins = fx.yellow.coins(this.level(T.yellow, 'base'));
    this.d.onBounty(this.ready(T.yellow) ? coins * 2 : coins);
  }

  /** White full bucket: absorbed damage tops up every gauge. */
  private onAbsorbed(amount: number): void {
    if (!this.has(T.white) || !this.ready(T.white)) return;
    const per = amount * fx.white.refuel(this.level(T.white, 'empowered'));
    for (let t = 0; t < this.gauges.length; t++) if (!this.ready(t)) this.addGauge(t, per);
  }
}
