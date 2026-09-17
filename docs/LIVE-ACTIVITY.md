# Live Activity（ダイナミックアイランドのレスト残り時間）

> 熊田さん「iPhone の場合はアプリを閉じていても、ダイナミックアイランドで残り分数が分かるような
> 通知形態にしたい。UberEats とかそうだよね」（2026-09-17）

**既定のビルドには入らない。** `ENABLE_LIVE_ACTIVITY=true` を指定した Codemagic ビルドにだけ入る。
ホームウィジェット（`ENABLE_WIDGET`・`docs/WIDGET.md`）とまったく同じ流儀。
**落ちたら環境変数を外すだけで従来ビルドに即戻る。**

---

## 0. いま何が動いているか（3段の関係）

| 段 | 見えるもの | 必要なもの | 状態 |
| --- | --- | --- | --- |
| 1 | アプリを離れてもレスト終了の**通知**が来る | なし（JS だけ） | **入っている**（v1.1.9） |
| 2 | どのタブにいても**残り時間の帯**が見える | なし（JS だけ） | **入っている**（v1.1.9） |
| 3 | **アプリを閉じていても**ダイナミックアイランドに残り分数 | Widget Extension（この文書） | **コードは入っている・点灯は未** |

段1・2は普通のビルドで動く。**段3だけが下の手順を要求する。**

---

## 1. 仕組み（なぜ更新を送らなくていいか）

カウントダウンは **OS が描く**。

```tsx
<Text timerInterval={{ lower: 開始, upper: restEndsAt }} countsDown />
```

アプリが動いていなくても毎秒 OS 側が描き替えるので、
**1秒ごとの update も、プッシュも、サーバも一切要らない。** 開始時に1回出して、終わったら消すだけ。
レストは最長10分なので、Live Activity の8時間制限・4KB制限にもまったく触れない。

| ファイル | 役割 |
| --- | --- |
| `native/src/liveactivity/RestActivity.tsx` | 見た目。`'widget'` ディレクティブ付き＝**別バンドル**にコンパイルされ拡張の隔離ランタイムで走る |
| `native/src/lib/restActivity.ts` | アプリ側の口。**無い環境では静かに no-op**（Android / Expo Go / 設定でオフ / 拡張なしビルド） |
| `native/src/lib/restTimer.ts` | レストの持ち主。開始で `startRestActivity`、停止・0検知で `endRestActivity` |
| `native/app.config.js` | `ENABLE_LIVE_ACTIVITY=true` のときだけ plugin と `NSSupportsLiveActivities` を足す |
| `codemagic.yaml` rn-testflight | 同じ条件で本体 entitlements に App Group を注入 |

### `'widget'` 関数の中でできないこと（Expo 公式の制約）

hooks / state / context / async / import / モジュールスコープの参照は**すべて禁止**。
`t()` も呼べないので、**文言はアプリ側で訳して props で渡す**（`label`）。
`__tests__/liveActivity.test.ts` がこの約束を機械で見張っている。

---

## 2. 点灯の手順（熊田さんの手番）

### 手順1 — Apple Developer portal で App ID を作る

<https://developer.apple.com/account/resources/identifiers/list>

1. **＋** → App IDs → App
2. Bundle ID: **`com.gotcha.bodylog.rn.liveactivity`**（Explicit）
3. Capabilities で **App Groups** にチェック
4. Edit → **`group.com.gotcha.bodylog.rn`** を選ぶ
   （ホームウィジェットで作成済み。無ければ <https://developer.apple.com/account/resources/identifiers/list/applicationGroup> で作る）
5. Save

> 自動署名は App ID 自体は作れるが、**capability の紐付けは自動でやらない**。ここだけは手作業。

### 手順2 — Codemagic でビルド

<https://codemagic.io/apps>

1. BodyLog → **Start new build**
2. Workflow: **rn-testflight**
3. 環境変数に **`ENABLE_LIVE_ACTIVITY` = `true`** を追加（`ENABLE_WIDGET` と同じやり方。
   yaml には書かない＝普段のビルドに混ざらないように）
4. Start build

### 手順3 — 実機で確認

ダイナミックアイランドは **iPhone 14 Pro 以降**にしかない。TestFlight で入れて:

1. 運動タブ → 筋トレを記録する → セットを追加（レストが始まる）
2. **ホームボタン／スワイプでアプリを閉じる**
3. 画面上部の島に ⏱ と残り時間が出る → 長押しで展開 → タップでアプリの筋トレ画面へ戻る
4. ロック画面にもバナーが出る

---

## 3. 失敗したときの読み方

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| `'sharedApplication' is unavailable: not available on iOS` 等で pod のコンパイルが落ちる | **既知の最大リスク**。拡張ターゲットが全 pod（AdMob / RevenueCat / HealthKit）を autolink する（[expo/expo#44695](https://github.com/expo/expo/issues/44695)） | `ENABLE_LIVE_ACTIVITY` を外して従来ビルドに戻す。恒久策は下の「B案」 |
| `Invalid Podfile: private method 'resolve' called ... use_expo_modules_widgets!` | `@expo/ui` の二重インストール（[#44707](https://github.com/expo/expo/issues/44707)） | `package.json` の `overrides["@expo/ui"]` が効いているか確認（テストが見張っている） |
| `Provisioning profile doesn't include com.apple.security.application-groups` | 手順1の capability 紐付け漏れ、または古いプロファイルのキャッシュ | 手順1をやり直し、ポータルで該当プロファイルを削除して再ビルド（`docs/WIDGET.md` と同じ） |
| ビルドは通るが島に出ない | 端末が iPhone 13 以前／設定でライブアクティビティがオフ／`NSSupportsLiveActivities` 欠落 | ログの「NSSupportsLiveActivities が Info.plist にありません」を確認。設定 › BodyLog › ライブアクティビティ |

### B案（A が pod で落ちたとき）

既存の `BodyLogWidget` 拡張（`native/widget/BodyLogWidget.swift`・ruby 注入）は **pod を1つも引き込まない純 SwiftUI** なので、#44695 が構造的に起きない。
そちらに `ActivityConfiguration` を相乗りさせる。Swift を書くことになり、Mac が無いので CI ビルドが唯一の検証手段になる（`docs/WIDGET.md` と同じ制約）。
調査時の骨子は会話ログの調査レポートに残っている。

---

## 4. 決めたこと（設計判断）

1. **終了通知と Live Activity は両方出す。** `docs/TODO.md` B10 は「Live Activity が使える端末では
   終了通知を出さない」と書いていたが、**Live Activity は音を鳴らさない**。
   ジムでポケットに入れている場面を考えると「島＝目で見る／通知＝音と振動」で役割が違う。
2. **レスト終了後の後始末。** バックグラウンドでは JS が止まるので 0 の瞬間に `end()` を呼べず、
   アプリを開くまで島に残ることがある。前景で 0 を見たとき、および**次の起動時**（`cleanupRestActivities`）に畳む。
3. **Android は別**。`expo-notifications` にカウントダウン（クロノメーター）は無い。
   自前の小さな Kotlin モジュール（`setChronometerCountDown`）が要る。`docs/TODO.md` に残してある。

---

## 5. 未確認のまま残っていること

**実ビルドでしか分からない。ビルド1本で潰す。**

1. ★拡張ターゲットが BodyLog の pod 群（AdMob / RevenueCat / HealthKit+nitro）を取り込んでも通るか
   （#44695 は Closed だが 56.x / 57.x の CHANGELOG に対応記載が無い）
2. `ios_signing.bundle_identifier: com.gotcha.bodylog.rn` が3つ目の Bundle ID（`.liveactivity`）の
   プロファイルまで自動で面倒を見るか（実績があるのは `.widget` の1本だけ）
3. `Text timerInterval` が compact スロット（島の細い部分）に収まるか
4. 既存の `BodyLogWidget` 拡張と同時に有効化（`ENABLE_WIDGET` と両方 true）したときの共存
   → **まず Live Activity 単独で1本通してから**、両方を立てる

---

## 参照（すべて 2026-09-17 確認）

- Apple: [Displaying live data with Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)
- Expo: [Widgets（SDK 57）](https://docs.expo.dev/versions/v57.0.0/sdk/widgets/) — `createLiveActivity` / plugin オプション / `'widget'` の制約
- Expo: [SwiftUI Text（SDK 57）](https://docs.expo.dev/versions/v57.0.0/sdk/ui/swift-ui/text/) — `timerInterval` / `countsDown`
- Expo blog: [SDK 56 で stable 化](https://expo.dev/blog/ios-widgets-and-live-activities-in-expo)
- `software-mansion-labs/expo-live-activity` は **2026-06-01 にアーカイブ・非推奨**（本人たちが `expo-widgets` へ誘導）
