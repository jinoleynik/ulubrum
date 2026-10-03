export interface Match3Config {
  width: number;
  height: number;
  /** Number of tile types. 5+ guarantees match-free spawns. */
  colorCount: number;
  /** Seconds. */
  swapDuration: number;
  /** Seconds. */
  destroyDuration: number;
  /** Cells / s². */
  fallGravity: number;
  /** Cells / s. */
  maxFallSpeed: number;
  /** Drag distance in cells before a press becomes a swap. */
  dragThreshold: number;
  /** Visual scale multiplier for the selected tile. */
  selectScale: number;
  /** Player's first wave only: also clear Idle orthogonal neighbours of matched tiles. */
  firstWaveSplash: boolean;
  /** When the settled board has no valid swap, clear it and drop a fresh set of tiles. */
  reshuffleOnNoMoves: boolean;
  /** Tile color whose 4+ lines grant Heal chargers. */
  healChargerType: number;
  /** Tile color whose 4+ lines grant Explosion chargers. */
  explosionChargerType: number;
  /** Shortest line that grants a charger. */
  chargerMinMatchLength: number;
}

export const defaultConfig: Readonly<Match3Config> = {
  width: 8,
  height: 8,
  colorCount: 6,
  swapDuration: 0.15,
  destroyDuration: 0.2,
  fallGravity: 60,
  maxFallSpeed: 18,
  dragThreshold: 0.35,
  selectScale: 1.15,
  firstWaveSplash: false,
  reshuffleOnNoMoves: true,
  healChargerType: 2,
  explosionChargerType: 0,
  chargerMinMatchLength: 4,
};

export function validateConfig(c: Match3Config): string[] {
  const problems: string[] = [];
  if (c.width < 3 || c.height < 3) problems.push('Grid must be at least 3×3.');
  if (c.colorCount < 3) problems.push('Need at least 3 colors.');
  else if (c.colorCount < 5) problems.push('With fewer than 5 colors a match-free spawn is not always possible.');
  return problems;
}
