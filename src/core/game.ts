import { Board, type MatchRun } from './board';
import type { Match3Config } from './config';
import { mulberry32 } from './rng';
import { FrameScheduler } from './scheduler';
import type { Rng } from './rng';
import { Bonus, bonusLevelForMatch, CellState, isActive, type TileView } from './types';

export type GameEvent =
  | { kind: 'boardCreated'; seed: number }
  | { kind: 'swapCommitted'; a: number; b: number; joinedChain: boolean }
  | { kind: 'swapReverted'; a: number; b: number }
  | { kind: 'swapBlocked'; a: number; b: number; reason: string }
  | { kind: 'waveStarted'; wave: number; count: number }
  | { kind: 'splash'; added: number }
  | { kind: 'waveDestroying'; wave: number; tiles: DestroyedTile[]; player: boolean }
  | { kind: 'tilesMarked'; marked: { index: number; universal: boolean; bonus: Bonus; level: number }[] }
  | { kind: 'chainFinished'; waves: number }
  | { kind: 'reshuffled'; attempts: number }
  | { kind: 'spawnFallback'; x: number; y: number }
  | { kind: 'violation'; message: string }
  | { kind: 'halted' };

/** A tile claimed for destruction, as it was just before it disappears. */
export interface DestroyedTile {
  index: number;
  type: number;
  bonus: Bonus;
  bonusLevel: number;
  /** Tiles this Bomb or Line took with it (0 for everything else). */
  blast: number;
  /** Column of this Line's upward beam, which flies on into the enemy rows above the board; -1 if none. */
  beamColumn: number;
  universal: boolean;
}

export interface GameStats {
  /** Current wave within the running chain. */
  wave: number;
  cleared: number;
  validSwaps: number;
  revertedSwaps: number;
  chains: number;
  violations: number;
}

export interface GameOptions {
  seed: number;
  /** Skill level per bonus type; 0 (or missing) means locked and the bonus never spawns. */
  bonusSkills?: Partial<Record<Bonus, number>>;
  /** Optional fixed starting layout (see Board.fromRows). Otherwise a match-free random fill. */
  layout?: string[];
  scheduler?: FrameScheduler;
}

/**
 * Owns timing: swaps, the single resolve chain, selection and Halt().
 * Call tick(dt) once per frame. Rendering reads `board.cells[i].view`.
 */
export class Game {
  readonly board: Board;
  readonly config: Readonly<Match3Config>;
  readonly scheduler: FrameScheduler;
  readonly stats: GameStats = { wave: 0, cleared: 0, validSwaps: 0, revertedSwaps: 0, chains: 0, violations: 0 };

  private readonly rng: Rng;
  /** Marks queued during a chain; they land on random tiles once the board settles. */
  private pendingMarks: { universal: boolean; bonus: Bonus; level: number }[] = [];
  private readonly bonusSkills: Partial<Record<Bonus, number>>;
  /** Set by a player swap; the next wave is credited to the player. */
  private playerPending = false;
  private listeners = new Set<(e: GameEvent) => void>();

  /** Lets a color force its Line tiles to fire an upward beam (the Orange ultimate). */
  forceBeamUp: (colorType: number) => boolean = () => false;
  /** True while the hero is stunned: swaps and taps are ignored. */
  locked = false;
  private _halted = false;
  private chainRunning = false;
  private dirty = false;
  private dropping = false;
  private reshuffling = false;
  private activeSwaps = 0;
  private readonly pendingColumns = new Set<number>();

  private _selected = -1;
  private _selectedView: TileView | null = null;

  constructor(config: Match3Config, opts: GameOptions) {
    this.config = { ...config };
    this.scheduler = opts.scheduler ?? new FrameScheduler();
    const rng = mulberry32(opts.seed);
    this.rng = rng;
    this.bonusSkills = { ...opts.bonusSkills };
    const hooks = {
      onViolation: (message: string) => this.emit({ kind: 'violation', message }),
      onSpawnFallback: (x: number, y: number) => this.emit({ kind: 'spawnFallback', x, y }),
    };

    if (opts.layout) {
      this.board = Board.fromRows(opts.layout, config.colorCount, rng, hooks);
      this.board.spawnAssist = config.spawnAssist;
    } else {
      this.board = new Board(config.width, config.height, config.colorCount, rng, hooks);
      this.board.spawnAssist = config.spawnAssist;
      this.board.fillEmpty(CellState.Idle);
    }

    this.board.cells.forEach((c, i) => {
      if (c.type >= 0) c.view = makeView(c.type, this.board.xOf(i), this.board.yOf(i));
    });

    queueMicrotask(() => {
      this.emit({ kind: 'boardCreated', seed: opts.seed });
      const m = this.board.findMatches();
      if (m.size) this.emit({ kind: 'violation', message: `Starting board contains ${m.size} matched cells` });
      void this.reshuffleIfStuck();
    });
  }

  // ── public state ─────────────────────────────────────────────

  get halted(): boolean {
    return this._halted;
  }
  get isChainRunning(): boolean {
    return this.chainRunning;
  }
  get isDropping(): boolean {
    return this.dropping;
  }
  get swapsInFlight(): number {
    return this.activeSwaps;
  }
  /** True while anything is animating or resolving. */
  get isBusy(): boolean {
    return this.chainRunning || this.activeSwaps > 0 || this.reshuffling;
  }
  get selected(): number {
    return this._selected;
  }
  get selectedView(): TileView | null {
    return this._selectedView;
  }

  on(listener: (e: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: GameEvent): void {
    if (e.kind === 'violation') this.stats.violations++;
    for (const l of this.listeners) l(e);
  }

  // ── frame ────────────────────────────────────────────────────

  tick(dt: number): void {
    if (this._halted) return;
    this.scheduler.tick(dt);
    this.validateSelection();
  }

  /** Stops every coroutine and locks input. Irreversible; create a new Game to continue. */
  halt(): void {
    if (this._halted) return;
    this._halted = true;
    this.scheduler.clear();
    this.emit({ kind: 'halted' });
  }

  // ── selection ────────────────────────────────────────────────

  /** Click-select behaviour for a tap on cell i. */
  tap(i: number): void {
    if (this._halted || this.locked || !isActive(this.board.cells[i])) return;
    if (this._selected < 0) return this.select(i);
    if (this._selected === i) return this.deselect();
    if (this.board.isAdjacent(this._selected, i)) {
      const s = this._selected;
      this.deselect();
      this.trySwap(s, i);
      return;
    }
    this.select(i); // non-adjacent → reselect
  }

  select(i: number): void {
    if (!isActive(this.board.cells[i])) return;
    this._selected = i;
    this._selectedView = this.board.cells[i].view;
  }

  deselect(): void {
    this._selected = -1;
    this._selectedView = null;
  }

  private validateSelection(): void {
    if (this._selected < 0) return;
    const c = this.board.cells[this._selected];
    if (!isActive(c) || c.view !== this._selectedView) this.deselect();
  }

  // ── SWAP ─────────────────────────────────────────────────────

  /** Starts a swap if both cells are Idle, non-empty and orthogonally adjacent. */
  trySwap(a: number, b: number): boolean {
    const board = this.board;
    if (this._halted || this.locked) return false;
    if (a < 0 || b < 0 || a >= board.cells.length || b >= board.cells.length) return false;
    if (!board.isAdjacent(a, b)) return false;

    const ca = board.cells[a];
    const cb = board.cells[b];
    if (!isActive(ca) || !isActive(cb)) return false;

    if (this.pendingColumns.has(board.xOf(a)) || this.pendingColumns.has(board.xOf(b))) {
      this.emit({ kind: 'swapBlocked', a, b, reason: 'column waiting for gravity' });
      return false;
    }

    ca.state = CellState.Swapping;
    cb.state = CellState.Swapping;
    this.activeSwaps++;
    void this.swapRoutine(a, b);
    return true;
  }

  private async swapRoutine(a: number, b: number): Promise<void> {
    const { board, scheduler, config } = this;
    const ca = board.cells[a];
    const cb = board.cells[b];
    const va = ca.view!;
    const vb = cb.view!;
    const ax = board.xOf(a), ay = board.yOf(a);
    const bx = board.xOf(b), by = board.yOf(b);

    const move = (from: 'a' | 'b') =>
      scheduler.tween(config.swapDuration, (k) => {
        const t = from === 'a' ? k : 1 - k;
        va.x = ax + (bx - ax) * t;
        va.y = ay + (by - ay) * t;
        vb.x = bx + (ax - bx) * t;
        vb.y = by + (ay - by) * t;
      });

    await move('a');

    // Validate against the board as it is now — other tiles may have changed meanwhile.
    if (!this.swapMakesMatch(a, b)) {
      await move('b');
      ca.state = CellState.Idle;
      cb.state = CellState.Idle;
      this.activeSwaps--;
      this.stats.revertedSwaps++;
      this.emit({ kind: 'swapReverted', a, b });
      return;
    }

    board.commitSwap(a, b);
    ca.state = CellState.Idle;
    cb.state = CellState.Idle;
    this.activeSwaps--;
    this.stats.validSwaps++;
    this.emit({ kind: 'swapCommitted', a, b, joinedChain: this.chainRunning });
    this.requestResolve(true);
  }

  /**
   * A swap counts if it makes a line. Universal tiles in the swap's rows and columns may
   * stand in for any color; the first color that works sticks to the tile (it is about to be cleared).
   */
  private swapMakesMatch(a: number, b: number): boolean {
    const { board } = this;
    if (board.swapCreatesMatch(a, b)) return true;
    const near = (i: number) =>
      board.xOf(i) === board.xOf(a) || board.yOf(i) === board.yOf(a) ||
      board.xOf(i) === board.xOf(b) || board.yOf(i) === board.yOf(b);
    for (let w = 0; w < board.cells.length; w++) {
      const cell = board.cells[w];
      if (!cell.view?.universal || cell.type < 0 || !near(w)) continue;
      if (cell.state !== CellState.Idle && w !== a && w !== b) continue;
      const original = cell.type;
      for (let t = 0; t < board.colorCount; t++) {
        if (t === original) continue;
        cell.type = t;
        if (board.swapCreatesMatch(a, b)) {
          cell.view.type = t;
          return true;
        }
      }
      cell.type = original;
    }
    return false;
  }

  // ── TILE MARKS ───────────────────────────────────────────────

  /** Queues `count` random tiles to become Universal once the board settles. */
  queueUniversal(count = 1): void {
    for (let n = 0; n < count; n++) this.pendingMarks.push({ universal: true, bonus: Bonus.None, level: 0 });
    if (!this.chainRunning) this.applyMarks();
  }

  /** Queues a random tile to receive a bonus once the board settles. */
  queueBonus(bonus: Bonus, level = 1): void {
    this.pendingMarks.push({ universal: false, bonus, level });
    if (!this.chainRunning) this.applyMarks();
  }

  /** Bonus types the player has unlocked, i.e. may spawn. */
  unlockedBonuses(): Bonus[] {
    return ([Bonus.Bomb, Bonus.Line, Bonus.Coin, Bonus.Heal, Bonus.Time, Bonus.MaxHp, Bonus.Damage, Bonus.Bucket] as Bonus[]).filter((b) => (this.bonusSkills[b] ?? 0) > 0);
  }

  /** Player action only: every 4+ line leaves a random unlocked bonus, leveled by its length. */
  private queueMatchBonuses(runs: MatchRun[]): void {
    const unlocked = this.unlockedBonuses();
    if (unlocked.length === 0) return;
    for (const run of runs) {
      if (run.length < 4) continue;
      this.queueBonus(unlocked[Math.floor(this.rng() * unlocked.length)], bonusLevelForMatch(run.length));
    }
  }

  // ── RESOLVE CHAIN ────────────────────────────────────────
  /** Starts the chain, or marks the running one dirty. Never starts a second chain. */
  private requestResolve(playerWave: boolean): void {
    if (this._halted) return;
    if (playerWave) this.playerPending = true;
    if (this.chainRunning) {
      this.dirty = true;
      return;
    }
    void this.resolveChain(playerWave);
  }

  private async resolveChain(playerWave: boolean): Promise<void> {
    if (this.chainRunning) {
      this.emit({ kind: 'violation', message: 'A second resolve chain was started' });
      return;
    }
    this.chainRunning = true;
    this.stats.chains++;
    this.stats.wave = 0;
    let splash = playerWave && this.config.firstWaveSplash;

    for (;;) {
      await this.scheduler.waitUntil(() => this.activeSwaps === 0 && !this.dropping);

      const wasDirty = this.dirty;
      this.dirty = false;
      const { cells: matches, runs } = this.board.findMatchRuns();
      if (matches.size === 0) {
        if (wasDirty) continue;
        break;
      }

      this.stats.wave++;
      const player = this.playerPending;
      this.playerPending = false;
      if (player) this.queueMatchBonuses(runs);
      if (splash) this.addSplash(matches);
      splash = false;
      const blasts = this.expandBonuses(matches);
      this.emit({ kind: 'waveStarted', wave: this.stats.wave, count: matches.size });

      await this.destroyTiles(matches, player, blasts);
      await this.dropTiles();
    }

    this.chainRunning = false;
    if (!this._halted) this.applyMarks();
    this.emit({ kind: 'chainFinished', waves: this.stats.wave });
    void this.reshuffleIfStuck();
  }

  /**
   * Dead board: no valid swap exists. Clear every tile, then drop a fresh match-free set
   * that is guaranteed to offer at least one move.
   */
  private async reshuffleIfStuck(): Promise<void> {
    const { board } = this;
    if (!this.config.reshuffleOnNoMoves || this._halted || this.reshuffling || this.chainRunning) return;
    if (board.countPossibleMoves() > 0) return;

    this.reshuffling = true;
    await this.scheduler.waitUntil(() => this.activeSwaps === 0);
    // A swap that landed meanwhile may have started a chain, which re-checks when it ends.
    if (this.chainRunning || board.countPossibleMoves() > 0 || !board.cells.every((c) => isActive(c) || c.type < 0)) {
      this.reshuffling = false;
      return;
    }

    await this.rebuildBoard();
    this.reshuffling = false;
    this.afterReshuffle();
  }

  /**
   * Player action: clears the whole board for a fresh one, dropping every tile bonus and
   * Universal mark with it. Only while nothing is animating.
   */
  reshuffle(): boolean {
    if (this._halted || this.isBusy) return false;
    this.reshuffling = true;
    this.pendingMarks = [];
    void this.rebuildBoard().then(() => {
      this.reshuffling = false;
      this.afterReshuffle();
    });
    return true;
  }

  /** Boards with few colors can spawn matches; let the normal chain clear them. */
  private afterReshuffle(): void {
    if (this._halted) return;
    if (this.board.findMatches().size > 0) this.requestResolve(false);
    else void this.reshuffleIfStuck();
  }

  /** Shrinks every tile away, then drops a fresh match-free set guaranteed to offer a move. */
  private async rebuildBoard(): Promise<void> {
    const { board } = this;
    const claimed: number[] = [];
    board.cells.forEach((c, i) => {
      if (!isActive(c)) return;
      c.state = CellState.Destroying;
      claimed.push(i);
    });
    this.deselect();
    await this.scheduler.tween(this.config.destroyDuration, (k) => {
      for (const i of claimed) board.cells[i].view!.scale = 1 - k;
    });
    for (const i of claimed) {
      const c = board.cells[i];
      c.view = null;
      c.type = -1;
      c.state = CellState.Idle;
    }

    // Roll fresh boards in the model until one has a move (bounded; the last one is kept).
    let attempts = 0;
    do {
      attempts++;
      for (const c of board.cells) {
        c.type = -1;
        c.state = CellState.Idle;
      }
      board.fillEmpty(CellState.Idle);
    } while (board.countPossibleMoves() === 0 && attempts < 100);

    const stack = new Array<number>(board.width).fill(0);
    const falling: number[] = [];
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        const i = board.idx(x, y);
        const c = board.cells[i];
        c.state = CellState.Falling;
        c.view = makeView(c.type, x, board.height + stack[x]++);
        falling.push(i);
      }
    }
    this.emit({ kind: 'reshuffled', attempts });
    await this.animateFalls(falling);
  }

  private addSplash(matches: Set<number>): void {
    const { board } = this;
    const extra = new Set<number>();
    for (const i of matches) {
      const x = board.xOf(i), y = board.yOf(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (!board.inBounds(nx, ny)) continue;
        const n = board.idx(nx, ny);
        if (!matches.has(n) && isActive(board.cells[n])) extra.add(n);
      }
    }
    for (const n of extra) matches.add(n);
    if (extra.size) this.emit({ kind: 'splash', added: extra.size });
  }

  /** Marks random Idle tiles once the board has settled. */
  private applyMarks(): void {
    const marks = this.pendingMarks;
    this.pendingMarks = [];
    const marked: { index: number; universal: boolean; bonus: Bonus; level: number }[] = [];
    for (const m of marks) {
      const candidates: number[] = [];
      this.board.cells.forEach((c, i) => {
        const v = c.view;
        if (!isActive(c) || !v) return;
        if (m.universal ? !v.universal : v.bonus === Bonus.None) candidates.push(i);
      });
      if (candidates.length === 0) continue;
      const i = candidates[Math.floor(this.rng() * candidates.length)];
      const v = this.board.cells[i].view!;
      if (m.universal) v.universal = true;
      else {
        v.bonus = m.bonus;
        v.bonusLevel = m.level;
      }
      v.markAnim = 0;
      void this.scheduler.tween(MARK_POP_SECONDS, (k) => (v.markAnim = k));
      marked.push({ index: i, universal: m.universal, bonus: m.bonus, level: m.level });
    }
    if (marked.length) this.emit({ kind: 'tilesMarked', marked });
  }

  /**
   * Bomb and Line tiles in the wave take other tiles with them, and those may carry bonuses of
   * their own, so this runs until nothing new is added. Coin, Heal and Time are the session's job.
   */
  private expandBonuses(matches: Set<number>): Map<number, { count: number; beam: number }> {
    const { board } = this;
    const done = new Set<number>();
    const blasts = new Map<number, { count: number; beam: number }>();
    let added = 0;
    for (let again = true; again; ) {
      again = false;
      for (const i of [...matches]) {
        const v = board.cells[i].view;
        if (done.has(i) || !v || (v.bonus !== Bonus.Bomb && v.bonus !== Bonus.Line)) continue;
        done.add(i);
        let beam = -1;
        let hit: number[];
        if (v.bonus === Bonus.Bomb) hit = this.bombTargets(i, v.bonusLevel, matches);
        else {
          const line = this.lineTargets(i, v.bonusLevel, matches, this.forceBeamUp(v.type));
          hit = line.tiles;
          if (line.up) beam = board.xOf(i);
        }
        for (const n of hit) {
          matches.add(n);
          added++;
        }
        blasts.set(i, { count: hit.length, beam });
        again = true;
      }
    }
    if (added) this.emit({ kind: 'splash', added });
    return blasts;
  }

  private canTake(i: number, matches: Set<number>): boolean {
    return !matches.has(i) && isActive(this.board.cells[i]);
  }

  /** Level + skill random tiles from the tightest ring around the bomb that holds enough of them. */
  private bombTargets(from: number, level: number, matches: Set<number>): number[] {
    const { board } = this;
    const want = level + (this.bonusSkills[Bonus.Bomb] ?? 0);
    const x = board.xOf(from), y = board.yOf(from);
    const near = (r: number) => {
      const out: number[] = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (!dx && !dy) continue;
          if (!board.inBounds(x + dx, y + dy)) continue;
          const n = board.idx(x + dx, y + dy);
          if (this.canTake(n, matches)) out.push(n);
        }
      }
      return out;
    };
    let pool = near(1);
    for (let r = 2; pool.length < want && r <= Math.max(board.width, board.height); r++) pool = near(r);
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(this.rng() * (k + 1));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    return pool.slice(0, want);
  }

  /**
   * Level 1: one random ray. 2: a row or a column. 3: a T (three rays). 4: row and column.
   * An upward ray flies on past the board into the enemy rows (`up`); `forceUp` guarantees one.
   */
  private lineTargets(from: number, level: number, matches: Set<number>, forceUp: boolean): { tiles: number[]; up: boolean } {
    const { board } = this;
    const UP: [number, number] = [0, 1];
    const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let k = dirs.length - 1; k > 0; k--) {
      const j = Math.floor(this.rng() * (k + 1));
      [dirs[k], dirs[j]] = [dirs[j], dirs[k]];
    }
    let chosen: [number, number][];
    if (level <= 1) chosen = dirs.slice(0, 1);
    else if (level === 2) chosen = dirs[0][0] !== 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    else if (level === 3) chosen = dirs.slice(0, 3);
    else chosen = dirs;
    const hasUp = (list: [number, number][]) => list.some(([dx, dy]) => dx === 0 && dy === 1);
    if (forceUp && !hasUp(chosen)) {
      if (level <= 1) chosen = [UP];
      else if (level === 2) chosen = [[0, 1], [0, -1]];
      else chosen = [UP, ...chosen.filter(([dx, dy]) => !(dx === 0 && dy === -1)).slice(0, 2)];
    }
    const out: number[] = [];
    for (const [dx, dy] of chosen) {
      let x = board.xOf(from) + dx, y = board.yOf(from) + dy;
      for (; board.inBounds(x, y); x += dx, y += dy) {
        const n = board.idx(x, y);
        if (this.canTake(n, matches)) out.push(n);
      }
    }
    return { tiles: out, up: hasUp(chosen) };
  }

  /** tiles_dest: claim → Destroying → animate → clear. */
  private async destroyTiles(matches: Set<number>, player: boolean, blasts: Map<number, { count: number; beam: number }>): Promise<void> {
    const { board } = this;
    const claimed: number[] = [];
    for (const i of matches) {
      const c = board.cells[i];
      if (!isActive(c)) continue; // never claim non-Idle
      c.state = CellState.Destroying;
      claimed.push(i);
    }
    if (this._selected >= 0 && board.cells[this._selected].state === CellState.Destroying) this.deselect();

    // Listeners (score, combat, color skills) see the tiles while they still exist.
    this.emit({
      kind: 'waveDestroying',
      wave: this.stats.wave,
      player,
      tiles: claimed.map((index) => ({
        index,
        type: board.cells[index].type,
        bonus: board.cells[index].view?.bonus ?? Bonus.None,
        bonusLevel: board.cells[index].view?.bonusLevel ?? 0,
        blast: blasts.get(index)?.count ?? 0,
        beamColumn: blasts.get(index)?.beam ?? -1,
        universal: board.cells[index].view?.universal ?? false,
      })),
    });

    await this.scheduler.tween(this.config.destroyDuration, (k) => {
      for (const i of claimed) {
        const v = board.cells[i].view!;
        v.scale = popScale(k);
        v.rot = k * 0.5 * (i % 2 ? 1 : -1);
      }
    });

    for (const i of claimed) {
      const c = board.cells[i];
      c.view = null;
      c.type = -1;
      c.state = CellState.Idle;
    }
    this.stats.cleared += claimed.length;
  }

  /** tiles_drop: gravity for all affected columns first, then one global spawn pass. */
  private async dropTiles(): Promise<void> {
    const { board } = this;
    this.dropping = true;

    const columns = board.columnsWithHoles();
    for (const x of columns) this.pendingColumns.add(x); // no new swaps there

    // Swaps already in flight must land before gravity moves anything.
    await this.scheduler.waitUntil(() => this.activeSwaps === 0);

    const falling: number[] = [];
    board.applyGravity(columns, falling);
    const spawned = board.fillEmpty(CellState.Falling);

    const stack = new Array<number>(board.width).fill(0);
    for (const i of spawned) {
      const x = board.xOf(i);
      const c = board.cells[i];
      c.view = makeView(c.type, x, board.height + stack[x]++);
      falling.push(i);
    }
    this.pendingColumns.clear(); // moved/spawned cells are Falling → not swappable anyway

    if (this._selected >= 0 && board.cells[this._selected].view !== this._selectedView) this.deselect();

    await this.animateFalls(falling);
    this.dropping = false;
  }

  private async animateFalls(targets: number[]): Promise<void> {
    const { board, config } = this;
    const speed = new Array<number>(targets.length).fill(0);
    const landed = new Array<boolean>(targets.length).fill(false);
    let remaining = targets.length;

    while (remaining > 0) {
      const dt = await this.scheduler.nextFrame();
      for (let k = 0; k < targets.length; k++) {
        if (landed[k]) continue;
        const i = targets[k];
        const c = board.cells[i];
        const v = c.view!;
        const ty = board.yOf(i);
        speed[k] = Math.min(speed[k] + config.fallGravity * dt, config.maxFallSpeed);
        v.y -= speed[k] * dt;
        if (v.y <= ty) {
          v.y = ty;
          landed[k] = true;
          remaining--;
          c.state = CellState.Idle; // interactive & matchable from now on
        }
      }
    }
  }
}

/** Seconds a new bonus / Universal mark takes to pop in. */
const MARK_POP_SECONDS = 0.4;

/** Destroy animation: swell to 1.2× in the first quarter, then shrink away. */
export const popScale = (k: number): number => (k < 0.25 ? 1 + 0.2 * (k / 0.25) : 1.2 * (1 - (k - 0.25) / 0.75));

function makeView(type: number, x: number, y: number): TileView {
  return { type, x, y, scale: 1, bonus: Bonus.None, bonusLevel: 0, universal: false, markAnim: 1, rot: 0 };
}
