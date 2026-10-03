import { Board, type MatchRun } from './board';
import type { Match3Config } from './config';
import { mulberry32 } from './rng';
import { FrameScheduler } from './scheduler';
import type { Rng } from './rng';
import { Charger, CellState, isActive, type TileView } from './types';

export type GameEvent =
  | { kind: 'boardCreated'; seed: number }
  | { kind: 'swapCommitted'; a: number; b: number; joinedChain: boolean }
  | { kind: 'swapReverted'; a: number; b: number }
  | { kind: 'swapBlocked'; a: number; b: number; reason: string }
  | { kind: 'waveStarted'; wave: number; count: number }
  | { kind: 'splash'; added: number }
  | { kind: 'waveDestroying'; wave: number; tiles: DestroyedTile[] }
  | { kind: 'chargersGranted'; granted: { index: number; charger: Charger }[] }
  | { kind: 'chainFinished'; waves: number }
  | { kind: 'reshuffled'; attempts: number }
  | { kind: 'spawnFallback'; x: number; y: number }
  | { kind: 'violation'; message: string }
  | { kind: 'halted' };

/** A tile claimed for destruction, as it was just before it disappears. */
export interface DestroyedTile {
  index: number;
  type: number;
  charger: Charger;
}

/** Skill levels that drive chargers on the board. 0 disables the skill. */
export interface ChargerSkills {
  heal: number;
  explosion: number;
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
  /** Optional fixed starting layout (see Board.fromRows). Otherwise a match-free random fill. */
  layout?: string[];
  scheduler?: FrameScheduler;
  /** Levels for charger grants and explosion splash. Defaults to both off. */
  chargerSkills?: ChargerSkills;
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

  readonly chargerSkills: Readonly<ChargerSkills>;
  private readonly rng: Rng;
  private pendingGrants: { charger: Charger; count: number }[] = [];
  private listeners = new Set<(e: GameEvent) => void>();

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
    this.chargerSkills = { heal: 0, explosion: 0, ...opts.chargerSkills };
    const hooks = {
      onViolation: (message: string) => this.emit({ kind: 'violation', message }),
      onSpawnFallback: (x: number, y: number) => this.emit({ kind: 'spawnFallback', x, y }),
    };

    if (opts.layout) {
      this.board = Board.fromRows(opts.layout, config.colorCount, rng, hooks);
    } else {
      this.board = new Board(config.width, config.height, config.colorCount, rng, hooks);
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
    if (this._halted || !isActive(this.board.cells[i])) return;
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
    if (this._halted) return false;
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
    if (!board.swapCreatesMatch(a, b)) {
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

  // ── RESOLVE CHAIN ────────────────────────────────────────────

  /** Starts the chain, or marks the running one dirty. Never starts a second chain. */
  private requestResolve(playerWave: boolean): void {
    if (this._halted) return;
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
      const opening = this.stats.wave === 1;
      if (opening) {
        this.queueChargerGrants(runs);
        this.addExplosionSplash(matches);
      }
      if (splash) this.addSplash(matches);
      splash = false;
      this.emit({ kind: 'waveStarted', wave: this.stats.wave, count: matches.size });

      await this.destroyTiles(matches);
      await this.dropTiles();
    }

    this.chainRunning = false;
    if (!this._halted) this.applyChargerGrants();
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
    this.reshuffling = false;

    // Boards with few colors can spawn matches; let the normal chain clear them.
    if (board.findMatches().size > 0) this.requestResolve(false);
    else void this.reshuffleIfStuck();
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

  /** Opening wave only: 4+ lines in a skill color earn `length - (min - 1)` chargers each. */
  private queueChargerGrants(runs: MatchRun[]): void {
    const { config, chargerSkills } = this;
    for (const run of runs) {
      let charger: Charger = Charger.None;
      if (run.type === config.healChargerType && chargerSkills.heal > 0) charger = Charger.Heal;
      else if (run.type === config.explosionChargerType && chargerSkills.explosion > 0) charger = Charger.Explosion;
      if (charger === Charger.None || run.length < config.chargerMinMatchLength) continue;
      this.pendingGrants.push({ charger, count: run.length - (config.chargerMinMatchLength - 1) });
    }
  }

  /** Marks random Idle, unmarked tiles once the board has settled. */
  private applyChargerGrants(): void {
    const grants = this.pendingGrants;
    this.pendingGrants = [];
    const granted: { index: number; charger: Charger }[] = [];
    for (const { charger, count } of grants) {
      for (let n = 0; n < count; n++) {
        const candidates: number[] = [];
        this.board.cells.forEach((c, i) => {
          if (isActive(c) && c.view && c.view.charger === Charger.None) candidates.push(i);
        });
        if (candidates.length === 0) break;
        const i = candidates[Math.floor(this.rng() * candidates.length)];
        this.board.cells[i].view!.charger = charger;
        granted.push({ index: i, charger });
      }
    }
    if (granted.length) this.emit({ kind: 'chargersGranted', granted });
  }

  /** Opening wave only: matched Explosion tiles clear the Chebyshev square around them. Splash tiles never splash. */
  private addExplosionSplash(matches: Set<number>): void {
    const { board } = this;
    const level = this.chargerSkills.explosion;
    if (level <= 0) return;
    const radius = Math.max(1, level);
    const extra = new Set<number>();
    for (const i of matches) {
      if (board.cells[i].view?.charger !== Charger.Explosion) continue;
      const x = board.xOf(i), y = board.yOf(i);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (!board.inBounds(nx, ny)) continue;
          const n = board.idx(nx, ny);
          if (!matches.has(n) && isActive(board.cells[n])) extra.add(n);
        }
      }
    }
    for (const n of extra) matches.add(n);
    if (extra.size) this.emit({ kind: 'splash', added: extra.size });
  }

  /** tiles_dest: claim → Destroying → animate → clear. */
  private async destroyTiles(matches: Set<number>): Promise<void> {
    const { board } = this;
    const claimed: number[] = [];
    for (const i of matches) {
      const c = board.cells[i];
      if (!isActive(c)) continue; // never claim non-Idle
      c.state = CellState.Destroying;
      claimed.push(i);
    }
    if (this._selected >= 0 && board.cells[this._selected].state === CellState.Destroying) this.deselect();

    // Listeners (score, combat, charger effects) see the tiles while they still exist.
    this.emit({
      kind: 'waveDestroying',
      wave: this.stats.wave,
      tiles: claimed.map((index) => ({
        index,
        type: board.cells[index].type,
        charger: board.cells[index].view?.charger ?? Charger.None,
      })),
    });

    await this.scheduler.tween(this.config.destroyDuration, (k) => {
      for (const i of claimed) board.cells[i].view!.scale = 1 - k;
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

function makeView(type: number, x: number, y: number): TileView {
  return { type, x, y, scale: 1, charger: Charger.None };
}
