import type { Sfx } from '../audio/sfx';
import { TILE_COLORS } from '../render/palette';
import type { Session } from '../session';
import { $, el } from './dom';
import { ICONS, iconButton } from './icons';
import {
  BONUS_IDS,
  BONUS_NAME,
  BRANCH_NAME,
  BRANCHES,
  COLOR_IDS,
  COLOR_NAME,
  describeBonus,
  describePassive,
  ENEMY_BONUSES,
  describeTraits,
  PASSIVE_IDS,
  PASSIVE_NAME,
  ULTIMATES,
  ultimateText,
  describeSkill,
  enemiesForLevel,
  LEVEL_COUNT,
  levelsOnPage,
  levelState,
  PAGE_COUNT,
  pageOfLevel,
  type GameplayConfig,
  type Progress,
  type Reward,
} from '../session';

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Round readout in the sidebar plus the menu, skills and result overlays on the board. */
export class Hud {
  private readonly overlay = $<HTMLDivElement>('overlay');
  private readonly enemyCount = $<HTMLButtonElement>('enemyCount');
  private readonly buckets = $<HTMLDivElement>('buckets');
  private readonly actions = $<HTMLDivElement>('boardActions');
  private bucketRefs: { btn: HTMLButtonElement; fill: HTMLElement; label: HTMLElement; streak: HTMLElement }[] = [];
  private bucketOwner: Session | null = null;

  constructor(
    private readonly progress: Progress,
    private readonly gameplay: GameplayConfig,
    private readonly sfx: Sfx,
    private readonly handlers: {
      onPlay: (level: number) => void;
      onMenu: () => void;
      onBucket: (type: number) => void;
      onShuffle: () => void;
      onPause: () => void;
      onEnemies: () => void;
    },
  ) {
    $('btnMenu').addEventListener('click', handlers.onMenu);
    $('btnPause').innerHTML = ICONS.menu;
    this.enemyCount.addEventListener('click', handlers.onEnemies);
    $('btnPause').addEventListener('click', handlers.onPause);
    $('btnShuffle').addEventListener('click', handlers.onShuffle);
  }

  update(s: Session): void {
    this.set('tLevel', s.level);
    this.set('tScore', s.score.score);
    this.set('tCombo', s.score.comboLabel);
    this.set('tTime', formatTime(s.timeRemaining));
    $('tTimeWrap').classList.toggle('warn', s.timeRemaining <= 10);
    this.set('hLevel', s.level);
    this.set('hScore', s.score.score);
    this.set('hCombo', s.score.comboLabel || '-');
    this.set('hTime', formatTime(s.timeRemaining));
    $('hTime').classList.toggle('warn', s.timeRemaining <= 10);
    this.set('hEnemies', s.combat.enemiesLeft);

    $<HTMLButtonElement>('btnShuffle').disabled = !s.combat.playing || s.game.isBusy;
    this.renderEnemyCount(s);
    this.renderBuckets(s);
  }

  /** Corner badge on the board: enemies defeated out of all enemies this round. Opens the list. */
  private renderEnemyCount(s: Session): void {
    const total = s.combat.enemies.length;
    const defeated = total - s.combat.enemiesLeft;
    const text = `☠ ${defeated}/${total}`;
    if (this.enemyCount.textContent !== text) {
      this.enemyCount.textContent = text;
      this.enemyCount.setAttribute('aria-label', `${defeated} of ${total} enemies defeated. Open the enemy list`);
    }
  }

  /** One bucket per color. Full: pulses (empowered passive on) and can be spent; active: counts down. */
  private renderBuckets(s: Session): void {
    const { colors } = s;
    if (this.bucketOwner !== s) {
      this.bucketOwner = s;
      this.bucketRefs = colors.gauges.map((_, type) => {
        const id = COLOR_IDS[type];
        const btn = el('button', '', { className: 'bucket', onclick: () => this.handlers.onBucket(type) });
        btn.style.setProperty('--c', TILE_COLORS[type]);
        btn.title = `${COLOR_NAME[id]}: ${describeSkill(this.gameplay, id, 'activation', s.skills[id].activation)}`;
        const bar = el('div', '', { className: 'bar' });
        const fill = el('i');
        bar.append(fill);
        const label = el('span');
        const streak = el('i', '', { className: 'streak' });
        btn.append(el('b', COLOR_NAME[id].slice(0, 3).toUpperCase()), bar, label, streak);
        return { btn, fill, label, streak };
      });
      this.buckets.replaceChildren(...this.bucketRefs.map((r) => r.btn));
    }
    colors.gauges.forEach((g, type) => {
      const { btn, fill, label, streak } = this.bucketRefs[type];
      const run = colors.streaks[type];
      const streakText = run > 0 ? `🔥${run}` : '';
      if (streak.textContent !== streakText) streak.textContent = streakText;
      const cap = colors.capacity(type);
      const ready = colors.ready(type);
      const active = colors.active(type);
      const silenced = s.combat.hero.silenceLeft > 0;
      fill.style.width = `${Math.min(100, (100 * g) / cap)}%`;
      const text = active ? `${Math.ceil(colors.buffs[type])}s` : ready ? (silenced ? '🔇' : 'USE') : `${Math.floor(g)}/${cap}`;
      if (label.textContent !== text) label.textContent = text;
      btn.classList.toggle('ready', ready);
      btn.classList.toggle('active', active);
      btn.disabled = !ready || silenced;
      btn.setAttribute(
        'aria-label',
        `${COLOR_NAME[COLOR_IDS[type]]} bucket ${Math.floor(g)} of ${cap}${ready ? ', full: click to activate' : ''}${active ? `, active ${Math.ceil(colors.buffs[type])} seconds` : ''}`,
      );
    });
  }

  private set(id: string, v: string | number): void {
    const e = $(id);
    const t = String(v);
    if (e.textContent !== t) e.textContent = t;
  }

  /** Hero arena and buckets belong to a round; the map and skills screens hide them. */
  private showBattle(visible: boolean): void {
    this.enemyCount.style.display = visible ? '' : 'none';
    $('topbar').style.display = visible ? '' : 'none';
    this.buckets.style.display = visible ? '' : 'none';
    this.actions.style.display = visible ? '' : 'none';
  }

  hide(): void {
    this.showBattle(true);
    this.overlay.classList.remove('map', 'skills', 'title', 'pause');
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }

  private show(...children: HTMLElement[]): void {
    this.overlay.classList.remove('map', 'skills', 'title', 'pause');
    this.overlay.replaceChildren(...children);
    this.overlay.hidden = false;
  }

  // ── title ────────────────────────────────────────────────────

  /** Main menu: logo, the cast, Play, and icon buttons for Skills and sound. */
  showTitle(): void {
    this.showBattle(false);
    const fx = el('div', '', { className: 'title-fx' });
    fx.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 26; i++) {
      const star = el('i', '', { className: 'star' });
      star.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 70}%;animation-delay:${(Math.random() * 3).toFixed(2)}s`;
      fx.append(star);
    }
    for (let i = 0; i < 12; i++) {
      const ember = el('i', '', { className: 'ember' });
      ember.style.cssText = `left:${Math.random() * 100}%;animation-delay:${(Math.random() * 6).toFixed(2)}s;animation-duration:${(5 + Math.random() * 4).toFixed(1)}s`;
      fx.append(ember);
    }
    const cast = el('div', '', { className: 'title-cast' });
    cast.setAttribute('aria-hidden', 'true');
    ['🛡️', '🧟', '👹', '💀'].forEach((face, i) => {
      const c = el('span', face, { className: i === 0 ? 'hero' : '' });
      c.style.animationDelay = `${i * 0.25}s`;
      cast.append(c);
    });
    const play = el('button', '', { className: 'btn-play', onclick: () => this.showMap() });
    play.innerHTML = `${ICONS.play}<span>Play</span>`;
    const muted = !this.sfx.sfxOn && !this.sfx.musicOn;
    const sound = iconButton(muted ? 'soundOff' : 'soundOn', muted ? 'Sound off' : 'Sound on', () => {
      const wasMuted = !this.sfx.sfxOn && !this.sfx.musicOn;
      this.sfx.setSfx(wasMuted);
      this.sfx.setMusic(wasMuted);
      this.showTitle();
    });
    const row = el('div', '', { className: 'title-icons' });
    row.append(iconButton('skills', 'Skills', () => this.showSkills(() => this.showTitle())), sound);
    this.show(fx, el('h1', 'Match-3 Quest', { className: 'title-logo' }), el('p', 'Match tiles. Command the hero. Slay the horde.', { className: 'title-tag' }), cast, play, row);
    this.overlay.classList.add('title');
  }

  // ── level map ────────────────────────────────────────────────

  /** One page of ten levels, level 1 of the page at the bottom, the path winding up. Never scrolls. */
  showMap(page?: number): void {
    this.showBattle(false);
    const done = this.progress.levelsCompleted;
    const p = Math.min(PAGE_COUNT - 1, Math.max(0, page ?? pageOfLevel(Math.min(done + 1, LEVEL_COUNT))));
    const levels = levelsOnPage(p);

    const header = el('div', '', { className: 'map-head' });
    header.append(
      iconButton('home', 'Main menu', () => this.showTitle()),
      el('span', `High score ${this.progress.highScore}`),
      el('span', `Coins ${this.progress.coins}`),
      iconButton('skills', 'Skills', () => this.showSkills(() => this.showMap(p))),
    );
    const stage = el('div', '', { className: 'map-stage' });
    const nav = el('div', '', { className: 'map-nav' });
    const prev = iconButton('prev', 'Previous levels', () => this.showMap(p - 1));
    prev.disabled = p === 0;
    const next = iconButton('next', 'Next levels', () => this.showMap(p + 1));
    next.disabled = p >= PAGE_COUNT - 1;
    nav.append(prev, el('span', `Levels ${levels[0]}-${levels[levels.length - 1]}`), next);

    this.show(header, stage, nav);
    this.overlay.classList.add('map');

    // Fit the whole page into the measured stage, so there is nothing to scroll.
    const W = stage.clientWidth || 320;
    const H = stage.clientHeight || 400;
    const PAD = 34;
    const row = levels.length > 1 ? (H - 2 * PAD) / (levels.length - 1) : 0;
    const size = Math.round(Math.min(52, Math.max(34, row - 4)));
    const pos = (i: number) => ({
      x: W / 2 + Math.round(Math.sin((levels[i] ?? 1) * 0.85) * Math.min(95, W * 0.3)),
      y: H - PAD - i * row,
    });
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    const path = document.createElementNS(NS, 'polyline');
    path.setAttribute('points', levels.map((_, i) => `${pos(i).x},${pos(i).y}`).join(' '));
    path.setAttribute('class', 'trail');
    svg.append(path);
    stage.append(svg);
    levels.forEach((level, i) => {
      const state = levelState(level, done);
      const at = pos(i);
      const node = el('button', String(level), {
        className: `node ${state}`,
        disabled: state === 'locked',
        onclick: () => this.handlers.onPlay(level),
      });
      node.style.cssText = `left:${at.x}px;top:${at.y}px;width:${size}px;height:${size}px`;
      node.setAttribute('aria-label', `Level ${level}, ${state}, ${enemiesForLevel(level)} enemies`);
      stage.append(node);
    });
  }

  // ── pause / debug ────────────────────────────────────────────

  /** Round paused: resume or leave, sound settings, and the debug tools. */
  showPause(cb: { onResume: () => void; onLeave: () => void; onDebug: () => void }): void {
    const toggle = (label: string, checked: boolean, change: (on: boolean) => void): HTMLElement => {
      const row = el('label', '', { className: 'setting' });
      const box = el('input');
      box.type = 'checkbox';
      box.checked = checked;
      box.addEventListener('change', () => change(box.checked));
      row.append(el('span', label), box);
      return row;
    };
    const volume = el('label', '', { className: 'setting' });
    const slider = el('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.value = String(this.sfx.volume);
    slider.setAttribute('aria-label', 'Volume');
    slider.addEventListener('input', () => this.sfx.setVolume(Number(slider.value)));
    volume.append(el('span', 'Volume'), slider);

    this.show(
      el('h2', 'Paused'),
      el('div', '', { className: 'settings' }),
      this.buttons(
        el('button', 'Resume', { className: 'primary', onclick: cb.onResume }),
        el('button', 'Leave game', { className: 'danger', onclick: cb.onLeave }),
      ),
    );
    this.overlay.querySelector('.settings')!.append(
      toggle('Sound effects', this.sfx.sfxOn, (on) => this.sfx.setSfx(on)),
      toggle('Music', this.sfx.musicOn, (on) => this.sfx.setMusic(on)),
      volume,
    );
    this.overlay.append(el('button', 'Debug', { className: 'link', onclick: cb.onDebug }));
    this.overlay.classList.add('pause');
  }

  /** Every enemy of the round, in order: defeated, the one being fought, and those still to come. */
  showEnemies(s: Session, onResume: () => void): void {
    const rows = s.combat.enemies.map((e, i) => {
      const dead = e.hp <= 0;
      const current = e === s.combat.currentEnemy;
      const row = el('div', '', { className: `enemy-row${dead ? ' dead' : ''}${current ? ' current' : ''}` });
      const state = dead ? 'Defeated' : current ? 'Fighting' : 'Waiting';
      row.append(
        el('span', e.template.face, { className: 'face' }),
        el('strong', `${i + 1}. ${e.name}`),
        el('span', dead ? state : `${e.hp}/${e.maxHp} HP · ${e.attack} ATK${e.range > 1 ? ` · range ${e.range}` : ''}`, { className: 'meta' }),
        el('small', `${e.template.role}: ${describeTraits(e.template)}${e.bonuses.length ? ` · ★ ${e.bonuses.map((b) => ENEMY_BONUSES[b].name + ' (' + ENEMY_BONUSES[b].text + ')').join(', ')}` : ''} · drops ${e.coins} coin${e.coins === 1 ? '' : 's'}`),
      );
      return row;
    });
    const list = el('div', '', { className: 'skills-list enemy-list' });
    list.append(...rows);
    const total = rows.length;
    this.show(el('h2', 'Enemies'), el('p', `${total - s.combat.enemiesLeft} of ${total} defeated`), list, this.buttons(el('button', 'Resume', { className: 'primary', onclick: onResume })));
    this.overlay.classList.add('skills');
    list.querySelector('.current')?.scrollIntoView({ block: 'center' });
  }

  /** The color's ultimate: locked until its base skill reaches the unlock level, then a one-time purchase. */
  private ultimateRow(color: (typeof COLOR_IDS)[number], refresh: () => void): HTMLElement {
    const row = el('div', '', { className: 'skill ultimate' });
    const owned = this.progress.hasUltimate(color);
    const baseLevel = this.progress.skillLevel(color, 'base');
    const need = this.gameplay.ultimateUnlockLevel;
    const label = owned ? 'Owned' : baseLevel < need ? `Base Lv ${need}` : `Buy ${this.gameplay.ultimateCost}`;
    const btn = el('button', label, {
      disabled: owned || !this.progress.canBuyUltimate(color),
      onclick: () => {
        this.progress.buyUltimate(color);
        refresh();
      },
    });
    row.append(el('strong', `Ultimate: ${ULTIMATES[color].name}`), btn, el('small', ultimateText(this.gameplay, color)));
    return row;
  }

  showDebug(actions: { label: string; run: () => void }[], onBack: () => void): void {
    const rows = actions.map((a) => {
      const btn = el('button', a.label, {
        onclick: () => {
          a.run();
          btn.textContent = `${a.label} ✓`;
          setTimeout(() => (btn.textContent = a.label), 900);
        },
      });
      return btn;
    });
    const list = el('div', '', { className: 'debug-list' });
    list.append(...rows);
    this.show(el('h2', 'Debug'), list, this.buttons(el('button', 'Back', { onclick: onBack })));
    this.overlay.classList.add('pause');
  }

  showSkills(back: () => void = () => this.showMap()): void {
    this.showBattle(false);
    const keep = this.overlay.querySelector('.skills-list')?.scrollTop ?? 0;
    const cards = COLOR_IDS.map((color, type) => {
      const card = el('section', '', { className: 'color-card' });
      card.style.setProperty('--c', TILE_COLORS[type]);
      card.append(el('h3', COLOR_NAME[color]));
      for (const branch of BRANCHES) {
        const level = this.progress.skillLevel(color, branch);
        const maxed = this.progress.isMaxed(color, branch);
        const row = el('div', '', { className: 'skill' });
        const btn = el('button', maxed ? 'Max' : `Upgrade ${this.progress.upgradeCost(color, branch)}`, {
          disabled: !this.progress.canUpgrade(color, branch),
          onclick: () => {
            this.progress.upgrade(color, branch);
            this.showSkills(back);
          },
        });
        row.append(el('strong', `${BRANCH_NAME[branch]}  Lv ${level}`), btn, el('small', describeSkill(this.gameplay, color, branch, level)));
        card.append(row);
      }
      card.append(this.ultimateRow(color, () => this.showSkills(back)));
      return card;
    });
    const passives = el('section', '', { className: 'color-card bonus-card' });
    passives.append(el('h3', 'Passives (permanent, endless)'));
    for (const id of PASSIVE_IDS) {
      const level = this.progress.passiveLevel(id);
      const row = el('div', '', { className: 'skill' });
      const btn = el('button', `Upgrade ${this.progress.passiveCost(id)}`, {
        disabled: !this.progress.canUpgradePassive(id),
        onclick: () => {
          this.progress.upgradePassive(id);
          this.showSkills(back);
        },
      });
      row.append(el('strong', `${PASSIVE_NAME[id]}  Lv ${level}`), btn, el('small', describePassive(this.gameplay, id, level)));
      passives.append(row);
    }
    const bonuses = el('section', '', { className: 'color-card bonus-card' });
    bonuses.append(el('h3', 'Bonus tiles (4+ matches)'));
    for (const id of BONUS_IDS) {
      const level = this.progress.bonusLevel(id);
      const maxed = level >= this.gameplay.maxSkillLevel;
      const row = el('div', '', { className: 'skill' });
      const btn = el('button', maxed ? 'Max' : `${level === 0 ? 'Unlock' : 'Upgrade'} ${this.progress.bonusCost(id)}`, {
        disabled: !this.progress.canUpgradeBonus(id),
        onclick: () => {
          this.progress.upgradeBonus(id);
          this.showSkills(back);
        },
      });
      row.append(el('strong', `${BONUS_NAME[id]}  ${level === 0 ? 'Locked' : `Lv ${level}`}`), btn, el('small', describeBonus(this.gameplay, id, level)));
      bonuses.append(row);
    }
    const list = el('div', '', { className: 'skills-list' });
    list.append(passives, bonuses, ...cards);
    this.show(
      el('h2', 'Skills'),
      el('p', `Coins ${this.progress.coins}`),
      list,
      this.buttons(el('button', 'Back', { onclick: back })),
    );
    this.overlay.classList.add('skills');
    list.scrollTop = keep;
  }

  showResult(outcome: 'won' | 'lost', level: number, score: number, reward: Reward | null): void {
    this.showBattle(true);
    const lines: HTMLElement[] = [el('p', `Score ${score}  ·  High score ${this.progress.highScore}`)];
    if (reward) {
      const bounty = reward.bonusCoins > 0 ? `, +${reward.bonusCoins} bonus coins` : '';
      lines.push(el('p', `+${reward.baseCoins} coins, +${reward.timeBonus} time bonus${bounty} = ${reward.total}`));
    }
    this.show(
      el('h2', outcome === 'won' ? `Level ${level} cleared` : 'Defeat'),
      ...lines,
      this.buttons(
        outcome === 'won' && level < LEVEL_COUNT
          ? el('button', 'Next level', { className: 'primary', onclick: () => this.handlers.onPlay(level + 1) })
          : el('button', 'Retry', { className: 'primary', onclick: () => this.handlers.onPlay(level) }),
        el('button', 'Map', { onclick: this.handlers.onMenu }),
      ),
    );
  }

  private buttons(...b: HTMLElement[]): HTMLElement {
    const row = el('div', '', { className: 'buttons' });
    row.append(...b);
    return row;
  }
}
