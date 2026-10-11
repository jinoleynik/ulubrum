import { Bonus, CellState, type Game } from '../core';
import type { CombatModel, Enemy } from '../session';
import { DARK_GLYPH, STATE_COLORS, TILE_COLORS } from './palette';
import { enemyIcons, heroIcons } from './statusIcons';

const STATE_MARK: Partial<Record<CellState, { label: string; color: string }>> = {
  [CellState.Swapping]: { label: 'S', color: STATE_COLORS.swapping },
  [CellState.Destroying]: { label: 'D', color: STATE_COLORS.destroying },
  [CellState.Falling]: { label: 'F', color: STATE_COLORS.falling },
};

interface Particle { x: number; y: number; vx: number; vy: number; age: number; ttl: number; color: string; size: number }
interface Ring { x: number; y: number; age: number; ttl: number; color: string; reach: number }

/** Tile rows above the board for the hero (2×2) and the enemy queue (1 wide × 2 tall each). */
export const ARENA_ROWS = 2;
const HERO_COLUMNS = 2;
const MAX_PARTICLES = 300;
const easeOutBack = (t: number): number => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const TILE_FILL = 0.86;
const BONUS_LETTER: Record<number, string> = { [Bonus.Bomb]: 'B', [Bonus.Line]: 'L', [Bonus.Coin]: '$', [Bonus.Heal]: 'H', [Bonus.Time]: 'T', [Bonus.MaxHp]: 'M', [Bonus.Damage]: 'D', [Bonus.Bucket]: 'U' };
const FONT = '"IBM Plex Sans", system-ui, sans-serif';

/** Draws the board to a square canvas. y=0 is the bottom row. */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  /** Center of the hero and each enemy in canvas pixels, from the last draw; used to place floating numbers. */
  private readonly centers = new Map<object, { x: number; y: number }>();
  private readonly flashes = new Map<object, number>();
  private shots: { from: { x: number; y: number }; to: { x: number; y: number }; age: number }[] = [];
  private cols = 8;
  private rows = 10;

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
    // Same width:height as the grid, so one tile is exactly as wide as it is tall.
    const py = Math.max(1, Math.round((px * this.rows) / this.cols));
    if (this.canvas.width !== px || this.canvas.height !== py) {
      this.canvas.width = px;
      this.canvas.height = py;
    }
  }

  /** Converts a pointer event to cell-space floats (x right, y up). */
  toCellSpace(ev: { clientX: number; clientY: number }, game: Game): { fx: number; fy: number } {
    const r = this.canvas.getBoundingClientRect();
    const cs = r.width / game.board.width;
    return {
      fx: (ev.clientX - r.left) / cs,
      fy: game.board.height - (ev.clientY - r.top) / cs + ARENA_ROWS,
    };
  }

  /** Center of a unit (the hero or an enemy) in CSS pixels over the canvas. */
  unitCenter(key: object): { x: number; y: number } | undefined {
    const c = this.centers.get(key);
    if (!c) return undefined;
    const k = this.canvas.clientWidth / this.canvas.width;
    return { x: c.x * k, y: c.y * k };
  }

  /** Brief red flash on a unit that was just hit. */
  flash(key: object): void {
    this.flashes.set(key, 0.3);
  }

  /** A ranged enemy fires at the hero. */
  shoot(enemy: Enemy, hero: object): void {
    const from = this.centers.get(enemy);
    const to = this.centers.get(hero);
    if (from && to && !reducedMotion()) this.shots.push({ from: { ...from }, to: { ...to }, age: 0 });
  }

  /**
   * Burst of colored bits where tiles were destroyed; tiles with a bonus (and `big`) also send a shockwave.
   * Positions are kept in cell units so they survive a resize. Skipped for reduced motion.
   */
  burst(game: Game, tiles: { index: number; type: number; bonus: number }[], big = false): void {
    if (reducedMotion()) return;
    const { board } = game;
    for (const t of tiles) {
      const x = board.xOf(t.index) + 0.5, y = board.yOf(t.index) + 0.5;
      const color = TILE_COLORS[t.type % TILE_COLORS.length];
      const n = t.bonus || big ? 12 : 7;
      for (let k = 0; k < n && this.particles.length < MAX_PARTICLES; k++) {
        const a = Math.random() * Math.PI * 2;
        const v = 1.5 + Math.random() * 3;
        this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1, age: 0, ttl: 0.35 + Math.random() * 0.3, color, size: 0.07 + Math.random() * 0.07 });
      }
      if (t.bonus || big) this.rings.push({ x, y, age: 0, ttl: 0.45, color: '#ffffff', reach: t.bonus ? 2.2 : 1.4 });
    }
  }

  private stepEffects(dt: number): void {
    for (const [k, left] of this.flashes) {
      if (left - dt <= 0) this.flashes.delete(k);
      else this.flashes.set(k, left - dt);
    }
    for (const sh of this.shots) sh.age += dt;
    this.shots = this.shots.filter((sh) => sh.age < 0.25);
    for (const p of this.particles) {
      p.age += dt;
      p.vy -= 12 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.ttl);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.ttl);
  }

  private drawEffects(cs: number, H: number): void {
    const { ctx } = this;
    for (const p of this.particles) {
      const k = 1 - p.age / p.ttl;
      ctx.globalAlpha = Math.max(0, k);
      ctx.fillStyle = p.color;
      const s = p.size * cs * (0.5 + k);
      ctx.fillRect(p.x * cs - s / 2, (H - p.y) * cs - s / 2, s, s);
    }
    for (const r of this.rings) {
      const k = r.age / r.ttl;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(2, cs * 0.06 * (1 - k));
      ctx.beginPath();
      ctx.arc(r.x * cs, (H - r.y) * cs, cs * r.reach * Math.sqrt(k), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** The hero (2×2 tiles) and the enemy queue (1×2 tiles each) in the rows above the board. */
  private drawArena(combat: CombatModel, cs: number, cols: number): void {
    const { ctx } = this;
    const m = cs * 0.05;
    const font = (px: number, weight = 600) => `${weight} ${Math.round(px)}px ${FONT}`;
    const plate = (x: number, w: number, h: number, key: object, fill: string, edge?: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x + m, m, w - 2 * m, h - 2 * m, cs * 0.14);
      ctx.fill();
      if (edge) {
        ctx.strokeStyle = edge;
        ctx.lineWidth = Math.max(2, cs * 0.05);
        ctx.stroke();
      }
      const f = this.flashes.get(key);
      if (f) {
        ctx.fillStyle = `rgba(255,70,70,${(f / 0.3) * 0.5})`;
        ctx.fill();
      }
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Hero: 2×2
    const { hero } = combat;
    this.centers.set(hero, { x: cs * HERO_COLUMNS * 0.5, y: cs });
    plate(0, cs * HERO_COLUMNS, cs * 2, hero, 'rgba(91,155,255,0.16)');
    ctx.font = `${Math.round(cs * 1.15)}px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.fillText('🛡️', cs, cs * 0.82);
    ctx.font = font(cs * 0.2);
    ctx.fillStyle = '#e6eaf1';
    ctx.fillText(heroIcons(hero), cs, cs * 0.2);
    const bw = cs * 1.6;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(cs - bw / 2, cs * 1.58, bw, cs * 0.12);
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(cs - bw / 2, cs * 1.58, (bw * hero.hp) / hero.maxHp, cs * 0.12);
    ctx.font = font(cs * 0.24, 700);
    ctx.fillStyle = '#e6eaf1';
    ctx.fillText(`❤ ${Math.round(hero.hp)}/${hero.maxHp}`, cs, cs * 1.84);

    // Enemies: the front of the queue stands next to the hero
    const shown = combat.visibleEnemies;
    const front = combat.currentEnemy;
    const slots = cols - HERO_COLUMNS;
    for (let i = 0; i < slots; i++) {
      const x = (HERO_COLUMNS + i) * cs;
      const e = shown[i];
      if (!e) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.beginPath();
        ctx.roundRect(x + m, m, cs - 2 * m, cs * 2 - 2 * m, cs * 0.14);
        ctx.fill();
        continue;
      }
      const cx = x + cs / 2;
      this.centers.set(e, { x: cx, y: cs });
      plate(x, cs, cs * 2, e, e.bonuses.length ? 'rgba(247,183,51,0.16)' : 'rgba(251,146,60,0.1)', e === front ? '#fb923c' : undefined);
      ctx.font = `${Math.round(cs * 0.62)}px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(e.template.face, cx, cs * 0.78);
      ctx.font = font(cs * 0.2);
      ctx.fillStyle = '#e6eaf1';
      ctx.fillText(enemyIcons(e), cx, cs * 0.2);
      if (e.bonuses.length) {
        ctx.fillStyle = '#ffd34d';
        ctx.font = font(cs * 0.24, 700);
        ctx.textAlign = 'right';
        ctx.fillText('★'.repeat(e.bonuses.length), x + cs - m * 2, cs * 0.2);
        ctx.textAlign = 'center';
      }
      if (e.range > 1) {
        ctx.fillStyle = '#9ec5ff';
        ctx.font = font(cs * 0.2, 700);
        ctx.textAlign = 'left';
        ctx.fillText(`◎${e.range}`, x + m * 2, cs * 0.2);
        ctx.textAlign = 'center';
      }
      ctx.font = font(cs * 0.23, 700);
      ctx.fillStyle = '#ff8a8a';
      ctx.fillText(`❤ ${e.hp}`, cx, cs * 1.4);
      ctx.fillStyle = '#ffd34d';
      ctx.fillText(`⚔ ${e.attack}`, cx, cs * 1.72);
    }
    for (const k of [...this.centers.keys()]) {
      if (k !== hero && !shown.includes(k as Enemy)) this.centers.delete(k);
    }
    // Arrows in flight
    for (const sh of this.shots) {
      const k = sh.age / 0.25;
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(sh.from.x + (sh.to.x - sh.from.x) * k, sh.from.y + (sh.to.y - sh.from.y) * k, cs * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  draw(game: Game, showStates: boolean, dt = 0, combat?: CombatModel): void {
    const { ctx } = this;
    const { board } = game;
    if (this.cols !== board.width || this.rows !== board.height + ARENA_ROWS) {
      this.cols = board.width;
      this.rows = board.height + ARENA_ROWS;
      this.canvas.style.aspectRatio = `${this.cols} / ${this.rows}`;
      this.resize();
    }
    const S = this.canvas.width; // width in pixels; the canvas is taller than wide
    const full = this.canvas.height;
    const cs = S / board.width;
    const H = board.height;
    const css = getComputedStyle(document.documentElement);

    ctx.clearRect(0, 0, S, full);
    this.stepEffects(dt);
    if (combat) this.drawArena(combat, cs, board.width);
    ctx.save();
    ctx.translate(0, ARENA_ROWS * cs);

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
    ctx.rect(0, 0, S, H * cs);
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
        const dying = c.state === CellState.Destroying;
        ctx.save();
        if (dying) ctx.globalAlpha = Math.min(1, Math.max(0, v.scale / 0.6));
        if (v.rot) {
          ctx.translate(cx, cy);
          ctx.rotate(v.rot);
          ctx.translate(-cx, -cy);
        }
        ctx.fillStyle = TILE_COLORS[v.type % TILE_COLORS.length];
        ctx.beginPath();
        ctx.roundRect(cx - size / 2, cy - size / 2, size, size, size * 0.22);
        ctx.fill();
        if (selected) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(2, cs * 0.05);
          ctx.stroke();
        }
        ctx.fillStyle = DARK_GLYPH.has(v.type) ? 'rgba(20,28,40,0.5)' : 'rgba(255,255,255,0.55)';
        this.glyph(v.type, cx, cy, size * 0.22);
        if (v.universal) this.universalRing(cx, cy, size, v.markAnim);
        if (v.bonus !== Bonus.None) this.marker(v.bonus, v.bonusLevel, cx, cy, size, v.markAnim);
        if (v.markAnim < 1) this.popFlash(cx, cy, size, v.markAnim);
        ctx.restore();
      }
    }
    ctx.restore();
    this.drawEffects(cs, H);

    if (showStates) this.drawStates(game, cs);
    ctx.restore();

    if (game.locked && !game.halted) {
      ctx.fillStyle = 'rgba(245,197,24,0.18)';
      ctx.fillRect(0, 0, S, full);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(S * 0.06)}px ${FONT}`;
      ctx.fillText('⚡ Stunned', S / 2, full / 2);
    }

    if (game.halted) {
      ctx.fillStyle = 'rgba(10,14,20,0.55)';
      ctx.fillRect(0, 0, S, full);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(S * 0.05)}px ${FONT}`;
      ctx.fillText('Halted, input locked', S / 2, full / 2);
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

  /** Rainbow ring: this tile can be matched as any color on the player's swaps. */
  private universalRing(cx: number, cy: number, size: number, pop: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, pop * 2);
    const g = ctx.createConicGradient(0, cx, cy);
    ['#E5484D', '#F5C518', '#30A46C', '#22D3EE', '#3E8EF7', '#8E4EC6', '#E5484D'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(3, size * 0.1);
    ctx.beginPath();
    ctx.roundRect(cx - size / 2 + size * 0.05, cy - size / 2 + size * 0.05, size * 0.9, size * 0.9, size * 0.2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(size * 0.28)}px ${FONT}`;
    ctx.fillText('★', cx - size * 0.28, cy - size * 0.28);
    ctx.restore();
  }

  /** Expanding glow ring while a fresh bonus pops in. */
  private popFlash(cx: number, cy: number, size: number, t: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha *= (1 - t) * 0.9;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, size * 0.08 * (1 - t));
    ctx.beginPath();
    ctx.arc(cx, cy, size * (0.45 + 0.6 * t), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Bonus badge: white disc with the bonus letter and its tile level (1..4) beside it. */
  private marker(bonus: Bonus, level: number, cx: number, cy: number, size: number, pop: number): void {
    const { ctx } = this;
    const r = size * 0.27 * Math.max(0, easeOutBack(pop));
    if (r <= 0.5) return;
    const bx = cx + size * 0.25, by = cy - size * 0.25;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c2433';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(r * 1.25)}px ${FONT}`;
    ctx.fillText(BONUS_LETTER[bonus] ?? '?', bx - r * 0.12, by + r * 0.05);
    ctx.font = `700 ${Math.round(r * 0.8)}px ${FONT}`;
    ctx.fillText(String(level), bx + r * 0.62, by + r * 0.5);
  }

  private glyph(type: number, cx: number, cy: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    switch (type % 8) {
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
      case 5:
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        break;
      case 6: {
        const w = r * 0.38;
        ctx.moveTo(cx - w, cy - r); ctx.lineTo(cx + w, cy - r); ctx.lineTo(cx + w, cy - w); ctx.lineTo(cx + r, cy - w);
        ctx.lineTo(cx + r, cy + w); ctx.lineTo(cx + w, cy + w); ctx.lineTo(cx + w, cy + r); ctx.lineTo(cx - w, cy + r);
        ctx.lineTo(cx - w, cy + w); ctx.lineTo(cx - r, cy + w); ctx.lineTo(cx - r, cy - w); ctx.lineTo(cx - w, cy - w);
        break;
      }
      default:
        ctx.moveTo(cx - r, cy - r * 0.75); ctx.lineTo(cx + r, cy - r * 0.75); ctx.lineTo(cx, cy + r * 0.85);
    }
    ctx.closePath();
    ctx.fill();
  }
}
