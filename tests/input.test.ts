import { describe, expect, it } from 'vitest';
import { CellState, InputController } from '../src/core';
import { makeGame, settle } from './helpers';

const LAYOUT = ['4523', '3452', '2034', '0105'];
const center = (x: number, y: number) => [x + 0.5, y + 0.5] as const;

function setup() {
  const { game } = makeGame(LAYOUT);
  const input = new InputController(game);
  const tap = (x: number, y: number) => {
    input.down(...center(x, y));
    input.up();
  };
  return { game, input, tap };
}

describe('click-select', () => {
  it('selects, then deselects on the same tile', () => {
    const { game, tap } = setup();
    tap(0, 0);
    expect(game.selected).toBe(game.board.idx(0, 0));
    tap(0, 0);
    expect(game.selected).toBe(-1);
  });

  it('reselects on a non-adjacent tile', () => {
    const { game, tap } = setup();
    tap(0, 0);
    tap(3, 3);
    expect(game.selected).toBe(game.board.idx(3, 3));
  });

  it('swaps with an orthogonal neighbour and clears the selection', async () => {
    const { game, tap } = setup();
    tap(1, 0);
    tap(1, 1);
    expect(game.selected).toBe(-1);
    expect(game.board.at(1, 0).state).toBe(CellState.Swapping);
    await settle(game);
    expect(game.stats.validSwaps).toBe(1);
  });
});

describe('drag', () => {
  it('does nothing below the threshold', () => {
    const { game, input } = setup();
    input.down(0.5, 0.5);
    input.move(0.6, 0.5);
    expect(game.swapsInFlight).toBe(0);
  });

  it('swaps toward the dominant axis once past the threshold', () => {
    const { game, input } = setup();
    input.down(1.5, 0.5);
    input.move(1.55, 0.95); // mostly up
    expect(game.board.at(1, 1).state).toBe(CellState.Swapping);
    input.up();
    expect(game.selected).toBe(-1); // a consumed drag is not a tap
  });

  it('ignores a drag off the edge of the board', () => {
    const { game, input } = setup();
    input.down(0.5, 0.5);
    input.move(-0.2, 0.5);
    expect(game.swapsInFlight).toBe(0);
  });

  it('ignores presses on non-Idle tiles', () => {
    const { game, input } = setup();
    game.board.at(0, 0).state = CellState.Falling;
    input.down(0.5, 0.5);
    input.move(1.2, 0.5);
    expect(game.swapsInFlight).toBe(0);
  });
});
