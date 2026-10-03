# Match-3 MVP

Move + match logic for an 8×8 (configurable) Match-3 grid. The rules live in a pure TypeScript core with no DOM dependency. A canvas page on top of it is used to play, watch and polish the logic.

## Quick start

```bash
pnpm install
pnpm dev        # test bench at http://localhost:5173
pnpm test       # unit + stress tests
pnpm build      # typecheck + production bundle in dist/
```

Requires Node 20+. The pnpm version is pinned through `packageManager`, so `corepack enable` picks the right one.

## Layout

```
src/
  core/                 pure rules, no DOM — portable and unit-tested
    types.ts            Cell, CellState, TileView
    config.ts           Match3Config + defaults
    rng.ts              seedable PRNG (reproducible boards)
    scheduler.ts        frame-driven coroutines (tick / tween / waitUntil)
    board.ts            findMatches, swapCreatesMatch, wouldCreateMatchAt, gravity, spawn
    game.ts             swap flow, single resolve chain, selection, halt, events
    input.ts            drag + click-select in cell-space coordinates
  render/
    canvasRenderer.ts   draws the board, optional cell-state overlay
    pointer.ts          DOM pointer events → InputController
  ui/panel.ts           controls, live stats, event log
  main.ts               wiring + requestAnimationFrame loop
tests/
  board.test.ts         grid rules
  game.test.ts          swap / resolve / splash / halt
  input.test.ts         tap and drag behaviour
  stress.test.ts        random swaps at random times, invariants checked
```

## Rules

**Coordinates.** `x` is the column, left→right. `y` is the row, bottom→top: `y = 0` is the bottom row, and gravity packs toward it. Cell index `i = x + y * width`.

**Cell states.** `Idle | Swapping | Destroying | Falling`. Only Idle, non-empty cells can be matched or swapped (`isActive`).

**Swap**
1. Both cells are marked `Swapping` and animated.
2. The swap is then validated against the board as it is at that moment. Other tiles may have changed during the animation.
3. If the swap creates no straight line of 3 or more, it animates back and both cells return to `Idle`.
4. Otherwise the types and views are committed, both cells return to `Idle`, and a resolve is requested as a player wave.

**Resolve: one chain at a time.** The chain repeats these steps until a scan finds no matches:
1. Wait until no swaps are in flight and no drop is running.
2. `findMatches()` scans the whole board.
3. `tiles_dest`: claim the matched Idle cells → `Destroying` → animate → clear.
4. `tiles_drop`: apply gravity to every affected column, then run a single spawn pass, bottom→top and left→right, using `wouldCreateMatchAt`.

A swap that commits while the chain is running marks it dirty and joins the next wave. A second chain is never started.

**Hard rules and where they are enforced**

| Rule | Where |
|---|---|
| One resolve chain | `Game.requestResolve`; a second start is reported as a violation |
| Serial, global spawn | `Board.fillEmpty`, a single pass after `applyGravity` |
| Never match Falling, Destroying or Swapping cells | `isActive` gate in `findMatches`, `destroyTiles` and `trySwap` |
| Gravity never moves a mid-swap tile | Columns waiting for gravity reject new swaps, and gravity waits for swaps already in flight; a breach is reported as a violation |
| `halt()` stops coroutines and locks input | `FrameScheduler.clear()` and the `halted` flag |

The optional **splash** (`firstWaveSplash`) also clears the Idle orthogonal neighbours of matched tiles, but only on the first wave of a chain started by the player.

## Test bench

- **Speed** goes down to 0.05×. Use it to swap tiles while a cascade is running.
- **Show cell states** draws each cell's coordinates and marks cells as S (swapping), D (destroying) or F (falling).
- **Rule violations** must stay at 0.
- **Possible moves** turns orange when the board has no valid move. There is no reshuffle yet.
- **Seed** replays the same board. **Colors** set to 3–4 shows the case where no colour can spawn without making a match; the log reports it.
- In DevTools, `game` is exposed on `window`.

## Writing tests

`Board.fromRows` takes rows top-first, so a test layout reads the same way as the screen. Digits are tile types and `.` is an empty cell:

```ts
const { game } = makeGame(['4523', '3452', '2034', '0105']);
game.trySwap(game.board.idx(1, 0), game.board.idx(1, 1)); // makes 0,0,0 on the bottom row
await settle(game);
assertSettled(game); // all Idle, views in place, no matches left
```

`settle` and `frames` drive the scheduler by hand, so tests are deterministic and need no timers.
