# Android版リリース手順（熊田さん向け）

BodyLoger（native/）のAndroid版を Google Play に出すための手順とチェックリスト。
ビルドは Codemagic の workflow **rn-android**（codemagic.yaml）が担当し、Macも Android Studio も不要。

## 必要なもの（初回だけ）

### 1. Google Play Console の開発者登録
- https://play.google.com/console から個人アカウントで登録（**$25の買い切り**。年会費なし）
- 登録後「アプリを作成」→ アプリ名 BodyLog、パッケージ名は **com.gotcha.bodylog.rn**（iOSのBundle IDと同一表記）

### 2. 署名用キーストアの作成とCodemagicへのアップロード
アプリの署名鍵。**紛失すると同じアプリとして更新できなくなる**ので、生成したファイルとパスワードは必ず安全な場所に保管する。

キーストアが手元に無ければ、`keytool`（JDK付属。CodemagicのビルドマシンやMac/PCのJava環境で実行可）で生成する:

```
keytool -genkeypair -v \
  -keystore bodylog-upload.keystore \
  -alias bodylog \
  -keyalg RSA -keysize 2048 -validity 10000
```

アップロード手順（Codemagic UI・1回だけ）:
1. Codemagic → **Teams → 対象チーム → Code signing identities → Android keystores**
2. 生成した `bodylog-upload.keystore` をアップロード
3. **Reference name を `bodylog_keystore` にする**（codemagic.yaml の `android_signing` がこの名前を参照）
4. keystore password / key alias / key password を入力して保存

未アップロードの間にビルドしたい場合は、codemagic.yaml の `android_signing:` と `- bodylog_keystore` の2行をコメントアウトすれば無署名でビルドだけは通る（Playには提出不可）。

### 3. 初回の .aab アップロード（内部テストトラック）
1. Codemagic で **Start new build → workflow「rn-android」** を選んで実行
2. 成果物の `app-release.aab` をダウンロード
3. Google Play Console → 対象アプリ → **テスト → 内部テスト → 新しいリリースを作成** → .aab をアップロード
4. テスターに自分のGoogleアカウントを追加し、配布リンクからインストールして動作確認
5. 問題なければ製品版（審査あり）へ昇格

サービスアカウントを作成したら、codemagic.yaml に `publishing > google_play` を足してアップロードまで自動化できる（それまでは手動アップロード運用）。

## RevenueCat（課金）— 後回しでOK
- 未設定の間は **課金UIが一切出ないだけ**で、アプリは全機能「未課金プラン」として正常動作する
- 対応する場合:
  1. RevenueCat のプロジェクトに **Google Play アプリを追加**（サービスアカウントJSONの連携が必要）
  2. 発行された **Google Play 用の公開APIキー** を、Codemagic の環境変数グループ「rc」に
     `EXPO_PUBLIC_RC_ANDROID_KEY` として追加（iOSの `EXPO_PUBLIC_RC_IOS_KEY` と同居）
  3. Google Play Console 側で定期購入商品（lite/standard/premium）を作成し、RevenueCatのofferingに紐付け

## Google SSO — 追加設定は不要
login.tsx のGoogleログインは **Supabase の OAuth（Web経由・PKCE）** 実装。アプリ内ブラウザで
Supabase→Googleの認可ページを開き、`bodylog://auth-callback` に戻ってきたコードをセッションに
交換する方式のため、AndroidネイティブのGoogle Sign-In SDK や google-services.json は使っていない。
ディープリンク（scheme: bodylog）は expo prebuild が AndroidManifest に自動登録するので、
**Android版のための追加設定は無い**（Supabase側の既存のGoogleプロバイダ設定がそのまま効く）。

## Android版で「出ないもの」（仕様）
- **ヘルスケア連携（HealthKit）**: iOS専用。Android版では歩数・Apple Watchのワークアウト取込・
  体重の自動取込は表示されない（コード側はdynamic requireで静かに無効化済み）。
  将来は Health Connect（Google のヘルスデータ基盤）対応を検討
- **Appleでサインイン**: iOSのみ表示（メール+パスワード / Google SSO は利用可）
- **課金UI**: `EXPO_PUBLIC_RC_ANDROID_KEY` を設定するまで非表示（上記）

## バージョン管理
- **version文字列（例 1.0.18）はiOSと共通**。docs/RELEASE.md の基準（PATCH/MINOR/MAJOR）に従い、
  native/app.json の `expo.version` を1本で運用する
- **android.versionCode はCodemagicが自動採番**: リポジトリ上は基準値 `1` のまま置き、
  rn-android workflow がビルドごとに `$PROJECT_BUILD_NUMBER` を注入する
  （iOSの agvtool + $BUILD_NUMBER に相当。手で上げる必要はない）
- 審査提出時のタグ（`vX.Y.Z`）・`release/X.Y.Z` ブランチは **iOSと同一運用**
  （同じコミットからiOS/Android両方を提出する）

## Androidユーザーへの届け方（配信戦略・2026-08-28分析）

### 最初の関門: 個人アカウントの「12人×14日」テスト義務
2023-11-13以降に作成された**個人**のGoogle Play開発者アカウントは、製品版（一般公開）の前に
**クローズドテストに12人以上が「オプトイン＋インストール」した状態を14日間連続で維持**する
義務がある（2024-12に20人→12人へ緩和）。さらに2026年からは「テスターが実際に使ったか」も
審査対象。通過後に「製品版アクセス申請」（3セクションの質問・審査は通常7日以内）。
- 現実的なテスター集め: 友人・家族・同僚にGoogleアカウントのメールを聞いてテスターリストに
  登録→Playのオプトインリンクを配る。**「インストールして週2〜3回ひらいて記録する」まで頼む**
  （形式的テスターは2026年の使用チェックで弾かれる）。テスター相互コミュニティは規約リスクあり非推奨
- 回避ルート: **組織アカウント**（法人・D-U-N-S番号が必要）はこの義務が免除。
  法人名義にできる事情があるなら最短で製品版に出せる（ブランドと収益の帰属は要検討）
- つまりAndroidは「ビルド→即公開」ではなく**約3週間のリードタイム**を見込む。
  逆に言うと12人のテスト運用はβフィードバック装置としてそのまま使える

### 市場の見立て（どこのAndroidユーザーに届くか）
- 日本はiPhone優勢（スマホの約半分〜6割）だが、**Android勢は「iPhoneを選ばない実利派」**が多く
  価格感応度が高い＝無料+広告→ライトの導線設計と相性がよい
- 本命は**多言語対応が既に済んでいる市場**: インドネシア・タイ・ベトナム・ブラジル等は
  Androidシェア8〜9割。id/th/vi/pt辞書が既にあるBodyLogerにとって、Android版は
  「翻訳済み市場の解放」そのもの。ASO（ストア文言）もこの4言語を優先
- 韓国もAndroid（Galaxy）優勢＋ko辞書済みで有望

### Google Play側の武器（App Storeとの違い）
- **ストア掲載情報のA/Bテスト（Store Listing Experiments）が標準搭載・無料**。
  アイコン・スクショ・説明文をトラフィック分割で検証できる（ASCより強い）。
  ペイウォール検証で回している仮説をストア面でも回す
- **事前登録（Pre-registration）**: 製品版前に「事前登録」ページを公開でき、
  公開日に自動インストール＋通知が飛ぶ。12人テスト期間中に事前登録を並走させると
  初日のインストールがまとまる
- 段階的公開（Staged rollout）: 5%→20%→100%でクラッシュを見ながら展開できる
- Google Play Billing: RevenueCatのAndroidキーを設定すれば既存のプラン設計が
  そのまま載る（オファー/価格はPlay Console側で地域価格を設定）

### 推奨ロードマップ
1. **今週**: Play Console登録（$25）→ rn-androidビルド → 内部テスト（自分のみ・即配布可）で実機確認
2. **並行**: テスター12人を確保しクローズドテスト開始（14日カウント開始が早いほど得）
3. **14日間**: クラッシュ・Android固有のUI崩れを潰す（このリストが実質バグ修正スプリント）
4. **申請**: 製品版アクセス申請 → 通過後、事前登録 or 即公開
5. **公開後**: id/th/vi/pt/koのストア文言を整備 → Store Listing Experimentsでアイコン/スクショ検証
6. **その後**: RC Androidキー設定で課金解放、Health Connect対応をバックログへ

## 署名の罠（2026-09-03に踏んだ）

`expo prebuild --platform android` が生成する `android/app/build.gradle` は、**buildTypes.release でも
`signingConfig signingConfigs.debug`** を指している。つまり何もしなければ**リリースビルドがデバッグ鍵で署名される**。
この .aab を Play にあげると「アップロードされた Android App Bundle がデバッグモードで署名されています」で
拒否され、続けて「App Bundle をアップロードしてください」「既存ユーザーへのアップグレードを許可していません」等の
派生エラーが出る（原因は1つ）。

`android/` はリポジトリに入れず毎回 prebuild するので、**ビルド時に注入**する方式にした:

- `scripts/inject-android-signing.js` — signingConfigs に release を足し、buildTypes.release を向け直す（冪等）。
  値は `System.getenv` で Gradle 実行時に読むので、**生成物やログにパスワードが残らない**
- codemagic.yaml の rn-android に2ステップを追加: prebuild 直後の**注入**と、Build aab 直後の**署名の検証**
  （署名者に `Android Debug` が含まれていたらビルドを落とす＝デバッグ署名の .aab を二度と外に出さない）
- 鍵は Codemagic の `android_signing: [bodylog_keystore]` が渡す環境変数
  `CM_KEYSTORE_PATH` / `CM_KEYSTORE_PASSWORD` / `CM_KEY_ALIAS` / `CM_KEY_PASSWORD`

## 起動クラッシュの調査手順（2026-09-03・versionCode 119 で発生）

Android版の初回インストール（1.1.0 / versionCode 119）で「BodyLogが繰り返し停止しています」が
出た。iOSは正常。**内部テストトラックではPlayのリリース前レポートが生成されず**、
Android vitals も反映待ちで、スタックトレースが一切手に入らないところから始まった。

### なぜ「原因を当てにいかない」のか

トレースが無い状態で1箇所ずつ直しても、当たったかどうかが分からない（ビルド〜配布〜
インストールで1周が長い）。そこで方針を変えた:

> **原因を当てるのではなく、落ちない構造にして、原因を端末に記録させる。**

起動時の初期化（言語・単位・テーマ・アイコン・よく使う順・目的・読み物キャッシュ・
通知・ヘルスケア）はどれも「失敗しても画面は出せる」性質のもので、1つの失敗で
レンダリングまで止める理由が無い。`lib/boot.ts` の `safeBoot()` で1つずつ独立に
受け止め、失敗は端末に残す（実装は `src/app/_layout.tsx`）。

### 1. まず端末で「起動時のエラー記録」を見る

アプリが起動できるなら、これが最速で確実:

**マイページ（設定）を一番下までスクロール → 「起動時のエラー記録」**

- 実体は AsyncStorage の `bl-boot-errors`（最大20件・新しい順・同じ内容は回数で畳む）
- 1件ごとに **どの初期化か（name）／メッセージ／時刻／回数** が出る
  - name は `_layout.tsx` の `safeBoot('...')` に渡した名前
    （`loadLocale` `loadTheme` `reregisterAll` `startHealthAutoSync` `auth.subscribe` `supabase.env` など）
- 「内容をコピーする」でクリップボードに入るので、そのまま報告に貼れる
- 記録があれば、次の起動から5秒後に Supabase の `crash_reports` へも送られる
  （`boot-errors` という name で1件。送信済みでも端末の表示は消えない）

### 2. 実機が手元にあるなら logcat が一番早い

`safeBoot` は必ず `console.warn('[boot:<name>]', message)` も出すので、
USBデバッグを有効にした端末をつないで:

```sh
adb logcat -c                                   # 一度クリアしてからアプリを起動する
adb logcat "*:S" ReactNative:V ReactNativeJS:V AndroidRuntime:E   # JS例外とネイティブ例外
adb logcat | grep -i "boot:"                    # safeBootが記録した初期化の失敗だけ
adb logcat --buffer=crash                        # 直近のネイティブクラッシュ（tombstone）
```

JSの例外なら `ReactNativeJS`、Java/Kotlin側なら `AndroidRuntime: FATAL EXCEPTION` に出る。
**JS例外が一切出ずに `AndroidRuntime` だけが出るなら、JSに到達する前のネイティブ初期化**
（AdMobのApp ID・ネイティブモジュールのリンク・リソース）を疑う。

### 3. Play Console でトレースを出す（内部テストでは出ない）

- **リリース前レポート（Pre-launch report）は「クローズドテスト」以上でしか生成されない。**
  内部テストのままでは何回上げても出ない
  → Play Console → **テスト → クローズドテスト → 新しいトラックを作成** → 同じ .aab を
    アップロード → 数十分〜数時間で「リリース前レポート → 安定性」にクラッシュの
    スタックトレースと端末ごとの結果が出る（Googleの実機ファームで自動起動される）
- **Android vitals**（品質 → Android vitals → クラッシュとANR）は
  実ユーザーの端末からの収集なので、インストール数が少ないと反映まで数時間〜1日かかる。
  期間フィルタを「過去24時間」、バージョンを versionCode で絞る
- 自分の端末で再現できたなら **Play Console のクラッシュ収集を待たずに 1〜2 の方法**が速い

### 4. コードを触るときの決まり（再発防止）

- **モジュール評価時（トップレベル）の副作用は必ず try/catch で包むか `useEffect` へ移す。**
  ここが throw すると ErrorBoundary もクラッシュ計測も間に合わず、JSバンドルの
  読み込み中に死ぬ＝「起動直後に落ちる」になる。現在包んであるのは4箇所:
  `_layout.tsx` の `installCrashReporter()` / `login.tsx` の
  `WebBrowser.maybeCompleteAuthSession()` / `LaunchIntro.tsx` の
  `SplashScreen.preventAutoHideAsync()` / `achievements.ts` の `onRemoteContentChange()`
  - 全数確認: `grep -rnE "^[a-zA-Z_$][a-zA-Z0-9_$.]*\(" native/src --include=*.ts --include=*.tsx | grep -v __tests__`
- **`.catch()` だけでは足りない。** `await` より前の throw（ネイティブモジュール未リンク等）は
  同期例外として飛ぶので `try` でも包む
- **起動時の初期化を足したら `safeBoot('名前', fn)` で包む。** 名前がそのまま
  「起動時のエラー記録」に出るので、関数名と揃えておく
- **iOS専用モジュールは動的 require ＋ `Platform.OS` の二重ガード。**
  現在このやり方で守っているのは `@kingstinct/react-native-healthkit`（lib/health.ts）と
  `react-native-google-mobile-ads`（components/AdBannerView.tsx）
- **`Intl` に依存しない。** JSTの日付・時刻は `lib/jst.ts`（UTC+9固定の純関数）を使う。
  ロケール依存の整形が本当に必要な箇所（paywall の通貨表示）だけ try/catch 付きで残してある
  - 事実確認: RN 0.86 の hermes-android は `-DHERMES_ENABLE_INTL=True` でビルドされている
    （`node_modules/react-native/ReactAndroid/hermes-engine/build.gradle.kts`）。
    **つまり `Intl` は Android にも存在する**ので、「Intlが無くて落ちた」というのは
    今回の真因ではない可能性が高い（正直に書いておく）
  - それでも外した理由: Hermesの実装は android.icu への薄いブリッジで Apple の ICU とは別物、
    オプションの組み合わせで RangeError になる報告があり（`hourCycle` 等）、
    有効かどうかがエンジンのビルドフラグ次第＝アプリ側から保証できない。
    保証できない依存を保証できる純関数に置き換えられるなら、そのほうが安い

### 5. 起動時にどれだけのモジュールが読まれるか（＝疑う範囲）

expo-router はリリースビルド（sync import mode）で **ルート直下の全画面の
モジュールを起動時に評価する**。つまり未ログインでログイン画面しか見えていなくても、
`(tabs)/_layout.tsx`・`settings.tsx`・`paywall.tsx`・`laws.tsx` などが読まれ、
それらが import する lucide-react-native / react-native-svg / react-native-view-shot /
expo-print / expo-camera / react-native-purchases / AdMob まで全部モジュール評価される。
**「ログイン画面しか出ていないのだから関係ない」という切り分けは成立しない。**

### 6. ネイティブモジュールのAndroid対応（2026-09-03 全数点検の結果）

`native/package.json` の依存を1つずつ「Androidの実装があるか」「守れているか」で見た結果。
判定方法は各パッケージの `expo-module.config.json` の `platforms` と `android/` ディレクトリの有無。

**Androidにネイティブ実装が無いもの（3つ）**

| モジュール | 状態 | 対処 |
|---|---|---|
| `@kingstinct/react-native-healthkit` | `android/` 無し（iOS専用） | ✅ `lib/health.ts` が動的 require ＋ `Platform.OS !== 'ios'` の二重ガード。JS側もパッケージが自前で「Androidならモックを返す」実装（`lib/commonjs/healthkit.js`）。config plugin は `withEntitlementsPlist` / `withInfoPlist` だけなので **androidのprebuildには一切影響しない**（app.json の plugins に置いたままで安全） |
| `expo-glass-effect` | `platforms: ["apple"]` | ✅ `src/` のどこからも import していない（未使用の依存）。Androidでは autolink もされない |
| `expo-symbols` | `platforms: ["apple"]` | ⚠️ `src/` から直接は使っていないが、**expo-router の Android版ネイティブタブが内部で import する**（`native-tabs/utils/materialIconConverter.android.js` → `unstable_getMaterialSymbolSourceAsync`）。Androidで評価されるのは `build/index.js` → `materialImageSource` / `SymbolView` の2つで、どちらもネイティブモジュール（`requireNativeModule('SymbolModule')`）を触らず **expo-font の `renderToImageAsync` でMaterial Symbolsフォントを画像化するだけ**。フォントは `@expo-google-fonts/material-symbols`（expo-symbolsの推移依存・インストール済み）。＝落ちない。ただし `md` アイコン名が辞書に無ければ**アイコンが出ないだけ**（例外にはならない） |

**Androidに実装はあるが挙動が違う／確認したもの**

- `expo-notifications`: チャンネル登録（`ensureAndroidChannel`）は `Platform.OS !== 'android'` で早期returnし、
  全体が try/catch。**`setNotificationChannelAsync` は POST_NOTIFICATIONS 権限を要求しない**ので、
  Android 13+ で未許可のまま起動しても throw しない。`reregisterAll` 全体も try/catch ＋ `safeBoot`
- `react-native-google-mobile-ads`: 動的 require で守られ、`TestIds` は `ads` が非nullのときだけ参照
  （`bannerUnitId(m, ...)` の引数経由）。`ensureAdsInit()` は無料プランの端末で1回だけ、try/catch＋`.catch()`。
  **App IDは prebuild 後の AndroidManifest に
  `com.google.android.gms.ads.APPLICATION_ID = ca-app-pub-3319916143033433~9006783518` として
  正しく書き込まれることを実際に prebuild して確認済み**（未設定だと Google Mobile Ads SDK が
  `Application.onCreate` で例外を投げてJSに到達する前に落ちるので、ここは実物で確認する価値がある）。
  `DELAY_APP_MEASUREMENT_INIT = true` も入る
- `expo-store-review`: 動的 import ＋ `isAvailableAsync()` で守っている（`lib/reviewPrompt.ts`）
- `expo-print` / `expo-sharing` / `expo-media-library` / `expo-camera` / `expo-image-picker`:
  すべてAndroid実装あり。起動時には呼ばれない（受診レポート・共有・バーコードのユーザー操作起点）
- `react-native-svg` / `react-native-reanimated`(+`react-native-worklets`) / `react-native-screens` /
  `react-native-safe-area-context` / `react-native-gesture-handler`: Android実装あり。
  新アーキ（`newArchEnabled=true`）対応版が入っている
- `@react-native-community/datetimepicker`: Android実装あり＋app.jsonのpluginsにも登録済み
- `expo-router/unstable-native-tabs`: Androidは `NativeTabsView.android.js` があり、
  `react-native-screens` の `TabsContainer.kt` が **自前で `ContextThemeWrapper(..., Theme_Material3_DayNight_NoActionBar)`**
  を掛けている。つまり prebuild が生成する `AppTheme`（`Theme.AppCompat.DayNight.NoActionBar`）でも
  BottomNavigationView のインフレートは落ちない（Materialテーマ必須の古典的クラッシュには当たらない）
- `@expo/ui`: Android実装あり（Jetpack Compose）だが `src/` からは未使用。
  未使用のまま autolink されるので、**将来ビルドサイズやCompose依存の衝突を疑うときは
  最初に外す候補**（今回は起動クラッシュの原因になる経路が無い）

**prebuild の生成物で確認したこと**（`npx expo prebuild --platform android --no-install`）

- `gradle.properties`: `newArchEnabled=true` / `hermesEnabled=true` / `edgeToEdgeEnabled=true` /
  `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`（ABIの取りこぼしなし）
- **R8/minify は無効**（`android.enableMinifyInReleaseBuilds` 未設定＝false）。
  ＝難読化でリフレクション参照が消えて落ちる、という定番の原因は今回は該当しない
- `AndroidManifest.xml`: `enableOnBackInvokedCallback="false"`（predictiveBackGestureEnabled:false が効いている）、
  ディープリンク `bodylog://` 登録済み、通知アイコン/色のmeta-data 登録済み
- `MainApplication.kt` / `MainActivity.kt` はテンプレート素のまま（手が入っていない）
- ⚠️ `expo-dev-client` が `dependencies` にあるため、リリース用のマニフェストにも
  `SYSTEM_ALERT_WINDOW`（dev menuの浮遊ボタン用）が載る。Playの権限表示に出るので、
  気になるなら `devDependencies` へ移す（起動クラッシュとは無関係）
