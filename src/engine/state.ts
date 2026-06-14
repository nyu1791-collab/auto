import { MATCH, PLAYER } from './constants';
import type { GameState, PlayerState, Vec2 } from './types';

function createPlayer(id: 0 | 1, pos: Vec2, facing: number): PlayerState {
  return {
    id,
    pos: { ...pos },
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

const P0_START: Vec2 = { x: -180, z: 0 };
const P1_START: Vec2 = { x: 180, z: 0 };

/** 開始位置から互いに向き合う facing(ラジアン)を算出する */
function initialFacing(self: Vec2, opponent: Vec2): number {
  return Math.atan2(opponent.z - self.z, opponent.x - self.x);
}

export function createInitialState(): GameState {
  return {
    tick: 0,
    roundTick: 0,
    players: [
      createPlayer(0, P0_START, initialFacing(P0_START, P1_START)),
      createPlayer(1, P1_START, initialFacing(P1_START, P0_START)),
    ],
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
      { ...createPlayer(0, P0_START, initialFacing(P0_START, P1_START)), roundsWon: p0.roundsWon },
      { ...createPlayer(1, P1_START, initialFacing(P1_START, P0_START)), roundsWon: p1.roundsWon },
    ],
    phase: 'starting',
    winner: null,
    phaseTimer: MATCH.startCountdownTicks,
  };
}
