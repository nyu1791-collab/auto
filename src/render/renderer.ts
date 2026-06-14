/**
 * Three.js による 3D レンダラー(マインクラフト風)。
 *
 * - ボクセル(ブロック)人型キャラクター(頭・胴・腕・脚)に歩行/攻撃アニメーション。
 * - 草・土のブロック地面 + 青空 + 太陽光 + ソフトシャドウ。
 * - 攻撃テレグラフ(地面の扇形)で、ジャスト回避とサイドステップの読み合いを可視化。
 *
 * カメラは「+Z 側からアリーナ中心(-Z 方向)を見下ろす固定アングル」で、
 * Y 軸回転はしない。これにより「画面上 = ワールド -z / 画面右 = ワールド +x」が
 * 常に成立し、入力(画面相対の move)と見た目が一致する。
 *
 * DOM / WebGL に依存するため、`src/engine/**`・`src/sim/**` からは import しないこと。
 */

import * as THREE from 'three';
import { ARENA, ATTACKS, DODGE } from '../engine/constants';
import type { GameState, PlayerState } from '../engine/types';
import type { ParticleSystem } from './particles';

/**
 * main.ts のエフェクトレイヤーから渡される、tick 間の一時的な見た目情報。
 * エンジン状態には含まれない(エンジンの純粋性を保つ)。
 */
export interface RenderEffects {
  /** カメラシェイクのオフセット(ワールド単位) */
  shakeX?: number;
  shakeY?: number;
  /** 全体フラッシュの強さ (0-1) */
  flashAlpha?: number;
  /** 「JUST!」テキストの表示強度 (0-1)。HUD 側で使用 */
  justTextAlpha?: number;
  /** 現在のモード表示 */
  modeLabel?: string;
}

const COLORS = {
  // チーム色(シャツ)
  p0Shirt: 0x3aa0ff,
  p0Pants: 0x274690,
  p1Shirt: 0xff5a5a,
  p1Pants: 0x8a2f2f,
  skin: 0xd9a06a,
  hair: 0x5a3a22,
  eyeWhite: 0xf5f5f5,
  eyePupil: 0x3a2a6a,
  // 地面
  grassTop: 0x6abe4f,
  grassTop2: 0x5aae42,
  dirt: 0x80592f,
  dirt2: 0x6f4c27,
  stone: 0x9098a0,
  trunk: 0x6b4a2b,
  leaves: 0x4f9d3a,
  // 演出
  telegraphLight: 0xffe066,
  telegraphHeavy: 0xff5030,
  sky: 0x8fc6ff,
  stunned: 0xffffff,
};

/** ボクセル人型 1 体分のメッシュ・ピボット・アニメーション状態 */
interface CharacterRig {
  group: THREE.Group;
  /** 脚・腕のスイング用ピボット */
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** 色替え・透明化の対象となる全メッシュ */
  meshes: THREE.Mesh[];
  /** 攻撃時に発光させる胴・腕のマテリアル */
  shirtMats: THREE.MeshStandardMaterial[];
  shirtColor: number;
  /** 歩行アニメーションの位相と振幅 */
  walkPhase: number;
  swingAmp: number;
  /** 直前フレームのワールド位置(移動量=歩行速度の算出用) */
  lastX: number;
  lastZ: number;
  afterimages: THREE.Mesh[];
}

/** 1 ブロック分のワールドサイズ係数 */
const U = 1.7;

/** GameState を 3D 描画するレンダラー */
export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private p0: CharacterRig;
  private p1: CharacterRig;

  private telegraphP0: THREE.Mesh;
  private telegraphP1: THREE.Mesh;

  private flashOverlay: HTMLDivElement;

  private lookTarget = new THREE.Vector3(0, 0, 0);
  private camDistance = 520;
  private time = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, 900, 2400);

    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 5000);

    this.setupLights();
    this.buildWorld();

    this.p0 = this.buildCharacter(0);
    this.p1 = this.buildCharacter(1);
    this.scene.add(this.p0.group, this.p1.group);

    this.telegraphP0 = this.buildTelegraph();
    this.telegraphP1 = this.buildTelegraph();
    this.scene.add(this.telegraphP0, this.telegraphP1);

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

  handleResize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    const width = Math.max(1, clientWidth);
    const height = Math.max(1, clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.renderer.dispose();
    this.flashOverlay.remove();
  }

  render(state: GameState, effects: RenderEffects = {}, dtMs = 16.7): void {
    this.time += dtMs;

    this.updateCharacter(this.p0, state.players[0]);
    this.updateCharacter(this.p1, state.players[1]);
    this.updateTelegraph(this.telegraphP0, state.players[0]);
    this.updateTelegraph(this.telegraphP1, state.players[1]);
    this.updateCamera(state, effects);

    this.flashOverlay.style.opacity =
      effects.flashAlpha && effects.flashAlpha > 0 ? String(Math.min(1, effects.flashAlpha)) : '0';

    this.renderer.render(this.scene, this.camera);
  }

  // --- ライティング ------------------------------------------------------

  private setupLights(): void {
    // 空と地面からの環境光(屋外らしい柔らかさ)
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a7a3a, 0.85);
    this.scene.add(hemi);

    // 太陽(暖色の方向光 + 影)
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.15);
    sun.position.set(280, 520, 200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 1600;
    const s = ARENA.radius + 120;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
  }

  // --- ワールド(地面・装飾) ---------------------------------------------

  private buildWorld(): void {
    // 草原(広い地面)
    const grassTex = this.makeBlockTexture([COLORS.grassTop, COLORS.grassTop2], 0.5);
    grassTex.repeat.set(60, 60);
    const groundGeo = new THREE.PlaneGeometry(4000, 4000);
    const groundMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // アリーナ床(ごく薄い土の円盤を草原の上に乗せ、戦闘エリアを示す)
    const padTex = this.makeBlockTexture([COLORS.dirt, COLORS.dirt2], 0.5);
    padTex.repeat.set(10, 10);
    const padGeo = new THREE.CylinderGeometry(ARENA.radius, ARENA.radius, 6, 56);
    const padMat = new THREE.MeshStandardMaterial({ map: padTex, roughness: 1 });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 3;
    pad.receiveShadow = true;
    this.scene.add(pad);

    // 戦闘エリアの境界を示す石ブロックのリング
    const stoneGeo = new THREE.BoxGeometry(22, 16, 22);
    const stoneMat = new THREE.MeshStandardMaterial({ color: COLORS.stone, roughness: 1, flatShading: true });
    const ringBlocks = 36;
    for (let i = 0; i < ringBlocks; i++) {
      const a = (i / ringBlocks) * Math.PI * 2;
      const block = new THREE.Mesh(stoneGeo, stoneMat);
      block.position.set(Math.cos(a) * ARENA.radius, 8, Math.sin(a) * ARENA.radius);
      block.rotation.y = a;
      block.castShadow = true;
      block.receiveShadow = true;
      this.scene.add(block);
    }

    // 外周の装飾(木)を数本配置
    const treeSpots: [number, number][] = [
      [-1.9, 1.4],
      [2.2, 0.6],
      [-0.6, -2.3],
      [1.4, -1.8],
      [-2.4, -0.5],
    ];
    for (const [ax, az] of treeSpots) {
      const r = ARENA.radius + 180 + Math.abs(ax * az) * 30;
      this.scene.add(this.buildTree(ax * r * 0.4, az * r * 0.4));
    }
  }

  /** ブロック模様(2色のピクセル格子)の CanvasTexture を生成する */
  private makeBlockTexture(colors: [number, number], variance: number): THREE.Texture {
    const size = 64;
    const cells = 8;
    const cell = size / cells;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c0 = new THREE.Color(colors[0]);
    const c1 = new THREE.Color(colors[1]);
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const t = Math.random() * variance;
        const base = (x + y) % 2 === 0 ? c0 : c1;
        const col = base.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.06 - t * 0.04);
        ctx.fillStyle = `#${col.getHexString()}`;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  private buildTree(x: number, z: number): THREE.Group {
    const tree = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: COLORS.trunk, roughness: 1, flatShading: true });
    const leafMat = new THREE.MeshStandardMaterial({ color: COLORS.leaves, roughness: 1, flatShading: true });
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(16, 70, 16), trunkMat);
    trunk.position.y = 35;
    trunk.castShadow = true;
    tree.add(trunk);
    const leaves = new THREE.Mesh(new THREE.BoxGeometry(70, 56, 70), leafMat);
    leaves.position.y = 92;
    leaves.castShadow = true;
    tree.add(leaves);
    tree.position.set(x, 0, z);
    return tree;
  }

  // --- キャラクター --------------------------------------------------------

  private buildCharacter(id: 0 | 1): CharacterRig {
    const shirtColor = id === 0 ? COLORS.p0Shirt : COLORS.p1Shirt;
    const pantsColor = id === 0 ? COLORS.p0Pants : COLORS.p1Pants;

    const legW = 4 * U;
    const legH = 12 * U;
    const legD = 4 * U;
    const bodyW = 8 * U;
    const bodyH = 12 * U;
    const bodyD = 4 * U;
    const armW = 4 * U;
    const armH = 12 * U;
    const head = 8 * U;

    const group = new THREE.Group();
    const meshes: THREE.Mesh[] = [];
    const shirtMats: THREE.MeshStandardMaterial[] = [];

    const mat = (color: number): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true });

    const addMesh = (
      parent: THREE.Object3D,
      w: number,
      h: number,
      d: number,
      material: THREE.MeshStandardMaterial,
      x: number,
      y: number,
      z: number
    ): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      meshes.push(m);
      return m;
    };

    // 脚(股関節を中心に前後スイングするピボット)
    const shirtMatL = mat(pantsColor);
    const legL = new THREE.Group();
    legL.position.set(-legW / 2, legH, 0);
    addMesh(legL, legW, legH, legD, shirtMatL, 0, -legH / 2, 0);
    group.add(legL);

    const legR = new THREE.Group();
    legR.position.set(legW / 2, legH, 0);
    addMesh(legR, legW, legH, legD, mat(pantsColor), 0, -legH / 2, 0);
    group.add(legR);

    // 胴(シャツ色)
    const bodyMat = mat(shirtColor);
    shirtMats.push(bodyMat);
    addMesh(group, bodyW, bodyH, bodyD, bodyMat, 0, legH + bodyH / 2, 0);

    // 腕(肩を中心にスイング。シャツ色 + 先端に肌色の手)
    const shoulderY = legH + bodyH;
    const armLMat = mat(shirtColor);
    shirtMats.push(armLMat);
    const armL = new THREE.Group();
    armL.position.set(-(bodyW / 2 + armW / 2), shoulderY, 0);
    addMesh(armL, armW, armH * 0.78, armW, armLMat, 0, -armH * 0.39, 0);
    addMesh(armL, armW, armH * 0.22, armW, mat(COLORS.skin), 0, -armH * 0.89, 0);
    group.add(armL);

    const armRMat = mat(shirtColor);
    shirtMats.push(armRMat);
    const armR = new THREE.Group();
    armR.position.set(bodyW / 2 + armW / 2, shoulderY, 0);
    addMesh(armR, armW, armH * 0.78, armW, armRMat, 0, -armH * 0.39, 0);
    addMesh(armR, armW, armH * 0.22, armW, mat(COLORS.skin), 0, -armH * 0.89, 0);
    group.add(armR);

    // 頭(肌色)+ 髪 + 顔(目)。正面は +x。
    const headY = legH + bodyH + head / 2;
    addMesh(group, head, head, head, mat(COLORS.skin), 0, headY, 0);
    // 髪(上面と後頭部)
    const hairMat = mat(COLORS.hair);
    addMesh(group, head * 1.04, head * 0.32, head * 1.04, hairMat, 0, headY + head * 0.36, 0);
    addMesh(group, head * 0.28, head * 0.7, head * 1.04, hairMat, -head * 0.4, headY, 0);
    // 目(白 + 瞳)。+x 面に貼る。
    const eyeZ = head * 0.22;
    const eyeY = headY + head * 0.08;
    const eyeX = head / 2 + 0.3;
    for (const sign of [-1, 1]) {
      addMesh(group, 1.2, head * 0.18, head * 0.16, mat(COLORS.eyeWhite), eyeX, eyeY, sign * eyeZ);
      addMesh(group, 1.4, head * 0.1, head * 0.08, mat(COLORS.eyePupil), eyeX, eyeY, sign * eyeZ - sign * head * 0.02);
    }

    group.position.set(0, 0, 0);

    return {
      group,
      legL,
      legR,
      armL,
      armR,
      meshes,
      shirtMats,
      shirtColor,
      walkPhase: 0,
      swingAmp: 0,
      lastX: 0,
      lastZ: 0,
      afterimages: [],
    };
  }

  private updateCharacter(rig: CharacterRig, p: PlayerState): void {
    const { group } = rig;
    group.position.set(p.pos.x, 0, p.pos.z);
    // facing(atan2(dz,dx)) を three.js の Y 軸回転へ。+x 正面が facing 方向を向くよう -facing。
    group.rotation.y = -p.facing;

    // 歩行アニメーション: 移動量から速度を見て腕脚をスイング
    const moved = Math.hypot(p.pos.x - rig.lastX, p.pos.z - rig.lastZ);
    rig.lastX = p.pos.x;
    rig.lastZ = p.pos.z;
    const moving = moved > 0.05 && p.stunTicks === 0;
    rig.swingAmp += ((moving ? 0.7 : 0) - rig.swingAmp) * 0.2;
    if (moving) rig.walkPhase += Math.min(0.6, moved * 0.35);
    const swing = Math.sin(rig.walkPhase) * rig.swingAmp;
    rig.legL.rotation.z = swing;
    rig.legR.rotation.z = -swing;
    rig.armL.rotation.z = -swing * 0.8;
    rig.armR.rotation.z = swing * 0.8;

    // 軽い待機の上下動
    const bob = moving ? 0 : Math.sin(this.time / 420) * 0.6;
    group.position.y = bob;

    // 攻撃モーション(右腕を振りかぶって振り下ろす)
    if (p.attack) {
      const spec = ATTACKS[p.attack.kind];
      const e = p.attack.elapsed;
      let theta: number;
      if (e <= spec.windup) {
        // 振りかぶり(後方/上へ)
        theta = -1.1 * (e / spec.windup);
      } else {
        // 振り下ろし(前方へ)
        const t = Math.min(1, (e - spec.windup) / (spec.active + spec.recovery));
        const eased = 1 - (1 - t) * (1 - t);
        theta = -1.1 + 2.7 * eased;
      }
      rig.armR.rotation.z = theta;
      rig.armL.rotation.z = -theta * 0.3;
    }

    // スタン: 点滅。攻撃中(active 以降): シャツを発光。回避中: 半透明。
    const isStunned = p.stunTicks > 0;
    const isActive = p.attack !== null && p.attack.elapsed >= ATTACKS[p.attack.kind].windup;
    const dodging = p.dodge !== null;
    const opacity = dodging ? 0.4 : 1;
    const blink = isStunned && Math.sin(this.time / 55) > 0;

    for (const m of rig.meshes) {
      const mm = m.material as THREE.MeshStandardMaterial;
      mm.transparent = opacity < 1;
      mm.opacity = opacity;
    }
    for (const sm of rig.shirtMats) {
      if (blink) {
        sm.emissive.setHex(0x555555);
        sm.emissiveIntensity = 1;
      } else if (isActive) {
        sm.emissive.setHex(rig.shirtColor);
        sm.emissiveIntensity = 0.6;
      } else {
        sm.emissive.setHex(0x000000);
        sm.emissiveIntensity = 0;
      }
    }

    this.updateAfterimages(rig, p, dodging && p.dodge !== null && p.dodge.elapsed < DODGE.iframes);
  }

  /** 回避 i-frame 中、進行してきた軌跡側に半透明の残像ブロックを表示する */
  private updateAfterimages(rig: CharacterRig, p: PlayerState, active: boolean): void {
    const ghostCount = 3;
    if (rig.afterimages.length === 0) {
      const geo = new THREE.BoxGeometry(8 * U, 28 * U, 6 * U);
      for (let i = 0; i < ghostCount; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: rig.shirtColor, transparent: true, opacity: 0 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        this.scene.add(mesh);
        rig.afterimages.push(mesh);
      }
    }
    if (!active || !p.dodge) {
      for (const g of rig.afterimages) g.visible = false;
      return;
    }
    for (let i = 0; i < rig.afterimages.length; i++) {
      const g = rig.afterimages[i];
      const offset = (i + 1) * ARENA.playerRadius * 0.6;
      g.position.set(p.pos.x - p.dodge.dirX * offset, 14 * U, p.pos.z - p.dodge.dirZ * offset);
      (g.material as THREE.MeshBasicMaterial).opacity = 0.2 * (1 - i / (rig.afterimages.length + 1));
      g.visible = true;
    }
  }

  // --- 攻撃テレグラフ -------------------------------------------------------

  private buildTelegraph(): THREE.Mesh {
    const geo = new THREE.CircleGeometry(1, 24, 0, 0.01);
    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.telegraphLight,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 6.5;
    mesh.scale.z = -1;
    mesh.visible = false;
    return mesh;
  }

  private updateTelegraph(mesh: THREE.Mesh, p: PlayerState): void {
    if (!p.attack || p.attack.elapsed >= ATTACKS[p.attack.kind].windup) {
      mesh.visible = false;
      return;
    }
    const kind = p.attack.kind;
    const spec = ATTACKS[kind];
    const progress = (p.attack.elapsed + 1) / spec.windup;

    mesh.geometry.dispose();
    mesh.geometry = new THREE.CircleGeometry(spec.range, 24, p.attack.aimAngle - spec.arcHalfAngle, spec.arcHalfAngle * 2);
    mesh.position.set(p.pos.x, 6.5, p.pos.z);

    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(kind === 'heavy' ? COLORS.telegraphHeavy : COLORS.telegraphLight);
    mat.opacity = 0.15 + 0.5 * progress;
    mesh.visible = true;
  }

  // --- カメラ ---------------------------------------------------------------

  private updateCamera(state: GameState, effects: RenderEffects): void {
    const [p0, p1] = state.players;
    const midX = (p0.pos.x + p1.pos.x) / 2;
    const midZ = (p0.pos.z + p1.pos.z) / 2;
    const dist = Math.hypot(p1.pos.x - p0.pos.x, p1.pos.z - p0.pos.z);

    const targetLook = new THREE.Vector3(midX, 28, midZ);
    this.lookTarget.lerp(targetLook, 0.08);

    const desiredDistance = THREE.MathUtils.clamp(440 + dist * 0.6, 440, 780);
    this.camDistance += (desiredDistance - this.camDistance) * 0.06;

    // +Z 側のやや高い位置から見下ろす(Y 軸回転なし)。
    const elevation = 0.6;
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
