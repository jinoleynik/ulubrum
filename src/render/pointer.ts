import type { Game, InputController } from '../core';
import type { CanvasRenderer } from './canvasRenderer';

/** Feeds DOM pointer events into the platform-agnostic InputController. */
export function bindPointer(
  canvas: HTMLCanvasElement,
  renderer: CanvasRenderer,
  current: () => { game: Game; input: InputController },
): void {
  canvas.addEventListener('pointerdown', (ev) => {
    const { game, input } = current();
    canvas.setPointerCapture(ev.pointerId);
    const p = renderer.toCellSpace(ev, game);
    input.down(p.fx, p.fy);
  });
  canvas.addEventListener('pointermove', (ev) => {
    const { game, input } = current();
    const p = renderer.toCellSpace(ev, game);
    input.move(p.fx, p.fy);
  });
  canvas.addEventListener('pointerup', () => current().input.up());
  canvas.addEventListener('pointercancel', () => current().input.cancel());
}
