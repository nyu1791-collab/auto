import { ATTACKS, DODGE, JUST } from './constants';
import type { PlayerState } from './types';

export interface AttackOutcome {
  justDodge: boolean;
  defenderDamage?: number;
  attackerStun?: number;
  defenderStaminaRefund?: number;
}

/** 角度差を [-π, π] に正規化する */
function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * 攻撃側の攻撃が、この tick で防御側にヒットするかを判定する。
 * active フレーム外・間合い外・扇形(arc)外・既にヒット済みの場合は null を返す。
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

  const dx = defender.pos.x - attacker.pos.x;
  const dz = defender.pos.z - attacker.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > spec.range) return null;

  // 攻撃開始時に固定した方向(aimAngle)と、現在の相手方向の差が
  // arcHalfAngle を超えていれば命中しない(サイドステップで回避成功)。
  const angleToDefender = Math.atan2(dz, dx);
  const delta = normalizeAngle(angleToDefender - atk.aimAngle);
  if (Math.abs(delta) > spec.arcHalfAngle) return null;

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
