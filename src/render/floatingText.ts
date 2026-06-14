/**
 * 演出専用のフローティングテキスト(被弾ダメージ数値など)。描画レイヤー。
 *
 * ゲームロジック(`src/engine/**`, `src/sim/**`)からは絶対に import しないこと。
 * 視覚効果のみで、エンジンの状態・決定性には一切影響しない。
 */

interface FloatingText {
  x: number;
  y: number;
  /** 上昇速度(px/ms、上向きが負) */
  vy: number;
  /** 残り寿命(ms) */
  life: number;
  /** 初期寿命(ms)。alpha 計算に使う */
  maxLife: number;
  text: string;
  color: string;
  size: number;
}

/** 同時に保持できるテキスト数の上限 */
const MAX_TEXTS = 60;

export class FloatingTextSystem {
  private items: FloatingText[] = [];

  /** 指定位置にテキストをポップさせる(被弾位置にダメージ量を出すなど) */
  spawn(x: number, y: number, text: string, color: string, size = 18): void {
    if (this.items.length >= MAX_TEXTS) this.items.shift();
    this.items.push({ x, y, vy: -0.05, life: 700, maxLife: 700, text, color, size });
  }

  /** dtMs: 直前フレームからの経過時間(ms) */
  update(dtMs: number): void {
    const dt = Math.max(0, dtMs);
    const next: FloatingText[] = [];
    for (const t of this.items) {
      t.life -= dt;
      if (t.life <= 0) continue;
      t.y += t.vy * dt;
      t.vy += 0.00006 * dt; // ゆっくり減速して浮き上がりを止める
      next.push(t);
    }
    this.items = next;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.items) {
      const a = Math.max(0, Math.min(1, t.life / t.maxLife));
      const pop = a > 0.8 ? 1 + (a - 0.8) * 1.5 : 1; // 出現直後に少しだけ拡大
      ctx.globalAlpha = a;
      ctx.font = `bold ${(t.size * pop).toFixed(1)}px system-ui`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.fillStyle = t.color;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
