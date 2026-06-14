/**
 * バランス数値の唯一の出典。DESIGN.md と一致させること。
 * すべての時間は tick 単位(60 TPS, 1 tick ≈ 16.67ms)。
 */

export const TPS = 60;

/**
 * 円形アリーナ。中心が原点 (0,0)、地面は x-z 平面(y は常に 0)。
 * プレイヤー中心は `hypot(x,z) <= radius - playerRadius` に拘束される。
 */
export const ARENA = {
  /** アリーナ円の半径 */
  radius: 320,
  /** プレイヤーの当たり半径 */
  playerRadius: 16,
} as const;

export const PLAYER = {
  maxHp: 100,
  maxStamina: 100,
  /** スタミナ自然回復: 25/sec を tick あたりに換算 */
  staminaRegenPerTick: 25 / TPS,
  /** 通常移動速度(ワールド単位/tick) */
  moveSpeed: 3,
} as const;

export interface AttackSpec {
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  range: number;
  /** 攻撃が有効な扇形の半角(ラジアン)。aimAngle ± arcHalfAngle 内のみ命中する */
  arcHalfAngle: number;
}

export const ATTACKS: Record<'light' | 'heavy', AttackSpec> = {
  light: { windup: 9, active: 2, recovery: 12, damage: 10, range: 70, arcHalfAngle: 0.6 },
  heavy: { windup: 27, active: 3, recovery: 30, damage: 30, range: 90, arcHalfAngle: 0.52 },
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
   * i-frame 中の移動速度(ワールド単位/tick)。
   * i-frame 中(最大 iframes tick)の総移動量が攻撃の間合い(70-90px相当)を
   * 大きく超えないようにする(超えると「i-frame による無効化」ではなく
   * 「間合い外への移動による空振り」になり、ジャスト回避が成立しなくなる)。
   */
  dashSpeed: 2,
} as const;

export const JUST = {
  /**
   * ジャスト回避成立窓: 攻撃の active 開始から見て、防御側が回避を開始した
   * tick が「active 開始の justWindow tick 前以内」ならジャスト成立。
   */
  window: 7,
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
