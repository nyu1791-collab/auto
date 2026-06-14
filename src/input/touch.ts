/**
 * タッチデバイス向けの画面操作 UI。
 *
 * 画面を左右に分割し、左半分=バーチャルアナログスティック(移動)、
 * 右半分=アクションボタン(回避/弱/強)とする。Pointer Events を使い、
 * `InputManager.setStick` / `pressVirtual` / `releaseVirtual` に直結する。
 * いずれもキーボード入力と同じ意味を持つ「仮想入力」として扱われるため、
 * エンジン側(`src/engine/**`, `src/sim/**`)には一切影響しない。
 *
 * このモジュールは `PointerEvent` や DOM API に依存するため、
 * `src/engine/**` や `src/sim/**` からは絶対に import しないこと。
 */

import type { InputManager } from './input';

interface ButtonSpec {
  /** ボタンに表示するラベル */
  label: string;
  /** 押下時に `pressVirtual` する仮想キー */
  key: string;
  /** CSS の `grid-area` 等で使う識別用クラス */
  className: string;
  /** メニュー系ボタン(押した瞬間だけ反応させたい)かどうか */
  momentary?: boolean;
}

/** P1 のアクションボタン(回避/弱/強) */
const P1_ACTION_BUTTONS: ButtonSpec[] = [
  { label: '弱', key: 'f', className: 'tc-light' },
  { label: '強', key: 'g', className: 'tc-heavy' },
  { label: '回避', key: 'shift', className: 'tc-dodge' },
];

/** P2 のアクションボタン(回避/弱/強) */
const P2_ACTION_BUTTONS: ButtonSpec[] = [
  { label: '弱', key: 'k', className: 'tc-light' },
  { label: '強', key: 'l', className: 'tc-heavy' },
  { label: '回避', key: '/', className: 'tc-dodge' },
];

const MENU_BUTTONS: ButtonSpec[] = [
  { label: '対戦切替', key: 'c', className: 'tc-menu-mode', momentary: true },
  { label: '難易度', key: 'v', className: 'tc-menu-diff', momentary: true },
  { label: '🔊', key: 'm', className: 'tc-menu-mute', momentary: true },
  { label: 'リスタート', key: 'enter', className: 'tc-menu-restart', momentary: true },
];

/** タッチ操作が可能な環境かどうかを判定する */
export function isTouchDevice(): boolean {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const hasTouch = 'ontouchstart' in window;
  return coarse || hasTouch;
}

/**
 * バーチャルアナログスティック。ベース円内をドラッグすると、中心からの相対
 * ベクトルを `{forward, strafe}`(画面上方向 = forward+)に変換して
 * `InputManager.setStick` を呼び出す。離すと (0,0) に戻る。
 */
class VirtualStick {
  readonly root: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pointerId: number | null = null;
  /** ベースの半径(px)。スティックの可動範囲 */
  private radius = 0;

  constructor(
    private input: InputManager,
    private player: 0 | 1,
    className: string
  ) {
    this.root = document.createElement('div');
    this.root.className = `tc-stick-zone ${className}`;

    this.base = document.createElement('div');
    this.base.className = 'tc-stick-base';

    this.knob = document.createElement('div');
    this.knob.className = 'tc-stick-knob';
    this.base.appendChild(this.knob);
    this.root.appendChild(this.base);

    this.root.style.touchAction = 'none';
    this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.root.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.root.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.root.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.root.setPointerCapture(e.pointerId);
    this.base.classList.add('tc-stick-active');
    this.updateFromEvent(e);
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.pointerId !== e.pointerId) return;
    e.preventDefault();
    this.updateFromEvent(e);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.pointerId !== e.pointerId) return;
    e.preventDefault();
    this.pointerId = null;
    this.base.classList.remove('tc-stick-active');
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.input.setStick(this.player, 0, 0);
  }

  private updateFromEvent(e: PointerEvent): void {
    const rect = this.base.getBoundingClientRect();
    this.radius = rect.width / 2;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > this.radius) {
      dx = (dx / dist) * this.radius;
      dy = (dy / dist) * this.radius;
    }

    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // 画面上方向(dy が負)= forward +。dx 正 = strafe +。
    const forward = this.radius > 0 ? -dy / this.radius : 0;
    const strafe = this.radius > 0 ? dx / this.radius : 0;
    this.input.setStick(this.player, forward, strafe);
  }
}

/**
 * 画面上の操作 UI。左半分=バーチャルスティック(P1)、右半分=アクションボタン(P1)。
 * `setTwoPlayer(true)` で、対面プレイ用に P2 用のスティック+ボタンを画面反対側に表示する
 * (上側を180°反転したレイアウト)。
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private p1Stick: VirtualStick;
  private p2Stick: VirtualStick;
  private p2Cluster: HTMLDivElement;

  constructor(
    private input: InputManager,
    container: HTMLElement = document.body
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';

    const menuRow = this.buildCluster(MENU_BUTTONS, 'tc-menu-row');

    // --- P1(1P側、画面下): 左=スティック、右=アクションボタン ---
    const p1Layer = document.createElement('div');
    p1Layer.className = 'tc-layer tc-p1-layer';
    this.p1Stick = new VirtualStick(this.input, 0, 'tc-p1-stick');
    const p1Actions = this.buildCluster(P1_ACTION_BUTTONS, 'tc-actions tc-p1-actions');
    p1Layer.appendChild(this.p1Stick.root);
    p1Layer.appendChild(p1Actions);

    // --- P2(対面プレイ、画面上): 180°反転配置。右=スティック、左=アクションボタン ---
    this.p2Cluster = document.createElement('div');
    this.p2Cluster.className = 'tc-layer tc-p2-layer tc-hidden';
    this.p2Stick = new VirtualStick(this.input, 1, 'tc-p2-stick');
    const p2Actions = this.buildCluster(P2_ACTION_BUTTONS, 'tc-actions tc-p2-actions');
    this.p2Cluster.appendChild(this.p2Stick.root);
    this.p2Cluster.appendChild(p2Actions);

    this.root.appendChild(menuRow);
    this.root.appendChild(p1Layer);
    this.root.appendChild(this.p2Cluster);

    if (isTouchDevice()) {
      this.root.classList.add('tc-visible');
    }

    container.appendChild(this.root);
  }

  /**
   * VS PLAYER (2P) モードかどうかに応じて P2 クラスタの表示を切り替える。
   * 無効化時は P2 のスティック/ボタンをニュートラルに戻す。
   */
  setTwoPlayer(enabled: boolean): void {
    this.p2Cluster.classList.toggle('tc-hidden', !enabled);
    if (!enabled) {
      this.input.setStick(1, 0, 0);
      for (const spec of P2_ACTION_BUTTONS) {
        this.input.releaseVirtual(spec.key);
      }
    }
  }

  private buildCluster(buttons: ButtonSpec[], className: string): HTMLDivElement {
    const cluster = document.createElement('div');
    cluster.className = className;

    for (const spec of buttons) {
      cluster.appendChild(this.buildButton(spec));
    }

    return cluster;
  }

  private buildButton(spec: ButtonSpec): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tc-btn ${spec.className}`;
    btn.textContent = spec.label;
    btn.style.touchAction = 'none';

    const press = (e: PointerEvent): void => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('tc-active');
      this.input.pressVirtual(spec.key);
      // メニュー操作(対戦切替・難易度・リスタートなど)はタップの瞬間だけ
      // 反応させたいので、押した直後に解放しておく(justPressed には残る)。
      if (spec.momentary) {
        this.input.releaseVirtual(spec.key);
      }
    };

    const release = (e: PointerEvent): void => {
      e.preventDefault();
      btn.classList.remove('tc-active');
      if (!spec.momentary) {
        this.input.releaseVirtual(spec.key);
      }
    };

    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());

    return btn;
  }
}
