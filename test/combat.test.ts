import { describe, expect, it } from 'vitest';
import { resolveAttackTick } from '../src/engine/combat';
import { ATTACKS, JUST, PLAYER } from '../src/engine/constants';
import type { PlayerState } from '../src/engine/types';

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 0,
    pos: { x: 0, z: 0 },
    facing: 0,
    hp: PLAYER.maxHp,
    stamina: PLAYER.maxStamina,
    attack: null,
    dodge: null,
    stunTicks: 0,
    dodgeCooldown: 0,
    roundsWon: 0,
    ...overrides,
  };
}

describe('resolveAttackTick', () => {
  it('returns null while the attack is still in windup', () => {
    const attacker = makePlayer({
      pos: { x: 0, z: 0 },
      attack: { kind: 'light', elapsed: ATTACKS.light.windup - 1, hasHit: false, aimAngle: 0 },
    });
    const defender = makePlayer({ pos: { x: 10, z: 0 } });

    expect(resolveAttackTick(attacker, defender, 100)).toBeNull();
  });

  it('returns null when the defender is out of range', () => {
    const attacker = makePlayer({
      pos: { x: 0, z: 0 },
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false, aimAngle: 0 },
    });
    const defender = makePlayer({ pos: { x: ATTACKS.light.range + 1, z: 0 } });

    expect(resolveAttackTick(attacker, defender, 100)).toBeNull();
  });

  it('returns null once the attack has already hit', () => {
    const attacker = makePlayer({
      pos: { x: 0, z: 0 },
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: true, aimAngle: 0 },
    });
    const defender = makePlayer({ pos: { x: 10, z: 0 } });

    expect(resolveAttackTick(attacker, defender, 100)).toBeNull();
  });

  it('deals damage when the defender has no active dodge', () => {
    const attacker = makePlayer({
      pos: { x: 0, z: 0 },
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false, aimAngle: 0 },
    });
    const defender = makePlayer({ pos: { x: 10, z: 0 } });

    const outcome = resolveAttackTick(attacker, defender, 100);
    expect(outcome).toEqual({ justDodge: false, defenderDamage: ATTACKS.light.damage });
  });

  it('returns null when the defender is outside the attack arc (side-step miss)', () => {
    // aimAngle は +x 方向(0)に固定。defender は真横(+z方向, 角度 π/2)に
    // 移動しており、arcHalfAngle を超えているため命中しない。
    const attacker = makePlayer({
      pos: { x: 0, z: 0 },
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false, aimAngle: 0 },
    });
    const defender = makePlayer({ pos: { x: 1, z: 50 } }); // angleToDefender ~ 1.55rad > arcHalfAngle(0.6)

    expect(resolveAttackTick(attacker, defender, 100)).toBeNull();
  });

  it('hits when the defender stays within the attack arc', () => {
    const attacker = makePlayer({
      pos: { x: 0, z: 0 },
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false, aimAngle: 0 },
    });
    // angleToDefender = atan2(10, 60) ~ 0.165rad, well within arcHalfAngle(0.6)
    const defender = makePlayer({ pos: { x: 60, z: 10 } });

    const outcome = resolveAttackTick(attacker, defender, 100);
    expect(outcome).toEqual({ justDodge: false, defenderDamage: ATTACKS.light.damage });
  });

  it('negates damage without reward when the dodge started too early', () => {
    const activeStartTick = 100;
    const attacker = makePlayer({
      pos: { x: 0, z: 0 },
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false, aimAngle: 0 },
    });
    const defender = makePlayer({
      pos: { x: 10, z: 0 },
      dodge: { elapsed: 0, startedAtTick: activeStartTick - JUST.window - 1, dirX: -1, dirZ: 0 },
    });

    const outcome = resolveAttackTick(attacker, defender, activeStartTick);
    expect(outcome).toEqual({ justDodge: false });
  });

  it('rewards a just dodge when started within the just window', () => {
    const activeStartTick = 100;
    const attacker = makePlayer({
      pos: { x: 0, z: 0 },
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false, aimAngle: 0 },
    });
    const defender = makePlayer({
      pos: { x: 10, z: 0 },
      dodge: { elapsed: 0, startedAtTick: activeStartTick - JUST.window, dirX: -1, dirZ: 0 },
    });

    const outcome = resolveAttackTick(attacker, defender, activeStartTick);
    expect(outcome).toEqual({
      justDodge: true,
      attackerStun: JUST.stunTicks,
      defenderStaminaRefund: JUST.staminaRefund,
    });
  });

  it('rewards a just dodge started exactly at the active-start tick', () => {
    const activeStartTick = 50;
    const attacker = makePlayer({
      pos: { x: 0, z: 0 },
      attack: { kind: 'heavy', elapsed: ATTACKS.heavy.windup, hasHit: false, aimAngle: 0 },
    });
    const defender = makePlayer({
      pos: { x: 10, z: 0 },
      dodge: { elapsed: 0, startedAtTick: activeStartTick, dirX: -1, dirZ: 0 },
    });

    const outcome = resolveAttackTick(attacker, defender, activeStartTick);
    expect(outcome?.justDodge).toBe(true);
  });

  it('does not negate damage once the i-frames have expired', () => {
    const attacker = makePlayer({
      pos: { x: 0, z: 0 },
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false, aimAngle: 0 },
    });
    const defender = makePlayer({
      pos: { x: 10, z: 0 },
      dodge: { elapsed: 11, startedAtTick: 0, dirX: -1, dirZ: 0 },
    });

    const outcome = resolveAttackTick(attacker, defender, 100);
    expect(outcome).toEqual({ justDodge: false, defenderDamage: ATTACKS.light.damage });
  });

  it('uses the second active frame correctly for active-start calculation', () => {
    const activeStartTick = 200;
    const attacker = makePlayer({
      pos: { x: 0, z: 0 },
      // elapsed is one tick into the active window
      attack: { kind: 'light', elapsed: ATTACKS.light.windup + 1, hasHit: false, aimAngle: 0 },
    });
    const defender = makePlayer({
      pos: { x: 10, z: 0 },
      dodge: { elapsed: 0, startedAtTick: activeStartTick, dirX: -1, dirZ: 0 },
    });

    // globalTick is one tick after activeStartTick, matching elapsed offset
    const outcome = resolveAttackTick(attacker, defender, activeStartTick + 1);
    expect(outcome?.justDodge).toBe(true);
  });
});
