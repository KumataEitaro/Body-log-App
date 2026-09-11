import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { isAdmin, todayJST } from '@/lib/calc';

// 管理者専用: 全ユーザーの利用状況サマリー
// プライバシー方針: 体写真・食事メモの中身は返さない（アプリ内で「本人以外見られない」と明言しているため）
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // 認可は isAdmin（UNLIMITED_EMAILS の照合のみ）で行う。
  // **AI利用上限の免除判定を認可に流用しないこと**: あちらは AI_LIMITS_ENABLED=false の間
  // 全員 true を返す短絡を持つため、このAPIが全ログインユーザーに開いていた（QA P0-1・2026-09-10）。
  // tests/adminAuth.test.ts が「app/api/admin/** にあの識別子が現れたら fail」で機械的に止める。
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ ok: false, error: '権限がありません。' }, { status: 403 });
  }

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) {
    return NextResponse.json({
      ok: false,
      error: 'サーバーに SUPABASE_SERVICE_ROLE_KEY が未設定です。Supabaseの Project Settings → API Keys の secret キーを、Vercelの環境変数に追加して再デプロイしてください。',
    }, { status: 500 });
  }

  try {
    const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [usersRes, profilesRes, goalsRes, entriesRes, usageRes, photosRes] = await Promise.all([
      svc.auth.admin.listUsers({ page: 1, perPage: 500 }),
      svc.from('profiles').select('id,display_name'),
      svc.from('goals').select('user_id,target_date,target_weight,start_date,start_weight'),
      svc.from('entries').select('user_id,date,weight,intake'),
      svc.from('ai_usage').select('user_id,date,count'),
      svc.from('body_photos').select('user_id,date'), // 枚数と最終日のみ（画像は返さない）
    ]);
    if (usersRes.error) throw new Error(usersRes.error.message);

    const today = todayJST();
    const profiles = profilesRes.data || [];
    const goals = goalsRes.data || [];
    const entries = entriesRes.data || [];
    const usage = usageRes.data || [];
    const photos = photosRes.data || [];

    const users = usersRes.data.users.map((u) => {
      const prof = profiles.find((p) => p.id === u.id);
      const goal = goals.find((g) => g.user_id === u.id);
      const ents = entries.filter((e) => e.user_id === u.id).sort((a, b) => (a.date < b.date ? -1 : 1));
      const weights = ents.filter((e) => e.weight != null);
      const firstW = weights.length ? Number(weights[0].weight) : null;
      const lastW = weights.length ? Number(weights[weights.length - 1].weight) : null;
      const myUsage = usage.filter((x) => x.user_id === u.id);
      const myPhotos = photos.filter((x) => x.user_id === u.id);
      return {
        email: u.email || '(不明)',
        name: prof?.display_name || '',
        signedUp: (u.created_at || '').slice(0, 10),
        lastSignIn: (u.last_sign_in_at || '').slice(0, 10),
        recordDays: ents.filter((e) => e.intake != null).length,
        lastRecord: ents.length ? ents[ents.length - 1].date : null,
        firstWeight: firstW,
        latestWeight: lastW,
        deltaKg: firstW != null && lastW != null ? Math.round((lastW - firstW) * 10) / 10 : null,
        goal: goal && goal.target_weight != null ? `${goal.target_date}までに${goal.target_weight}kg` : null,
        aiToday: myUsage.find((x) => x.date === today)?.count ?? 0,
        aiTotal: myUsage.reduce((a, x) => a + (Number(x.count) || 0), 0),
        photoCount: myPhotos.length,
        lastPhoto: myPhotos.length ? myPhotos.map((p) => p.date).sort().slice(-1)[0] : null,
      };
    }).sort((a, b) => (a.lastRecord ?? '') < (b.lastRecord ?? '') ? 1 : -1);

    return NextResponse.json({ ok: true, users, generatedAt: today });
  } catch (e) {
    // 例外の生文字列は返さない（テーブル名・接続文字列・service roleの失敗理由が漏れる）。
    // 原因はサーバーログにだけ残し、クライアントへは固定文言を返す（QA P0-1 修正案3）
    console.error('[admin/overview]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: '集計に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
  }
}
