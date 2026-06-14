import { describe, expect, it } from 'vitest';
import { step } from '../src/engine/engine';
import { ARENA, ATTACKS, DODGE, JUST, MATCH, PLAYER, TPS } from '../src/engine/constants';
import { createInitialState } from '../src/engine/state';
import type { GameState, Inputs, PlayerInput, PlayerState } from '../src/engine/types';

const NO_INPUT: PlayerInput = { move: 0, dodge: false, attack: null };

function makePlayer(id: 0 | 1, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    x: 0,
    facing: id === 0 ? 1 : -1,
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

function makeState(
  p0: Partial<PlayerState>,
  p1: Partial<PlayerState>,
  extra: Partial<GameState> = {}
): GameState {
  return {
    tick: 0,
    roundTick: 0,
    players: [makePlayer(0, p0), makePlayer(1, p1)],
    phase: 'fighting',
    winner: null,
    ...extra,
  };
}

function inputs(p0: Partial<PlayerInput> = {}, p1: Partial<PlayerInput> = {}): Inputs {
  return [{ ...NO_INPUT, ...p0 }, { ...NO_INPUT, ...p1 }];
}

describe('createInitialState', () => {
  it('starts both players at full hp/stamina in the fighting phase', () => {
    const state = createInitialState();
    expect(state.players[0].hp).toBe(PLAYER.maxHp);
    expect(state.players[1].hp).toBe(PLAYER.maxHp);
    expect(state.players[0].stamina).toBe(PLAYER.maxStamina);
    expect(state.phase).toBe('fighting');
  });
});

describe('movement', () => {
  it('moves a player according to input', () => {
    const state = makeState({ x: 100 }, { x: 300 });
    const next = step(state, inputs({ move: 1 }));
    expect(next.players[0].x).toBe(100 + PLAYER.moveSpeed);
  });

  it('clamps movement to the arena bounds', () => {
    const left = makeState({ x: 0 }, { x: 300 });
    expect(step(left, inputs({ move: -1 })).players[0].x).toBe(0);

    const right = makeState({ x: ARENA.width - ARENA.playerSize }, { x: 300 });
    expect(step(right, inputs({ move: 1 })).players[0].x).toBe(ARENA.width - ARENA.playerSize);
  });
});

describe('attack lifecycle', () => {
  it('starts an attack, locks movement, and returns to neutral after recovery', () => {
    let state = makeState({ x: 100 }, { x: 500 });
    state = step(state, inputs({ attack: 'light' }));
    expect(state.players[0].attack).toEqual({ kind: 'light', elapsed: 1, hasHit: false });

    const xWhileAttacking = state.players[0].x;
    state = step(state, inputs({ move: 1 }));
    expect(state.players[0].x).toBe(xWhileAttacking);

    const total = ATTACKS.light.windup + ATTACKS.light.active + ATTACKS.light.recovery;
    for (let i = 0; i < total + 2; i++) {
      state = step(state, inputs());
    }
    expect(state.players[0].attack).toBeNull();
  });
});

describe('dodge', () => {
  it('consumes stamina and dashes away from the opponent during i-frames', () => {
    const state = makeState({ x: 100 }, { x: 300 });
    const next = step(state, inputs({ dodge: true }));

    expect(next.players[0].dodge).toEqual({ elapsed: 1, startedAtTick: 0 });
    expect(next.players[0].x).toBe(100 - DODGE.dashSpeed);
    expect(next.players[0].stamina).toBeCloseTo(
      PLAYER.maxStamina - DODGE.staminaCost + PLAYER.staminaRegenPerTick
    );
  });

  it('cannot dodge without enough stamina', () => {
    const state = makeState({ x: 100, stamina: DODGE.staminaCost - 1 }, { x: 300 });
    const next = step(state, inputs({ dodge: true }));
    expect(next.players[0].dodge).toBeNull();
  });

  it('enters cooldown after the dodge animation completes', () => {
    let state = makeState({ x: 100 }, { x: 300 });
    state = step(state, inputs({ dodge: true }));
    for (let i = 1; i < DODGE.duration; i++) {
      state = step(state, inputs());
    }
    expect(state.players[0].dodge).toBeNull();
    expect(state.players[0].dodgeCooldown).toBe(DODGE.cooldown);
  });
});

describe('stamina regen', () => {
  it('regenerates roughly 25 per second', () => {
    let state = makeState({ x: 100, stamina: 50 }, { x: 300 });
    for (let i = 0; i < TPS; i++) {
      state = step(state, inputs());
    }
    expect(state.players[0].stamina).toBeCloseTo(75, 1);
  });

  it('caps stamina at maxStamina', () => {
    const state = makeState({ x: 100, stamina: PLAYER.maxStamina }, { x: 300 });
    const next = step(state, inputs());
    expect(next.players[0].stamina).toBe(PLAYER.maxStamina);
  });
});

describe('hit resolution', () => {
  it('deals damage once on the first active frame and not again on the second', () => {
    const distance = ATTACKS.light.range - 5;
    let state = makeState({ x: 100 }, { x: 100 + distance });
    state = step(state, inputs({ attack: 'light' })); // step 1

    for (let i = 0; i < ATTACKS.light.windup - 1; i++) {
      state = step(state, inputs()); // steps 2..windup
    }
    expect(state.players[1].hp).toBe(PLAYER.maxHp); // not active yet

    state = step(state, inputs()); // first active step
    expect(state.players[1].hp).toBe(PLAYER.maxHp - ATTACKS.light.damage);

    state = step(state, inputs()); // second active step
    expect(state.players[1].hp).toBe(PLAYER.maxHp - ATTACKS.light.damage); // no double hit
  });

  it('does not deal damage when the defender is out of range', () => {
    let state = makeState({ x: 0 }, { x: ATTACKS.light.range + 50 });
    state = step(state, inputs({ attack: 'light' }));
    for (let i = 0; i < ATTACKS.light.windup; i++) {
      state = step(state, inputs());
    }
    expect(state.players[1].hp).toBe(PLAYER.maxHp);
  });
});

describe('just dodge', () => {
  it('negates damage, stuns the attacker, and fully refunds stamina', () => {
    let state = makeState({ x: 0 }, { x: ATTACKS.light.range });
    state = step(state, inputs({ attack: 'light' })); // step 1

    for (let i = 0; i < 8; i++) {
      state = step(state, inputs()); // steps 2..9
    }

    state = step(state, inputs({}, { dodge: true })); // step 10: just dodge

    expect(state.players[1].hp).toBe(PLAYER.maxHp);
    expect(state.players[0].stunTicks).toBe(JUST.stunTicks);
    expect(state.players[1].stamina).toBe(PLAYER.maxStamina);
  });

  it('negates damage without reward when the dodge started too early', () => {
    // attack is on its first active frame this tick (elapsed === windup),
    // but the defender's dodge started JUST.window + 1 ticks before activeStartTick
    const state = makeState(
      { x: 0, attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false } },
      { x: ATTACKS.light.range, dodge: { elapsed: 5, startedAtTick: 0 }, stamina: 50 },
      { tick: JUST.window + 1 }
    );

    const next = step(state, inputs());

    expect(next.players[1].hp).toBe(PLAYER.maxHp); // negated by i-frame
    expect(next.players[0].stunTicks).toBe(0); // no just-dodge reward
    expect(next.players[1].stamina).toBeCloseTo(50 + PLAYER.staminaRegenPerTick); // no refund
  });
});

describe('round and match progression', () => {
  function lethalHitSetup(p0RoundsWon: number, p1Hp: number): GameState {
    return makeState({ x: 0, roundsWon: p0RoundsWon }, { x: ATTACKS.light.range, hp: p1Hp });
  }

  function landHit(state: GameState): GameState {
    state = step(state, inputs({ attack: 'light' })); // step 1
    for (let i = 0; i < 8; i++) {
      state = step(state, inputs()); // steps 2..9
    }
    return step(state, inputs()); // step 10: active hit
  }

  it('ends the round and awards roundsWon on a KO', () => {
    const state = landHit(lethalHitSetup(0, ATTACKS.light.damage));
    expect(state.players[1].hp).toBe(0);
    expect(state.players[0].roundsWon).toBe(1);
    expect(state.phase).toBe('roundOver');
    expect(state.winner).toBe(0);
  });

  it('resets for the next round while preserving roundsWon', () => {
    let state = landHit(lethalHitSetup(0, ATTACKS.light.damage));
    state = step(state, inputs());
    expect(state.phase).toBe('fighting');
    expect(state.players[0].roundsWon).toBe(1);
    expect(state.players[1].hp).toBe(PLAYER.maxHp);
    expect(state.roundTick).toBe(0);
  });

  it('ends the match once a player reaches roundsToWin', () => {
    const state = landHit(lethalHitSetup(MATCH.roundsToWin - 1, ATTACKS.light.damage));
    expect(state.phase).toBe('matchOver');
    expect(state.winner).toBe(0);
    expect(state.players[0].roundsWon).toBe(MATCH.roundsToWin);
  });

  it('is a no-op once the match is over', () => {
    const state = landHit(lethalHitSetup(MATCH.roundsToWin - 1, ATTACKS.light.damage));
    const next = step(state, inputs({ move: 1 }));
    expect(next).toEqual(state);
  });
});

describe('round time limit', () => {
  it('ends the round by HP comparison when time runs out', () => {
    const state = makeState({ x: 0, hp: 80 }, { x: 300, hp: 50 }, {
      roundTick: MATCH.roundSeconds * TPS - 1,
    });
    const next = step(state, inputs());
    expect(next.phase).toBe('roundOver');
    expect(next.winner).toBe(0);
  });

  it('declares a draw round when hp is equal at the time limit', () => {
    const state = makeState({ x: 0, hp: 50 }, { x: 300, hp: 50 }, {
      roundTick: MATCH.roundSeconds * TPS - 1,
    });
    const next = step(state, inputs());
    expect(next.phase).toBe('roundOver');
    expect(next.winner).toBeNull();
  });
});
