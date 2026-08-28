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
