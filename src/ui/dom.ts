/** Element by id; throws when the page is missing it. */
export const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

/** Tiny element factory: tag, text and a few properties. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  attrs: Partial<{ className: string; disabled: boolean; onclick: () => void }> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  Object.assign(e, attrs);
  return e;
}
