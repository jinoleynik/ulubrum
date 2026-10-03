/** Score and cascade combo. `combo` is the current cascade stack; 0 means idle. */
export class ScoreService {
  score = 0;
  combo = 0;

  constructor(
    private readonly pointsPerTile: number,
    private readonly onScore: (score: number) => void = () => {},
  ) {}

  /** One destroy wave: tiles × points × cascade stack (minimum 1). */
  add(tileCount: number, cascadeStack: number): number {
    const stack = Math.max(1, cascadeStack);
    const gained = tileCount * this.pointsPerTile * stack;
    this.score += gained;
    this.combo = stack;
    this.onScore(this.score);
    return gained;
  }

  clearCombo(): void {
    this.combo = 0;
  }

  /** HUD text: `xN` only when N > 1. */
  get comboLabel(): string {
    return this.combo > 1 ? `x${this.combo}` : '';
  }
}
