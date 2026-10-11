/** Sentinel tile type for an empty cell. */
export const EMPTY = -1;

/** Cell lifecycle. Only Idle + non-empty cells are matchable or swappable. */
export const CellState = {
  Idle: 0,
  Swapping: 1,
  Destroying: 2,
  Falling: 3,
} as const;
export type CellState = (typeof CellState)[keyof typeof CellState];

export const CELL_STATE_LABEL: Record<CellState, string> = {
  [CellState.Idle]: 'Idle',
  [CellState.Swapping]: 'Swapping',
  [CellState.Destroying]: 'Destroying',
  [CellState.Falling]: 'Falling',
};

/** Bonus carried by a tile (travels with the tile through swaps and gravity); fires when the tile is destroyed. */
export const Bonus = { None: 0, Bomb: 1, Line: 2, Coin: 3, Heal: 4, Time: 5, MaxHp: 6, Damage: 7, Bucket: 8 } as const;
export type Bonus = (typeof Bonus)[keyof typeof Bonus];

/** Tile level of a bonus from the match length that made it: 4 → 1, 5 → 2, 6 → 3, 7+ → 4. */
export const bonusLevelForMatch = (length: number): number => Math.max(1, Math.min(4, length - 3));

/** Visual position of a tile, in cell units (x right, y up). Animated by the game. */
export interface TileView {
  type: number;
  x: number;
  y: number;
  scale: number;
  bonus: Bonus;
  /** 1..4; 0 when there is no bonus. */
  bonusLevel: number;
  /** Wildcard: the player may match it as any color; auto-cascades treat it as its own color. */
  universal: boolean;
  /** Pop-in progress of a freshly placed bonus / Universal mark, 0..1 (1 = settled). */
  markAnim: number;
  /** Radians; a small spin while the tile is destroyed. */
  rot: number;
}

/** A fixed grid slot. Cells never move; their contents (type + view) do. */
export interface Cell {
  type: number;
  state: CellState;
  view: TileView | null;
}

export const isEmpty = (c: Cell): boolean => c.type === EMPTY;
export const isActive = (c: Cell): boolean => c.state === CellState.Idle && c.type !== EMPTY;
