// クイック記録: テキスト/写真 → AI解析 → そのまま今日のログに保存（LINE風の連投入力用）
// 食事タブのボトムドックと、他タブのFABハーフモーダルで共用する
import { apiPost } from './api';
import { supabase } from './supabase';
import { syncEntriesForDate } from './sync';
import { sumItems, type FoodItem } from './items';
import { todayJST, type ExLevel } from './calc';

export type QuickImage = { data: string; mime: string };

export async function quickLog(uid: string, text: string, images: QuickImage[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ok, json } = await apiPost<{ ok: boolean; error?: string; result?: { items?: FoodItem[]; weight?: number; waist?: number; ex?: string; adj?: number; mood?: string } }>(
    '/api/parse-food', { text, lang: 'ja', images });
  if (!ok || !json?.ok || !json.result) {
    return { ok: false, error: json?.error || '解析に失敗しました。もう一度お試しください。' };
  }
  const r = json.result;
  const items = r.items || [];
  const total = sumItems(items);
  const hasMeal = items.length > 0;
  const today = todayJST();
  const { error } = await supabase.from('logs').insert({
    user_id: uid, date: today,
    items,
    kcal: hasMeal ? total.kcal : null,
    p: hasMeal ? total.p : null, f: hasMeal ? total.f : null, c: hasMeal ? total.c : null,
    weight: r.weight ?? null, waist: r.waist ?? null,
    ex: (r.ex as ExLevel) ?? 'オフ', adj: Number(r.adj) || 0, mood: r.mood || '',
    text, photo_urls: [],
  });
  if (error) return { ok: false, error: '保存に失敗しました。もう一度お試しください。' };
  await syncEntriesForDate(uid, today);
  return { ok: true };
}
