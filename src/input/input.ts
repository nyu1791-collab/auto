import type { AttackKind, Inputs, PlayerInput } from '../engine/types';

interface KeyMap {
  left: string;
  right: string;
  dodge: string;
  light: string;
  heavy: string;
}

const P1_KEYS: KeyMap = { left: 'a', right: 'd', dodge: 'w', light: 'f', heavy: 'g' };
const P2_KEYS: KeyMap = { left: 'arrowleft', right: 'arrowright', dodge: 'arrowup', light: 'k', heavy: 'l' };

/** キーボード入力を保持し、tick ごとに PlayerInput へ変換する */
export class InputManager {
  private pressed = new Set<string>();
  private justPressed = new Set<string>();

  constructor(target: Pick<Window, 'addEventListener'>) {
    target.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent;
      const key = event.key.toLowerCase();
      if (!this.pressed.has(key)) this.justPressed.add(key);
      this.pressed.add(key);
    });
    target.addEventListener('keyup', (e) => {
      const event = e as KeyboardEvent;
      this.pressed.delete(event.key.toLowerCase());
    });
  }

  /** 1 tick 分の入力を取得する。呼び出すたびに「押した瞬間」の情報は消費される */
  poll(): Inputs {
    const inputs: Inputs = [this.readPlayer(P1_KEYS), this.readPlayer(P2_KEYS)];
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

  private readPlayer(keys: KeyMap): PlayerInput {
    let move = 0;
    if (this.pressed.has(keys.left)) move -= 1;
    if (this.pressed.has(keys.right)) move += 1;

    let attack: AttackKind | null = null;
    if (this.justPressed.has(keys.light)) attack = 'light';
    else if (this.justPressed.has(keys.heavy)) attack = 'heavy';

    return {
      move: move as -1 | 0 | 1,
      dodge: this.justPressed.has(keys.dodge),
      attack,
    };
  }
}
