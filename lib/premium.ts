// プレミアム課金の判定（Web・ネイティブ・API共通の1点ゲート）。
// 正本はRevenueCat（Apple IAP）→ Webhookが profiles.premium_until を更新 → 全クライアントはこれを見る。
// 広告表示・AI回数制限は必ずこの関数を通すこと（広告SDK導入時に条件分岐を増やさない）。

export function isPremiumActive(premiumUntil: string | null | undefined, now = new Date()): boolean {
  if (!premiumUntil) return false;
  const t = new Date(premiumUntil).getTime();
  return Number.isFinite(t) && t > now.getTime();
}

/** 広告を表示してよいか（将来の広告SDK導入時はこの1点だけを見る） */
export function shouldShowAds(premiumUntil: string | null | undefined): boolean {
  return !isPremiumActive(premiumUntil);
}
