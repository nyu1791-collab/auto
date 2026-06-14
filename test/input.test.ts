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
    // P1 の left キー('a') が押されているので move = -1
    expect(inputs[0].move).toBe(-1);
  });

  it('held key continues to register movement across polls until released', () => {
    const input = new InputManager(fakeWindow());

    input.pressVirtual('d');
    let inputs = input.poll();
    expect(inputs[0].move).toBe(1);

    // 2 tick 目: justPressed は消費済みだが pressed は維持されるため move は継続する
    inputs = input.poll();
    expect(inputs[0].move).toBe(1);

    input.releaseVirtual('d');
    inputs = input.poll();
    expect(inputs[0].move).toBe(0);
  });

  it('same-tick press then release (tap) still registers as justPressed', () => {
    const input = new InputManager(fakeWindow());

    // ダッジ(P1: 'w')を同一 tick 内で press → release(タップ操作)
    input.pressVirtual('w');
    input.releaseVirtual('w');

    expect(input.wasJustPressed('w')).toBe(true);
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
    expect(inputs[1].move).toBe(1);
    expect(inputs[1].attack).toBe('heavy');
    // P1 側には影響しない
    expect(inputs[0].move).toBe(0);
    expect(inputs[0].attack).toBeNull();
  });

  it('multi-touch: holding left while tapping dodge works independently', () => {
    const input = new InputManager(fakeWindow());

    // ◀ を押し続けながら DODGE をタップする(マルチタッチのシミュレーション)
    input.pressVirtual('a');
    input.pressVirtual('w');
    input.releaseVirtual('w');

    const inputs = input.poll();
    expect(inputs[0].move).toBe(-1);
    expect(inputs[0].dodge).toBe(true);

    // ◀ は離していないので、次 tick も move は継続する
    const next = input.poll();
    expect(next[0].move).toBe(-1);
    expect(next[0].dodge).toBe(false);
  });
});
