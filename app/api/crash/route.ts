import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// UUID v4 の厳密な形（以前の /^[0-9a-f-]{36}$/ は「------…」も通した・QA C-5）
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// アプリのクラッシュ・描画エラーの受け口（自前クラッシュ計測）。
// 認証は要求しない（クラッシュはログイン前にも起きる）。その代わり:
//  ・ペイロードを厳しく切り詰める（濫用されても被害が知れている）
//  ・書き込みはservice role経由のみ（テーブルにanonのRLSポリシーは無い）
export const preferredRegion = 'hnd1';

export async function POST(req: Request) {
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!svcKey || !url) return NextResponse.json({ ok: false }, { status: 500 });

  const body = await req.json().catch(() => null) as {
    platform?: string; app_version?: string; fatal?: boolean;
    name?: string; message?: string; stack?: string; user_id?: string;
  } | null;
  if (!body?.message) return NextResponse.json({ ok: false }, { status: 400 });

  const svc = createClient(url, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // user_id は body の値をそのまま信用しない（QA C-5）。Authorization: Bearer があればトークンから本人を取り、
  // 無ければ null（ログイン前のクラッシュ）。他人の uid を名乗って別人の記録に見せる経路を塞ぐ
  let userId: string | null = null;
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await anon.auth.getUser(auth.slice(7));
      if (data.user?.id && UUID_RE.test(data.user.id)) userId = data.user.id;
    } catch { /* 取れなければ匿名扱い */ }
  }
  // insert失敗（テーブル未作成等）を握りつぶすと「計測できているつもり」になる。失敗は失敗と返す
  const { error } = await svc.from('crash_reports').insert({
    platform: String(body.platform ?? '').slice(0, 16),
    app_version: String(body.app_version ?? '').slice(0, 32),
    fatal: body.fatal === true,
    name: String(body.name ?? 'unknown').slice(0, 120),
    message: String(body.message).slice(0, 500),
    stack: String(body.stack ?? '').slice(0, 4000),
    user_id: userId,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
