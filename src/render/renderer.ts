import { ARENA, ATTACKS, DODGE, MATCH, PLAYER } from '../engine/constants';
import type { GameState, PlayerState } from '../engine/types';

const COLORS = {
  p0: '#4da6ff',
  p0Dark: '#1f5c99',
  p0Light: '#a8d4ff',
  p1: '#ff5d5d',
  p1Dark: '#992f2f',
  p1Light: '#ffc2c2',
  bgTop: '#1c2230',
  bgBottom: '#0c0e13',
  ground: '#2a2f37',
  groundLine: '#3a4250',
  hpBack: '#3a3f47',
  hpChip: '#ffd2a0',
  staminaBack: '#3a3f47',
  staminaFill: '#f0c419',
  hitbox: 'rgba(255,255,255,0.2)',
  stunned: '#ffffff',
  telegraphLight: '255, 224, 102',
  telegraphHeavy: '255, 70, 60',
  pipFill: '#ffe066',
  pipEmpty: 'rgba(255,255,255,0.15)',
};

/** HP バーの表示値が実値に追従する速度(1 フレームあたりの割合) */
const HP_LERP_RATE = 0.12;
/** チップダメージ表示が消えるまでの時間(ms) */
const CHIP_DECAY_MS = 600;

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
  /**
   * ワールド座標系(シェイク変換の内側)に追加描画するためのフック。
   * 攻撃判定やテレグラフより後、HUD より前に呼び出される
   * (パーティクルなどを画面シェイクと一致させつつ、キャラクターより前面に出すため)。
   */
  worldOverlay?: (ctx: CanvasRenderingContext2D) => void;
}

/** GameState を Canvas に描画する */
export class Renderer {
  private ctx: CanvasRenderingContext2D;

  /** HUD の HP バーが実値へ滑らかに追従するための表示用 HP(プレイヤーごと) */
  private displayedHp: [number, number] = [PLAYER.maxHp, PLAYER.maxHp];
  /** 「チップダメージ」表示(直前の減少分)の残り時間(ms)。プレイヤーごと */
  private chipRemaining: [number, number] = [0, 0];
  /** 背景の微妙なアニメーション用の時間累積(ms)。描画のみに使用、ロジックには影響しない */
  private time = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  render(state: GameState, effects: RenderEffects = {}, dtMs = 16.7): void {
    const { ctx } = this;

    this.time += dtMs;
    this.updateHpDisplay(state, dtMs);

    ctx.save();
    ctx.translate(effects.shakeX ?? 0, effects.shakeY ?? 0);

    this.drawBackground();

    for (const p of state.players) this.drawShadow(p);
    for (const p of state.players) this.drawDodgeAfterimage(p);
    for (const p of state.players) this.drawTelegraph(p);
    for (const p of state.players) this.drawAttackRange(p);
    for (const p of state.players) this.drawPlayer(p);

    effects.worldOverlay?.(ctx);

    this.drawHud(state);
    this.drawMessage(state);
    this.drawModeLabel(effects.modeLabel);
    this.drawJustText(effects.justTextAlpha);

    ctx.restore();

    this.drawFlash(effects.flashAlpha);
  }

  /** displayedHp / chipDamage を実値に向けて滑らかに更新する(描画専用の状態) */
  private updateHpDisplay(state: GameState, dtMs: number): void {
    const frames = Math.max(1, dtMs / 16.7);
    for (let i = 0; i < 2; i++) {
      const real = Math.max(0, state.players[i].hp);
      const prevDisplayed = this.displayedHp[i];

      if (real < prevDisplayed - 0.01) {
        // ダメージを受けた分を「チップダメージ」として一時的に表示する
        this.chipRemaining[i] = CHIP_DECAY_MS;
      }

      const rate = Math.min(1, HP_LERP_RATE * frames);
      this.displayedHp[i] = prevDisplayed + (real - prevDisplayed) * rate;
      if (Math.abs(this.displayedHp[i] - real) < 0.05) this.displayedHp[i] = real;

      if (this.chipRemaining[i] > 0) {
        this.chipRemaining[i] = Math.max(0, this.chipRemaining[i] - dtMs);
      }
    }
  }

  /** 背景: グラデーション + 微妙な地平線のアニメーション + 床 */
  private drawBackground(): void {
    const { ctx, canvas } = this;

    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, COLORS.bgTop);
    bg.addColorStop(1, COLORS.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ごく緩やかに明滅する地平線(ロジックに影響しない演出のみ)
    const pulse = 0.5 + 0.5 * Math.sin(this.time / 4000);
    ctx.fillStyle = `rgba(255,255,255,${(0.02 + pulse * 0.015).toFixed(3)})`;
    ctx.fillRect(0, ARENA.floorY - 2, canvas.width, 1);

    // 床
    const floorY = ARENA.floorY + ARENA.playerSize;
    const ground = ctx.createLinearGradient(0, floorY, 0, canvas.height);
    ground.addColorStop(0, COLORS.ground);
    ground.addColorStop(1, COLORS.bgBottom);
    ctx.fillStyle = ground;
    ctx.fillRect(0, floorY, canvas.width, canvas.height - floorY);

    ctx.fillStyle = COLORS.groundLine;
    ctx.fillRect(0, floorY, canvas.width, 2);
  }

  /** 各ファイターの足元に柔らかい影を描く */
  private drawShadow(p: PlayerState): void {
    const { ctx } = this;
    const cx = p.x + ARENA.playerSize / 2;
    const cy = ARENA.floorY + ARENA.playerSize + 4;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, ARENA.playerSize * 0.55, 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.restore();
  }

  /**
   * 回避の i-frame 中、進行方向の逆側(facing の反対側)に半透明の
   * アフターイメージ(残像)を数枚描いて、ダッシュの軌跡感を出す。
   */
  private drawDodgeAfterimage(p: PlayerState): void {
    if (!p.dodge || p.dodge.elapsed >= DODGE.iframes) return;

    const { ctx } = this;
    const baseColor = p.id === 0 ? COLORS.p0 : COLORS.p1;
    const trailDir = p.facing; // i-frame 中は facing の逆方向へ移動するため、残像は facing 側に伸ばす

    const ghostCount = 3;
    for (let i = 1; i <= ghostCount; i++) {
      const offset = trailDir * i * (ARENA.playerSize * 0.28);
      const alpha = 0.16 * (1 - i / (ghostCount + 1));
      ctx.save();
      ctx.globalAlpha = alpha;
      this.drawRoundedRect(
        p.x + offset,
        ARENA.floorY,
        ARENA.playerSize,
        ARENA.playerSize,
        8,
        baseColor
      );
      ctx.restore();
    }
  }

  private drawPlayer(p: PlayerState): void {
    const { ctx } = this;
    const isStunned = p.stunTicks > 0;
    const isAttacking = p.attack !== null && p.attack.elapsed >= ATTACKS[p.attack.kind].windup;
    const isIframe = p.dodge !== null && p.dodge.elapsed < DODGE.iframes;

    ctx.save();
    ctx.globalAlpha = isIframe ? 0.45 : 1;

    const x = p.x;
    const y = ARENA.floorY;
    const size = ARENA.playerSize;
    const dark = p.id === 0 ? COLORS.p0Dark : COLORS.p1Dark;
    const main = isStunned ? COLORS.stunned : p.id === 0 ? COLORS.p0 : COLORS.p1;
    const light = p.id === 0 ? COLORS.p0Light : COLORS.p1Light;

    // 攻撃中 / 被スタン中はグロー(外側の光彩)を描く
    if (isAttacking || isStunned) {
      const glowColor = isStunned
        ? 'rgba(255,255,255,0.55)'
        : p.id === 0
          ? 'rgba(77,166,255,0.5)'
          : 'rgba(255,93,93,0.5)';
      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = isStunned ? 18 : 14;
      this.drawRoundedRect(x, y, size, size, 8, main);
      ctx.restore();
    }

    // ボディ: 縦方向グラデーションの角丸矩形
    const grad = ctx.createLinearGradient(x, y, x, y + size);
    grad.addColorStop(0, light);
    grad.addColorStop(0.45, main);
    grad.addColorStop(1, dark);
    this.drawRoundedRect(x, y, size, size, 8, grad);

    // 輪郭線
    ctx.strokeStyle = isStunned ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    this.roundedRectPath(x, y, size, size, 8);
    ctx.stroke();

    // 向いている方向を示す「目」マーク
    const eyeSize = size * 0.12;
    const eyeY = y + size * 0.3;
    const eyeX = p.facing > 0 ? x + size * 0.72 : x + size * 0.28 - eyeSize;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(eyeX, eyeY, eyeSize, eyeSize);

    ctx.restore();
  }

  /** 角丸矩形のパスを構築する(描画はしない) */
  private roundedRectPath(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 角丸矩形を塗りで描画する */
  private drawRoundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: string | CanvasGradient
  ): void {
    const { ctx } = this;
    this.roundedRectPath(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
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

    const grad = ctx.createLinearGradient(x0, 0, dir > 0 ? x0 + width : x0, 0);
    if (dir > 0) {
      grad.addColorStop(0, `rgba(${color}, ${(alpha * 0.4).toFixed(2)})`);
      grad.addColorStop(1, `rgba(${color}, ${alpha.toFixed(2)})`);
    } else {
      grad.addColorStop(0, `rgba(${color}, ${alpha.toFixed(2)})`);
      grad.addColorStop(1, `rgba(${color}, ${(alpha * 0.4).toFixed(2)})`);
    }

    ctx.fillStyle = grad;
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
      const barHeight = 16;
      const radius = 4;

      // --- HP バー ---
      this.drawRoundedRect(x, margin, barWidth, barHeight, radius, COLORS.hpBack);

      const realHpWidth = (Math.max(0, p.hp) / PLAYER.maxHp) * barWidth;
      const displayedHpWidth = (this.displayedHp[i] / PLAYER.maxHp) * barWidth;

      // チップダメージ(直前に失った分): 実値より薄い色で残し、フェードアウトする
      if (this.chipRemaining[i] > 0 && displayedHpWidth > realHpWidth) {
        const chipAlpha = this.chipRemaining[i] / CHIP_DECAY_MS;
        ctx.save();
        ctx.globalAlpha = 0.6 * chipAlpha;
        const chipX = i === 0 ? x : x + barWidth - displayedHpWidth;
        this.drawRoundedRect(chipX, margin, displayedHpWidth, barHeight, radius, COLORS.hpChip);
        ctx.restore();
      }

      // 現在の HP(滑らかに追従する displayed 値を使用)
      const hpWidth = Math.min(displayedHpWidth, barWidth);
      if (hpWidth > 0) {
        const grad = ctx.createLinearGradient(x, margin, x, margin + barHeight);
        grad.addColorStop(0, this.lighten(color));
        grad.addColorStop(1, color);
        this.drawRoundedRect(
          i === 0 ? x : x + barWidth - hpWidth,
          margin,
          hpWidth,
          barHeight,
          radius,
          grad
        );
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      this.roundedRectPath(x, margin, barWidth, barHeight, radius);
      ctx.stroke();

      // --- スタミナバー ---
      const sy = margin + barHeight + 6;
      this.drawRoundedRect(x, sy, barWidth, 7, 3, COLORS.staminaBack);
      const stWidth = (p.stamina / PLAYER.maxStamina) * barWidth;
      if (stWidth > 0) {
        this.drawRoundedRect(
          i === 0 ? x : x + barWidth - stWidth,
          sy,
          stWidth,
          7,
          3,
          COLORS.staminaFill
        );
      }

      // --- WINS ピップ ---
      const pipY = sy + 18;
      const pipRadius = 5;
      const pipGap = 14;
      ctx.font = '11px system-ui';
      ctx.fillStyle = '#8a93a0';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      const label = 'WINS';
      ctx.fillText(label, i === 0 ? x : x + barWidth, pipY);
      const labelWidth = ctx.measureText(label).width;

      for (let pip = 0; pip < MATCH.roundsToWin; pip++) {
        const cx =
          i === 0
            ? x + labelWidth + 12 + pip * pipGap + pipRadius
            : x + barWidth - labelWidth - 12 - pip * pipGap - pipRadius;
        ctx.beginPath();
        ctx.arc(cx, pipY, pipRadius, 0, Math.PI * 2);
        ctx.fillStyle = pip < p.roundsWon ? COLORS.pipFill : COLORS.pipEmpty;
        ctx.fill();
        if (pip < p.roundsWon) {
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.textBaseline = 'alphabetic';
    });
  }

  /** 16進カラーをやや明るくする(HP バーのグラデーション用) */
  private lighten(hex: string): string {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return hex;
    const [r, g, b] = [m[1], m[2], m[3]].map((c) => Math.min(255, parseInt(c, 16) + 60));
    return `rgb(${r}, ${g}, ${b})`;
  }

  private drawMessage(state: GameState): void {
    if (state.phase === 'fighting') return;

    const { ctx, canvas } = this;
    ctx.textAlign = 'center';
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    if (state.phase === 'starting') {
      // 残り 1/3 を切ったら「FIGHT!」、それまでは「READY」
      const isFight = state.phaseTimer <= MATCH.startCountdownTicks / 3;

      if (isFight) {
        // FIGHT!: 出現直後にスケールが少し縮みながら馴染む簡易ポップ
        const elapsedInPhase = MATCH.startCountdownTicks / 3 - state.phaseTimer;
        const t = Math.min(1, elapsedInPhase / 10);
        const scale = 1.3 - 0.3 * t;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#ffe066';
        ctx.shadowColor = 'rgba(255,224,102,0.6)';
        ctx.shadowBlur = 18;
        ctx.font = 'bold 52px system-ui';
        ctx.fillText('FIGHT!', 0, 0);
        ctx.restore();
      } else {
        // READY...: 緩やかな点滅
        const pulse = 0.7 + 0.3 * Math.sin(this.time / 150);
        ctx.fillStyle = `rgba(255,255,255,${pulse.toFixed(2)})`;
        ctx.font = 'bold 44px system-ui';
        ctx.fillText('READY...', cx, cy);
      }
      return;
    }

    // roundOver / matchOver: フェードイン + わずかな拡大の演出
    const elapsed = MATCH.roundEndFreezeTicks - state.phaseTimer;
    const t = Math.min(1, elapsed / 12);
    const alpha = t;
    const scale = 0.85 + 0.15 * t;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    const isMatchOver = state.phase === 'matchOver';
    ctx.fillStyle = isMatchOver ? '#ffe066' : '#ffffff';
    ctx.font = `bold ${isMatchOver ? 32 : 28}px system-ui`;
    if (isMatchOver) {
      ctx.shadowColor = 'rgba(255,224,102,0.5)';
      ctx.shadowBlur = 16;
    }

    const text = isMatchOver
      ? `PLAYER ${(state.winner ?? 0) + 1} WINS THE MATCH`
      : state.winner === null
        ? 'DRAW ROUND'
        : `PLAYER ${state.winner + 1} WINS THE ROUND`;

    ctx.fillText(text, 0, 0);
    ctx.restore();

    if (isMatchOver) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '16px system-ui';
      ctx.fillStyle = '#8a93a0';
      ctx.fillText('PRESS ENTER TO RESTART', cx, cy + 32);
      ctx.restore();
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

  /** ジャスト回避時の「JUST!」テキスト。alpha に応じてポップするスケール演出付き */
  private drawJustText(alpha?: number): void {
    if (!alpha || alpha <= 0) return;
    const { ctx, canvas } = this;
    const a = Math.min(1, alpha);
    // alpha が高いほど(出現直後ほど)大きく表示し、収束させる
    const scale = 1 + (1 - a) * 0.4;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2 - 60);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255, 224, 102, ${a.toFixed(2)})`;
    ctx.shadowColor = `rgba(255, 224, 102, ${(a * 0.7).toFixed(2)})`;
    ctx.shadowBlur = 20;
    ctx.font = 'bold 40px system-ui';
    ctx.fillText('JUST!', 0, 0);
    ctx.restore();
  }

  /** ジャスト回避時などの全画面フラッシュ */
  private drawFlash(alpha?: number): void {
    if (!alpha || alpha <= 0) return;
    const { ctx, canvas } = this;
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha).toFixed(2)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}
