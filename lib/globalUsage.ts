import { createClient as createServiceClient } from '@supabase/supabase-js';
import { GLOBAL_AI_DAILY_CAP, todayJST } from '@/lib/calc';

// 全ユーザー合計の当日AI使用回数が上限に達しているか（課金の安全弁）
// service roleキーがある本番でのみ有効。無い環境（ローカル等）はスキップ=falseを返す。
export async function globalCapReached(): Promise<boolean> {
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) return false;
  try {
    const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await svc.from('ai_usage').select('count').eq('date', todayJST());
    const total = (data || []).reduce((a, r) => a + (Number(r.count) || 0), 0);
    return total >= GLOBAL_AI_DAILY_CAP;
  } catch {
    return false; // 集計に失敗しても解析自体は止めない
  }
}
