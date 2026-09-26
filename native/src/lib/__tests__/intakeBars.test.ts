// 「摂取カロリー」棒グラフの集計（lib/intakeBars.ts）を固定する（2026-09-26）。
// 熊田さん「食べ方の分析に摂取カロリーの棒グラフ。目標クリアの日は緑、超過はアンバー、点線の目標ライン」
import {
  addDaysIso, isOverGoal, intakeTicks, sliceIntakeRange, intakeBarsStats, parseIntakeRange,
} from '@/lib/intakeBars';

const TODAY = '2026-09-26';

describe('addDaysIso', () => {
  it('月末・年末・うるう日をまたぐ', () => {
    expect(addDaysIso('2026-09-26', -6)).toBe('2026-09-20');
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysIso('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDaysIso('2026-09-26', 0)).toBe('2026-09-26');
  });
});

describe('isOverGoal: 目標クリアの境界', () => {
  it('ちょうど目標はクリア（曜日ヒートマップの diff > 0 と同じ境界）', () => {
    expect(isOverGoal(2000, 2000)).toBe(false);
    expect(isOverGoal(2001, 2000)).toBe(true);
    expect(isOverGoal(1999, 2000)).toBe(false);
  });
  it('摂取か目標が無ければ null（色を付けない）', () => {
    expect(isOverGoal(null, 2000)).toBeNull();
    expect(isOverGoal(1800, null)).toBeNull();
    expect(isOverGoal(Number.NaN, 2000)).toBeNull();
  });
});

describe('intakeTicks: 0 起点・3〜4 目盛り・切りのいい上端', () => {
  it('典型的な最大値', () => {
    expect(intakeTicks(2500)).toEqual([0, 1000, 2000, 3000]);
    expect(intakeTicks(1742)).toEqual([0, 1000, 2000]);
    expect(intakeTicks(3200)).toEqual([0, 2000, 4000]);
    expect(intakeTicks(900)).toEqual([0, 500, 1000]);
  });
  it('最大値が 0 以下・不正なら既定の 0〜1000', () => {
    expect(intakeTicks(0)).toEqual([0, 500, 1000]);
    expect(intakeTicks(-5)).toEqual([0, 500, 1000]);
    expect(intakeTicks(Number.NaN)).toEqual([0, 500, 1000]);
  });
  it('上端は必ず最大値以上（棒が枠からはみ出ない）', () => {
    for (const m of [1, 999, 1001, 2499, 2501, 4999, 7300, 12000]) {
      const t = intakeTicks(m);
      expect(t[0]).toBe(0);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(m);
      expect(t.length).toBeGreaterThanOrEqual(3);
      expect(t.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('sliceIntakeRange: 今日を右端に毎日1本', () => {
  it('7日: 古い順に7本、無い日は intake null の空の棒', () => {
    const bars = sliceIntakeRange([
      { date: '2026-09-26', intake: 1800, goal: 2000 },
      { date: '2026-09-24', intake: 2300, goal: 2000 },
      { date: '2026-09-01', intake: 1000, goal: 2000 },   // 区間外
    ], 7, TODAY);
    expect(bars.map((b) => b.date)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
    expect(bars[6]).toEqual({ date: '2026-09-26', intake: 1800, goal: 2000, over: false });
    expect(bars[4]).toEqual({ date: '2026-09-24', intake: 2300, goal: 2000, over: true });
    expect(bars[5]).toEqual({ date: '2026-09-25', intake: null, goal: null, over: null });
  });
  it('90日でも本数は days と一致し、区間外は入らない', () => {
    const bars = sliceIntakeRange([{ date: '2026-06-28', intake: 1500, goal: 2000 }], 90, TODAY);
    expect(bars).toHaveLength(90);
    expect(bars[0].date).toBe('2026-06-29');
    expect(bars.every((b) => b.intake == null)).toBe(true);
  });
  it('文字列で来た数値も数にする（Supabase の numeric）', () => {
    const bars = sliceIntakeRange([{ date: TODAY, intake: '1800' as unknown as number, goal: '2000' as unknown as number }], 1, TODAY);
    expect(bars[0]).toEqual({ date: TODAY, intake: 1800, goal: 2000, over: false });
  });
});

describe('intakeBarsStats: 平均・日数・目標ライン・目盛り', () => {
  const rows = [
    { date: '2026-09-26', intake: 1800, goal: 2000 },
    { date: '2026-09-25', intake: 2400, goal: 2100 },
    { date: '2026-09-24', intake: null, goal: 2000 },   // 目標はあるが未記録
    { date: '2026-09-23', intake: 2000, goal: 2000 },   // ちょうど＝クリア
  ];
  it('平均は記録日だけの単純平均・目標内/超過の日数・目標ラインは目標の平均', () => {
    const s = intakeBarsStats(rows, 7, TODAY);
    expect(s.recorded).toBe(3);
    expect(s.avg).toBeCloseTo((1800 + 2400 + 2000) / 3, 6);
    expect(s.within).toBe(2);
    expect(s.over).toBe(1);
    expect(s.goalAvg).toBeCloseTo((2000 + 2100 + 2000 + 2000) / 4, 6);
    expect(s.bars).toHaveLength(7);
  });
  it('目盛りの上端は棒と目標線の両方を覆う', () => {
    const s = intakeBarsStats(rows, 7, TODAY);
    const top = s.ticks[s.ticks.length - 1];
    expect(top).toBeGreaterThanOrEqual(2400);
    expect(top).toBeGreaterThanOrEqual(2100);
    expect(s.ticks[0]).toBe(0);
  });
  it('記録がひとつも無い区間: 平均 null・日数 0・目盛りは既定', () => {
    const s = intakeBarsStats([], 30, TODAY);
    expect(s).toMatchObject({ avg: null, recorded: 0, within: 0, over: 0, goalAvg: null, ticks: [0, 500, 1000] });
    expect(s.bars).toHaveLength(30);
  });
  it('1件だけでも平均はその値', () => {
    const s = intakeBarsStats([{ date: TODAY, intake: 1742, goal: null }], 7, TODAY);
    expect(s.avg).toBe(1742);
    expect(s.within).toBe(0);            // 目標が無いので判定しない
    expect(s.over).toBe(0);
    expect(s.goalAvg).toBeNull();
  });
});

describe('parseIntakeRange: 保存した区間の復元', () => {
  it('7 / 30 / 90 だけを受け付け、それ以外は既定の 7', () => {
    expect(parseIntakeRange('30')).toBe(30);
    expect(parseIntakeRange('90')).toBe(90);
    expect(parseIntakeRange('7')).toBe(7);
    expect(parseIntakeRange(null)).toBe(7);
    expect(parseIntakeRange('14')).toBe(7);
    expect(parseIntakeRange('abc')).toBe(7);
  });
});
