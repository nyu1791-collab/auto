import { ATTACKS, DODGE } from '../engine/constants';
import type { AttackKind, GameState, PlayerId, PlayerInput } from '../engine/types';

export type Bot = (state: GameState, self: PlayerId) => PlayerInput;

const NO_INPUT: PlayerInput = { move: 0, dodge: false, attack: null };

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
    return { move: 0, dodge: false, attack: kind };
  }
  return { move: opp.x > me.x ? 1 : -1, dodge: false, attack: null };
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
        return { move: 0, dodge: true, attack: null };
      }
    }

    const dist = distance(state, self);
    if (dist > ATTACKS.light.range) {
      return { move: opp.x > me.x ? 1 : -1, dodge: false, attack: null };
    }
    if (dist <= ATTACKS.light.range && opp.attack === null && opp.stunTicks > 0) {
      return { move: 0, dodge: false, attack: 'light' };
    }
    return NO_INPUT;
  };
}
