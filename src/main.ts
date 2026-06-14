import { ARENA, ATTACKS, DODGE, JUST, TPS } from './engine/constants';
import { step } from './engine/engine';
import { createInitialState } from './engine/state';
import type { GameState, Inputs } from './engine/types';
import { AudioEngine } from './audio/audio';
import { InputManager } from './input/input';
import { TouchControls } from './input/touch';
import { ParticleSystem } from './render/particles';
import { FloatingTextSystem } from './render/floatingText';
import { Renderer, type RenderEffects } from './render/renderer';
import { CPU_DIFFICULTIES, cpuBot, type CpuDifficulty } from './sim/bot';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const viewport = document.getElementById('game-viewport') ?? document.body;
const renderer = new Renderer(canvas);
const input = new InputManager(window);
const audio = new AudioEngine();
const particles = new ParticleSystem();
const floatingTexts = new FloatingTextSystem();
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

// --- 設定の永続化 -------------------------------------------------------
// 難易度・アシスト・ミュートの選択を localStorage に保存し、次回起動時に復元する。
// localStorage はブラウザ専用 API なのでエンジン外(main.ts)でのみ扱う。
// プライベートモード等で例外が出ても致命的でないため握り潰す。
const SETTINGS_KEY = 'setsuna.settings.v1';

interface SavedSettings {
  difficulty?: CpuDifficulty;
  assist?: boolean;
  muted?: boolean;
}

function loadSettings(): SavedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as SavedSettings) : {};
  } catch {
    return {};
  }
}

function saveSettings(): void {
  try {
    const data: SavedSettings = { difficulty: cpuDifficulty, assist: showJustCue, muted: audio.muted };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch {
    /* 保存に失敗しても無視(プライベートモード等) */
  }
}

const savedSettings = loadSettings();

// --- 対戦モード -------------------------------------------------------
// デフォルトは CPU 対戦(1人プレイ即開始)。'c' キーで 2P ローカル対戦に切替。
let vsCpu = true;

// --- ジャスト回避アシスト ----------------------------------------------
// 攻撃側に収束リングを描き、ジャスト回避の猶予に入ると金色に光らせる補助表示。
// 'h' キーで ON/OFF を切替(初心者はタイミングを掴みやすく、上級者は消せる)。
let showJustCue = savedSettings.assist ?? true;

// 保存済みのミュート状態を復元する
if (savedSettings.muted) audio.setMuted(true);

// --- CPU 難易度 ---------------------------------------------------------
// 'v' キーで easy -> normal -> hard を循環。VS PLAYER 中でも切替可能
// (次に VS CPU に戻したとき反映される)。
const CPU_DIFFICULTY_ORDER: CpuDifficulty[] = ['easy', 'normal', 'hard'];
// 既定は easy(やさしめ)。慣れてきたら 'v' で normal/hard に上げられる。
// 保存済みの難易度があれば復元する(不正値は easy にフォールバック)。
let cpuDifficulty: CpuDifficulty =
  savedSettings.difficulty && CPU_DIFFICULTY_ORDER.includes(savedSettings.difficulty)
    ? savedSettings.difficulty
    : 'easy';
let cpu = cpuBot(
  CPU_DIFFICULTIES[cpuDifficulty].reactionDelay,
  CPU_DIFFICULTIES[cpuDifficulty].skipReactionChance,
  CPU_DIFFICULTIES[cpuDifficulty].allowJustPunish
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

/** その攻撃が windup 中で「ジャスト回避の猶予(active 開始まで JUST.window tick 以内)」に
 *  入っているか。ジャスト回避アシストの聴覚キューの発火判定に使う。 */
function attackInJustWindow(p: GameState['players'][number]): boolean {
  if (!p.attack) return false;
  const spec = ATTACKS[p.attack.kind];
  if (p.attack.elapsed >= spec.windup) return false; // windup 中のみ
  return spec.windup - p.attack.elapsed <= JUST.window;
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
      // 決めた側に「反撃!」を出して、ジャスト回避後が攻め込む好機だと教える
      floatingTexts.spawn(
        defenderCenter.x,
        defenderCenter.y - ARENA.playerSize * 0.55,
        '反撃!',
        '#ffe066',
        18
      );
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
      // 被弾位置にダメージ量を浮かび上がらせる(強は大きく橙、弱は小さく白)
      floatingTexts.spawn(
        center.x,
        center.y - ARENA.playerSize * 0.45,
        `${Math.round(damage)}`,
        kind === 'heavy' ? '#ffb070' : '#ffffff',
        kind === 'heavy' ? 24 : 17
      );
      audio.hit(kind);
    }

    // 攻撃発生(elapsed === 1 の tick が「開始した」瞬間)
    if (after.attack && after.attack.elapsed === 1 && !before.attack) {
      audio.swing(after.attack.kind);
    }

    // ジャスト回避アシスト(音): 攻撃が「回避猶予」に入った瞬間、視覚の金色リングと
    // 対になる控えめな合図を鳴らす。アシスト ON 時のみ。VS CPU では人間(P1)が回避すべき
    // 相手(CPU = i===1)の攻撃に限定し、自分の攻撃では鳴らさない。
    if (showJustCue && (!vsCpu || i === 1) && !attackInJustWindow(before) && attackInJustWindow(after)) {
      audio.cue();
    }

    // 回避発生(elapsed === 1 の tick が「開始した」瞬間)
    if (after.dodge && after.dodge.elapsed === 1 && !before.dodge) {
      const center = playerCenter(after);
      // facing の逆方向(回避ダッシュの進行方向)へ砂塵を出す
      particles.dust(center.x, center.y, after.facing);
      audio.dodge();
    }

    // ジャンプ発生(vy が 0 以下から上昇に転じた tick。二段ジャンプでも同じ音を鳴らす)
    if (after.vy > 0 && before.vy <= 0) {
      audio.jump();
    }

    // 着地(空中から接地に転じた tick): 足元に砂塵を出す
    if (before.y > 0 && after.y === 0) {
      particles.landingDust(after.x + ARENA.playerSize / 2, ARENA.floorY + ARENA.playerSize);
      audio.land();
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

/**
 * 入力に対するフィードバック演出。回避を入力したのにスタミナ不足で出せなかったとき、
 * 「スタミナ不足!」を表示してスタミナ管理を分かりやすく伝える(クールダウン中は無言)。
 * 人間プレイヤー(VS CPU は P1、VS PLAYER は両者)のみ対象。fighting 中のみ。
 */
function detectInputFeedback(prev: GameState, ins: Inputs, next: GameState): void {
  if (prev.phase !== 'fighting') return;
  for (let i = 0; i < 2; i++) {
    const human = i === 0 || !vsCpu;
    if (!human) continue;
    const p = prev.players[i];
    if (!ins[i].dodge || ins[i].attack !== null) continue; // 回避入力のみを対象
    const actionable = !p.attack && !p.dodge && p.stunTicks === 0;
    const startedDodge = !p.dodge && next.players[i].dodge !== null;
    if (actionable && !startedDodge && p.stamina < DODGE.staminaCost) {
      const center = playerCenter(next.players[i]);
      floatingTexts.spawn(center.x, center.y - ARENA.playerSize * 0.55, 'スタミナ不足!', '#ff8a8a', 13);
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
    const { reactionDelay, skipReactionChance, allowJustPunish } = CPU_DIFFICULTIES[cpuDifficulty];
    cpu = cpuBot(reactionDelay, skipReactionChance, allowJustPunish);
    saveSettings();
  }
  if (input.wasJustPressed('m')) {
    audio.setMuted(!audio.muted);
    saveSettings();
  }
  if (input.wasJustPressed('h')) {
    showJustCue = !showJustCue;
    saveSettings();
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

// 1 フレームで進める時間の上限(ms)。タブを離れて戻ったときなど巨大な delta で
// シミュレーションが一気に早送り(=スパイラル)するのを防ぐためにクランプする。
const MAX_FRAME_MS = 250;

function loop(now: number): void {
  const delta = Math.min(now - lastTime, MAX_FRAME_MS);
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
      detectInputFeedback(state, inputs, next);
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
  floatingTexts.update(delta);

  const modeLabel = vsCpu
    ? `VS CPU [${cpuDifficulty.toUpperCase()}] (C:対戦切替 V:難易度)`
    : `VS PLAYER (C:対戦切替 V:難易度)`;
  const muteIcon = audio.muted ? '🔇' : '🔊';
  const assistIcon = showJustCue ? '🟡' : '⚪';

  const effects: RenderEffects = {
    modeLabel: `${modeLabel}  ${muteIcon} M:ミュート  ${assistIcon} H:アシスト`,
    showJustCue,
    worldOverlay: (ctx) => {
      particles.draw(ctx);
      floatingTexts.draw(ctx);
    },
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
