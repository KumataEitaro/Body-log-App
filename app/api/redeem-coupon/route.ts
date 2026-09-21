import { NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/supabase/apiAuth';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { todayJST } from '@/lib/calc';

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

  // ===== 試行回数の上限（QA C-3・2026-09-18）=====
  // クーポンは「無期限の有料プランを付与する持参人式のクレデンシャル」。総当たりと
  // 「有効/期限切れ/上限」を返事で見分ける行為を止めるため、1人1日20回で打ち切り、
  // 失敗の理由は一律「無効なコードです」に寄せる（下の分岐も同じ文言・同じ 400）
  const today = todayJST();
  const { data: att } = await svc.from('coupon_attempts').select('count').eq('user_id', user.id).eq('date', today).maybeSingle();
  const attempts = Number(att?.count ?? 0);
  if (attempts >= 20) {
    return NextResponse.json({ ok: false, code: 'invalid', error: '無効なコードです' }, { status: 400 });
  }
  await svc.from('coupon_attempts').upsert({ user_id: user.id, date: today, count: attempts + 1 }).then(() => {}, () => {});

  // ===== コードの検証（存在・プラン・期限・使用上限） =====
  const { data: coupon, error: cErr } = await svc.from('coupon_codes')
    .select('code,plan,max_uses,used_count,expires_at').eq('code', code).maybeSingle();
  // テーブル未作成（migration-23未適用）もユーザーには「無効なコード」として静かに返す
  // 無効・期限切れ・使用上限を**区別しない**（QA C-3）。区別すると「存在するが期限切れ」が推測できる
  if (cErr || !coupon || !COUPON_PLANS.includes(String(coupon.plan))
    || (coupon.expires_at && new Date(coupon.expires_at).getTime() <= Date.now())
    || Number(coupon.used_count) >= Number(coupon.max_uses)) {
    return NextResponse.json({ ok: false, code: 'invalid', error: '無効なコードです' }, { status: 400 });
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

  // コードは持参人式のクレデンシャルなのでログに残さない（先頭2文字と長さだけ・QA C-2）
  console.log(`[redeem-coupon] uid=${user.id} code=${code.slice(0, 2)}…(${code.length}) → plan=${coupon.plan}`);
  return NextResponse.json({ ok: true, plan: coupon.plan });
}
