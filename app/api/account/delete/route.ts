import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// アカウント削除（App Storeガイドライン5.1.1(v)対応）
// 本人のみ実行可。写真の実ファイル→認証ユーザーの順に削除。
// DBの各テーブルは auth.users への外部キー（on delete cascade）で連鎖削除される。
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'ログインが必要です。' }, { status: 401 });

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) return NextResponse.json({ ok: false, error: 'サーバー設定エラー（管理者に連絡してください）。' }, { status: 500 });

  try {
    const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ストレージの実ファイル削除（meals=食事写真 / body=体写真）
    for (const bucket of ['meals', 'body']) {
      const { data: files } = await svc.storage.from(bucket).list(user.id, { limit: 1000 });
      if (files && files.length) {
        await svc.storage.from(bucket).remove(files.map((f) => `${user.id}/${f.name}`));
      }
    }

    // 認証ユーザー削除（profiles/entries/logs/goals/events/my_foods/ai_usage/body_photos はcascadeで消える）
    const { error } = await svc.auth.admin.deleteUser(user.id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
