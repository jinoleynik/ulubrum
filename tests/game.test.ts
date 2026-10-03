import { describe, expect, it } from 'vitest';
import { CellState } from '../src/core';
import { assertSettled, frames, makeGame, settle } from './helpers';

// y=3 at top. Swapping (1,0)↔(1,1) makes 0,0,0 on the bottom row.
const LAYOUT = ['4523', '3452', '2034', '0105'];

describe('swap', () => {
  it('reverts a swap that creates no match', async () => {
    const { game, events } = makeGame(LAYOUT);
    const b = game.board;
    expect(game.trySwap(b.idx(3, 0), b.idx(3, 1))).toBe(true);
    expect(b.at(3, 0).state).toBe(CellState.Swapping);
    await settle(game);
    expect(b.toRows()).toEqual(LAYOUT);
    expect(events.some((e) => e.kind === 'swapReverted')).toBe(true);
    expect(game.stats.chains).toBe(0);
    assertSettled(game);
  });

  it('commits a matching swap, clears, refills and settles match-free', async () => {
    const { game, events } = makeGame(LAYOUT);
    const b = game.board;
    game.trySwap(b.idx(1, 0), b.idx(1, 1));
    await settle(game);
    expect(game.stats.validSwaps).toBe(1);
    expect(game.stats.cleared).toBeGreaterThanOrEqual(3);
    expect(events.filter((e) => e.kind === 'chainFinished')).toHaveLength(1);
    assertSettled(game);
  });

  it('rejects non-adjacent, diagonal and out-of-board swaps', () => {
    const { game } = makeGame(LAYOUT);
    const b = game.board;
    expect(game.trySwap(b.idx(0, 0), b.idx(2, 0))).toBe(false);
    expect(game.trySwap(b.idx(0, 0), b.idx(1, 1))).toBe(false);
    expect(game.trySwap(b.idx(0, 0), -1)).toBe(false);
  });

  it('rejects swapping a tile that is already Swapping', async () => {
    const { game } = makeGame(LAYOUT);
    const b = game.board;
    game.trySwap(b.idx(3, 0), b.idx(3, 1));
    expect(game.trySwap(b.idx(3, 1), b.idx(3, 2))).toBe(false);
    await settle(game);
  });
});

describe('resolve chain', () => {
  it('never runs two chains, even with swaps landing mid-cascade', async () => {
    const { game, events } = makeGame(undefined, {}, 7);
    const b = game.board;
    let attempts = 0;
    for (let f = 0; f < 3000; f++) {
      // Fire a valid swap whenever one exists and a chain is running.
      if (game.isChainRunning && f % 5 === 0) {
        outer: for (let i = 0; i < b.cells.length; i++) {
          for (const j of [i + 1, i + b.width]) {
            if (j >= b.cells.length || !b.isAdjacent(i, j)) continue;
            if (game.board.cells[i].state !== CellState.Idle) continue;
            if (b.swapCreatesMatch(i, j) && game.trySwap(i, j)) {
              attempts++;
              break outer;
            }
          }
        }
      } else if (!game.isBusy) {
        // kick off a new chain
        for (let i = 0; i < b.cells.length - 1; i++) {
          if (b.isAdjacent(i, i + 1) && b.swapCreatesMatch(i, i + 1)) {
            game.trySwap(i, i + 1);
            break;
          }
        }
      }
      await frames(game, 1);
    }
    await settle(game);

    expect(game.stats.violations).toBe(0);
    expect(attempts).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'swapCommitted' && e.joinedChain)).toBe(true);
    const started = game.stats.chains;
    const finished = events.filter((e) => e.kind === 'chainFinished').length;
    expect(finished).toBe(started);
    assertSettled(game);
  });

  it('splashes neighbours only on the first player wave', async () => {
    const { game, events } = makeGame(LAYOUT, { firstWaveSplash: true });
    game.trySwap(game.board.idx(1, 0), game.board.idx(1, 1));
    await settle(game);
    const splashes = events.filter((e) => e.kind === 'splash');
    expect(splashes).toHaveLength(1);
    expect(game.stats.cleared).toBeGreaterThan(3);
    assertSettled(game);
  });
});

describe('halt', () => {
  it('freezes everything and locks input', async () => {
    const { game } = makeGame(LAYOUT);
    const b = game.board;
    game.trySwap(b.idx(1, 0), b.idx(1, 1));
    await frames(game, 3);
    game.halt();
    const snapshot = JSON.stringify(b.cells);
    await frames(game, 200);
    expect(JSON.stringify(b.cells)).toBe(snapshot);
    expect(game.scheduler.pending).toBe(0);
    expect(game.trySwap(b.idx(3, 0), b.idx(3, 1))).toBe(false);
  });
});
