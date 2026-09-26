// 「推移の詳細」表の要約行（期間平均・記録日数・期間日数）を固定する（2026-09-26）。
// 熊田さん「摂取カロリーの表に、表示している期間の平均を数字で出してほしい」
import { tableStats } from '@/lib/tableStats';

describe('tableStats: 表示期間の平均', () => {
  it('空なら平均 null・記録 0・期間 0', () => {
    expect(tableStats([])).toEqual({ avg: null, count: 0, spanDays: 0 });
  });

  it('1件なら その値が平均・期間は1日', () => {
    expect(tableStats([{ date: '2026-09-26', value: 1800 }])).toEqual({ avg: 1800, count: 1, spanDays: 1 });
  });

  it('欠損（null / undefined / NaN）は平均にも期間にも入れない', () => {
    const r = tableStats([
      { date: '2026-09-20', value: null },        // 期間の端にあっても未記録なら期間に数えない
      { date: '2026-09-21', value: 1600 },
      { date: '2026-09-22', value: undefined },
      { date: '2026-09-23', value: Number.NaN },
      { date: '2026-09-24', value: 2000 },
      { date: '2026-09-26', value: null },
    ]);
    expect(r).toEqual({ avg: 1800, count: 2, spanDays: 4 });   // 9/21〜9/24 の4日・記録2日
  });

  it('並び順に依存しない（表は新しい順、概要タブの集計は古い順）', () => {
    const asc = [
      { date: '2026-09-01', value: 60.0 }, { date: '2026-09-15', value: 61.0 }, { date: '2026-09-30', value: 62.0 },
    ];
    const desc = [...asc].reverse();
    expect(tableStats(asc)).toEqual(tableStats(desc));
    expect(tableStats(asc)).toEqual({ avg: 61, count: 3, spanDays: 30 });
  });

  it('月末→月初をまたいでも日数が正しい（うるう年・DST を含む）', () => {
    expect(tableStats([{ date: '2024-02-28', value: 1 }, { date: '2024-03-01', value: 1 }]).spanDays).toBe(3);   // 2/28, 2/29, 3/1
    expect(tableStats([{ date: '2026-03-07', value: 1 }, { date: '2026-03-09', value: 1 }]).spanDays).toBe(3);   // 米国の DST 切替をまたぐ
  });

  it('小数の平均は丸めない（丸めは表の fmt が担当）', () => {
    expect(tableStats([{ date: '2026-09-01', value: 21.4 }, { date: '2026-09-02', value: 21.5 }]).avg).toBeCloseTo(21.45, 10);
  });
});
