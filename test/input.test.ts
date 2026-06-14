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
    // P1 の strafe-キー('a')が押されているので strafe = -1
    expect(inputs[0].move).toEqual({ forward: 0, strafe: -1 });
  });

  it('held key continues to register movement across polls until released', () => {
    const input = new InputManager(fakeWindow());

    input.pressVirtual('d');
    let inputs = input.poll();
    expect(inputs[0].move).toEqual({ forward: 0, strafe: 1 });

    // 2 tick 目: justPressed は消費済みだが pressed は維持されるため move は継続する
    inputs = input.poll();
    expect(inputs[0].move).toEqual({ forward: 0, strafe: 1 });

    input.releaseVirtual('d');
    inputs = input.poll();
    expect(inputs[0].move).toEqual({ forward: 0, strafe: 0 });
  });

  it('forward key (w) moves forward (approach the opponent)', () => {
    const input = new InputManager(fakeWindow());

    input.pressVirtual('w');
    const inputs = input.poll();
    expect(inputs[0].move).toEqual({ forward: 1, strafe: 0 });
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
    expect(inputs[1].move).toEqual({ forward: 0, strafe: 1 });
    expect(inputs[1].attack).toBe('heavy');
    // P1 側には影響しない
    expect(inputs[0].move).toEqual({ forward: 0, strafe: 0 });
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

  it('multi-touch: holding strafe while tapping dodge works independently', () => {
    const input = new InputManager(fakeWindow());

    // ◀(strafe-)を押し続けながら DODGE をタップする(マルチタッチのシミュレーション)
    input.pressVirtual('a');
    input.pressVirtual('shift');
    input.releaseVirtual('shift');

    const inputs = input.poll();
    expect(inputs[0].move).toEqual({ forward: 0, strafe: -1 });
    expect(inputs[0].dodge).toBe(true);

    // ◀ は離していないので、次 tick も move は継続する
    const next = input.poll();
    expect(next[0].move).toEqual({ forward: 0, strafe: -1 });
    expect(next[0].dodge).toBe(false);
  });
});

describe('InputManager analog stick', () => {
  it('setStick feeds analog values that combine with keyboard input', () => {
    const input = new InputManager(fakeWindow());

    input.setStick(0, 0.5, -0.5);
    const inputs = input.poll();
    expect(inputs[0].move.forward).toBeCloseTo(0.5);
    expect(inputs[0].move.strafe).toBeCloseTo(-0.5);
  });

  it('stick values persist across polls until explicitly changed', () => {
    const input = new InputManager(fakeWindow());

    input.setStick(0, 1, 0);
    input.poll();
    const next = input.poll();
    expect(next[0].move).toEqual({ forward: 1, strafe: 0 });

    input.setStick(0, 0, 0);
    const after = input.poll();
    expect(after[0].move).toEqual({ forward: 0, strafe: 0 });
  });

  it('clamps combined keyboard + stick input to unit length', () => {
    const input = new InputManager(fakeWindow());

    input.pressVirtual('w'); // forward += 1
    input.setStick(0, 1, 0); // forward += 1 -> total 2, should clamp to 1

    const inputs = input.poll();
    expect(Math.hypot(inputs[0].move.forward, inputs[0].move.strafe)).toBeCloseTo(1);
  });

  it('P1 and P2 sticks are independent', () => {
    const input = new InputManager(fakeWindow());

    input.setStick(0, 1, 0);
    input.setStick(1, 0, 1);

    const inputs = input.poll();
    expect(inputs[0].move).toEqual({ forward: 1, strafe: 0 });
    expect(inputs[1].move).toEqual({ forward: 0, strafe: 1 });
  });
});
