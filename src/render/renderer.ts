import { ARENA, ATTACKS, DODGE, JUMP, JUST, MATCH, PLAYER } from '../engine/constants';
import type { GameState, PlayerState } from '../engine/types';

/** 2D 座標(人型のジョイント位置などに使う簡易型) */
type Pt = { x: number; y: number };

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
/** 減速イージング(0→1 を素早く立ち上げて収束させる)。攻撃の振りの「キレ」に使う */
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

const COLORS = {
  p0: '#4da6ff',
  p0Dark: '#1f5c99',
  p0Light: '#a8d4ff',
  p1: '#ff5d5d',
  p1Dark: '#992f2f',
  p1Light: '#ffc2c2',
  bgTop: '#12161f',
  bgBottom: '#0c0e13',
  skyBand: '#1b2233',
  horizon: '#39445c',
  ground: '#232932',
  groundLine: '#3a4250',
  groundTile: 'rgba(255,255,255,0.04)',
  groundDark: '#171b22',
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
/** 接地直後の「着地つぶれ」スカッシュ演出が持続する時間(ms) */
const LANDING_SQUASH_MS = 140;
/** ジャンプ/落下中の伸縮(スクワッシュ&ストレッチ)の最大変形率 */
const AIR_STRETCH_MAX = 0.12;

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
   * ジャスト回避タイミングのアシスト表示(攻撃側に収束リングを描く)の ON/OFF。
   * 未指定(undefined)のときは ON 扱い。初心者がジャスト回避の間合いを掴むための補助。
   */
  showJustCue?: boolean;
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
  /** 直前フレームの vy(着地判定用)。プレイヤーごと */
  private prevVy: [number, number] = [0, 0];
  /** 着地つぶれ(スクワッシュ)演出の残り時間(ms)。プレイヤーごと */
  private landingSquash: [number, number] = [0, 0];
  /** 直前フレームの x(歩行アニメ判定用)。プレイヤーごと */
  private prevX: [number, number] = [0, 0];
  /** 歩行ストライドの位相(移動距離に応じて進む)。プレイヤーごと */
  private stridePhase: [number, number] = [0, 0];
  /** 歩行アニメの振幅(0=静止 → 1=歩行中)。移動状態へ滑らかに追従する。プレイヤーごと */
  private walkAmp: [number, number] = [0, 0];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  render(state: GameState, effects: RenderEffects = {}, dtMs = 16.7): void {
    const { ctx } = this;

    this.time += dtMs;
    this.updateHpDisplay(state, dtMs);
    this.updateJumpEffects(state, dtMs);

    ctx.save();
    ctx.translate(effects.shakeX ?? 0, effects.shakeY ?? 0);

    this.drawBackground();

    for (const p of state.players) this.drawShadow(p);
    for (const p of state.players) this.drawDodgeAfterimage(p);
    for (const p of state.players) this.drawTelegraph(p);
    const showJustCue = effects.showJustCue ?? true;
    for (const p of state.players) this.drawJustCue(p, showJustCue);
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

  /**
   * 着地つぶれ(スクワッシュ)演出の状態を更新する(描画専用、ロジックには影響しない)。
   * `vy` が「正(上昇)以下」から「接地(y=0, vy=0)」に転じた tick を着地と判定し、
   * `LANDING_SQUASH_MS` の間だけつぶれ演出を再生する。
   */
  private updateJumpEffects(state: GameState, dtMs: number): void {
    for (let i = 0; i < 2; i++) {
      const p = state.players[i];
      if (p.y === 0 && p.vy === 0 && this.prevVy[i] < 0) {
        this.landingSquash[i] = LANDING_SQUASH_MS;
      }
      if (this.landingSquash[i] > 0) {
        this.landingSquash[i] = Math.max(0, this.landingSquash[i] - dtMs);
      }
      this.prevVy[i] = p.vy;

      // 歩行アニメ: 横移動した距離に応じてストライド位相を進める
      // (接地中のみ。実際の移動量に同期させて足の運びを地面と合わせる)。
      const dx = p.x - this.prevX[i];
      const moving = p.y === 0 && Math.abs(dx) > 0.1;
      if (moving) {
        this.stridePhase[i] += dx * 0.45;
      }
      // 歩行振幅を移動状態へ滑らかに追従(静止時は脚を立ち姿勢へ戻す)
      const target = moving ? 1 : 0;
      const rate = Math.min(1, dtMs / 90);
      this.walkAmp[i] += (target - this.walkAmp[i]) * rate;
      this.prevX[i] = p.x;
    }
  }

  /**
   * 背景: 完全にフラットな 2D ステージ。
   * 奥行きを感じさせるグラデーション(床が奥へ暗くなる遠近表現)を排し、
   * 空・地平線帯・地面スラブをすべて平面的な単色の帯と直線で構成する。
   */
  private drawBackground(): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const floorY = ARENA.floorY + ARENA.playerSize;

    // --- 空(フラットな単色) ---
    ctx.fillStyle = COLORS.bgTop;
    ctx.fillRect(0, 0, w, floorY);

    // --- 地平線帯(平面的な水平バンド。遠近感は付けない) ---
    const bandTop = floorY - 80;
    ctx.fillStyle = COLORS.skyBand;
    ctx.fillRect(0, bandTop, w, 80);
    ctx.fillStyle = COLORS.horizon;
    ctx.fillRect(0, bandTop, w, 2);

    // --- 地面(奥行きなしの単色スラブ) ---
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, floorY, w, h - floorY);

    // 地面の上端ライン(立っている面)
    ctx.fillStyle = COLORS.groundLine;
    ctx.fillRect(0, floorY, w, 3);

    // フラットなタイル割り(等間隔の縦線。透視変換しないので平面に見える)
    ctx.strokeStyle = COLORS.groundTile;
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, floorY + 3);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }

    // 地面下端のフラットな帯(縁取り)
    ctx.fillStyle = COLORS.groundDark;
    ctx.fillRect(0, h - 6, w, 6);
  }

  /**
   * 各ファイターの足元に、フラットな接地マーク(平面的な細い帯)を描く。
   * ジャンプで浮いている間は、高さに応じてマークを縮小・薄くすることで
   * 「足元から離れている」距離感を表現する(マーク自体は常に地面に留まる)。
   */
  private drawShadow(p: PlayerState): void {
    const { ctx } = this;
    const heightRatio = Math.min(1, p.y / 80);
    const fullW = ARENA.playerSize * 0.8;
    const w = fullW * (1 - heightRatio * 0.4);
    const x = p.x + (ARENA.playerSize - w) / 2;
    const y = ARENA.floorY + ARENA.playerSize + 1;
    const alpha = 0.28 * (1 - heightRatio * 0.75);

    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(2)})`;
    ctx.fillRect(x, y, w, 3);
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
    const size = ARENA.playerSize;
    const cx = p.x + size / 2;
    const footY = ARENA.floorY - p.y + size;

    // 人型のシルエットを簡略化した「縦の残像」を数枚、進行方向側に伸ばす
    const ghostCount = 3;
    for (let i = 1; i <= ghostCount; i++) {
      const offset = trailDir * i * (size * 0.26);
      const alpha = 0.16 * (1 - i / (ghostCount + 1));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = size * 0.42;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + offset, footY - size * 0.86);
      ctx.lineTo(cx + offset, footY - size * 0.12);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * ファイターを人型(頭・胴・両腕両脚)で描く。攻撃・回避・歩行・ジャンプ・被スタンに応じて
   * 手足のポーズを変化させ、特に攻撃は「引き(windup)→振り(active)→戻り(recovery)」の
   * モーションをつけて、何の攻撃をいつ出したのかを動きで分かりやすくする。
   */
  private drawPlayer(p: PlayerState): void {
    const { ctx } = this;
    const isStunned = p.stunTicks > 0;
    const isAttackActive =
      p.attack !== null &&
      p.attack.elapsed >= ATTACKS[p.attack.kind].windup &&
      p.attack.elapsed < ATTACKS[p.attack.kind].windup + ATTACKS[p.attack.kind].active;
    const isIframe = p.dodge !== null && p.dodge.elapsed < DODGE.iframes;

    const size = ARENA.playerSize;
    const main = isStunned ? COLORS.stunned : p.id === 0 ? COLORS.p0 : COLORS.p1;
    const dark = p.id === 0 ? COLORS.p0Dark : COLORS.p1Dark;
    const lightC = p.id === 0 ? COLORS.p0Light : COLORS.p1Light;

    // スクワッシュ&ストレッチを足元基準で適用(地面との接地感を保つ)
    const [scaleX, scaleY] = this.jumpSquashScale(p);
    const anchorX = p.x + size / 2;
    const anchorY = ARENA.floorY - p.y + size; // 足元(接地点)

    ctx.save();
    ctx.globalAlpha = isIframe ? 0.5 : 1;
    ctx.translate(anchorX, anchorY);
    ctx.scale(scaleX, scaleY);

    const pose = this.computePose(p, size);

    // 攻撃発生中・被スタン中は人型全体をグローさせて状態を強調する
    if (isAttackActive || isStunned) {
      ctx.shadowColor = isStunned
        ? 'rgba(255,255,255,0.6)'
        : p.id === 0
          ? 'rgba(77,166,255,0.65)'
          : 'rgba(255,93,93,0.65)';
      ctx.shadowBlur = isStunned ? 14 : 16;
    }

    this.drawHumanoid(pose, main, dark, lightC, isStunned);

    // 攻撃発生中は斬撃エフェクトで「今攻撃を振った」ことをはっきり見せる
    if (isAttackActive && p.attack) {
      this.drawSlash(p, pose, size);
    }

    ctx.restore();
  }

  /**
   * プレイヤーの状態から人型の各ジョイント位置(足元中心・上方向が負の局所座標)を計算する。
   * 攻撃は kind ごとに「引き→振り→戻り」のモーションを与え、回避はしゃがみ、
   * ジャンプは脚を畳む、被スタンはのけぞる、歩行は脚を交互に振る。
   */
  private computePose(p: PlayerState, size: number) {
    const dir = p.facing;
    let hipY = -size * 0.42;
    let shoulderY = -size * 0.72;
    let headY = -size * 0.86;
    const headR = size * 0.18;
    let hipX = 0;
    let lean = 0; // >0 前傾(facing 方向)、<0 後傾(のけぞり)
    let crouch = 0; // >0 で上体を沈める

    let fHand: Pt = { x: dir * 9, y: hipY + 3 };
    let rHand: Pt = { x: -dir * 7, y: hipY + 3 };
    let fFoot: Pt = { x: dir * 6, y: 0 };
    let rFoot: Pt = { x: -dir * 6, y: 0 };

    // --- 歩行(接地・非ロック時のみ。脚を交互に、腕を逆位相で振る) ---
    const amp = this.walkAmp[p.id];
    if (amp > 0.01 && p.y === 0 && !p.attack && !p.dodge && p.stunTicks === 0) {
      const s = Math.sin(this.stridePhase[p.id]);
      fFoot = { x: dir * 6 + s * 6 * amp, y: -Math.max(0, s) * 3 * amp };
      rFoot = { x: -dir * 6 - s * 6 * amp, y: -Math.max(0, -s) * 3 * amp };
      fHand = { x: dir * 9 - s * 4 * amp, y: hipY + 3 };
      rHand = { x: -dir * 7 + s * 4 * amp, y: hipY + 3 };
    }

    // --- ジャンプ(空中は脚を畳む) ---
    if (p.y > 0) {
      fFoot = { x: dir * 5, y: -size * 0.2 };
      rFoot = { x: -dir * 6, y: -size * 0.26 };
      fHand = { x: dir * 10, y: shoulderY + 2 };
      rHand = { x: -dir * 10, y: shoulderY + 2 };
    }

    // --- 回避(しゃがんで後方へ重心を落とす) ---
    if (p.dodge) {
      crouch = 5;
      lean = -0.35;
      fFoot = { x: dir * 9, y: 0 };
      rFoot = { x: -dir * 9, y: 0 };
      fHand = { x: dir * 4, y: hipY - 2 };
      rHand = { x: -dir * 2, y: hipY - 2 };
    }

    // --- 攻撃モーション(発生の前後がはっきり分かるよう大きく動かす) ---
    if (p.attack) {
      const spec = ATTACKS[p.attack.kind];
      const e = p.attack.elapsed;
      const rest: Pt = { x: dir * 9, y: hipY + 3 };
      const restR: Pt = { x: -dir * 7, y: hipY + 3 };
      if (p.attack.kind === 'light') {
        // 弱: 拳を引いて突き出すジャブ
        const cocked: Pt = { x: -dir * 5, y: shoulderY + 2 };
        const ext: Pt = { x: dir * size * 0.72, y: shoulderY + 1 };
        rHand = { x: -dir * 8, y: hipY };
        if (e < spec.windup) {
          const t = easeOut((e + 1) / spec.windup);
          fHand = lerpPt(rest, cocked, t);
          lean = -0.45 * t;
        } else if (e < spec.windup + spec.active) {
          const t = easeOut((e - spec.windup + 1) / spec.active);
          fHand = lerpPt(cocked, ext, t);
          lean = lerp(-0.45, 0.7, t);
          fFoot = { x: dir * 10, y: 0 };
        } else {
          const t = (e - spec.windup - spec.active) / spec.recovery;
          fHand = lerpPt(ext, rest, t);
          lean = 0.7 * (1 - t);
        }
      } else {
        // 強: 両手を振りかぶって前方へ叩き込む大振り
        const up: Pt = { x: dir * 2, y: headY - 10 };
        const upR: Pt = { x: -dir * 3, y: headY - 7 };
        const down: Pt = { x: dir * size * 0.64, y: hipY - 2 };
        const downR: Pt = { x: dir * 10, y: hipY - 6 };
        if (e < spec.windup) {
          const t = easeOut((e + 1) / spec.windup);
          fHand = lerpPt(rest, up, t);
          rHand = lerpPt(restR, upR, t);
          lean = -0.6 * t;
        } else if (e < spec.windup + spec.active) {
          const t = easeOut((e - spec.windup + 1) / spec.active);
          fHand = lerpPt(up, down, t);
          rHand = lerpPt(upR, downR, t);
          lean = lerp(-0.6, 0.85, t);
          fFoot = { x: dir * 12, y: 0 };
          crouch = 2 * t;
        } else {
          const t = (e - spec.windup - spec.active) / spec.recovery;
          fHand = lerpPt(down, rest, t);
          rHand = lerpPt(downR, restR, t);
          lean = 0.85 * (1 - t);
        }
      }
    }

    // --- 被スタン(のけぞり + ふらつき) ---
    if (p.stunTicks > 0) {
      lean = -0.55;
      const wob = Math.sin(this.time * 0.025);
      hipX += wob * 2;
      fHand = { x: dir * 11, y: shoulderY + 5 };
      rHand = { x: -dir * 11, y: shoulderY + 3 };
    }

    // crouch を上体へ反映(足は接地のまま上体を沈める)
    hipY += crouch;
    shoulderY += crouch;
    headY += crouch;

    // lean を高さに応じた x オフセットとして反映(上ほど大きく傾く)
    const hip: Pt = { x: hipX, y: hipY };
    const shoulder: Pt = { x: hipX + dir * lean * 9, y: shoulderY };
    const head = { x: hipX + dir * lean * 15, y: headY, r: headR };

    // 腕は肩の傾き・沈み込みに追従させる
    const shoOff = shoulder.x * 0.5;
    fHand = { x: fHand.x + shoOff, y: fHand.y + crouch * 0.6 };
    rHand = { x: rHand.x + shoOff, y: rHand.y + crouch * 0.6 };

    const fElbow: Pt = { x: (shoulder.x + fHand.x) / 2, y: (shoulder.y + fHand.y) / 2 + 3 };
    const rElbow: Pt = { x: (shoulder.x + rHand.x) / 2, y: (shoulder.y + rHand.y) / 2 + 3 };
    const fKnee: Pt = { x: (hip.x + fFoot.x) / 2 + dir * 2, y: (hip.y + fFoot.y) / 2 - 1 };
    const rKnee: Pt = { x: (hip.x + rFoot.x) / 2 + dir * 2, y: (hip.y + rFoot.y) / 2 - 1 };

    return { head, hip, shoulder, fHand, rHand, fElbow, rElbow, fFoot, rFoot, fKnee, rKnee, dir };
  }

  /** 2 関節の手足(肩/腰→肘/膝→手/足)を、暗い縁取り + 主色のカプセルで描く */
  private limb(a: Pt, m: Pt, b: Pt, width: number, color: string, outline: string): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(m.x, m.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = outline;
    ctx.lineWidth = width + 2;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  /** 円(拳・関節の丸み)を塗る小ヘルパー */
  private dot(p: Pt, r: number, color: string): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** computePose の結果から人型を奥→手前の順に描画する */
  private drawHumanoid(
    pose: ReturnType<Renderer['computePose']>,
    main: string,
    dark: string,
    lightC: string,
    isStunned: boolean
  ): void {
    const outline = isStunned ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.4)';
    const legW = 5;
    const armW = 4.5;
    const torsoW = 11;

    // 奥側(後ろ脚・後ろ腕)はやや暗くして奥行きを出す
    this.limb(pose.hip, pose.rKnee, pose.rFoot, legW, dark, outline);
    this.limb(pose.shoulder, pose.rElbow, pose.rHand, armW, dark, outline);
    this.dot(pose.rHand, armW * 0.7, dark);

    // 胴体(肩↔腰の太いカプセル)
    const torsoMid: Pt = {
      x: (pose.shoulder.x + pose.hip.x) / 2,
      y: (pose.shoulder.y + pose.hip.y) / 2,
    };
    this.limb(pose.shoulder, torsoMid, pose.hip, torsoW, main, outline);

    // 頭(縁取り → 主色 → ハイライト → 向きを示す目)
    this.dot(pose.head, pose.head.r + 1, outline);
    this.dot(pose.head, pose.head.r, main);
    this.dot(
      { x: pose.head.x - pose.dir * pose.head.r * 0.3, y: pose.head.y - pose.head.r * 0.3 },
      pose.head.r * 0.4,
      lightC
    );
    this.dot(
      { x: pose.head.x + pose.dir * pose.head.r * 0.45, y: pose.head.y - pose.head.r * 0.05 },
      pose.head.r * 0.22,
      isStunned ? '#444' : 'rgba(0,0,0,0.8)'
    );

    // 手前側(前脚・前腕・拳)は主色で最前面に
    this.limb(pose.hip, pose.fKnee, pose.fFoot, legW, main, outline);
    this.limb(pose.shoulder, pose.fElbow, pose.fHand, armW, main, outline);
    this.dot(pose.fHand, armW * 0.85, main);
  }

  /**
   * 攻撃の active 中に、振り抜きの弧(斬撃エフェクト)を攻撃側の前方に描く。
   * 弱は素早く短い白〜黄の streak、強は大きく赤〜橙の弧。ap(active 進行度)に応じて
   * 後方から前方へ掃き、攻撃を出した瞬間を視覚的に強調する。
   */
  private drawSlash(p: PlayerState, pose: ReturnType<Renderer['computePose']>, size: number): void {
    if (!p.attack) return;
    const { ctx } = this;
    const spec = ATTACKS[p.attack.kind];
    const ap = Math.min(1, (p.attack.elapsed - spec.windup + 1) / spec.active);
    const dir = pose.dir;
    const heavy = p.attack.kind === 'heavy';
    const rgb = heavy ? '255, 130, 70' : '255, 230, 140';
    const reach = heavy ? size * 1.0 : size * 0.8;
    const cx = pose.shoulder.x;
    const cy = heavy ? pose.shoulder.y - 2 : pose.shoulder.y + 1;
    const base = dir > 0 ? 0 : Math.PI;
    const spread = heavy ? 1.2 : 0.7;
    const start = base - dir * spread;
    const end = start + dir * spread * 2 * Math.min(1, ap * 1.25);
    const alpha = 0.75 * (1 - ap * 0.5);

    ctx.save();
    ctx.shadowColor = `rgba(${rgb}, 0.8)`;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(2)})`;
    ctx.lineWidth = heavy ? 7 : 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, reach, Math.min(start, end), Math.max(start, end));
    ctx.stroke();
    ctx.restore();
  }

  /**
   * ジャンプ/落下/着地に応じたスクワッシュ&ストレッチの倍率 `[scaleX, scaleY]` を返す。
   * - 着地直後(`landingSquash` 残り時間中): 横に広がり縦に縮む「つぶれ」。
   * - 上昇中(`vy > 0`): 縦に伸び横に縮む。
   * - 下降中(`vy < 0`、空中): 上昇中より弱めに、縦に伸び横に縮む(落下感)。
   */
  private jumpSquashScale(p: PlayerState): [number, number] {
    const squashRemaining = this.landingSquash[p.id];
    if (squashRemaining > 0) {
      const t = squashRemaining / LANDING_SQUASH_MS;
      return [1 + AIR_STRETCH_MAX * 1.5 * t, 1 - AIR_STRETCH_MAX * 1.5 * t];
    }
    if (p.vy > 0) {
      const t = Math.min(1, p.vy / JUMP.velocity);
      return [1 - AIR_STRETCH_MAX * 0.6 * t, 1 + AIR_STRETCH_MAX * t];
    }
    if (p.vy < 0 && p.y > 0) {
      const t = Math.min(1, -p.vy / JUMP.velocity);
      return [1 - AIR_STRETCH_MAX * 0.4 * t, 1 + AIR_STRETCH_MAX * 0.7 * t];
    }
    return [1, 1];
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

    const telegraphY = ARENA.floorY - p.y - 6;
    ctx.fillStyle = grad;
    ctx.fillRect(x0, telegraphY, width, ARENA.playerSize + 12);

    // 発生間際は外枠を強調してさらに目立たせる
    if (progress > 0.7) {
      ctx.strokeStyle = `rgba(${color}, ${Math.min(1, alpha + 0.2).toFixed(2)})`;
      ctx.lineWidth = isHeavy ? 3 : 2;
      ctx.strokeRect(x0, telegraphY, width, ARENA.playerSize + 12);
    }
  }

  /**
   * ジャスト回避アシスト: 攻撃の windup 中、攻撃側を囲む「収束リング」を描く。
   * リングは active 発生に向けて縮み、ちょうど発生する瞬間にプレイヤー大に重なる。
   * 発生まで `JUST.window` tick 以内(=今回避を出せばジャスト成立する猶予)に入ると
   * リングを金色に光らせ、「今だ!」というジャスト回避の合図にする。
   * これにより初心者でも「リングが光ったら回避」と視覚的にタイミングを学べる。
   */
  private drawJustCue(p: PlayerState, enabled: boolean): void {
    if (!enabled || !p.attack) return;
    const spec = ATTACKS[p.attack.kind];
    if (p.attack.elapsed >= spec.windup) return; // windup 中のみ

    const { ctx } = this;
    const ticksUntilActive = spec.windup - p.attack.elapsed;
    const progress = p.attack.elapsed / spec.windup; // 0(windup開始) → 1(発生直前)
    const cx = p.x + ARENA.playerSize / 2;
    const cy = ARENA.floorY - p.y + ARENA.playerSize / 2;

    const maxR = ARENA.playerSize * 1.7;
    const minR = ARENA.playerSize * 0.62;
    const r = maxR - (maxR - minR) * progress;

    const inJustWindow = ticksUntilActive <= JUST.window;
    const rgb = inJustWindow ? '255, 224, 102' : '255, 255, 255';
    const alpha = inJustWindow ? 0.9 : 0.22 + 0.28 * progress;

    ctx.save();
    ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(2)})`;
    ctx.lineWidth = inJustWindow ? 3 : 2;
    if (inJustWindow) {
      ctx.shadowColor = `rgba(${rgb}, 0.85)`;
      ctx.shadowBlur = 12;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawAttackRange(p: PlayerState): void {
    if (!p.attack) return;
    const spec = ATTACKS[p.attack.kind];
    const active = p.attack.elapsed >= spec.windup && p.attack.elapsed < spec.windup + spec.active;
    if (!active) return;

    const { ctx } = this;
    const cx = p.x + ARENA.playerSize / 2;
    ctx.fillStyle = COLORS.hitbox;
    ctx.fillRect(cx - spec.range, ARENA.floorY - p.y - 10, spec.range * 2, ARENA.playerSize + 20);
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
