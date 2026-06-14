import { ARENA, ATTACKS, TPS } from './engine/constants';
import { step } from './engine/engine';
import { createInitialState } from './engine/state';
import type { GameState, Inputs } from './engine/types';
import { AudioEngine } from './audio/audio';
import { InputManager } from './input/input';
import { TouchControls } from './input/touch';
import { ParticleSystem } from './render/particles';
import { Renderer, type RenderEffects } from './render/renderer';
import { CPU_DIFFICULTIES, cpuBot, type CpuDifficulty } from './sim/bot';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const viewport = document.getElementById('game-viewport') ?? document.body;
const renderer = new Renderer(canvas);
const input = new InputManager(window);
const audio = new AudioEngine();
const particles = new ParticleSystem();
const touch = new TouchControls(input, viewport);

// 最初のユーザー操作で AudioContext をアンロックする(iOS Safari 対策)。
// 一度実行したら自身を解除する。
function unlockAudioOnce(): void {
  audio.unlock();
  window.removeEventListener('pointerdown', unlockAudioOnce);
  window.removeEventListener('keydown', unlockAudioOnce);
}
window.addEventListener('pointerdown', unlockAudioOnce);
window.addEventListener('keydown', unlockAudioOnce);

let state: GameState = createInitialState();

const TICK_MS = 1000 / TPS;
let accumulator = 0;
let lastTime = performance.now();

// --- 対戦モード -------------------------------------------------------
// デフォルトは CPU 対戦(1人プレイ即開始)。'c' キーで 2P ローカル対戦に切替。
let vsCpu = true;

// --- CPU 難易度 ---------------------------------------------------------
// 'v' キーで easy -> normal -> hard を循環。VS PLAYER 中でも切替可能
// (次に VS CPU に戻したとき反映される)。
const CPU_DIFFICULTY_ORDER: CpuDifficulty[] = ['easy', 'normal', 'hard'];
let cpuDifficulty: CpuDifficulty = 'normal';
let cpu = cpuBot(
  CPU_DIFFICULTIES[cpuDifficulty].reactionDelay,
  CPU_DIFFICULTIES[cpuDifficulty].skipReactionChance
);

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

/** プレイヤーの中心座標(パーティクル発生位置の基準) */
function playerCenter(p: GameState['players'][number]): { x: number; y: number } {
  return { x: p.x + ARENA.playerSize / 2, y: ARENA.floorY + ARENA.playerSize / 2 };
}

/**
 * 直前 tick (prev) と直後 tick (next) の GameState を比較し、
 * 演出イベント(ジャスト回避・被弾・攻撃発生・回避発生・フェーズ遷移)を検出して
 * 画面エフェクト・パーティクル・音声をトリガーする。
 * エンジン自体は変更しない(副作用は main.ts 側のローカル状態のみ)。
 */
function detectEvents(prev: GameState, next: GameState): void {
  for (let i = 0; i < 2; i++) {
    const before = prev.players[i];
    const after = next.players[i];
    const opponent = next.players[1 - i];

    // ジャスト回避成立: 攻撃側(相手 = i)の stunTicks が 0 から増加した tick
    if (before.stunTicks === 0 && after.stunTicks > 0) {
      hitstopRemaining = Math.max(hitstopRemaining, HITSTOP_MS);
      flashRemaining = Math.max(flashRemaining, FLASH_MS);
      justTextRemaining = Math.max(justTextRemaining, JUST_TEXT_MS);

      // バーストは「決めた」側(防御側 = 相手)の位置に出す
      const defenderCenter = playerCenter(opponent);
      particles.burst(defenderCenter.x, defenderCenter.y, '#ffe066', 24);
      audio.just();
    }

    // 被弾: HP が減少した tick
    if (after.hp < before.hp) {
      shakeRemaining = Math.max(shakeRemaining, SHAKE_MS);
      shakeMagnitude = Math.min(10, before.hp - after.hp);

      const center = playerCenter(after);
      const damage = before.hp - after.hp;
      const kind = damage >= ATTACKS.heavy.damage ? 'heavy' : 'light';
      const color = i === 0 ? '#4da6ff' : '#ff5d5d';
      particles.sparks(center.x, center.y, color, kind === 'heavy' ? 20 : 12);
      audio.hit(kind);
    }

    // 攻撃発生(elapsed === 1 の tick が「開始した」瞬間)
    if (after.attack && after.attack.elapsed === 1 && !before.attack) {
      audio.swing(after.attack.kind);
    }

    // 回避発生(elapsed === 1 の tick が「開始した」瞬間)
    if (after.dodge && after.dodge.elapsed === 1 && !before.dodge) {
      const center = playerCenter(after);
      // facing の逆方向(回避ダッシュの進行方向)へ砂塵を出す
      particles.dust(center.x, center.y, after.facing);
      audio.dodge();
    }
  }

  // フェーズ遷移
  if (prev.phase !== next.phase) {
    if (next.phase === 'starting') {
      audio.roundStart();
    } else if (next.phase === 'roundOver') {
      const isKo = next.players.some((p) => p.hp <= 0);
      if (isKo) audio.ko();
    } else if (next.phase === 'matchOver') {
      audio.matchEnd();
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
    touch.setTwoPlayer(!vsCpu);
  }
  if (input.wasJustPressed('v')) {
    const idx = CPU_DIFFICULTY_ORDER.indexOf(cpuDifficulty);
    cpuDifficulty = CPU_DIFFICULTY_ORDER[(idx + 1) % CPU_DIFFICULTY_ORDER.length];
    const { reactionDelay, skipReactionChance } = CPU_DIFFICULTIES[cpuDifficulty];
    cpu = cpuBot(reactionDelay, skipReactionChance);
  }
  if (input.wasJustPressed('m')) {
    audio.setMuted(!audio.muted);
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

  particles.update(delta);

  const modeLabel = vsCpu
    ? `VS CPU [${cpuDifficulty.toUpperCase()}] (C:対戦切替 V:難易度)`
    : `VS PLAYER (C:対戦切替 V:難易度)`;
  const muteIcon = audio.muted ? '🔇' : '🔊';

  const effects: RenderEffects = {
    modeLabel: `${modeLabel}  ${muteIcon} M:ミュート`,
    worldOverlay: (ctx) => particles.draw(ctx),
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

  renderer.render(state, effects, delta);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
