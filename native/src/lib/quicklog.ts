// クイック記録の共通ロジック: 「AI解析」と「保存」を分離
// （解析結果はまずステージングトレイに積まれ、ユーザーが✓保存で確定するまでDBに書かない）
import { apiPost } from './api';
import { supabase } from './supabase';
import { syncEntriesForDate } from './sync';
import { enqueue, isNetworkError, isPermissionError } from './offlineQueue';
import { sumItems, type FoodItem } from './items';
import { todayJST, EX_LEVELS, type ExLevel } from './calc';
import { t, apiLang } from './i18n';
import { looksAlcoholic } from './alcohol';
import { isMissingMigration38Column } from './migration38';

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

/**
 * 保存の結果（2026-09-14）。
 *  { ok: true }                → DBに入った
 *  { ok: true, queued: true }  → 圏外なので端末のキューに積んだ。電波が戻ったら自動で送る
 *  { ok: false, error }        → DBに拒否された。error には**理由の本文**が入る
 */
export type SaveOutcome = { ok: true; queued?: boolean } | { ok: false; error: string };

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
export async function saveParsed(
  uid: string, p: ParsedResult, note: string, date?: string, at?: string | null,
  opts?: { queueOffline?: boolean },
): Promise<SaveOutcome> {
  const total = sumItems(p.items);
  const hasMeal = p.items.length > 0;
  const today = date || todayJST();
  // logs.ex には check 制約（オフ/軽い/通常/高/特大）がある。AIが範囲外の値
  // （'中'・'moderate' 等）を返すと、その1語のために**食事まるごと**が保存できない。
  // 運動の強度は食事の記録の主役ではないので、読めない値は黙って「オフ」に落とす（2026-09-14）
  const ex: ExLevel = p.ex != null && (EX_LEVELS as readonly string[]).includes(p.ex) ? p.ex : 'オフ';
  const row: Record<string, unknown> & { user_id: string; date: string } = {
    user_id: uid, date: today,
    ...(at ? { at } : {}),
    items: p.items,
    kcal: hasMeal ? total.kcal : null,
    p: hasMeal ? total.p : null, f: hasMeal ? total.f : null, c: hasMeal ? total.c : null,
    weight: p.weight, waist: p.waist,
    ex, adj: p.adj, mood: p.mood || '',
    text: note, photo_urls: [],
    // お酒の自動推定（migration-38・過食アラート v2）。true のときだけ列を書く＝お酒の無い保存は旧DBでも今までどおり通る
    ...(looksAlcoholic(p.items) ? { alcohol: true } : {}),
  };

  let error: { message: string; code?: string } | null = null;
  try {
    ({ error } = await supabase.from('logs').insert(row));
    // alcohol 列が無い旧DB（migration-38 未適用）: 印だけ諦めて食事そのものは保存する
    if (error && 'alcohol' in row && isMissingMigration38Column(error)) {
      delete row.alcohol;
      ({ error } = await supabase.from('logs').insert(row));
    }
  } catch (e) {
    // supabase-js は普通 { error } を返すが、fetch 自体が投げることがある（圏外・DNS失敗）
    error = { message: String((e as Error)?.message ?? e) };
  }
  if (!error) {
    await syncEntriesForDate(uid, today);
    return { ok: true };
  }

  // 圏外: 端末のキューに積んで、電波が戻ったら自動で送る（運動タブと同じ流儀）。
  // 以前はここで「保存に失敗しました」と出すだけで、**書いた食事がそのまま失われていた**。
  //
  // 記録の**書き換え**（editingId あり）のときだけ queueOffline: false で呼ぶ。
  // 書き換えは「新しい行を入れてから古い行を消す」順なので、新しい行がキューの中にある間に
  // 古い行を消すと、キューが送れなかった場合にその食事が消える。圏外では書き換えを断る方が安全
  if (isNetworkError(error)) {
    if (opts?.queueOffline === false) {
      return { ok: false, error: t('通信できませんでした。電波が届くところで、もう一度お試しください。') };
    }
    await enqueue(row);
    return { ok: true, queued: true };
  }
  return { ok: false, error: saveErrorText(error.message) };
}

/**
 * 保存できなかった理由を、本人が次の行動を選べる文にする（2026-09-14）。
 *
 * 以前は理由を問わず「保存に失敗しました。もう一度お試しください。」の一文だけで、
 * 何度押しても同じ結果になる原因（ログイン切れ・DBの列不足）でも同じ文言だった。
 * 体の写真で同じ問題を踏んだときと同じく、**DBのエラー本文を必ず添える**。
 * 原因の切り分けがユーザーの1回の報告で終わる。
 */
export function saveErrorText(message: string): string {
  if (isPermissionError({ message })) {
    return t('ログインの有効期限が切れているようです。アプリを開き直すか、ログインし直してから、もう一度保存してください。（{msg}）', { msg: message });
  }
  if (/column|schema cache|does not exist/i.test(message)) {
    return t('データベースの更新が未適用のようです。この文言をそのまま開発者に伝えてください。（{msg}）', { msg: message });
  }
  return t('保存に失敗しました。（{msg}）', { msg: message });
}
