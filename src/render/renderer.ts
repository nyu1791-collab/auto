/**
 * Three.js による 3D レンダラー。
 *
 * 円形アリーナ・ロックオンで向き合う2キャラクター・攻撃テレグラフ(扇形)を
 * パースペクティブカメラで描画する。HUD(HP/スタミナ/メッセージ等)は
 * `index.html` の HTML オーバーレイ側で更新する(本クラスは 3D シーンと
 * 全画面フラッシュのみを担当)。
 *
 * このモジュールは `THREE`/DOM に依存するため、`src/engine/**` や
 * `src/sim/**` からは絶対に import しないこと。
 */

import * as THREE from 'three';
import { ARENA, ATTACKS, DODGE } from '../engine/constants';
import type { GameState, PlayerState } from '../engine/types';
import type { ParticleSystem } from './particles';

const COLORS = {
  p0: 0x4da6ff,
  p0Glow: 0x4da6ff,
  p1: 0xff5d5d,
  p1Glow: 0xff5d5d,
  stunned: 0xffffff,
  arenaFloor: 0x2a2f37,
  arenaLine: 0x3a4250,
  arenaRing: 0x5a6478,
  telegraphLight: 0xffe066,
  telegraphHeavy: 0xff463c,
};

/**
 * main.ts のエフェクトレイヤーから渡される、tick 間の一時的な見た目情報。
 * エンジン状態には含まれない(エンジンの純粋性を保つ)。
 */
export interface RenderEffects {
  /** 画面シェイクのオフセット(ワールド単位) */
  shakeX?: number;
  shakeY?: number;
  /** 全体フラッシュの強さ (0-1)。ジャスト回避時の白フラッシュなど */
  flashAlpha?: number;
  /** 「JUST!」テキストの表示強度 (0-1)。0 なら非表示。HUD 側で使用する */
  justTextAlpha?: number;
  /** 現在のモード表示("VS CPU" / "VS PLAYER")。HUD 側で使用する */
  modeLabel?: string;
}

/** GameState を Three.js シーンに描画する */
export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private p0Group: THREE.Group;
  private p1Group: THREE.Group;
  private p0Body: THREE.Mesh;
  private p1Body: THREE.Mesh;
  private p0Visor: THREE.Mesh;
  private p1Visor: THREE.Mesh;
  private p0Glow: THREE.Mesh;
  private p1Glow: THREE.Mesh;
  private p0Afterimages: THREE.Mesh[] = [];
  private p1Afterimages: THREE.Mesh[] = [];

  private telegraphP0: THREE.Mesh;
  private telegraphP1: THREE.Mesh;

  private flashOverlay: HTMLDivElement;

  /** カメラの現在の注視点(滑らかに追従させるための内部状態) */
  private lookTarget = new THREE.Vector3(0, 0, 0);
  /** カメラの現在の距離(ズーム。滑らかに追従) */
  private camDistance = 520;

  /** 点滅(stun表現)用の時間累積(ms) */
  private time = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c0e13);
    this.scene.fog = new THREE.Fog(0x0c0e13, 500, 1400);

    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 4000);

    this.setupLights();
    this.buildArena();

    const p0 = this.buildCharacter(COLORS.p0, COLORS.p0Glow);
    const p1 = this.buildCharacter(COLORS.p1, COLORS.p1Glow);
    this.p0Group = p0.group;
    this.p1Group = p1.group;
    this.p0Body = p0.body;
    this.p1Body = p1.body;
    this.p0Visor = p0.visor;
    this.p1Visor = p1.visor;
    this.p0Glow = p0.glow;
    this.p1Glow = p1.glow;
    this.scene.add(this.p0Group, this.p1Group);

    this.telegraphP0 = this.buildTelegraph();
    this.telegraphP1 = this.buildTelegraph();
    this.scene.add(this.telegraphP0, this.telegraphP1);

    // 全画面フラッシュ用の HTML オーバーレイ(WebGL キャンバスの上に重ねる)
    this.flashOverlay = document.createElement('div');
    this.flashOverlay.style.position = 'absolute';
    this.flashOverlay.style.inset = '0';
    this.flashOverlay.style.background = '#ffffff';
    this.flashOverlay.style.opacity = '0';
    this.flashOverlay.style.pointerEvents = 'none';
    this.flashOverlay.style.zIndex = '5';
    canvas.parentElement?.appendChild(this.flashOverlay);

    this.handleResize();
  }

  /** パーティクルシステムをシーンに統合する */
  addParticles(particles: ParticleSystem): void {
    this.scene.add(particles.object3D);
  }

  /** キャンバスのリサイズに合わせてカメラの aspect を更新する */
  handleResize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    const width = Math.max(1, clientWidth);
    const height = Math.max(1, clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** 破棄。WebGL コンテキストとオーバーレイ要素を解放する */
  dispose(): void {
    this.renderer.dispose();
    this.flashOverlay.remove();
  }

  render(state: GameState, effects: RenderEffects = {}, dtMs = 16.7): void {
    this.time += dtMs;

    this.updateArenaPulse();
    this.updateCharacter(this.p0Group, this.p0Body, this.p0Visor, this.p0Glow, this.p0Afterimages, state.players[0], COLORS.p0);
    this.updateCharacter(this.p1Group, this.p1Body, this.p1Visor, this.p1Glow, this.p1Afterimages, state.players[1], COLORS.p1);
    this.updateTelegraphs(state.players[0], state.players[1]);

    this.updateCamera(state, effects);

    if (effects.flashAlpha !== undefined && effects.flashAlpha > 0) {
      this.flashOverlay.style.opacity = String(Math.min(1, effects.flashAlpha));
    } else {
      this.flashOverlay.style.opacity = '0';
    }

    this.renderer.render(this.scene, this.camera);
  }

  // --- ライティング ------------------------------------------------------

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0x8090a0, 0.7);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(180, 420, 240);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 1200;
    sun.shadow.camera.left = -ARENA.radius - 50;
    sun.shadow.camera.right = ARENA.radius + 50;
    sun.shadow.camera.top = ARENA.radius + 50;
    sun.shadow.camera.bottom = -ARENA.radius - 50;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x6688ff, 0.35);
    rim.position.set(-260, 180, -300);
    this.scene.add(rim);
  }

  // --- アリーナ ------------------------------------------------------------

  private arenaGroup = new THREE.Group();
  private ringMaterial!: THREE.LineBasicMaterial;

  private buildArena(): void {
    // 床(円形)
    const floorGeo = new THREE.CircleGeometry(ARENA.radius, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: COLORS.arenaFloor,
      roughness: 0.95,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.arenaGroup.add(floor);

    // 同心円のグリッドライン
    this.ringMaterial = new THREE.LineBasicMaterial({ color: COLORS.arenaLine, transparent: true, opacity: 0.5 });
    const ringCount = 4;
    for (let i = 1; i <= ringCount; i++) {
      const r = (ARENA.radius * i) / (ringCount + 1);
      this.arenaGroup.add(this.buildRing(r, this.ringMaterial));
    }

    // 放射状の仕切り線
    const spokeCount = 12;
    for (let i = 0; i < spokeCount; i++) {
      const angle = (i / spokeCount) * Math.PI * 2;
      const points = [
        new THREE.Vector3(0, 0.1, 0),
        new THREE.Vector3(Math.cos(angle) * ARENA.radius, 0.1, Math.sin(angle) * ARENA.radius),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      this.arenaGroup.add(new THREE.Line(geo, this.ringMaterial));
    }

    // 外周リング(発光)
    const outerRingGeo = new THREE.RingGeometry(ARENA.radius - 4, ARENA.radius + 4, 64);
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: COLORS.arenaRing,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = 0.2;
    this.arenaGroup.add(outerRing);

    // 背景に淡いグラデーション床(アリーナの外側)
    const bgFloorGeo = new THREE.CircleGeometry(2000, 48);
    const bgFloorMat = new THREE.MeshStandardMaterial({ color: 0x0c0e13, roughness: 1 });
    const bgFloor = new THREE.Mesh(bgFloorGeo, bgFloorMat);
    bgFloor.rotation.x = -Math.PI / 2;
    bgFloor.position.y = -1;
    this.arenaGroup.add(bgFloor);

    this.scene.add(this.arenaGroup);
  }

  private buildRing(radius: number, material: THREE.LineBasicMaterial): THREE.LineLoop {
    const segments = 64;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, 0.1, Math.sin(angle) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.LineLoop(geo, material);
  }

  /** アリーナのリング・グリッドをごく緩やかに明滅させる(演出のみ) */
  private updateArenaPulse(): void {
    const pulse = 0.4 + 0.15 * Math.sin(this.time / 1400);
    this.ringMaterial.opacity = pulse;
  }

  // --- キャラクター --------------------------------------------------------

  /**
   * カプセル状のボディ + 向きを示すバイザー(正面に取り付けた発光パネル)を持つ
   * キャラクターを構築する。`group` の回転で facing を表現する。
   */
  private buildCharacter(
    color: number,
    glowColor: number
  ): { group: THREE.Group; body: THREE.Mesh; visor: THREE.Mesh; glow: THREE.Mesh } {
    const group = new THREE.Group();

    const radius = ARENA.playerRadius;
    const height = radius * 2.4;

    const bodyGeo = new THREE.CapsuleGeometry(radius, height - radius * 2, 6, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.25 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // 正面を示すバイザー(発光パネル)。+x 方向(facing=0)を正面とする。
    const visorGeo = new THREE.BoxGeometry(radius * 0.9, radius * 0.7, radius * 0.35);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: glowColor,
      emissiveIntensity: 1.2,
      roughness: 0.3,
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(radius * 0.85, height * 0.62, 0);
    group.add(visor);

    // 攻撃中/被スタン中のグロー(外周にやや大きい半透明シェル)
    const glowGeo = new THREE.CapsuleGeometry(radius * 1.25, height - radius * 2, 6, 12);
    const glowMat = new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = height / 2;
    group.add(glow);

    return { group, body, visor, glow };
  }

  /**
   * キャラクターの位置・向き・状態表現(攻撃グロー/スタン点滅/回避半透明・残像)を更新する。
   */
  private updateCharacter(
    group: THREE.Group,
    body: THREE.Mesh,
    visor: THREE.Mesh,
    glow: THREE.Mesh,
    afterimages: THREE.Mesh[],
    p: PlayerState,
    color: number
  ): void {
    group.position.set(p.pos.x, 0, p.pos.z);
    // facing(ラジアン, atan2(dz,dx)) → three.js の Y 軸回転。
    // group の +x 方向(バイザーの向き)が facingVec=(cos,sin) と一致するように
    // Y 軸回転角を -facing とする(three.js の回転は右手系で Z 軸が画面奥)。
    group.rotation.y = -p.facing;

    const isStunned = p.stunTicks > 0;
    const isAttacking = p.attack !== null && p.attack.elapsed >= ATTACKS[p.attack.kind].windup;
    const isIframe = p.dodge !== null && p.dodge.elapsed < DODGE.iframes;

    // 回避中(全体)は半透明
    const bodyMat = body.material as THREE.MeshStandardMaterial;
    const visorMat = visor.material as THREE.MeshStandardMaterial;
    const baseOpacity = p.dodge !== null ? 0.45 : 1;
    bodyMat.transparent = baseOpacity < 1;
    bodyMat.opacity = baseOpacity;
    visorMat.transparent = baseOpacity < 1;
    visorMat.opacity = baseOpacity;

    // スタン中は点滅(白っぽく)
    if (isStunned) {
      const blink = Math.sin(this.time / 60) > 0;
      bodyMat.color.setHex(blink ? COLORS.stunned : color);
      bodyMat.emissive.setHex(blink ? 0x222222 : 0x000000);
    } else {
      bodyMat.color.setHex(color);
      bodyMat.emissive.setHex(0x000000);
    }

    // 攻撃中(active以降)はグローを表示
    const glowMat = glow.material as THREE.MeshBasicMaterial;
    if (isAttacking || isStunned) {
      glowMat.opacity = isStunned ? 0.35 + 0.2 * Math.sin(this.time / 60) : 0.35;
    } else {
      glowMat.opacity = 0;
    }

    // 回避 i-frame 中は進行方向の逆側へ半透明の残像を配置する
    this.updateAfterimages(group, afterimages, p, color, isIframe);
  }

  /** 回避ダッシュの軌跡を示す半透明の残像(クローン)を生成・更新する */
  private updateAfterimages(
    group: THREE.Group,
    afterimages: THREE.Mesh[],
    p: PlayerState,
    color: number,
    isIframe: boolean
  ): void {
    const ghostCount = 3;

    // 残像メッシュが未生成なら、本体ボディの形状を複製して作る
    if (afterimages.length === 0) {
      const radius = ARENA.playerRadius;
      const height = radius * 2.4;
      const geo = new THREE.CapsuleGeometry(radius, height - radius * 2, 6, 12);
      for (let i = 0; i < ghostCount; i++) {
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = height / 2;
        mesh.visible = false;
        this.scene.add(mesh);
        afterimages.push(mesh);
      }
    }

    if (!isIframe || !p.dodge) {
      for (const ghost of afterimages) ghost.visible = false;
      return;
    }

    const radius = ARENA.playerRadius;
    for (let i = 0; i < afterimages.length; i++) {
      const ghost = afterimages[i];
      const offset = (i + 1) * radius * 0.5;
      // 残像はダッシュ方向の逆(進行してきた軌跡側)に伸ばす
      ghost.position.x = group.position.x - p.dodge.dirX * offset;
      ghost.position.z = group.position.z - p.dodge.dirZ * offset;
      const mat = ghost.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.18 * (1 - i / (afterimages.length + 1));
      ghost.visible = true;
    }
  }

  // --- 攻撃テレグラフ -------------------------------------------------------

  /**
   * windup 中の攻撃者の足元に表示する半透明の扇形(ウェッジ)を構築する。
   * `aimAngle` を中心に `arcHalfAngle` の幅、`range` の長さを持つ扇形を
   * 地面に平らに描画する。
   */
  private buildTelegraph(): THREE.Mesh {
    const geo = new THREE.CircleGeometry(1, 24, 0, 0.01); // ダミー。update 時に都度再構築
    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.telegraphLight,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.3;
    mesh.visible = false;
    return mesh;
  }

  /** 両プレイヤーの攻撃テレグラフ(windup 中の扇形)を更新する */
  private updateTelegraphs(p0: PlayerState, p1: PlayerState): void {
    this.updateTelegraph(this.telegraphP0, p0);
    this.updateTelegraph(this.telegraphP1, p1);
  }

  /**
   * 指定プレイヤーの攻撃が windup 中であれば、テレグラフ(扇形)を
   * aimAngle ± arcHalfAngle, 半径 range で構築して表示する。
   * 弱攻撃=黄系、強攻撃=赤系。
   */
  private updateTelegraph(mesh: THREE.Mesh, p: PlayerState): void {
    if (!p.attack || p.attack.elapsed >= ATTACKS[p.attack.kind].windup) {
      mesh.visible = false;
      return;
    }

    const kind = p.attack.kind;
    const spec = ATTACKS[kind];
    const progress = (p.attack.elapsed + 1) / spec.windup;

    // 扇形ジオメトリを再構築(aimAngle ± arcHalfAngle, 半径 range)。
    // three.js の CircleGeometry の角度系は XY 平面基準だが、ここでは
    // 床に -90°回転させたメッシュのローカル X-Y が world X-Z に対応する。
    mesh.geometry.dispose();
    const thetaStart = p.attack.aimAngle - spec.arcHalfAngle;
    const thetaLength = spec.arcHalfAngle * 2;
    mesh.geometry = new THREE.CircleGeometry(spec.range, 24, thetaStart, thetaLength);

    mesh.position.set(p.pos.x, 0.3, p.pos.z);
    // CircleGeometry は XY 平面上で構築され、mesh.rotation.x = -90° により
    // ローカル Y が world -Z に対応する。world Z を反転させて aimAngle(atan2(dz,dx))と
    // 一致させるため、メッシュをワールド Z 軸方向に反転する。
    mesh.scale.z = -1;

    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(kind === 'heavy' ? COLORS.telegraphHeavy : COLORS.telegraphLight);
    mat.opacity = 0.12 + 0.45 * progress;
    mesh.visible = true;
  }

  // --- カメラ ---------------------------------------------------------------

  /**
   * 2プレイヤーの中点を注視しつつ、距離に応じて緩やかにズーム/追従する
   * パースペクティブカメラを更新する。シェイクは注視点・カメラ位置の双方に加える。
   */
  private updateCamera(state: GameState, effects: RenderEffects): void {
    const [p0, p1] = state.players;
    const midX = (p0.pos.x + p1.pos.x) / 2;
    const midZ = (p0.pos.z + p1.pos.z) / 2;
    const dist = Math.hypot(p1.pos.x - p0.pos.x, p1.pos.z - p0.pos.z);

    // 注視点を緩やかに追従(急な切り替わりを避ける)
    const targetLook = new THREE.Vector3(midX, ARENA.playerRadius, midZ);
    this.lookTarget.lerp(targetLook, 0.08);

    // 距離に応じてズーム(距離が遠いほど引く)。アリーナ全体が見渡せる範囲にクランプ。
    const desiredDistance = THREE.MathUtils.clamp(420 + dist * 0.6, 420, 760);
    this.camDistance += (desiredDistance - this.camDistance) * 0.06;

    // カメラはやや高く後方(-z寄り、+y方向)から見下ろす構図
    const elevation = 0.55; // ラジアン相当の傾き比(高さ/水平距離)
    const horizontal = this.camDistance * Math.cos(elevation);
    const vertical = this.camDistance * Math.sin(elevation);

    const shakeX = effects.shakeX ?? 0;
    const shakeY = effects.shakeY ?? 0;

    this.camera.position.set(
      this.lookTarget.x + shakeX,
      this.lookTarget.y + vertical + shakeY,
      this.lookTarget.z + horizontal
    );
    this.camera.lookAt(this.lookTarget.x + shakeX, this.lookTarget.y + shakeY, this.lookTarget.z);
  }
}
