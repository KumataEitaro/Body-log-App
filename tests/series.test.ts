import { describe, it, expect } from 'vitest';
import { cumulativeDiffs } from '../lib/series';

describe('cumulativeDiffs（収支の累積）', () => {
  it('日付順に累積される', () => {
    const c = cumulativeDiffs([
      { date: '2026-07-01', diff: -500 },
      { date: '2026-07-02', diff: -300 },
      { date: '2026-07-03', diff: 1000 },
    ]);
    expect(c.map((p) => p.v)).toEqual([-500, -800, 200]);
  });
  it('入力が日付順でなくてもソートして累積', () => {
    const c = cumulativeDiffs([
      { date: '2026-07-03', diff: 100 },
      { date: '2026-07-01', diff: -500 },
    ]);
    expect(c[0]).toEqual({ date: '2026-07-01', v: -500 });
    expect(c[1]).toEqual({ date: '2026-07-03', v: -400 });
  });
  it('空配列は空', () => expect(cumulativeDiffs([])).toEqual([]));
  it('丸め: 小数の累積も整数化', () => {
    const c = cumulativeDiffs([{ date: '2026-07-01', diff: -175.7 }, { date: '2026-07-02', diff: -473.8 }]);
    expect(c[1].v).toBe(Math.round(-649.5)); // JSのMath.round準拠(-649)
  });
});
