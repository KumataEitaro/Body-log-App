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
