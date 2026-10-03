import type { Game } from './game';
import { isActive } from './types';

interface Press {
  cell: number;
  fx: number;
  fy: number;
  consumed: boolean;
}

/**
 * Drag + click-select input, expressed in cell-space coordinates
 * (fx, fy are floats in cells, y up). Platform-agnostic: the DOM layer only
 * converts pointer events into these calls.
 */
export class InputController {
  private press: Press | null = null;

  constructor(private readonly game: Game) {}

  down(fx: number, fy: number): void {
    const { game } = this;
    this.press = null;
    if (game.halted) return;
    const x = Math.floor(fx), y = Math.floor(fy);
    if (!game.board.inBounds(x, y)) return;
    const cell = game.board.idx(x, y);
    if (!isActive(game.board.cells[cell])) return;
    this.press = { cell, fx, fy, consumed: false };
  }

  move(fx: number, fy: number): void {
    const { game } = this;
    const p = this.press;
    if (game.halted || !p || p.consumed) return;
    if (!isActive(game.board.cells[p.cell])) {
      this.press = null; // tile got claimed or started falling under the finger
      return;
    }
    const dx = fx - p.fx, dy = fy - p.fy;
    if (Math.hypot(dx, dy) < game.config.dragThreshold) return;

    p.consumed = true;
    const x = game.board.xOf(p.cell), y = game.board.yOf(p.cell);
    const [nx, ny] = Math.abs(dx) >= Math.abs(dy) ? [x + Math.sign(dx), y] : [x, y + Math.sign(dy)];
    game.deselect();
    if (game.board.inBounds(nx, ny)) game.trySwap(p.cell, game.board.idx(nx, ny));
  }

  up(): void {
    const p = this.press;
    this.press = null;
    if (!this.game.halted && p && !p.consumed) this.game.tap(p.cell);
  }

  cancel(): void {
    this.press = null;
  }
}
