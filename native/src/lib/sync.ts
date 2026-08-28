// 1日分のlogs→entries（日次サマリー）同期。Web版 lib/daysync.ts のRN移植（ヘルスケア書出しはPhase 1bで追加）。
import { supabase } from '@/lib/supabase';
import { summarizeDay, type LogRow } from '@/lib/day';
import { skipTodayReminder } from '@/lib/notify';
import { todayJST } from '@/lib/calc';

export async function syncEntriesForDate(userId: string, d: string): Promise<(LogRow & { id: string; at: string })[]> {
  // 今日のぶんを記録したら、今夜の記録リマインダーは黙る（smartモードの中核。
  // ここは全保存経路の合流点なので、食事・体重・運動・取込のどれでも効く）
  if (d === todayJST()) skipTodayReminder().catch(() => {});
  const { data: logs } = await supabase.from('logs').select('*').eq('date', d).order('at', { ascending: true });
  const rows = (logs as (LogRow & { id: string; at: string })[]) || [];
  if (logs !== null && rows.length === 0) {
    await supabase.from('entries').delete().eq('user_id', userId).eq('date', d);
  } else if (rows.length > 0) {
    const s = summarizeDay(rows);
    await supabase.from('entries').upsert({
      user_id: userId, date: d,
      ex: s.ex, adj: s.adj,
      intake: s.intake, p: s.p, f: s.f, c: s.c,
      weight: s.weight, waist: s.waist, mood: s.mood, note: '',
      food_text: s.food_text.slice(0, 2000), photo_urls: s.photo_urls,
    }, { onConflict: 'user_id,date' });
  }
  return rows;
}
