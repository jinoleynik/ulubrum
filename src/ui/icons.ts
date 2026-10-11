import { el } from './dom';

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Static, trusted inline icons (no user input ever reaches innerHTML). */
export const ICONS = {
  home: svg('<path d="M3 11 12 3l9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
  skills: svg('<path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  soundOn: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  soundOff: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>'),
  prev: svg('<path d="m15 5-7 7 7 7"/>'),
  next: svg('<path d="m9 5 7 7-7 7"/>'),
  play: svg('<path d="M7 4v16l13-8z" fill="currentColor"/>'),
} as const;

export type IconName = keyof typeof ICONS;

/** A round icon button with an accessible name. */
export function iconButton(name: IconName, label: string, onclick: () => void): HTMLButtonElement {
  const b = el('button', '', { className: 'icon', onclick });
  b.innerHTML = ICONS[name];
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}
