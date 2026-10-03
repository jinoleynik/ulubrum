import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core';
import { assertSettled, frames, makeGame, settle } from './helpers';

/**
 * Random input at random times, including mid-destroy and mid-drop,
 * then checks every hard rule held and the board settled cleanly.
 */
describe('stress', () => {
  it.each([1, 2, 3, 42, 1234])('seed %i survives random play', async (seed) => {
    const { game } = makeGame(undefined, { colorCount: 5 }, seed);
    const rnd = mulberry32(seed * 7 + 1);
    const { board } = game;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

    for (let f = 0; f < 4000; f++) {
      if (rnd() < 0.1) {
        const x = Math.floor(rnd() * board.width);
        const y = Math.floor(rnd() * board.height);
        const [dx, dy] = dirs[Math.floor(rnd() * 4)];
        if (board.inBounds(x + dx, y + dy)) game.trySwap(board.idx(x, y), board.idx(x + dx, y + dy));
      }
      await frames(game, 1);
    }
    await settle(game);

    expect(game.stats.violations).toBe(0);
    expect(game.stats.validSwaps).toBeGreaterThan(0);
    assertSettled(game);
  });
});
