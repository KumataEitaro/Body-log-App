# 広告（AdMob）の実装と、公開までに必要な手順

2026-09-01（feat/ads）実装。無料プラン向け**アンカー型アダプティブバナー**のみ。
インタースティシャル・リワード・ネイティブ広告は使わない（L4=優しさ思想を壊さない）。

## いま何がどう動くか（コード側・対応済み）

- SDK: `react-native-google-mobile-ads`（Expo config plugin対応）
- 表示条件: `useGate()` が **active（=RCキー設定済みの課金有効ビルド）かつ plan が null/'free'**
  のときだけ表示。**現在の運用（RCキー未設定）では誰にも表示されない**。
  課金を解放するビルド（RCキー設定）と同時に広告も点灯する＝
  「ライト¥300の『広告なし』に実体がある」状態が仕組みで保証される（RELEASE-RISKS A1対策）
- 配置: 食事タブ「今日の記録」カードの直下に1枚だけ。他のタブには置かない（初回は最小）
- ATT: **初回リリースは非パーソナライズ広告（NPA）固定**。ATTダイアログは出さず、
  `requestNonPersonalizedAdsOnly: true` を全リクエストに付与、
  plugin側も `delayAppMeasurementInit: true`（安全側）。パーソナライズ化は将来の改善
- 広告の下に「ライトプランで広告を消せます」→ `/paywall?src=ads` の導線つき
- 読み込み失敗・Expo Go・モジュール無し環境では高さ0（空白の枠を見せない）

## ID は2種類ある（混同注意）

| 種類 | 形式 | どこに設定するか |
|---|---|---|
| **App ID**（アプリごと・iOS/Android別） | `ca-app-pub-XXXX~YYYY`（チルダ） | `native/app.json` の plugin 設定（要再ビルド） |
| **広告ユニットID**（バナーごと） | `ca-app-pub-XXXX/YYYY`（スラッシュ） | Codemagic 環境変数（要再ビルド） |

現在は **どちらもGoogle公式のテストIDが仮置き**されている:

- App ID（app.json）: iOS `ca-app-pub-3940256099942544~1458002511` / Android `~3347511713`
- バナーユニットID: 環境変数未設定のためコードが `TestIds.ADAPTIVE_BANNER` にフォールバック

**テストIDのままでも広告の表示・レイアウト確認は完全にできる**（「Test Ad」ラベル付きの
本物の広告が出る）。収益が発生しないだけなので、実ID取得前にTestFlightで見た目の確認が可能。

## 熊田さんの手順（実IDへの差し替え）

1. **AdMobアカウント作成** — https://admob.google.com （Googleアカウントで無料。
   支払い情報は収益発生後でOK）
2. **アプリを2つ登録** — AdMob管理画面「アプリ」→「アプリを追加」。
   iOS用とAndroid用で別々に登録する。ストア未公開でも
   「アプリはストアに掲載されていますか？→いいえ」で**手動登録**できる
   （公開後にストアと紐付け直せる）
3. **App ID×2 を app.json へ** — 各アプリの「アプリ設定」に出る
   `ca-app-pub-…~…`（チルダ形式）を `native/app.json` →
   `plugins` → `react-native-google-mobile-ads` の `iosAppId` / `androidAppId` に差し替え
4. **バナー広告ユニットを作成** — 各アプリで「広告ユニット」→「バナー」を1つずつ作成。
   出てきた `ca-app-pub-…/…`（スラッシュ形式）を **Codemagic の環境変数**へ:
   - `EXPO_PUBLIC_ADMOB_BANNER_IOS`（iOSアプリのバナーユニットID）
   - `EXPO_PUBLIC_ADMOB_BANNER_ANDROID`（AndroidアプリのバナーユニットID）
5. **再ビルド** — App ID・環境変数はどちらもビルド時に焼き込まれるため、
   差し替え後は必ず再ビルド（capability変更なし＝Codemagicの自動署名でそのまま通る）

## 注意（アカウント停止事由）

- **実IDの広告を自分でタップしない**（テスト目的でも不可）。動作確認はテストIDで行うか、
  AdMob管理画面で自分の端末を「テストデバイス」に登録してから行う
- 実IDに差し替えた直後は「広告在庫の準備中」で数時間〜数日出ないことがある（正常）

## 将来の改善候補（今はやらない）

- ATT許諾を取ってパーソナライズ広告化（eCPM向上）。app.json に
  `userTrackingUsageDescription` を追加し、許諾結果で NPA を出し分ける
- GDPR圏向けの同意フォーム（UMP SDK）。NPA固定の間は不要側に倒している
