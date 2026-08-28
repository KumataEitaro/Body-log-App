// RevenueCat（アプリ内課金）ラッパー。プラン判定の正本はサーバー（profiles.plan）だが、
// 端末側の即時反映（購入直後・オフライン時）はここのentitlementを見る。
// APIキー未設定（iOS: EXPO_PUBLIC_RC_IOS_KEY / Android: EXPO_PUBLIC_RC_ANDROID_KEY なし）の
// 間は、そのプラットフォームでは全機能が安全に「未課金」を返す。
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

export type Plan = 'free' | 'lite' | 'standard' | 'premium';
const RANK: Record<string, number> = { lite: 1, standard: 2, premium: 3 };

// プラットフォームごとにキーを選ぶ。Androidキーは未発行（2026-08-29時点）なので
// Androidでは空文字 → purchasesAvailable()がfalse → 課金UIが一切出ない（安全側）。
// iOSは従来どおり EXPO_PUBLIC_RC_IOS_KEY のみを見る＝挙動不変。
const RC_KEY = Platform.OS === 'android'
  ? (process.env.EXPO_PUBLIC_RC_ANDROID_KEY || '')
  : (process.env.EXPO_PUBLIC_RC_IOS_KEY || '');

// SDKは遅延ロード（キー未設定のビルドやAndroidで起動時クラッシュさせない）
type RC = typeof import('react-native-purchases').default;
let rc: RC | null = null;
let configured = false;

async function ensureConfigured(): Promise<RC | null> {
  // キーがある＝そのOS用のキー（RC_KEYの選択ロジック参照）。iOS/Android以外(web等)は常にnull
  if (!RC_KEY || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return null;
  if (!rc) {
    try { rc = (await import('react-native-purchases')).default; } catch { return null; }
  }
  if (!configured) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // appUserID=SupabaseのユーザーID。webhookがこのIDでprofiles.planを更新する
      rc.configure({ apiKey: RC_KEY, appUserID: user?.id ?? null });
      configured = true;
    } catch { return null; }
  }
  return rc;
}

/** 課金機能が使える状態か（そのOS用のキーが設定済みのiOS/Androidのみ） */
export function purchasesAvailable(): boolean {
  return !!RC_KEY && (Platform.OS === 'ios' || Platform.OS === 'android');
}

/** 現在のプラン（RevenueCatのentitlementから。未課金・エラー時は'free'） */
export async function currentPlan(): Promise<Plan> {
  const sdk = await ensureConfigured();
  if (!sdk) return 'free';
  try {
    const info = await sdk.getCustomerInfo();
    const active = Object.keys(info.entitlements.active ?? {});
    const best = active.filter((e) => RANK[e]).sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0))[0];
    return (best as Plan) ?? 'free';
  } catch { return 'free'; }
}

export type Offer = {
  plan: Plan;
  period: 'monthly' | 'sixmonth' | 'annual';
  priceString: string;   // 例: ¥480
  price: number;         // 数値（年額の月換算表示に使う）
  currency: string;      // 例: JPY
  trialDays: number;     // 無料トライアル日数（無ければ0）
  pkg: unknown;          // purchase()にそのまま渡す
};

// introPrice（お試しオファー）から無料トライアル日数を求める
function trialDaysOf(intro: { price?: number; periodUnit?: string; periodNumberOfUnits?: number } | null | undefined): number {
  if (!intro || Number(intro.price) !== 0) return 0;   // 有料イントロ価格はトライアル扱いしない
  const n = Number(intro.periodNumberOfUnits) || 0;
  switch (String(intro.periodUnit).toUpperCase()) {
    case 'DAY': return n;
    case 'WEEK': return n * 7;
    case 'MONTH': return n * 30;
    case 'YEAR': return n * 365;
    default: return 0;
  }
}

/** 買えるプラン一覧（RevenueCatのofferingsから取得。価格はASC側の設定が自動反映） */
export async function fetchOffers(): Promise<Offer[]> {
  const sdk = await ensureConfigured();
  if (!sdk) return [];
  try {
    const offerings = await sdk.getOfferings();
    const out: Offer[] = [];
    for (const [id, off] of Object.entries(offerings.all ?? {})) {
      // offering識別子＝プラン名（lite/standard/premium）で運用する
      const plan = (RANK[id] ? id : off.metadata?.plan) as Plan | undefined;
      if (!plan || !RANK[plan]) continue;
      for (const pkg of off.availablePackages) {
        const t = String(pkg.packageType || '').toUpperCase();
        const period = t === 'ANNUAL' ? 'annual' : t === 'SIX_MONTH' ? 'sixmonth' : t === 'MONTHLY' ? 'monthly' : null;
        if (!period) continue;
        out.push({
          plan, period,
          priceString: pkg.product.priceString,
          price: Number(pkg.product.price) || 0,
          currency: String(pkg.product.currencyCode || ''),
          trialDays: trialDaysOf(pkg.product.introPrice),
          pkg,
        });
      }
    }
    return out;
  } catch { return []; }
}

/** 購入。成功したら新しいプランを返す（キャンセルはnull） */
export async function purchase(offer: Offer): Promise<Plan | null> {
  const sdk = await ensureConfigured();
  if (!sdk) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sdk.purchasePackage(offer.pkg as any);
    return await currentPlan();
  } catch (e) {
    const err = e as { userCancelled?: boolean; message?: string };
    if (err?.userCancelled) return null;
    throw new Error(err?.message || '購入に失敗しました。');
  }
}

/** 購入の復元（機種変更・再インストール時）。復元後のプランを返す */
export async function restore(): Promise<Plan> {
  const sdk = await ensureConfigured();
  if (!sdk) return 'free';
  try { await sdk.restorePurchases(); } catch { /* 復元対象なしはエラーになるが無視 */ }
  return currentPlan();
}
