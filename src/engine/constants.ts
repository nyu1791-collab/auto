/**
 * バランス数値の唯一の出典。DESIGN.md と一致させること。
 * すべての時間は tick 単位(60 TPS, 1 tick ≈ 16.67ms)。
 */

export const TPS = 60;

export const ARENA = {
  width: 800,
  /** プレイヤーの一辺(px) */
  playerSize: 40,
  /** 床の Y 座標(描画基準。ロジックは X のみ使用) */
  floorY: 360,
} as const;

export const PLAYER = {
  maxHp: 100,
  maxStamina: 100,
  /** スタミナ自然回復: 25/sec を tick あたりに換算 */
  staminaRegenPerTick: 25 / TPS,
  /** 地上の通常移動速度 px/tick */
  moveSpeed: 3,
  /** 空中の横移動速度 px/tick(地上より控えめにして空中制御を弱める) */
  airMoveSpeed: 2.2,
} as const;

/**
 * ジャンプ(縦移動)パラメータ。床(y=0)から上方向へ初速 `velocity` で跳び、
 * 毎 tick `gravity` ずつ減速して放物線を描く。`airJumps` 回だけ空中で再ジャンプできる
 * (二段ジャンプ)。これにより相手と独立に高さ方向へ動け、攻撃を「飛び越えて」
 * 回避する選択肢が生まれる。
 *
 * apex 高さ = velocity^2 / (2*gravity) ≈ 9^2/(2*0.55) ≈ 74px、
 * 滞空 ≈ 2*velocity/gravity ≈ 33 tick ≈ 0.55s。
 */
export const JUMP = {
  /** ジャンプ初速 px/tick(上向き) */
  velocity: 9,
  /** 重力加速度 px/tick^2 */
  gravity: 0.55,
  /** 接地後に許可される空中ジャンプ回数(=二段ジャンプなら 1) */
  airJumps: 1,
} as const;

export interface AttackSpec {
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  range: number;
  /** 縦方向の有効間合い px。攻防の高さ差がこれを超えるとヒットしない(飛び越え回避) */
  verticalRange: number;
}

export const ATTACKS: Record<'light' | 'heavy', AttackSpec> = {
  light: { windup: 9, active: 2, recovery: 12, damage: 10, range: 70, verticalRange: 52 },
  heavy: { windup: 27, active: 3, recovery: 30, damage: 30, range: 90, verticalRange: 60 },
} as const;

export const DODGE = {
  /** 開始からの無敵フレーム数 */
  iframes: 11,
  /** 回避アクション総持続 */
  duration: 18,
  /** 持続終了後のクールダウン */
  cooldown: 6,
  /** スタミナ消費 */
  staminaCost: 35,
  /**
   * i-frame 中の移動速度 px/tick。
   * i-frame 中(最大 iframes tick)の総移動量が攻撃の間合い(70-90px)を
   * 大きく超えないようにする(超えると「i-frame による無効化」ではなく
   * 「間合い外への移動による空振り」になり、ジャスト回避が成立しなくなる)。
   */
  dashSpeed: 2,
} as const;

export const JUST = {
  /**
   * ジャスト回避成立窓: 攻撃の active 開始から見て、防御側が回避を開始した
   * tick が「active 開始の window tick 前以内」ならジャスト成立。
   *
   * 9 tick ≈ 150ms。やや反応が忙しかったため 7→9 に緩和(易化)した
   * (精密回避の猶予が約 120ms → 150ms に広がる)。
   * 注: この値を loose ボットの reactionDelay(15)以上に上げると、
   *     ヘッドレスシミュレーションの基準結果が変わるため 15 未満に保つこと(DESIGN.md 参照)。
   */
  window: 9,
  /** ジャスト成立時、攻撃側に与える硬直 tick */
  stunTicks: 24,
  /** ジャスト成立時、防御側に還元するスタミナ(消費全額) */
  staminaRefund: 35,
} as const;

export const MATCH = {
  /** 先取本数 */
  roundsToWin: 2,
  /** ラウンド制限時間(秒) */
  roundSeconds: 60,
  /** ラウンド開始前の「READY...FIGHT!」カウントダウン tick 数(1.5s) */
  startCountdownTicks: 90,
  /** ラウンド終了後、結果を表示したまま固定する tick 数(2.5s) */
  roundEndFreezeTicks: 150,
} as const;
