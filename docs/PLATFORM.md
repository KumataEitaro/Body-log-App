# プラットフォーム差分台帳（iOS / Android）

方針: **プラットフォーム差分はあってよいが、それぞれのOSの最新作法に沿った一級のアプリに保つ。**
このファイルは「意図した差分の台帳」と「各OSの作法チェックリスト」。
**OSメジャー更新（毎秋のiOS新版・Android新版）のたびに全項目を見直す**運用とする。

## 1. 意図した差分（仕様。バグではない）

| 項目 | iOS | Android | 理由・備考 |
|---|---|---|---|
| ヘルスケア連携 | HealthKit（歩数・ワークアウト取込・体重自動取込・時間帯別歩数） | 非表示（dynamic requireで静かに無効化） | 将来 Health Connect 対応を検討（docs/ANDROID.md） |
| Appleでサインイン | 表示（Google併設時のApple審査要件） | 非表示（メール＋Google SSOのみ） | Play側にApple SSO要件は無い |
| 課金キー | `EXPO_PUBLIC_RC_IOS_KEY` | `EXPO_PUBLIC_RC_ANDROID_KEY`（未設定の間は課金UI非表示） | RevenueCatのストア別公開APIキー |
| タブバーの見た目 | iOS 26 Liquid Glass／旧iOSは従来バー | Material 3 ネイティブタブ | expo-router/unstable-native-tabs がOSに委ねる（両OSとも「OS標準の見た目」が正） |
| デザイン言語 | Liquid Glass（触覚・エッジスワイプ・pageSheet） | Material 3（リップル・edge-to-edge） | 共通トークン（C）で色は一元管理しつつ、タッチフィードバックはOS作法に従う |
| ホームウィジェット | 小サイズ「あと{n}kcal」＋🔥（ENABLE_WIDGET=trueのCIビルドのみ） | 未対応 | Glance対応は将来検討（docs/WIDGET.md） |
| pageSheetモーダル | OSが上端を空ける | 全画面化されるため `sheetTopPad()` でステータスバー分を補正 | lib/ui.ts |
| バージョン番号 | agvtool + $BUILD_NUMBER | versionCode をCodemagicが自動採番 | version文字列は app.json の1本で共通（docs/ANDROID.md） |

## 2. Android作法チェック（Material 3 / 最新Android）

- [x] **edge-to-edge**: SDK 57既定で有効。ステータスバー下敷き＋`sheetTopPad()`で補正済み
- [x] **通知チャンネル**: 登録済み（アクションボタン含む・言語変更時に再登録）
- [x] **モノクロアイコン（Android 13+ テーマアイコン）**: `android-icon-monochrome.png` 設定済み（adaptiveIcon＋通知アイコン兼用）
- [x] **タッチのリップル**（2026-09-01対応）: 共通タッチ部品に `android_ripple`（テーマ色 `rgba(C.teal, 0.14)`・borderless: false・Pressable自身のborderRadiusでクリップ）
  - ui/Selectable.tsx: Chip / OptionButton / SegmentedControl
  - settings.tsx: メニュー行（s.row）・トグル行（bt.row）
  - changes.tsx: マスタメニュー行（menuRow）
  - 押下スケール等のカスタムアニメを既に持つその他の要素には過剰適用しない
- [ ] **predictive back（予測型戻る）**: **現状無効**（app.json `predictiveBackGestureEnabled: false`）。
  理由: BackHandlerによる「詳細クローズ→メニューに戻る」制御と非互換（予測型を有効にすると
  BackHandlerの介入が効かず、詳細を閉じるつもりがアプリ退出のプレビューになる）。
  RN側の対応（onBackInvokedCallbackとの統合）が成熟したら有効化を再検討。
  なお概要タブの「エッジスワイプで戻る」ジェスチャは自前実装で両OS有効（同方向の操作感は既に提供）
- [ ] **Material You 動的カラー（Dynamic Color）**: 未対応。アプリ内テーマ機能
  （アクセント12色・背景4段階）で代替。`@pchmn/expo-material3-theme` 等での取得を将来検討
- [x] **Google SSO**: Supabase OAuth（Web経由PKCE）でネイティブSDK不要（docs/ANDROID.md）
- [ ] **Health Connect**: 未対応（HealthKit相当の将来課題）

## 3. iOS作法チェック（Liquid Glass / 最新iOS）

- [x] **タブ再選択でルートへ戻る**: 対応済み
- [x] **エッジスワイプで戻る**: 概要タブの詳細で対応済み（左端32px開始・指に追従・しきい値1/3 or 800px/s）
- [x] **触覚フィードバック**: 全域（選択・保存・目標超過・ダイアル刻み・バッジ獲得。タブ切替はOS標準）
- [x] **Dynamic Type**: 本文系は端末の文字サイズ設定にそのまま追従。
  固定寸法の「数字の大表示」（ヒーローkcal・DateStripチップ・セグメント・タイマー・KPI・
  ダイアル・FAB・共有ステッカー等）のみ `maxFontSizeMultiplier={1.3}` で頭打ち（2026-09-01対応）
- [x] **視差軽減（Reduce Motion）**: アニメ停止対応済み
- [x] **ウィジェット**: ENABLE_WIDGET=trueのCIビルドで小サイズ対応（docs/WIDGET.md）
- [x] **pageSheetモーダル・ネイティブヘッダー・inlineカレンダー**: OS標準UIを使用

## 4. OS新版が出たら確認する項目

毎秋（iOS新版・Android新版・Expo SDKメジャー更新）に以下を実機/TestFlight/内部テストで確認する:

1. **タブバー**: expo-router/unstable-native-tabs の見た目・挙動（docs/RELEASE-RISKS.md B4）。
   Liquid Glass/Material 3の新デザインへの追従を最優先で確認
2. **edge-to-edge / セーフエリア**: ステータスバー・ナビゲーションバー下のレイアウト
   （特に `sheetTopPad()` の前提が変わっていないか）
3. **predictive back**: RN/Expoの対応状況を確認し、成熟していれば
   `predictiveBackGestureEnabled: true` ＋ BackHandler箇所の移行を検討（上記2章）
4. **通知**: チャンネル・アクションボタン・権限ダイアログの挙動変化
5. **HealthKit / （将来）Health Connect**: 権限画面・読み取りAPIの変化
6. **カメラ・フォトピッカー**: OS標準ピッカーのAPI変更（expo-image-picker / expo-camera）
7. **Dynamic Type / フォントスケール**: 新しい文字サイズ段階での大数字表示の崩れ
8. **アイコン**: iOSの新アイコン形式・Androidテーマアイコンの要件変化
9. **サインイン**: Apple SSO / Google SSO（Supabase OAuth）のWebビュー挙動
10. **課金**: StoreKit / Google Play Billing の新要件（RevenueCat SDKの更新で追従）
11. **ストア審査要件**: App Store Review Guidelines / Play policy の変更（docs/RELEASE-RISKS.md）
