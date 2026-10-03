import type { Session } from '../session';
import { describeSkill, SKILL_IDS, SkillId, type GameplayConfig, type Progress, type Reward } from '../session';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  attrs: Partial<{ className: string; disabled: boolean; onclick: () => void }> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  Object.assign(e, attrs);
  return e;
}

const ENEMY_FACE: Record<string, string> = { Zombie: '🧟', Orc: '👹', Skeleton: '💀' };
const SKILL_NAME: Record<SkillId, string> = { heal: 'Heal', explosion: 'Explosion' };

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Round readout in the sidebar plus the menu, skills and result overlays on the board. */
export class Hud {
  private readonly overlay = $<HTMLDivElement>('overlay');
  private readonly arena = $<HTMLDivElement>('arena');
  private arenaStamp = '';

  constructor(
    private readonly progress: Progress,
    private readonly gameplay: GameplayConfig,
    private readonly handlers: { onPlay: () => void; onMenu: () => void },
  ) {
    $('btnMenu').addEventListener('click', handlers.onMenu);
  }

  update(s: Session): void {
    this.set('hScore', s.score.score);
    this.set('hCombo', s.score.comboLabel || '-');
    this.set('hTime', formatTime(s.timeRemaining));
    $('hTime').classList.toggle('warn', s.timeRemaining <= 10);
    this.set('hEnemies', s.combat.enemiesLeft);

    this.renderArena(s);
  }

  /** Hero on the left, up to three live enemies on the right; the one being hit is outlined. */
  private renderArena(s: Session): void {
    const { hero } = s.combat;
    const current = s.combat.currentEnemy;
    const visible = s.combat.visibleEnemies;
    const stamp = `${hero.hp}|${visible.map((e) => `${e.name}${e.hp}`).join('|')}`;
    if (stamp === this.arenaStamp) return;
    this.arenaStamp = stamp;

    const unit = (face: string, name: string, hp: number, max: number, cls: string): HTMLElement => {
      const u = el('div', '', { className: `unit ${cls}` });
      const bar = el('div', '', { className: 'bar' });
      const fill = el('i');
      fill.style.width = `${(100 * hp) / max}%`;
      bar.append(fill);
      u.append(el('span', face, { className: 'face' }), el('span', name, { className: 'name' }), bar, el('span', `${hp}/${max}`, { className: 'hp' }));
      return u;
    };
    const parts: HTMLElement[] = [unit('🛡️', hero.name, hero.hp, hero.maxHp, 'hero'), el('span', 'vs', { className: 'vs' })];
    for (const e of visible) {
      parts.push(unit(ENEMY_FACE[e.kind], e.name, e.hp, e.maxHp, `enemy${e === current ? ' current' : ''}`));
    }
    this.arena.replaceChildren(...parts);
  }

  private set(id: string, v: string | number): void {
    const e = $(id);
    const t = String(v);
    if (e.textContent !== t) e.textContent = t;
  }

  hide(): void {
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }

  private show(...children: HTMLElement[]): void {
    this.overlay.replaceChildren(...children);
    this.overlay.hidden = false;
  }

  showMenu(): void {
    this.show(
      el('h2', 'Match-3 MVP'),
      el('p', `High score ${this.progress.highScore}  ·  Coins ${this.progress.coins}`),
      this.buttons(
        el('button', 'Play', { className: 'primary', onclick: this.handlers.onPlay }),
        el('button', 'Skills', { onclick: () => this.showSkills() }),
      ),
    );
  }

  showSkills(): void {
    const rows = SKILL_IDS.map((id) => {
      const level = this.progress.skillLevel(id);
      const maxed = level >= this.gameplay.maxSkillLevel;
      const row = el('div', '', { className: 'skill' });
      const title = el('strong', `${SKILL_NAME[id]}  Lv ${level}`);
      const cost = this.progress.upgradeCost(id);
      const btn = el('button', maxed ? 'Max' : `Upgrade ${cost}`, {
        disabled: !this.progress.canUpgrade(id),
        onclick: () => {
          this.progress.upgrade(id);
          this.showSkills();
        },
      });
      row.append(title, btn, el('small', describeSkill(this.gameplay, id, level)));
      return row;
    });
    this.show(
      el('h2', 'Skills'),
      el('p', `Coins ${this.progress.coins}`),
      ...rows,
      this.buttons(el('button', 'Back', { onclick: () => this.showMenu() })),
    );
  }

  showResult(outcome: 'won' | 'lost', score: number, reward: Reward | null): void {
    const lines: HTMLElement[] = [el('p', `Score ${score}  ·  High score ${this.progress.highScore}`)];
    if (reward) {
      lines.push(el('p', `+${reward.baseCoins} coins, +${reward.timeBonus} time bonus = ${reward.total}`));
    }
    this.show(
      el('h2', outcome === 'won' ? 'Victory' : 'Defeat'),
      ...lines,
      this.buttons(
        el('button', 'Play again', { className: 'primary', onclick: this.handlers.onPlay }),
        el('button', 'Menu', { onclick: this.handlers.onMenu }),
      ),
    );
  }

  private buttons(...b: HTMLElement[]): HTMLElement {
    const row = el('div', '', { className: 'buttons' });
    row.append(...b);
    return row;
  }
}
