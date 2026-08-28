// ストリーク計算（お守り＝週1回の1日抜け救済）とソフト週目標の純関数テスト
import { calcStreak, calcWeekProgress, weekPromiseOk } from '@/lib/achievements';

const set = (...d: string[]) => new Set(d);

describe('calcStreak', () => {
  it('連続日数を数える（今日を含む）', () => {
    expect(calcStreak(set('2026-08-24', '2026-08-25', '2026-08-26'), '2026-08-26').days).toBe(3);
  });
  it('今日が未記録でも昨日までの連続は維持（今日はまだ終わっていない）', () => {
    expect(calcStreak(set('2026-08-24', '2026-08-25'), '2026-08-26').days).toBe(2);
  });
  it('今日も昨日も未記録なら0', () => {
    expect(calcStreak(set('2026-08-23'), '2026-08-26').days).toBe(0);
  });
  it('お守り: 週1回の1日抜けは自動でつながる', () => {
    // 8/22(土)が抜けても、その週初のお守りで救済される
    const r = calcStreak(set('2026-08-20', '2026-08-21', '2026-08-23', '2026-08-24', '2026-08-25'), '2026-08-25');
    expect(r.days).toBe(5);
    expect(r.usedFreeze).toBe('2026-08-22');
  });
  it('同じ週に2日抜けたら折れる（お守りは週1回・救済日は日数に数えない）', () => {
    // 8/21(金)と8/19(水)の2箇所が抜け（同週）→2つ目は救えない
    const r = calcStreak(set('2026-08-17', '2026-08-18', '2026-08-20', '2026-08-22', '2026-08-23'), '2026-08-23');
    expect(r.days).toBe(3); // 23,22,(21をお守りで通過),20 → 19で折れる。記録日3日ぶん
  });
  it('2日連続の穴はお守りでも救えない', () => {
    const r = calcStreak(set('2026-08-20', '2026-08-23', '2026-08-24'), '2026-08-24');
    expect(r.days).toBe(2);
  });
});

describe('calcWeekProgress（ソフト週目標の「今週」）', () => {
  it('月曜起点で今週の記録日数を数える', () => {
    // 2026-08-27は木曜。今週=8/24(月)〜8/30(日)
    const r = calcWeekProgress(set('2026-08-24', '2026-08-26', '2026-08-23'), '2026-08-27');
    expect(r.count).toBe(2);                 // 8/23(先週日曜)は数えない
    expect(r.days).toEqual([true, false, true, false, false, false, false]);
    expect(r.todayIdx).toBe(3);              // 木曜=月曜から3日目
  });
  it('記録ゼロでも落ちない', () => {
    const r = calcWeekProgress(set(), '2026-08-24');
    expect(r.count).toBe(0);
    expect(r.todayIdx).toBe(0);              // 月曜
  });
});

describe('weekPromiseOk（週の約束バッジ: 直近4週すべて目標以上）', () => {
  // 今日=2026-08-27(木)。判定対象は完了した4週: 7/27週・8/3週・8/10週・8/17週
  const mondays = ['2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17'];
  const nDays = (mon: string, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(mon + 'T00:00:00');
      d.setDate(d.getDate() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

  it('4週すべて週3日以上ならtrue', () => {
    const rec = new Set(mondays.flatMap((m) => nDays(m, 3)));
    expect(weekPromiseOk(rec, '2026-08-27', 3)).toBe(true);
  });
  it('1週でも目標未満ならfalse', () => {
    const rec = new Set([...nDays(mondays[0], 2), ...mondays.slice(1).flatMap((m) => nDays(m, 3))]);
    expect(weekPromiseOk(rec, '2026-08-27', 3)).toBe(false);
  });
  it('進行中の今週は判定に含めない（今週0日でも先週まで守れていればtrue）', () => {
    const rec = new Set(mondays.flatMap((m) => nDays(m, 5)));
    expect(weekPromiseOk(rec, '2026-08-27', 5)).toBe(true);
  });
});
