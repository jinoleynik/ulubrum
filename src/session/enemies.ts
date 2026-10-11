import { mulberry32 } from '../core';

/** Crowd control an enemy can shrug off. */
export type Immunity = 'slow' | 'freeze' | 'poison' | 'bounty';

export interface EnemyTraits {
  /** Chance per hit to stun the hero (no swaps) for `seconds`. */
  stun?: { chance: number; seconds: number };
  /** Chance per hit to silence the hero (no bucket activations) for `seconds`. */
  silence?: { chance: number; seconds: number };
  /** Weakens the hero's tiles on a hit. */
  weaken?: number;
  /** Sets the hero on fire (poison damage over time) on a hit. */
  ignite?: number;
  /** Shields lose this many points per point of damage this enemy deals. */
  shieldBurn?: number;
  /** Heals itself for this share of the damage it deals. */
  lifesteal?: number;
  /** Takes up to this many coins from the round's bonus coins per hit; paid back when it dies. */
  steal?: number;
  /** Heals the weakest other enemy on screen for `pct` of its max HP every `every` seconds. */
  mend?: { pct: number; every: number };
  /** While alive on screen, the other enemies attack this much faster. */
  haste?: number;
  immune?: readonly Immunity[];
}

export interface EnemyTemplate {
  id: string;
  name: string;
  face: string;
  role: string;
  /** Multipliers on the base enemy stats (GameplayConfig.enemyMaxHp / enemyAttack / interval). */
  hp: number;
  atk: number;
  interval: number;
  /** Tiles from the hero it can attack from (melee = 1: only the front enemy). Ranged archetypes use 3-5. */
  range?: number;
  traits: EnemyTraits;
}

const ALL: readonly Immunity[] = ['slow', 'freeze', 'poison', 'bounty'];

export const ENEMIES = {
  /** Plain stand-in used when no roster is given. Not part of any roster. */
  grunt: { id: 'grunt', name: 'Grunt', face: '👾', role: 'Plain', hp: 1, atk: 1, interval: 1, traits: {} },
  zombie: {
    id: 'zombie', name: 'Zombie', face: '🧟', role: 'Meat shield', hp: 1.6, atk: 0.7, interval: 1.4,
    traits: { stun: { chance: 0.15, seconds: 1 } },
  },
  orc: {
    id: 'orc', name: 'Orc', face: '👹', role: 'Shield buster', hp: 1.3, atk: 1.5, interval: 1,
    traits: { shieldBurn: 1.5 },
  },
  skeleton: {
    id: 'skeleton', name: 'Skeleton', face: '💀', role: 'Fast striker', hp: 0.6, atk: 0.8, interval: 0.6,
    traits: {},
  },
  cultist: {
    id: 'cultist', name: 'Cultist', face: '🧙', role: 'Silencer', hp: 1, atk: 0.8, interval: 1.2,
    traits: { silence: { chance: 0.35, seconds: 3 } },
  },
  golem: {
    id: 'golem', name: 'Golem', face: '🗿', role: 'Juggernaut', hp: 4, atk: 1.6, interval: 1.5,
    traits: { immune: ALL },
  },
  archer: {
    id: 'archer', name: 'Archer', face: '🏹', role: 'Ranged', hp: 0.6, atk: 0.7, interval: 1.2, range: 3,
    traits: {},
  },
  mage: {
    id: 'mage', name: 'Battle Mage', face: '🔮', role: 'Ranged caster', hp: 0.8, atk: 0.9, interval: 1.6, range: 4,
    traits: { silence: { chance: 0.15, seconds: 2 } },
  },
  crossbow: {
    id: 'crossbow', name: 'Crossbowman', face: '🎯', role: 'Sniper', hp: 1.1, atk: 1.3, interval: 2.2, range: 5,
    traits: { shieldBurn: 1.25 },
  },
  goblin: {
    id: 'goblin', name: 'Goblin Thief', face: '👺', role: 'Coin thief', hp: 0.5, atk: 0.6, interval: 0.8,
    traits: { steal: 3 },
  },
  vampire: {
    id: 'vampire', name: 'Vampire', face: '🧛', role: 'Life drainer', hp: 1, atk: 1.1, interval: 1.1,
    traits: { lifesteal: 0.6, weaken: 0.2 },
  },
  fire: {
    id: 'fire', name: 'Fire Elemental', face: '🔥', role: 'Burner', hp: 0.9, atk: 1.2, interval: 1.1,
    traits: { ignite: 0.3, immune: ['slow', 'freeze'] },
  },
  necromancer: {
    id: 'necromancer', name: 'Necromancer', face: '☠️', role: 'Healer', hp: 1.1, atk: 0.7, interval: 1.3,
    traits: { mend: { pct: 0.12, every: 4 } },
  },
  shaman: {
    id: 'shaman', name: 'Shaman', face: '🪶', role: 'Warband buffer', hp: 0.9, atk: 0.6, interval: 1.2,
    traits: { haste: 0.3 },
  },
} as const satisfies Record<string, EnemyTemplate>;

export type EnemyId = keyof typeof ENEMIES;
export const enemyTemplate = (id: EnemyId): EnemyTemplate => ENEMIES[id];

/** First campaign level each archetype can appear on. Grunt never does. */
export const UNLOCK_LEVEL: Record<Exclude<EnemyId, 'grunt'>, number> = {
  zombie: 1, skeleton: 1, orc: 3, golem: 5, cultist: 6, archer: 7, goblin: 8, vampire: 11, mage: 12, fire: 14, necromancer: 17, crossbow: 18, shaman: 20,
};

/** Enemies whose hits come with a debuff; survival ramps these up over time. */
const DEBUFFERS: readonly EnemyId[] = ['zombie', 'cultist', 'orc', 'vampire', 'fire'];

/** One-line summary of what makes an archetype special, for the enemy list. */
export function describeTraits(t: EnemyTemplate): string {
  const x = t.traits;
  const out: string[] = [];
  if (t.range && t.range > 1) out.push(`ranged: hits from ${t.range} tiles`);
  if (x.stun) out.push(`${Math.round(x.stun.chance * 100)}% stun ${x.stun.seconds}s`);
  if (x.silence) out.push(`${Math.round(x.silence.chance * 100)}% silence ${x.silence.seconds}s`);
  if (x.weaken) out.push(`${Math.round(x.weaken * 100)}% weaken`);
  if (x.ignite) out.push(`${Math.round(x.ignite * 100)}% ignite`);
  if (x.shieldBurn) out.push(`burns shields ×${x.shieldBurn}`);
  if (x.lifesteal) out.push(`heals ${Math.round(x.lifesteal * 100)}% of damage dealt`);
  if (x.steal) out.push(`steals ${x.steal} coins per hit`);
  if (x.mend) out.push(`heals allies ${Math.round(x.mend.pct * 100)}% / ${x.mend.every}s`);
  if (x.haste) out.push(`allies attack ${Math.round(x.haste * 100)}% faster`);
  if (x.immune?.length === 4) out.push('unstoppable (ignores all crowd control)');
  else if (x.immune?.length) out.push(`immune to ${x.immune.join(', ')}`);
  return out.join(' · ') || 'no special ability';
}

// ── enemy bonuses ──────────────────────────────────────────────

/** Perks an individual enemy can carry. Enemies with bonuses are tougher, and drop more coins. */
export const ENEMY_BONUSES = {
  armored: { name: 'Armored', text: '+50% HP', hp: 1.5, atk: 1, interval: 1, range: 0 },
  fierce: { name: 'Fierce', text: '+40% attack', hp: 1, atk: 1.4, interval: 1, range: 0 },
  swift: { name: 'Swift', text: 'attacks 25% faster', hp: 1, atk: 1, interval: 0.75, range: 0 },
  farsight: { name: 'Farsight', text: '+1 attack range', hp: 1, atk: 1, interval: 1, range: 1 },
} as const;
export type EnemyBonusId = keyof typeof ENEMY_BONUSES;
const BONUS_LIST = Object.keys(ENEMY_BONUSES) as EnemyBonusId[];

export const MAX_RANGE = 5;

/** Attack range in tiles: the archetype's, +1 per Farsight, never above 5. */
export function enemyRange(t: EnemyTemplate, bonuses: readonly EnemyBonusId[]): number {
  const base = t.range ?? 1;
  const extra = bonuses.reduce((n, b) => n + ENEMY_BONUSES[b].range, 0);
  return Math.min(MAX_RANGE, base + extra);
}

/**
 * Which enemies of a roster carry bonuses: none on the first levels, then a growing share,
 * with a second bonus on some from level 15. Deterministic for a given rng.
 */
export function assignBonuses(rng: () => number, count: number, level: number): EnemyBonusId[][] {
  const chance = Math.min(0.6, Math.max(0, (level - 3) * 0.04));
  return Array.from({ length: count }, () => {
    if (chance <= 0 || rng() >= chance) return [];
    const picked = [BONUS_LIST[Math.floor(rng() * BONUS_LIST.length)]];
    if (level >= 15 && rng() < 0.4) {
      const second = BONUS_LIST[Math.floor(rng() * BONUS_LIST.length)];
      if (!picked.includes(second)) picked.push(second);
    }
    return picked;
  });
}

// ── stat scaling ───────────────────────────────────────────────

export interface EnemyScaling {
  enemyMaxHp: number;
  enemyAttack: number;
  enemyHpScale: number;
  enemyAtkScale: number;
}

/** HP(L) = Base HP × template × (1 + scale × L). Level 0 (no level) is unscaled. */
export const enemyHp = (c: EnemyScaling, t: EnemyTemplate, level: number): number =>
  Math.max(1, Math.round(c.enemyMaxHp * t.hp * (1 + c.enemyHpScale * level)));

/** ATK(L) = Base ATK × template × (1 + scale × L). A base attack of 0 stays 0. */
export const enemyAtk = (c: EnemyScaling, t: EnemyTemplate, level: number): number =>
  c.enemyAttack <= 0 ? 0 : Math.max(1, Math.round(c.enemyAttack * t.atk * (1 + c.enemyAtkScale * level)));

// ── rosters ────────────────────────────────────────────────────

const Z = 'zombie', S = 'skeleton', O = 'orc', G = 'golem', C = 'cultist';

/** Hand-built early stages; each lists exactly `level + 2` enemies. */
const CAMPAIGN: Record<number, readonly EnemyId[]> = {
  1: [Z, Z, S],
  2: [Z, S, S, Z],
  3: [Z, O, S, S, Z],
  4: [S, Z, O, S, Z, O],
  5: [Z, Z, O, S, S, S, G],
  6: [Z, C, S, O, S, C, Z, O],
};

function weighted<T>(rng: () => number, items: readonly T[], weight: (t: T) => number): T {
  const total = items.reduce((n, it) => n + weight(it), 0);
  let r = rng() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

const unlockedAt = (level: number): EnemyId[] =>
  (Object.keys(UNLOCK_LEVEL) as Exclude<EnemyId, 'grunt'>[]).filter((id) => id !== 'golem' && UNLOCK_LEVEL[id] <= level);

/**
 * Campaign: the same enemies every time you play a level. Stages 1-6 are hand-built; later ones
 * are generated from the level number alone, with a Golem boss closing every fifth stage.
 */
export function campaignRoster(level: number): EnemyId[] {
  const fixed = CAMPAIGN[level];
  if (fixed) return [...fixed];
  const count = level + 2;
  const rng = mulberry32(level * 7919);
  const pool = unlockedAt(level);
  const out: EnemyId[] = [];
  for (let i = 0; i < count; i++) out.push(weighted(rng, pool, () => 1));
  if (level % 5 === 0) out[count - 1] = 'golem';
  return out;
}

/**
 * Time-limit and survival: random from everything unlocked at `level`. The later in the queue
 * (the longer you last), the likelier a debuffing enemy; a Golem mini-boss may close the run.
 */
export function dynamicRoster(rng: () => number, count: number, level: number): EnemyId[] {
  const pool = unlockedAt(level);
  const out: EnemyId[] = [];
  for (let i = 0; i < count; i++) {
    const pressure = count > 1 ? i / (count - 1) : 0;
    out.push(weighted(rng, pool, (id) => (DEBUFFERS.includes(id) ? 1 + 3 * pressure : 1)));
  }
  if (level >= UNLOCK_LEVEL.golem && count >= 6) out[count - 1] = 'golem';
  return out;
}

/** Ready-made compositions for the two timed modes. */
export const PRESET_WAVES: Record<'timeLimit' | 'survival', { name: string; note: string; roster: EnemyId[] }[]> = {
  timeLimit: [
    { name: 'Skirmish Rush', note: 'Fast, fragile: clear them before the clock matters.', roster: ['skeleton', 'skeleton', 'goblin', 'skeleton', 'zombie', 'goblin', 'skeleton'] },
    { name: 'Iron Gate', note: 'Fat targets that force big matches and bonus tiles.', roster: ['zombie', 'orc', 'zombie', 'necromancer', 'orc', 'golem'] },
    { name: 'Warband', note: 'A shaman hastes the line; kill it first.', roster: ['shaman', 'orc', 'skeleton', 'vampire', 'skeleton', 'shaman', 'orc'] },
  ],
  survival: [
    { name: 'Siege', note: 'Silence and stun keep you off your buckets.', roster: ['zombie', 'cultist', 'zombie', 'cultist', 'orc', 'cultist', 'zombie', 'golem'] },
    { name: 'Blood Moon', note: 'Drain and burn wear the hero down.', roster: ['vampire', 'skeleton', 'fire', 'vampire', 'necromancer', 'fire', 'vampire', 'orc'] },
    { name: 'Grave Tide', note: 'Healers behind a wall of zombies.', roster: ['zombie', 'zombie', 'necromancer', 'zombie', 'shaman', 'necromancer', 'orc', 'golem'] },
  ],
};
