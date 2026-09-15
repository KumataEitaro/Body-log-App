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
- **アイコン画像を変更したら `node native/scripts/icon-center-check.js` を必ず実行**（円フィット法で±2px以内を確認）。バウンディングボックス法は落ち影で偏るため禁止（2026-08にbbox法で12pxズレを見逃した事故あり）。数値検証に加えて、スクワークル+実寸(180/60px)のホーム画面モックを生成してユーザーの目視承認を得ること。補正に使った指標と検証指標は必ず別にする

## 主要ドキュメント

- docs/app-review-notes.md — 審査提出キット（英語審査ノート・Labels表・チェックリスト）
- docs/monetization.md — フリーミアム設計と広告の鉄の掟
- docs/ux-principles.md — HIG/Nielsen準拠チェックリスト
- supabase/apply-pending.sql — 未適用マイグレーションの一括版（冪等）

## 「AIが使えない」ときの調べ方（2026-09-15 に実際に使った手順）

AI（食事の解析・相談・献立・体の写真の分析・翻訳）は**すべて `lib/gemini.ts` の `callGemini` 1本**を通る。
どれか1つが死んだら全部死んでいると思ってよい。切り分けは次の順で、**推測せず実測する**。

### 1. Gemini の各モデルの生死を直接見る

`app/api/gemini-diag-qa/route.ts` が、本番と同じ発見ロジック・同じ試行順で1モデルずつ叩いて結果を返す。

```js
// QA_SECRET は必ずファイルから読む（チャットにも引数にも出さない）
const SECRET = require('fs').readFileSync('C:/Users/hashi/Documents/BodyLog-secrets/qa-secret.txt', 'utf8').trim();
const r = await fetch('https://bodylog-orcin.vercel.app/api/gemini-diag-qa', {
  method: 'POST',
  headers: { authorization: 'Bearer ' + SECRET, 'content-type': 'application/json' },
  body: '{}', signal: AbortSignal.timeout(290000),
});
console.log(r.status, await r.text());
```

読み方:

| 返ってくるもの | 意味 | 直し方 |
|---|---|---|
| `HTTP 429 ... prepayment credits are depleted` | **Google の残高切れ**。待っても直らない | AI Studio で支払いを補充（下記） |
| `HTTP 429 ... overloaded / try again later` | 一時的な過負荷 | 数分待つ。ヘッジと候補の多様性で大抵は吸収される |
| `HTTP 404 ... is not found` が**全モデル** | Google の世代交代でモデルが消えた | `STATIC_FALLBACK` を更新（発見ロジックが主・静的リストは保険） |
| `HTTP 400` | リクエスト形が非互換 | `thinkingConfig` の扱いを疑う（`tryModel` が自動で1回外して再試行する） |
| `no key` / 500 | `GEMINI_API_KEY` 未設定 | Vercel の環境変数 |

### 2. サーバとQA鍵の疎通だけ見たいとき

`/api/parse-food-qa` に `{}` を POST して **400 `text required`** が返れば、サーバも QA_SECRET も生きている。
**404 `not found`** なら鍵が違う（Vercel の `QA_SECRET` と手元のファイルがずれている）。

### 3. 利用者に出る文言

`callGemini` は失敗の山を `isBillingExhausted()` で切り分ける（2026-09-15 追加）。

- 枯渇 → 「AIの利用枠が上限に達しているため、いまは解析できません。**再試行しても直りません**。…」＋ サーバログに `console.error`
- それ以外 → 「AIが一時的に使えませんでした。少し待って再試行してください。」

**待っても直らないものに「待って」と言わない**。2026-09-15 はこれができておらず、利用者が何度も押し続け、
報告も「AIが使えない」止まりで原因に辿り着くまで時間がかかった。判定は `tests/gemini.test.ts` が固定している。

### 4. 直したあとの確認

`/api/parse-food-qa` に実際の文章（例 `{"text":"バナナ1本と卵2個"}`）を投げて 200 が返ることを見る。
`error` と `detail` の両方を出力すると、直っていない場合に次の一手がすぐ決まる。

### 注意: 修正はサーバ側だけで効く

文言も分岐も `lib/gemini.ts` にあり、アプリは API が返す `error` をそのまま出すだけ。
**アプリの再ビルドは不要**で、`npx vercel deploy --prod --yes` だけで全利用者に反映される。
