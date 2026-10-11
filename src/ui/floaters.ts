export type FloatKind = 'dmg' | 'heal' | 'crit' | 'coin';

/** Rising damage / heal numbers drawn over the board. The layer is a static overlay, never rebuilt. */
export class Floaters {
  constructor(private readonly layer: HTMLElement) {}

  /** `at` is in CSS pixels from the layer's top-left corner. */
  spawn(at: { x: number; y: number } | undefined, text: string, kind: FloatKind): void {
    if (!at) return;
    const span = document.createElement('span');
    span.className = `floater ${kind}`;
    span.textContent = text;
    span.style.left = `${at.x + (Math.random() - 0.5) * 26}px`;
    span.style.top = `${at.y}px`;
    this.layer.append(span);
    const remove = () => span.remove();
    span.addEventListener('animationend', remove);
    setTimeout(remove, 1400); // reduced motion disables the animation, so animationend never fires
    while (this.layer.children.length > 30) this.layer.firstElementChild?.remove();
  }
}
