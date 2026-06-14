import { TPS } from './engine/constants';
import { step } from './engine/engine';
import { createInitialState } from './engine/state';
import type { GameState } from './engine/types';
import { InputManager } from './input/input';
import { Renderer } from './render/renderer';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new InputManager(window);

let state: GameState = createInitialState();

const TICK_MS = 1000 / TPS;
let accumulator = 0;
let lastTime = performance.now();

function loop(now: number): void {
  const delta = now - lastTime;
  lastTime = now;
  accumulator += delta;

  while (accumulator >= TICK_MS) {
    state = step(state, input.poll());
    accumulator -= TICK_MS;
  }

  renderer.render(state);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
