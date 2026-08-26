import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
  await svc.from('crash_reports').insert({
    platform: String(body.platform ?? '').slice(0, 16),
    app_version: String(body.app_version ?? '').slice(0, 32),
    fatal: body.fatal === true,
    name: String(body.name ?? 'unknown').slice(0, 120),
    message: String(body.message).slice(0, 500),
    stack: String(body.stack ?? '').slice(0, 4000),
    user_id: /^[0-9a-f-]{36}$/.test(String(body.user_id)) ? body.user_id : null,
  });
  return NextResponse.json({ ok: true });
}
