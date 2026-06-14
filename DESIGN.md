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

| 項目             | 値                                      |
| ---------------- | --------------------------------------- |
| HP               | 100                                     |
| スタミナ         | 最大 100 / 回復 25 per sec(≈0.417/tick) |
| 移動速度(地上)   | 3 px/tick                               |
| 移動速度(空中)   | 2.2 px/tick(`PLAYER.airMoveSpeed`。空中では制御を弱める) |
| サイズ           | 40 px                                   |
| アリーナ幅       | 800 px                                  |

---

## 4. アクション定義(tick 単位)

### 攻撃

| 攻撃      | 発生(windup) | 持続(active) | 硬直(recovery) | ダメージ | 間合い(横) | 間合い(縦) |
| --------- | ------------ | ------------ | -------------- | -------- | ----------- | ----------- |
| 弱(Light) | 9 (150ms)    | 2            | 12             | 10       | 70 px       | 52 px       |
| 強(Heavy) | 27 (450ms)   | 3            | 30             | 30       | 90 px       | 60 px       |

- ヒット判定は active フレーム中、横の間合い・縦の間合いの両方に入っている相手に発生。
- 縦の間合い(`verticalRange`)は攻撃側・防御側の `y`(接地からの高さ)の差。これを超えると、
  相手がジャンプで攻撃を「飛び越えた」ことになり、回避扱いではなく単純に空振りする
  (i-frame・ジャスト回避とは独立した、ジャンプによる第三の回避手段)。
- 攻撃中は横移動不可(空中で攻撃を出した場合も、重力による落下は継続する)。

### 回避(Dodge)

| 項目          | 値                                                                           |
| ------------- | ---------------------------------------------------------------------------- |
| 無敵(i-frame) | 開始から 11 tick(≈180ms)                                                     |
| 総持続        | 18 tick                                                                      |
| クールダウン  | 持続終了後 6 tick                                                            |
| スタミナ消費  | 35                                                                           |
| 移動          | 回避方向へ 2 px/tick × i-frame 中(最大 22px。攻撃の間合いより十分小さく保つ) |

### ジャスト回避の判定ルール(重要)

攻撃の active フレームが、防御側の i-frame と重なった場合 → **ダメージ無効**。
そのうち、

- 防御側が回避を**開始した tick** が、攻撃の active 開始の **9 tick 前以内**(≈150ms)だった場合
  → **ジャスト回避**:攻撃側を 24 tick(≈400ms)硬直 + 防御側にスタミナ 35 全額還元。
- それより早く出した回避(10 tick 以上前)→ ダメージは無効だが報酬なし(早すぎる読み回避)。

> 当初は 7 tick(≈120ms)だったが、反応がやや忙しかったため 9 tick(≈150ms)へ緩和(易化)した。
> loose ボットの `reactionDelay`(15)未満に保つ限り、ヘッドレスシミュレーションの基準結果は変わらない。

> 反応して出した精密な回避だけが報われ、先読み連打は報われない。

### ジャンプ(Jump)

| 項目                | 値                                                              |
| ------------------- | ---------------------------------------------------------------- |
| 初速(`JUMP.velocity`) | 9 px/tick(上向き)                                              |
| 重力(`JUMP.gravity`)  | 0.55 px/tick²                                                   |
| 空中ジャンプ回数(`JUMP.airJumps`) | 1(二段ジャンプ)                                    |
| 滞空時間            | ≈ 2 × velocity / gravity ≈ 33 tick(≈0.55s)                      |
| 最高到達高さ        | ≈ velocity² / (2 × gravity) ≈ 74 px                             |

- 接地中(`y === 0 && vy === 0`)にジャンプ入力で `vy = JUMP.velocity` となり離地する。
- 空中で `airJumps > 0` の間にもう一度ジャンプ入力すると、`vy` を `JUMP.velocity` にリセットして
  二段ジャンプし、`airJumps` を 1 消費する。接地すると `airJumps` は回復する。
- 毎 tick `vy -= JUMP.gravity` し、`y += vy` で放物線を描く。`y <= 0` になった tick で
  `y = 0, vy = 0` に補正し、着地とみなす。
- 空中では攻撃・回避・硬直の有無に関わらず重力が適用され続ける(空中で行動不能になっても
  必ず落下する)。
- 空中の横移動は `PLAYER.airMoveSpeed`(2.2 px/tick)に弱まる。
- 攻撃の「縦の間合い(`verticalRange`)」を利用し、ジャンプで攻撃を飛び越えることも
  回避手段の一つになる(上記「攻撃」節を参照)。
- ジャンプ・回避・攻撃は同一 tick では排他(`isLocked` が true の間はジャンプ入力を無視)。

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

|            | 移動  | 回避 | ジャンプ | 弱  | 強  |
| ---------- | ----- | ---- | -------- | --- | --- |
| P1(左・青) | A / D | W    | Space    | F   | G   |
| P2(右・赤) | ← / → | ↑    | Shift    | K   | L   |

- ジャンプは接地中・空中(`airJumps` が残っている間)のどちらでも入力でき、
  空中入力時は二段ジャンプとして `vy` をリセットする(詳細は「4. アクション定義」参照)。

追加操作:

- **C**: 「VS CPU」⇄「VS PLAYER(ローカル 2P)」切替。デフォルトは VS CPU で、
  起動直後から 1 人で CPU と対戦できる。
- **V**: CPU の難易度切替(`easy` → `normal` → `hard` を循環、**デフォルトは `easy`**)。
  VS PLAYER 中でも切替でき、次に VS CPU に戻したときに反映される。
- **H**: ジャスト回避アシスト(攻撃側に描く収束リング)の ON/OFF 切替。デフォルト ON。
  状態はモードラベルに 🟡/⚪ で表示する。
- **M**: ミュート切替(`AudioEngine` の ON/OFF。状態はモードラベルに 🔊/🔇 で表示)。
- **Enter / Space**: `matchOver` 時に新しい試合を開始(`createInitialState()` を再生成)。

### CPU 対戦(`src/sim/bot.ts` の `cpuBot`)

`reactiveBot` をベースに、勝てるが完璧ではない「人間が崩せる」相手として:

- 相手の攻撃に反応してジャスト回避を狙うが、確率的に反応をサボる(`Math.random` 使用)。
- 間合いを詰めすぎ/離れすぎないよう調整し、相手の硬直時に攻め込む。

`cpuBot` はライブプレイ専用で `Math.random` に依存するため非決定的。
`simulate.ts` が使う `aggressiveBot` / `reactiveBot` は引き続き決定論的(乱数を使わない)。

#### CPU 難易度プリセット(`CPU_DIFFICULTIES`)

`cpuBot(reactionDelay, skipReactionChance, allowJustPunish)` のパラメータをプリセット化したもの。
`reactionDelay` が小さいほど反応が速く、`skipReactionChance` が高いほど反応そのものをサボる。
`allowJustPunish` が `true` の難易度は、反応したときジャスト回避が成立してプレイヤーを硬直
させる(=切り返してくる)。easy は `allowJustPunish: false` とし、ジャスト成立窓
(`ticksUntilActive <= JUST.window`)に入った反応を抑制して「早読み回避」しか行わないため、
**回避してもプレイヤーを硬直させない**(初心者が安心して攻め込める)。

> 補足: `cpuBot` は各 tick 反応を試みるため、`reactionDelay` を window より大きく取るだけでは
> サボりで反応が遅れた結果ジャスト窓に入り得る。easy の非懲罰性は `allowJustPunish` で明示的に
> 担保している(`reactionDelay`/`JUST.window` の大小関係だけには依存しない)。

| 難易度 | reactionDelay | skipReactionChance | allowJustPunish | 傾向                                       |
| ------ | ------------- | ------------------ | --------------- | ------------------------------------------ |
| easy   | 10            | 0.6                | false           | 反応が遅くサボりがち。切り返さない(早読みのみ) |
| normal | 6             | 0.35               | true            | 反応時はジャスト回避で切り返す             |
| hard   | 4             | 0.12               | true            | 反応が早く、サボりが少ない                 |

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
- **ジャンプ発生**(`vy` が 0 以下から上昇に転じた tick。二段ジャンプも含む):
  `AudioEngine.jump()`。
- **着地**(`y` が 0 より大きい状態から `0` に転じた tick): 足元に
  `ParticleSystem.landingDust` + `AudioEngine.land()`。
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

`TouchControls` クラスが、Pointer Events を使った画面上のボタン群を DOM に生成し、
`InputManager.pressVirtual` / `releaseVirtual`(キーボードの keydown/keyup と同じ
セマンティクスを持つ「仮想キー」API)に直結する。

- **P1 操作クラスタ**(常時表示): ◀('a')・▶('d')・回避('w')・ジャンプ(' ')・弱('f')・強('g')。
  デフォルト(VS CPU = 1人プレイ)では `tc-cluster` を画面全幅に広げ、移動ボタンを画面左端、
  回避・ジャンプ・攻撃ボタンを画面右端へ大きく離して配置する(操作の取り違えを防ぎ、
  両手の届きやすい位置に分離する)。回避は他より大きいボタンとして強調配置。
- **P2 操作クラスタ**: `setTwoPlayer(true)`(VS PLAYER モード)のときのみ表示。この時は
  `tc-two-player` クラスにより両クラスタが画面の左右半分ずつに戻り、P1 と左右反転した配置
  (◀('arrowleft')・▶('arrowright')・回避('arrowup')・ジャンプ('shift')・弱('k')・強('l'))
  で画面右側に表示する。タブレットを横向きに置いた対面プレイを想定。
- **メニュー行**(上部、常時表示): 対戦切替('c')・難易度('v')・アシスト('h')・ミュート('m')・
  リスタート('enter')。これらは「タップした瞬間だけ」反応すればよいため、
  `pressVirtual` 直後に `releaseVirtual` して `justPressed` にのみ残す(`momentary`)。
- 各ボタンは `pointerdown`/`pointerup`/`pointercancel`/`pointerleave` +
  `setPointerCapture` + `preventDefault` で実装され、ボタンごとに独立した
  ポインタを扱うためマルチタッチ(例: ◀ を押しながら回避をタップ)に対応する。
- `isTouchDevice()` が `window.matchMedia('(pointer: coarse)').matches` または
  `'ontouchstart' in window` でタッチ環境を検出し、該当時のみ UI を表示する
  (CSS クラス `tc-visible` の切替)。

### 7.2 音声(`src/audio/audio.ts`)

`AudioEngine` クラスが Web Audio API のオシレーター/ノイズバッファ + ゲインエンベロープで
効果音をその場合成する(音声アセットファイル不使用)。`AudioContext` は遅延生成し、
`unlock()` を最初のユーザー操作(`pointerdown`/`keydown`)で一度だけ呼んで
`resume()` する(iOS Safari 対策)。`setMuted(true)` でミュート時は全メソッドが no-op になる。

提供メソッド: `swing(kind)` / `hit(kind)` / `just()` / `dodge()` / `jump()` / `land()` / `ko()` /
`roundStart()` / `matchEnd()`。呼び出しは上記「画面演出」節のイベント検出に連動する。

### 7.3 パーティクル(`src/render/particles.ts`)

`ParticleSystem` クラスが `{x, y, vx, vy, life, maxLife, size, color, gravity}` の
シンプルなパーティクルを管理する(`Math.random` 使用、視覚効果のみで決定性に影響しない)。

- `sparks(x, y, color, count)`: ヒット時の火花。
- `burst(x, y, color, count)`: ジャスト回避成立時の放射状バースト。
- `dust(x, y, dir)`: 回避時に進行方向へ広がる砂塵。
- `landingDust(x, y)`: ジャンプ着地時、足元から左右に広がる砂塵。
- `update(dtMs)` で運動・寿命を更新し、`draw(ctx)` で `life/maxLife` を alpha として描画する。
  総数は `MAX_PARTICLES`(400)で上限管理する。

### 7.4 レンダラー強化(`src/render/renderer.ts`)

`RenderEffects` に `worldOverlay?: (ctx) => void` を追加し、画面シェイク変換の内側・
キャラクター描画より後・HUD より前で呼び出す(`main.ts` から `particles.draw(ctx)` を渡す)。
また `showJustCue?: boolean`(未指定なら ON 扱い)で後述のジャスト回避アシストの表示を制御する。

主な視覚強化:

- **ジャスト回避アシスト(収束リング)**: `showJustCue` が ON のとき、攻撃の windup 中の
  攻撃側を囲むリングを描く。リングは発生(active)に向けて縮み、ちょうど発生する瞬間に
  プレイヤー大へ重なる。発生まで `JUST.window` tick 以内(=今回避を出せばジャスト回避が
  成立する猶予)に入るとリングを金色に光らせ、「今が回避のタイミング」だと視覚的に教える。
  初心者がジャスト回避の間合いを体得するための補助で、'h' / アシストボタンで OFF にできる
  (`Renderer.drawJustCue`、エンジン状態には一切影響しない描画専用機能)。

- グラデーション背景・床・各ファイターの足元シャドウ。
- **人型キャラクター + 攻撃モーション**: キャラクターは頭・胴・両腕両脚を持つ人型
  (`Renderer.computePose` → `drawHumanoid`)で描画し、状態に応じて手足のポーズを変える。
  - 攻撃は kind ごとに「引き(windup)→振り(active)→戻り(recovery)」のモーションを与える。
    弱は拳を引いて突き出すジャブ、強は両手を振りかぶって前方へ叩き込む大振り。
    これにより「何の攻撃をいつ出したか」が動きで分かり、回避タイミングを掴みやすくなる。
  - active 中は振り抜きの斬撃弧(`drawSlash`、弱=黄の短い streak / 強=赤橙の大きな弧)を
    前方に描いて発生の瞬間を強調する。攻撃発生中・被スタン中は人型全体をグロー(`shadowBlur`)。
  - 接地移動中は脚を交互に・腕を逆位相に振る歩行アニメ(移動距離に同期した `stridePhase` と、
    移動状態へ滑らかに追従する `walkAmp`)、ジャンプ中は脚を畳み、回避中はしゃがみ、
    被スタン中はのけぞってふらつく。頭部には向き(`facing`)を示す目を描く。
- 回避の i-frame 中(`dodge.elapsed < DODGE.iframes`)は進行方向に半透明の
  残像(アフターイメージ)を描画。
- **ジャンプの視覚表現**: キャラクターは `y`(接地からの高さ)に応じて画面上で
  上下する(`ARENA.floorY - p.y`)。攻撃判定の表示(テレグラフ・ヒットボックス・
  残像)もすべて同じ高さに追従する。足元のシャドウは `y` が大きいほど縮小・
  薄くなり、空中にいる距離感を表現する。
- **スクワッシュ&ストレッチ**: ジャンプ上昇中は縦に伸び横に縮み、落下中はその逆方向に
  弱く変形し、着地直後の短時間(`LANDING_SQUASH_MS`)は横に広がり縦につぶれる
  「着地の衝撃」演出を加える(`Renderer.jumpSquashScale`、足元を基準にスケール)。
- HUD の HP バーは Renderer 内部に保持する「表示用 HP」を実値へ毎フレーム補間
  (lerp)させ、滑らかに減少させる。直前の減少分は薄い色の
  「チップダメージ」として一時的に残してフェードアウトする
  (この補間状態は描画専用で、ゲームロジック・決定性には影響しない)。
- WINS 表示をピップ(丸印)化し、READY/FIGHT! やラウンド/マッチ結果画面に
  フェード・スケールの演出を追加。「JUST!」テキストは `justTextAlpha` に応じて
  ポップする(出現直後に拡大→収束)スケール効果を持つ。

### 7.5 モバイル向け HTML/CSS(`index.html`)

- ビューポートメタタグでピンチズーム/二重タップズームを無効化
  (`maximum-scale=1, user-scalable=no, viewport-fit=cover`)。
- ゲームコンテナはビューポート全体に広がり、キャンバスは 800:450(16:9)の比率を
  保ったまま `min(100vw, 100dvh * 16/9)` などで最大サイズにフィットする
  (モバイル Safari の `100vh` 問題を避けるため `dvh` を使用)。
- タッチ操作 UI はキャンバスのビューポート要素に重ねて配置する。
- 画面が縦向きの小型タッチデバイスでは、横向きを促す案内オーバーレイを表示する
  (`(pointer: coarse) and (orientation: portrait)` で判定し、デスクトップの
  縦長ウィンドウでは表示しない)。
- ノッチ等のセーフエリアは `env(safe-area-inset-*)` で操作 UI にパディングする。
- 既存のキーボード操作ヒントはタッチデバイス(`(pointer: coarse)`)では非表示にする。

---

## 8. 技術スタック

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
    input.ts       キーボード/仮想キー → InputState
    touch.ts       タッチ操作 UI(Pointer Events → 仮想キー)
  audio/
    audio.ts       Web Audio による効果音エンジン
  render/
    renderer.ts    GameState → Canvas 描画
    particles.ts   演出パーティクルシステム
  sim/
    bot.ts         スクリプト AI(aggressive / reactive / CPU 対戦用 cpuBot)
    simulate.ts    ヘッドレス対戦ランナー(バランス検証ツール)
  main.ts          ブートストラップ(ループ・入力・描画・音声・パーティクルの結線)
test/
  combat.test.ts
  engine.test.ts
  input.test.ts
```

- `engine` 配下はブラウザ API に依存しない純粋ロジック。`step(state, inputs) -> state`。
- `constants.ts` が全バランス値の唯一の出典(本書と一致させる)。
- `input/touch.ts`・`audio/audio.ts`・`render/particles.ts`・`render/renderer.ts` の視覚/音声強化は
  `DOM`/`AudioContext`/`PointerEvent`/`Math.random` に依存するエンジン外レイヤーであり、
  `engine`/`sim` から import されない(7 章参照)。

---

## 9. 自動化ツール

1. **CI パイプライン**(`.github/workflows/ci.yml`):push/PR で lint・typecheck・test・build。
2. **SessionStart hook**(`.claude/hooks/session-start.sh`):Web セッション起動時に `npm install`。
3. **ヘッドレスシミュレーション**(`npm run sim`):2 体のボットを対戦させ、勝率・平均被ダメ・ジャスト回避成功率を出力。バランス調整と回帰検出の自動化ツールを兼ねる。
