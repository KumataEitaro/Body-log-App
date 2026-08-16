# BodyLog 収益化設計（フリーミアム）

方針決定: 2026-08-09「課金で広告をなくせる実装にする」

## 構造

| | 無料 | プレミアム（月額¥480想定・サブスク） |
|---|---|---|
| 記録・分析・基本機能 | 全部使える | 同じ |
| AI解析・AIコーチ | 15回/日（AI_DAILY_LIMIT） | 無制限 |
| 広告（将来導入） | リワード（AI回数追加）＋読む画面末尾のバナーのみ | 完全非表示 |

## アーキテクチャ

- 課金の正本: **RevenueCat**（Apple IAP自動更新サブスク）→ Webhook → `profiles.premium_until` を更新（migration-15）
- 全クライアント（Web/RN/API）は `lib/premium.ts` の `isPremiumActive()` / `shouldShowAds()` **だけ**を見る
  - AI回数制限: parse-food / coach 実装済み（premium_until列が無い環境でも無料扱いで安全）
  - 広告表示: 将来の広告SDK導入時も `shouldShowAds()` の1点ゲート（条件分岐を散らさない）

## 鉄の掟

1. **HealthKit・健康データ（体重/食事/気分）を広告ターゲティングに一切使わない**（Apple 5.1.3・永久BAN級）。
   広告SDKに渡してよいのは広告SDK自身が collect するデバイス情報のみ
2. 全画面広告（インタースティシャル）は使わない。記録動線に広告を挟まない
3. 分析・広告系SDKを安易に追加しない（ATT申告・Nutrition Labelsが連動して変わる）

## 導入時の残作業（公開後フェーズ）

ユーザー側（1回だけ）:
1. App Store Connect: **Paid Apps契約**（契約・税金・口座の登録）
2. App Store Connect: サブスク商品作成（例: `bodylog_premium_monthly` ¥480・1週間無料トライアル）
3. RevenueCatアカウント作成（無料枠）→ ASC APIキー接続
4. （広告時）AdMobアカウント＋支払い/税務情報、app-ads.txt設置

実装側:
5. RN: react-native-purchases（RevenueCat SDK）＋ 設定タブに「プレミアム」画面（購入/復元）
6. /api/rc-webhook: RevenueCat→premium_until同期（署名検証つき）
7. （広告時）react-native-google-mobile-ads＋SKAdNetwork＋ATT＋Labels/ポリシー更新
