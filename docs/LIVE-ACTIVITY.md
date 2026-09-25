# Live Activity（ダイナミックアイランド／ロック画面のレスト残り時間）

> 熊田さん「iPhone の場合はアプリを閉じていても、ダイナミックアイランドで残り分数が分かるような
> 通知形態にしたい。UberEats とかそうだよね」（2026-09-17）
>
> 熊田さん「筋トレのレストタイマーの通知のイメージが違う。『ダイナミックアイランドでの通知機能の
> 実装の仕方』について綿密に調査したうえで実装して。今ある通知の機能はなくしてよし。」（2026-09-25）

**2026-09-25 から iOS ビルドの既定で入る。** レスト終了時のローカル通知（「レスト終了／次のセットへ。」のバナー）は
**廃止**した。画面の外の表示は Live Activity（島＋ロック画面）に一本化。アプリ内の帯（`RestTimerBar`）は従来どおり。

**戻すのは環境変数1つ**: Codemagic のビルド起動時に **`DISABLE_LIVE_ACTIVITY` = `true`** を足す
→ app.json を1文字も変えないビルド（Live Activity 導入前と同一）になる。

---

## 0. 熊田さんの手番（チェックリスト）

### 手順1 — Apple Developer portal で拡張の App ID を作る（1回だけ・手作業が要るのはここだけ）

<https://developer.apple.com/account/resources/identifiers/list>

1. **App Groups が存在するか**確認: 左のフィルタを App Groups にして **`group.com.gotcha.bodylog.rn`** があるか。
   無ければ **＋** → App Groups → Description 任意・Identifier `group.com.gotcha.bodylog.rn` → Register
2. **本体 `com.gotcha.bodylog.rn`** を開く → Capabilities の **App Groups** にチェック → Edit/Configure →
   `group.com.gotcha.bodylog.rn` を選ぶ → Save（ホームウィジェット導入時に済んでいればそのまま）
3. **＋** → App IDs → App → Description `BodyLog Live Activity` ／ Bundle ID **Explicit**
   **`com.gotcha.bodylog.rn.liveactivity`** → Capabilities の **App Groups** にチェック → Continue → Register
4. 作った `com.gotcha.bodylog.rn.liveactivity` を開く → App Groups の Edit/Configure → `group.com.gotcha.bodylog.rn` を選ぶ → Save

> 自動署名（Codemagic）は **App ID 自体は作れるが、どの App Group を紐付けるかは指定できない**
> （App Store Connect API に App Group 割り当ての口が無い。[Apple Developer Forums](https://forums.developer.apple.com/thread/127917)）。
> だから 2 と 4 の「紐付け」だけは手作業。プロファイルの削除・作り直しは CI が自動でやる（手動削除は不要）。

### 手順2 — Codemagic でビルド

<https://codemagic.io/apps>

1. BodyLog → **Start new build** → Workflow **rn-testflight**
2. 環境変数は**何も足さない**（既定で Live Activity が入る）
3. Start build → 成功したら TestFlight に上がる

落ちたら → **§4「失敗したときの読み方」**。とにかく出荷を優先するなら環境変数 **`DISABLE_LIVE_ACTIVITY`=`true`** で再ビルド。

### 手順3 — 実機で確認

1. TestFlight で入れる → 運動タブ → 筋トレを記録する → セットを追加（レストが始まる）
2. **ホームに戻る／画面をロック**する
3. **iPhone 14 Pro 以降**: 画面上部の島に ⏱ と残り時間（減っていく）→ 長押しで展開（種目名＋残り時間）→ タップで筋トレ記録画面へ戻る
4. **島の無い機種（iPhone 13 以前・SE・16e/17e）**: ロック画面と通知センターにバナーとして同じものが出る（iOS 16.1 以降）
5. 0 になると島は「レスト終了」表示に変わる（アプリが止まっていても OS が切り替える）。アプリに戻ると畳まれる
6. 出ないとき: 設定 › BodyLog › **ライブアクティビティ** がオンか／設定 › Face ID とパスコード › **ライブアクティビティ**（ロック画面）がオンか

### 手順4 — 戻す（ロールバック）

Codemagic の Start new build で環境変数 **`DISABLE_LIVE_ACTIVITY`** = **`true`** を足すだけ。
`native/app.config.js` が app.json を同一オブジェクトのまま返し、`codemagic.yaml` の関連ステップも止まる。
コードの変更は要らない（`yaml` の `vars` には**書かない**。書くと普段のビルドが常に退避になる）。

---

## 1. 仕組み

### 3段の関係（2026-09-25 以降）

| 段 | 見えるもの | 必要なもの | 状態 |
| --- | --- | --- | --- |
| 1 | どのタブにいても**残り時間の帯**（`components/RestTimerBar.tsx`） | なし（JS だけ） | 入っている |
| 2 | 0 の瞬間の**触覚＋バイブ**（前景のみ） | なし（JS だけ） | 入っている |
| 3 | **アプリを閉じていても**島／ロック画面に残り時間 | Widget Extension（この文書） | **既定で入る**（Apple 側の App ID が要る） |
| － | ~~終了時のローカル通知~~ | － | **廃止**（2026-09-25） |

### なぜ更新を送らなくていいか

カウントダウンは **OS が描く**。

```tsx
<Text timerInterval={{ lower: 開始, upper: restEndsAt }} countsDown />
```

アプリが動いていなくても毎秒 OS 側が描き替えるので、**1秒ごとの update も、プッシュも、サーバも一切要らない。**
開始時に1回出して、終わったら消すだけ。レストは最長10分なので 8時間制限・4KB制限にも触れない。

さらに `start()` に **`staleDate`＝終了時刻**を渡してある。時刻を過ぎると OS が `environment.isStale=true` で描き直すので、
バックグラウンドで JS が止まっていても島が「レスト終了」に変わる（0:00 のタイマーが居座らない）。

### ファイル

| ファイル | 役割 |
| --- | --- |
| `native/src/liveactivity/RestActivity.tsx` | 見た目。`'widget'` ディレクティブ付き＝**別バンドル**にコンパイルされ拡張の隔離ランタイムで走る。`isStale` で終了表示 |
| `native/src/lib/restActivity.ts` | アプリ側の口。**無い環境では静かに no-op**（Android / Expo Go / 設定でオフ / 退避ビルド）。`staleDate` と訳文（`label`/`doneLabel`）を渡す |
| `native/src/lib/restTimer.ts` | レストの持ち主。開始で `startRestActivity`、停止・0検知で `endRestActivity`、起動時に `cleanupRestActivities` |
| `native/app.config.js` | **既定で** `expo-widgets` plugin と `NSSupportsLiveActivities` を足す。`DISABLE_LIVE_ACTIVITY=true` で app.json をそのまま返す |
| `codemagic.yaml` rn-testflight | 「下ごしらえを確認」ステップ（拡張ターゲット・App Group・plist の存在確認）と「署名プロファイルの整合」（App Groups を含むプロファイルへ自動で作り直す） |

### `'widget'` 関数の中でできないこと（Expo 公式の制約）

hooks / state / context / async / import / モジュールスコープの参照は**すべて禁止**。
`t()` も呼べないので、**文言はアプリ側で訳して props で渡す**（`label`・`doneLabel`）。
`__tests__/liveActivity.test.ts` がこの約束を機械で見張っている。

### アプリが殺されたとき

Live Activity は**アプリのプロセスと独立に生きる**（強制終了しても残る。[Apple Developer Forums](https://developer.apple.com/forums/thread/729651)）。
0 になっても JS が止まっていれば `end()` は呼べない。だから
- 前景で 0 を見た瞬間（`restTimer.ts` の `fireIfDone`）に畳む
- 次の起動時に `cleanupRestActivities()` が `getInstances()` で残骸を全部畳む
- その間は `isStale` の「レスト終了」表示が出ている（島にも、ロック画面にも）

### Android

Live Activity 相当は無い（`expo-widgets` plugin は `enableAndroid` 既定 false＝Android ビルドは無変更）。
`restActivity.ts` は `Platform.OS !== 'ios'` で即 return。Android の画面外表示（進行中通知のクロノメーター）は `docs/TODO.md` B10 に残してある。

---

## 2. 調査結果（2026-09-25・すべて URL で確認）

### expo-widgets（SDK 57・57.0.19）の Live Activity API

- [Widgets（SDK 57）](https://docs.expo.dev/versions/v57.0.0/sdk/widgets/)
  - `createLiveActivity(name, component)` → `LiveActivityFactory`。`start(props, url?, staleDate?)` / `update(props, staleDate?)` /
    `end(dismissalPolicy?, props?, contentDate?)` / `getInstances()`。**Live Activity は `widgets[]` に書かない**（「Do not add a widgets[] entry for it」）
  - `'widget'` の制約: React Native のコンポーネント不可、hooks/state/context 不可、async・import・モジュールスコープ参照不可。
    「The bundler serializes only the function body」＝データはすべて props と environment 経由
  - レイアウトの領域: `banner` / `bannerSmall`（CarPlay・watchOS）/ `compactLeading` / `compactTrailing` / `minimal` /
    `expandedLeading` / `expandedTrailing` / `expandedCenter` / `expandedBottom`
  - `url` を `start()` に渡すと「When the user taps the activity, the system opens your app with that URL」→ expo-router が `bodylog://lift-session` を開く
  - plugin オプション: `bundleIdentifier`（既定 `<app>.ExpoWidgetsTarget`）／`groupIdentifier`（既定 `group.<app>`・**「which widgets require to work」**）／
    `enablePushNotifications`（既定 false）／`frequentUpdates`／`enableAndroid`（既定 false）／`widgets[]`
  - Expo Go 不可（development build ／ CI ビルド）
- [SwiftUI Text（SDK 57）](https://docs.expo.dev/versions/v57.0.0/sdk/ui/swift-ui/text/): `timerInterval: {lower, upper}`・`countsDown`（既定 true）・`pauseTime`。iOS 16+。
  「especially useful in widgets and Live Activities」
- `node_modules/expo-widgets` の実装（57.0.19）を直接読んで確認したこと:
  - **App Group は Live Activity でも必須**。`LiveActivityFactory` は `'widget'` 関数の出力（レイアウト）を
    `UserDefaults(suiteName: ExpoWidgetsAppGroupIdentifier)` に保存し、拡張側 `getLiveActivityNodes` がそこから読む（`ios/WidgetsStorage.swift`・`ios/Widgets/Utils.swift`）。
    App Group が無いと拡張は「No layout found」の赤箱になる
  - plugin は prebuild で **本体の Info.plist に `NSSupportsLiveActivities: true` と `ExpoWidgetsAppGroupIdentifier`**、
    **本体 entitlements に App Group**、**`aps-environment: development`（`enablePushNotifications` に関係なく無条件）** を書く。
    aps-environment は codemagic.yaml の「未使用のentitlementを除去」が従来どおり外す（Push capability は不要）
  - 拡張ターゲット `ExpoWidgetsTarget`: `APPLICATION_EXTENSION_API_ONLY=YES`・`CODE_SIGN_ENTITLEMENTS=ExpoWidgetsTarget/ExpoWidgetsTarget.entitlements`（App Group のみ）・
    `PRODUCT_BUNDLE_IDENTIFIER=com.gotcha.bodylog.rn.liveactivity`。deployment target 16.4（podspec も 16.4）
  - `start()` は iOS 16.2 未満・設定で Live Activity オフ（`areActivitiesEnabled=false`）のとき例外 → `restActivity.ts` が飲む
  - `staleDate`／`isStale` は 57.0.12 で追加（CHANGELOG）。`getInstances()` は 57.0.12 で「他の factory・終了済み」を除外するよう修正
- [expo blog（2026-03-04）](https://expo.dev/blog/home-screen-widgets-and-live-activities-in-expo): 公開時点は alpha。SDK 57 で `~57.0.19` が stable 系列
- `software-mansion-labs/expo-live-activity` は 2026-06-01 にアーカイブ・非推奨（本人たちが `expo-widgets` へ誘導）

### Apple 側の要件・制限

- [Displaying live data with Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)
  - Info.plist に **`NSSupportsLiveActivities` = YES**（plugin と app.config.js の両方が書く）
  - 「Static and dynamic data … can't exceed a combined size of **4 KB**」
  - 「A Live Activity can be active for up to **eight hours** … the Live Activity remains on the Lock Screen … for up to **four additional hours**」（最大12時間）
  - 終了時の dismissal policy: `default`（ロック画面に最大4時間残る）／ **`immediate`（即消す・BodyLog はこれ）**／ `after(date)`
  - 「people can choose to deactivate Live Activities for an app in the Settings app」→ 出ないときはまず設定を疑う
- 対応機種: ダイナミックアイランドは **iPhone 14 Pro / Pro Max、iPhone 15 以降の全機種（16e・17e を除く）**
  （[Apple Support](https://support.apple.com/guide/iphone/view-live-activities-in-the-dynamic-island-iph28f50d10d/ios)・[MacRumors](https://www.macrumors.com/guide/dynamic-island/)）。
  ロック画面・通知センターのバナーは iOS 16.1 以降の全 iPhone。BodyLog の最低 iOS は 16.4（ExpoModulesCore 57）なので**全ユーザーが対象**
- 強制終了しても Live Activity は残る（「Live Activity life cycles aren't tied to the host app's process」
  [Apple Developer Forums 729651](https://developer.apple.com/forums/thread/729651)）→ 次の起動で `Activity.activities`（`getInstances()`）から回収

### 既知の問題の現状

| 問題 | 現状（2026-09-25） | BodyLog への影響 |
| --- | --- | --- |
| [expo/expo#44695](https://github.com/expo/expo/issues/44695) 拡張ターゲットが全 pod を link し、拡張非対応 SDK（`'sharedApplication' is unavailable`）で落ちる | 2026-04-14 に **Closed（completed）**。修正 PR の紐付けは無く、コメントは「再現リポに expo-widgets が入っていない」のみ。ただし **57.0.19 の `scripts/autolinking.rb` は `use_expo_modules_widgets!` で expo / expo-widgets / @expo/ui 以外を `exclude` し、`use_expo_native_module!` で RN コミュニティ autolink も `expo` だけに絞る**。拡張に入るのは React 本体＋ExpoModulesCore＋ExpoUI＋ExpoWidgets だけ | **AdMob / RevenueCat / HealthKit(nitro) は拡張に入らない**。BodyLog の plugin（google-mobile-ads / purchases / healthkit / nitro / notifications）はどれも Podfile を書き換えない（root レベルの `pod` 行が無い）ので、報告者のような「継承で全 pod が入る」経路も無い。**残るリスクは React 本体＋Expo コアの拡張ビルドのみ＝expo-widgets 利用者全員と同じ条件** |
| [expo/expo#44707](https://github.com/expo/expo/issues/44707) `Invalid Podfile: private method 'resolve'`（`use_expo_modules_widgets!`） | Closed。真因は **Expo 54 に expo-widgets 55 を入れた版ずれ＋@expo/ui の二重インストール**（zoontek） | `package.json` の `overrides["@expo/ui"] ~57.0.18` で1本に固定（テストが見張る）。手元の node_modules に nested @expo/ui は無いことを確認済み |
| `'widget'` 関数のコンパイル | babel-preset-expo（SDK 57）に `widgets-plugin` が同梱＝**追加設定なし**（`native/babel.config.js` は存在しない＝既定） | 何もしなくてよい |

### Codemagic の自動署名と拡張

- [Signing iOS apps（yaml）](https://docs.codemagic.io/yaml-code-signing/signing-ios/): `ios_signing.bundle_identifier: com.example.app` で
  **`com.example.app.*` の拡張のプロファイルもマッチ**する（「the matching profiles are the ones with com.example.app and com.example.app.* as bundle identifier」）。
  実績: ホームウィジェット `…rn.widget` はこの流儀で署名できた（`docs/WIDGET.md`）
- [`app-store-connect fetch-signing-files`](https://github.com/codemagic-ci-cd/cli-tools/blob/master/docs/app-store-connect/fetch-signing-files.md):
  `--create`「create the resource if it does not exist yet」。`--strict-match-identifier` を付けなければ **`com.example.app.extension` も対象**。
  capability の指定は無い
- [`app-store-connect bundle-ids enable-capabilities`](https://github.com/codemagic-ci-cd/cli-tools/blob/master/docs/app-store-connect/bundle-ids/enable-capabilities.md)（v0.50.0〜）:
  `--capability "App Groups"` で capability の ON はできるが、**どの group を紐付けるかは渡せない**（API 側に口が無い）→ 手順1 の紐付けは手作業のまま
- [`xcode-project use-profiles`](https://github.com/codemagic-ci-cd/cli-tools/blob/master/docs/xcode-project/use-profiles.md): 手元のプロファイルを
  プロジェクトの各ターゲットに bundle id で当てる。`--warn-only` で当たらないターゲットは警告止まり
- **既存プロファイルの再利用の罠**（メモリ「自動署名でも既存プロファイル再利用の罠」）: App ID に capability を足しても、
  Codemagic は前回のプロファイルを再利用して署名に失敗し続ける。`codemagic.yaml` の「署名プロファイルの整合」ステップが
  **本体（application-groups／associated-domains）と拡張 `…rn.liveactivity`（application-groups）** の両方を見て、
  足りなければポータルのプロファイルを削除→`fetch-signing-files --create`→`use-profiles` で作り直す（2026-09-25 に拡張ぶんを追加）。
  プロファイルが**1本も無い**（App ID 未作成）ときは削除しても直らないので、手順1 への案内を出して止まる

---

## 3. 決めたこと（設計判断）

1. **終了通知は出さない。** 2026-09-17 の判断（「島は音を鳴らさないので両方出す」）は熊田さんの 2026-09-25 の指示で覆した。
   欲しいのは「減っていく残り時間」であり、終わってから届くバナーではない。前景の触覚＋バイブは残す。
   `restTimer.ts` から `expo-notifications` の import・予約・取り消し・許可確認をすべて外した（テストで復活を禁止）。
2. **同じ終了時刻では出し直さない。** 筋トレ記録画面の effect は種目名の変化でも走るので、`armRest` は終了時刻が同じなら島に触らない（ちらつき防止）。
3. **`staleDate`＝終了時刻。** バックグラウンドで畳めないぶんは OS の「終了」表示でつなぎ、前景復帰・次回起動で畳む。
4. **既定 ON・退避は環境変数1つ。** `ENABLE_LIVE_ACTIVITY`（2026-09-17〜24）は廃止。付け忘れで島が消える事故を作らない。
   app.config.js と codemagic.yaml が同じ `DISABLE_LIVE_ACTIVITY` を見る（テストで食い違いを禁止）。
5. **App Group の entitlement を CI で「ちょうど1件」に正規化する。** plugin と `ENABLE_WIDGET` のステップの両方が同じ group を Add しうるため。

---

## 4. 失敗したときの読み方

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| 「下ごしらえを確認」で ❌（ExpoWidgetsTarget が無い等） | app.config.js の plugin が効いていない（`DISABLE_LIVE_ACTIVITY` の誤設定・expo-widgets の版） | `native/app.config.js` を node で評価して plugins を確認（§5）。急ぐなら `DISABLE_LIVE_ACTIVITY=true` |
| 「署名プロファイルの整合」で ❌ プロファイルが1本も無い（`…rn.liveactivity`） | 手順1-3 の App ID 未作成 | 手順1 をやってから再ビルド |
| 同ステップで「古い」→作り直し→それでも ❌ | APIキーの権限でプロファイル削除ができない／capability の紐付け漏れ | ログの案内どおり <https://developer.apple.com/account/resources/profiles/list> で該当 Bundle ID の App Store 用を Delete → 手順1-2/1-4 の紐付けを確認 → 再ビルド |
| `Provisioning profile doesn't include com.apple.security.application-groups` | 上のステップをすり抜けた古いプロファイル | 同上 |
| `'sharedApplication' is unavailable: not available on iOS` 等で pod のコンパイルが落ちる | **#44695 の形**。57.0.19 では起きないはずだが、React 本体側の変更で再発しうる | ① `DISABLE_LIVE_ACTIVITY=true` で出荷を確保 ② ログの「error:」行で落ちた pod 名を特定 ③ その pod が拡張に入っている理由を `native/ios/Podfile` の `target "ExpoWidgetsTarget"` ブロックと `node_modules/expo-widgets/scripts/autolinking.rb` で追う ④ 恒久策は B案（下） |
| `Invalid Podfile: private method 'resolve' called ... use_expo_modules_widgets!` | `@expo/ui` の二重インストール（#44707） | `package.json` の `overrides["@expo/ui"]` が効いているか（`npm ls @expo/ui` が1本か） |
| ビルドは通るが島に出ない | 端末が対応外／設定でオフ／`NSSupportsLiveActivities` 欠落／App Group 不一致（赤箱「No layout found」） | 手順3-6。赤箱なら本体と拡張の entitlements の group が一致しているかログの `plutil -p` で確認 |
| 島に出るが 0 のあと居座る | 前景に戻っていない／アプリが殺されている | 仕様（§1「アプリが殺されたとき」）。次回起動で消える。表示は「レスト終了」に変わっている |

### B案（pod で落ち続けたとき）

既存の `BodyLogWidget` 拡張（`native/widget/BodyLogWidget.swift`・`scripts/add-widget-target-rn.rb` の ruby 注入）は
**pod を1つも引き込まない純 SwiftUI** なので、#44695 が構造的に起きない。そちらに `ActivityConfiguration` を相乗りさせ、
アプリ側は小さな Expo モジュール（`modules/widget-bridge` と同じ流儀）から `Activity.request` を呼ぶ。
Swift を書くことになり、Mac が無いので CI ビルドが唯一の検証手段になる（`docs/WIDGET.md` と同じ制約）。

---

## 5. 手元でできる確認

```bash
cd native
# 既定（Live Activity ON）: plugins の末尾に expo-widgets、NSSupportsLiveActivities=true
EXPO_PUBLIC_SUPABASE_URL=x EXPO_PUBLIC_SUPABASE_ANON_KEY=x node -e "const c=require('./app.config.js')({config:require('./app.json').expo});console.log(JSON.stringify(c.plugins.at(-1)),c.ios.infoPlist.NSSupportsLiveActivities)"
# 退避: app.json そのまま
DISABLE_LIVE_ACTIVITY=true EXPO_PUBLIC_SUPABASE_URL=x EXPO_PUBLIC_SUPABASE_ANON_KEY=x node -e "const a=require('./app.json').expo;const c=require('./app.config.js')({config:a});console.log(c===a)"
npx tsc --noEmit && npx jest --silent src/__tests__/liveActivity.test.ts src/__tests__/restTimer.test.ts
```

---

## 6. 実ビルドでしか分からないこと（ビルド1本で潰す）

1. ★React 本体＋Expo コアの pod が `APPLICATION_EXTENSION_API_ONLY=YES` の拡張ターゲットで通るか
   （expo-widgets の `expo_widgets_post_install` が ExpoModulesCore / ExpoUI / React-* の当該フラグを No にして通す設計。BodyLog 固有の pod は入らない）
2. `ios_signing.bundle_identifier: com.gotcha.bodylog.rn` が `…rn.liveactivity` のプロファイルまで自動で面倒を見るか
   （`.widget` の実績あり。見なければ「署名プロファイルの整合」が `fetch-signing-files --create` で作る）
3. `Text timerInterval` が compact スロット（島の細い部分）に収まるか。`isStale` の切り替えが実機で見えるか
4. `ENABLE_WIDGET=true` と同時に有効化したときの共存（拡張ターゲットが2つ・同じ App Group）
   → **まず Live Activity 単独で1本通してから**、両方を立てる

---

## 参照（2026-09-25 確認）

- Apple: [Displaying live data with Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) ／ [ActivityKit](https://developer.apple.com/documentation/activitykit) ／ [Live Activity Persistence After App Force Quit（Forums）](https://developer.apple.com/forums/thread/729651) ／ [How to create and assign app groups（Forums）](https://forums.developer.apple.com/thread/127917)
- Apple Support: [View Live Activities in the Dynamic Island on iPhone](https://support.apple.com/guide/iphone/view-live-activities-in-the-dynamic-island-iph28f50d10d/ios)
- Expo: [Widgets（SDK 57）](https://docs.expo.dev/versions/v57.0.0/sdk/widgets/) ／ [SwiftUI Text（SDK 57）](https://docs.expo.dev/versions/v57.0.0/sdk/ui/swift-ui/text/) ／ [blog: Home screen widgets and Live Activities in Expo](https://expo.dev/blog/home-screen-widgets-and-live-activities-in-expo)
- expo/expo: [#44695](https://github.com/expo/expo/issues/44695) ／ [#44707](https://github.com/expo/expo/issues/44707) ／ [expo-widgets/scripts/autolinking.rb（main）](https://github.com/expo/expo/blob/main/packages/expo-widgets/scripts/autolinking.rb)
- Codemagic: [Signing iOS apps](https://docs.codemagic.io/yaml-code-signing/signing-ios/) ／ [fetch-signing-files](https://github.com/codemagic-ci-cd/cli-tools/blob/master/docs/app-store-connect/fetch-signing-files.md) ／ [bundle-ids enable-capabilities](https://github.com/codemagic-ci-cd/cli-tools/blob/master/docs/app-store-connect/bundle-ids/enable-capabilities.md) ／ [use-profiles](https://github.com/codemagic-ci-cd/cli-tools/blob/master/docs/xcode-project/use-profiles.md) ／ [Discussion #2296（capabilities）](https://github.com/orgs/codemagic-ci-cd/discussions/2296)
- MacRumors: [Everything You Need to Know About Dynamic Island](https://www.macrumors.com/guide/dynamic-island/)
