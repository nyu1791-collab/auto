# 刹那 (SETSUNA) — Just-Dodge Duel

1対1のリアルタイム対戦ゲーム。コアは **「ジャスト回避(Just Dodge)」**。
攻撃は必ず回避可能で、保証されたチップダメージは存在しない。
**完璧にプレイすれば一切ダメージを受けない** — 強さは完全にプレイヤーの腕前で決まる。

> 設計者: Opus / 実装: Sonnet

---

## 1. デザインの核

- すべての攻撃は正しいタイミングの回避で完全に無効化できる。
- 回避は**スタミナ**を消費する。連打できない。ミスした回避はスタミナを枯渇させ、次の攻撃を受ける原因になる。
- **ジャスト回避**(攻撃の発生直前に反応して出した精密な回避)は、ダメージ無効に加えて報酬を与える:
  - 相手を硬直させる(確定反撃)
  - 消費スタミナを全額還元(精密さの持続的な見返り)
- 早すぎる「読み回避」や連打回避はダメージは防げても報酬なし。さらにスタミナを浪費する。

この「スタミナ × 反応精度」の二軸が、上達するほど被ダメージがゼロに近づくという**高い技量天井**を生む。

---

## 2. 時間モデル

- 決定論的な固定ステップ。**60 TPS(1 tick ≈ 16.67ms)**。
- すべてのタイミングは tick 単位で定義 → 単体テスト・ヘッドレスシミュレーションで厳密に検証可能。
- 描画は tick とは独立(補間してよいが、ゲームロジックは tick 駆動)。

---

## 3. プレイヤーパラメータ

| 項目 | 値 |
|---|---|
| HP | 100 |
| スタミナ | 最大 100 / 回復 25 per sec(≈0.417/tick) |
| 移動速度 | 3 px/tick |
| サイズ | 40 px |
| アリーナ幅 | 800 px |

---

## 4. アクション定義(tick 単位)

### 攻撃
| 攻撃 | 発生(windup) | 持続(active) | 硬直(recovery) | ダメージ | 間合い |
|---|---|---|---|---|---|
| 弱(Light) | 9 (150ms) | 2 | 12 | 10 | 70 px |
| 強(Heavy) | 27 (450ms) | 3 | 30 | 30 | 90 px |

- ヒット判定は active フレーム中、間合い内にいる相手に発生。
- 攻撃中は移動不可。

### 回避(Dodge)
| 項目 | 値 |
|---|---|
| 無敵(i-frame) | 開始から 11 tick(≈180ms) |
| 総持続 | 18 tick |
| クールダウン | 持続終了後 6 tick |
| スタミナ消費 | 35 |
| 移動 | 回避方向へ 2 px/tick × i-frame 中(最大 22px。攻撃の間合いより十分小さく保つ) |

### ジャスト回避の判定ルール(重要)
攻撃の active フレームが、防御側の i-frame と重なった場合 → **ダメージ無効**。
そのうち、

- 防御側が回避を**開始した tick** が、攻撃の active 開始の **7 tick 前以内**(≈120ms)だった場合
  → **ジャスト回避**:攻撃側を 24 tick(≈400ms)硬直 + 防御側にスタミナ 35 全額還元。
- それより早く出した回避(8 tick 以上前)→ ダメージは無効だが報酬なし(早すぎる読み回避)。

> 反応して出した精密な回避だけが報われ、先読み連打は報われない。

---

## 5. 勝敗・ラウンド進行

- 1 ラウンド = 相手 HP を 0 に。
- 3 本勝負(先取 2 本、`MATCH.roundsToWin = 2`)。
- ラウンド制限時間 60 秒。時間切れ時は HP 多い方の勝ち。同点はドロー(両者 roundsWon 変化なし)。

### フェーズ遷移(`GameState.phase`)

`'starting' | 'fighting' | 'roundOver' | 'matchOver'` の 4 段階。`phaseTimer` が
`'starting'` / `'roundOver'` のカウントダウン残 tick を保持する。

1. **starting**: ラウンド開始前の「READY... → FIGHT!」表示。
   `MATCH.startCountdownTicks`(90 tick ≈ 1.5s)の間、入力は無視され、
   タイマーが 0 になると `fighting` へ移行する。
2. **fighting**: 通常の対戦ロジック(本書 1〜4 章)。
3. **roundOver**: KO・ダブル KO・タイムアップでラウンドが終了すると遷移。
   勝者の `roundsWon` をこのタイミングで加算し(ドローは加算なし)、
   `MATCH.roundEndFreezeTicks`(150 tick ≈ 2.5s)の間、結果表示のまま入力を無視してフリーズする。
   タイマーが 0 になったとき:
   - どちらかの `roundsWon >= MATCH.roundsToWin` なら `matchOver` へ(その時点で試合の勝者が確定)。
   - そうでなければ次ラウンド用にリセットし(`roundsWon` は保持)、`starting` へ戻る。
4. **matchOver**: 試合終了。`step()` は状態を変化させず no-op を返す
   (リスタートはエンジン外、`main.ts` で `createInitialState()` を呼び直すことで行う)。

ラウンドの決着が試合の決着(2 本目)を兼ねる場合でも、必ず一度 `roundOver` の
結果フリーズを経てから `matchOver` に遷移する(決勝ラウンドの結果も必ず表示される)。

---

## 6. 操作(ローカル 2P / 1キーボード)

| | 移動 | 回避 | 弱 | 強 |
|---|---|---|---|---|
| P1(左・青) | A / D | W | F | G |
| P2(右・赤) | ← / → | ↑ | K | L |

追加操作:

- **C**: 「VS CPU」⇄「VS PLAYER(ローカル 2P)」切替。デフォルトは VS CPU で、
  起動直後から 1 人で CPU と対戦できる。
- **V**: CPU の難易度切替(`easy` → `normal` → `hard` を循環、デフォルトは `normal`)。
  VS PLAYER 中でも切替でき、次に VS CPU に戻したときに反映される。
- **Enter / Space**: `matchOver` 時に新しい試合を開始(`createInitialState()` を再生成)。

### CPU 対戦(`src/sim/bot.ts` の `cpuBot`)

`reactiveBot` をベースに、勝てるが完璧ではない「人間が崩せる」相手として:

- 相手の攻撃に反応してジャスト回避を狙うが、確率的に反応をサボる(`Math.random` 使用)。
- 間合いを詰めすぎ/離れすぎないよう調整し、相手の硬直時に攻め込む。

`cpuBot` はライブプレイ専用で `Math.random` に依存するため非決定的。
`simulate.ts` が使う `aggressiveBot` / `reactiveBot` は引き続き決定論的(乱数を使わない)。

#### CPU 難易度プリセット(`CPU_DIFFICULTIES`)

`cpuBot(reactionDelay, skipReactionChance)` のパラメータをプリセット化したもの。
`reactionDelay` が `JUST.window`(7)以下であれば理論上ジャスト回避が成立し得るが、
`skipReactionChance` が高いほど反応そのものをサボる確率が上がる。

| 難易度 | reactionDelay | skipReactionChance | 傾向 |
|---|---|---|---|
| easy | 9 | 0.6 | 反応が遅く、サボりがち |
| normal | 6 | 0.35 | `cpuBot()` の既定値 |
| hard | 4 | 0.12 | 反応が早く、サボりが少ない |

### 画面演出(`main.ts` のエフェクトレイヤー)

エンジンの純粋性を保ったまま、tick 前後の `GameState` を diff してイベントを検出し、
見た目の演出だけを `main.ts` 側のローカル状態として加える:

- **ジャスト回避成立**(`stunTicks` が 0 から増加): 約 120ms のヒットストップ
  (固定ステップの進行を一時停止、描画は継続)+ 画面フラッシュ + 「JUST!」テキスト。
- **被弾**(`hp` 減少): 画面シェイク。

---

## 7. 技術スタック

- **TypeScript + Vite**(開発サーバ / ビルド)
- **HTML5 Canvas** 描画(幾何図形ベース、軽量)
- **Vitest** 単体テスト(コンバットロジック・タイミング窓)
- **ESLint + Prettier** 静的解析 / 整形
- **GitHub Actions** CI(install → lint → typecheck → test → build)

### アーキテクチャ方針
ゲームロジック(純粋・テスト可能)を描画・入力から完全分離する。

```
src/
  engine/
    types.ts       共有型・インターフェース(契約)
    constants.ts   バランス数値(本書の値の単一の出典)
    state.ts       GameState / PlayerState ファクトリ
    combat.ts      攻撃・回避・ジャスト回避の解決(純粋関数)
    engine.ts      1 tick を進める step 関数(純粋)
  input/
    input.ts       キーボード → InputState
  render/
    renderer.ts    GameState → Canvas 描画
  sim/
    bot.ts         スクリプト AI(aggressive / reactive / CPU 対戦用 cpuBot)
    simulate.ts    ヘッドレス対戦ランナー(バランス検証ツール)
  main.ts          ブートストラップ(ループ・入力・描画の結線)
test/
  combat.test.ts
  engine.test.ts
```

- `engine` 配下はブラウザ API に依存しない純粋ロジック。`step(state, inputs) -> state`。
- `constants.ts` が全バランス値の唯一の出典(本書と一致させる)。

---

## 8. 自動化ツール

1. **CI パイプライン**(`.github/workflows/ci.yml`):push/PR で lint・typecheck・test・build。
2. **SessionStart hook**(`.claude/hooks/session-start.sh`):Web セッション起動時に `npm install`。
3. **ヘッドレスシミュレーション**(`npm run sim`):2 体のボットを対戦させ、勝率・平均被ダメ・ジャスト回避成功率を出力。バランス調整と回帰検出の自動化ツールを兼ねる。
