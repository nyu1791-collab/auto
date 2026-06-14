/**
 * 演出専用のパーティクルシステム(描画レイヤー)。
 *
 * `Math.random` を使用するが、これは純粋に視覚効果のためであり、
 * ゲームロジック(`src/engine/**`, `src/sim/**`)からは絶対に import しないこと。
 * `update`/`draw` の結果はエンジンの状態やシミュレーション結果に影響しない。
 */

/** 個々のパーティクルの状態 */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 残り寿命(ms) */
  life: number;
  /** 初期寿命(ms)。alpha 計算に使う */
  maxLife: number;
  size: number;
  color: string;
  /** 重力加速度(px/ms^2 相当) */
  gravity: number;
}

/** 同時に保持できるパーティクル数の上限 */
const MAX_PARTICLES = 400;

/** 命中時の火花・ジャスト回避のバースト・回避時の砂塵などを管理する */
export class ParticleSystem {
  private particles: Particle[] = [];

  /** 被弾位置に飛び散る火花(ヒット時) */
  sparks(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.08 + Math.random() * 0.25;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.05,
        life: 250 + Math.random() * 200,
        maxLife: 450,
        size: 2 + Math.random() * 3,
        color,
        gravity: 0.0006,
      });
    }
  }

  /** ジャスト回避成立時の放射状バースト */
  burst(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 0.15 + Math.random() * 0.3;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 350 + Math.random() * 250,
        maxLife: 600,
        size: 2 + Math.random() * 4,
        color,
        gravity: 0,
      });
    }
  }

  /** ジャンプ着地時、足元から左右に広がる砂塵 */
  landingDust(x: number, y: number): void {
    const count = 10;
    for (let i = 0; i < count; i++) {
      const speed = 0.04 + Math.random() * 0.1;
      this.spawn({
        x,
        y,
        vx: (Math.random() * 2 - 1) * speed,
        vy: -(0.03 + Math.random() * 0.05),
        life: 220 + Math.random() * 180,
        maxLife: 400,
        size: 2 + Math.random() * 3,
        color: 'rgba(200,200,200,0.9)',
        gravity: 0.0004,
      });
    }
  }

  /** 回避時に発生する方向への砂塵 */
  dust(x: number, y: number, dir: 1 | -1): void {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const angle = Math.PI + (Math.random() - 0.5) * 1.2; // 後方寄りに広がる
      const speed = 0.05 + Math.random() * 0.12;
      this.spawn({
        x,
        y,
        vx: -dir * Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.3 - 0.02,
        life: 200 + Math.random() * 150,
        maxLife: 350,
        size: 2 + Math.random() * 3,
        color: 'rgba(220,220,220,1)',
        gravity: 0.0003,
      });
    }
  }

  private spawn(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push(p);
  }

  /** dtMs: 直前フレームからの経過時間(ms) */
  update(dtMs: number): void {
    const dt = Math.max(0, dtMs);
    const next: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      next.push(p);
    }
    this.particles = next;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
