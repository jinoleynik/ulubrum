import './style.css';
import { defaultConfig, InputController, validateConfig } from './core';
import { bindAudio } from './audio/bindAudio';
import { Sfx } from './audio/sfx';
import { CanvasRenderer } from './render/canvasRenderer';
import { bindPointer } from './render/pointer';
import { COLOR_IDS, COLOR_NAME, defaultGameplay, MemoryStore, Progress, Session, type KeyValueStore } from './session';
import { Floaters } from './ui/floaters';
import { Hud } from './ui/hud';
import { Panel } from './ui/panel';

const canvas = document.getElementById('board') as HTMLCanvasElement;
const renderer = new CanvasRenderer(canvas);
const floaters = new Floaters(document.getElementById('floaters')!);

function openStore(): KeyValueStore {
  try {
    const probe = '__match3_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return new MemoryStore(); // storage blocked: progress lasts for this page only
  }
}
const store = openStore();
const progress = new Progress(store, defaultGameplay);
const sfx = new Sfx(store);

// Browsers only allow audio after a gesture: unlock on the first one, and click-tick every button.
document.addEventListener(
  'pointerdown',
  (e) => {
    sfx.unlock();
    sfx.startMusic();
    if ((e.target as HTMLElement | null)?.closest?.('button')) sfx.play('click');
  },
  { capture: true },
);

let session!: Session;
let input!: InputController;
/** The round only advances (and the board only accepts input) while this is true. */
let playing = false;
/** Round is frozen behind the pause menu. */
let paused = false;
let unbindAudio: (() => void) | null = null;
/** Level being played; the sidebar's New board button restarts it. */
let level = 1;

const panel = new Panel({
  onNewBoard: () => startRound(level),
  onHalt: () => session.game.halt(),
});

function leaveRound(): void {
  session.leave();
  playing = false;
  paused = false;
  hud.showMap();
}

const hud = new Hud(progress, defaultGameplay, sfx, {
  onPlay: (n) => startRound(n),
  onMenu: leaveRound,
  onShuffle: () => {
    if (playing && !paused && session.reshuffle()) panel.write('Re-shuffle: buffs, buckets and bonuses cleared', 'info');
  },
  onBucket: (type) => {
    if (playing && !paused && session.activate(type)) {
      sfx.play('activate');
      panel.write(`${COLOR_NAME[COLOR_IDS[type]]} activated`, 'ok');
    }
  },
  onPause: () => pause(),
  onEnemies: () => pause(() => hud.showEnemies(session, resume)),
});

const debugActions = () => [
  { label: 'Heal hero', run: () => session.debugHealHero() },
  { label: 'Add money (+500)', run: () => session.debugAddMoney(500) },
  { label: 'Kill first enemy', run: () => session.debugKillFirstEnemy() },
  { label: 'Kill all enemies', run: () => session.debugKillAll() },
  { label: 'Win the level', run: () => session.debugKillAll() },
];

function showPauseMenu(): void {
  hud.showPause({
    onResume: resume,
    onLeave: leaveRound,
    onDebug: () => hud.showDebug(debugActions(), showPauseMenu),
  });
}

function pause(show: () => void = showPauseMenu): void {
  if (!playing || paused) return;
  paused = true;
  show();
}

function resume(): void {
  if (!paused) return;
  paused = false;
  hud.hide();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !playing) return;
  if (paused) resume();
  else pause();
});

function createSession(): void {
  const { colorCount, splash, seed, gridSize } = panel.settings;
  const board = { ...defaultConfig, width: gridSize, height: gridSize + 3, colorCount, firstWaveSplash: splash };
  for (const problem of validateConfig(board)) panel.write(problem, 'warn');
  session = new Session({ seed, level, progress, board, gameplay: defaultGameplay });
  input = new InputController(session.game);
  panel.attach(session.game);
  unbindAudio?.();
  unbindAudio = bindAudio(session, sfx);
  session.game.on((e) => {
    if (e.kind === 'waveDestroying') renderer.burst(session.game, e.tiles);
  });
  session.on((e) => {
    if (e.kind === 'combat') {
      const c = e.event;
      const { hero } = session.combat;
      const unit = (target: 'hero' | 'enemy', enemy?: object) => renderer.unitCenter(target === 'hero' ? hero : (enemy ?? hero));
      if (c.kind === 'damage') {
        const key = c.target === 'hero' ? hero : (c.enemy ?? hero);
        renderer.flash(key);
        floaters.spawn(unit(c.target, c.enemy), `-${c.amount}`, c.crit ? 'crit' : 'dmg');
      } else if (c.kind === 'heal') {
        floaters.spawn(unit(c.target, c.enemy), `+${c.amount}`, 'heal');
      } else if (c.kind === 'enemyAttack' && c.enemy.range > 1) {
        renderer.shoot(c.enemy, hero);
      } else if (c.kind === 'enemyDied' && c.enemy.coins > 1) {
        floaters.spawn(renderer.unitCenter(c.enemy), `+${c.enemy.coins}💰`, 'coin');
      }
    }
    if (e.kind === 'ended') {
      playing = false;
      paused = false;
      hud.showResult(e.outcome, session.level, session.score.score, e.reward);
      panel.write(e.outcome === 'won' ? 'Victory' : 'Defeat', e.outcome === 'won' ? 'ok' : 'warn');
    } else if (e.event.kind === 'damage' && e.event.target === 'hero') {
      panel.write(`Hero takes ${e.event.amount}`);
    } else if (e.event.kind === 'heal' && e.event.target === 'hero') {
      panel.write(`Hero heals ${e.event.amount}`, 'ok');
    } else if (e.event.kind === 'damage') {
      panel.write(`Enemy takes ${e.event.amount}${e.event.crit ? ' (crit)' : ''}`, 'info');
    } else if (e.event.kind === 'shield') {
      panel.write(`Hero shield +${e.event.amount}`, 'ok');
    } else if (e.event.kind === 'status') {
      panel.write(`${e.event.target === 'hero' ? 'Hero' : 'Enemy'}: ${e.event.status}`, e.event.target === 'hero' ? 'warn' : 'info');
    }
  });
}

function startRound(n: number): void {
  level = n;
  const seed = Math.floor(Math.random() * 1e6); // every run deals a different board
  panel.settings.seed = seed;
  (document.getElementById('seed') as HTMLInputElement).value = String(seed);
  createSession();
  playing = true;
  paused = false;
  hud.hide();
}

bindPointer(canvas, renderer, () => ({ game: session.game, input }));
createSession();
hud.showTitle();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000) * panel.settings.speed;
  last = now;
  if (playing && !paused) session.tick(dt);
  renderer.draw(session.game, panel.settings.showStates, paused ? 0 : dt, session.combat);
  panel.update(session.game);
  hud.update(session);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the rules from DevTools (live getters, not snapshots).
Object.defineProperties(window, {
  session: { get: () => session },
  game: { get: () => session.game },
  progress: { value: progress },
});
