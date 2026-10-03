import './style.css';
import { defaultConfig, InputController, validateConfig } from './core';
import { CanvasRenderer } from './render/canvasRenderer';
import { bindPointer } from './render/pointer';
import { defaultGameplay, MemoryStore, Progress, Session, type KeyValueStore } from './session';
import { Hud } from './ui/hud';
import { Panel } from './ui/panel';

const canvas = document.getElementById('board') as HTMLCanvasElement;
const renderer = new CanvasRenderer(canvas);

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
const progress = new Progress(openStore(), defaultGameplay);

let session!: Session;
let input!: InputController;
/** The round only advances (and the board only accepts input) while this is true. */
let playing = false;

const panel = new Panel({
  onNewBoard: () => startRound(),
  onHalt: () => session.game.halt(),
});

const hud = new Hud(progress, defaultGameplay, {
  onPlay: () => startRound(),
  onMenu: () => {
    session.leave();
    playing = false;
    hud.showMenu();
  },
});

function createSession(): void {
  const { colorCount, splash, seed, gridSize } = panel.settings;
  const board = { ...defaultConfig, width: gridSize, height: gridSize, colorCount, firstWaveSplash: splash };
  for (const problem of validateConfig(board)) panel.write(problem, 'warn');
  session = new Session({ seed, progress, board, gameplay: defaultGameplay });
  input = new InputController(session.game);
  panel.attach(session.game);
  session.on((e) => {
    if (e.kind === 'ended') {
      playing = false;
      hud.showResult(e.outcome, session.score.score, e.reward);
      panel.write(e.outcome === 'won' ? 'Victory' : 'Defeat', e.outcome === 'won' ? 'ok' : 'warn');
    } else if (e.event.kind === 'damage' && e.event.target === 'hero') {
      panel.write(`Hero takes ${e.event.amount}`);
    } else if (e.event.kind === 'heal') {
      panel.write(`Hero heals ${e.event.amount}`, 'ok');
    } else if (e.event.kind === 'damage') {
      panel.write(`Enemy takes ${e.event.amount}`, 'info');
    }
  });
}

function startRound(): void {
  createSession();
  playing = true;
  hud.hide();
}

bindPointer(canvas, renderer, () => ({ game: session.game, input }));
createSession();
hud.showMenu();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000) * panel.settings.speed;
  last = now;
  if (playing) session.tick(dt);
  renderer.draw(session.game, panel.settings.showStates);
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
