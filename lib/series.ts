// カロリー収支の累積系列（積み上げグラフ用）

export type DiffPoint = { date: string; diff: number };
export type CumPoint = { date: string; v: number };

// 日々の差分（摂取−目安）を日付順に累積する
export function cumulativeDiffs(points: DiffPoint[]): CumPoint[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  let acc = 0;
  return sorted.map((p) => {
    acc += Number(p.diff) || 0;
    return { date: p.date, v: Math.round(acc) };
  });
}
