// 「推移の詳細」表（components/DataTableCard.tsx）の要約行に出す「表示期間の平均」（2026-09-26）。
//
// 熊田さん「摂取カロリーの表に、表示している期間の平均を数字で出してほしい。前回比の +XX は残す」
//
// 表は「記録がある日」だけを行にするので、平均は **記録がある行の単純平均**（未記録日は分母に入れない）。
// 期間は「表に出ている最初の日〜最後の日」の日数（両端を含む）。
// 「期間平均 1,742kcal（30日・記録 22 日）」のように、平均・期間・記録日数の3つを添えることで
// 「30日のうち8日は記録が無い＝平均は22日ぶんの実態」と読めるようにする。
// 表示単位への換算（体重の kg→lb）と丸めは呼び出し側（表の fmt）に任せ、ここは生の値だけを扱う。

export type TableStat = {
  /** 記録がある行の平均。1行も無ければ null */
  avg: number | null;
  /** 平均の分母＝値がある行の数 */
  count: number;
  /** 表示期間の日数（最初の日〜最後の日・両端を含む）。値が無ければ 0 */
  spanDays: number;
};

/** 'YYYY-MM-DD' を UTC 正午の日連番にする（DST や時差で日数がズレないように） */
function dayIndex(date: string): number {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  return Math.round(Date.UTC(y, m - 1, d, 12) / 86400000);
}

/**
 * 表に出ている行から「期間平均・記録日数・期間日数」を出す。
 * value が null / undefined / NaN の行は「未記録」として平均にも期間にも入れない。
 * 行の並び順は問わない（新しい順でも古い順でも同じ結果）。
 */
export function tableStats(rows: readonly { date: string; value: number | null | undefined }[]): TableStat {
  let sum = 0, count = 0;
  let first: number | null = null, last: number | null = null;
  for (const r of rows) {
    const v = r.value;
    if (v == null || typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    sum += v; count += 1;
    const idx = dayIndex(r.date);
    if (first == null || idx < first) first = idx;
    if (last == null || idx > last) last = idx;
  }
  if (count === 0 || first == null || last == null) return { avg: null, count: 0, spanDays: 0 };
  return { avg: sum / count, count, spanDays: last - first + 1 };
}
