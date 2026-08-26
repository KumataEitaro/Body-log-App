import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// RevenueCat Webhook: 課金状態の正本をprofiles.plan / plan_untilへ反映する。
// 設定: RevenueCat > Integrations > Webhooks で
//   URL: https://bodylog-orcin.vercel.app/api/rc-webhook
//   Authorization header: Vercel環境変数 RC_WEBHOOK_SECRET と同じ値
// アプリ側はRevenueCatのappUserIDにSupabaseのuser.idを渡す（native/src/lib/purchases.ts）。
export const preferredRegion = 'hnd1';

// entitlement識別子（RevenueCatダッシュボードのEntitlements）→ plan。強い方を採用
const RANK: Record<string, number> = { lite: 1, standard: 2, premium: 3 };

export async function POST(req: Request) {
  const secret = process.env.RC_WEBHOOK_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  // RevenueCatはAuthorizationヘッダーに設定値をそのまま送る（Bearer付きでも設定次第なので両対応）
  if (!secret || (auth !== secret && auth !== `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { event?: {
    type?: string; app_user_id?: string; entitlement_ids?: string[] | null;
    expiration_at_ms?: number | null;
  } } | null;
  const ev = body?.event;
  if (!ev) return NextResponse.json({ ok: false, error: 'no event' }, { status: 400 });
  if (ev.type === 'TEST') return NextResponse.json({ ok: true, test: true });

  // appUserIDはSupabaseのuser.id（UUID）で連携。RC匿名ID($RCAnonymousID:...)は無視
  const uid = String(ev.app_user_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(uid)) return NextResponse.json({ ok: true, skipped: 'anonymous' });

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!svcKey || !url) return NextResponse.json({ ok: false }, { status: 500 });
  const svc = createClient(url, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 最も強いentitlementを採用。EXPIRATIONや空のentitlementsはfreeへ
  const ids = (ev.entitlement_ids ?? []).filter((e) => RANK[e]);
  const strongest = ids.sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0))[0];
  const expMs = Number(ev.expiration_at_ms ?? 0);
  const expired = ev.type === 'EXPIRATION' || !strongest || (expMs > 0 && expMs <= Date.now());

  const update = expired
    ? { plan: 'free', plan_until: null as string | null }
    : { plan: strongest, plan_until: expMs > 0 ? new Date(expMs).toISOString() : null };
  const { error } = await svc.from('profiles').update(update).eq('id', uid);
  if (error) {
    console.log(`[rc-webhook] update失敗 uid=${uid} ${error.message}`);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  console.log(`[rc-webhook] ${ev.type} uid=${uid} → plan=${update.plan} until=${update.plan_until ?? '-'}`);
  return NextResponse.json({ ok: true });
}
