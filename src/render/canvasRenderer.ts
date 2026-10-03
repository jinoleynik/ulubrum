import { CellState, type Game } from '../core';
import { STATE_COLORS, TILE_COLORS } from './palette';

const STATE_MARK: Partial<Record<CellState, { label: string; color: string }>> = {
  [CellState.Swapping]: { label: 'S', color: STATE_COLORS.swapping },
  [CellState.Destroying]: { label: 'D', color: STATE_COLORS.destroying },
  [CellState.Falling]: { label: 'F', color: STATE_COLORS.falling },
};

const TILE_FILL = 0.86;
const FONT = '"IBM Plex Sans", system-ui, sans-serif';

/** Draws the board to a square canvas. y=0 is the bottom row. */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.getBoundingClientRect().width;
    const px = Math.max(1, Math.round(w * dpr));
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
  }

  /** Converts a pointer event to cell-space floats (x right, y up). */
  toCellSpace(ev: { clientX: number; clientY: number }, game: Game): { fx: number; fy: number } {
    const r = this.canvas.getBoundingClientRect();
    const cs = r.width / game.board.width;
    return {
      fx: (ev.clientX - r.left) / cs,
      fy: game.board.height - (ev.clientY - r.top) / cs,
    };
  }

  draw(game: Game, showStates: boolean): void {
    const { ctx } = this;
    const { board } = game;
    const S = this.canvas.width;
    const cs = S / board.width;
    const H = board.height;
    const css = getComputedStyle(document.documentElement);

    ctx.clearRect(0, 0, S, S);

    // Cell backgrounds
    ctx.fillStyle = css.getPropertyValue('--cell').trim() || '#2A3447';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < board.width; x++) {
        const m = cs * 0.04;
        ctx.beginPath();
        ctx.roundRect(x * cs + m, (H - 1 - y) * cs + m, cs - 2 * m, cs - 2 * m, cs * 0.12);
        ctx.fill();
      }
    }

    // Tiles (swapping ones on top), clipped so spawns slide in from above
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.clip();
    for (const pass of [false, true]) {
      for (const c of board.cells) {
        if ((c.state === CellState.Swapping) !== pass) continue;
        const v = c.view;
        if (!v || v.scale <= 0.001) continue;
        const selected = v === game.selectedView;
        const size = cs * TILE_FILL * v.scale * (selected ? game.config.selectScale : 1);
        const cx = (v.x + 0.5) * cs;
        const cy = (H - 1 - v.y + 0.5) * cs;
        ctx.fillStyle = TILE_COLORS[v.type % TILE_COLORS.length];
        ctx.beginPath();
        ctx.roundRect(cx - size / 2, cy - size / 2, size, size, size * 0.22);
        ctx.fill();
        if (selected) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(2, cs * 0.05);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        this.glyph(v.type, cx, cy, size * 0.22);
      }
    }
    ctx.restore();

    if (showStates) this.drawStates(game, cs);

    if (game.halted) {
      ctx.fillStyle = 'rgba(10,14,20,0.55)';
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(S * 0.05)}px ${FONT}`;
      ctx.fillText('Halted, input locked', S / 2, S / 2);
    }
  }

  private drawStates(game: Game, cs: number): void {
    const { ctx } = this;
    const { board } = game;
    ctx.font = `600 ${Math.round(cs * 0.2)}px ${FONT}`;
    ctx.textBaseline = 'top';
    board.cells.forEach((c, i) => {
      const px = board.xOf(i) * cs;
      const py = (board.height - 1 - board.yOf(i)) * cs;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.textAlign = 'left';
      ctx.fillText(`${board.xOf(i)},${board.yOf(i)}`, px + cs * 0.08, py + cs * 0.06);
      const mark = STATE_MARK[c.state];
      if (!mark) return;
      ctx.strokeStyle = mark.color;
      ctx.lineWidth = Math.max(2, cs * 0.05);
      ctx.strokeRect(px + cs * 0.06, py + cs * 0.06, cs * 0.88, cs * 0.88);
      ctx.fillStyle = mark.color;
      ctx.textAlign = 'right';
      ctx.fillText(mark.label, px + cs * 0.9, py + cs * 0.06);
    });
  }

  private glyph(type: number, cx: number, cy: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    switch (type % 6) {
      case 0:
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        break;
      case 1:
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
        break;
      case 2:
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.95, cy + r * 0.75); ctx.lineTo(cx - r * 0.95, cy + r * 0.75);
        break;
      case 3:
        ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
        break;
      case 4:
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          const rr = k % 2 ? r * 0.45 : r;
          ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        break;
      default:
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
    }
    ctx.closePath();
    ctx.fill();
  }
}
