# 刹那 (SETSUNA) — Just-Dodge Duel

1対1のリアルタイム 3D 対戦ゲーム。コアは **「ジャスト回避(Just Dodge)」** と
**「サイドステップ」**。攻撃は必ず回避可能で、保証されたチップダメージは存在しない。
**完璧にプレイすれば一切ダメージを受けない** — 強さは完全にプレイヤーの腕前で決まる。

---

## 1. デザインの核

- 戦場は円形の 3D アリーナ。両者は常に**ロックオン状態**(自動的に相手の方を向く)で、
  移動入力は「相手を正面とした相対方向」(前後 = 接近/後退、左右 = サイドステップ)として扱われる。
- 攻撃には向き(`aimAngle`)があり、発生(windup)開始時点の自分の正面方向に固定される。
  ヒット判定は扇形(`arcHalfAngle`)で行われるため、**真横へのサイドステップで攻撃の正面から
  外れれば、間合い内でも攻撃を回避できる**(間合い管理だけが防御手段ではない)。
- すべての攻撃は正しいタイミングの回避で完全に無効化できる。
- 回避は**スタミナ**を消費する。連打できない。ミスした回避はスタミナを枯渇させ、次の攻撃を受ける原因になる。
- **ジャスト回避**(攻撃の発生直前に反応して出した精密な回避)は、ダメージ無効に加えて報酬を与える:
  - 相手を硬直させる(確定反撃)
  - 消費スタミナを全額還元(精密さの持続的な見返り)
- 早すぎる「読み回避」や連打回避はダメージは防げても報酬なし。さらにスタミナを浪費する。

この「アリーナでの位置取り(サイドステップ)× スタミナ × 反応精度」の三軸が、
上達するほど被ダメージがゼロに近づくという**高い技量天井**を生む。

---

## 2. 時間モデル

- 決定論的な固定ステップ。**60 TPS(1 tick ≈ 16.67ms)**。
- すべてのタイミングは tick 単位で定義 → 単体テスト・ヘッドレスシミュレーションで厳密に検証可能。
- 描画は tick とは独立(補間してよいが、ゲームロジックは tick 駆動)。

---

## 3. 座標系・アリーナ・ロックオン

- 戦場は **円形の 3D アリーナ**。中心を原点 `(0, 0)` とする x-z 平面上で全ての位置を扱う
  (y は常に 0。見た目の高さは描画レイヤーのみで使用)。
- アリーナ半径 `ARENA.radius = 320`、プレイヤーの当たり半径 `ARENA.playerRadius = 16`。
  プレイヤー中心は `hypot(x, z) <= radius - playerRadius` の円内に拘束される
  (`clampToArena`)。
- **ロックオン**: 両者は常に相手の方を向く。`facing = atan2(opp.z - self.z, opp.x - self.x)`
  を `fighting` 中は毎 tick 再計算する。`facing` から `facingVec = (cos f, sin f)`
  (正面方向)と `rightVec = (sin f, -cos f)`(右方向)が決まる。
- **入力の意味**: `PlayerInput.move = { forward, strafe }` はロックオン基準の相対値。
  `forward = 1` は相手へ接近、`forward = -1` は後退、`strafe` は左右のサイドステップ。
  実際の移動ベクトルは `facingVec * forward + rightVec * strafe` を正規化した方向に
  `PLAYER.moveSpeed` を乗じたもの。

| 項目         | 値                                      |
| ------------ | --------------------------------------- |
| HP           | 100                                     |
| スタミナ     | 最大 100 / 回復 25 per sec(≈0.417/tick) |
| 移動速度     | 3 ワールド単位/tick                    |
| 当たり半径   | 16 ワールド単位                        |
| アリーナ半径 | 320 ワールド単位                       |

---

## 4. アクション定義(tick 単位)

### 攻撃

| 攻撃      | 発生(windup) | 持続(active) | 硬直(recovery) | ダメージ | 間合い | 扇角(arcHalfAngle) |
| --------- | ------------ | ------------ | -------------- | -------- | ------ | ------------------- |
| 弱(Light) | 9 (150ms)    | 2            | 12             | 10       | 70     | 0.60 rad(≈34.4°)   |
| 強(Heavy) | 27 (450ms)   | 3            | 30             | 30       | 90     | 0.52 rad(≈29.8°)   |

- **方向の確定(`aimAngle`)**: 攻撃の windup 開始時、その瞬間の自分の `facing` を
  `aimAngle` として攻撃に固定する。以降ロックオンで `facing` が変化しても、
  既に発生済みの攻撃の判定方向は変わらない(「打った瞬間の正面」に向かって攻撃が出る)。
- **ヒット判定(扇形)**: active フレーム中、`dist = hypot(defender.x - attacker.x, defender.z - attacker.z)`
  が間合い以内、かつ `angleToDefender = atan2(dz, dx)` と `aimAngle` の差
  `delta = normalizeAngle(angleToDefender - aimAngle)` が `|delta| <= arcHalfAngle`
  の場合のみ命中する。間合い内でも扇の外(サイドステップで真横や背後に回り込んだ場合)は
  **空振り**になる。
- 攻撃中は移動不可。

### 回避(Dodge)

| 項目          | 値                                                                              |
| ------------- | -------------------------------------------------------------------------------- |
| 無敵(i-frame) | 開始から 11 tick(≈180ms)                                                        |
| 総持続        | 18 tick                                                                         |
| クールダウン  | 持続終了後 6 tick                                                               |
| スタミナ消費  | 35                                                                              |
| 移動          | ダッシュ方向(`dirX, dirZ`)へ 2 ワールド単位/tick × i-frame 中(最大 22 単位)  |

- **ダッシュ方向の確定(`dirX, dirZ`)**: 回避開始時の移動入力 `{forward, strafe}` が
  ニュートラルでなければ、その方向(ロックオン基準、`facingVec`/`rightVec` で
  ワールド座標に変換・正規化)へダッシュする(= **サイドステップ回避**)。
  入力がニュートラルなら `-facingVec`(その場で後方へバックステップ)になる。
  この方向は回避開始時に固定され、ロックオンの変化による影響は受けない。

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

移動はすべて**ロックオン基準の相対方向**(前後 = 接近/後退、左右 = サイドステップ)。

|              | 前後  | 左右(サイドステップ) | 回避  | 弱  | 強  |
| ------------ | ----- | ---------------------- | ----- | --- | --- |
| P1(青)       | W / S | A / D                   | Shift | F   | G   |
| P2(赤)       | ↑ / ↓ | ← / →                   | /     | K   | L   |

追加操作:

- **C**: 「VS CPU」⇄「VS PLAYER(ローカル 2P)」切替。デフォルトは VS CPU で、
  起動直後から 1 人で CPU と対戦できる。
- **V**: CPU の難易度切替(`easy` → `normal` → `hard` を循環、デフォルトは `normal`)。
  VS PLAYER 中でも切替でき、次に VS CPU に戻したときに反映される。
- **M**: ミュート切替(`AudioEngine` の ON/OFF。状態はモードラベルに 🔊/🔇 で表示)。
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

| 難易度 | reactionDelay | skipReactionChance | 傾向                       |
| ------ | ------------- | ------------------ | -------------------------- |
| easy   | 9             | 0.6                | 反応が遅く、サボりがち     |
| normal | 6             | 0.35               | `cpuBot()` の既定値        |
| hard   | 4             | 0.12               | 反応が早く、サボりが少ない |

### 画面演出(`main.ts` のエフェクトレイヤー)

エンジンの純粋性を保ったまま、tick 前後の `GameState` を diff してイベントを検出し、
見た目・音・パーティクルの演出だけを `main.ts` 側のローカル状態として加える
(`detectEvents(prev, next)`):

- **ジャスト回避成立**(`stunTicks` が 0 から増加): 約 120ms のヒットストップ
  (固定ステップの進行を一時停止、描画は継続)+ 画面フラッシュ + 「JUST!」テキスト +
  防御側の位置に `ParticleSystem.burst` + `AudioEngine.just()`。
- **被弾**(`hp` 減少): 画面シェイク + 被弾位置に `ParticleSystem.sparks` +
  `AudioEngine.hit(kind)`(減少量が `ATTACKS.heavy.damage` 以上なら `'heavy'`、
  それ未満なら `'light'`)。
- **攻撃発生**(`attack` が `null` → 非 `null`、`elapsed === 1`): `AudioEngine.swing(kind)`。
- **回避発生**(`dodge` が `null` → 非 `null`、`elapsed === 1`): `ParticleSystem.dust` +
  `AudioEngine.dodge()`。
- **フェーズ遷移**(`phase` の変化): `'starting'` 開始時に `AudioEngine.roundStart()`、
  `'roundOver'` 開始時に KO(いずれかの `hp <= 0`)なら `AudioEngine.ko()`、
  `'matchOver'` 開始時に `AudioEngine.matchEnd()`。

---

## 7. スマートフォン対応・音声・視覚効果(エンジン外レイヤー)

以下はすべて `src/engine/**` の**外側**に存在する、描画・入力・演出専用のレイヤーである。
`Math.random` / `Date` / `performance.now` / `AudioContext` / `PointerEvent` / DOM API は
**これらのレイヤーのみ**で使用が許可されており、`src/engine/**` および `src/sim/**` から
import されることは一切ない。`npm run sim` とエンジンのユニットテストは本節の変更による
影響を受けず、決定論的な結果を保つ。

### 7.1 タッチ操作(`src/input/touch.ts`)

`TouchControls` クラスが、Pointer Events を使った画面上の操作 UI を DOM に生成し、
`InputManager.setStick` / `pressVirtual` / `releaseVirtual`(キーボードの keydown/keyup
と同じセマンティクスを持つ「仮想キー」API)に直結する。画面は **左半分 =
バーチャルアナログスティック(移動)、右半分 = アクションボタン(回避/弱/強)** に分割する。

- **`VirtualStick`**: ベース円内をドラッグした中心からの相対ベクトルを
  `{forward, strafe}`(画面上方向 = forward+、右方向 = strafe+)に変換し、
  `InputManager.setStick(player, forward, strafe)` を呼ぶ。離すと `(0, 0)` に戻る。
  ロックオン基準の相対入力であるキーボードの WASD / 矢印と同じ意味を持つ。
- **P1 レイヤー**(画面下、常時表示): 左にスティック、右に弱('f')・強('g')・
  回避('shift')のアクションボタン。
- **P2 レイヤー**(画面上)): `setTwoPlayer(true)`(VS PLAYER モード)のときのみ表示。
  P1 と 180° 反転した配置(対面プレイ用)で、スティック='/'系ではなく同じ
  `setStick(1, ...)`、ボタンは弱('k')・強('l')・回避('/')。
- **メニュー行**(上部、常時表示): 対戦切替('c')・難易度('v')・ミュート('m')・
  リスタート('enter')。これらは「タップした瞬間だけ」反応すればよいため、
  `pressVirtual` 直後に `releaseVirtual` して `justPressed` にのみ残す(`momentary`)。
- 各ボタン/スティックは `pointerdown`/`pointermove`/`pointerup`/`pointercancel` +
  `setPointerCapture` + `preventDefault` で実装され、要素ごとに独立したポインタを
  扱うためマルチタッチ(例: スティックを操作しながら回避をタップ)に対応する。
- `isTouchDevice()` が `window.matchMedia('(pointer: coarse)').matches` または
  `'ontouchstart' in window` でタッチ環境を検出し、該当時のみ UI を表示する
  (CSS クラス `tc-visible` の切替)。

### 7.2 音声(`src/audio/audio.ts`)

`AudioEngine` クラスが Web Audio API のオシレーター/ノイズバッファ + ゲインエンベロープで
効果音をその場合成する(音声アセットファイル不使用)。`AudioContext` は遅延生成し、
`unlock()` を最初のユーザー操作(`pointerdown`/`keydown`)で一度だけ呼んで
`resume()` する(iOS Safari 対策)。`setMuted(true)` でミュート時は全メソッドが no-op になる。

提供メソッド: `swing(kind)` / `hit(kind)` / `just()` / `dodge()` / `ko()` /
`roundStart()` / `matchEnd()`。呼び出しは上記「画面演出」節のイベント検出に連動する。

### 7.3 パーティクル(`src/render/particles.ts`)

`ParticleSystem` クラスが Three.js の `THREE.Points`(`object3D`)上で 3D ワールド座標
`(x, y, z)` のパーティクルを管理する(`Math.random` 使用、視覚効果のみで決定性に影響しない)。

- `sparks(x, y, z, color, count)`: ヒット時の火花。
- `burst(x, y, z, color, count)`: ジャスト回避成立時の放射状バースト。
- `dust(x, y, z, dirX, dirZ)`: 回避のダッシュ方向 `(dirX, dirZ)` の後方へ広がる砂塵。
- `update(dtMs)` で運動・寿命を更新し、`position`/`color`/`size` の `BufferAttribute` へ
  書き込む(`needsUpdate = true`)。総数は `MAX_PARTICLES`(600)で上限管理する。
- `object3D` を `Renderer.addParticles()` で `THREE.Scene` に追加することで描画に統合する。

### 7.4 3D レンダラー(`src/render/renderer.ts`)

`Renderer` クラスは Three.js の `WebGLRenderer` + `PerspectiveCamera`(視野角 45°)で
円形アリーナをレンダリングする。

- **アリーナ**: `CircleGeometry(ARENA.radius, 64)` の床に、同心円のグリッドリング +
  放射状のスポークをライン描画。外周にはグロー用の `RingGeometry` を重ねる。
  `Scene.fog` で奥行きの霧効果を付与。
- **キャラクター**: `CapsuleGeometry` のボディ + 正面方向を示す `BoxGeometry` の
  「バイザー」(`facing` 方向、`group.rotation.y = -p.facing` で向きを反映)。
  攻撃中・被スタン中は半透明のグローシェル(`MeshBasicMaterial`)を点灯させ、
  回避の i-frame 中は本体の opacity を下げて透過させる。
- **アフターイメージ**: 回避の i-frame 中、ダッシュ方向 `(dirX, dirZ)` の後方に
  半透明の残像メッシュ(`CapsuleGeometry` 3 体)を表示する。
- **攻撃テレグラフ**: 攻撃の windup 中、`aimAngle ± arcHalfAngle` の扇形
  (`CircleGeometry` の `thetaStart`/`thetaLength` を間合いに応じて再構築)を
  地面に表示し、攻撃の方向と射程・判定範囲を視覚化する(弱攻撃=黄、強攻撃=赤)。
- **カメラ**: 両者の中間点を `lookTarget` として追従し(lerp)、両者の距離に応じて
  `camDistance` を補間してズーム調整する。`RenderEffects.shakeX/shakeY` を
  カメラ位置・注視点の両方に加算して画面シェイクを表現する。
- `RenderEffects.flashAlpha` は半透明の白いオーバーレイ `<div>`(キャンバスの親要素に
  重ねる)の opacity として反映する。
- `handleResize()` でキャンバスの実サイズに合わせて `renderer.setSize` /
  `camera.aspect` を更新する(`ResizeObserver` + `window.resize` から呼び出す)。

### 7.5 HUD(`src/render/hud.ts`)

HP/スタミナバー・WINS ピップ・中央メッセージ・「JUST!」ポップ・モード表示は、
WebGL キャンバスの**上に重ねた HTML/CSS オーバーレイ**(`index.html` の `#hud` 要素)
として実装する(`Hud` クラスが毎フレーム `update()` で各要素を更新)。

- HP バーは内部に保持する「表示用 HP」を実値へ毎フレーム補間(lerp, `HP_LERP_RATE`)
  させ、滑らかに減少させる。直前の減少分は「チップダメージ」として一時的に残し
  フェードアウトする(この補間状態は描画専用で、ゲームロジック・決定性には影響しない)。
- WINS はピップ(丸印)を `roundsWon` に応じて点灯。
- 中央メッセージは `starting` 中は READY/FIGHT!、`roundOver`/`matchOver` 中は
  ラウンド/マッチ結果(フェードイン)を表示する。
- 「JUST!」テキストは `justTextAlpha` に応じてポップ(出現直後に拡大→収束)する
  スケール効果を持つ。

### 7.6 モバイル向け HTML/CSS(`index.html`)

- ビューポートメタタグでピンチズーム/二重タップズームを無効化
  (`maximum-scale=1, user-scalable=no, viewport-fit=cover`)。
- ゲームコンテナはビューポート全体に広がり、キャンバスは 16:9 の比率を保ったまま
  `min(100vw, 100dvh * 16/9)` などで最大サイズにフィットする
  (モバイル Safari の `100vh` 問題を避けるため `dvh` を使用)。
- HUD オーバーレイ・タッチ操作 UI はキャンバスのビューポート要素に重ねて配置する。
- 画面が縦向きの小型タッチデバイスでは、横向きを促す案内オーバーレイを表示する
  (`(pointer: coarse) and (orientation: portrait)` で判定し、デスクトップの
  縦長ウィンドウでは表示しない)。
- ノッチ等のセーフエリアは `env(safe-area-inset-*)` で操作 UI にパディングする。
- 既存のキーボード操作ヒントはタッチデバイス(`(pointer: coarse)`)では非表示にする。

---

## 8. 技術スタック

- **TypeScript + Vite**(開発サーバ / ビルド)
- **Three.js**(WebGL 3D 描画: カメラ・ライティング・アリーナ・キャラクター・パーティクル)
- **HTML/CSS オーバーレイ HUD**(WebGL キャンバスの上に重ねる軽量 DOM)
- **Vitest** 単体テスト(コンバットロジック・タイミング窓・入力)
- **ESLint + Prettier** 静的解析 / 整形
- **GitHub Actions** CI(install → lint → typecheck → test → build)

### アーキテクチャ方針

ゲームロジック(純粋・テスト可能・3D だが y を使わない x-z 平面上の演算)を
描画・入力から完全分離する。

```
src/
  engine/
    types.ts       共有型・インターフェース(契約)。Vec2{x,z} 座標系
    constants.ts   バランス数値(本書の値の単一の出典)。ARENA/ATTACKS/DODGE 等
    state.ts       GameState / PlayerState ファクトリ(初期配置・ロックオン初期向き)
    combat.ts      攻撃・回避・ジャスト回避・扇形ヒット判定の解決(純粋関数)
    engine.ts      1 tick を進める step 関数(純粋)。ロックオン更新・移動・拘束
  input/
    input.ts       キーボード/仮想キー/アナログスティック → InputState
    touch.ts       タッチ操作 UI(左スティック+右ボタン、Pointer Events → 仮想入力)
  audio/
    audio.ts       Web Audio による効果音エンジン
  render/
    renderer.ts    GameState → Three.js 3D 描画(カメラ・アリーナ・キャラ・テレグラフ)
    particles.ts   3D 演出パーティクルシステム(THREE.Points)
    hud.ts         GameState → HTML オーバーレイ HUD(HP/スタミナ/WINS/メッセージ)
  sim/
    bot.ts         スクリプト AI(aggressive / reactive / CPU 対戦用 cpuBot)
    simulate.ts    ヘッドレス対戦ランナー(バランス検証ツール)
  main.ts          ブートストラップ(ループ・入力・描画・HUD・音声・パーティクルの結線)
test/
  combat.test.ts
  engine.test.ts
  input.test.ts
```

- `engine` 配下はブラウザ API に依存しない純粋ロジック。`step(state, inputs) -> state`。
  座標は `Vec2 {x, z}`(x-z 平面、y は描画専用)。`Math.sin/cos/atan2/hypot/sqrt` は使用可。
- `constants.ts` が全バランス値の唯一の出典(本書と一致させる)。
- `input/touch.ts`・`audio/audio.ts`・`render/particles.ts`・`render/renderer.ts`・
  `render/hud.ts` の視覚/音声強化は `DOM`/`AudioContext`/`PointerEvent`/`Math.random`/
  Three.js に依存するエンジン外レイヤーであり、`engine`/`sim` から import されない
  (7 章参照)。

---

## 9. 自動化ツール

1. **CI パイプライン**(`.github/workflows/ci.yml`):push/PR で lint・typecheck・test・build。
2. **SessionStart hook**(`.claude/hooks/session-start.sh`):Web セッション起動時に `npm install`。
3. **ヘッドレスシミュレーション**(`npm run sim`):2 体のボットを対戦させ、勝率・平均被ダメ・ジャスト回避成功率を出力。バランス調整と回帰検出の自動化ツールを兼ねる。
