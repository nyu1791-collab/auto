import { ATTACKS, DODGE } from '../engine/constants';
import type { AttackKind, GameState, PlayerId, PlayerInput, Vec2 } from '../engine/types';

export type Bot = (state: GameState, self: PlayerId) => PlayerInput;

export const NO_INPUT: PlayerInput = { move: { x: 0, z: 0 }, dodge: false, attack: null };

/** 相手との直線距離 */
function distance(state: GameState, self: PlayerId): number {
  const a = state.players[self];
  const b = state.players[1 - self];
  return Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
}

/** 相手へ向かう単位ベクトル(ワールド相対)。重なっていれば 0 ベクトル。 */
function towardOpponent(state: GameState, self: PlayerId): Vec2 {
  const a = state.players[self];
  const b = state.players[1 - self];
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  if (d === 0) return { x: 0, z: 0 };
  return { x: dx / d, z: dz / d };
}

/** ベクトルを 90° 回転(サイドステップ方向) */
function perpendicular(v: Vec2): Vec2 {
  return { x: v.z, z: -v.x };
}

/** 間合いを詰めて攻撃を出し続けるだけのボット。回避は行わない。 */
export const aggressiveBot: Bot = (state, self) => {
  const me = state.players[self];
  if (me.attack || me.dodge || me.stunTicks > 0) return NO_INPUT;

  const dist = distance(state, self);
  if (dist <= ATTACKS.light.range) {
    return { move: { x: 0, z: 0 }, dodge: false, attack: 'light' };
  }
  if (dist <= ATTACKS.heavy.range) {
    return { move: { x: 0, z: 0 }, dodge: false, attack: 'heavy' };
  }
  // 範囲外: 相手へ向かって前進して接近する
  return { move: towardOpponent(state, self), dodge: false, attack: null };
};

/**
 * 相手の攻撃が active になる reactionDelay tick 前に回避を試みるボット。
 * reactionDelay <= JUST.window(7)であれば常にジャスト回避が成立する。
 *
 * 相手が攻撃中でない間は迂闊に攻撃を出さず待機する。常に攻め込むと自分も
 * 攻撃モーション中に行動不能となり、回避の機会を失ってしまうため。
 * 相手が(ジャスト回避による硬直などで)無防備な間合い内にいる場合のみ攻撃する。
 */
export function reactiveBot(reactionDelay: number): Bot {
  return (state, self) => {
    const me = state.players[self];
    const opp = state.players[1 - self];
    if (me.attack || me.dodge || me.stunTicks > 0) return NO_INPUT;

    if (opp.attack && !opp.attack.hasHit) {
      const spec = ATTACKS[opp.attack.kind];
      const ticksUntilActive = spec.windup - opp.attack.elapsed;
      const canDodge = me.dodgeCooldown === 0 && me.stamina >= DODGE.staminaCost;
      if (ticksUntilActive >= 0 && ticksUntilActive <= reactionDelay && canDodge) {
        // move 0 = 入力なし → バックステップ方向(相手と反対)へダッシュする
        return { move: { x: 0, z: 0 }, dodge: true, attack: null };
      }
    }

    const dist = distance(state, self);
    if (dist > ATTACKS.light.range) {
      return { move: towardOpponent(state, self), dodge: false, attack: null };
    }
    if (dist <= ATTACKS.light.range && opp.attack === null && opp.stunTicks > 0) {
      return { move: { x: 0, z: 0 }, dodge: false, attack: 'light' };
    }
    return NO_INPUT;
  };
}

/**
 * 対人プレイ用の CPU 操作ボット。 `reactiveBot` をベースに、
 * - ジャスト回避の反応をたまにサボる(skipReactionChance で確率的に無視)
 * - 間合いの維持(詰めすぎ/離れすぎを調整)
 * - 相手が硬直/空振り中の好機に攻撃を入れる
 * - 時々サイドステップで相手の周りを回り込む(arc 外しを誘う)
 * という「勝てるけど完璧ではない」プレイを行う。
 *
 * Math.random を使うため非決定的。simulate.ts のヘッドレス対戦では使用しないこと。
 */
/**
 * cpuBot のプリセット難易度。
 * - easy: 反応が遅く、サボりがちで間合いの調整も粗い。
 * - normal: デフォルト(`cpuBot()` の既定値と同じ)。
 * - hard: 反応が早く、サボりが少ない(が `JUST.window`(7)以内なので
 *   依然としてジャスト回避自体は反応次第で防げる)。
 */
export const CPU_DIFFICULTIES = {
  easy: { reactionDelay: 9, skipReactionChance: 0.6 },
  normal: { reactionDelay: 6, skipReactionChance: 0.35 },
  hard: { reactionDelay: 4, skipReactionChance: 0.12 },
} as const satisfies Record<string, { reactionDelay: number; skipReactionChance: number }>;

export type CpuDifficulty = keyof typeof CPU_DIFFICULTIES;

export function cpuBot(reactionDelay = 6, skipReactionChance = 0.35): Bot {
  return (state, self) => {
    const me = state.players[self];
    const opp = state.players[1 - self];
    if (me.attack || me.dodge || me.stunTicks > 0) return NO_INPUT;

    // 相手の攻撃に反応して回避する(確率的にサボる = 完璧ではない)
    if (opp.attack && !opp.attack.hasHit) {
      const spec = ATTACKS[opp.attack.kind];
      const ticksUntilActive = spec.windup - opp.attack.elapsed;
      const canDodge = me.dodgeCooldown === 0 && me.stamina >= DODGE.staminaCost;
      if (
        ticksUntilActive >= 0 &&
        ticksUntilActive <= reactionDelay &&
        canDodge &&
        Math.random() >= skipReactionChance
      ) {
        // たまにサイドステップしながら回避する(回避方向に横移動を混ぜる)
        if (Math.random() < 0.4) {
          const side = perpendicular(towardOpponent(state, self));
          const s = Math.random() < 0.5 ? 1 : -1;
          return { move: { x: side.x * s, z: side.z * s }, dodge: true, attack: null };
        }
        return { move: { x: 0, z: 0 }, dodge: true, attack: null };
      }
    }

    const dist = distance(state, self);
    const lightRange = ATTACKS.light.range;
    const toward = towardOpponent(state, self);

    // 相手が硬直中(ジャスト回避で隙ができた)、または攻撃の空振り直後で
    // 間合い内なら攻め込む。
    if (dist <= lightRange && opp.attack === null && opp.stunTicks > 0) {
      return { move: { x: 0, z: 0 }, dodge: false, attack: Math.random() < 0.5 ? 'heavy' : 'light' };
    }

    // 間合いの維持: 近すぎたら離れ、遠すぎたら詰める。
    // 適度な距離ならランダムに軽攻撃を打ち込んだり、サイドステップで回り込む。
    if (dist > lightRange + 20) {
      return { move: toward, dodge: false, attack: null };
    }
    if (dist < lightRange - 30) {
      return { move: { x: -toward.x, z: -toward.z }, dodge: false, attack: null };
    }
    if (dist <= lightRange && opp.attack === null && Math.random() < 0.02) {
      const kind: AttackKind = Math.random() < 0.5 ? 'light' : 'heavy';
      return { move: { x: 0, z: 0 }, dodge: false, attack: kind };
    }
    if (Math.random() < 0.03) {
      const side = perpendicular(toward);
      const s = Math.random() < 0.5 ? 1 : -1;
      return { move: { x: side.x * s, z: side.z * s }, dodge: false, attack: null };
    }

    return NO_INPUT;
  };
}
