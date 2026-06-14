import { describe, expect, it } from 'vitest';
import { InputManager } from '../src/input/input';

/**
 * `addEventListener` のみを実装したダミーターゲット。
 * `InputManager` はキーボードイベントを購読するだけで、本テストでは
 * キーボードイベントを発火させない(`pressVirtual`/`releaseVirtual` のみ検証する)ため、
 * リスナー登録さえできれば十分。
 */
function fakeWindow(): Pick<Window, 'addEventListener'> {
  return {
    addEventListener: () => {
      /* no-op */
    },
  };
}

describe('InputManager virtual keys', () => {
  it('pressVirtual sets pressed and justPressed (same semantics as keydown)', () => {
    const input = new InputManager(fakeWindow());

    input.pressVirtual('a');
    expect(input.wasJustPressed('a')).toBe(true);

    const inputs = input.poll();
    // P1 の左キー('a')が押されているのでワールド -x へ移動
    expect(inputs[0].move).toEqual({ x: -1, z: 0 });
  });

  it('held key continues to register movement across polls until released', () => {
    const input = new InputManager(fakeWindow());

    input.pressVirtual('d');
    let inputs = input.poll();
    expect(inputs[0].move).toEqual({ x: 1, z: 0 });

    // 2 tick 目: justPressed は消費済みだが pressed は維持されるため move は継続する
    inputs = input.poll();
    expect(inputs[0].move).toEqual({ x: 1, z: 0 });

    input.releaseVirtual('d');
    inputs = input.poll();
    expect(inputs[0].move).toEqual({ x: 0, z: 0 });
  });

  it('up key (w) moves into the screen (world -z)', () => {
    const input = new InputManager(fakeWindow());

    input.pressVirtual('w');
    const inputs = input.poll();
    expect(inputs[0].move).toEqual({ x: 0, z: -1 });
  });

  it('same-tick press then release (tap) still registers as justPressed', () => {
    const input = new InputManager(fakeWindow());

    // ダッジ(P1: 'shift')を同一 tick 内で press → release(タップ操作)
    input.pressVirtual('shift');
    input.releaseVirtual('shift');

    expect(input.wasJustPressed('shift')).toBe(true);
    const inputs = input.poll();
    expect(inputs[0].dodge).toBe(true);

    // 次の tick では justPressed がクリアされているので dodge は false
    const next = input.poll();
    expect(next[0].dodge).toBe(false);
  });

  it('momentary virtual attack key (light/heavy) registers exactly one attack', () => {
    const input = new InputManager(fakeWindow());

    input.pressVirtual('f'); // P1 light
    input.releaseVirtual('f');

    const inputs = input.poll();
    expect(inputs[0].attack).toBe('light');

    const next = input.poll();
    expect(next[0].attack).toBeNull();
  });

  it('P2 virtual keys (arrow keys etc.) map to player 2 inputs independently', () => {
    const input = new InputManager(fakeWindow());

    input.pressVirtual('arrowright');
    input.pressVirtual('l'); // P2 heavy
    input.releaseVirtual('l');

    const inputs = input.poll();
    expect(inputs[1].move).toEqual({ x: 1, z: 0 });
    expect(inputs[1].attack).toBe('heavy');
    // P1 側には影響しない
    expect(inputs[0].move).toEqual({ x: 0, z: 0 });
    expect(inputs[0].attack).toBeNull();
  });

  it('P2 dodge key (/) registers a dodge for player 2 only', () => {
    const input = new InputManager(fakeWindow());

    input.pressVirtual('/');
    input.releaseVirtual('/');

    const inputs = input.poll();
    expect(inputs[1].dodge).toBe(true);
    expect(inputs[0].dodge).toBe(false);
  });

  it('multi-touch: holding a movement key while tapping dodge works independently', () => {
    const input = new InputManager(fakeWindow());

    // ◀(左移動)を押し続けながら DODGE をタップする(マルチタッチのシミュレーション)
    input.pressVirtual('a');
    input.pressVirtual('shift');
    input.releaseVirtual('shift');

    const inputs = input.poll();
    expect(inputs[0].move).toEqual({ x: -1, z: 0 });
    expect(inputs[0].dodge).toBe(true);

    // ◀ は離していないので、次 tick も move は継続する
    const next = input.poll();
    expect(next[0].move).toEqual({ x: -1, z: 0 });
    expect(next[0].dodge).toBe(false);
  });
});

describe('InputManager analog stick', () => {
  it('setStick converts screen vector to world move (up = -z)', () => {
    const input = new InputManager(fakeWindow());

    // 画面右 0.5 / 画面上 -0.5 → world {x: 0.5, z: 0.5}
    input.setStick(0, 0.5, -0.5);
    const inputs = input.poll();
    expect(inputs[0].move.x).toBeCloseTo(0.5);
    expect(inputs[0].move.z).toBeCloseTo(0.5);
  });

  it('stick values persist across polls until explicitly changed', () => {
    const input = new InputManager(fakeWindow());

    input.setStick(0, 1, 0);
    input.poll();
    const next = input.poll();
    expect(next[0].move).toEqual({ x: 1, z: 0 });

    input.setStick(0, 0, 0);
    const after = input.poll();
    expect(after[0].move).toEqual({ x: 0, z: 0 });
  });

  it('clamps combined keyboard + stick input to unit length', () => {
    const input = new InputManager(fakeWindow());

    input.pressVirtual('w'); // z -= 1 (奥)
    input.setStick(0, 0, 1); // screenY=1 → z -= 1 -> 合計 z = -2, 単位長へクランプ

    const inputs = input.poll();
    expect(Math.hypot(inputs[0].move.x, inputs[0].move.z)).toBeCloseTo(1);
  });

  it('P1 and P2 sticks are independent', () => {
    const input = new InputManager(fakeWindow());

    input.setStick(0, 1, 0); // world {x:1, z:0}
    input.setStick(1, 0, 1); // world {x:0, z:-1}

    const inputs = input.poll();
    expect(inputs[0].move).toEqual({ x: 1, z: 0 });
    expect(inputs[1].move).toEqual({ x: 0, z: -1 });
  });
});
