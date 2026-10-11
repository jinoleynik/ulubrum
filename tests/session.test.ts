import { describe, expect, it } from 'vitest';
import { Bonus, defaultConfig, mulberry32, Game, type DestroyedTile, type GameEvent } from '../src/core';
import {
  bonusFx,
  ColorSystem,
  fillAmount,
  assignBonuses,
  campaignRoster,
  CombatModel,
  dynamicRoster,
  ENEMIES,
  PRESET_WAVES,
  type EnemyId,
  COLOR_IDS,
  defaultGameplay,
  defaultSkillLevels,
  enemiesForLevel,
  levelsOnPage,
  levelState,
  PAGE_COUNT,
  pageOfLevel,
  type CombatEvent,
  MemoryStore,
  Progress,
  ScoreService,
  Session,
  spawnAssistForLevel,
  typeOfColor,
  upgradeCost,
  type TileMarker,
} from '../src/session';
import { Sfx } from '../src/audio/sfx';
import { frames, settle } from './helpers';

const gp = defaultGameplay;

describe('score', () => {
  it('multiplies by cascade stack and shows combo only above 1', () => {
    const s = new ScoreService(10);
    expect(s.add(3, 1)).toBe(30);
    expect(s.comboLabel).toBe('');
    expect(s.add(4, 2)).toBe(80);
    expect(s.comboLabel).toBe('x2');
    expect(s.score).toBe(110);
    s.clearCombo();
    expect(s.comboLabel).toBe('');
  });
});

describe('combat', () => {
  it('every tile hits for attack × cascade stack', () => {
    const c = new CombatModel(gp);
    expect(c.tileDamage(1)).toBe(5);
    expect(c.tileDamage(3)).toBe(15);
    c.hero.weakenLeft = 1;
    expect(c.tileDamage(1)).toBeCloseTo(3.5);
  });

  it('wins when every enemy is dead and ignores later events', () => {
    const c = new CombatModel(gp);
    for (let i = 0; i < 8; i++) c.damageCurrentEnemy(30);
    expect(c.outcome).toBe('won');
    c.tick(10);
    expect(c.hero.hp).toBe(100);
  });

  it('enemy hits the hero on the interval and can defeat it', () => {
    const c = new CombatModel(gp);
    c.tick(0.99);
    expect(c.hero.hp).toBe(100);
    c.tick(0.02);
    expect(c.hero.hp).toBe(96);
    c.tick(25);
    expect(c.outcome).toBe('lost');
  });

  it('builds enemies from the roster, shows at most three, and scales stats with the level', () => {
    const c = new CombatModel(gp, () => 1, ['zombie', 'orc', 'skeleton', 'golem'], 10);
    expect(c.enemies.map((e) => e.name)).toEqual(['Zombie', 'Orc', 'Skeleton', 'Golem']);
    expect(c.visibleEnemies).toHaveLength(3);
    // HP = 30 × template × (1 + 0.08 × 10) = 54 for a 1.0 template; zombie is ×1.6
    expect(c.enemies[0].maxHp).toBe(Math.round(30 * 1.6 * 1.8));
    expect(c.enemies[1].attack).toBe(Math.round(4 * 1.5 * 1.5));
    expect(new CombatModel(gp, () => 1, ['zombie'], 0).enemies[0].maxHp).toBe(48);
  });

  it('heal over time ticks once a second, and restarting replaces it', () => {
    const c = new CombatModel({ ...gp, enemyAttack: 0 });
    c.hero.hp = 10;
    c.startHealOverTime(5, 3);
    c.tick(2);
    c.startHealOverTime(5, 3);
    c.tick(10);
    expect(c.hero.hp).toBe(10 + 2 * 3 + 5 * 3);
  });

  it('a shield soaks damage first and reports what it absorbed', () => {
    const c = new CombatModel(gp);
    const absorbed: number[] = [];
    c.on((e) => e.kind === 'absorbed' && absorbed.push(e.amount));
    c.addShield(3);
    c.tick(1);
    expect(c.hero.hp).toBe(99);
    expect(c.hero.shield).toBe(0);
    expect(absorbed).toEqual([3]);
  });

  it('slow stretches the enemy attack interval and freeze stops it', () => {
    const c = new CombatModel(gp);
    const e = c.currentEnemy!;
    c.slow(e, 0.5, 10);
    c.tick(1.9);
    expect(c.hero.hp).toBe(100);
    c.tick(0.2);
    expect(c.hero.hp).toBe(96);
    c.freeze(e, 3);
    c.tick(3);
    expect(c.hero.hp).toBe(96);
  });

  it('poison ticks every second, bites harder with vulnerability, and detonates the rest at once', () => {
    const c = new CombatModel({ ...gp, enemyAttack: 0, enemyMaxHp: 100 });
    const e = c.currentEnemy!;
    c.poison(e, 4, 5);
    c.tick(2);
    expect(e.hp).toBe(92);
    c.vulnerability = 2;
    c.damageEnemy(e, 5);
    expect(e.hp).toBe(82);
    c.detonatePoison();
    expect(e.hp).toBe(82 - 3 * 4);
    expect(e.poison).toBeNull();
  });

  const duel = (id: EnemyId, level = 0) => {
    const c = new CombatModel({ ...gp, enemyAttack: 10 }, () => 0, [id, 'grunt'], level);
    return { c, e: c.enemies[0] };
  };

  it('zombies stun and cultists silence; white immunity blocks both and cleanse removes them', () => {
    const z = duel('zombie');
    z.c.tick(z.e.interval);
    expect(z.c.hero.stunLeft).toBeGreaterThan(0);
    z.c.cleanseHero();
    expect(z.c.hero.stunLeft).toBe(0);

    const k = duel('cultist');
    k.c.tick(k.e.interval);
    expect(k.c.hero.silenceLeft).toBeGreaterThan(0);

    const safe = duel('zombie');
    safe.c.grantImmunity(10);
    safe.c.tick(safe.e.interval);
    expect(safe.c.hero.stunLeft).toBe(0);
  });

  it('orcs burn shields 1.5× as fast', () => {
    const o = duel('orc');
    o.c.hero.shield = 30;
    const dmg = o.e.attack;
    o.c.tick(o.e.interval);
    expect(o.c.hero.hp).toBe(100);
    expect(o.c.hero.shield).toBeCloseTo(30 - dmg * 1.5);
    const plain = duel('skeleton');
    plain.c.hero.shield = 30;
    plain.c.tick(plain.e.interval);
    expect(plain.c.hero.shield).toBeCloseTo(30 - plain.e.attack);
  });

  it('golems ignore slow, freeze, poison and bounty; fire elementals ignore slow and freeze', () => {
    const g = duel('golem');
    g.c.slow(g.e, 0.5, 5);
    g.c.freeze(g.e, 5);
    g.c.poison(g.e, 3, 5);
    g.c.markBounty(g.e);
    expect([g.e.slowLeft, g.e.frozenLeft, g.e.poison, g.e.bounty]).toEqual([0, 0, null, false]);
    const f = duel('fire');
    f.c.freeze(f.e, 5);
    f.c.poison(f.e, 3, 5);
    expect(f.e.frozenLeft).toBe(0);
    expect(f.e.poison).not.toBeNull();
  });

  it('vampires heal on hits, goblins report thefts, necromancers mend, shamans hasten', () => {
    const v = duel('vampire');
    v.e.hp = 10;
    v.c.tick(v.e.interval);
    expect(v.e.hp).toBeGreaterThan(10);

    const g = duel('goblin');
    const thefts: number[] = [];
    g.c.on((ev) => ev.kind === 'steal' && thefts.push(ev.amount));
    g.c.tick(g.e.interval);
    expect(thefts).toEqual([3]);

    const n = new CombatModel({ ...gp, enemyAttack: 0 }, () => 1, ['grunt', 'necromancer'], 0);
    n.enemies[0].hp = 10;
    n.tick(4);
    expect(n.enemies[0].hp).toBeGreaterThan(10);

    const slowHit = new CombatModel({ ...gp, enemyAttack: 10 }, () => 1, ['grunt', 'shaman'], 0);
    slowHit.tick(0.8); // 1s interval, hasted ×1.3 → lands after ~0.77s
    expect(slowHit.hero.hp).toBeLessThan(100);
  });

  it('silence locks buckets', () => {
    const progress = new Progress(new MemoryStore(), gp);
    const session = new Session({ seed: 1, level: 1, progress, board: defaultConfig, gameplay: gp });
    session.colors.gauges[0] = gp.bucketCapacity;
    session.combat.hero.silenceLeft = 3;
    expect(session.activate(0)).toBe(false);
    session.combat.hero.silenceLeft = 0;
    expect(session.activate(0)).toBe(true);
  });
});

describe('rosters', () => {
  it('campaign rosters are fixed, sized level + 2, and unlock archetypes by level', () => {
    for (const level of [1, 5, 9, 20, 55, 100]) {
      expect(campaignRoster(level)).toHaveLength(level + 2);
      expect(campaignRoster(level)).toEqual(campaignRoster(level));
    }
    expect(campaignRoster(5).filter((e) => e === 'zombie')).toHaveLength(2);
    expect(campaignRoster(5)).toContain('orc');
    expect(campaignRoster(10).at(-1)).toBe('golem'); // boss every 5th stage
    expect(new Set(campaignRoster(2))).toEqual(new Set(['zombie', 'skeleton']));
    expect(campaignRoster(20)).not.toContain('grunt');
    expect(new Set(campaignRoster(7))).not.toContain('goblin'); // unlocks on 8
  });

  it('dynamic rosters lean harder on debuffers later in the run', () => {
    const debuffers = new Set(['zombie', 'cultist', 'orc', 'vampire', 'fire']);
    let early = 0, late = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = dynamicRoster(mulberry32(seed), 20, 30);
      early += r.slice(0, 5).filter((e) => debuffers.has(e)).length;
      late += r.slice(-6, -1).filter((e) => debuffers.has(e)).length;
    }
    expect(late).toBeGreaterThan(early);
  });

  it('a level round uses its campaign roster and scaled stats; preset waves only name real enemies', () => {
    const progress = new Progress(new MemoryStore(), gp);
    const s = new Session({ seed: 1, level: 5, progress, board: defaultConfig, gameplay: gp });
    expect(s.combat.enemies.map((e) => e.template.id)).toEqual(campaignRoster(5));
    for (const wave of [...PRESET_WAVES.timeLimit, ...PRESET_WAVES.survival]) {
      for (const id of wave.roster) expect(ENEMIES[id]).toBeDefined();
    }
  });
});

describe('progress', () => {
  it('starts every branch at level 1; the base branch is endless and each level costs more', () => {
    const p = new Progress(new MemoryStore(), gp);
    expect(p.skillLevels()).toEqual(defaultSkillLevels());
    expect(p.upgradeCost('green', 'base')).toBe(Math.round(40 * 1.15));
    expect(p.upgrade('green', 'base')).toBe(false); // too poor
    p.addCoins(1_000_000);
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const cost = p.upgradeCost('green', 'base');
      expect(cost).toBeGreaterThan(last);
      last = cost;
      expect(p.upgrade('green', 'base')).toBe(true);
    }
    expect(p.skillLevel('green', 'base')).toBe(41); // far past the old cap of 5
    expect(p.isMaxed('green', 'base')).toBe(false);
    expect(p.skillLevel('green', 'empowered')).toBe(1); // branches are independent
  });

  it('empowered and activation branches still stop at the max level', () => {
    const p = new Progress(new MemoryStore(), gp);
    p.addCoins(100_000);
    while (p.upgrade('cyan', 'activation'));
    expect(p.skillLevel('cyan', 'activation')).toBe(5);
    expect(p.isMaxed('cyan', 'activation')).toBe(true);
    expect(upgradeCost(gp, 2)).toBe(90);
  });

  it('passives are endless and persist; ultimates need base level 10 and a one-time payment', () => {
    const store = new MemoryStore();
    const p = new Progress(store, gp);
    p.addCoins(1_000_000);
    expect(p.passiveLevels()).toEqual({ maxhp: 0, damage: 0, shield: 0, heal: 0 });
    for (let i = 0; i < 12; i++) expect(p.upgradePassive('maxhp')).toBe(true);
    expect(new Progress(store, gp).passiveLevel('maxhp')).toBe(12);

    expect(p.canBuyUltimate('red')).toBe(false); // base level 1
    while (p.skillLevel('red', 'base') < gp.ultimateUnlockLevel) p.upgrade('red', 'base');
    expect(p.canBuyUltimate('red')).toBe(true);
    const coins = p.coins;
    expect(p.buyUltimate('red')).toBe(true);
    expect(p.coins).toBe(coins - gp.ultimateCost);
    expect(p.hasUltimate('red')).toBe(true);
    expect(p.buyUltimate('red')).toBe(false); // already owned
    expect(new Progress(store, gp).ultimates().red).toBe(true);
  });

  it('keeps only the best score', () => {
    const p = new Progress(new MemoryStore(), gp);
    expect(p.submitScore(100)).toBe(true);
    expect(p.submitScore(50)).toBe(false);
    expect(p.highScore).toBe(100);
  });
});

const GRID = ['01010101', '10101010', '01010101', '10101010', '01010101', '10101010', '01201010', '22320345'];
const boardGame = (layout = GRID, seed = 3) =>
  new Game({ ...defaultConfig, reshuffleOnNoMoves: false, width: layout[0].length, height: layout.length }, { seed, layout });

describe('tile marks', () => {
  it('queued universal and buff marks land on random tiles once the chain settles', async () => {
    const game = boardGame();
    const events: GameEvent[] = [];
    game.on((e) => events.push(e));
    game.trySwap(game.board.idx(2, 0), game.board.idx(2, 1));
    for (let i = 0; i < 100 && !game.isChainRunning; i++) await frames(game, 1);
    expect(game.isChainRunning).toBe(true);
    game.queueUniversal(2);
    game.queueBonus(Bonus.Heal, 2);
    expect(game.board.cells.some((c) => c.view!.universal)).toBe(false); // nothing mid-chain
    await settle(game);
    const marked = events.find((e) => e.kind === 'tilesMarked');
    expect(marked).toBeDefined();
    expect(game.board.cells.filter((c) => c.view!.universal)).toHaveLength(2);
    expect(game.board.cells.filter((c) => c.view!.bonus === Bonus.Heal && c.view!.bonusLevel === 2)).toHaveLength(1);
  });

  it('a swap that only works with a Universal tile is reverted without one and valid with one', async () => {
    const moved = ['1313', '3103', '2210'];
    const plain = boardGame(moved);
    plain.trySwap(plain.board.idx(2, 0), plain.board.idx(2, 1));
    await settle(plain);
    expect(plain.stats.revertedSwaps).toBe(1);

    const wild = boardGame(moved);
    wild.board.at(2, 1).view!.universal = true; // the 0 being swapped down becomes a 2
    wild.trySwap(wild.board.idx(2, 0), wild.board.idx(2, 1));
    await settle(wild);
    expect(wild.stats.validSwaps).toBe(1);
    expect(wild.stats.cleared).toBeGreaterThanOrEqual(3);
  });

  it('a stationary Universal tile in the line also counts', async () => {
    const layout = ['1403', '4321', '2034'];
    const game = boardGame(layout);
    game.board.at(1, 0).view!.universal = true; // the 0 between the 2s
    game.trySwap(game.board.idx(2, 0), game.board.idx(2, 1));
    await settle(game);
    expect(game.stats.validSwaps).toBe(1);
  });

  it('auto-cascades ignore the wildcard', async () => {
    const game = boardGame(['1403', '4321', '2034']);
    game.board.at(1, 0).view!.universal = true;
    expect(game.board.findMatches().size).toBe(0);
  });
});

describe('bonus tiles on the board', () => {
  const swap = (game: Game) => game.trySwap(game.board.idx(2, 0), game.board.idx(2, 1));
  const withBonus = (skills: Partial<Record<Bonus, number>>, layout = GRID) =>
    new Game({ ...defaultConfig, reshuffleOnNoMoves: false, width: layout[0].length, height: layout.length }, { seed: 3, layout, bonusSkills: skills });

  it('a bonus only spawns from a 4+ player match once its skill is unlocked, leveled by length', async () => {
    const four = ['01010101', '10101010', '01010101', '10101010', '01010101', '10101010', '01201010', '22320345'];
    const locked = withBonus({}, four);
    swap(locked);
    await settle(locked);
    expect(locked.board.cells.some((c) => c.view!.bonus !== Bonus.None)).toBe(false);

    const unlocked = withBonus({ [Bonus.Coin]: 1 }, four);
    const events: GameEvent[] = [];
    unlocked.on((e) => events.push(e));
    swap(unlocked);
    await settle(unlocked);
    const marked = unlocked.board.cells.filter((c) => c.view!.bonus === Bonus.Coin);
    expect(marked).toHaveLength(1);
    expect(marked[0].view!.bonusLevel).toBe(1); // a 4-match is tile level 1
  });

  it('a 3-match never spawns a bonus', async () => {
    const game = withBonus({ [Bonus.Coin]: 1, [Bonus.Bomb]: 1 }, ['0101', '1010', '2210', '3023']);
    game.trySwap(game.board.idx(2, 0), game.board.idx(2, 1));
    await settle(game);
    expect(game.board.cells.some((c) => c.view!.bonus !== Bonus.None)).toBe(false);
  });

  it('a Bomb destroys level + skill tiles around it', async () => {
    const game = withBonus({ [Bonus.Bomb]: 1 });
    const events: GameEvent[] = [];
    game.on((e) => events.push(e));
    game.board.at(0, 0).view!.bonus = Bonus.Bomb;
    game.board.at(0, 0).view!.bonusLevel = 1;
    swap(game);
    await settle(game);
    expect(events.filter((e) => e.kind === 'splash')).toEqual([{ kind: 'splash', added: 2 }]);
  });

  it('a Line tile fires one ray, a row, a T, or a cross by tile level', async () => {
    const added = async (level: number) => {
      const game = withBonus({ [Bonus.Line]: 1 });
      const events: GameEvent[] = [];
      game.on((e) => events.push(e));
      game.board.at(0, 0).view!.bonus = Bonus.Line;
      game.board.at(0, 0).view!.bonusLevel = level;
      swap(game);
      await settle(game);
      return (events.find((e) => e.kind === 'splash') as { added: number } | undefined)?.added ?? 0;
    };
    // Corner tile (0,0) in an 8×8 board; the 2222 on row 0 is already matched.
    expect(await added(1)).toBeLessThanOrEqual(7);
    expect(await added(4)).toBeGreaterThan(await added(1));
  });

  it('bonus tiles caught in another bonus blast fire too', async () => {
    const game = withBonus({ [Bonus.Bomb]: 5 });
    const events: GameEvent[] = [];
    game.on((e) => events.push(e));
    game.board.at(0, 0).view!.bonus = Bonus.Bomb;
    game.board.at(0, 0).view!.bonusLevel = 4; // 9 tiles: everything within reach
    swap(game);
    await settle(game);
    const added = (events.find((e) => e.kind === 'splash') as { added: number }).added;
    expect(added).toBeGreaterThanOrEqual(9);
  });
});

describe('session', () => {
  const make = (layout?: string[], extra: Partial<typeof gp> = {}, seed = 5) => {
    const progress = new Progress(new MemoryStore(), gp);
    const session = new Session({
      seed,
      progress,
      board: { ...defaultConfig, reshuffleOnNoMoves: false, ...(layout ? { width: layout[0].length, height: layout.length } : {}) },
      gameplay: { ...gp, ...extra },
      layout,
      rng: () => 0, // coin roll lands on winCoinsMin
    });
    return { session, progress };
  };
  const run = async (s: Session, frames = 600) => {
    for (let i = 0; i < frames && s.game.isBusy; i++) {
      s.tick(1 / 60);
      await new Promise((r) => setImmediate(r));
    }
  };

  const LAYOUT = ['4523', '3452', '2034', '0105'];

  it('Coin, Heal and Time tiles pay out when destroyed, scaled by tile level × skill level', () => {
    const progress = new Progress(new MemoryStore(), gp);
    progress.addCoins(10_000);
    for (const id of ['coin', 'heal', 'time'] as const) {
      progress.upgradeBonus(id); // unlock
      progress.upgradeBonus(id); // skill level 2
    }
    const session = new Session({
      seed: 1,
      progress,
      board: { ...defaultConfig, reshuffleOnNoMoves: false },
      gameplay: { ...gp, enemyAttack: 0 },
    });
    session.combat.hero.hp = 10;
    const tiles = (bonus: Bonus, bonusLevel: number) => ({ index: 0, type: 0, bonus, bonusLevel, universal: false });
    const wave = (t: ReturnType<typeof tiles>) =>
      (session as unknown as { onWave(w: number, t: unknown[], p: boolean): void }).onWave(1, [t], true);
    const before = session.timeRemaining;
    wave(tiles(Bonus.Coin, 3));
    expect(session.bonusCoins).toBe(bonusFx.coins(gp, 3, 2));
    wave(tiles(Bonus.Heal, 2));
    expect(session.combat.hero.hp).toBe(10 + bonusFx.heal(gp, 2, 2));
    wave(tiles(Bonus.Time, 4));
    session.tick(0); // clock is read via timeRemaining
    expect(session.timeRemaining).toBe(before + bonusFx.seconds(gp, 4, 2));
  });

  it('a Time tile takes seconds off in a survival round', () => {
    const progress = new Progress(new MemoryStore(), gp);
    progress.addCoins(1000);
    progress.upgradeBonus('time');
    const session = new Session({ seed: 1, progress, board: defaultConfig, gameplay: gp, timeMode: 'survival' });
    (session as unknown as { onWave(w: number, t: unknown[], p: boolean): void }).onWave(
      1, [{ index: 0, type: 0, bonus: Bonus.Time, bonusLevel: 1, blast: 0, beamColumn: -1, universal: false }], true);
    expect(session.timeRemaining).toBe(gp.roundDurationSeconds - bonusFx.seconds(gp, 1, 1));
  });

  it('scores and damages the enemy from a player swap', async () => {
    const { session } = make(LAYOUT, { enemyAttack: 0 });
    const b = session.game.board;
    session.game.trySwap(b.idx(1, 0), b.idx(1, 1));
    await run(session);
    expect(session.score.score).toBeGreaterThanOrEqual(30);
    expect(session.combat.enemies[0].hp).toBeLessThan(30);
  });

  it('pays coins and a time bonus once on victory, and halts the board', async () => {
    const { session, progress } = make(LAYOUT, { enemiesPerRound: 1, enemyMaxHp: 1, enemyAttack: 0 });
    const b = session.game.board;
    session.game.trySwap(b.idx(1, 0), b.idx(1, 1));
    await run(session);
    expect(session.outcome).toBe('won');
    expect(session.game.halted).toBe(true);
    const bonus = Math.floor(session.timeRemaining) * 2;
    expect(session.reward).toEqual({ baseCoins: 15, timeBonus: bonus, bonusCoins: 1, total: 16 + bonus }); // the last enemy dropped 1 coin
    expect(progress.coins).toBe(16 + bonus);
    expect(progress.highScore).toBe(session.score.score);
  });

  it('does not end the round or pay when the timer runs out', () => {
    const { session, progress } = make(undefined, { enemyAttack: 0 });
    session.tick(0.05);
    for (let i = 0; i < 2000; i++) session.tick(0.05);
    expect(session.timeRemaining).toBe(0);
    expect(session.outcome).toBe('playing');
    expect(progress.coins).toBe(0);
  });

  it('loses on hero HP and pays nothing', () => {
    const { session, progress } = make();
    for (let i = 0; i < 40; i++) session.tick(1);
    expect(session.outcome).toBe('lost');
    expect(session.game.halted).toBe(true);
    expect(progress.coins).toBe(0);
  });
});

describe('levels', () => {
  it('adds an enemy per level', () => {
    expect(enemiesForLevel(1)).toBe(3);
    expect(enemiesForLevel(100)).toBe(102);
    const progress = new Progress(new MemoryStore(), gp);
    const s = new Session({ seed: 1, level: 7, progress, board: defaultConfig, gameplay: gp });
    expect(s.combat.enemies).toHaveLength(9);
  });

  it('unlocks one level at a time and never moves progress back', () => {
    const p = new Progress(new MemoryStore(), gp);
    expect(p.isUnlocked(1)).toBe(true);
    expect(p.isUnlocked(2)).toBe(false);
    p.completeLevel(1);
    expect(p.isUnlocked(2)).toBe(true);
    p.completeLevel(5);
    p.completeLevel(2);
    expect(p.levelsCompleted).toBe(5);
    expect(levelState(5, 5)).toBe('done');
    expect(levelState(6, 5)).toBe('current');
    expect(levelState(7, 5)).toBe('locked');
    p.completeLevel(500);
    expect(p.levelsCompleted).toBe(100);
  });

  it('winning a level unlocks the next', async () => {
    const progress = new Progress(new MemoryStore(), gp);
    const session = new Session({
      seed: 5,
      level: 1,
      progress,
      board: { ...defaultConfig, reshuffleOnNoMoves: false, width: 4, height: 4 },
      gameplay: { ...gp, enemyMaxHp: 1, enemyAttack: 0 },
      layout: ['4523', '3452', '2034', '0105'],
      rng: () => 0,
    });
    for (let i = 0; i < 3; i++) session.combat.damageCurrentEnemy(1000);
    expect(session.outcome).toBe('won');
    expect(progress.levelsCompleted).toBe(1);
  });
});

describe('color skills', () => {
  const marks = { universal: 0, buffs: [] as Bonus[] };
  const marker: TileMarker = {
    queueUniversal: (n = 1) => void (marks.universal += n),
    queueBonus: (b) => void marks.buffs.push(b),
    unlockedBonuses: () => [Bonus.Heal],
  };
  const tile = (color: (typeof COLOR_IDS)[number], n = 3, extra: Partial<DestroyedTile> = {}): DestroyedTile[] =>
    Array.from({ length: n }, (_, i) => ({ index: i, type: typeOfColor(color), bonus: Bonus.None, bonusLevel: 0, blast: 0, beamColumn: -1, universal: false, ...extra }));

  /** rng 0 → every roll succeeds; rng 1 → none does. */
  const setup = (rng: () => number, extra: Partial<typeof gp> = {}, levels = defaultSkillLevels()) => {
    marks.universal = 0;
    marks.buffs = [];
    const cfg = { ...gp, enemyAttack: 0, enemyMaxHp: 100, ...extra };
    const combat = new CombatModel(cfg);
    let bounty = 0;
    const colors = new ColorSystem({
      gp: cfg, levels, combat, rng, marker, colorCount: 8, onBounty: (c) => (bounty += c),
    });
    const wave = (tiles: DestroyedTile[], player = true, n = 1) => colors.onWave({ wave: n, tiles, player });
    const fill = (c: (typeof COLOR_IDS)[number]) => (colors.gauges[typeOfColor(c)] = colors.capacity(typeOfColor(c)));
    return { combat, colors, wave, fill, bounty: () => bounty };
  };

  it('tiles fill their own gauge; a full gauge is ready and activation empties it', () => {
    const { colors, wave, fill } = setup(() => 1);
    wave(tile('blue', 4));
    expect(colors.gauges[1]).toBe(fillAmount(4));
    expect(colors.activate(1)).toBe(false);
    fill('blue');
    expect(colors.ready(1)).toBe(true);
    expect(colors.activate(1)).toBe(true);
    expect(colors.gauges[1]).toBe(0);
    expect(colors.active(1)).toBe(true);
    colors.tick(100);
    expect(colors.active(1)).toBe(false);
  });

  it('every tile deals damage, green included', () => {
    const { combat, wave } = setup(() => 1);
    wave(tile('green', 3));
    expect(combat.currentEnemy!.hp).toBe(100 - 15);
  });

  it('green heals on a chance; a full bucket extends it to any color', () => {
    const a = setup(() => 0);
    a.combat.hero.hp = 50;
    a.wave(tile('red', 3));
    expect(a.combat.hero.hp).toBe(50); // base is green-only
    a.fill('green');
    a.wave(tile('red', 3));
    expect(a.combat.hero.hp).toBe(60);
  });

  it('green activation is a heal over time and leaves the tiles alone', () => {
    const { combat, colors, fill } = setup(() => 1);
    combat.hero.hp = 10;
    fill('green');
    colors.activate(2);
    combat.tick(3);
    expect(combat.hero.hp).toBe(10 + 3 * 3);
  });

  it('red crits for double; with a full bucket crits splash to the other enemies; the buff forces both', () => {
    const a = setup(() => 0);
    a.wave(tile('red', 3));
    expect(a.combat.currentEnemy!.hp).toBe(100 - 30);
    expect(a.combat.visibleEnemies[1].hp).toBe(100); // no splash without a full bucket

    const b = setup(() => 0);
    b.fill('red');
    b.wave(tile('red', 3));
    expect(b.combat.visibleEnemies[1].hp).toBe(100 - 15); // 50% of the 30 crit damage

    const c = setup(() => 1);
    c.fill('red');
    c.colors.activate(0);
    c.wave(tile('red', 3));
    expect(c.combat.currentEnemy!.hp).toBe(100 - 30);
    expect(c.combat.visibleEnemies[2].hp).toBe(100 - 15);
  });

  it('blue slows, freezes with a full bucket, and its buff slows everyone and always freezes', () => {
    const a = setup(() => 0);
    a.wave(tile('blue', 3));
    expect(a.combat.currentEnemy!.slowLeft).toBeGreaterThan(0);
    expect(a.combat.currentEnemy!.frozenLeft).toBe(0);

    const b = setup(() => 0);
    b.fill('blue');
    b.wave(tile('blue', 3));
    expect(b.combat.currentEnemy!.frozenLeft).toBeGreaterThan(0);

    const c = setup(() => 1);
    c.fill('blue');
    c.colors.activate(1);
    expect(c.combat.visibleEnemies.every((e) => e.slowLeft > 0)).toBe(true);
    c.wave(tile('blue', 3));
    expect(c.combat.currentEnemy!.frozenLeft).toBeGreaterThan(0);
  });

  it('yellow marks a bounty that pays coins; a full bucket executes it and doubles the pay', () => {
    const a = setup(() => 0);
    a.wave(tile('yellow', 3));
    expect(a.combat.currentEnemy!.bounty).toBe(true);
    a.combat.damageCurrentEnemy(100);
    expect(a.bounty()).toBe(5);

    const b = setup(() => 0);
    b.wave(tile('yellow', 3));
    b.combat.currentEnemy!.hp = 30; // below the 40% execute line
    b.fill('yellow');
    const target = b.combat.currentEnemy!;
    b.wave(tile('red', 1));
    expect(target.hp).toBe(0);
    expect(b.bounty()).toBe(10);

    const c = setup(() => 1);
    c.fill('yellow');
    c.colors.activate(3);
    expect(c.combat.visibleEnemies.every((e) => e.bounty)).toBe(true);
  });

  it('white shields from match damage, a full bucket shields on any color and refuels gauges, the buff cleanses', () => {
    const a = setup(() => 0);
    a.wave(tile('white', 3));
    expect(a.combat.hero.shield).toBe(9); // 15 damage × 60%

    const b = setup(() => 0);
    b.wave(tile('red', 3));
    expect(b.combat.hero.shield).toBe(0);
    b.fill('white');
    b.wave(tile('red', 3));
    expect(b.combat.hero.shield).toBeGreaterThan(0);
    b.combat.hero.shield = 10;
    const before = b.colors.gauges[1];
    (b.combat as unknown as { damageHero(n: number): void }).damageHero(10);
    expect(b.colors.gauges[1]).toBeGreaterThan(before);

    const c = setup(() => 1);
    c.combat.hero.weakenLeft = 4;
    c.combat.hero.poisonLeft = 4;
    c.fill('white');
    c.colors.activate(4);
    expect(c.combat.hero.weakenLeft).toBe(0);
    expect(c.combat.hero.immuneLeft).toBeGreaterThan(0);
  });

  it('orange charges a random gauge; its buff shrinks every bucket', () => {
    const a = setup(() => 0);
    a.wave(tile('orange', 3));
    const total = a.colors.gauges.reduce((x, y) => x + y, 0);
    expect(total).toBeCloseTo(fillAmount(3) + 15); // 3 orange tiles + a 15% charge somewhere

    const b = setup(() => 1);
    expect(b.colors.capacity(0)).toBe(100);
    b.fill('orange');
    b.colors.activate(5);
    expect(b.colors.capacity(0)).toBe(50);
  });

  it('violet poisons; a full bucket makes poisoned enemies take more; the buff detonates on violet tiles', () => {
    const a = setup(() => 0);
    a.wave(tile('violet', 3));
    expect(a.combat.currentEnemy!.poison).not.toBeNull();

    const b = setup(() => 1);
    b.fill('violet');
    b.combat.poison(b.combat.currentEnemy!, 2, 5);
    b.wave(tile('red', 1));
    expect(b.combat.vulnerability).toBeGreaterThan(1);

    const c = setup(() => 1);
    c.fill('violet');
    c.colors.activate(6);
    expect(c.combat.visibleEnemies.every((e) => e.poison)).toBe(true);
    const target = c.combat.currentEnemy!;
    c.wave(tile('violet', 3));
    expect(target.poison).toBeNull();
    expect(target.hp).toBeLessThan(100 - 15); // wave damage + every poison tick at once
  });

  it('cyan makes Universal tiles, buffs a tile when one is matched on a full bucket, and its buff makes one per player match', () => {
    const a = setup(() => 0);
    a.wave(tile('cyan', 3));
    expect(marks.universal).toBe(1);

    const b = setup(() => 0);
    b.wave(tile('red', 3, { universal: true }));
    expect(marks.buffs).toHaveLength(0);
    b.fill('cyan');
    b.wave(tile('red', 3, { universal: true }));
    expect(marks.buffs).toHaveLength(1);

    const c = setup(() => 1);
    c.fill('cyan');
    c.colors.activate(7);
    c.wave(tile('red', 3), true);
    c.wave(tile('red', 3), false);
    expect(marks.universal + marks.buffs.length).toBe(1);
  });
});

describe('spawn assist', () => {
  const avgMoves = (assist: number) => {
    let total = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = new Game({ ...defaultConfig, spawnAssist: assist, colorCount: 6 }, { seed });
      expect(g.board.findMatches().size).toBe(0); // assisted spawns never make instant matches
      total += g.board.countPossibleMoves();
    }
    return total / 60;
  };

  it('sets up more possible moves than random spawning', () => {
    expect(avgMoves(1)).toBeGreaterThan(avgMoves(0));
  });

  it('fades with the level and is gone eventually', () => {
    expect(spawnAssistForLevel(gp, 1)).toBeCloseTo(0.8);
    expect(spawnAssistForLevel(gp, 41)).toBeCloseTo(0.4);
    expect(spawnAssistForLevel(gp, 100)).toBe(0);
    const progress = new Progress(new MemoryStore(), gp);
    const s = new Session({ seed: 1, level: 41, progress, board: defaultConfig, gameplay: gp });
    expect(s.game.config.spawnAssist).toBeCloseTo(0.4);
  });
});

describe('re-shuffle', () => {
  it('replaces the board and clears bonuses, buckets and hero buffs', async () => {
    const progress = new Progress(new MemoryStore(), gp);
    const session = new Session({ seed: 7, progress, board: { ...defaultConfig, reshuffleOnNoMoves: false }, gameplay: { ...gp, enemyAttack: 0 } });
    const { game, colors, combat } = session;
    await settle(game);
    game.board.at(0, 0).view!.bonus = Bonus.Coin;
    game.board.at(1, 0).view!.universal = true;
    colors.gauges[2] = 5;
    colors.gauges[0] = 20;
    colors.activate(0);
    combat.addShield(9);
    combat.startHealOverTime(5, 3);

    expect(session.reshuffle()).toBe(true);
    expect(session.reshuffle()).toBe(false); // busy
    for (let i = 0; i < 600 && game.isBusy; i++) {
      session.tick(1 / 60);
      await new Promise((r) => setImmediate(r));
    }
    expect(game.board.cells.some((c) => c.view!.bonus !== Bonus.None || c.view!.universal)).toBe(false);
    expect(colors.gauges.every((g) => g === 0)).toBe(true);
    expect(colors.buffs.every((b) => b === 0)).toBe(true);
    expect(combat.hero.shield).toBe(0);
    combat.hero.hp = 10;
    combat.tick(3);
    expect(combat.hero.hp).toBe(10); // heal over time is gone
  });
});

describe('level pages', () => {
  it('splits the 100 levels into pages of ten that never need scrolling', () => {
    expect(PAGE_COUNT).toBe(10);
    expect(pageOfLevel(1)).toBe(0);
    expect(pageOfLevel(10)).toBe(0);
    expect(pageOfLevel(11)).toBe(1);
    expect(pageOfLevel(100)).toBe(9);
    expect(pageOfLevel(500)).toBe(9);
    expect(levelsOnPage(0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(levelsOnPage(9).at(-1)).toBe(100);
    expect(levelsOnPage(10)).toEqual([]);
  });
});

describe('combat events and debug tools', () => {
  it('damage and heal events say who, including enemy heals from a necromancer', () => {
    const c = new CombatModel({ ...gp, enemyAttack: 0 }, () => 1, ['grunt', 'necromancer'], 0);
    const events: CombatEvent[] = [];
    c.on((e) => events.push(e));
    c.damageCurrentEnemy(5);
    c.healHero(0); // no event for nothing
    c.hero.hp = 50;
    c.healHero(10);
    c.tick(4); // the necromancer mends the hurt grunt
    const dmg = events.find((e) => e.kind === 'damage');
    expect(dmg && dmg.kind === 'damage' && dmg.enemy).toBe(c.enemies[0]);
    const heals = events.filter((e) => e.kind === 'heal');
    expect(heals.map((h) => h.kind === 'heal' && h.target)).toEqual(['hero', 'enemy']);
  });

  it('debug tools heal, pay, and kill; killing everything wins the level through the normal path', () => {
    const progress = new Progress(new MemoryStore(), gp);
    const session = new Session({ seed: 1, level: 1, progress, board: defaultConfig, gameplay: gp });
    session.combat.hero.hp = 5;
    session.debugHealHero();
    expect(session.combat.hero.hp).toBe(session.combat.hero.maxHp);
    session.debugAddMoney(500);
    expect(progress.coins).toBe(500);
    const left = session.combat.enemiesLeft;
    session.debugKillFirstEnemy();
    expect(session.combat.enemiesLeft).toBe(left - 1);
    session.debugKillAll();
    expect(session.outcome).toBe('won');
    expect(progress.levelsCompleted).toBe(1);
    expect(progress.coins).toBeGreaterThan(500); // reward paid
  });
});

describe('sfx settings', () => {
  it('is a safe no-op without Web Audio and persists its settings', () => {
    const store = new MemoryStore();
    const sfx = new Sfx(store, null);
    sfx.unlock();
    sfx.play('match', 3);
    sfx.startMusic();
    expect(sfx.ready).toBe(false);
    sfx.setSfx(false);
    sfx.setMusic(false);
    sfx.setVolume(0.3);
    const again = new Sfx(store, null);
    expect([again.sfxOn, again.musicOn, again.volume]).toEqual([false, false, 0.3]);
    expect(new Sfx(new MemoryStore(), null).volume).toBe(0.7);
  });

  it('plays through a fake context and throttles rapid repeats', () => {
    const made: string[] = [];
    const node = () => ({ connect: (n: unknown) => n, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
    const ctx = {
      currentTime: 0, state: 'running', destination: {}, sampleRate: 8000,
      createGain: node,
      createOscillator: () => {
        made.push('osc');
        return { ...node(), type: 'sine', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, start() {}, stop() {} };
      },
      createBuffer: () => ({ getChannelData: () => new Float32Array(10) }),
      createBufferSource: () => ({ ...node(), start() {} }),
      createBiquadFilter: () => ({ ...node(), frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
    };
    let t = 0;
    const sfx = new Sfx(undefined, () => ctx as unknown as AudioContext, () => t);
    sfx.unlock();
    sfx.play('click');
    sfx.play('click'); // same instant: dropped
    expect(made).toHaveLength(1);
    t = 100;
    sfx.play('click');
    expect(made).toHaveLength(2);
    sfx.setSfx(false);
    sfx.play('swap');
    expect(made).toHaveLength(2);
  });
});

describe('proc scaling', () => {
  const mk = (rng: () => number, greenBase = 1) => {
    const levels = defaultSkillLevels();
    levels.green.base = greenBase;
    const combat = new CombatModel({ ...gp, enemyAttack: 0, enemyMaxHp: 100 });
    combat.hero.hp = 20;
    const colors = new ColorSystem({
      gp, levels, combat, rng, colorCount: 8, onBounty: () => {},
      marker: { queueUniversal() {}, queueBonus() {}, unlockedBonuses: () => [] },
    });
    const wave = (n: number) =>
      colors.onWave({ wave: 1, player: true, tiles: Array.from({ length: n }, (_, i) => ({ index: i, type: 2, bonus: Bonus.None, bonusLevel: 0, blast: 0, beamColumn: -1, universal: false })) });
    return { combat, wave };
  };

  it('every tile beyond three raises the chance, but the skill level never does', () => {
    // roll 0.28: green's base chance is 25%, +6% per extra tile
    const three = mk(() => 0.28);
    three.wave(3);
    expect(three.combat.hero.hp).toBe(20);

    const four = mk(() => 0.28);
    four.wave(4);
    expect(four.combat.hero.hp).toBeGreaterThan(20);

    const maxedLevel = mk(() => 0.28, 99); // level 99 heals more, but still misses at 3 tiles
    maxedLevel.wave(3);
    expect(maxedLevel.combat.hero.hp).toBe(20);
  });

  it('every extra tile makes the effect bigger and the level makes it bigger too', () => {
    const heal = (tiles: number, level = 1) => {
      const { combat, wave } = mk(() => 0, level);
      wave(tiles);
      return combat.hero.hp - 20;
    };
    expect(heal(3)).toBe(10);
    expect(heal(5)).toBe(14); // two extra tiles: +40%
    expect(heal(3, 11)).toBe(40); // 10 + 3 × 10
    expect(heal(7, 11)).toBe(72);
  });
});

describe('passives, tile bonuses and ultimates in a round', () => {
  const session = (setup: (p: Progress) => void, extra: Partial<typeof gp> = {}) => {
    const progress = new Progress(new MemoryStore(), gp);
    progress.addCoins(1_000_000);
    setup(progress);
    return new Session({ seed: 1, level: 1, progress, board: defaultConfig, gameplay: { ...gp, enemyAttack: 0, ...extra } });
  };
  const wave = (s: Session, t: { type?: number; bonus: Bonus; bonusLevel?: number; blast?: number; beamColumn?: number }[]) =>
    (s as unknown as { onWave(w: number, t: unknown[], p: boolean): void }).onWave(
      1, t.map((x, i) => ({ index: i, type: x.type ?? 0, bonus: x.bonus, bonusLevel: x.bonusLevel ?? 1, blast: x.blast ?? 0, beamColumn: x.beamColumn ?? -1, universal: false })), true);
  const unlock = (p: Progress, id: Parameters<Progress['upgradeBonus']>[0]) => p.upgradeBonus(id);

  it('passives raise max HP, attack, heals and shields from the start of every round', () => {
    const s = session((p) => {
      for (let i = 0; i < 3; i++) (['maxhp', 'damage', 'shield', 'heal'] as const).forEach((id) => p.upgradePassive(id));
    });
    expect(s.combat.hero.maxHp).toBe(gp.heroMaxHp + 30);
    expect(s.combat.hero.hp).toBe(gp.heroMaxHp + 30);
    expect(s.combat.tileDamage(1)).toBeCloseTo(gp.heroAttack + 1.5);
    s.combat.hero.hp = 10;
    s.combat.healHero(10);
    expect(s.combat.hero.hp).toBe(10 + 13); // +30% heal bonus
    s.combat.addShield(10);
    expect(s.combat.hero.shield).toBe(13);
  });

  it('MaxHP and Damage tiles last for the round: tile level × skill level × base', () => {
    const s = session((p) => {
      unlock(p, 'maxhp');
      unlock(p, 'damage');
    });
    const maxHp = s.combat.hero.maxHp;
    const attack = s.combat.hero.attack;
    wave(s, [{ bonus: Bonus.MaxHp, bonusLevel: 3 }, { bonus: Bonus.Damage, bonusLevel: 4 }]);
    expect(s.combat.hero.maxHp).toBe(maxHp + bonusFx.maxHp(gp, 3, 1));
    expect(s.combat.hero.hp).toBe(maxHp + bonusFx.maxHp(gp, 3, 1)); // fills the new room
    expect(s.combat.hero.attack).toBeCloseTo(attack + bonusFx.damage(gp, 4, 1));
  });

  it('a locked tile bonus does nothing', () => {
    const s = session(() => {});
    const attack = s.combat.hero.attack;
    wave(s, [{ bonus: Bonus.Damage }]);
    expect(s.combat.hero.attack).toBe(attack);
  });

  const withUltimate = (color: 'red' | 'green' | 'blue' | 'yellow' | 'white' | 'orange' | 'violet' | 'cyan', ...bonuses: Parameters<Progress['upgradeBonus']>[0][]) => (p: Progress) => {
    for (const b of bonuses) unlock(p, b);
    while (p.skillLevel(color, 'base') < gp.ultimateUnlockLevel) p.upgrade(color, 'base');
    p.buyUltimate(color);
  };

  it('red + bomb hits every enemy, queued ones too, for attack × tiles exploded', () => {
    const s = session(withUltimate('red', 'bomb'), { enemyMaxHp: 1000 });
    const before = s.combat.enemies.map((e) => e.hp);
    wave(s, [{ type: 0, bonus: Bonus.Bomb, blast: 4 }]);
    const unit = s.combat.tileDamage(1);
    // the queued enemies take exactly the bomb hit; the front one also takes the wave's own tile hit
    s.combat.enemies.slice(1).forEach((e, i) => expect(before[i + 1] - e.hp).toBe(Math.round(unit * 4)));
    expect(before[0] - s.combat.enemies[0].hp).toBeGreaterThanOrEqual(Math.round(unit * 4));
    expect(s.combat.enemies).toHaveLength(3);
  });

  it('the ultimate needs the paired bonus on its own color', () => {
    const s = session(withUltimate('red', 'bomb'), { enemyMaxHp: 1000 });
    const before = s.combat.enemies.map((e) => e.hp);
    wave(s, [{ type: 1, bonus: Bonus.Bomb, blast: 4 }]); // a blue Bomb: no red ultimate
    expect(s.combat.enemies.map((e) => e.hp).slice(1)).toEqual(before.slice(1)); // only the front enemy took the wave's tile hit
  });

  it('green + heal fully heals; orange + line kills the enemy; blue + time shifts three times as far', () => {
    const g = session(withUltimate('green', 'heal'));
    g.combat.hero.hp = 1;
    wave(g, [{ type: 2, bonus: Bonus.Heal }]);
    expect(g.combat.hero.hp).toBe(g.combat.hero.maxHp);

    const y = session(withUltimate('orange', 'line'), { enemyMaxHp: 1000 });
    const first = y.combat.currentEnemy!;
    wave(y, [{ type: 5, bonus: Bonus.Line, beamColumn: 2 }]); // the beam flies up column 2, where the front enemy stands
    expect(first.hp).toBe(0);

    const b = session(withUltimate('blue', 'time'));
    const t0 = b.timeRemaining;
    wave(b, [{ type: 1, bonus: Bonus.Time, bonusLevel: 2 }]);
    expect(b.timeRemaining).toBe(t0 + bonusFx.seconds(gp, 2, 1) * 3);
  });

  it('yellow + coin pays triple, cyan + bucket fills every bucket, a Golem survives the beam', () => {
    const o = session(withUltimate('yellow', 'coin'));
    wave(o, [{ type: 3, bonus: Bonus.Coin }]);
    expect(o.bonusCoins).toBe(bonusFx.coins(gp, 1, 1) * 3);
    const plain = session(withUltimate('orange', 'coin')); // orange no longer pairs with Coin
    wave(plain, [{ type: 5, bonus: Bonus.Coin }]);
    expect(plain.bonusCoins).toBe(bonusFx.coins(gp, 1, 1));

    const c = session(withUltimate('cyan', 'bucket'));
    wave(c, [{ type: 7, bonus: Bonus.Bucket }]);
    c.colors.gauges.forEach((g, t) => expect(g).toBe(c.colors.capacity(t)));

    const progress = new Progress(new MemoryStore(), gp);
    progress.addCoins(1_000_000);
    withUltimate('orange', 'line')(progress);
    const boss = new Session({ seed: 1, progress, board: defaultConfig, gameplay: gp, roster: ['golem', 'grunt'] });
    wave(boss, [{ type: 5, bonus: Bonus.Line, beamColumn: 2 }]);
    expect(boss.combat.enemies[0].hp).toBeGreaterThan(0);
    expect(boss.combat.enemies[0].hp).toBeLessThan(boss.combat.enemies[0].maxHp);
  });

  it('a Bomb tile reports how many tiles it took', async () => {
    const layout = ['01010101', '10101010', '01010101', '10101010', '01010101', '10101010', '01201010', '22320345'];
    const game = new Game({ ...defaultConfig, reshuffleOnNoMoves: false, width: 8, height: 8 }, { seed: 3, layout, bonusSkills: { [Bonus.Bomb]: 1 } });
    const blasts: number[] = [];
    game.on((e) => e.kind === 'waveDestroying' && e.tiles.forEach((t) => t.blast && blasts.push(t.blast)));
    game.board.at(0, 0).view!.bonus = Bonus.Bomb;
    game.board.at(0, 0).view!.bonusLevel = 1;
    game.trySwap(game.board.idx(2, 0), game.board.idx(2, 1));
    await settle(game);
    expect(blasts).toEqual([2]);
  });
});

describe('bucket filling', () => {
  const mk = () => {
    const combat = new CombatModel({ ...gp, enemyAttack: 0, enemyMaxHp: 1000 });
    const colors = new ColorSystem({
      gp, levels: defaultSkillLevels(), combat, rng: () => 1, colorCount: 8, onBounty: () => {},
      marker: { queueUniversal() {}, queueBonus() {}, unlockedBonuses: () => [] },
    });
    const destroy = (color: number, n: number, player = true) =>
      colors.onWave({ wave: 1, player, tiles: Array.from({ length: n }, (_, i) => ({ index: i, type: color, bonus: Bonus.None, bonusLevel: 0, blast: 0, beamColumn: -1, universal: false })) });
    return { colors, destroy };
  };

  it('a bucket holds 100, and every extra tile is worth more than the last', () => {
    expect(gp.bucketCapacity).toBe(100);
    const steps = [3, 4, 5, 6, 7].map((n) => fillAmount(n) - fillAmount(n - 1));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    expect(fillAmount(3)).toBeCloseTo(18.75);
    expect(fillAmount(0)).toBe(0);
  });

  it('destroying the same color in a row raises the fill each time', () => {
    const { colors, destroy } = mk();
    destroy(1, 3);
    const first = colors.gauges[1];
    destroy(1, 3);
    expect(colors.gauges[1] - first).toBeCloseTo(fillAmount(3, 1));
    expect(fillAmount(3, 1)).toBeGreaterThan(fillAmount(3, 0));
    expect(colors.streaks[1]).toBe(2);
  });

  it("auto-destroys of other colors keep the streak for the player's next move; a move that skips the color ends it", () => {
    const { colors, destroy } = mk();
    destroy(1, 3, true); // the player destroys blue…
    destroy(0, 3, false); // …and the cascade destroys red and green
    destroy(2, 3, false);
    colors.endMove();
    expect(colors.streaks[1]).toBe(1); // kept
    destroy(1, 3, true); // next move: blue again, at the higher rate
    expect(colors.gauges[1]).toBeCloseTo(fillAmount(3, 0) + fillAmount(3, 1));
    colors.endMove();
    expect(colors.streaks[1]).toBe(2);
    destroy(0, 3, true); // a move that only destroys red
    colors.endMove();
    expect(colors.streaks[1]).toBe(0); // blue was skipped
    expect(colors.streaks[0]).toBeGreaterThan(0);
  });

  it('a cascade with no player wave (reshuffle) never resets streaks', () => {
    const { colors, destroy } = mk();
    destroy(1, 3, true);
    colors.endMove();
    destroy(0, 3, false);
    colors.endMove();
    expect(colors.streaks[1]).toBe(1);
  });

  it('a Bucket tile fills its own color by tile level × skill level × base', () => {
    const progress = new Progress(new MemoryStore(), gp);
    progress.addCoins(1_000_000);
    progress.upgradeBonus('bucket');
    const s = new Session({ seed: 1, level: 1, progress, board: defaultConfig, gameplay: { ...gp, enemyAttack: 0 } });
    (s as unknown as { onWave(w: number, t: unknown[], p: boolean): void }).onWave(
      1, [{ index: 0, type: 3, bonus: Bonus.Bucket, bonusLevel: 3, blast: 0, beamColumn: -1, universal: false }], true);
    expect(s.colors.gauges[3]).toBeCloseTo(fillAmount(1) + bonusFx.bucket(gp, 3, 1)); // the tile itself also fills 1
    expect(s.colors.gauges[0]).toBe(0);
  });
});

describe('enemy queue, range and bonuses', () => {
  const duel = (roster: EnemyId[], bonuses: ('armored' | 'fierce' | 'swift' | 'farsight')[][] = [], cfg: Partial<typeof gp> = {}) =>
    new CombatModel({ ...gp, enemyAttack: 10, visibleEnemySlots: 6, ...cfg }, () => 1, roster, 0, bonuses);

  it('melee enemies only strike from the front; ranged ones strike from up to their range', () => {
    const c = duel(['grunt', 'grunt', 'archer', 'archer']);
    expect(c.enemies[2].range).toBe(3);
    c.tick(0.9); // the front grunt hits once the interval has passed; archers at distance 3 and 4
    const frontHits = Math.floor(0.9 / c.enemies[0].interval);
    expect(c.hero.hp).toBe(100 - c.enemies[0].attack * frontHits - (0.9 >= c.enemies[2].interval ? c.enemies[2].attack : 0));
    c.tick(1.5);
    // Only the archer standing 3rd (within range 3) has fired; the one 4th in line is out of range
    expect(c.enemies[3].attackTimer).toBe(0);
    expect(c.enemies[2].attackTimer).toBeGreaterThanOrEqual(0);
    const shots: number[] = [];
    c.on((e) => e.kind === 'enemyAttack' && shots.push(e.distance));
    c.tick(3);
    expect(shots).toContain(3);
    expect(shots).not.toContain(4);
  });

  it('the queue closes up: when the front dies the next enemy steps into range', () => {
    const c = duel(['grunt', 'grunt', 'grunt', 'crossbow']); // crossbow: range 5, 4th in line
    c.tick(0.5);
    const crossbow = c.enemies[3];
    expect(crossbow.range).toBe(5);
    const shots: number[] = [];
    c.on((e) => e.kind === 'enemyAttack' && e.enemy === crossbow && shots.push(e.distance));
    c.tick(crossbow.interval * 2);
    expect(shots.length).toBeGreaterThan(0);
    expect(Math.min(...shots)).toBe(4);
  });

  it('bonuses make enemies tougher, extend range, and add to what they drop', () => {
    const c = duel(['skeleton', 'archer', 'orc'], [['armored', 'fierce'], ['farsight'], []]);
    const plain = duel(['skeleton', 'archer', 'orc']);
    expect(c.enemies[0].maxHp).toBe(Math.round(plain.enemies[0].maxHp * 1.5));
    expect(c.enemies[0].attack).toBe(Math.round(plain.enemies[0].attack * 1.4));
    expect(c.enemies[1].range).toBe(4); // archer 3 + farsight
    expect(duel(['orc'], [['farsight']]).enemies[0].range).toBe(2); // a melee enemy becomes a short-range one
    expect(duel(['crossbow'], [['farsight']]).enemies[0].range).toBe(5); // capped
    expect(c.enemies[0].coins).toBe(gp.enemyCoinBase + 2 * gp.enemyBonusCoins);
    expect(c.enemies[2].coins).toBe(gp.enemyCoinBase);
  });

  it('bonuses appear from level 4, deterministically, and rise with the level', () => {
    expect(assignBonuses(mulberry32(1), 20, 1).flat()).toHaveLength(0);
    const at = (level: number) => assignBonuses(mulberry32(9), 200, level).filter((b) => b.length).length;
    expect(at(10)).toBeGreaterThan(at(5));
    expect(at(30)).toBeGreaterThan(at(10));
    expect(assignBonuses(mulberry32(3), 30, 12)).toEqual(assignBonuses(mulberry32(3), 30, 12));
  });

  it('a round shows width - 2 enemies and pays each kill, more for enemies with bonuses', () => {
    const progress = new Progress(new MemoryStore(), gp);
    const s = new Session({ seed: 1, level: 12, progress, board: { ...defaultConfig, width: 8 }, gameplay: gp });
    expect(s.combat.visibleEnemies).toHaveLength(6);
    const elite = s.combat.enemies.find((e) => e.bonuses.length)!;
    expect(elite).toBeDefined();
    const before = s.bonusCoins;
    s.combat.execute(elite);
    expect(s.bonusCoins - before).toBe(elite.coins);
    expect(elite.coins).toBeGreaterThan(gp.enemyCoinBase);
  });

  it('a Line tile fires its beam up: it hurts the enemy in that column, and Orange kills it', () => {
    const progress = new Progress(new MemoryStore(), gp);
    progress.addCoins(1_000_000);
    progress.upgradeBonus('line');
    const s = new Session({ seed: 1, progress, board: { ...defaultConfig, width: 8 }, gameplay: { ...gp, enemiesPerRound: 6, enemyMaxHp: 1000, enemyAttack: 0 } });
    expect(s.combat.visibleEnemies).toHaveLength(6);
    const third = s.combat.enemies[2]; // standing on column 4
    const onWave = (col: number, type = 0) =>
      (s as unknown as { onWave(w: number, t: unknown[], p: boolean): void }).onWave(
        1, [{ index: 0, type, bonus: Bonus.Line, bonusLevel: 2, blast: 0, beamColumn: col, universal: false }], true);
    onWave(4);
    expect(third.hp).toBeLessThan(third.maxHp);
    expect(third.hp).toBeGreaterThan(0);
    onWave(1); // columns 0-1 are the hero: nobody to hit
    expect(s.combat.enemies[0].hp).toBeGreaterThan(0);
  });

  it("Orange's Line always fires a beam up, even at tile level 1", async () => {
    const layout = ['01010101', '10101010', '01010101', '10101010', '01010101', '10101010', '01201010', '22320345'];
    let beams = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const game = new Game({ ...defaultConfig, reshuffleOnNoMoves: false, width: 8, height: 8 }, { seed, layout, bonusSkills: { [Bonus.Line]: 1 } });
      game.forceBeamUp = () => true;
      game.on((e) => e.kind === 'waveDestroying' && e.tiles.forEach((t) => t.beamColumn >= 0 && beams++));
      game.board.at(0, 0).view!.bonus = Bonus.Line;
      game.board.at(0, 0).view!.bonusLevel = 1;
      game.trySwap(game.board.idx(2, 0), game.board.idx(2, 1));
      await settle(game);
    }
    expect(beams).toBe(8);
  });
});
