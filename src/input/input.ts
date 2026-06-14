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
