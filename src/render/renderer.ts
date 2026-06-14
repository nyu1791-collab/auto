import { ARENA, ATTACKS, DODGE, MATCH, PLAYER } from '../engine/constants';
import type { GameState, PlayerState } from '../engine/types';

const COLORS = {
  p0: '#4da6ff',
  p1: '#ff5d5d',
  bg: '#15181d',
  ground: '#2a2f37',
  hpBack: '#3a3f47',
  staminaFill: '#f0c419',
  hitbox: 'rgba(255,255,255,0.2)',
  stunned: '#ffffff',
  telegraphLight: '255, 224, 102',
  telegraphHeavy: '255, 70, 60',
};

/**
 * main.ts のエフェクトレイヤーから渡される、tick 間の一時的な見た目情報。
 * エンジン状態には含まれない(エンジンの純粋性を保つ)。
 */
export interface RenderEffects {
  /** 画面シェイクのオフセット(px) */
  shakeX?: number;
  shakeY?: number;
  /** 全体フラッシュの強さ (0-1)。ジャスト回避時の白フラッシュなど */
  flashAlpha?: number;
  /** 「JUST!」テキストの表示強度 (0-1)。0 なら非表示 */
  justTextAlpha?: number;
  /** 現在のモード表示("VS CPU" / "VS PLAYER") */
  modeLabel?: string;
}

/** GameState を Canvas に描画する */
export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  render(state: GameState, effects: RenderEffects = {}): void {
    const { ctx, canvas } = this;

    ctx.save();
    ctx.translate(effects.shakeX ?? 0, effects.shakeY ?? 0);

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, ARENA.floorY + ARENA.playerSize, canvas.width, 4);

    for (const p of state.players) this.drawTelegraph(p);
    for (const p of state.players) this.drawAttackRange(p);
    for (const p of state.players) this.drawPlayer(p);
    this.drawHud(state);
    this.drawMessage(state);
    this.drawModeLabel(effects.modeLabel);
    this.drawJustText(effects.justTextAlpha);

    ctx.restore();

    this.drawFlash(effects.flashAlpha);
  }

  private drawPlayer(p: PlayerState): void {
    const { ctx } = this;
    ctx.globalAlpha = p.dodge && p.dodge.elapsed < DODGE.iframes ? 0.4 : 1;
    ctx.fillStyle = p.stunTicks > 0 ? COLORS.stunned : p.id === 0 ? COLORS.p0 : COLORS.p1;
    ctx.fillRect(p.x, ARENA.floorY, ARENA.playerSize, ARENA.playerSize);
    ctx.globalAlpha = 1;
  }

  /**
   * 攻撃の windup 中、発生(active)に近づくほど強く光るテレグラフを
   * 攻撃側の正面に表示する。強攻撃はより大きく・赤く危険に見せる。
   */
  private drawTelegraph(p: PlayerState): void {
    if (!p.attack) return;
    const spec = ATTACKS[p.attack.kind];
    if (p.attack.elapsed >= spec.windup) return; // active/recovery 中は通常の hitbox 表示に任せる

    const { ctx } = this;
    // 0 (windup開始) -> 1 (active直前) で強さが増す
    const progress = (p.attack.elapsed + 1) / spec.windup;
    const isHeavy = p.attack.kind === 'heavy';
    const color = isHeavy ? COLORS.telegraphHeavy : COLORS.telegraphLight;
    const maxWidth = isHeavy ? spec.range * 1.1 : spec.range * 0.85;
    const width = Math.max(6, maxWidth * progress);
    const alpha = 0.15 + 0.55 * progress;

    const cx = p.x + ARENA.playerSize / 2;
    const dir = p.facing;
    const x0 = dir > 0 ? cx : cx - width;

    ctx.fillStyle = `rgba(${color}, ${alpha.toFixed(2)})`;
    ctx.fillRect(x0, ARENA.floorY - 6, width, ARENA.playerSize + 12);

    // 発生間際は外枠を強調してさらに目立たせる
    if (progress > 0.7) {
      ctx.strokeStyle = `rgba(${color}, ${Math.min(1, alpha + 0.2).toFixed(2)})`;
      ctx.lineWidth = isHeavy ? 3 : 2;
      ctx.strokeRect(x0, ARENA.floorY - 6, width, ARENA.playerSize + 12);
    }
  }

  private drawAttackRange(p: PlayerState): void {
    if (!p.attack) return;
    const spec = ATTACKS[p.attack.kind];
    const active = p.attack.elapsed >= spec.windup && p.attack.elapsed < spec.windup + spec.active;
    if (!active) return;

    const { ctx } = this;
    const cx = p.x + ARENA.playerSize / 2;
    ctx.fillStyle = COLORS.hitbox;
    ctx.fillRect(cx - spec.range, ARENA.floorY - 10, spec.range * 2, ARENA.playerSize + 20);
  }

  private drawHud(state: GameState): void {
    const { ctx, canvas } = this;
    const margin = 16;
    const barWidth = canvas.width / 2 - margin * 2;

    state.players.forEach((p, i) => {
      const x = i === 0 ? margin : canvas.width - margin - barWidth;
      const color = i === 0 ? COLORS.p0 : COLORS.p1;

      ctx.fillStyle = COLORS.hpBack;
      ctx.fillRect(x, margin, barWidth, 18);
      const hpWidth = (Math.max(0, p.hp) / PLAYER.maxHp) * barWidth;
      ctx.fillStyle = color;
      ctx.fillRect(i === 0 ? x : x + barWidth - hpWidth, margin, hpWidth, 18);

      const sy = margin + 22;
      ctx.fillStyle = COLORS.hpBack;
      ctx.fillRect(x, sy, barWidth, 6);
      const stWidth = (p.stamina / PLAYER.maxStamina) * barWidth;
      ctx.fillStyle = COLORS.staminaFill;
      ctx.fillRect(i === 0 ? x : x + barWidth - stWidth, sy, stWidth, 6);

      ctx.fillStyle = '#e6e6e6';
      ctx.font = '12px system-ui';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillText(`WINS: ${p.roundsWon}`, i === 0 ? x : x + barWidth, sy + 22);
    });
  }

  private drawMessage(state: GameState): void {
    if (state.phase === 'fighting') return;

    const { ctx, canvas } = this;
    ctx.textAlign = 'center';

    if (state.phase === 'starting') {
      // 残り 1/3 を切ったら「FIGHT!」、それまでは「READY」
      const isFight = state.phaseTimer <= MATCH.startCountdownTicks / 3;
      ctx.fillStyle = isFight ? '#ffe066' : '#ffffff';
      ctx.font = 'bold 48px system-ui';
      ctx.fillText(isFight ? 'FIGHT!' : 'READY...', canvas.width / 2, canvas.height / 2);
      return;
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px system-ui';

    const text =
      state.phase === 'matchOver'
        ? `PLAYER ${(state.winner ?? 0) + 1} WINS THE MATCH`
        : state.winner === null
          ? 'DRAW ROUND'
          : `PLAYER ${state.winner + 1} WINS THE ROUND`;

    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    if (state.phase === 'matchOver') {
      ctx.font = '16px system-ui';
      ctx.fillStyle = '#8a93a0';
      ctx.fillText('PRESS ENTER TO RESTART', canvas.width / 2, canvas.height / 2 + 32);
    }
  }

  /** 現在の対戦モード(VS CPU / VS PLAYER)を右上に表示する */
  private drawModeLabel(label?: string): void {
    if (!label) return;
    const { ctx, canvas } = this;
    ctx.textAlign = 'right';
    ctx.font = '12px system-ui';
    ctx.fillStyle = '#8a93a0';
    ctx.fillText(label, canvas.width - 16, canvas.height - 12);
  }

  /** ジャスト回避時の「JUST!」テキスト */
  private drawJustText(alpha?: number): void {
    if (!alpha || alpha <= 0) return;
    const { ctx, canvas } = this;
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255, 224, 102, ${Math.min(1, alpha).toFixed(2)})`;
    ctx.font = 'bold 40px system-ui';
    ctx.fillText('JUST!', canvas.width / 2, canvas.height / 2 - 60);
  }

  /** ジャスト回避時などの全画面フラッシュ */
  private drawFlash(alpha?: number): void {
    if (!alpha || alpha <= 0) return;
    const { ctx, canvas } = this;
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha).toFixed(2)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}
