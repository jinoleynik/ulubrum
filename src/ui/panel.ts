import type { Game, GameEvent } from '../core';

export interface PanelSettings {
  speed: number;
  showStates: boolean;
  splash: boolean;
  colorCount: number;
  seed: number;
}

type LogKind = '' | 'ok' | 'warn' | 'info';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

/** Controls, live stats and the event log. */
export class Panel {
  readonly settings: PanelSettings;
  private readonly log = $<HTMLUListElement>('log');
  private readonly t0 = performance.now();
  private movesStamp = '';
  private movesCache = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(handlers: { onNewBoard: () => void; onHalt: () => void }) {
    const speed = $<HTMLInputElement>('speed');
    const states = $<HTMLInputElement>('states');
    const splash = $<HTMLInputElement>('splash');
    const colors = $<HTMLInputElement>('colors');
    const seed = $<HTMLInputElement>('seed');

    this.settings = {
      speed: Number(speed.value),
      showStates: states.checked,
      splash: splash.checked,
      colorCount: Number(colors.value),
      seed: Number(seed.value),
    };

    speed.addEventListener('input', () => {
      this.settings.speed = Number(speed.value);
      $('speedValue').textContent = `${this.settings.speed.toFixed(2)}×`;
    });
    states.addEventListener('change', () => {
      this.settings.showStates = states.checked;
      $('legend').hidden = !states.checked;
    });
    splash.addEventListener('change', () => (this.settings.splash = splash.checked));

    const readBoardInputs = () => {
      const n = Math.max(3, Math.min(6, Math.trunc(Number(colors.value)) || 6));
      colors.value = String(n);
      this.settings.colorCount = n;
      this.settings.seed = Math.trunc(Number(seed.value)) || 0;
    };
    $('btnNew').addEventListener('click', () => {
      readBoardInputs();
      handlers.onNewBoard();
    });
    $('btnRandom').addEventListener('click', () => {
      seed.value = String(Math.floor(Math.random() * 1e6));
      readBoardInputs();
      handlers.onNewBoard();
    });
    $('btnHalt').addEventListener('click', handlers.onHalt);
  }

  attach(game: Game): void {
    this.unsubscribe?.();
    this.unsubscribe = game.on((e) => this.onEvent(game, e));
    this.movesStamp = '';
  }

  update(game: Game): void {
    const { stats } = game;
    // Possible moves are only recomputed when the board settles or counters change.
    const stamp = `${stats.cleared}|${stats.validSwaps}|${stats.revertedSwaps}|${game.isBusy}`;
    if (stamp !== this.movesStamp) {
      this.movesStamp = stamp;
      this.movesCache = game.board.countPossibleMoves();
    }
    const chain = game.halted ? 'halted' : game.isChainRunning ? (game.isDropping ? 'dropping' : 'running') : 'idle';
    this.set('sChain', chain);
    this.set('sWave', stats.wave);
    this.set('sSwaps', game.swapsInFlight);
    this.set('sMoves', this.movesCache);
    this.set('sCleared', stats.cleared);
    this.set('sValid', stats.validSwaps);
    this.set('sReverted', stats.revertedSwaps);
    this.set('sViolations', stats.violations);
    $('sViolations').classList.toggle('bad', stats.violations > 0);
    $('sMoves').classList.toggle('bad', !game.isBusy && this.movesCache === 0);
  }

  private set(id: string, v: string | number): void {
    const el = $(id);
    const s = String(v);
    if (el.textContent !== s) el.textContent = s;
  }

  private onEvent(game: Game, e: GameEvent): void {
    const b = game.board;
    const at = (i: number) => `(${b.xOf(i)},${b.yOf(i)})`;
    switch (e.kind) {
      case 'boardCreated':
        return this.write(`New board, seed ${e.seed}, ${b.colorCount} colors`, 'info');
      case 'swapCommitted':
        return this.write(`Swap ${at(e.a)}↔${at(e.b)} committed${e.joinedChain ? ', joins running chain' : ''}`, 'ok');
      case 'swapReverted':
        return this.write(`Swap ${at(e.a)}↔${at(e.b)} reverted: no match`);
      case 'swapBlocked':
        return this.write(`Swap ${at(e.a)}↔${at(e.b)} blocked: ${e.reason}`);
      case 'waveStarted':
        return this.write(`Wave ${e.wave}: clearing ${e.count} tiles`, 'info');
      case 'splash':
        return this.write(`Splash adds ${e.added} tiles`);
      case 'chainFinished':
        return this.write(`Chain finished after ${e.waves} wave${e.waves === 1 ? '' : 's'}`);
      case 'spawnFallback':
        return this.write(`No match-free color at (${e.x},${e.y}); fell back to random`, 'warn');
      case 'violation':
        return this.write(`Rule violation: ${e.message}`, 'warn');
      case 'halted':
        return this.write('Halted: coroutines stopped, input locked', 'warn');
    }
  }

  write(message: string, kind: LogKind = ''): void {
    const li = document.createElement('li');
    if (kind) li.className = kind;
    const time = document.createElement('time');
    time.textContent = `${((performance.now() - this.t0) / 1000).toFixed(2)}s`;
    li.append(time, message);
    this.log.prepend(li);
    while (this.log.children.length > 80) this.log.lastElementChild?.remove();
  }
}
