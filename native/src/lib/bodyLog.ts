// ウエストと体脂肪率の保存本体（2026-09-18・体の数値を＋シートに統一）。
//
// 熊田さん「ウエストの入力も体重などと同じように入力できるようにして」
//         「体の写真保存はあきらめる。代わりに AI で測定した体脂肪率の保存のみ出来るように」
//
// 体重（lib/weightLog.ts）と同じ流儀で、判定と書き込みをここに1本化する。
//   ・logs に「その数値だけの行」を1件入れる（items 空・ex 'オフ'＝食事でも運動でもない行）
//   ・範囲は lib/guard が正本（WAIST_RANGE / BODYFAT_RANGE）。入力口ごとに閾値がズレない
//   ・保存後は同日の entries を同期（グラフ・表・概要の要約行が同じ値を見る）
//   ・数値の読み取りは lib/parseNum.parseDecimal（全角・カンマ小数・単位つき）
// 副作用（Supabase）は deps で差し替えられるので jest では純関数として検証できる。
//
// 体脂肪率について: 以前は「体の写真」カードが写真を Storage に上げ、体脂肪率も一緒に保存していた。
// 写真の保存はやめた（保存エラーが解消せず、機微情報でもある）。いまは **数値だけ** を残す。
// 写真は AI の推定に使ったあと捨てる。
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';
import { inWaistRange, inBodyfatRange } from '@/lib/guard';
import { parseDecimal } from '@/lib/parseNum';
import { displayToCm, type HeightUnit } from '@/lib/units';
import { t } from '@/lib/i18n';

/** 表示単位（cm / in）の入力文字列を cm に直す。範囲外・数値でないなら null */
export function parseWaistInput(text: string, unit: HeightUnit): number | null {
  const n = parseDecimal(text);
  if (n == null) return null;
  const cm = displayToCm(n, unit);   // 'ft' 設定のときは総インチとして受ける
  return inWaistRange(cm) ? Math.round(cm * 10) / 10 : null;
}

/** 体脂肪率(%)の入力文字列を数値に直す。範囲外・数値でないなら null */
export function parseBodyfatInput(text: string): number | null {
  const n = parseDecimal(text);
  if (n == null) return null;
  return inBodyfatRange(n) ? Math.round(n * 10) / 10 : null;
}

export type SaveBodyResult =
  | { ok: true; value: number }
  | { ok: false; msg: string };

export type SaveBodyDeps = {
  uid: string | null | undefined;
  /** 記録先の日付（YYYY-MM-DD・JST） */
  date: string;
  // ↓ テスト用の差し替え口（既定は本番の実装）
  insert?: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  sync?: (uid: string, date: string) => Promise<unknown>;
};

/** logs に入れる「数値だけの行」の共通部分（体重の weightOnlyRow と同じ形） */
function bareRow(uid: string, date: string): Record<string, unknown> {
  return {
    user_id: uid, date, items: [], kcal: null, p: null, f: null, c: null,
    weight: null, ex: 'オフ', adj: 0, mood: '', text: '', photo_urls: [],
  };
}

export function waistOnlyRow(uid: string, date: string, cm: number): Record<string, unknown> {
  return { ...bareRow(uid, date), waist: cm };
}

export function bodyfatOnlyRow(uid: string, date: string, pct: number): Record<string, unknown> {
  return { ...bareRow(uid, date), bodyfat: pct };
}

async function insertAndSync(row: Record<string, unknown>, deps: SaveBodyDeps): Promise<string | null> {
  const insert = deps.insert ?? (async (r: Record<string, unknown>) => {
    const { error } = await supabase.from('logs').insert(r);
    return { error };
  });
  const { error } = await insert(row);
  if (error) return t('保存に失敗しました。もう一度お試しください。');
  const sync = deps.sync ?? syncEntriesForDate;
  try { await sync(String(row.user_id), String(row.date)); } catch { /* 同期の失敗は保存の成否に含めない */ }
  return null;
}

/** ウエストを保存する。text は表示単位（cm / in）の文字列 */
export async function saveWaistEntry(text: string, unit: HeightUnit, deps: SaveBodyDeps): Promise<SaveBodyResult> {
  const cm = parseWaistInput(text, unit);
  if (!deps.uid || cm == null) return { ok: false, msg: t('ウエストの値を確認してください。') };
  const err = await insertAndSync(waistOnlyRow(deps.uid, deps.date, cm), deps);
  return err ? { ok: false, msg: err } : { ok: true, value: cm };
}

/** 体脂肪率(%)を保存する。AI の推定値を本人が確認・修正したあとの値を渡す */
export async function saveBodyfatEntry(text: string, deps: SaveBodyDeps): Promise<SaveBodyResult> {
  const pct = parseBodyfatInput(text);
  if (!deps.uid || pct == null) return { ok: false, msg: t('体脂肪率の値を確認してください。') };
  const err = await insertAndSync(bodyfatOnlyRow(deps.uid, deps.date, pct), deps);
  return err ? { ok: false, msg: err } : { ok: true, value: pct };
}
