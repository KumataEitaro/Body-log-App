// サイクル比較（B-5）の集計。期間の切り出し・体重差・週ペースが仕様どおりかを検証する。
// 「期間内の最初と最後の記録体重の差」という定義（平均でも回帰でもない）が守られること。
import { cycleStats } from '../CycleCard';

const W = (date: string, weight: number) => ({ date, weight });

describe('cycleStats', () => {
  const periods = [
    { purpose: 'bulk', started_at: '2026-03-01', ended_at: '2026-05-31' },
    { purpose: 'cut_std', started_at: '2026-06-01', ended_at: null },
  ];
  const weights = [
    W('2026-03-01', 70.0), W('2026-04-15', 72.5), W('2026-05-30', 74.0),
    W('2026-06-02', 74.0), W('2026-07-27', 70.9),
  ];

  it('期間内の最初と最後の記録体重の差になる', () => {
    const st = cycleStats(periods, weights, '2026-07-27');
    expect(st[0].deltaKg).toBe(4.0);   // 増量: 70.0 → 74.0
    expect(st[1].deltaKg).toBe(-3.1);  // 減量（進行中）: 74.0 → 70.9
  });

  it('進行中の期間はtodayまでで集計され、end=nullを保つ', () => {
    const st = cycleStats(periods, weights, '2026-07-27');
    expect(st[1].end).toBeNull();
    expect(st[1].days).toBe(56); // 6/1〜7/27 = 8週
  });

  it('週あたりペース = 差 ÷ (日数/7)', () => {
    const st = cycleStats(periods, weights, '2026-07-27');
    expect(st[1].paceKg).toBeCloseTo(-3.1 / 8, 2);
  });

  it('体重が2点未満の期間はnull（判定に使わない）', () => {
    const st = cycleStats(periods, [W('2026-03-01', 70.0)], '2026-07-27');
    expect(st[0].deltaKg).toBeNull();
    expect(st[0].paceKg).toBeNull();
  });

  it('切替当日でも0除算しない（日数は最低1）', () => {
    const st = cycleStats([{ purpose: 'bulk', started_at: '2026-07-27', ended_at: null }], [], '2026-07-27');
    expect(st[0].days).toBe(1);
  });
});
