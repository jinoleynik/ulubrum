/**
 * Frame-driven coroutines. Async functions await `nextFrame()`; the host calls
 * `tick(dt)` once per frame. `clear()` drops every pending resolver, which stops
 * all coroutines dead — that is how Halt() works.
 */
export class FrameScheduler {
  private waiters: Array<(dt: number) => void> = [];

  nextFrame(): Promise<number> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  tick(dt: number): void {
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve(dt);
  }

  clear(): void {
    this.waiters = [];
  }

  get pending(): number {
    return this.waiters.length;
  }

  /** Calls fn with an eased 0→1 progress every frame; ends with fn(1). */
  async tween(duration: number, fn: (k: number) => void): Promise<void> {
    let t = 0;
    while (t < duration) {
      fn(smoothstep(t / duration));
      t += await this.nextFrame();
    }
    fn(1);
  }

  async waitUntil(pred: () => boolean): Promise<void> {
    while (!pred()) await this.nextFrame();
  }
}

export const smoothstep = (t: number): number => t * t * (3 - 2 * t);
