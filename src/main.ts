import './style.css';
import { defaultConfig, Game, InputController, validateConfig } from './core';
import { CanvasRenderer } from './render/canvasRenderer';
import { bindPointer } from './render/pointer';
import { Panel } from './ui/panel';

const canvas = document.getElementById('board') as HTMLCanvasElement;
const renderer = new CanvasRenderer(canvas);

let game!: Game;
let input!: InputController;

const panel = new Panel({
  onNewBoard: () => startGame(),
  onHalt: () => game.halt(),
});

function startGame(): void {
  const { colorCount, splash, seed } = panel.settings;
  const config = { ...defaultConfig, colorCount, firstWaveSplash: splash };
  for (const problem of validateConfig(config)) panel.write(problem, 'warn');
  game = new Game(config, { seed });
  input = new InputController(game);
  panel.attach(game);
}

bindPointer(canvas, renderer, () => ({ game, input }));
startGame();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000) * panel.settings.speed;
  last = now;
  game.tick(dt);
  renderer.draw(game, panel.settings.showStates);
  panel.update(game);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the rules from DevTools.
Object.assign(window, { get game() { return game; } });
