import { ARENA, ATTACKS, DODGE, JUMP, MATCH, PLAYER, TPS } from './constants';
import { resolveAttackTick } from './combat';
import { resetRound } from './state';
import type { GameState, Inputs, PlayerState } from './types';

function isLocked(p: PlayerState): boolean {
  return p.attack !== null || p.dodge !== null || p.stunTicks > 0;
}

function clampX(x: number): number {
  return Math.max(0, Math.min(ARENA.width - ARENA.playerSize, x));
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
    { ...state.players[0], attack: cloneAttack(state.players[0]), dodge: cloneDodge(state.players[0]) },
    { ...state.players[1], attack: cloneAttack(state.players[1]), dodge: cloneDodge(state.players[1]) },
  ];

  for (const p of players) {
    if (p.stunTicks > 0) p.stunTicks -= 1;
    if (p.dodgeCooldown > 0) p.dodgeCooldown -= 1;
  }

  // 相手の方向を自動で向く(この tick の移動が反映される前の位置を使用)
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const o = players[1 - i];
    const dx = o.x - p.x;
    if (dx !== 0) p.facing = dx > 0 ? 1 : -1;
  }

  // 新規アクション開始(攻撃・回避)。通常移動は判定後にまとめて行う。
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const input = inputs[i];
    if (isLocked(p)) continue;

    if (input.attack !== null) {
      p.attack = { kind: input.attack, elapsed: 0, hasHit: false };
    } else if (input.dodge && p.dodgeCooldown === 0 && p.stamina >= DODGE.staminaCost) {
      p.stamina -= DODGE.staminaCost;
      p.dodge = { elapsed: 0, startedAtTick: state.tick };
    }

    // ジャンプ: この tick に攻撃/回避を開始していない(=まだ非ロック)ときのみ。
    // 接地中は通常ジャンプ、空中は airJumps を消費して二段ジャンプする。
    if (input.jump && !isLocked(p)) {
      if (p.y === 0 && p.vy === 0) {
        p.vy = JUMP.velocity;
      } else if (p.airJumps > 0) {
        p.vy = JUMP.velocity;
        p.airJumps -= 1;
      }
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

  // 移動: 横移動(回避ダッシュ/通常/空中)と縦移動(重力)を処理する。
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const input = inputs[i];

    // --- 横移動 ---
    if (p.dodge && p.dodge.elapsed < DODGE.iframes) {
      // 回避 i-frame 中は相手と反対方向へダッシュ
      p.x = clampX(p.x - p.facing * DODGE.dashSpeed);
    } else if (!(p.attack || p.dodge || p.stunTicks > 0) && input.move !== 0) {
      // 通常移動。空中では制御を弱める(airMoveSpeed)。
      const speed = p.y > 0 ? PLAYER.airMoveSpeed : PLAYER.moveSpeed;
      p.x = clampX(p.x + input.move * speed);
    }

    // --- 縦移動(重力)。空中なら攻撃/回避/硬直中でも常に落下させる ---
    if (p.y > 0 || p.vy !== 0) {
      p.y += p.vy;
      p.vy -= JUMP.gravity;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        p.airJumps = JUMP.airJumps;
      }
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
