/**
 * ゲームロジックの共有型(契約)。ブラウザ API に依存しない。
 */

export type AttackKind = 'light' | 'heavy';

/** どちらのプレイヤーか */
export type PlayerId = 0 | 1;

/** 地面平面上の位置(y は常に 0) */
export interface Vec2 {
  x: number;
  z: number;
}

/** 1 プレイヤーの入力(この tick の意図) */
export interface PlayerInput {
  /**
   * ロックオン相対の移動入力(各おおむね [-1,1] のアナログ値)。
   * `forward` + で相手に接近、- で後退。
   * `strafe` + で `rightVec` 方向へサイドステップ周回。
   */
  move: { forward: number; strafe: number };
  /** 回避を開始しようとしているか(押した瞬間に true) */
  dodge: boolean;
  /** この tick に開始したい攻撃。なければ null */
  attack: AttackKind | null;
}

/** 攻撃の進行状態 */
export interface AttackState {
  kind: AttackKind;
  /** 攻撃開始からの経過 tick */
  elapsed: number;
  /** この攻撃で既にヒットを与えたか(多段ヒット防止) */
  hasHit: boolean;
  /** 攻撃開始時に固定された攻撃者の facing(ラジアン角)。攻撃方向のコミット */
  aimAngle: number;
}

/** 回避の進行状態 */
export interface DodgeState {
  /** 回避開始からの経過 tick */
  elapsed: number;
  /** 回避を開始した「マッチ全体の」tick(ジャスト判定に使用) */
  startedAtTick: number;
  /** 回避ダッシュ方向(単位ベクトル)の x 成分 */
  dirX: number;
  /** 回避ダッシュ方向(単位ベクトル)の z 成分 */
  dirZ: number;
}

export interface PlayerState {
  id: PlayerId;
  /** 地面平面上の位置(y は常に 0) */
  pos: Vec2;
  /** 相手方向を向くロックオン角(ラジアン)。atan2(opp.z - me.z, opp.x - me.x) */
  facing: number;
  hp: number;
  stamina: number;
  /** 攻撃中なら状態、なければ null */
  attack: AttackState | null;
  /** 回避中なら状態、なければ null */
  dodge: DodgeState | null;
  /** 0 より大きい間は硬直(行動不能)。ジャスト回避を受けると設定される */
  stunTicks: number;
  /** 回避クールダウン残 tick */
  dodgeCooldown: number;
  /** ラウンド取得数 */
  roundsWon: number;
}

export type RoundPhase = 'starting' | 'fighting' | 'roundOver' | 'matchOver';

export interface GameState {
  /** マッチ開始からの累積 tick */
  tick: number;
  /** 現在ラウンドの経過 tick */
  roundTick: number;
  players: [PlayerState, PlayerState];
  phase: RoundPhase;
  /** ラウンド/マッチの勝者。fighting 中は null */
  winner: PlayerId | null;
  /** 'starting' / 'roundOver' のカウントダウン残 tick */
  phaseTimer: number;
}

export type Inputs = [PlayerInput, PlayerInput];
