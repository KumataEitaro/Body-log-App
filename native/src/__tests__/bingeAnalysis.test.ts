// 過食の引き金レポート: 仕込んだパターンを検出できるか
import { analyzeBinge, moodScore, type AnalysisDay } from '@/lib/bingeAnalysis';

function day(date: string, diff: number | null, extra: Partial<AnalysisDay> = {}): AnalysisDay {
  return { date, intake: diff == null ? null : 1800 + diff, p: 100, diff, ...extra };
}

// 「大きく我慢した翌日に食べすぎる」パターンを30日分つくる
function restrictThenBinge(): AnalysisDay[] {
  const out: AnalysisDay[] = [];
  for (let i = 0; i < 30; i++) {
    const d = `2026-06-${String(i + 1).padStart(2, '0')}`;
    if (i % 5 === 3) out.push(day(d, -500));          // 我慢の日
    else if (i % 5 === 4) out.push(day(d, 700));      // その翌日に過食
    else out.push(day(d, -50));
  }
  return out;
}

describe('analyzeBinge', () => {
  it('データが少なければ傾向を出さない（enough=false）', () => {
    const r = analyzeBinge([day('2026-06-01', 700), day('2026-06-02', -100)]);
    expect(r.enough).toBe(false);
  });

  it('「前日に我慢しすぎた」パターンを引き金として検出する', () => {
    const r = analyzeBinge(restrictThenBinge());
    expect(r.enough).toBe(true);
    expect(r.bingeDays).toBeGreaterThan(0);
    const hit = r.triggers.find((x) => x.key === 'prev-deficit');
    expect(hit).toBeTruthy();
    expect(hit!.lift).toBeGreaterThan(1.4);
  });

  it('過食日の翌日に記録が途切れる割合を出す', () => {
    const days: AnalysisDay[] = [];
    for (let i = 0; i < 24; i++) {
      const d = `2026-07-${String(i + 1).padStart(2, '0')}`;
      if (i % 4 === 0) days.push(day(d, 800));
      else if (i % 4 === 1) days.push(day(d, null)); // 翌日は未記録
      else days.push(day(d, -100));
    }
    const r = analyzeBinge(days);
    expect(r.after.logDropRate).not.toBeNull();
    expect(r.after.logDropRate!).toBeGreaterThan(0.5);
  });

  it('引き金が無ければ空の配列を返す（無理に理由をつけない）', () => {
    const days: AnalysisDay[] = [];
    for (let i = 0; i < 30; i++) days.push(day(`2026-08-${String(i + 1).padStart(2, '0')}`, -100));
    const r = analyzeBinge(days);
    expect(r.triggers).toHaveLength(0);
  });

  it('気分の記録を1〜5に変換できる', () => {
    expect(moodScore('4/5')).toBe(4);
    expect(moodScore('😫')).toBe(1);
    expect(moodScore('')).toBeNull();
    expect(moodScore(null)).toBeNull();
  });
});
