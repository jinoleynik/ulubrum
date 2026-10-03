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

/** Skill marker carried by a tile (travels with the tile through swaps and gravity). */
export const Charger = { None: 0, Heal: 1, Explosion: 2 } as const;
export type Charger = (typeof Charger)[keyof typeof Charger];

/** Visual position of a tile, in cell units (x right, y up). Animated by the game. */
export interface TileView {
  type: number;
  x: number;
  y: number;
  scale: number;
  charger: Charger;
}

/** A fixed grid slot. Cells never move; their contents (type + view) do. */
export interface Cell {
  type: number;
  state: CellState;
  view: TileView | null;
}

export const isEmpty = (c: Cell): boolean => c.type === EMPTY;
export const isActive = (c: Cell): boolean => c.state === CellState.Idle && c.type !== EMPTY;
