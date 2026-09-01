import { NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/supabase/apiAuth';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// クーポンコードの適用: coupon_codes（migration-23）を検証して profiles.plan を直接付与する。
// ・RC購読とは独立の経路（plan_until=null=無期限。resolvePlanは期限なし有料として扱う）
// ・coupon_codesはRLSでポリシーなし＝service roleのみ触れる（コードの総当たり列挙をDB層で防ぐ）
// ・「1ユーザー1コード1回」はcoupon_redemptionsのPK(user_id, code)で保証（同時リクエストにも安全）
// ・rc-webhook側には「plan_untilがnullの有料行は降格させない」ガードがあり、
//   クーポン付与が後続の購読イベントで上書きされない
export const preferredRegion = 'hnd1';

const COUPON_PLANS = ['lite', 'standard', 'premium'];

export async function POST(req: Request) {
  const [{ user }, bodyRaw] = await Promise.all([
    getApiAuth(req),
    req.json().catch(() => null),
  ]);
  if (!user) return NextResponse.json({ ok: false, code: 'unauthorized', error: 'ログインが必要です。' }, { status: 401 });

  const code = String((bodyRaw as { code?: unknown } | null)?.code ?? '').trim();
  if (!code || code.length > 64) {
    return NextResponse.json({ ok: false, code: 'invalid', error: '無効なコードです' }, { status: 400 });
  }

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!svcKey || !url) return NextResponse.json({ ok: false, error: 'サーバー設定エラー（管理者に連絡してください）。' }, { status: 500 });
  const svc = createServiceClient(url, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ===== コードの検証（存在・プラン・期限・使用上限） =====
  const { data: coupon, error: cErr } = await svc.from('coupon_codes')
    .select('code,plan,max_uses,used_count,expires_at').eq('code', code).maybeSingle();
  // テーブル未作成（migration-23未適用）もユーザーには「無効なコード」として静かに返す
  if (cErr || !coupon || !COUPON_PLANS.includes(String(coupon.plan))) {
    return NextResponse.json({ ok: false, code: 'invalid', error: '無効なコードです' }, { status: 404 });
  }
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ ok: false, code: 'invalid', error: '無効なコードです' }, { status: 410 });
  }
  if (Number(coupon.used_count) >= Number(coupon.max_uses)) {
    return NextResponse.json({ ok: false, code: 'exhausted', error: '使用上限に達したコードです' }, { status: 429 });
  }

  // ===== 使用記録を先にinsert（PK重複=このユーザーは使用済み。二重適用の同時リクエストもここで弾ける） =====
  const ins = await svc.from('coupon_redemptions').insert({ user_id: user.id, code });
  if (ins.error) {
    if (ins.error.code === '23505') {
      return NextResponse.json({ ok: false, code: 'already_used', error: 'このアカウントでは使用済みです' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: 'コードを適用できませんでした。時間をおいてもう一度お試しください。' }, { status: 500 });
  }

  // ===== プラン付与（無期限=plan_until: null） =====
  const upd = await svc.from('profiles').update({ plan: coupon.plan, plan_until: null }).eq('id', user.id);
  if (upd.error) {
    // 付与に失敗したら使用記録を戻す（コードを無駄に消費させない）
    await svc.from('coupon_redemptions').delete().eq('user_id', user.id).eq('code', code);
    return NextResponse.json({ ok: false, error: 'コードを適用できませんでした。時間をおいてもう一度お試しください。' }, { status: 500 });
  }

  // 使用数のカウントアップ（ベストエフォート。厳密な同時制御より台帳の単純さを優先）
  await svc.from('coupon_codes').update({ used_count: Number(coupon.used_count) + 1 }).eq('code', code);

  console.log(`[redeem-coupon] uid=${user.id} code=${code} → plan=${coupon.plan}`);
  return NextResponse.json({ ok: true, plan: coupon.plan });
}
