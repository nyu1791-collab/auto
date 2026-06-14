import { describe, expect, it } from 'vitest';
import { step } from '../src/engine/engine';
import { ARENA, ATTACKS, DODGE, JUST, MATCH, PLAYER, TPS } from '../src/engine/constants';
import { createInitialState } from '../src/engine/state';
import type { GameState, Inputs, PlayerInput, PlayerState, Vec2 } from '../src/engine/types';

const NO_INPUT: PlayerInput = { move: { x: 0, z: 0 }, dodge: false, attack: null };

function makePlayer(id: 0 | 1, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    pos: { x: 0, z: 0 },
    facing: id === 0 ? 0 : Math.PI,
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
    phaseTimer: 0,
    ...extra,
  };
}

function inputs(p0: Partial<PlayerInput> = {}, p1: Partial<PlayerInput> = {}): Inputs {
  return [
    { ...NO_INPUT, ...p0, move: { ...NO_INPUT.move, ...p0.move } },
    { ...NO_INPUT, ...p1, move: { ...NO_INPUT.move, ...p1.move } },
  ];
}

describe('createInitialState', () => {
  it('starts both players at full hp/stamina in the starting phase', () => {
    const state = createInitialState();
    expect(state.players[0].hp).toBe(PLAYER.maxHp);
    expect(state.players[1].hp).toBe(PLAYER.maxHp);
    expect(state.players[0].stamina).toBe(PLAYER.maxStamina);
    expect(state.phase).toBe('starting');
    expect(state.phaseTimer).toBe(MATCH.startCountdownTicks);
  });

  it('faces both players toward each other along the x axis', () => {
    const state = createInitialState();
    // P0 は -x 側、P1 は +x 側にいるため、互いに向き合う facing は 0 / π
    expect(state.players[0].pos).toEqual({ x: -180, z: 0 });
    expect(state.players[1].pos).toEqual({ x: 180, z: 0 });
    expect(state.players[0].facing).toBeCloseTo(0);
    expect(state.players[1].facing).toBeCloseTo(Math.PI);
  });
});

describe('movement', () => {
  it('moves in world +x (screen right), independent of facing', () => {
    const state = makeState({ pos: { x: -180, z: 0 }, facing: 0 }, { pos: { x: 180, z: 0 } });
    const next = step(state, inputs({ move: { x: 1, z: 0 } }));
    expect(next.players[0].pos.x).toBeCloseTo(-180 + PLAYER.moveSpeed);
    expect(next.players[0].pos.z).toBeCloseTo(0);
  });

  it('moves in world -x with negative x input', () => {
    const state = makeState({ pos: { x: -180, z: 0 }, facing: 0 }, { pos: { x: 180, z: 0 } });
    const next = step(state, inputs({ move: { x: -1, z: 0 } }));
    expect(next.players[0].pos.x).toBeCloseTo(-180 - PLAYER.moveSpeed);
  });

  it('moves in world -z (into the screen) to side-step', () => {
    const state = makeState({ pos: { x: -180, z: 0 }, facing: 0 }, { pos: { x: 180, z: 0 } });
    const next = step(state, inputs({ move: { x: 0, z: -1 } }));
    expect(next.players[0].pos.x).toBeCloseTo(-180);
    expect(next.players[0].pos.z).toBeCloseTo(0 - PLAYER.moveSpeed);
  });

  it('normalizes diagonal input to unit length', () => {
    const state = makeState({ pos: { x: -180, z: 0 }, facing: 0 }, { pos: { x: 180, z: 0 } });
    const next = step(state, inputs({ move: { x: 1, z: 1 } }));
    const dx = next.players[0].pos.x - -180;
    const dz = next.players[0].pos.z - 0;
    expect(Math.hypot(dx, dz)).toBeCloseTo(PLAYER.moveSpeed);
  });

  it('clamps movement to the circular arena bounds', () => {
    const limit = ARENA.radius - ARENA.playerRadius;
    // すでに境界上にいて、外側(+x)へ向かう入力を与える
    const pos: Vec2 = { x: limit, z: 0 };
    const state = makeState({ pos, facing: 0 }, { pos: { x: -limit, z: 0 } });
    const next = step(state, inputs({ move: { x: 1, z: 0 } }));
    const dist = Math.hypot(next.players[0].pos.x, next.players[0].pos.z);
    expect(dist).toBeLessThanOrEqual(limit + 1e-9);
  });
});

describe('lock-on facing', () => {
  it('updates facing to point toward the opponent every tick', () => {
    // P0 を P1 の真横(+z 方向)に配置し直す
    const state = makeState({ pos: { x: 0, z: -50 }, facing: 0 }, { pos: { x: 0, z: 50 }, facing: Math.PI });
    const next = step(state, inputs());
    // P0 から見て P1 は +z 方向 → facing = atan2(100, 0) = π/2
    expect(next.players[0].facing).toBeCloseTo(Math.PI / 2);
    // P1 から見て P0 は -z 方向 → facing = atan2(-100, 0) = -π/2
    expect(next.players[1].facing).toBeCloseTo(-Math.PI / 2);
  });
});

describe('attack lifecycle', () => {
  it('starts an attack, commits aimAngle, locks movement, and returns to neutral after recovery', () => {
    let state = makeState({ pos: { x: -180, z: 0 }, facing: 0 }, { pos: { x: 180, z: 0 } });
    state = step(state, inputs({ attack: 'light' }));
    expect(state.players[0].attack).toEqual({ kind: 'light', elapsed: 1, hasHit: false, aimAngle: 0 });

    const posWhileAttacking = { ...state.players[0].pos };
    state = step(state, inputs({ move: { x: 1, z: 0 } }));
    expect(state.players[0].pos).toEqual(posWhileAttacking);

    const total = ATTACKS.light.windup + ATTACKS.light.active + ATTACKS.light.recovery;
    for (let i = 0; i < total + 2; i++) {
      state = step(state, inputs());
    }
    expect(state.players[0].attack).toBeNull();
  });
});

describe('dodge', () => {
  it('consumes stamina and dashes backward (away from opponent) when no move input is given', () => {
    const state = makeState({ pos: { x: -180, z: 0 }, facing: 0 }, { pos: { x: 180, z: 0 } });
    const next = step(state, inputs({ dodge: true }));

    expect(next.players[0].dodge).toMatchObject({ elapsed: 1, startedAtTick: 0 });
    // 入力なし → facingVec の反対(バックステップ): facing=0 → facingVec=(1,0) → dir=(-1,0)
    expect(next.players[0].dodge?.dirX).toBeCloseTo(-1);
    expect(next.players[0].dodge?.dirZ).toBeCloseTo(0);
    expect(next.players[0].pos.x).toBeCloseTo(-180 - DODGE.dashSpeed);
    expect(next.players[0].stamina).toBeCloseTo(
      PLAYER.maxStamina - DODGE.staminaCost + PLAYER.staminaRegenPerTick
    );
  });

  it('dashes in the direction of move input when given', () => {
    // 移動入力 {x:0, z:-1}(画面奥)へダッシュする
    const state = makeState({ pos: { x: -180, z: 0 }, facing: 0 }, { pos: { x: 180, z: 0 } });
    const next = step(state, inputs({ dodge: true, move: { x: 0, z: -1 } }));

    expect(next.players[0].dodge?.dirX).toBeCloseTo(0);
    expect(next.players[0].dodge?.dirZ).toBeCloseTo(-1);
    expect(next.players[0].pos.z).toBeCloseTo(0 - DODGE.dashSpeed);
  });

  it('cannot dodge without enough stamina', () => {
    const state = makeState(
      { pos: { x: -180, z: 0 }, facing: 0, stamina: DODGE.staminaCost - 1 },
      { pos: { x: 180, z: 0 } }
    );
    const next = step(state, inputs({ dodge: true }));
    expect(next.players[0].dodge).toBeNull();
  });

  it('enters cooldown after the dodge animation completes', () => {
    let state = makeState({ pos: { x: -180, z: 0 }, facing: 0 }, { pos: { x: 180, z: 0 } });
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
    let state = makeState({ pos: { x: -180, z: 0 }, facing: 0, stamina: 50 }, { pos: { x: 180, z: 0 } });
    for (let i = 0; i < TPS; i++) {
      state = step(state, inputs());
    }
    expect(state.players[0].stamina).toBeCloseTo(75, 1);
  });

  it('caps stamina at maxStamina', () => {
    const state = makeState(
      { pos: { x: -180, z: 0 }, facing: 0, stamina: PLAYER.maxStamina },
      { pos: { x: 180, z: 0 } }
    );
    const next = step(state, inputs());
    expect(next.players[0].stamina).toBe(PLAYER.maxStamina);
  });
});

describe('hit resolution', () => {
  it('deals damage once on the first active frame and not again on the second', () => {
    const dist = ATTACKS.light.range - 5;
    let state = makeState({ pos: { x: 0, z: 0 }, facing: 0 }, { pos: { x: dist, z: 0 }, facing: Math.PI });
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
    let state = makeState(
      { pos: { x: 0, z: 0 }, facing: 0 },
      { pos: { x: ATTACKS.light.range + 50, z: 0 }, facing: Math.PI }
    );
    state = step(state, inputs({ attack: 'light' }));
    for (let i = 0; i < ATTACKS.light.windup; i++) {
      state = step(state, inputs());
    }
    expect(state.players[1].hp).toBe(PLAYER.maxHp);
  });

  it('misses when the defender side-steps out of the attack arc', () => {
    // 攻撃開始時、相手は正面(facing=0, aimAngle=0)の射程内にいる。
    // windup 中に相手が真横へサイドステップして移動し、active 時には
    // aimAngle との角度差が arcHalfAngle を超えるようにする。
    let state = makeState(
      { pos: { x: 0, z: 0 }, facing: 0 },
      { pos: { x: 30, z: 0 }, facing: Math.PI, dodgeCooldown: 0 }
    );
    state = step(state, inputs({ attack: 'light' })); // step 1: aimAngle = 0 固定

    // P1 は +z 方向(画面手前)へサイドステップし続け、攻撃の扇(aimAngle=0)の外へ出る
    for (let i = 0; i < ATTACKS.light.windup - 1; i++) {
      state = step(state, inputs({}, { move: { x: 0, z: 1 } }));
    }

    const before = state.players[1].hp;
    state = step(state, inputs({}, { move: { x: 0, z: 1 } })); // first active step
    expect(state.players[1].hp).toBe(before); // arc 外で空振り
  });
});

describe('just dodge', () => {
  it('negates damage, stuns the attacker, and fully refunds stamina', () => {
    let state = makeState(
      { pos: { x: 0, z: 0 }, facing: 0 },
      { pos: { x: ATTACKS.light.range, z: 0 }, facing: Math.PI }
    );
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
      {
        pos: { x: 0, z: 0 },
        facing: 0,
        attack: { kind: 'light', elapsed: ATTACKS.light.windup, hasHit: false, aimAngle: 0 },
      },
      {
        pos: { x: ATTACKS.light.range, z: 0 },
        facing: Math.PI,
        dodge: { elapsed: 5, startedAtTick: 0, dirX: 1, dirZ: 0 },
        stamina: 50,
      },
      { tick: JUST.window + 1 }
    );

    const next = step(state, inputs());

    expect(next.players[1].hp).toBe(PLAYER.maxHp); // negated by i-frame
    expect(next.players[0].stunTicks).toBe(0); // no just-dodge reward
    expect(next.players[1].stamina).toBeCloseTo(50 + PLAYER.staminaRegenPerTick); // no refund
  });
});

describe('starting phase', () => {
  it('ignores inputs and counts down to fighting', () => {
    let state = createInitialState();
    expect(state.phase).toBe('starting');
    expect(state.roundTick).toBe(0);

    const startPos = { ...state.players[0].pos };
    state = step(state, inputs({ move: { x: 1, z: 0 }, attack: 'light', dodge: true }));
    expect(state.phase).toBe('starting');
    expect(state.phaseTimer).toBe(MATCH.startCountdownTicks - 1);
    expect(state.players[0].pos).toEqual(startPos);
    expect(state.players[0].attack).toBeNull();
    expect(state.players[0].dodge).toBeNull();
    expect(state.roundTick).toBe(0);

    for (let i = 0; i < MATCH.startCountdownTicks - 1; i++) {
      state = step(state, inputs());
    }
    expect(state.phase).toBe('fighting');
    expect(state.phaseTimer).toBe(0);
  });
});

describe('round and match progression', () => {
  function lethalHitSetup(p0RoundsWon: number, p1Hp: number): GameState {
    return makeState(
      { pos: { x: 0, z: 0 }, facing: 0, roundsWon: p0RoundsWon },
      { pos: { x: ATTACKS.light.range, z: 0 }, facing: Math.PI, hp: p1Hp }
    );
  }

  function landHit(state: GameState): GameState {
    state = step(state, inputs({ attack: 'light' })); // step 1
    for (let i = 0; i < 8; i++) {
      state = step(state, inputs()); // steps 2..9
    }
    return step(state, inputs()); // step 10: active hit
  }

  function runRoundOver(state: GameState): GameState {
    for (let i = 0; i < MATCH.roundEndFreezeTicks; i++) {
      state = step(state, inputs());
    }
    return state;
  }

  it('ends the round, awards roundsWon, and freezes on roundOver', () => {
    const state = landHit(lethalHitSetup(0, ATTACKS.light.damage));
    expect(state.players[1].hp).toBe(0);
    expect(state.players[0].roundsWon).toBe(1);
    expect(state.phase).toBe('roundOver');
    expect(state.winner).toBe(0);
    expect(state.phaseTimer).toBe(MATCH.roundEndFreezeTicks);
  });

  it('ignores inputs while frozen on roundOver', () => {
    let state = landHit(lethalHitSetup(0, ATTACKS.light.damage));
    const before = { ...state.players[1].pos };
    state = step(state, inputs({ move: { x: 1, z: 0 } }, { move: { x: -1, z: 0 } }));
    expect(state.phase).toBe('roundOver');
    expect(state.phaseTimer).toBe(MATCH.roundEndFreezeTicks - 1);
    expect(state.players[1].pos).toEqual(before);
  });

  it('after the roundOver freeze, starts the next round (preserving roundsWon) then fights', () => {
    let state = landHit(lethalHitSetup(0, ATTACKS.light.damage));
    state = runRoundOver(state);

    expect(state.phase).toBe('starting');
    expect(state.phaseTimer).toBe(MATCH.startCountdownTicks);
    expect(state.players[0].roundsWon).toBe(1);
    expect(state.players[1].hp).toBe(PLAYER.maxHp);
    expect(state.roundTick).toBe(0);

    for (let i = 0; i < MATCH.startCountdownTicks; i++) {
      state = step(state, inputs());
    }
    expect(state.phase).toBe('fighting');
  });

  it('ends the match once a player reaches roundsToWin, after the roundOver freeze', () => {
    let state = landHit(lethalHitSetup(MATCH.roundsToWin - 1, ATTACKS.light.damage));
    expect(state.phase).toBe('roundOver');
    expect(state.winner).toBe(0);
    expect(state.players[0].roundsWon).toBe(MATCH.roundsToWin);

    state = runRoundOver(state);
    expect(state.phase).toBe('matchOver');
    expect(state.winner).toBe(0);
  });

  it('is a no-op once the match is over', () => {
    let state = landHit(lethalHitSetup(MATCH.roundsToWin - 1, ATTACKS.light.damage));
    state = runRoundOver(state);
    expect(state.phase).toBe('matchOver');

    const next = step(state, inputs({ move: { x: 1, z: 0 } }));
    expect(next).toEqual(state);
  });
});

describe('round time limit', () => {
  it('ends the round by HP comparison when time runs out', () => {
    const state = makeState(
      { pos: { x: 0, z: 0 }, facing: 0, hp: 80 },
      { pos: { x: 300, z: 0 }, facing: Math.PI, hp: 50 },
      { roundTick: MATCH.roundSeconds * TPS - 1 }
    );
    const next = step(state, inputs());
    expect(next.phase).toBe('roundOver');
    expect(next.winner).toBe(0);
  });

  it('declares a draw round when hp is equal at the time limit', () => {
    const state = makeState(
      { pos: { x: 0, z: 0 }, facing: 0, hp: 50 },
      { pos: { x: 300, z: 0 }, facing: Math.PI, hp: 50 },
      { roundTick: MATCH.roundSeconds * TPS - 1 }
    );
    const next = step(state, inputs());
    expect(next.phase).toBe('roundOver');
    expect(next.winner).toBeNull();
  });
});
