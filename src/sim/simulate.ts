/**
 * ヘッドレス対戦シミュレーション。バランス調整・回帰検出用の自動化ツール。
 * 実行: npm run sim
 */
import { step } from '../engine/engine';
import { MATCH, TPS } from '../engine/constants';
import { createInitialState } from '../engine/state';
import type { GameState } from '../engine/types';
import { aggressiveBot, reactiveBot, type Bot } from './bot';

const SAFETY_CAP_TICKS = MATCH.roundSeconds * TPS * MATCH.roundsToWin * 4;

interface MatchResult {
  winner: 0 | 1 | null;
  ticks: number;
  finalHp: [number, number];
}

function runMatch(botA: Bot, botB: Bot): MatchResult {
  let state: GameState = createInitialState();
  let ticks = 0;
  while (state.phase !== 'matchOver' && ticks < SAFETY_CAP_TICKS) {
    state = step(state, [botA(state, 0), botB(state, 1)]);
    ticks++;
  }
  return { winner: state.winner, ticks, finalHp: [state.players[0].hp, state.players[1].hp] };
}

function summarize(label: string, botA: Bot, botB: Bot, runs: number): void {
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  let totalTicks = 0;

  for (let i = 0; i < runs; i++) {
    const result = runMatch(botA, botB);
    if (result.winner === 0) aWins++;
    else if (result.winner === 1) bWins++;
    else draws++;
    totalTicks += result.ticks;
  }

  console.log(`\n=== ${label} (${runs} matches) ===`);
  console.log(`A wins: ${aWins} (${((aWins / runs) * 100).toFixed(1)}%)`);
  console.log(`B wins: ${bWins} (${((bWins / runs) * 100).toFixed(1)}%)`);
  console.log(`draws: ${draws}`);
  console.log(`avg ticks/match: ${(totalTicks / runs).toFixed(0)}`);
}

summarize('Aggressive vs Aggressive', aggressiveBot, aggressiveBot, 50);
summarize('Aggressive vs Reactive (perfect, delay=7)', aggressiveBot, reactiveBot(7), 50);
summarize('Aggressive vs Reactive (loose, delay=15)', aggressiveBot, reactiveBot(15), 50);
summarize('Reactive(perfect) vs Reactive(perfect)', reactiveBot(7), reactiveBot(7), 50);
