// 過食リスク v2 の I/O 層の純関数（lib/bingeRiskStore.ts）: 最終食事からの経過・アラート結果の解決
import { hoursSinceLastMeal, resolveOutcomes, upsertOutcome } from '../bingeRiskStore';
import type { AlertOutcome } from '../bingeRisk';
import type { DayFeature } from '../features';

const row = (date: string, p: Partial<DayFeature>): DayFeature => ({ date, ...p } as DayFeature);

describe('hoursSinceLastMeal', () => {
  it('kcal のある最後の記録からの経過時間（h）。食事が無ければ null', () => {
    const now = Date.parse('2026-09-25T20:00:00+09:00');
    expect(hoursSinceLastMeal([
      { at: '2026-09-25T12:00:00+09:00', kcal: 600 },
      { at: '2026-09-25T15:00:00+09:00', kcal: 200 },
      { at: '2026-09-25T18:00:00+09:00', kcal: null },   // 体重だけの行は食事ではない
    ], now)).toBeCloseTo(5);
    expect(hoursSinceLastMeal([], now)).toBeNull();
    expect(hoursSinceLastMeal([{ at: null, kcal: 300 }], now)).toBeNull();
  });
  it('未来の時刻（時計のずれ）は 0 に丸める', () => {
    const now = Date.parse('2026-09-25T20:00:00+09:00');
    expect(hoursSinceLastMeal([{ at: '2026-09-25T21:00:00+09:00', kcal: 500 }], now)).toBe(0);
  });
});

describe('resolveOutcomes / upsertOutcome', () => {
  // labelOf: intake が無い日は「分からない」、あれば binge（+800 超過）／overfull の印で決まる
  const rows = [
    row('2026-09-20', { recorded: true, intake: 3200, binge: true } as Partial<DayFeature>),
    row('2026-09-21', { recorded: true, intake: 1900, binge: false } as Partial<DayFeature>),
    row('2026-09-22', { recorded: false, intake: null, binge: false } as Partial<DayFeature>),
  ];
  const out: AlertOutcome[] = [
    { date: '2026-09-20', tier: 'warning', p: 0.5, outcome: null },
    { date: '2026-09-21', tier: 'nudge', p: 0.2, outcome: null },
    { date: '2026-09-22', tier: 'nudge', p: 0.2, outcome: null },
    { date: '2026-09-23', tier: 'nudge', p: 0.2, outcome: null },
  ];

  it('今日より前の日だけ、その日のラベルで結果を埋める（未記録の日は未解決のまま）', () => {
    const r = resolveOutcomes(out, rows, '2026-09-23');
    const by = Object.fromEntries(r.map((o) => [o.date, o.outcome]));
    expect(by['2026-09-20']).toBe(true);
    expect(by['2026-09-21']).toBe(false);
    expect(by['2026-09-22']).toBeNull();   // 記録が無い＝分からない
    expect(by['2026-09-23']).toBeNull();   // 今日はまだ結果が出ていない
  });

  it('保持日数を過ぎた古い行は落とす', () => {
    const r = resolveOutcomes(out, rows, '2026-11-01', 30);
    expect(r).toHaveLength(0);
  });

  it('upsertOutcome は同じ日を置き換え、無ければ足す', () => {
    const r1 = upsertOutcome(out, { date: '2026-09-23', tier: 'warning', p: 0.6, outcome: null });
    expect(r1.filter((o) => o.date === '2026-09-23')).toHaveLength(1);
    expect(r1.find((o) => o.date === '2026-09-23')?.tier).toBe('warning');
    const r2 = upsertOutcome(out, { date: '2026-09-24', tier: 'nudge', p: 0.2, outcome: null });
    expect(r2).toHaveLength(out.length + 1);
  });
});
