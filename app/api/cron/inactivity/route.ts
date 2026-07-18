import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { todayJST } from '@/lib/calc';
import { daysBetween } from '@/lib/goal';

const APP_URL = 'https://bodylog-orcin.vercel.app';
const IDLE_DAYS = 3;      // この日数記録がなければアラート
const REMIND_EVERY = 3;   // 同じ人への再送は最短この日数おき

// 毎日0:00 UTC（9:00 JST）にVercel Cronから呼ばれる。
// 3日以上記録がないユーザーへ「記録をつけましょう」メールを送る。
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) return NextResponse.json({ ok: false, error: 'no service key' }, { status: 500 });

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const today = todayJST();

  const [usersRes, entriesRes, profilesRes] = await Promise.all([
    svc.auth.admin.listUsers({ page: 1, perPage: 500 }),
    svc.from('entries').select('user_id,date'),
    svc.from('profiles').select('id,display_name,last_inactivity_mail'),
  ]);
  if (usersRes.error) return NextResponse.json({ ok: false, error: usersRes.error.message }, { status: 500 });
  const entries = entriesRes.data || [];
  const profiles = profilesRes.data || [];

  const results: Array<{ email: string; idle: number; sent: boolean; reason?: string }> = [];
  for (const u of usersRes.data.users) {
    if (!u.email) continue;
    const prof = profiles.find((p) => p.id === u.id);
    if (!prof) continue; // プロフィール未作成（使い始めていない）はスキップ

    const dates = entries.filter((e) => e.user_id === u.id).map((e) => e.date as string).sort();
    const lastDate = dates.length ? dates[dates.length - 1] : (u.created_at || '').slice(0, 10);
    if (!lastDate) continue;
    const idle = daysBetween(lastDate, today);
    if (idle < IDLE_DAYS) continue;

    const lastMail = prof.last_inactivity_mail as string | null;
    if (lastMail && daysBetween(lastMail, today) < REMIND_EVERY) {
      results.push({ email: u.email, idle, sent: false, reason: 'recently notified' });
      continue;
    }

    const sent = await sendMail(u.email, prof.display_name || '', idle);
    if (sent) await svc.from('profiles').update({ last_inactivity_mail: today }).eq('id', u.id);
    results.push({ email: u.email, idle, sent, reason: sent ? undefined : 'mail not configured or failed' });
  }
  return NextResponse.json({ ok: true, checked: usersRes.data.users.length, results });
}

// Brevo（無料枠300通/日）でメール送信。BREVO_API_KEY / ALERT_FROM_EMAIL が未設定なら送らない
async function sendMail(to: string, name: string, idleDays: number): Promise<boolean> {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;
  if (!key || !from) return false;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'BodyLog', email: from },
        to: [{ email: to }],
        subject: `【BodyLog】${idleDays}日間記録がありません 📝`,
        htmlContent:
          `<div style="font-family:sans-serif;line-height:1.7">` +
          `<p>${name ? name + 'さん、' : ''}こんにちは。BodyLogです。</p>` +
          `<p>最後の記録から<b>${idleDays}日</b>経ちました。記録の継続が目標達成の一番の近道です💪</p>` +
          `<p><a href="${APP_URL}/log" style="background:#0e8a7d;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">今日の記録をつける</a></p>` +
          `<p style="color:#888;font-size:12px">このメールは3日以上記録がない場合に自動送信されています。</p>` +
          `</div>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
