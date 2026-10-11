import type { Rng } from './rng';
import { CellState, EMPTY, isActive, type Cell } from './types';

export interface BoardHooks {
  /** A rule was broken (e.g. gravity touched a Swapping cell). */
  onViolation?: (message: string) => void;
  /** No color could be spawned without creating a match. */
  onSpawnFallback?: (x: number, y: number) => void;
}

/** One straight line of 3+ same-colored cells. */
export interface MatchRun {
  type: number;
  length: number;
  cells: number[];
}

type Eligible = (x: number, y: number) => boolean;

/**
 * Pure grid rules — no timing, no rendering.
 * x = column 0..width-1 left→right, y = row 0..height-1 bottom→top (gravity toward y=0).
 * Cells are addressed by index i = x + y * width.
 */
export class Board {
  readonly cells: Cell[];
  /** See Match3Config.spawnAssist. */
  spawnAssist = 0;
  private readonly spawnOrder: number[];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly colorCount: number,
    private readonly rng: Rng,
    private readonly hooks: BoardHooks = {},
  ) {
    this.cells = Array.from({ length: width * height }, () => ({
      type: EMPTY,
      state: CellState.Idle,
      view: null,
    }));
    this.spawnOrder = new Array<number>(colorCount);
  }

  /**
   * Build a board from text rows, top row first (so it reads like the screen).
   * Digits are tile types, '.' is empty.
   */
  static fromRows(rows: string[], colorCount: number, rng: Rng, hooks?: BoardHooks): Board {
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    const board = new Board(width, height, colorCount, rng, hooks);
    rows.forEach((row, r) => {
      if (row.length !== width) throw new Error(`Row ${r} has length ${row.length}, expected ${width}`);
      const y = height - 1 - r;
      for (let x = 0; x < width; x++) {
        const ch = row[x];
        board.at(x, y).type = ch === '.' ? EMPTY : Number(ch);
      }
    });
    return board;
  }

  /** Inverse of fromRows. Handy for test failure messages. */
  toRows(): string[] {
    const rows: string[] = [];
    for (let y = this.height - 1; y >= 0; y--) {
      let s = '';
      for (let x = 0; x < this.width; x++) {
        const t = this.at(x, y).type;
        s += t === EMPTY ? '.' : String(t);
      }
      rows.push(s);
    }
    return rows;
  }

  // ── addressing ───────────────────────────────────────────────

  idx(x: number, y: number): number {
    return x + y * this.width;
  }
  xOf(i: number): number {
    return i % this.width;
  }
  yOf(i: number): number {
    return Math.floor(i / this.width);
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }
  at(x: number, y: number): Cell {
    return this.cells[this.idx(x, y)];
  }
  isAdjacent(a: number, b: number): boolean {
    return Math.abs(this.xOf(a) - this.xOf(b)) + Math.abs(this.yOf(a) - this.yOf(b)) === 1;
  }

  // ── MATCH ────────────────────────────────────────────────────

  /** Cells of every 3+ straight line on the board, as one set. */
  findMatches(): Set<number> {
    return this.findMatchRuns().cells;
  }

  /**
   * Whole-board scan for 3+ identical colors in a straight row or column.
   * Only Idle non-empty cells participate; any other state breaks a run.
   * `cells` is the union of all runs (so L/T/+ shapes come out connected);
   * `runs` keeps each straight line for charger grants.
   */
  findMatchRuns(): { cells: Set<number>; runs: MatchRun[] } {
    const cells = new Set<number>();
    const runs: MatchRun[] = [];
    const same = (a: Cell, b: Cell) => isActive(a) && isActive(b) && a.type === b.type;
    const record = (type: number, run: number[]) => {
      runs.push({ type, length: run.length, cells: run });
      for (const i of run) cells.add(i);
    };

    for (let y = 0; y < this.height; y++) {
      let start = 0;
      for (let x = 1; x <= this.width; x++) {
        if (x < this.width && same(this.at(x - 1, y), this.at(x, y))) continue;
        if (x - start >= 3 && isActive(this.at(start, y))) {
          const run: number[] = [];
          for (let i = start; i < x; i++) run.push(this.idx(i, y));
          record(this.at(start, y).type, run);
        }
        start = x;
      }
    }

    for (let x = 0; x < this.width; x++) {
      let start = 0;
      for (let y = 1; y <= this.height; y++) {
        if (y < this.height && same(this.at(x, y - 1), this.at(x, y))) continue;
        if (y - start >= 3 && isActive(this.at(x, start))) {
          const run: number[] = [];
          for (let i = start; i < y; i++) run.push(this.idx(x, i));
          record(this.at(x, start).type, run);
        }
        start = y;
      }
    }

    return { cells, runs };
  }

  // ── SWAP ─────────────────────────────────────────────────────

  /**
   * Would exchanging a and b create a 3+ line through either cell?
   * The two endpoints count as eligible whatever their state; every other cell
   * must be Idle non-empty. The board is restored before returning.
   */
  swapCreatesMatch(a: number, b: number): boolean {
    const ca = this.cells[a];
    const cb = this.cells[b];
    [ca.type, cb.type] = [cb.type, ca.type];

    const eligible: Eligible = (x, y) => {
      const i = this.idx(x, y);
      const c = this.cells[i];
      return c.type !== EMPTY && (c.state === CellState.Idle || i === a || i === b);
    };
    const hit =
      this.lineThrough(this.xOf(a), this.yOf(a), ca.type, eligible) ||
      this.lineThrough(this.xOf(b), this.yOf(b), cb.type, eligible);

    [ca.type, cb.type] = [cb.type, ca.type];
    return hit;
  }

  /** Exchange contents (type + view). States are the caller's job. */
  commitSwap(a: number, b: number): void {
    const ca = this.cells[a];
    const cb = this.cells[b];
    [ca.type, cb.type] = [cb.type, ca.type];
    [ca.view, cb.view] = [cb.view, ca.view];
  }

  /**
   * Would placing `type` at (x, y) complete a 3+ line with neighbouring non-empty
   * tiles, in any state? Falling tiles already sit at their destination in the model.
   */
  wouldCreateMatchAt(x: number, y: number, type: number): boolean {
    return this.lineThrough(x, y, type, (cx, cy) => this.at(cx, cy).type !== EMPTY);
  }

  private lineThrough(x: number, y: number, type: number, eligible: Eligible): boolean {
    if (type === EMPTY) return false;
    const h = this.countSame(x, y, -1, 0, type, eligible) + this.countSame(x, y, 1, 0, type, eligible) + 1;
    if (h >= 3) return true;
    const v = this.countSame(x, y, 0, -1, type, eligible) + this.countSame(x, y, 0, 1, type, eligible) + 1;
    return v >= 3;
  }

  private countSame(x: number, y: number, dx: number, dy: number, type: number, eligible: Eligible): number {
    let n = 0;
    x += dx;
    y += dy;
    while (this.inBounds(x, y) && eligible(x, y) && this.at(x, y).type === type) {
      n++;
      x += dx;
      y += dy;
    }
    return n;
  }

  /** Number of adjacent Idle pairs whose swap would create a match. */
  countPossibleMoves(): number {
    let n = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const a = this.idx(x, y);
        if (!isActive(this.cells[a])) continue;
        if (x + 1 < this.width && isActive(this.at(x + 1, y)) && this.swapCreatesMatch(a, this.idx(x + 1, y))) n++;
        if (y + 1 < this.height && isActive(this.at(x, y + 1)) && this.swapCreatesMatch(a, this.idx(x, y + 1))) n++;
      }
    }
    return n;
  }

  // ── DROP ─────────────────────────────────────────────────────

  columnsWithHoles(): number[] {
    const cols: number[] = [];
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (this.at(x, y).type === EMPTY) {
          cols.push(x);
          break;
        }
      }
    }
    return cols;
  }

  /**
   * Compacts each listed column toward y=0. Moved contents become Falling and their
   * destination indices are pushed to `fallen`.
   * Precondition: no Swapping/Destroying cells in these columns.
   */
  applyGravity(columns: Iterable<number>, fallen: number[]): void {
    for (const x of columns) {
      let write = 0;
      for (let y = 0; y < this.height; y++) {
        const src = this.at(x, y);
        if (src.state === CellState.Swapping || src.state === CellState.Destroying) {
          this.hooks.onViolation?.(`Gravity touched a non-Idle cell at (${x},${y})`);
        }
        if (src.type === EMPTY) continue;
        if (y !== write) {
          const dst = this.at(x, write);
          dst.type = src.type;
          dst.view = src.view;
          dst.state = CellState.Falling;
          src.type = EMPTY;
          src.view = null;
          src.state = CellState.Idle;
          fallen.push(this.idx(x, write));
        }
        write++;
      }
    }
  }

  /**
   * One global spawn pass, bottom→top then left→right. Each new tile is checked
   * against the final post-gravity layout of every column and against all tiles
   * spawned before it, so a spawn never completes a line.
   * Never run this per column in parallel.
   */
  fillEmpty(stateForNew: CellState): number[] {
    const filled: number[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = this.at(x, y);
        if (c.type !== EMPTY) continue;
        c.type = this.pickSpawnType(x, y);
        c.state = stateForNew;
        filled.push(this.idx(x, y));
      }
    }
    return filled;
  }

  /**
   * Swaps in the 5×5 window around (x, y) that would complete a line, if `type` were placed there.
   * Counts moves, not clusters: a tile that sits beside a same-colored pair only scores when a
   * swap can actually finish the line.
   */
  private movesNear(x: number, y: number, type: number): number {
    const cell = this.at(x, y);
    const prev = cell.type;
    cell.type = type;
    const loose: Eligible = (cx, cy) => this.at(cx, cy).type !== EMPTY;
    let moves = 0;
    for (let cy = y - 2; cy <= y + 2; cy++) {
      for (let cx = x - 2; cx <= x + 2; cx++) {
        if (!this.inBounds(cx, cy)) continue;
        const a = this.at(cx, cy);
        if (a.type === EMPTY) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          const nx = cx + dx, ny = cy + dy;
          if (!this.inBounds(nx, ny)) continue;
          const b = this.at(nx, ny);
          if (b.type === EMPTY) continue;
          [a.type, b.type] = [b.type, a.type];
          if (this.lineThrough(cx, cy, a.type, loose) || this.lineThrough(nx, ny, b.type, loose)) moves++;
          [a.type, b.type] = [b.type, a.type];
        }
      }
    }
    // Moves should come from scattered setups, not from clumps: adjacent same colors cost points.
    let clumped = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (this.inBounds(x + dx, y + dy) && this.at(x + dx, y + dy).type === type) clumped++;
    }
    cell.type = prev;
    return moves - 3 * clumped;
  }

  private pickSpawnType(x: number, y: number): number {
    const order = this.spawnOrder;
    const n = this.colorCount;
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (this.spawnAssist > 0 && this.rng() < this.spawnAssist) {
      let best = -1, bestScore = -1;
      for (let i = 0; i < n; i++) {
        if (this.wouldCreateMatchAt(x, y, order[i])) continue;
        const score = this.movesNear(x, y, order[i]);
        if (score > bestScore) {
          best = order[i];
          bestScore = score;
        }
      }
      if (best >= 0) return best;
    }
    for (let i = 0; i < n; i++) {
      if (!this.wouldCreateMatchAt(x, y, order[i])) return order[i];
    }
    this.hooks.onSpawnFallback?.(x, y);
    return order[0];
  }
}
