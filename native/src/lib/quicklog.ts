// クイック記録の共通ロジック: 「AI解析」と「保存」を分離
// （解析結果はまずステージングトレイに積まれ、ユーザーが✓保存で確定するまでDBに書かない）
import { apiPost } from './api';
import { supabase } from './supabase';
import { syncEntriesForDate } from './sync';
import { sumItems, type FoodItem } from './items';
import { todayJST, type ExLevel } from './calc';

export type QuickImage = { data: string; mime: string };
export type ParsedResult = {
  items: FoodItem[];
  weight: number | null;
  waist: number | null;
  ex: ExLevel | null;
  adj: number;
  mood: string | null;
};

// テキスト/写真をAIで解析（保存はしない）
export async function analyzeFood(text: string, images: QuickImage[]): Promise<{ ok: true; result: ParsedResult } | { ok: false; error: string }> {
  const { ok, json } = await apiPost<{ ok: boolean; error?: string; result?: { items?: FoodItem[]; weight?: number; waist?: number; ex?: string; adj?: number; mood?: string } }>(
    '/api/parse-food', { text, lang: 'ja', images });
  if (!ok || !json?.ok || !json.result) {
    return { ok: false, error: json?.error || '解析に失敗しました。もう一度お試しください。' };
  }
  const r = json.result;
  return {
    ok: true,
    result: {
      items: r.items || [],
      weight: r.weight ?? null,
      waist: r.waist ?? null,
      ex: (r.ex as ExLevel) ?? null,
      adj: Number(r.adj) || 0,
      mood: r.mood ?? null,
    },
  };
}

// ステージング内容をログとして確定保存（dateを渡せば過去日にも記録できる。省略時=今日）
export async function saveParsed(uid: string, p: ParsedResult, note: string, date?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const total = sumItems(p.items);
  const hasMeal = p.items.length > 0;
  const today = date || todayJST();
  const { error } = await supabase.from('logs').insert({
    user_id: uid, date: today,
    items: p.items,
    kcal: hasMeal ? total.kcal : null,
    p: hasMeal ? total.p : null, f: hasMeal ? total.f : null, c: hasMeal ? total.c : null,
    weight: p.weight, waist: p.waist,
    ex: p.ex ?? 'オフ', adj: p.adj, mood: p.mood || '',
    text: note, photo_urls: [],
  });
  if (error) return { ok: false, error: '保存に失敗しました。もう一度お試しください。' };
  await syncEntriesForDate(uid, today);
  return { ok: true };
}
