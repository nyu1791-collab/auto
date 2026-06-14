/**
 * タッチデバイス向けの画面操作 UI。
 *
 * Pointer Events を使い、DOM 上に配置したボタンを `InputManager.pressVirtual` /
 * `releaseVirtual` に直結する。キーボード入力と完全に同じ意味を持つ「仮想キー」
 * として扱われるため、エンジン側(`src/engine/**`, `src/sim/**`)には一切影響しない。
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

const P1_BUTTONS: ButtonSpec[] = [
  { label: '◀', key: 'a', className: 'tc-left' },
  { label: '▶', key: 'd', className: 'tc-right' },
  { label: '回避', key: 'w', className: 'tc-dodge' },
  { label: '弱', key: 'f', className: 'tc-light' },
  { label: '強', key: 'g', className: 'tc-heavy' },
];

const P2_BUTTONS: ButtonSpec[] = [
  { label: '◀', key: 'arrowleft', className: 'tc-left' },
  { label: '▶', key: 'arrowright', className: 'tc-right' },
  { label: '回避', key: 'arrowup', className: 'tc-dodge' },
  { label: '弱', key: 'k', className: 'tc-light' },
  { label: '強', key: 'l', className: 'tc-heavy' },
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
 * 画面上の操作ボタン群。P1 クラスタは常時表示、P2 クラスタは
 * `setTwoPlayer(true)` のときのみ表示する(タブレット対面プレイ用)。
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private p2Cluster: HTMLDivElement;

  constructor(
    private input: InputManager,
    container: HTMLElement = document.body
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';

    const menuRow = this.buildCluster(MENU_BUTTONS, 'tc-menu-row');
    const p1Cluster = this.buildCluster(P1_BUTTONS, 'tc-cluster tc-p1');
    this.p2Cluster = this.buildCluster(P2_BUTTONS, 'tc-cluster tc-p2');
    this.p2Cluster.classList.add('tc-hidden');

    this.root.appendChild(menuRow);
    this.root.appendChild(p1Cluster);
    this.root.appendChild(this.p2Cluster);

    if (isTouchDevice()) {
      this.root.classList.add('tc-visible');
    }

    container.appendChild(this.root);
  }

  /** VS PLAYER (2P) モードかどうかに応じて P2 クラスタの表示を切り替える */
  setTwoPlayer(enabled: boolean): void {
    this.p2Cluster.classList.toggle('tc-hidden', !enabled);
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
