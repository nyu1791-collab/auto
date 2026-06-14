import type { AttackKind, Inputs, PlayerInput } from '../engine/types';

interface KeyMap {
  /** 画面右 (ワールド +x) */
  right: string;
  /** 画面左 (ワールド -x) */
  left: string;
  /** 画面奥 (ワールド -z) */
  up: string;
  /** 画面手前 (ワールド +z) */
  down: string;
  dodge: string;
  light: string;
  heavy: string;
}

// P1: WASD 移動(W=奥, S=手前, A=左, D=右)、Shift 回避、F/G 攻撃
const P1_KEYS: KeyMap = {
  right: 'd',
  left: 'a',
  up: 'w',
  down: 's',
  dodge: 'shift',
  light: 'f',
  heavy: 'g',
};

// P2: 矢印キー移動、'/' 回避、K/L 攻撃
const P2_KEYS: KeyMap = {
  right: 'arrowright',
  left: 'arrowleft',
  up: 'arrowup',
  down: 'arrowdown',
  dodge: '/',
  light: 'k',
  heavy: 'l',
};

/** アナログスティック入力(setStick で外部から設定される。ワールド相対の {x,z}) */
interface StickState {
  x: number;
  z: number;
}

/** キーボード入力を保持し、tick ごとに PlayerInput へ変換する */
export class InputManager {
  private pressed = new Set<string>();
  private justPressed = new Set<string>();

  /** タッチUI等から設定されるアナログスティック値(プレイヤーごと)。明示的に変わるまで保持される */
  private sticks: [StickState, StickState] = [
    { x: 0, z: 0 },
    { x: 0, z: 0 },
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
   * 引数は画面ベクトル(`screenX` = 右 +, `screenY` = 上 +、各おおむね [-1, 1])。
   * 内部ではワールド相対の移動ベクトル `{x: screenX, z: -screenY}` に変換して保持する
   * (画面上 = 奥 = ワールド -z)。明示的に呼ばれるまで値は保持される
   * (離した際は (0,0) を渡すこと)。
   */
  setStick(player: 0 | 1, screenX: number, screenY: number): void {
    this.sticks[player] = { x: screenX, z: -screenY };
  }

  private readPlayer(keys: KeyMap, player: 0 | 1): PlayerInput {
    let x = 0;
    let z = 0;
    if (this.pressed.has(keys.right)) x += 1;
    if (this.pressed.has(keys.left)) x -= 1;
    if (this.pressed.has(keys.up)) z -= 1; // 画面奥 = ワールド -z
    if (this.pressed.has(keys.down)) z += 1;

    // スティック入力をキーボード入力に合成する(スティックが非ゼロならその分を加算)。
    const stick = this.sticks[player];
    x += stick.x;
    z += stick.z;

    // 合成後に単位長へクランプ(engine 側でも行うが、ここで整えておくと
    // 入力値そのものが [-1,1] の範囲に収まり扱いやすい)。
    const mag = Math.hypot(x, z);
    if (mag > 1) {
      x /= mag;
      z /= mag;
    }

    let attack: AttackKind | null = null;
    if (this.justPressed.has(keys.light)) attack = 'light';
    else if (this.justPressed.has(keys.heavy)) attack = 'heavy';

    return {
      move: { x, z },
      dodge: this.justPressed.has(keys.dodge),
      attack,
    };
  }
}
