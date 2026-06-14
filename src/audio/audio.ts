/**
 * Web Audio API による効果音エンジン。
 *
 * すべての音はオシレーター/ノイズバッファ + ゲインエンベロープでその場合成する
 * (音声アセットファイルは使用しない)。`AudioContext` は遅延生成し、iOS Safari の
 * 制約に合わせて最初のユーザー操作で `resume()` する。
 *
 * このモジュールは `AudioContext` というブラウザ API に依存するため、
 * `src/engine/**` や `src/sim/**`(ヘッドレスシミュレーション)からは
 * 絶対に import しないこと。
 */

import type { AttackKind } from '../engine/types';

/** ノイズバッファ生成のデフォルト長(秒) */
const NOISE_BUFFER_SECONDS = 1;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private _muted = false;

  /** ミュート状態(読み取り専用) */
  get muted(): boolean {
    return this._muted;
  }

  setMuted(value: boolean): void {
    this._muted = value;
  }

  /**
   * 最初のユーザー操作(pointerdown/keydown など)から呼び出す。
   * `AudioContext` を遅延生成し、suspended なら resume する。
   * iOS Safari ではユーザー操作なしに音が出ないための対策。
   */
  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  /** 1 秒分のホワイトノイズバッファを遅延生成して再利用する */
  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** 再生可能かどうかを判定し、有効なら AudioContext を返す */
  private context(): AudioContext | null {
    if (this._muted) return null;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    return ctx;
  }

  /**
   * 単一オシレーターを生成し、ゲインエンベロープ(アタック/ディケイ)付きで
   * 鳴らす。`freqEnd` を指定すると周波数をスライドさせる。
   */
  private playTone(opts: {
    type: OscillatorType;
    freq: number;
    freqEnd?: number;
    duration: number;
    gain: number;
    when?: number;
  }): void {
    const ctx = this.context();
    if (!ctx) return;

    const now = ctx.currentTime + (opts.when ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, now);
    if (opts.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), now + opts.duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(opts.gain, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + opts.duration + 0.02);
  }

  /** ノイズバッファをフィルタ + エンベロープ付きで鳴らす(打撃音・ホワッシュ用) */
  private playNoise(opts: {
    duration: number;
    gain: number;
    filterType: BiquadFilterType;
    filterFreq: number;
    filterFreqEnd?: number;
    when?: number;
  }): void {
    const ctx = this.context();
    if (!ctx) return;

    const now = ctx.currentTime + (opts.when ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.setValueAtTime(opts.filterFreq, now);
    if (opts.filterFreqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(1, opts.filterFreqEnd), now + opts.duration);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(opts.gain, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    source.start(now);
    source.stop(now + opts.duration + 0.02);
  }

  /** 攻撃発生時の振り音(軽攻撃は短く高め、重攻撃は長く低め) */
  swing(kind: AttackKind): void {
    if (kind === 'light') {
      this.playNoise({ duration: 0.12, gain: 0.18, filterType: 'highpass', filterFreq: 2000, filterFreqEnd: 4000 });
    } else {
      this.playNoise({ duration: 0.22, gain: 0.22, filterType: 'highpass', filterFreq: 800, filterFreqEnd: 2200 });
    }
  }

  /** ヒット音(被弾)。重攻撃ほど低く・重く・大きく鳴らす */
  hit(kind: AttackKind): void {
    if (kind === 'light') {
      this.playTone({ type: 'square', freq: 220, freqEnd: 90, duration: 0.1, gain: 0.22 });
      this.playNoise({ duration: 0.08, gain: 0.18, filterType: 'bandpass', filterFreq: 1200 });
    } else {
      this.playTone({ type: 'square', freq: 140, freqEnd: 50, duration: 0.22, gain: 0.3 });
      this.playNoise({ duration: 0.18, gain: 0.26, filterType: 'bandpass', filterFreq: 600 });
    }
  }

  /** ジャスト回避成立時の小気味よいチャイム(上昇する2音) */
  just(): void {
    this.playTone({ type: 'sine', freq: 880, duration: 0.12, gain: 0.22 });
    this.playTone({ type: 'sine', freq: 1320, duration: 0.18, gain: 0.2, when: 0.06 });
    this.playTone({ type: 'triangle', freq: 1760, duration: 0.22, gain: 0.14, when: 0.1 });
  }

  /** 回避発生時のホワッシュ音(下降ノイズ) */
  dodge(): void {
    this.playNoise({ duration: 0.16, gain: 0.14, filterType: 'lowpass', filterFreq: 3000, filterFreqEnd: 400 });
  }

  /** ジャンプ発生時の上昇音(二段ジャンプでも同じ音を鳴らす) */
  jump(): void {
    this.playTone({ type: 'sine', freq: 320, freqEnd: 640, duration: 0.1, gain: 0.12 });
  }

  /** 着地時の軽い衝撃音 */
  land(): void {
    this.playTone({ type: 'sine', freq: 140, freqEnd: 60, duration: 0.08, gain: 0.1 });
    this.playNoise({ duration: 0.06, gain: 0.08, filterType: 'lowpass', filterFreq: 400 });
  }

  /**
   * ジャスト回避の猶予に入った合図(視覚の金色リングと対になる聴覚キュー)。
   * 「今が回避のタイミング」を耳でも学べるよう、ごく控えめな高い tick を鳴らす。
   * アシスト ON 時のみ呼ばれる。
   */
  cue(): void {
    this.playTone({ type: 'sine', freq: 1180, freqEnd: 1320, duration: 0.05, gain: 0.05 });
  }

  /** KO 時の重い低音インパクト */
  ko(): void {
    this.playTone({ type: 'sawtooth', freq: 180, freqEnd: 40, duration: 0.5, gain: 0.3 });
    this.playNoise({ duration: 0.35, gain: 0.25, filterType: 'lowpass', filterFreq: 500 });
  }

  /** ラウンド開始(FIGHT!)の合図音 */
  roundStart(): void {
    this.playTone({ type: 'square', freq: 440, duration: 0.08, gain: 0.18 });
    this.playTone({ type: 'square', freq: 660, duration: 0.16, gain: 0.2, when: 0.1 });
  }

  /** マッチ終了のファンファーレ風の和音 */
  matchEnd(): void {
    this.playTone({ type: 'triangle', freq: 523.25, duration: 0.3, gain: 0.18 });
    this.playTone({ type: 'triangle', freq: 659.25, duration: 0.3, gain: 0.18, when: 0.08 });
    this.playTone({ type: 'triangle', freq: 783.99, duration: 0.4, gain: 0.18, when: 0.16 });
  }
}
