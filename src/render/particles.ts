/**
 * 演出専用の 3D パーティクルシステム(描画レイヤー)。
 *
 * `THREE.Points` を使い、ワールド座標(x, y, z)上に火花・バースト・砂塵などを
 * 発生させる。`Math.random` を使用するが、これは純粋に視覚効果のためであり、
 * ゲームロジック(`src/engine/**`, `src/sim/**`)からは絶対に import しないこと。
 * `update`/`object3D` の結果はエンジンの状態やシミュレーション結果に影響しない。
 */

import * as THREE from 'three';

/** 個々のパーティクルの状態 */
interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 残り寿命(ms) */
  life: number;
  /** 初期寿命(ms)。alpha 計算に使う */
  maxLife: number;
  size: number;
  color: THREE.Color;
  /** 重力加速度(ワールド単位/ms^2 相当) */
  gravity: number;
}

/** 同時に保持できるパーティクル数の上限 */
const MAX_PARTICLES = 600;

/**
 * 命中時の火花・ジャスト回避のバースト・回避時の砂塵などを管理する 3D パーティクルシステム。
 * `object3D` を `THREE.Scene` に追加することでレンダラーに統合できる。
 */
export class ParticleSystem {
  /** シーンに追加する Points オブジェクト */
  readonly object3D: THREE.Points;

  private particles: Particle[] = [];
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setDrawRange(0, 0);

    const material = new THREE.PointsMaterial({
      size: 6,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });

    this.object3D = new THREE.Points(this.geometry, material);
    this.object3D.frustumCulled = false;
  }

  /** 被弾位置に飛び散る火花(ヒット時)。(x, y, z) はワールド座標 */
  sparks(x: number, y: number, z: number, color: THREE.ColorRepresentation, count: number): void {
    const col = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const elevation = Math.random() * Math.PI * 0.5;
      const speed = (0.08 + Math.random() * 0.25) * 60;
      this.spawn({
        x,
        y: y + 4,
        z,
        vx: Math.cos(angle) * Math.cos(elevation) * speed,
        vy: Math.sin(elevation) * speed + 20,
        vz: Math.sin(angle) * Math.cos(elevation) * speed,
        life: 250 + Math.random() * 200,
        maxLife: 450,
        size: 4 + Math.random() * 5,
        color: col,
        gravity: 0.00045 * 60 * 60,
      });
    }
  }

  /** ジャスト回避成立時の放射状バースト。(x, y, z) はワールド座標 */
  burst(x: number, y: number, z: number, color: THREE.ColorRepresentation, count: number): void {
    const col = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const elevation = (Math.random() - 0.5) * Math.PI * 0.6;
      const speed = (0.15 + Math.random() * 0.3) * 60;
      this.spawn({
        x,
        y: y + 10,
        z,
        vx: Math.cos(angle) * Math.cos(elevation) * speed,
        vy: Math.sin(elevation) * speed * 0.6 + 10,
        vz: Math.sin(angle) * Math.cos(elevation) * speed,
        life: 350 + Math.random() * 250,
        maxLife: 600,
        size: 5 + Math.random() * 6,
        color: col,
        gravity: 0,
      });
    }
  }

  /**
   * 回避時に発生する方向への砂塵。`dirX, dirZ` はダッシュ方向(単位ベクトル)で、
   * 砂塵はその逆方向(後方)へ広がる。
   */
  dust(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    const count = 14;
    const baseAngle = Math.atan2(-dirZ, -dirX); // 後方
    const col = new THREE.Color(0xdcdcdc);
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (Math.random() - 0.5) * 1.4;
      const speed = (0.05 + Math.random() * 0.12) * 60;
      this.spawn({
        x,
        y: y + 1,
        z,
        vx: Math.cos(angle) * speed,
        vy: Math.random() * 8,
        vz: Math.sin(angle) * speed,
        life: 200 + Math.random() * 150,
        maxLife: 350,
        size: 3 + Math.random() * 4,
        color: col,
        gravity: 0.00025 * 60 * 60,
      });
    }
  }

  private spawn(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) {
      this.particles.shift();
    }
    this.particles.push(p);
  }

  /** dtMs: 直前フレームからの経過時間(ms) */
  update(dtMs: number): void {
    const dt = Math.max(0, dtMs);
    const dtSec = dt / 1000;
    const next: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dtSec;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.z += p.vz * dtSec;
      next.push(p);
    }
    this.particles = next;

    const count = Math.min(this.particles.length, MAX_PARTICLES);
    for (let i = 0; i < count; i++) {
      const p = this.particles[i];
      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));

      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = Math.max(0, p.y);
      this.positions[i * 3 + 2] = p.z;

      this.colors[i * 3] = p.color.r;
      this.colors[i * 3 + 1] = p.color.g;
      this.colors[i * 3 + 2] = p.color.b;

      this.sizes[i] = p.size * alpha;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    this.geometry.setDrawRange(0, count);

    // alpha はパーティクルごとに変えられないため、マテリアル全体の opacity は
    // 最も新しいパーティクルの寿命に応じてゆるく調整する(完全な透明制御ではないが、
    // バースト全体がふっと消える質感を出すには十分)。
    const material = this.object3D.material as THREE.PointsMaterial;
    if (count > 0) {
      const newest = this.particles[count - 1];
      material.opacity = Math.max(0.15, Math.min(1, newest.life / newest.maxLife));
    } else {
      material.opacity = 1;
    }
  }
}
