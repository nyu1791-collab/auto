import { ATTACKS, DODGE, JUST } from './constants';
import type { PlayerState } from './types';

export interface AttackOutcome {
  justDodge: boolean;
  defenderDamage?: number;
  attackerStun?: number;
  defenderStaminaRefund?: number;
}

/**
 * 攻撃側の攻撃が、この tick で防御側にヒットするかを判定する。
 * active フレーム外・間合い外・既にヒット済みの場合は null を返す。
 */
export function resolveAttackTick(
  attacker: PlayerState,
  defender: PlayerState,
  globalTick: number
): AttackOutcome | null {
  const atk = attacker.attack;
  if (!atk || atk.hasHit) return null;

  const spec = ATTACKS[atk.kind];
  const isActive = atk.elapsed >= spec.windup && atk.elapsed < spec.windup + spec.active;
  if (!isActive) return null;

  const distance = Math.abs(attacker.x - defender.x);
  if (distance > spec.range) return null;

  // 縦方向の間合い: 高さ差が大きい(相手がジャンプで飛び越えた)ときは当たらない
  const heightGap = Math.abs(attacker.y - defender.y);
  if (heightGap > spec.verticalRange) return null;

  if (defender.dodge && defender.dodge.elapsed < DODGE.iframes) {
    // この active フレームが最初に発生した tick(ジャスト判定の基準点)
    const activeStartTick = globalTick - (atk.elapsed - spec.windup);
    const diff = activeStartTick - defender.dodge.startedAtTick;
    if (diff >= 0 && diff <= JUST.window) {
      return {
        justDodge: true,
        attackerStun: JUST.stunTicks,
        defenderStaminaRefund: JUST.staminaRefund,
      };
    }
    return { justDodge: false };
  }

  return { justDodge: false, defenderDamage: spec.damage };
}
