// 「食事の制約（除外アラート・B-18）」の存在を食事タブで知らせる案内の出現判定。
//
// 背景: 機能は設定の奥（マイページ→食べないものを登録する）にあり、βでは
// 「そんな機能があると知らなかった」が続いた。オンボーディングには入れない方針
// （docs/DIET-MODES.md §3: 初回の負荷を増やす／同意を流し読みさせたくない）なので、
// **食事入力の文脈で・まだ設定していない人にだけ・1回だけ**声をかける。
//
// 出す条件（すべて満たすときだけ）:
//   1. 制約が未設定（modes空 かつ custom空）
//   2. AI解析（写真・テキスト）を累計3回以上使っている＝「読み取り」の体験があり、
//      「読み取ったときに教えてくれる」という説明が通じる
//   3. まだ一度も出していない（'bl-diet-tip-shown'）
//   4. 一度断られていない（'bl-diet-tip-declined'・二度と出さない）
//
// 免責について: この案内は「機能の存在を知らせる」だけで、安全確認の役に立つとは
// 一言も言わない。文言側（log.tsx の SpotlightTip）に DietNotes.tsx と整合した
// 「※ 表示は推定です。安全確認には使えません。」を必ず添える（§6-3の現場免責と同じ作法）。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { DietProfile } from './diet';

const SHOWN_KEY = 'bl-diet-tip-shown';
const DECLINED_KEY = 'bl-diet-tip-declined';

/** これだけAI解析を使っていれば「読み取り」の説明が通じる、という下限 */
const NEED_AI_USES = 3;

/** ai_usage は1日1行なので、3回に届くかを見るだけならこの行数で足りる */
const USAGE_ROWS = 10;

/** 制約が1つも登録されていない（＝案内の対象）か。同意済みかは問わない */
export function isDietUnset(p: DietProfile | null | undefined): boolean {
  if (!p) return true;
  return p.modes.length === 0 && !p.custom.trim();
}

/** ai_usage の行から、AI解析（テキスト＋写真）の回数を合計する（純関数・テスト用） */
export function sumAiUses(rows: { text_count?: number | null; photo_count?: number | null }[] | null | undefined): number {
  if (!rows) return 0;
  return rows.reduce((n, r) => n + (Number(r.text_count) || 0) + (Number(r.photo_count) || 0), 0);
}

/** 回数が下限に届いているか（純関数・テスト用） */
export function hasEnoughAiUses(uses: number): boolean {
  return uses >= NEED_AI_USES;
}

/**
 * 案内を出すべきか。
 * 端末内のフラグを先に見るので、**一度出した／断られたあとはクエリを投げない**
 * （新規クエリは、対象になり得る人の1セッションに1回だけ走る）。
 */
export async function shouldShowDietTip(p: DietProfile | null | undefined): Promise<boolean> {
  if (!isDietUnset(p)) return false;
  try {
    const [shown, declined] = await Promise.all([
      AsyncStorage.getItem(SHOWN_KEY),
      AsyncStorage.getItem(DECLINED_KEY),
    ]);
    if (shown != null || declined != null) return false;
  } catch {
    return false;   // 端末フラグが読めないときは出さない（何度も出す方が害が大きい）
  }
  try {
    const { data, error } = await supabase.from('ai_usage').select('text_count,photo_count').limit(USAGE_ROWS);
    if (error) return false;
    return hasEnoughAiUses(sumAiUses(data as { text_count?: number | null; photo_count?: number | null }[] | null));
  } catch {
    return false;
  }
}

/** 出したことを記録する（表示は1回だけ） */
export async function markDietTipShown(): Promise<void> {
  try { await AsyncStorage.setItem(SHOWN_KEY, new Date().toISOString()); } catch { /* 案内の話なので無視 */ }
}

/** 「いまはしない」を押されたことを記録する（二度と出さない） */
export async function markDietTipDeclined(): Promise<void> {
  try { await AsyncStorage.setItem(DECLINED_KEY, new Date().toISOString()); } catch { /* 同上 */ }
}

// ===== テスト用 =====
export const _internal = { SHOWN_KEY, DECLINED_KEY, NEED_AI_USES, USAGE_ROWS };
