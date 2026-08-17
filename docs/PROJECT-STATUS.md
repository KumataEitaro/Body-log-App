# BodyLog プロジェクト引き継ぎ書（AIアシスタント向けコンテキスト）

最終更新: 2026-08-17。新しい環境・アカウントでAIに作業を頼むときは、まずこのファイルを読ませること。

## サービス概要

- 筋トレ/食事/体重のトラッカー。本番: https://bodylog-orcin.vercel.app（Next.js + Supabase + Vercel）
- ユーザー: 熊田英太郎（アプリのアカウントは gotcha429@gmail.com）＋友達も使えるマルチユーザー
- AI解析: Google Gemini（食事テキスト/写真→栄養素推定、AIコーチ相談）

## アーキテクチャ（2026-08時点）

| 層 | 実体 | 状態 |
|---|---|---|
| Web版 | リポジトリ直下（Next.js App Router） | **凍結方針: バグ修正のみ**。新機能はRN優先 |
| iOS旧版 | ios/（Capacitor）Bundle ID: com.gotcha.bodylog | TestFlight配信中。RN版が育つまで併用 |
| iOS新版 | native/（Expo SDK 57 + expo-router）Bundle ID: **com.gotcha.bodylog.rn** | **RN移行 Phase 3bまで完了**。同一Supabaseで並行運用 |
| DB | Supabase（PK: entriesは(user_id,date)、goalsはuser_id） | migration-15まで。apply-pending.sqlに未適用分を集約 |
| CI | Codemagic（codemagic.yaml）。webhook無し→**手動Start new build運用** | workflow: ios-testflight(旧) / **rn-testflight(新)** |

## RN版（native/）の現状

- 6タブ全機能実装済み: 食事（AI解析・写真・マイ食品チップ・穴埋め・過食リスク・前の食事をもう一度）/ トレ / 身体の変化（KPI・グラフ・カレンダー・食材傾向）/ 相談 / 目標（体重+筋トレ重量・DateTimePicker）/ 設定（プロフィール・ヘルスケア連携・アカウント削除）
- HealthKit: @kingstinct/react-native-healthkit v14。**動的requireでExpo Goでも落ちない**（lib/health.ts）
- プレビュー: Expo Go LANモード（`npx expo start`、ngrokは組織ネット不可）
- Web API認証: /api/* は lib/supabase/apiAuth.ts の getApiAuth(req) で Cookie/Bearer 両対応
- スヌーズ等は AsyncStorage（キーはWeb版localStorageと同名）

## 残タスク

1. TestFlightビルドの成功確認（署名は解決済み。プロファイルはCodemagicのCode signing identitiesに取込済み）
2. 実機確認: ヘルスケア連携・写真解析・タブバー位置（移行の動機だった不具合）
3. 公開時: **β表記除去**（native/src/app/(tabs)/log.tsx・login.tsx）・デモアカウント・審査提出は docs/app-review-notes.md 参照
4. 収益化: フリーミアム土台済み（profiles.premium_until + lib/premium.ts）。RevenueCat/AdMobは公開後。**鉄の掟: HealthKitデータを広告に使わない・全画面広告禁止**（docs/monetization.md）

## 作業ルール（ユーザーとの取り決め）

- **秘密情報（GEMINI_API_KEY等のサーバーキー・パスワード）はAIが値を扱わない**。ユーザーがVercel/Codemagicに直接登録。.env.localは読まない。EXPO_PUBLIC_のsb_publishable_キーは公開クライアントキーなので扱ってよい（native/.envはgit管理）
- codemagic.io / supabase.com / Apple系サイトは組織ブラウザからアクセス不可だった経緯があり、**CIログ・ダッシュボードはユーザーがスクショ/テキストを貼る運用**
- コミットは細かく区切る（PCスリープ対策）。native変更時は `cd native && npx tsc --noEmit && npm test` を通してからcommit（npm test=jest-expoの全画面smoke test。描画時クラッシュ＝リリースの白画面を検出する。過去にD&Dライブラリのreanimated非互換で2度白画面事故あり）
- Webの動作確認は `npm run build` → `npx vercel deploy --prod`。テストは vitest（tests/）
- 回答・コミットメッセージは日本語

## 主要ドキュメント

- docs/app-review-notes.md — 審査提出キット（英語審査ノート・Labels表・チェックリスト）
- docs/monetization.md — フリーミアム設計と広告の鉄の掟
- docs/ux-principles.md — HIG/Nielsen準拠チェックリスト
- supabase/apply-pending.sql — 未適用マイグレーションの一括版（冪等）
