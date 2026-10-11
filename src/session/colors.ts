/** Tile type n is color COLOR_IDS[n]; the palette and glyphs follow the same order. */
export const COLOR_IDS = ['red', 'blue', 'green', 'yellow', 'white', 'orange', 'violet', 'cyan'] as const;
export type ColorId = (typeof COLOR_IDS)[number];

export const COLOR_NAME: Record<ColorId, string> = {
  red: 'Red',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  white: 'White',
  orange: 'Orange',
  violet: 'Violet',
  cyan: 'Cyan',
};

export const typeOfColor = (id: ColorId): number => COLOR_IDS.indexOf(id);
