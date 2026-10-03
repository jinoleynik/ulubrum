import { describe, expect, it } from 'vitest';
import { Board, CellState, mulberry32 } from '../src/core';

const rng = mulberry32(1);
const board = (rows: string[], colors = 6) => Board.fromRows(rows, colors, rng);
const cellsOf = (b: Board, set: Set<number>) =>
  [...set].map((i) => `${b.xOf(i)},${b.yOf(i)}`).sort();

describe('coordinates', () => {
  it('uses y=0 for the bottom row', () => {
    const b = board(['12', '34']);
    expect(b.at(0, 0).type).toBe(3);
    expect(b.at(1, 1).type).toBe(2);
    expect(b.toRows()).toEqual(['12', '34']);
  });
});

describe('findMatches', () => {
  it('finds a horizontal run of 3', () => {
    const b = board(['1234', '0005']);
    expect(cellsOf(b, b.findMatches())).toEqual(['0,0', '1,0', '2,0']);
  });

  it('finds a vertical run of 4', () => {
    const b = board(['21', '23', '24', '25']);
    expect(cellsOf(b, b.findMatches())).toEqual(['0,0', '0,1', '0,2', '0,3']);
  });

  it('merges crossing runs', () => {
    const b = board(['313', '111', '313']);
    expect(b.findMatches().size).toBe(5);
  });

  it('ignores runs of 2', () => {
    expect(board(['1123', '2311']).findMatches().size).toBe(0);
  });

  it.each([CellState.Swapping, CellState.Destroying, CellState.Falling])(
    'treats a %s cell as a break in the run',
    (state) => {
      const b = board(['0000']);
      b.at(2, 0).state = state;
      expect(b.findMatches().size).toBe(0);
    },
  );

  it('ignores empty cells', () => {
    expect(board(['1.11']).findMatches().size).toBe(0);
  });
});

describe('swapCreatesMatch', () => {
  const rows = ['4523', '3452', '2034', '0105'];

  it('accepts a swap that forms a line', () => {
    const b = board(rows);
    expect(b.swapCreatesMatch(b.idx(1, 0), b.idx(1, 1))).toBe(true);
  });

  it('rejects a swap that forms nothing', () => {
    const b = board(rows);
    expect(b.swapCreatesMatch(b.idx(3, 0), b.idx(3, 1))).toBe(false);
  });

  it('leaves the board unchanged', () => {
    const b = board(rows);
    b.swapCreatesMatch(b.idx(1, 0), b.idx(1, 1));
    expect(b.toRows()).toEqual(rows);
  });

  it('does not count a Falling neighbour as part of the line', () => {
    const b = board(rows);
    b.at(2, 0).state = CellState.Falling;
    expect(b.swapCreatesMatch(b.idx(1, 0), b.idx(1, 1))).toBe(false);
  });

  it('allows the two swapping endpoints themselves to be non-Idle', () => {
    const b = board(rows);
    b.at(1, 0).state = CellState.Swapping;
    b.at(1, 1).state = CellState.Swapping;
    expect(b.swapCreatesMatch(b.idx(1, 0), b.idx(1, 1))).toBe(true);
  });
});

describe('wouldCreateMatchAt', () => {
  it('checks both sides of the cell, not just left and below', () => {
    const b = board(['1.1']);
    expect(b.wouldCreateMatchAt(1, 0, 1)).toBe(true);
    expect(b.wouldCreateMatchAt(1, 0, 2)).toBe(false);
  });

  it('counts Falling tiles, since they already sit at their destination', () => {
    const b = board(['1', '1', '.']);
    b.at(0, 1).state = CellState.Falling;
    expect(b.wouldCreateMatchAt(0, 0, 1)).toBe(true);
  });
});

describe('gravity and spawn', () => {
  it('compacts columns toward y=0 and marks moved tiles Falling', () => {
    const b = board(['1', '.', '2', '.']);
    const fallen: number[] = [];
    b.applyGravity([0], fallen);
    expect(b.toRows()).toEqual(['.', '.', '1', '2']);
    expect(fallen.map((i) => b.yOf(i)).sort()).toEqual([0, 1]);
    expect(b.at(0, 0).state).toBe(CellState.Falling);
    expect(b.at(0, 3).state).toBe(CellState.Idle);
  });

  it('reports gravity touching a Swapping cell as a violation', () => {
    const violations: string[] = [];
    const b = Board.fromRows(['1', '.'], 6, rng, { onViolation: (m) => violations.push(m) });
    b.at(0, 1).state = CellState.Swapping;
    b.applyGravity([0], []);
    expect(violations).toHaveLength(1);
  });

  it('fills bottom→top, left→right', () => {
    const b = board(['..', '..']);
    const order = b.fillEmpty(CellState.Falling).map((i) => `${b.xOf(i)},${b.yOf(i)}`);
    expect(order).toEqual(['0,0', '1,0', '0,1', '1,1']);
  });

  it('never spawns a match with 5+ colors (many seeds)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const b = new Board(8, 8, 5, mulberry32(seed));
      b.fillEmpty(CellState.Idle);
      expect(b.findMatches().size, `seed ${seed}`).toBe(0);
    }
  });

  it('spawns match-free into holes left by gravity in several columns at once', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = mulberry32(seed);
      const b = new Board(8, 8, 5, r);
      b.fillEmpty(CellState.Idle);
      // punch random holes, then drop + refill
      for (let k = 0; k < 20; k++) b.cells[Math.floor(r() * 64)].type = -1;
      b.applyGravity(b.columnsWithHoles(), []);
      const spawned = b.fillEmpty(CellState.Idle);
      b.cells.forEach((c) => (c.state = CellState.Idle));
      const matches = b.findMatches();
      for (const i of spawned) expect(matches.has(i), `seed ${seed}`).toBe(false);
    }
  });

  it('falls back and reports when no color fits', () => {
    const fallbacks: string[] = [];
    // Center (2,2): 0,0 on the left, 1,1 on the right, 2,2 below — every color is excluded.
    const b = Board.fromRows(['.....', '.....', '00.11', '..2..', '..2..'], 3, rng, {
      onSpawnFallback: (x, y) => fallbacks.push(`${x},${y}`),
    });
    b.fillEmpty(CellState.Idle);
    expect(fallbacks).toContain('2,2');
  });
});
