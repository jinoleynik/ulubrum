import { describe, expect, it } from 'vitest';
import { Charger, defaultConfig, Game, type GameEvent } from '../src/core';
import {
  CombatModel,
  defaultGameplay,
  MemoryStore,
  Progress,
  ScoreService,
  Session,
  SkillId,
  upgradeCost,
} from '../src/session';
import { settle } from './helpers';

const gp = defaultGameplay;
const counts = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

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
  it('green heals, other colors damage, both scaled by cascade', () => {
    const c = new CombatModel(gp);
    c.hero.hp = 50;
    c.onTilesMatched(counts({ 2: 3, 0: 2 }), 2);
    expect(c.hero.hp).toBe(50 + 3 * 4 * 2);
    expect(c.currentEnemy!.hp).toBe(30 - 2 * 5 * 2);
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

  it('cycles enemy kinds and shows at most three', () => {
    const c = new CombatModel(gp);
    expect(c.enemies.slice(0, 4).map((e) => e.kind)).toEqual(['Zombie', 'Orc', 'Skeleton', 'Zombie']);
    expect(c.visibleEnemies).toHaveLength(3);
  });

  it('heal over time ticks once a second for five seconds, and restarting replaces it', () => {
    const c = new CombatModel({ ...gp, enemyAttack: 0 });
    c.hero.hp = 10;
    c.startHealOverTime();
    c.tick(2);
    c.startHealOverTime();
    c.tick(10);
    expect(c.hero.hp).toBe(10 + 2 * 3 + 5 * 3);
  });
});

describe('progress', () => {
  it('defaults skills to level 1 and charges the cost curve', () => {
    const p = new Progress(new MemoryStore(), gp);
    expect(p.skillLevels()).toEqual({ heal: 1, explosion: 1 });
    expect(p.upgradeCost(SkillId.Heal)).toBe(65);
    expect(p.upgrade(SkillId.Heal)).toBe(false);
    p.addCoins(200);
    expect(p.upgrade(SkillId.Heal)).toBe(true);
    expect(p.coins).toBe(135);
    expect(p.skillLevel(SkillId.Heal)).toBe(2);
    expect(upgradeCost(gp, 2)).toBe(90);
  });

  it('stops at the max level and persists through the store', () => {
    const store = new MemoryStore();
    const p = new Progress(store, gp);
    p.addCoins(10_000);
    while (p.upgrade(SkillId.Explosion));
    expect(p.skillLevel(SkillId.Explosion)).toBe(5);
    expect(new Progress(store, gp).skillLevel(SkillId.Explosion)).toBe(5);
  });

  it('keeps only the best score', () => {
    const p = new Progress(new MemoryStore(), gp);
    expect(p.submitScore(100)).toBe(true);
    expect(p.submitScore(50)).toBe(false);
    expect(p.highScore).toBe(100);
  });
});

describe('chargers on the board', () => {
  it('grants one charger for a 4-line of a skill color, only after settling', async () => {
    // Row 0: 2 2 3 2 ... swapping (2,0)↔(2,1) brings a 2 down to make 2 2 2 2.
    const layout = ['01010101', '10101010', '01010101', '10101010', '01010101', '10101010', '01201010', '22320345'];
    const game = new Game(
      { ...defaultConfig, reshuffleOnNoMoves: false, width: 8, height: 8 },
      { seed: 3, layout, chargerSkills: { heal: 1, explosion: 0 } },
    );
    const events: GameEvent[] = [];
    game.on((e) => events.push(e));
    game.trySwap(game.board.idx(2, 0), game.board.idx(2, 1));
    await settle(game);
    const granted = events.find((e) => e.kind === 'chargersGranted');
    expect(granted).toBeDefined();
    const marked = game.board.cells.filter((c) => c.view!.charger === Charger.Heal);
    expect(marked).toHaveLength(1);
  });
});

describe('explosion splash', () => {
  const layout = ['01010101', '10101010', '01010101', '10101010', '01010101', '10101010', '01201010', '22320345'];
  const boom = async (level: number) => {
    const game = new Game(
      { ...defaultConfig, reshuffleOnNoMoves: false, width: 8, height: 8 },
      { seed: 3, layout, chargerSkills: { heal: 0, explosion: level } },
    );
    const events: GameEvent[] = [];
    game.on((e) => events.push(e));
    game.board.at(0, 0).view!.charger = Charger.Explosion;
    game.trySwap(game.board.idx(2, 0), game.board.idx(2, 1));
    await settle(game);
    return events.filter((e) => e.kind === 'splash');
  };

  it('clears a square of radius = level around a matched Explosion tile, once per chain', async () => {
    expect(await boom(1)).toEqual([{ kind: 'splash', added: 2 }]);
    expect(await boom(2)).toEqual([{ kind: 'splash', added: 6 }]);
  });

  it('does nothing when the skill is off', async () => {
    expect(await boom(0)).toEqual([]);
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
    expect(session.reward).toEqual({ baseCoins: 15, timeBonus: bonus, total: 15 + bonus });
    expect(progress.coins).toBe(15 + bonus);
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
