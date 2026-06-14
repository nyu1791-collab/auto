import { ARENA, ATTACKS, DODGE, MATCH, PLAYER, TPS } from './constants';
import { resolveAttackTick } from './combat';
import { resetRound } from './state';
import type { GameState, Inputs, PlayerState, Vec2 } from './types';

const MOVE_EPSILON = 1e-4;

function isLocked(p: PlayerState): boolean {
  return p.attack !== null || p.dodge !== null || p.stunTicks > 0;
}

/** 円形アリーナの拘束: プレイヤー中心を `hypot(x,z) <= radius - playerRadius` に収める */
function clampToArena(pos: Vec2): Vec2 {
  const limit = ARENA.radius - ARENA.playerRadius;
  const dist = Math.hypot(pos.x, pos.z);
  if (dist <= limit || dist === 0) return pos;
  const scale = limit / dist;
  return { x: pos.x * scale, z: pos.z * scale };
}

/** 1 tick 分の状態遷移。フェーズ終了後は呼び出し側が再度 step を呼ぶことで
 *  次ラウンド/試合終了の遷移が進む。 */
export function step(state: GameState, inputs: Inputs): GameState {
  if (state.phase === 'matchOver') return state;

  if (state.phase === 'starting') {
    const phaseTimer = state.phaseTimer - 1;
    if (phaseTimer <= 0) {
      return { ...state, phase: 'fighting', phaseTimer: 0 };
    }
    return { ...state, phaseTimer };
  }

  if (state.phase === 'roundOver') {
    const phaseTimer = state.phaseTimer - 1;
    if (phaseTimer <= 0) {
      const [p0, p1] = state.players;
      if (p0.roundsWon >= MATCH.roundsToWin || p1.roundsWon >= MATCH.roundsToWin) {
        const matchWinner: GameState['winner'] =
          p0.roundsWon >= MATCH.roundsToWin ? 0 : 1;
        return { ...state, phase: 'matchOver', winner: matchWinner, phaseTimer: 0 };
      }
      return resetRound(state);
    }
    return { ...state, phaseTimer };
  }

  const players: [PlayerState, PlayerState] = [
    {
      ...state.players[0],
      pos: { ...state.players[0].pos },
      attack: cloneAttack(state.players[0]),
      dodge: cloneDodge(state.players[0]),
    },
    {
      ...state.players[1],
      pos: { ...state.players[1].pos },
      attack: cloneAttack(state.players[1]),
      dodge: cloneDodge(state.players[1]),
    },
  ];

  for (const p of players) {
    if (p.stunTicks > 0) p.stunTicks -= 1;
    if (p.dodgeCooldown > 0) p.dodgeCooldown -= 1;
  }

  // 相手の方向を自動で向く(この tick の移動が反映される前の位置を使用)
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const o = players[1 - i];
    const dx = o.pos.x - p.pos.x;
    const dz = o.pos.z - p.pos.z;
    if (dx !== 0 || dz !== 0) p.facing = Math.atan2(dz, dx);
  }

  // 新規アクション開始(攻撃・回避)。通常移動は判定後にまとめて行う。
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const input = inputs[i];
    if (isLocked(p)) continue;

    if (input.attack !== null) {
      p.attack = { kind: input.attack, elapsed: 0, hasHit: false, aimAngle: p.facing };
    } else if (input.dodge && p.dodgeCooldown === 0 && p.stamina >= DODGE.staminaCost) {
      p.stamina -= DODGE.staminaCost;

      // 回避ダッシュ方向: 移動入力があればその方向(ワールド相対)、
      // 無ければ相手と反対方向(バックステップ)へ。
      const moveMag = Math.hypot(input.move.x, input.move.z);
      let dirX: number;
      let dirZ: number;
      if (moveMag > MOVE_EPSILON) {
        dirX = input.move.x / moveMag;
        dirZ = input.move.z / moveMag;
      } else {
        dirX = -Math.cos(p.facing);
        dirZ = -Math.sin(p.facing);
      }

      p.dodge = { elapsed: 0, startedAtTick: state.tick, dirX, dirZ };
    }
  }

  for (const p of players) {
    p.stamina = Math.min(PLAYER.maxStamina, p.stamina + PLAYER.staminaRegenPerTick);
  }

  // 攻撃判定: この tick の移動が反映される前の位置で行う
  // (回避の i-frame ダッシュで距離が変わる前に判定することで、ジャスト回避が
  //  「位置がずれて間合い外になった」ことで取り逃されないようにする)
  for (let i = 0; i < 2; i++) {
    const attacker = players[i];
    const defender = players[1 - i];
    const outcome = resolveAttackTick(attacker, defender, state.tick);
    if (!outcome) continue;

    attacker.attack!.hasHit = true;
    if (outcome.defenderDamage) {
      defender.hp = Math.max(0, defender.hp - outcome.defenderDamage);
    }
    if (outcome.attackerStun) {
      attacker.stunTicks = Math.max(attacker.stunTicks, outcome.attackerStun);
    }
    if (outcome.defenderStaminaRefund) {
      defender.stamina = Math.min(PLAYER.maxStamina, defender.stamina + outcome.defenderStaminaRefund);
    }
  }

  // 移動: 回避 i-frame 中は決定済みのダッシュ方向へ、それ以外は画面(ワールド)相対の通常移動
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const input = inputs[i];

    if (p.dodge && p.dodge.elapsed < DODGE.iframes) {
      p.pos = clampToArena({
        x: p.pos.x + p.dodge.dirX * DODGE.dashSpeed,
        z: p.pos.z + p.dodge.dirZ * DODGE.dashSpeed,
      });
      continue;
    }
    if (p.attack || p.dodge || p.stunTicks > 0) continue;

    // 移動は画面(ワールド)相対。ロックオン(facing)は移動には影響しない。
    let dx = input.move.x;
    let dz = input.move.z;
    const mag = Math.hypot(dx, dz);
    if (mag > 1) {
      dx /= mag;
      dz /= mag;
    }

    if (dx !== 0 || dz !== 0) {
      p.pos = clampToArena({
        x: p.pos.x + dx * PLAYER.moveSpeed,
        z: p.pos.z + dz * PLAYER.moveSpeed,
      });
    }
  }

  // アクションタイマー進行
  for (const p of players) {
    if (p.attack) {
      p.attack.elapsed += 1;
      const spec = ATTACKS[p.attack.kind];
      if (p.attack.elapsed >= spec.windup + spec.active + spec.recovery) {
        p.attack = null;
      }
    }
    if (p.dodge) {
      p.dodge.elapsed += 1;
      if (p.dodge.elapsed >= DODGE.duration) {
        p.dodge = null;
        p.dodgeCooldown = DODGE.cooldown;
      }
    }
  }

  const tick = state.tick + 1;
  const roundTick = state.roundTick + 1;

  const [p0, p1] = players;
  const p0Dead = p0.hp <= 0;
  const p1Dead = p1.hp <= 0;
  const timeUp = roundTick >= MATCH.roundSeconds * TPS;

  let phase: GameState['phase'] = 'fighting';
  let winner: GameState['winner'] = null;
  let phaseTimer = 0;

  if (p0Dead || p1Dead || timeUp) {
    let roundWinner: 0 | 1 | null = null;
    if (p0Dead && !p1Dead) roundWinner = 1;
    else if (p1Dead && !p0Dead) roundWinner = 0;
    else if (timeUp && !p0Dead && !p1Dead) {
      if (p0.hp > p1.hp) roundWinner = 0;
      else if (p1.hp > p0.hp) roundWinner = 1;
    }
    // 両者同時 KO、または同点タイムアップは引き分け(roundWinner = null)

    if (roundWinner !== null) {
      players[roundWinner].roundsWon += 1;
      winner = roundWinner;
    }
    // 試合終了の判定は roundOver のフリーズが終わった後(次の resetRound/matchOver 遷移)で行う。
    phase = 'roundOver';
    phaseTimer = MATCH.roundEndFreezeTicks;
  }

  return { tick, roundTick, players, phase, winner, phaseTimer };
}

function cloneAttack(p: PlayerState): PlayerState['attack'] {
  return p.attack ? { ...p.attack } : null;
}

function cloneDodge(p: PlayerState): PlayerState['dodge'] {
  return p.dodge ? { ...p.dodge } : null;
}
