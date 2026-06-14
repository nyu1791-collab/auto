import { describe, expect, it } from 'vitest';
import { resolveAttackTick } from '../src/engine/combat';
import { ATTACKS, DODGE, JUMP, JUST, PLAYER } from '../src/engine/constants';
import type { PlayerState } from '../src/engine/types';

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 0,
    x: 0,
    y: 0,
    vy: 0,
    airJumps: JUMP.airJumps,
    facing: 1,
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
      x: 0,
      attack: { kind: 'light', elapsed: ATTACKS.light.windup - 1, hasHit: false },
    });
    const defender = makePlayer({ x: 10 });

    expect(resolveAttackTick(attacker, defender, 100)).toBeNull();
  });

  it('returns null when the defender is out of range', () => {
    const attacker = makePlayer({
      x: 0,
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false },
    });
    const defender = makePlayer({ x: ATTACKS.light.range + 1 });

    expect(resolveAttackTick(attacker, defender, 100)).toBeNull();
  });

  it('returns null once the attack has already hit', () => {
    const attacker = makePlayer({
      x: 0,
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: true },
    });
    const defender = makePlayer({ x: 10 });

    expect(resolveAttackTick(attacker, defender, 100)).toBeNull();
  });

  it('deals damage when the defender has no active dodge', () => {
    const attacker = makePlayer({
      x: 0,
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false },
    });
    const defender = makePlayer({ x: 10 });

    const outcome = resolveAttackTick(attacker, defender, 100);
    expect(outcome).toEqual({ justDodge: false, defenderDamage: ATTACKS.light.damage });
  });

  it('negates damage without reward when the dodge started too early', () => {
    const activeStartTick = 100;
    const attacker = makePlayer({
      x: 0,
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false },
    });
    const defender = makePlayer({
      x: 10,
      dodge: { elapsed: 0, startedAtTick: activeStartTick - JUST.window - 1 },
    });

    const outcome = resolveAttackTick(attacker, defender, activeStartTick);
    expect(outcome).toEqual({ justDodge: false });
  });

  it('rewards a just dodge when started within the just window', () => {
    const activeStartTick = 100;
    const attacker = makePlayer({
      x: 0,
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false },
    });
    const defender = makePlayer({
      x: 10,
      dodge: { elapsed: 0, startedAtTick: activeStartTick - JUST.window },
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
      x: 0,
      attack: { kind: 'heavy', elapsed: ATTACKS.heavy.windup, hasHit: false },
    });
    const defender = makePlayer({
      x: 10,
      dodge: { elapsed: 0, startedAtTick: activeStartTick },
    });

    const outcome = resolveAttackTick(attacker, defender, activeStartTick);
    expect(outcome?.justDodge).toBe(true);
  });

  it('does not negate damage once the i-frames have expired', () => {
    const attacker = makePlayer({
      x: 0,
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false },
    });
    const defender = makePlayer({
      x: 10,
      dodge: { elapsed: DODGE.iframes, startedAtTick: 0 }, // i-frame 終了直後(elapsed >= iframes)
    });

    const outcome = resolveAttackTick(attacker, defender, 100);
    expect(outcome).toEqual({ justDodge: false, defenderDamage: ATTACKS.light.damage });
  });

  it('misses when the defender has jumped over the attack (height gap exceeds verticalRange)', () => {
    const attacker = makePlayer({
      x: 0,
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false },
    });
    const defender = makePlayer({ x: 10, y: ATTACKS.light.verticalRange + 1 });

    expect(resolveAttackTick(attacker, defender, 100)).toBeNull();
  });

  it('hits when the height gap is within verticalRange', () => {
    const attacker = makePlayer({
      x: 0,
      attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false },
    });
    const defender = makePlayer({ x: 10, y: ATTACKS.light.verticalRange });

    const outcome = resolveAttackTick(attacker, defender, 100);
    expect(outcome).toEqual({ justDodge: false, defenderDamage: ATTACKS.light.damage });
  });

  it('uses the second active frame correctly for active-start calculation', () => {
    const activeStartTick = 200;
    const attacker = makePlayer({
      x: 0,
      // elapsed is one tick into the active window
      attack: { kind: 'light', elapsed: ATTACKS.light.windup + 1, hasHit: false },
    });
    const defender = makePlayer({
      x: 10,
      dodge: { elapsed: 0, startedAtTick: activeStartTick },
    });

    // globalTick is one tick after activeStartTick, matching elapsed offset
    const outcome = resolveAttackTick(attacker, defender, activeStartTick + 1);
    expect(outcome?.justDodge).toBe(true);
  });
});
