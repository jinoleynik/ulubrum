export const LEVEL_COUNT = 100;

/** Level 1 has 3 enemies and every level after adds one. */
export const enemiesForLevel = (level: number): number => level + 2;

/** Spawn assist fades as levels climb: 0.8 on level 1, gone by level 81. */
export const spawnAssistForLevel = (c: { spawnAssistStart: number; spawnAssistPerLevel: number }, level: number): number =>
  Math.max(0, Math.min(1, c.spawnAssistStart - (level - 1) * c.spawnAssistPerLevel));

/** The level map shows this many levels at a time, so it never needs to scroll. */
export const LEVELS_PER_PAGE = 10;
export const PAGE_COUNT = Math.ceil(LEVEL_COUNT / LEVELS_PER_PAGE);

/** 0-based page that holds `level`. */
export const pageOfLevel = (level: number): number =>
  Math.min(PAGE_COUNT - 1, Math.max(0, Math.floor((Math.max(1, level) - 1) / LEVELS_PER_PAGE)));

/** Levels on a page, lowest first. */
export const levelsOnPage = (page: number): number[] =>
  Array.from({ length: LEVELS_PER_PAGE }, (_, i) => page * LEVELS_PER_PAGE + i + 1).filter((l) => l <= LEVEL_COUNT);

export type LevelState = 'done' | 'current' | 'locked';

/** `completed` is the highest level beaten so far (0 = none). The next one is the current level. */
export function levelState(level: number, completed: number): LevelState {
  if (level <= completed) return 'done';
  return level === completed + 1 ? 'current' : 'locked';
}
