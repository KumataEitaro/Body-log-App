// 3プラン制（free/lite/standard/premium）の判定と上限取得の一点ゲート。
// 正本はRevenueCat → /api/rc-webhook が profiles.plan / plan_until を更新 → 全所は本モジュールを通す。
// 旧プレミアム（profiles.premium_until）は互換のため premium として扱う。
import type { SupabaseClient } from '@supabase/supabase-js';
import { isPremiumActive } from './premium';

export const PLANS = ['free', 'lite', 'standard', 'premium'] as const;
export type Plan = (typeof PLANS)[number];

export type PlanLimits = {
  plan: Plan;
  text_day: number | null;   // null = 無制限
  photo_day: number | null;
  coach_day: number | null;
  photo_trial_total: number; // 写真解析の生涯お試し枠（free/lite用）
  ads: boolean;
};

// DBのplan_limitsが読めない時の保険（値はmigration-18の初期値と揃えること）
const FALLBACK: Record<Plan, PlanLimits> = {
  free:     { plan: 'free',     text_day: 3,   photo_day: 0,  coach_day: 3,  photo_trial_total: 5, ads: true },
  lite:     { plan: 'lite',     text_day: 3,   photo_day: 0,  coach_day: 3,  photo_trial_total: 5, ads: false },
  standard: { plan: 'standard', text_day: 50,  photo_day: 5,  coach_day: 10, photo_trial_total: 0, ads: false },
  premium:  { plan: 'premium',  text_day: 100, photo_day: 30, coach_day: 50, photo_trial_total: 0, ads: false },
};

export function resolvePlan(row: { plan?: string | null; plan_until?: string | null; premium_until?: string | null } | null | undefined, now = new Date()): Plan {
  if (!row) return 'free';
  // 旧プレミアム互換（手動付与や移行期間中のユーザー）
  if (isPremiumActive(row.premium_until ?? null, now)) return 'premium';
  const p = String(row.plan ?? 'free') as Plan;
  if (!PLANS.includes(p) || p === 'free') return 'free';
  // 有料プランは期限内のみ有効（webhookの取りこぼし・解約後の安全側）
  if (row.plan_until) {
    const t = new Date(row.plan_until).getTime();
    if (!Number.isFinite(t) || t <= now.getTime()) return 'free';
  }
  return p;
}

// plan_limitsは変更頻度が低いのでプロセス内キャッシュ（5分）
let cache: { at: number; rows: Map<string, PlanLimits> } | null = null;
export async function getLimits(supabase: SupabaseClient, plan: Plan): Promise<PlanLimits> {
  if (!cache || Date.now() - cache.at > 5 * 60_000) {
    const { data } = await supabase.from('plan_limits').select('plan,text_day,photo_day,coach_day,photo_trial_total,ads');
    if (data && data.length) {
      cache = { at: Date.now(), rows: new Map(data.map((r) => [String(r.plan), r as PlanLimits])) };
    }
  }
  return cache?.rows.get(plan) ?? FALLBACK[plan];
}

export type AiKind = 'text' | 'photo' | 'coach';

// 上限判定。ok=false のとき reason に理由（アプリはこれで案内を出し分ける）
export function checkKindLimit(
  limits: PlanLimits,
  kind: AiKind,
  usedToday: { text_count?: number; photo_count?: number; coach_count?: number } | null,
  photoLifetime: number,
): { ok: true } | { ok: false; reason: 'day' | 'trial'; limit: number } {
  const used = usedToday ?? {};
  if (kind === 'photo') {
    const day = limits.photo_day;
    if (day == null) return { ok: true };
    if ((used.photo_count ?? 0) < day) return { ok: true };
    // 日次枠を使い切っていても、お試し累計枠が残っていれば通す（free/lite: day=0で累計のみ）
    if (photoLifetime < limits.photo_trial_total) return { ok: true };
    return day === 0
      ? { ok: false, reason: 'trial', limit: limits.photo_trial_total }
      : { ok: false, reason: 'day', limit: day };
  }
  const day = kind === 'text' ? limits.text_day : limits.coach_day;
  if (day == null) return { ok: true };
  const u = kind === 'text' ? (used.text_count ?? 0) : (used.coach_count ?? 0);
  return u < day ? { ok: true } : { ok: false, reason: 'day', limit: day };
}
