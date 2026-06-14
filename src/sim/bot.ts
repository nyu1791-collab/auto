import { ATTACKS, DODGE } from '../engine/constants';
import type { AttackKind, GameState, PlayerId, PlayerInput } from '../engine/types';

export type Bot = (state: GameState, self: PlayerId) => PlayerInput;

const NO_INPUT: PlayerInput = { move: 0, dodge: false, jump: false, attack: null };

function distance(state: GameState, self: PlayerId): number {
  const a = state.players[self];
  const b = state.players[1 - self];
  return Math.abs(a.x - b.x);
}

/** 間合いを詰めて攻撃を出し続けるだけのボット。回避は行わない。 */
export const aggressiveBot: Bot = (state, self) => {
  const me = state.players[self];
  const opp = state.players[1 - self];
  if (me.attack || me.dodge || me.stunTicks > 0) return NO_INPUT;

  const dist = distance(state, self);
  const kind: AttackKind = dist <= ATTACKS.light.range ? 'light' : 'heavy';
  if (dist <= ATTACKS[kind].range) {
    return { move: 0, dodge: false, jump: false, attack: kind };
  }
  return { move: opp.x > me.x ? 1 : -1, dodge: false, jump: false, attack: null };
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
        return { move: 0, dodge: true, jump: false, attack: null };
      }
    }

    const dist = distance(state, self);
    if (dist > ATTACKS.light.range) {
      return { move: opp.x > me.x ? 1 : -1, dodge: false, jump: false, attack: null };
    }
    if (dist <= ATTACKS.light.range && opp.attack === null && opp.stunTicks > 0) {
      return { move: 0, dodge: false, jump: false, attack: 'light' };
    }
    return NO_INPUT;
  };
}

/**
 * 対人プレイ用の CPU 操作ボット。 `reactiveBot` をベースに、
 * - ジャスト回避の反応をたまにサボる(skipReactionChance で確率的に無視)
 * - 間合いの維持(詰めすぎ/離れすぎを調整)
 * - 相手が硬直/空振り中の好機に攻撃を入れる
 * という「勝てるけど完璧ではない」プレイを行う。
 *
 * Math.random を使うため非決定的。simulate.ts のヘッドレス対戦では使用しないこと。
 */
/**
 * cpuBot のプリセット難易度。
 * - easy: 反応が遅く、サボりがち。reactionDelay(10)を `JUST.window`(9)より大きく
 *   取ることで、easy CPU が回避してもダメージ無効どまりでプレイヤーを硬直させない
 *   (= ジャスト回避の反撃をもらわない)ため、初心者でも攻め込みやすい。
 * - normal: 標準。reactionDelay(6)≦ window なので反応したときはジャスト回避で
 *   こちらを硬直させてくる。
 * - hard: 反応が早く、サボりが少ない(reactionDelay(4)≦ window なので
 *   反応すればほぼジャスト回避で切り返してくる)。
 */
export const CPU_DIFFICULTIES = {
  easy: { reactionDelay: 10, skipReactionChance: 0.6 },
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
        return { move: 0, dodge: true, jump: false, attack: null };
      }
    }

    const dist = distance(state, self);
    const lightRange = ATTACKS.light.range;

    // 相手が硬直中(ジャスト回避で隙ができた)、または攻撃の空振り直後で
    // 間合い内なら攻め込む。
    if (dist <= lightRange && opp.attack === null && opp.stunTicks > 0) {
      return { move: 0, dodge: false, jump: false, attack: Math.random() < 0.5 ? 'heavy' : 'light' };
    }

    // 間合いの維持: 近すぎたら離れ、遠すぎたら詰める。
    // 適度な距離ならランダムに軽攻撃を打ち込んで隙を見せる。
    if (dist > lightRange + 20) {
      return { move: opp.x > me.x ? 1 : -1, dodge: false, jump: false, attack: null };
    }
    if (dist < lightRange - 30) {
      return { move: opp.x > me.x ? -1 : 1, dodge: false, jump: false, attack: null };
    }
    if (dist <= lightRange && opp.attack === null && Math.random() < 0.02) {
      return { move: 0, dodge: false, jump: false, attack: 'light' };
    }

    return NO_INPUT;
  };
}
