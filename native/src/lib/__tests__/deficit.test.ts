// ダイエットの基本原理（週・月の収支）の純関数。
// 目標画面の「必要な赤字」「食べられる量」「調整後の目標日」と、
// 食事タブの「超過3段階」「週間・月間の収支カード」が同じ数字を使う性質をここで固定する。
import {
  deficitPlan, dailyAllowance, projectedTargetDate, clampAdjust,
  overLevel, balanceOf, balanceFill, KCAL_PER_KG, type BalanceDay,
} from '../deficit';

describe('必要な赤字の算出', () => {
  it('総赤字 = (現在 − 目標)kg × 7,200kcal', () => {
    expect(KCAL_PER_KG).toBe(7200);
    const p = deficitPlan(80, 75, '2026-09-02', '2026-11-01');
    expect(p.kg).toBe(5);
    expect(p.total).toBe(36000);
    expect(p.direction).toBe('cut');
  });

  it('1日・1週間・1か月あたりに換算する（60日で5kg → 600/4,200/18,000）', () => {
    const p = deficitPlan(80, 75, '2026-09-02', '2026-11-01');
    expect(p.days).toBe(60);
    expect(p.perDay).toBe(600);
    expect(p.perWeek).toBe(4200);
    expect(p.perMonth).toBe(18000);
  });

  it('週1kg超のペースは tooFast、週0.5〜1kgは fast（安全ガードの文言を出す判定）', () => {
    expect(deficitPlan(80, 75, '2026-09-02', '2026-09-30').tooFast).toBe(true);   // 28日で5kg=1.25kg/週
    const fast = deficitPlan(80, 75, '2026-09-02', '2026-11-11');                 // 70日=0.5kg/週
    expect(fast.tooFast).toBe(false);
    expect(fast.fast).toBe(true);
    const gentle = deficitPlan(80, 75, '2026-09-02', '2026-12-11');               // 100日=0.35kg/週
    expect(gentle.tooFast).toBe(false);
    expect(gentle.fast).toBe(false);
  });

  it('目標日が今日以前でも0除算にならない（日数は最低1）', () => {
    const p = deficitPlan(80, 75, '2026-09-02', '2026-09-01');
    expect(p.days).toBe(1);
    expect(p.perDay).toBe(36000);
  });

  it('増量（目標>現在）は符号が反転する（総赤字・日・週が負＝黒字）', () => {
    const p = deficitPlan(70, 73, '2026-09-02', '2026-10-02'); // 30日で+3kg
    expect(p.direction).toBe('bulk');
    expect(p.total).toBe(-21600);
    expect(p.perDay).toBe(-720);
    expect(p.perWeek).toBe(-5040);
    expect(p.tooFast).toBe(false); // 増量ペースは減量の上限判定の対象外
  });

  it('目標=現在は維持（すべて0）', () => {
    const p = deficitPlan(70, 70, '2026-09-02', '2026-10-02');
    expect(p.direction).toBe('keep');
    expect(p.total).toBe(0);
    expect(p.perDay).toBe(0);
  });
});

describe('1日に食べられる量と手動調整', () => {
  it('食べられる量 = 維持 − 赤字/日 + 調整（BMRが下限）', () => {
    expect(dailyAllowance(2200, 500, 1600)).toBe(1700);
    expect(dailyAllowance(2200, 500, 1600, 200)).toBe(1900);   // ゆるめる
    expect(dailyAllowance(2200, 500, 1600, -500)).toBe(1600);  // きつくしてもBMRを割らない
    expect(dailyAllowance(2200, 0, 1600)).toBe(2200);          // 目標なし・調整なし＝維持そのまま
  });

  it('手動調整の幅は±1,000kcalに丸める（整数化・非数は0）', () => {
    expect(clampAdjust(150.4)).toBe(150);
    expect(clampAdjust(5000)).toBe(1000);
    expect(clampAdjust(-5000)).toBe(-1000);
    expect(clampAdjust(NaN)).toBe(0);
  });
});

describe('調整後の目標日の再計算', () => {
  it('赤字600kcal/日で5kg → 60日後', () => {
    expect(projectedTargetDate(80, 75, '2026-09-02', 600)).toBe('2026-11-01');
  });

  it('調整で赤字が減ると目標日は遠のく（正直に見せる）', () => {
    // 600 → 450kcal/日: 36,000/450 = 80日
    expect(projectedTargetDate(80, 75, '2026-09-02', 450)).toBe('2026-11-21');
  });

  it('赤字が0以下（維持ペース・逆方向）なら届かない＝null', () => {
    expect(projectedTargetDate(80, 75, '2026-09-02', 0)).toBeNull();
    expect(projectedTargetDate(80, 75, '2026-09-02', -100)).toBeNull();
  });

  it('増量は黒字（負の赤字）で到達日を出す', () => {
    expect(projectedTargetDate(70, 73, '2026-09-02', -720)).toBe('2026-10-02');
    expect(projectedTargetDate(70, 73, '2026-09-02', 720)).toBeNull(); // 減らす方向では届かない
  });

  it('目標=現在は今日', () => {
    expect(projectedTargetDate(70, 70, '2026-09-02', 500)).toBe('2026-09-02');
  });
});

describe('超過の3段階', () => {
  it('〜+300=mild / +300〜+800=mid / +800超=high・超過なし=none', () => {
    expect(overLevel(0)).toBe('none');
    expect(overLevel(-50)).toBe('none');
    expect(overLevel(1)).toBe('mild');
    expect(overLevel(300)).toBe('mild');
    expect(overLevel(301)).toBe('mid');
    expect(overLevel(800)).toBe('mid');
    expect(overLevel(801)).toBe('high');
  });
});

describe('週間・月間の収支', () => {
  const day = (date: string, intake: number | null, maintenance = 2200, allowance = 1700): BalanceDay =>
    ({ date, intake, maintenance, allowance });

  it('実績 = Σ(摂取 − 維持)、目標 = −赤字/日 × 日数。未記録日は合計に入れず点は空', () => {
    const b = balanceOf([
      day('d1', 1700), day('d2', 1900), day('d3', null), day('d4', 2600),
      day('d5', 1500), day('d6', 1800), day('d7', 1600),
    ], 500);
    // (−500) + (−300) + skip + (+400) + (−700) + (−400) + (−600) = −2,100
    expect(b.actual).toBe(-2100);
    expect(b.goal).toBe(-3500);
    expect(b.recorded).toBe(6);
    expect(b.days).toBe(7);
    expect(b.dots).toEqual(['even', 'over', 'none', 'over', 'under', 'even', 'even']);
  });

  it('増量では目標が正（黒字）になり、塗り率は同方向に進んだぶんだけ満ちる', () => {
    const bulk = balanceOf([day('d1', 2900, 2200, 2900), day('d2', 2600, 2200, 2900)], -700);
    expect(bulk.goal).toBe(1400);
    expect(bulk.actual).toBe(1100);
    expect(balanceFill(bulk)).toBeCloseTo(1100 / 1400);
    // 減量目標なのに黒字（逆方向）は0、超過達成は1で止める
    expect(balanceFill({ actual: 500, goal: -3500, recorded: 7, days: 7, dots: [] })).toBe(0);
    expect(balanceFill({ actual: -4000, goal: -3500, recorded: 7, days: 7, dots: [] })).toBe(1);
    expect(balanceFill({ actual: -1000, goal: 0, recorded: 7, days: 7, dots: [] })).toBe(0);
  });
});
