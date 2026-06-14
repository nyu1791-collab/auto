import { ARENA, MATCH, PLAYER } from './constants';
import type { GameState, PlayerState } from './types';

function createPlayer(id: 0 | 1, x: number, facing: 1 | -1): PlayerState {
  return {
    id,
    x,
    facing,
    hp: PLAYER.maxHp,
    stamina: PLAYER.maxStamina,
    attack: null,
    dodge: null,
    stunTicks: 0,
    dodgeCooldown: 0,
    roundsWon: 0,
  };
}

const P0_START_X = 200;
const P1_START_X = ARENA.width - 200 - ARENA.playerSize;

export function createInitialState(): GameState {
  return {
    tick: 0,
    roundTick: 0,
    players: [createPlayer(0, P0_START_X, 1), createPlayer(1, P1_START_X, -1)],
    phase: 'starting',
    winner: null,
    phaseTimer: MATCH.startCountdownTicks,
  };
}

/** ラウンド勝敗数を維持したまま、次ラウンド用に状態をリセットする */
export function resetRound(state: GameState): GameState {
  const [p0, p1] = state.players;
  return {
    tick: state.tick,
    roundTick: 0,
    players: [
      { ...createPlayer(0, P0_START_X, 1), roundsWon: p0.roundsWon },
      { ...createPlayer(1, P1_START_X, -1), roundsWon: p1.roundsWon },
    ],
    phase: 'starting',
    winner: null,
    phaseTimer: MATCH.startCountdownTicks,
  };
}
