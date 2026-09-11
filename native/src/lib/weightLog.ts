// 体重の保存本体（2026-09-10・＋ボタンの全タブ化に伴い log.tsx から切り出し）
//
// 呼び出し元は3つ: 食事タブの体重カード／＋シートの「体重」2段目（全タブ）／（将来）ウィジェット。
// どこから呼んでも同じ規則で保存されるように、判定と書き込みをここに1本化する。
//   ・入力は表示単位（kg/lb）の文字列。DBは常にkg（小数1桁）で保存する
//   ・数値の読み取りは lib/parseNum.parseDecimal に一本化（全角・カンマ小数・単位つき。QA B-1）
//   ・範囲は lib/guard.WEIGHT_RANGE が正本（入力口ごとに閾値がズレないため。QA B-2）
//   ・G8: 前回から±15%以上ずれた値は保存前に一度だけ確認する（lib/guard.ts confirmOutlierWeight）
//   ・保存後は同日の entries を同期（体重グラフ・概要の要約行が同じ値を見る）
// 副作用（Supabase・Alert）は deps で差し替えられるので jest では純関数として検証できる。
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';
import { confirmOutlierWeight, inWeightRange } from '@/lib/guard';
import { parseDecimal } from '@/lib/parseNum';
import { displayToKg, type WeightUnit } from '@/lib/units';
import { t } from '@/lib/i18n';

/** 表示単位の入力文字列を kg に直す。範囲外・数値でないなら null */
export function parseWeightInput(text: string, unit: WeightUnit): number | null {
  const n = parseDecimal(text);
  if (n == null) return null;
  const kg = displayToKg(n, unit);
  return inWeightRange(kg) ? Math.round(kg * 10) / 10 : null;
}

export type SaveWeightResult =
  | { ok: true; kg: number }
  /** msg: ''=本人が取り消した（何も出さない）／文字列=画面に出すエラー文 */
  | { ok: false; msg: string };

export type SaveWeightDeps = {
  uid: string | null | undefined;
  /** 記録先の日付（YYYY-MM-DD・JST）。食事タブは表示中の日付、他タブは今日 */
  date: string;
  unit: WeightUnit;
  /** 外れ値判定の基準（直近の体重kg）。無ければ確認なし */
  latestWeight: number | null | undefined;
  // ↓ テスト用の差し替え口（既定は本番の実装）
  confirm?: (prev: number | null | undefined, next: number) => Promise<boolean>;
  insert?: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  sync?: (uid: string, date: string) => Promise<unknown>;
};

/** logs に体重だけの行を1件挿入する（items 空・ex 'オフ'＝食事でも運動でもない行。従来どおり） */
export function weightOnlyRow(uid: string, date: string, kg: number): Record<string, unknown> {
  return {
    user_id: uid, date, items: [], kcal: null, p: null, f: null, c: null,
    weight: kg, ex: 'オフ', adj: 0, mood: '', text: '', photo_urls: [],
  };
}

export async function saveWeightEntry(text: string, deps: SaveWeightDeps): Promise<SaveWeightResult> {
  const kg = parseWeightInput(text, deps.unit);
  if (!deps.uid || kg == null) return { ok: false, msg: t('体重の値を確認してください。') };
  const confirm = deps.confirm ?? confirmOutlierWeight;
  if (!(await confirm(deps.latestWeight, kg))) return { ok: false, msg: '' };
  const insert = deps.insert ?? (async (row: Record<string, unknown>) => {
    const { error } = await supabase.from('logs').insert(row);
    return { error };
  });
  const { error } = await insert(weightOnlyRow(deps.uid, deps.date, kg));
  if (error) return { ok: false, msg: t('保存に失敗しました。もう一度お試しください。') };
  const sync = deps.sync ?? syncEntriesForDate;
  try { await sync(deps.uid, deps.date); } catch { /* 同期の失敗は保存の成否に含めない（次回の読込で追いつく） */ }
  return { ok: true, kg };
}
