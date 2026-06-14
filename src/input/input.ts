import type { AttackKind, Inputs, PlayerInput } from '../engine/types';

interface KeyMap {
  /** forward + (相手へ接近) */
  forwardPos: string;
  /** forward - (相手から後退) */
  forwardNeg: string;
  /** strafe - (rightVec の逆方向) */
  strafeNeg: string;
  /** strafe + (rightVec 方向) */
  strafePos: string;
  dodge: string;
  light: string;
  heavy: string;
}

// P1: WASD 移動(W=前進/接近, S=後退, A=左ストレイフ, D=右ストレイフ)、Shift 回避、F/G 攻撃
const P1_KEYS: KeyMap = {
  forwardPos: 'w',
  forwardNeg: 's',
  strafeNeg: 'a',
  strafePos: 'd',
  dodge: 'shift',
  light: 'f',
  heavy: 'g',
};

// P2: 矢印キー移動、'/' 回避、K/L 攻撃
const P2_KEYS: KeyMap = {
  forwardPos: 'arrowup',
  forwardNeg: 'arrowdown',
  strafeNeg: 'arrowleft',
  strafePos: 'arrowright',
  dodge: '/',
  light: 'k',
  heavy: 'l',
};

/** アナログスティック入力(setStick で外部から設定される) */
interface StickState {
  forward: number;
  strafe: number;
}

/** キーボード入力を保持し、tick ごとに PlayerInput へ変換する */
export class InputManager {
  private pressed = new Set<string>();
  private justPressed = new Set<string>();

  /** タッチUI等から設定されるアナログスティック値(プレイヤーごと)。明示的に変わるまで保持される */
  private sticks: [StickState, StickState] = [
    { forward: 0, strafe: 0 },
    { forward: 0, strafe: 0 },
  ];

  constructor(target: Pick<Window, 'addEventListener'>) {
    target.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent;
      const key = this.normalizeKey(event.key);
      if (!this.pressed.has(key)) this.justPressed.add(key);
      this.pressed.add(key);
    });
    target.addEventListener('keyup', (e) => {
      const event = e as KeyboardEvent;
      this.pressed.delete(this.normalizeKey(event.key));
    });
  }

  /**
   * `KeyboardEvent.key` をこのモジュールが使うキー名に正規化する。
   * 'Shift' は左右どちらでも 'shift' として扱う。
   */
  private normalizeKey(key: string): string {
    return key.toLowerCase();
  }

  /** 1 tick 分の入力を取得する。呼び出すたびに「押した瞬間」の情報は消費される */
  poll(): Inputs {
    const inputs: Inputs = [this.readPlayer(P1_KEYS, 0), this.readPlayer(P2_KEYS, 1)];
    this.justPressed.clear();
    return inputs;
  }

  /**
   * 指定したキーがこの tick で「押された瞬間」かどうかを返す(消費しない)。
   * リスタートやモード切替などのメニュー系操作に使う。
   */
  wasJustPressed(key: string): boolean {
    return this.justPressed.has(key.toLowerCase());
  }

  /**
   * 仮想キー押下(タッチUIなど)を keydown と同じ意味で `pressed`/`justPressed` に
   * 反映する。キーボードの `keydown` と完全に同じセマンティクスを持つため、
   * 同一 tick 内での press→release(タップ)も `justPressed` に残る。
   */
  pressVirtual(key: string): void {
    const k = key.toLowerCase();
    if (!this.pressed.has(k)) this.justPressed.add(k);
    this.pressed.add(k);
  }

  /** 仮想キー解放(タッチUIなど)を keyup と同じ意味で `pressed` から取り除く */
  releaseVirtual(key: string): void {
    this.pressed.delete(key.toLowerCase());
  }

  /**
   * アナログスティック値を設定する(タッチUIのバーチャルスティック用)。
   * `forward`/`strafe` は概ね [-1, 1]。明示的に呼ばれるまで値は保持される
   * (離した際は (0,0) を渡すこと)。
   */
  setStick(player: 0 | 1, forward: number, strafe: number): void {
    this.sticks[player] = { forward, strafe };
  }

  private readPlayer(keys: KeyMap, player: 0 | 1): PlayerInput {
    let forward = 0;
    let strafe = 0;
    if (this.pressed.has(keys.forwardPos)) forward += 1;
    if (this.pressed.has(keys.forwardNeg)) forward -= 1;
    if (this.pressed.has(keys.strafeNeg)) strafe -= 1;
    if (this.pressed.has(keys.strafePos)) strafe += 1;

    // スティック入力をキーボード入力に合成する(スティックが非ゼロならその分を加算)。
    const stick = this.sticks[player];
    forward += stick.forward;
    strafe += stick.strafe;

    // 合成後に単位長へクランプ(engine 側でも行うが、ここで整えておくと
    // 入力値そのものが [-1,1] の範囲に収まり扱いやすい)。
    const mag = Math.hypot(forward, strafe);
    if (mag > 1) {
      forward /= mag;
      strafe /= mag;
    }

    let attack: AttackKind | null = null;
    if (this.justPressed.has(keys.light)) attack = 'light';
    else if (this.justPressed.has(keys.heavy)) attack = 'heavy';

    return {
      move: { forward, strafe },
      dodge: this.justPressed.has(keys.dodge),
      attack,
    };
  }
}
