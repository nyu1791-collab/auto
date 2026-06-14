import { TPS } from './engine/constants';
import { step } from './engine/engine';
import { createInitialState } from './engine/state';
import type { GameState, Inputs } from './engine/types';
import { InputManager } from './input/input';
import { Renderer, type RenderEffects } from './render/renderer';
import { cpuBot } from './sim/bot';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new InputManager(window);
const cpu = cpuBot();

let state: GameState = createInitialState();

const TICK_MS = 1000 / TPS;
let accumulator = 0;
let lastTime = performance.now();

// --- 対戦モード -------------------------------------------------------
// デフォルトは CPU 対戦(1人プレイ即開始)。'c' キーで 2P ローカル対戦に切替。
let vsCpu = true;

// --- ヒットストップ -----------------------------------------------------
// ジャスト回避が決まった瞬間、固定ステップの進行を一時停止して「決まった」感を出す。
// 描画は止めず、レンダリングのみ継続する。エンジンの tick 進行・決定性には影響しない。
const HITSTOP_MS = 120;
let hitstopRemaining = 0;

// --- 画面エフェクト -----------------------------------------------------
const SHAKE_MS = 200;
const FLASH_MS = 100;
const JUST_TEXT_MS = 500;

let shakeRemaining = 0;
let shakeMagnitude = 0;
let flashRemaining = 0;
let justTextRemaining = 0;

/**
 * 直前 tick (prev) と直後 tick (next) の GameState を比較し、
 * 演出イベント(ジャスト回避・被弾)を検出してエフェクトをトリガーする。
 * エンジン自体は変更しない(副作用は main.ts 側のローカル状態のみ)。
 */
function detectEvents(prev: GameState, next: GameState): void {
  for (let i = 0; i < 2; i++) {
    const before = prev.players[i];
    const after = next.players[i];

    // ジャスト回避成立: 攻撃側(相手)の stunTicks が 0 から増加した tick
    if (before.stunTicks === 0 && after.stunTicks > 0) {
      hitstopRemaining = Math.max(hitstopRemaining, HITSTOP_MS);
      flashRemaining = Math.max(flashRemaining, FLASH_MS);
      justTextRemaining = Math.max(justTextRemaining, JUST_TEXT_MS);
    }

    // 被弾: HP が減少した tick
    if (after.hp < before.hp) {
      shakeRemaining = Math.max(shakeRemaining, SHAKE_MS);
      shakeMagnitude = Math.min(10, before.hp - after.hp);
    }
  }
}

function currentInputs(): Inputs {
  const polled = input.poll();
  if (vsCpu) {
    return [polled[0], cpu(state, 1)];
  }
  return polled;
}

function handleMenuInputs(): void {
  if (input.wasJustPressed('c')) {
    vsCpu = !vsCpu;
  }
  if (state.phase === 'matchOver') {
    if (input.wasJustPressed('enter') || input.wasJustPressed(' ')) {
      state = createInitialState();
      hitstopRemaining = 0;
      shakeRemaining = 0;
      flashRemaining = 0;
      justTextRemaining = 0;
    }
  }
}

function loop(now: number): void {
  const delta = now - lastTime;
  lastTime = now;

  // エフェクトのタイマーは常に進行させる(ヒットストップ中でも経過させてよい)
  if (hitstopRemaining > 0) hitstopRemaining = Math.max(0, hitstopRemaining - delta);
  if (shakeRemaining > 0) shakeRemaining = Math.max(0, shakeRemaining - delta);
  if (flashRemaining > 0) flashRemaining = Math.max(0, flashRemaining - delta);
  if (justTextRemaining > 0) justTextRemaining = Math.max(0, justTextRemaining - delta);

  handleMenuInputs();

  if (hitstopRemaining <= 0) {
    accumulator += delta;

    while (accumulator >= TICK_MS) {
      const inputs = currentInputs();
      const next = step(state, inputs);
      detectEvents(state, next);
      state = next;
      accumulator -= TICK_MS;

      // ヒットストップが発生したら、このフレームの残りステップは次フレームに繰り越す
      if (hitstopRemaining > 0) break;
    }
  } else {
    // ヒットストップ中も入力キューは消費しておく(ためが残らないようにする)
    input.poll();
  }

  const effects: RenderEffects = {
    modeLabel: vsCpu ? 'VS CPU (C で切替)' : 'VS PLAYER (C で切替)',
  };

  if (shakeRemaining > 0) {
    const intensity = shakeMagnitude * (shakeRemaining / SHAKE_MS);
    effects.shakeX = (Math.random() * 2 - 1) * intensity;
    effects.shakeY = (Math.random() * 2 - 1) * intensity;
  }

  if (flashRemaining > 0) {
    effects.flashAlpha = 0.5 * (flashRemaining / FLASH_MS);
  }

  if (justTextRemaining > 0) {
    effects.justTextAlpha = Math.min(1, justTextRemaining / (JUST_TEXT_MS * 0.6));
  }

  renderer.render(state, effects);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
