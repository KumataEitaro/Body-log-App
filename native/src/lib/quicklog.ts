// クイック記録の共通ロジック: 「AI解析」と「保存」を分離
// （解析結果はまずステージングトレイに積まれ、ユーザーが✓保存で確定するまでDBに書かない）
import { apiPost } from './api';
import { supabase } from './supabase';
import { syncEntriesForDate } from './sync';
import { sumItems, type FoodItem } from './items';
import { todayJST, type ExLevel } from './calc';
import { t, apiLang } from './i18n';

export type QuickImage = { data: string; mime: string };

/** AIの会話的な返し（表示のみ。DBには書かない） */
export type ParsedExtras = { reply: string; questions: string[]; assumptions: string[] };
export type ParseTurn = { role: 'user' | 'ai'; text: string };
export type ParsedResult = {
  items: FoodItem[];
  weight: number | null;
  waist: number | null;
  ex: ExLevel | null;
  adj: number;
  mood: string | null;
};

// テキスト/写真をAIで解析（保存はしない）
export async function analyzeFood(
  text: string, images: QuickImage[], history: ParseTurn[] = [],
): Promise<{ ok: true; result: ParsedResult; extras: ParsedExtras } | { ok: false; error: string }> {
  const { ok, json, failure } = await apiPost<{ ok: boolean; error?: string; result?: {
    items?: FoodItem[]; weight?: number; waist?: number; ex?: string; adj?: number; mood?: string;
    reply?: string; questions?: string[]; assumptions?: string[];
  } }>('/api/parse-food', { text, lang: apiLang(), images, history });
  if (!ok || !json?.ok || !json.result) {
    // 何が起きたかで文言を変える。原因が分かれば次の行動が決まる
    if (failure === 'timeout') {
      return { ok: false, error: t('時間内に解析できませんでした。文章を短くするか、もう一度お試しください。') };
    }
    if (failure === 'offline') {
      return { ok: false, error: t('通信できませんでした。電波状況を確認してもう一度お試しください。') };
    }
    return { ok: false, error: json?.error || t('解析に失敗しました。もう一度お試しください。') };
  }
  const r = json.result;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 4) : []);
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
    extras: {
      reply: typeof r.reply === 'string' ? r.reply.slice(0, 300) : '',
      questions: strs(r.questions),
      assumptions: strs(r.assumptions),
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
  if (error) return { ok: false, error: t('保存に失敗しました。もう一度お試しください。') };
  await syncEntriesForDate(uid, today);
  return { ok: true };
}
