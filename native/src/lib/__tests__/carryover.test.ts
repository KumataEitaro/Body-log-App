// 繰り越し調整（lib/carryover.ts）。
// 「1日で取り返さない」を数字で固定する: 窓・符号・丸め・当日除外・振動しないこと。
import {
  CARRY_DAYS_DEFAULT, CARRY_MIN_ENTRIES, CARRY_THRESHOLD,
  activeCarries, carryPerDay, carryToday, clampCarryDays, detectCarry, isCarry, signedKcal, splitEvents,
  type EventRow,
} from '../carryover';
import { dailyAllowance } from '../deficit';

const row = (p: Partial<EventRow> & { date: string; extra_kcal: number }): EventRow => ({
  id: p.id ?? `${p.date}-${p.extra_kcal}`, title: p.title ?? '⚖️ 調整', kind: p.kind ?? 'carry', absorb_days: p.absorb_days ?? null,
  date: p.date, extra_kcal: p.extra_kcal,
});

describe('splitEvents / isCarry', () => {
  it('kind=carry だけが調整。kind の無い旧行と plan は先の予定（チートデイ）', () => {
    const rows = [
      row({ date: '2026-09-20', extra_kcal: 1000 }),
      row({ date: '2026-09-25', extra_kcal: 800, kind: 'plan', title: '🍖 チートデイ' }),
      { id: 'old', date: '2026-09-26', title: '🍻 飲み会', extra_kcal: 1200 } as EventRow,
    ];
    const { plans, carries } = splitEvents(rows);
    expect(carries.map((c) => c.date)).toEqual(['2026-09-20']);
    expect(plans.map((p) => p.date)).toEqual(['2026-09-25', '2026-09-26']);
    expect(isCarry(null)).toBe(false);
    expect(isCarry({ kind: undefined })).toBe(false);
  });
});

describe('carryToday（今日の目標に足す調整）', () => {
  const over = [row({ date: '2026-09-10', extra_kcal: 1000, absorb_days: 7 })];

  it('食べすぎ +1,000 を7日 → 翌日から7日間、+143（食べる量を143減らす）。当日と8日目以降は0', () => {
    expect(carryToday(over, '2026-09-10', 7)).toBe(0);       // 当日は含めない（翌日から）
    expect(carryToday(over, '2026-09-11', 7)).toBe(143);     // 1000/7 = 142.86 → 143
    expect(carryToday(over, '2026-09-17', 7)).toBe(143);     // 7日目（最後）
    expect(carryToday(over, '2026-09-18', 7)).toBe(0);       // 窓を過ぎた
    expect(carryToday(over, '2026-09-01', 7)).toBe(0);       // 未来の行は効かない
  });

  it('少なすぎ −700 → 符号が反転して −100（食べる量を100増やす）', () => {
    const under = [row({ date: '2026-09-10', extra_kcal: -700, absorb_days: 7 })];
    expect(carryToday(under, '2026-09-11', 7)).toBe(-100);
  });

  it('複数の行は足し合わせる（超過と不足が相殺することもある）', () => {
    const both = [
      row({ date: '2026-09-10', extra_kcal: 1000, absorb_days: 7 }),
      row({ date: '2026-09-12', extra_kcal: -700, absorb_days: 7 }),
    ];
    expect(carryToday(both, '2026-09-13', 7)).toBe(43);     // 143 − 100
    expect(carryToday(both, '2026-09-18', 7)).toBe(-100);   // 1つ目は窓を過ぎ、2つ目だけ
  });

  it('行の absorb_days が優先。無ければ既定日数（あとで既定を変えても承認済みの約束は変わらない）', () => {
    const fixed = [row({ date: '2026-09-10', extra_kcal: 1000, absorb_days: 5 })];
    expect(carryToday(fixed, '2026-09-11', 14)).toBe(200);   // 5日で割る
    expect(carryToday(fixed, '2026-09-16', 14)).toBe(0);     // 6日目は効かない
    const open = [row({ date: '2026-09-10', extra_kcal: 1000, absorb_days: null })];
    expect(carryToday(open, '2026-09-11', 10)).toBe(100);
  });

  it('plan（チートデイ）の行が混ざっていても無視する（呼び出し側の分け忘れで二重計上しない）', () => {
    const mixed = [row({ date: '2026-09-10', extra_kcal: 800, kind: 'plan' }), row({ date: '2026-09-10', extra_kcal: 1000 })];
    expect(carryToday(mixed, '2026-09-11', 7)).toBe(143);
  });

  it('調整後の目標を守った日は「ずれ」にならない（振動しない）', () => {
    // 9/10 に +1000。9/11 の目標は 2000 − 143 = 1857。ぴったり食べたら delta=0 → 何も聞かない
    const carries = [row({ date: '2026-09-10', extra_kcal: 1000, absorb_days: 7 })];
    const allowance = dailyAllowance(2000, 0 + carryToday(carries, '2026-09-11', 7), 1500);
    expect(allowance).toBe(1857);
    expect(detectCarry({ date: '2026-09-11', intake: 1857, allowance, entries: 3, days: 7 })).toBeNull();
  });

  it('BMR の下限は調整でも割らない（dailyAllowance と組み合わせたとき）', () => {
    const carries = [row({ date: '2026-09-10', extra_kcal: 5000, absorb_days: 3 })];
    expect(dailyAllowance(1800, carryToday(carries, '2026-09-11', 3), 1600)).toBe(1600);
  });
});

describe('activeCarries（目標画面の「いま調整中」）', () => {
  it('当日の行は「明日から」で残り=日数、最後の日は残り1、窓を過ぎたら出ない。新しい日付が先', () => {
    const rows = [
      row({ id: 'a', date: '2026-09-10', extra_kcal: 1000, absorb_days: 7 }),
      row({ id: 'b', date: '2026-09-14', extra_kcal: -600, absorb_days: 3 }),
    ];
    const t14 = activeCarries(rows, '2026-09-14', 7);
    expect(t14.map((a) => a.id)).toEqual(['b', 'a']);
    expect(t14[0]).toMatchObject({ perDay: -200, daysLeft: 3, endDate: '2026-09-17' });
    expect(t14[1]).toMatchObject({ perDay: 143, daysLeft: 4, endDate: '2026-09-17' });   // 今日(9/14),15,16,17 の4日
    expect(activeCarries(rows, '2026-09-11', 7)[0]).toMatchObject({ id: 'a', daysLeft: 7 });
    expect(activeCarries(rows, '2026-09-17', 7).map((a) => a.daysLeft)).toEqual([1, 1]);
    expect(activeCarries(rows, '2026-09-18', 7)).toEqual([]);
  });
});

describe('detectCarry（聞くかどうか）', () => {
  it('閾値ちょうどは聞かない。超えたら聞く（超過）', () => {
    expect(detectCarry({ date: '2026-09-20', intake: 2500, allowance: 2000, entries: 3, days: 7 })).toBeNull();
    const d = detectCarry({ date: '2026-09-20', intake: 2501, allowance: 2000, entries: 3, days: 7 });
    expect(d).toMatchObject({ kind: 'over', delta: 501, days: 7, perDay: 72 });
    expect(CARRY_THRESHOLD).toBe(500);
  });

  it('不足は1日が終わってから（sameDay では聞かない）・記録が2件以上あるときだけ', () => {
    const base = { date: '2026-09-20', intake: 1200, allowance: 2000, days: 7 };
    expect(detectCarry({ ...base, entries: 3 })).toMatchObject({ kind: 'under', delta: -800, perDay: -114 });
    expect(detectCarry({ ...base, entries: 3, sameDay: true })).toBeNull();
    expect(detectCarry({ ...base, entries: CARRY_MIN_ENTRIES - 1 })).toBeNull();
  });

  it('超過は当日でも記録1件でも聞く（食べたものは戻らない）', () => {
    expect(detectCarry({ date: '2026-09-20', intake: 3200, allowance: 2000, entries: 1, days: 7, sameDay: true }))
      .toMatchObject({ kind: 'over', delta: 1200 });
  });

  it('未記録・壊れた値は聞かない（未記録は穴埋め backfill の担当）', () => {
    expect(detectCarry({ date: '2026-09-20', intake: null, allowance: 2000, entries: 0, days: 7 })).toBeNull();
    expect(detectCarry({ date: '2026-09-20', intake: 3000, allowance: NaN, entries: 2, days: 7 })).toBeNull();
  });

  it('日数は丸めて 1〜60 に収める。壊れた値は既定', () => {
    expect(clampCarryDays(0)).toBe(CARRY_DAYS_DEFAULT);
    expect(clampCarryDays('abc')).toBe(CARRY_DAYS_DEFAULT);
    expect(clampCarryDays(100)).toBe(60);
    expect(clampCarryDays('7')).toBe(7);
    expect(carryPerDay(1000, 0)).toBe(143);
  });

  it('符号つきの表示はマイナス記号（ハイフンではない）', () => {
    expect(signedKcal(1000)).toBe('+1,000');
    expect(signedKcal(-143)).toBe('−143');
  });
});
