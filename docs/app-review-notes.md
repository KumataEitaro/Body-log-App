# App Store 審査提出キット（BodyLog RN版）

提出直前にこのファイルの内容をApp Store Connectへ貼り付ける。英語文面はそのまま使える。

## 1. 審査ノート（App Review Information > Notes に貼る英語文面）

```
BodyLog is a personal health tracking app (meals, calories, weight, workouts).

HOW TO TEST:
1. Log in with the demo account below (or create a new account).
2. "食事" (Meals) tab: type a meal like "卵2個とご飯" and tap "✨ AI解析" —
   the app sends the text to Google Gemini API via our server and returns
   estimated nutrition. You can also attach a food photo.
3. "身体の変化" (Progress) tab: weight/intake charts and a calendar.
4. "設定" (Settings) tab: profile editing and full ACCOUNT DELETION
   (type 「削除」 to confirm) — this permanently deletes the account and
   all data, per guideline 5.1.1(v).

HEALTH DATA / HEALTHKIT (guideline 5.1.3):
- HealthKit is used ONLY to import body weight and display steps/sleep,
  with explicit user permission (Settings tab > ヘルスケア連携).
- Health data is NEVER used for advertising or marketing, and is never
  sold or shared with third parties or data brokers.
- Our privacy policy discloses HealthKit usage:
  https://bodylog-orcin.vercel.app/privacy

THIRD-PARTY AI (Google Gemini):
- Meal text/photos are sent to Google Gemini API solely to estimate
  nutrition. This is disclosed in the privacy policy.

The app UI is in Japanese (primary market: Japan).
```

## 2. デモアカウント（提出前に作成して記入）

- Email: （審査用の捨てアカウントを作成して記入。本人アカウントは使わない）
- Password: （同上）
- 事前に2〜3日分の食事・体重を記録しておく（空のアプリは「動かない」と誤解される）

## 3. 提出前チェックリスト（コード側）

- [ ] β表記の除去: `native/src/app/(tabs)/log.tsx`（ヘッダー「ネイティブβ」）と `native/src/app/login.tsx`（「ネイティブ版（β）」）
- [ ] 捨てアカウントでアカウント削除のE2E確認（削除→ログイン画面→再ログイン不可）
- [ ] TestFlightビルドでHealthKit許可ダイアログ・写真解析・全タブを実機確認
- [ ] アプリ名の商標衝突チェック（App Storeで「BodyLog」を検索）

## 4. App Store Connect 記入内容

- **カテゴリ**: 主=ヘルスケア/フィットネス、副=フード/ドリンク
- **年齢制限**: 4+（ギャンブル・暴力なし。ダイエット文脈だが医療助言はしない旨明記済み）
- **プライバシーポリシーURL**: https://bodylog-orcin.vercel.app/privacy
- **暗号化申告**: ITSAppUsesNonExemptEncryption = NO（HTTPSのみ）

### Privacy Nutrition Labels（データ収集の申告）

| データ種別 | 収集 | 目的 | ユーザーと紐付け | トラッキング |
|---|---|---|---|---|
| メールアドレス | ✓ | アプリ機能（認証） | ✓ | ✗ |
| 健康とフィットネス（食事・体重・運動・HealthKit） | ✓ | アプリ機能 | ✓ | ✗ |
| 写真（食事・体） | ✓ | アプリ機能（AI解析・記録） | ✓ | ✗ |
| 使用状況データ（AI利用回数・最終利用日） | ✓ | アプリ機能 | ✓ | ✗ |

※広告SDK導入時はこの表とATT対応の見直しが必須（HealthKitデータは広告に使わない——鉄の掟）。

## 5. スクリーンショット（あなたの作業）

- 必須サイズ: 6.9インチ（iPhone 17 Pro Max等）と6.5インチ（iPhone 11 Pro Max等）
- 推奨構成: ①食事タブ（ヒーロー+フィード）②AI解析結果 ③身体の変化（グラフ+カレンダー）④目標 ⑤AIコーチ
- TestFlight版でデモデータを入れた状態で撮影

## 6. 提出タイミング

- 週の前半（月〜火）に提出（金曜提出は週末をまたいで遅くなりがち）
- 初回審査の目安24〜48時間、リジェクト時は本ファイル1.の文面を修正して再提出
