/**
 * HTML オーバーレイ HUD(HP/スタミナバー・WINS ピップ・中央メッセージ・JUST!ポップ・
 * モード表示)。`index.html` 側に配置された要素を、毎フレーム `update()` で
 * 更新する。
 *
 * DOM API に依存するため、`src/engine/**` や `src/sim/**` からは
 * 絶対に import しないこと。
 */

import { MATCH, PLAYER } from '../engine/constants';
import type { GameState } from '../engine/types';
import type { RenderEffects } from './renderer';

/** HP バーの表示値が実値に追従する速度(1 フレームあたりの割合) */
const HP_LERP_RATE = 0.12;
/** チップダメージ表示が消えるまでの時間(ms) */
const CHIP_DECAY_MS = 600;

interface PlayerHudElements {
  hpFill: HTMLElement;
  hpChip: HTMLElement;
  staminaFill: HTMLElement;
  wins: HTMLElement[];
}

export class Hud {
  private players: [PlayerHudElements, PlayerHudElements];
  private message: HTMLElement;
  private justText: HTMLElement;
  private modeLabel: HTMLElement;

  /** HUD の HP バーが実値へ滑らかに追従するための表示用 HP(プレイヤーごと) */
  private displayedHp: [number, number] = [PLAYER.maxHp, PLAYER.maxHp];
  /** 「チップダメージ」表示(直前の減少分)の残り時間(ms)。プレイヤーごと */
  private chipRemaining: [number, number] = [0, 0];

  constructor(root: HTMLElement) {
    this.players = [this.queryPlayer(root, 0), this.queryPlayer(root, 1)];
    this.message = this.query(root, '#hud-message');
    this.justText = this.query(root, '#hud-just');
    this.modeLabel = this.query(root, '#hud-mode');
  }

  private query(root: HTMLElement, selector: string): HTMLElement {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`HUD element not found: ${selector}`);
    return el;
  }

  private queryPlayer(root: HTMLElement, i: 0 | 1): PlayerHudElements {
    const hpFill = this.query(root, `#hud-p${i}-hp`);
    const hpChip = this.query(root, `#hud-p${i}-hp-chip`);
    const staminaFill = this.query(root, `#hud-p${i}-stamina`);
    const winsContainer = this.query(root, `#hud-p${i}-wins`);
    const wins = Array.from(winsContainer.querySelectorAll<HTMLElement>('.hud-pip'));
    return { hpFill, hpChip, staminaFill, wins };
  }

  /** 毎フレーム呼び出し、HP/スタミナ/WINS/メッセージ/JUST/モード表示を更新する */
  update(state: GameState, effects: RenderEffects, dtMs: number): void {
    this.updateBars(state, dtMs);
    this.updateMessage(state);
    this.updateJustText(effects.justTextAlpha);
    this.updateModeLabel(effects.modeLabel);
  }

  private updateBars(state: GameState, dtMs: number): void {
    const frames = Math.max(1, dtMs / 16.7);

    for (let i = 0; i < 2; i++) {
      const p = state.players[i];
      const el = this.players[i];
      const real = Math.max(0, p.hp);
      const prevDisplayed = this.displayedHp[i];

      if (real < prevDisplayed - 0.01) {
        this.chipRemaining[i] = CHIP_DECAY_MS;
      }

      const rate = Math.min(1, HP_LERP_RATE * frames);
      this.displayedHp[i] = prevDisplayed + (real - prevDisplayed) * rate;
      if (Math.abs(this.displayedHp[i] - real) < 0.05) this.displayedHp[i] = real;

      if (this.chipRemaining[i] > 0) {
        this.chipRemaining[i] = Math.max(0, this.chipRemaining[i] - dtMs);
      }

      const hpPct = (real / PLAYER.maxHp) * 100;
      const displayedPct = (this.displayedHp[i] / PLAYER.maxHp) * 100;

      el.hpFill.style.width = `${displayedPct}%`;

      if (this.chipRemaining[i] > 0 && displayedPct > hpPct) {
        const chipAlpha = this.chipRemaining[i] / CHIP_DECAY_MS;
        el.hpChip.style.width = `${displayedPct}%`;
        el.hpChip.style.opacity = String(0.6 * chipAlpha);
      } else {
        el.hpChip.style.opacity = '0';
      }

      el.staminaFill.style.width = `${(p.stamina / PLAYER.maxStamina) * 100}%`;

      for (let pip = 0; pip < el.wins.length; pip++) {
        el.wins[pip].classList.toggle('hud-pip-filled', pip < p.roundsWon);
      }
    }
  }

  private updateMessage(state: GameState): void {
    this.message.classList.remove('hud-message-fight', 'hud-message-ready', 'hud-message-result');

    if (state.phase === 'fighting') {
      this.message.textContent = '';
      this.message.style.opacity = '0';
      return;
    }

    if (state.phase === 'starting') {
      const isFight = state.phaseTimer <= MATCH.startCountdownTicks / 3;
      this.message.style.opacity = '1';
      if (isFight) {
        this.message.textContent = 'FIGHT!';
        this.message.classList.add('hud-message-fight');
      } else {
        this.message.textContent = 'READY...';
        this.message.classList.add('hud-message-ready');
      }
      return;
    }

    // roundOver / matchOver
    const elapsed = MATCH.roundEndFreezeTicks - state.phaseTimer;
    const alpha = Math.min(1, elapsed / 12);
    this.message.style.opacity = String(alpha);
    this.message.classList.add('hud-message-result');

    const isMatchOver = state.phase === 'matchOver';
    if (isMatchOver) {
      const winner = (state.winner ?? 0) + 1;
      this.message.innerHTML = `PLAYER ${winner} WINS THE MATCH<br><span class="hud-restart-hint">PRESS ENTER TO RESTART</span>`;
    } else if (state.winner === null) {
      this.message.textContent = 'DRAW ROUND';
    } else {
      this.message.textContent = `PLAYER ${state.winner + 1} WINS THE ROUND`;
    }
  }

  private updateJustText(alpha?: number): void {
    if (!alpha || alpha <= 0) {
      this.justText.style.opacity = '0';
      return;
    }
    const a = Math.min(1, alpha);
    const scale = 1 + (1 - a) * 0.4;
    this.justText.style.opacity = String(a);
    this.justText.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  private updateModeLabel(label?: string): void {
    this.modeLabel.textContent = label ?? '';
  }
}
