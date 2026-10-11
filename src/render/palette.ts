/** Tile colors by type. Each type also gets a glyph so colors are never the only cue. */
/** Same order as COLOR_IDS: red, blue, green, yellow, white, orange, violet, cyan. */
export const TILE_COLORS = ['#E5484D', '#3E8EF7', '#30A46C', '#F5C518', '#E8EDF5', '#F08C2B', '#8E4EC6', '#22D3EE'];

/** Light tiles need a dark glyph. */
export const DARK_GLYPH = new Set([3, 4, 7]);

export const STATE_COLORS = {
  swapping: '#F5C518',
  destroying: '#E5484D',
  falling: '#3E8EF7',
} as const;
