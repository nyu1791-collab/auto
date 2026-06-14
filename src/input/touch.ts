/**
 * タッチデバイス向けの画面操作 UI(フローティング・スティック + 大型ボタン)。
 *
 * - 画面の左側(P1)に触れると、その場所にアナログスティックが出現(フローティング)。
 *   指の移動量を画面ベクトルに変換し、`InputManager.setStick` に渡す。
 * - 右側に回避(大)/弱/強の大型ボタンを配置し、`pressVirtual`/`releaseVirtual` で
 *   仮想キーを注入する。スティックとボタンはマルチタッチで同時に押せる。
 * - 上部にメニュー(対戦切替/難易度/ミュート/リスタート)。
 * - VS PLAYER 時は対面プレイ用に P2 のスティック+ボタンを反対側(上・反転)に表示。
 *
 * PointerEvent / DOM に依存するため、`src/engine/**`・`src/sim/**` から import しないこと。
 */

import type { InputManager } from './input';

interface ButtonSpec {
  label: string;
  key: string;
  className: string;
  momentary?: boolean;
}

const P1_ACTION_BUTTONS: ButtonSpec[] = [
  { label: '弱', key: 'f', className: 'tc-light' },
  { label: '強', key: 'g', className: 'tc-heavy' },
  { label: '回避', key: 'shift', className: 'tc-dodge' },
];

const P2_ACTION_BUTTONS: ButtonSpec[] = [
  { label: '弱', key: 'k', className: 'tc-light' },
  { label: '強', key: 'l', className: 'tc-heavy' },
  { label: '回避', key: '/', className: 'tc-dodge' },
];

const MENU_BUTTONS: ButtonSpec[] = [
  { label: 'VS', key: 'c', className: 'tc-menu-mode', momentary: true },
  { label: 'LV', key: 'v', className: 'tc-menu-diff', momentary: true },
  { label: '🔊', key: 'm', className: 'tc-menu-mute', momentary: true },
  { label: '↻', key: 'enter', className: 'tc-menu-restart', momentary: true },
];

/** タッチ操作が可能な環境かどうかを判定する */
export function isTouchDevice(): boolean {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const hasTouch = 'ontouchstart' in window;
  return coarse || hasTouch;
}

/** スティックを掴むデッドゾーン(ベース半径に対する割合) */
const DEAD_ZONE = 0.12;
/** フローティングスティックの可動半径(px) */
const STICK_RADIUS = 56;

/**
 * フローティング・アナログスティック。指定された「ゾーン」要素内のどこに触れても、
 * その位置にベースを出現させ、指の移動量を画面ベクトルとして
 * `InputManager.setStick(player, screenX, screenY)` に渡す(screenX=右+, screenY=上+)。
 */
class FloatingStick {
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;

  constructor(
    private input: InputManager,
    private player: 0 | 1,
    private zone: HTMLDivElement
  ) {
    this.base = document.createElement('div');
    this.base.className = 'tc-stick-base';
    this.base.style.display = 'none';

    this.knob = document.createElement('div');
    this.knob.className = 'tc-stick-knob';
    this.base.appendChild(this.knob);
    this.zone.appendChild(this.base);

    this.zone.style.touchAction = 'none';
    this.zone.addEventListener('pointerdown', (e) => this.onDown(e));
    this.zone.addEventListener('pointermove', (e) => this.onMove(e));
    this.zone.addEventListener('pointerup', (e) => this.onUp(e));
    this.zone.addEventListener('pointercancel', (e) => this.onUp(e));
    this.zone.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onDown(e: PointerEvent): void {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.zone.setPointerCapture(e.pointerId);

    const rect = this.zone.getBoundingClientRect();
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.base.style.display = 'block';
    this.base.style.left = `${e.clientX - rect.left}px`;
    this.base.style.top = `${e.clientY - rect.top}px`;
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private onMove(e: PointerEvent): void {
    if (this.pointerId !== e.pointerId) return;
    e.preventDefault();

    let dx = e.clientX - this.originX;
    let dy = e.clientY - this.originY;
    const dist = Math.hypot(dx, dy);
    if (dist > STICK_RADIUS) {
      dx = (dx / dist) * STICK_RADIUS;
      dy = (dy / dist) * STICK_RADIUS;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    let sx = dx / STICK_RADIUS;
    let sy = -dy / STICK_RADIUS; // 画面上 = +(screenY)
    if (Math.hypot(sx, sy) < DEAD_ZONE) {
      sx = 0;
      sy = 0;
    }
    this.input.setStick(this.player, sx, sy);
  }

  private onUp(e: PointerEvent): void {
    if (this.pointerId !== e.pointerId) return;
    e.preventDefault();
    this.pointerId = null;
    this.base.style.display = 'none';
    this.input.setStick(this.player, 0, 0);
  }

  /** スティックを強制的にニュートラルへ戻す(モード切替時など) */
  reset(): void {
    this.pointerId = null;
    this.base.style.display = 'none';
    this.input.setStick(this.player, 0, 0);
  }
}

/** 画面上のタッチ操作 UI 全体 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private p2Stick: FloatingStick;
  private p2Group: HTMLDivElement;

  constructor(
    private input: InputManager,
    container: HTMLElement = document.body
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';

    // メニュー(上部中央)
    this.root.appendChild(this.buildCluster(MENU_BUTTONS, 'tc-menu-row'));

    // --- P1: 左にスティックゾーン、右にアクションボタン ---
    const p1StickZone = document.createElement('div');
    p1StickZone.className = 'tc-stick-zone tc-stick-zone-p1';
    this.root.appendChild(p1StickZone);
    new FloatingStick(this.input, 0, p1StickZone);
    this.root.appendChild(this.buildActions(P1_ACTION_BUTTONS, 'tc-actions tc-actions-p1'));

    // --- P2(対面プレイ用、上側・反転): 右にスティック、左にアクション ---
    this.p2Group = document.createElement('div');
    this.p2Group.className = 'tc-p2-group tc-hidden';
    const p2StickZone = document.createElement('div');
    p2StickZone.className = 'tc-stick-zone tc-stick-zone-p2';
    this.p2Group.appendChild(p2StickZone);
    this.p2Stick = new FloatingStick(this.input, 1, p2StickZone);
    this.p2Group.appendChild(this.buildActions(P2_ACTION_BUTTONS, 'tc-actions tc-actions-p2'));
    this.root.appendChild(this.p2Group);

    if (isTouchDevice()) {
      this.root.classList.add('tc-visible');
    }

    container.appendChild(this.root);
  }

  /** VS PLAYER(2P)モードに応じて P2 操作 UI の表示を切り替える */
  setTwoPlayer(enabled: boolean): void {
    this.p2Group.classList.toggle('tc-hidden', !enabled);
    if (!enabled) {
      this.p2Stick.reset();
      for (const spec of P2_ACTION_BUTTONS) this.input.releaseVirtual(spec.key);
    }
  }

  private buildCluster(buttons: ButtonSpec[], className: string): HTMLDivElement {
    const cluster = document.createElement('div');
    cluster.className = className;
    for (const spec of buttons) cluster.appendChild(this.buildButton(spec));
    return cluster;
  }

  private buildActions(buttons: ButtonSpec[], className: string): HTMLDivElement {
    return this.buildCluster(buttons, className);
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
      if (spec.momentary) this.input.releaseVirtual(spec.key);
    };
    const release = (e: PointerEvent): void => {
      e.preventDefault();
      btn.classList.remove('tc-active');
      if (!spec.momentary) this.input.releaseVirtual(spec.key);
    };

    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    return btn;
  }
}
