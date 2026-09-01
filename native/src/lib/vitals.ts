// バイタル記録（血圧・脈拍・血糖）。
//
// 1500人ペルソナ監査Later群「中高年・健康管理層の本丸」。健診で数値を指摘された人は
// 体重よりも先に血圧を見ている。1日1件だけ残し、受診用PDFレポートの材料にもする。
// テーブルは supabase/migration-25.sql【ユーザー実行待ち】。
// 未適用のDBでも壊れない: 読み込み失敗は空配列（表もグラフも空状態のまま）。
//
// 【安全ガードの流儀】このファイルは診断をしない。異常域の判定は「医療機関に相談を」の
// 一言を出すかどうかだけに使い、病名・重症度・治療の示唆は一切持たせない。
import { supabase } from './supabase';
import { t } from './i18n';

export type Vital = {
  date: string;                 // YYYY-MM-DD（JST）
  systolic: number | null;      // 収縮期血圧（上）mmHg
  diastolic: number | null;     // 拡張期血圧（下）mmHg
  pulse: number | null;         // 脈拍 bpm
  glucose: number | null;       // 血糖値 mg/dL
  note: string | null;
};

/** 入力として受け付ける範囲（打ち間違いのガード。医学的な正常値ではない） */
export const VITAL_RANGE = {
  systolic: { min: 50, max: 260 },
  diastolic: { min: 30, max: 200 },
  pulse: { min: 30, max: 220 },
  glucose: { min: 20, max: 600 },
} as const;

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** 直近days日のバイタル（日付昇順）。テーブル未作成・通信失敗は空扱い */
export async function listVitals(days = 30): Promise<Vital[]> {
  try {
    const from = addDays(todayJSTLocal(), -(days - 1));
    const { data, error } = await supabase.from('vitals')
      .select('date,systolic,diastolic,pulse,glucose,note')
      .gte('date', from)
      .order('date', { ascending: true })
      .limit(400);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((r) => ({
      date: String(r.date),
      systolic: num(r.systolic),
      diastolic: num(r.diastolic),
      pulse: num(r.pulse),
      glucose: num(r.glucose),
      note: r.note == null ? null : String(r.note),
    }));
  } catch { return []; }
}

/** その日の1件を保存（同じ日は上書き＝unique(user_id,date)のupsert） */
export async function saveVital(uid: string, v: Vital): Promise<{ ok: true } | { ok: false; error: string }> {
  const hasAny = v.systolic != null || v.diastolic != null || v.pulse != null || v.glucose != null || (v.note ?? '').trim() !== '';
  if (!hasAny) return { ok: false, error: t('数値をひとつ以上入れてください。') };
  try {
    const { error } = await supabase.from('vitals').upsert({
      user_id: uid,
      date: v.date,
      systolic: v.systolic, diastolic: v.diastolic, pulse: v.pulse, glucose: v.glucose,
      note: (v.note ?? '').trim() || null,
    }, { onConflict: 'user_id,date' });
    if (error) return { ok: false, error: t('保存できませんでした。通信環境を確認してもう一度お試しください。') };
    return { ok: true };
  } catch {
    return { ok: false, error: t('保存できませんでした。通信環境を確認してもう一度お試しください。') };
  }
}

/** 1日ぶんの削除 */
export async function deleteVital(date: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('vitals').delete().eq('date', date);
    return !error;
  } catch { return false; }
}

/**
 * 受診をすすめる域かどうか（**診断ではない**）。
 * true のときだけ「医療機関に相談を」の非審判な一言を1行添える。
 * しきい値は一般に「受診の目安」として広く使われる値で、重症度の判定には使わない。
 */
export function needsDoctorNote(v: { systolic: number | null; diastolic: number | null; glucose: number | null }): boolean {
  if (v.systolic != null && v.systolic >= 180) return true;
  if (v.diastolic != null && v.diastolic >= 110) return true;
  if (v.systolic != null && v.systolic <= 80) return true;
  if (v.glucose != null && (v.glucose >= 300 || v.glucose <= 60)) return true;
  return false;
}

/** 一覧のどこかに受診をすすめる域があるか */
export function anyNeedsDoctorNote(list: Vital[]): boolean {
  return list.some((v) => needsDoctorNote(v));
}

/** メニュー行の要約1行（最新の血圧。無ければ誘い文） */
export function vitalsSummary(list: Vital[]): string {
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i];
    if (v.systolic != null && v.diastolic != null) {
      return t('最新 {s}/{d}', { s: v.systolic, d: v.diastolic });
    }
    if (v.glucose != null) return t('最新 血糖 {n}', { n: v.glucose });
    if (v.pulse != null) return t('最新 脈拍 {n}', { n: v.pulse });
  }
  return t('血圧・脈拍・血糖を残す');
}

// ---- 日付ユーティリティ（lib/calcのtodayJSTと同値。循環importを避けてここに置く） ----
export function todayJSTLocal(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
