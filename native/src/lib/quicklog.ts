// クイック記録の共通ロジック: 「AI解析」と「保存」を分離
// （解析結果はまずステージングトレイに積まれ、ユーザーが✓保存で確定するまでDBに書かない）
import { apiPost } from './api';
import { supabase } from './supabase';
import { syncEntriesForDate } from './sync';
import { sumItems, type FoodItem } from './items';
import { todayJST, type ExLevel } from './calc';
import { t, apiLang } from './i18n';

export type QuickImage = { data: string; mime: string };

/**
 * AIの会話的な返し（表示のみ。DBには書かない）
 * dietFlags = 食事の制約（B-18）のAI判定。品目名→強さ。
 * FoodItemには持たせない（logs.itemsに推定の判定が焼き付くのを避ける・
 * 判定はあくまで解析したその場の警告で、記録の一部ではない）。
 */
export type ParsedExtras = {
  reply: string; questions: string[]; assumptions: string[];
  dietFlags: Record<string, 'high' | 'maybe'>;
};
export type ParseTurn = { role: 'user' | 'ai'; text: string };
export type ParsedResult = {
  items: FoodItem[];
  weight: number | null;
  waist: number | null;
  ex: ExLevel | null;
  adj: number;
  mood: string | null;
};

/** プラン上限（429 plan_limit）で止まった種類。ペイウォールの文脈src（limit_text等）に使う */
export type LimitKind = 'text' | 'photo' | 'coach';

// テキスト/写真をAIで解析（保存はしない）
export async function analyzeFood(
  text: string, images: QuickImage[], history: ParseTurn[] = [],
): Promise<{ ok: true; result: ParsedResult; extras: ParsedExtras } | { ok: false; error: string; upgrade?: boolean; kind?: LimitKind }> {
  const { ok, json, failure } = await apiPost<{ ok: boolean; error?: string; code?: string; kind?: string; result?: {
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
    // プラン上限（code:'plan_limit'）はアップグレード導線を出す合図。kindで文脈srcを出し分ける
    const upgrade = json?.code === 'plan_limit';
    const kind = json?.kind === 'photo' ? 'photo' as const : 'text' as const;
    return { ok: false, error: json?.error || t('解析に失敗しました。もう一度お試しください。'), upgrade, kind: upgrade ? kind : undefined };
  }
  const r = json.result;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 4) : []);
  // 食事の制約（B-18）: AIが品目に付けた dietFlag を items から外して extras に移す。
  // high/maybe だけ拾い、none・未知値は落とす（「該当なし」を値として持たない・§6）
  const dietFlags: Record<string, 'high' | 'maybe'> = {};
  const items: FoodItem[] = (r.items || []).map((it) => {
    const { dietFlag, ...rest } = it as FoodItem & { dietFlag?: unknown };
    if ((dietFlag === 'high' || dietFlag === 'maybe') && typeof rest.name === 'string') {
      dietFlags[rest.name] = dietFlag;
    }
    return rest as FoodItem;
  });
  return {
    ok: true,
    result: {
      items,
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
      dietFlags,
    },
  };
}

// ステージング内容をログとして確定保存（dateを渡せば過去日にも記録できる。省略時=今日）
/**
 * トレイの内容を logs に1行 insert。
 * @param at 食べた時刻（UTCのISO・トレイの「食べた時間」チップで組む）。省略/nullなら
 *           DBの now()（＝「いま」）。過去日に現在時刻を入れないため、過去日は呼び出し側が必ず渡す
 */
export async function saveParsed(uid: string, p: ParsedResult, note: string, date?: string, at?: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const total = sumItems(p.items);
  const hasMeal = p.items.length > 0;
  const today = date || todayJST();
  const { error } = await supabase.from('logs').insert({
    user_id: uid, date: today,
    ...(at ? { at } : {}),
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
