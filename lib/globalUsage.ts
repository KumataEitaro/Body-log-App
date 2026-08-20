import { createClient as createServiceClient } from '@supabase/supabase-js';
import { AI_LIMITS_ENABLED, GLOBAL_AI_DAILY_CAP, todayJST } from '@/lib/calc';

// 60秒キャッシュ（毎リクエストの全行スキャンを避ける。上限判定は1分の遅延を許容）
let capCache = { t: 0, v: false };

// 全ユーザー合計の当日AI使用回数が上限に達しているか（課金の安全弁）
// service roleキーがある本番でのみ有効。無い環境（ローカル等）はスキップ=falseを返す。
export async function globalCapReached(): Promise<boolean> {
  if (!AI_LIMITS_ENABLED) return false;   // 上限撤廃中は全体上限も見ない（集計クエリ自体を省く）
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) return false;
  if (Date.now() - capCache.t < 60_000) return capCache.v;
  try {
    const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await svc.from('ai_usage').select('count').eq('date', todayJST());
    const total = (data || []).reduce((a, r) => a + (Number(r.count) || 0), 0);
    capCache = { t: Date.now(), v: total >= GLOBAL_AI_DAILY_CAP };
    return capCache.v;
  } catch {
    return false; // 集計に失敗しても解析自体は止めない
  }
}
