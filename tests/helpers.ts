import { CellState, defaultConfig, Game, type GameEvent, type Match3Config } from '../src/core';

export const DT = 1 / 60;

/** Lets every pending promise continuation run. */
export const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

export async function frames(game: Game, n: number, dt = DT): Promise<void> {
  for (let i = 0; i < n; i++) {
    game.tick(dt);
    await flush();
  }
}

/** Ticks until nothing is animating or resolving. */
export async function settle(game: Game, maxFrames = 5000): Promise<number> {
  await flush();
  for (let i = 0; i < maxFrames; i++) {
    if (!game.isBusy) return i;
    game.tick(DT);
    await flush();
  }
  throw new Error(`Game did not settle within ${maxFrames} frames`);
}

export function makeGame(layout: string[] | undefined, overrides: Partial<Match3Config> = {}, seed = 1) {
  const events: GameEvent[] = [];
  const config = {
    ...defaultConfig,
    reshuffleOnNoMoves: false,
    ...(layout ? { width: layout[0].length, height: layout.length } : {}),
    ...overrides,
  };
  const game = new Game(config, { seed, layout });
  game.on((e) => events.push(e));
  return { game, events };
}

/** Invariants that must hold whenever the game is settled. */
export function assertSettled(game: Game): void {
  const { board } = game;
  board.cells.forEach((c, i) => {
    const where = `(${board.xOf(i)},${board.yOf(i)})`;
    if (c.state !== CellState.Idle) throw new Error(`${where} is not Idle`);
    if (c.type < 0) throw new Error(`${where} is empty`);
    if (!c.view) throw new Error(`${where} has no view`);
    if (c.view.type !== c.type) throw new Error(`${where} view type ${c.view.type} ≠ cell type ${c.type}`);
    if (c.view.x !== board.xOf(i) || c.view.y !== board.yOf(i)) throw new Error(`${where} view is not in place`);
  });
  const m = board.findMatches();
  if (m.size) throw new Error(`Settled board still has matches:\n${board.toRows().join('\n')}`);
}
