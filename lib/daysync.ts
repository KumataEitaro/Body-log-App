// 1日分のlogs→entries（日次サマリー）同期。入力ページとトレーニングページで共用。
import type { SupabaseClient } from '@supabase/supabase-js';
import { summarizeDay, type LogRow } from '@/lib/day';
import { healthPushDay } from '@/lib/health';
import { cacheSet } from '@/lib/cache';

// waist列がまだ無い環境（migration-13未適用）でも壊れないよう、waistを除いたコピーを返す
export function stripWaist<T extends Record<string, unknown>>(o: T): T {
  const { waist: _w, ...rest } = o;
  return rest as T;
}
export function isMissingWaist(msg: string | undefined): boolean {
  return !!msg && /waist/i.test(msg);
}

/** その日のlogsを集計してentriesへ反映し、その日のlogs行を返す（ダッシュボードはentriesを見る） */
export async function syncEntriesForDate(
  supabase: SupabaseClient, userId: string, d: string,
): Promise<(LogRow & { id: string; at: string })[]> {
  const { data: logs } = await supabase.from('logs').select('*').eq('date', d).order('at', { ascending: true });
  const rows = (logs as (LogRow & { id: string; at: string })[]) || [];
  if (logs !== null && rows.length === 0) {
    await supabase.from('entries').delete().eq('user_id', userId).eq('date', d);
  } else if (rows.length > 0) {
    const s = summarizeDay(rows);
    const entryRow = {
      user_id: userId, date: d,
      ex: s.ex, adj: s.adj,
      intake: s.intake, p: s.p, f: s.f, c: s.c,
      weight: s.weight, waist: s.waist, mood: s.mood, note: '',
      food_text: s.food_text.slice(0, 2000), photo_urls: s.photo_urls,
    };
    let { error: eErr } = await supabase.from('entries').upsert(entryRow, { onConflict: 'user_id,date' });
    if (eErr && isMissingWaist(eErr.message)) {
      ({ error: eErr } = await supabase.from('entries').upsert(stripWaist(entryRow), { onConflict: 'user_id,date' }));
    }
    // ヘルスケア連携がONなら、その日のサマリーを書き出す（ネイティブ・許可時のみ・無害）
    healthPushDay({ date: d, weight: s.weight, waist: s.waist, energy: s.intake, protein: s.p, fat: s.f, carbs: s.c });
  }
  if (logs !== null) cacheSet(`logs:${userId}:${d}`, { logs: rows, entry: null });
  return rows;
}
