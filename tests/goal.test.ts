import { describe, it, expect } from 'vitest';
import { daysBetween, addDays, dateTicks, plannedWeightAt, computePlan, progressStatus, movingAverage, macroTargets, type Goal } from '../lib/goal';

const goal: Goal = {
  target_date: '2026-09-12',   // 開始から60日
  target_weight: 80,
  target_bf: 12,
  note: '腹筋を割りたい',
  start_date: '2026-07-14',
  start_weight: 86,
};

describe('daysBetween', () => {
  it('同日は0', () => expect(daysBetween('2026-07-14', '2026-07-14')).toBe(0));
  it('翌日は1', () => expect(daysBetween('2026-07-14', '2026-07-15')).toBe(1));
  it('60日間', () => expect(daysBetween('2026-07-14', '2026-09-12')).toBe(60));
  it('過去はマイナス', () => expect(daysBetween('2026-07-14', '2026-07-10')).toBe(-4));
});

describe('addDays / dateTicks（グラフ目盛り）', () => {
  it('addDays: 月またぎ', () => expect(addDays('2026-07-30', 3)).toBe('2026-08-02'));
  it('addDays: マイナス', () => expect(addDays('2026-07-01', -1)).toBe('2026-06-30'));
  it('dateTicks: 両端を含む7点（6分割）', () => {
    const t = dateTicks('2026-07-14', '2026-09-12', 6);
    expect(t[0]).toBe('2026-07-14');
    expect(t[t.length - 1]).toBe('2026-09-12');
    expect(t.length).toBe(7);
  });
  it('dateTicks: 期間が短ければ日数分だけ（重複なし）', () => {
    const t = dateTicks('2026-07-14', '2026-07-16', 6);
    expect(t).toEqual(['2026-07-14', '2026-07-15', '2026-07-16']);
  });
});

describe('plannedWeightAt（標準進捗の直線）', () => {
  it('開始日は開始体重', () => expect(plannedWeightAt(goal, '2026-07-14')).toBe(86));
  it('目標日は目標体重', () => expect(plannedWeightAt(goal, '2026-09-12')).toBe(80));
  it('中間(30日目)はちょうど半分', () => expect(plannedWeightAt(goal, '2026-08-13')).toBe(83));
  it('目標日以降は目標体重で頭打ち', () => expect(plannedWeightAt(goal, '2026-12-01')).toBe(80));
  it('開始日より前は開始体重', () => expect(plannedWeightAt(goal, '2026-07-01')).toBe(86));
  it('目標体重なしはnull', () => expect(plannedWeightAt({ ...goal, target_weight: null }, '2026-08-01')).toBeNull());
});

describe('computePlan（必要赤字の算定）', () => {
  it('6kg/60日 → 770kcal/日', () => {
    const p = computePlan(goal, '2026-07-14', 86, [])!;
    expect(p.remainingDays).toBe(60);
    expect(p.remainingKg).toBe(6);
    expect(p.remainingDeficit).toBe(46200);
    expect(p.requiredDaily).toBe(770);
  });
  it('飲み会2件(+800/+1000)を織り込むと通常日の必要赤字が増える', () => {
    const p = computePlan(goal, '2026-07-14', 86, [
      { date: '2026-07-20', title: '飲み会', extra_kcal: 800 },
      { date: '2026-08-01', title: '歓迎会', extra_kcal: 1000 },
    ])!;
    expect(p.eventsExtra).toBe(1800);
    expect(p.requiredDailyWithEvents).toBe(Math.round((46200 + 1800) / 60)); // 800
  });
  it('進捗が先行していれば必要赤字は減る', () => {
    const p = computePlan(goal, '2026-08-13', 82, [])!; // 標準83のところ実測82
    expect(p.remainingKg).toBe(2);
    expect(p.requiredDaily).toBe(Math.round((2 * 7700) / 30));
  });
  it('現実性: 700以下ok / 701-1000 hard / 1001以上 unrealistic', () => {
    expect(computePlan(goal, '2026-07-14', 85, [])!.feasibility).toBe('ok');        // 5kg/60日=642
    expect(computePlan(goal, '2026-07-14', 87, [])!.feasibility).toBe('hard');      // 7kg/60日=898
    expect(computePlan(goal, '2026-08-25', 86, [])!.feasibility).toBe('unrealistic'); // 6kg/18日=2567
  });
  it('目標日当日でも1日として扱う（ゼロ除算なし）', () => {
    const p = computePlan(goal, '2026-09-12', 81, [])!;
    expect(p.remainingDays).toBe(1);
  });
  it('目標体重なしはnull', () => {
    expect(computePlan({ ...goal, target_weight: null }, '2026-07-14', 86, [])).toBeNull();
  });
});

describe('computePlan（window方式: チートデイ後N日で取り返す）', () => {
  it('チートデイ翌日からN日間、超過/Nが上乗せされる', () => {
    // 7/20に+1400のチートデイ → 7日窓なら +200/日
    const p = computePlan(goal, '2026-07-21', 86, [
      { date: '2026-07-20', title: '飲み会', extra_kcal: 1400 },
    ], 7)!;
    expect(p.mode).toBe('window');
    expect(p.absorbToday).toBe(200);
    expect(p.requiredDailyWithEvents).toBe(p.requiredDaily + 200);
  });
  it('窓が終われば上乗せは消える', () => {
    const p = computePlan(goal, '2026-07-28', 86, [
      { date: '2026-07-20', title: '飲み会', extra_kcal: 1400 },
    ], 7)!;
    expect(p.absorbToday).toBe(0); // 8日経過→窓の外
  });
  it('複数チートデイの窓が重なれば合算', () => {
    const p = computePlan(goal, '2026-07-27', 86, [
      { date: '2026-07-25', title: 'A', extra_kcal: 700 },  // +100/日
      { date: '2026-07-26', title: 'B', extra_kcal: 1400 }, // +200/日
    ], 7)!;
    expect(p.absorbToday).toBe(300);
  });
  it('window方式では未来のチートデイは今日の必要赤字に影響しない', () => {
    const p = computePlan(goal, '2026-07-14', 86, [
      { date: '2026-08-01', title: '未来', extra_kcal: 2000 },
    ], 7)!;
    expect(p.absorbToday).toBe(0);
    expect(p.requiredDailyWithEvents).toBe(p.requiredDaily);
    expect(p.eventsExtra).toBe(2000); // 表示用の見込み合計には入る
  });
  it('チートデイ当日はまだ取り返し対象でない（翌日から）', () => {
    const p = computePlan(goal, '2026-07-20', 86, [
      { date: '2026-07-20', title: '当日', extra_kcal: 1400 },
    ], 7)!;
    expect(p.absorbToday).toBe(0);
  });
  it('spread方式(デフォルト)は従来どおり残り全日数で均等', () => {
    const p = computePlan(goal, '2026-07-14', 86, [
      { date: '2026-07-20', title: '飲み会', extra_kcal: 1800 },
    ])!;
    expect(p.mode).toBe('spread');
    expect(p.absorbToday).toBe(30); // 1800/60
  });
});

describe('macroTargets（1日の目標PFC）', () => {
  it('体重85kg・目標1900kcal・デフォルト係数(P2.0/F0.9)', () => {
    const m = macroTargets(85, 1900);
    expect(m.p).toBe(170);            // 85×2.0
    expect(m.f).toBe(77);             // 85×0.9=76.5→77
    // C = (1900 − 170×4 − 77×9) / 4 = (1900−680−693)/4 = 131.75 → 132
    expect(m.c).toBe(132);
  });
  it('係数を指定できる（P2.2/F0.7）', () => {
    const m = macroTargets(80, 2200, 2.2, 0.7);
    expect(m.p).toBe(176);
    expect(m.f).toBe(56);
    expect(m.c).toBe(Math.round((2200 - 176 * 4 - 56 * 9) / 4));
  });
  it('カロリーが小さくCがマイナスになる場合は0で下限', () => {
    const m = macroTargets(85, 800);
    expect(m.c).toBe(0);
  });
  it('係数null時はデフォルトが使われる', () => {
    const m = macroTargets(70, 2000, null, null);
    expect(m.p).toBe(140);
    expect(m.f).toBe(63);
  });
  it('脂質の絶対上限が体重×係数より低ければ上限を採用', () => {
    const m = macroTargets(85, 1900, 2.0, 0.9, 50); // 85×0.9=77 > 50
    expect(m.f).toBe(50);
    expect(m.c).toBe(Math.round((1900 - 170 * 4 - 50 * 9) / 4)); // Fが減った分Cが増える
  });
  it('絶対上限が体重×係数より高ければ係数側を採用', () => {
    const m = macroTargets(85, 1900, 2.0, 0.9, 120);
    expect(m.f).toBe(77);
  });
  it('絶対上限null/0は無視', () => {
    expect(macroTargets(85, 1900, 2.0, 0.9, null).f).toBe(77);
    expect(macroTargets(85, 1900, 2.0, 0.9, 0).f).toBe(77);
  });
});

describe('movingAverage（7日移動平均）', () => {
  it('窓内の点の平均になる', () => {
    const pts = [
      { date: '2026-07-01', weight: 86 },
      { date: '2026-07-03', weight: 85 },
      { date: '2026-07-05', weight: 87 },
    ];
    const ma = movingAverage(pts, 7);
    expect(ma[0].weight).toBe(86);              // 1点のみ
    expect(ma[1].weight).toBe(85.5);            // (86+85)/2
    expect(ma[2].weight).toBeCloseTo(86, 1);    // (86+85+87)/3
  });
  it('窓の外の古い点は含まない', () => {
    const pts = [
      { date: '2026-07-01', weight: 90 },
      { date: '2026-07-10', weight: 85 },       // 9日後→窓(7日)の外
    ];
    const ma = movingAverage(pts, 7);
    expect(ma[1].weight).toBe(85);
  });
  it('境界: ちょうど7日前は窓の外、6日前は窓の内', () => {
    const pts = [
      { date: '2026-07-01', weight: 90 },
      { date: '2026-07-07', weight: 84 },       // 6日差→含む
    ];
    expect(movingAverage(pts, 7)[1].weight).toBe(87);
    const pts2 = [
      { date: '2026-07-01', weight: 90 },
      { date: '2026-07-08', weight: 84 },       // 7日差→含まない
    ];
    expect(movingAverage(pts2, 7)[1].weight).toBe(84);
  });
  it('空配列は空を返す', () => {
    expect(movingAverage([], 7)).toEqual([]);
  });
});

describe('progressStatus（標準進捗との比較）', () => {
  it('標準どおりならontrack', () => {
    const s = progressStatus(goal, '2026-08-13', 83)!;
    expect(s.state).toBe('ontrack');
    expect(s.diffKg).toBe(0);
  });
  it('標準より軽ければahead・進んでいる日数がプラス', () => {
    const s = progressStatus(goal, '2026-08-13', 82)!; // 標準83、0.1kg/日ペース
    expect(s.state).toBe('ahead');
    expect(s.diffKg).toBe(-1);
    expect(s.diffDays).toBe(10);
  });
  it('標準より重ければbehind・遅れ日数がマイナス', () => {
    const s = progressStatus(goal, '2026-08-13', 83.5)!;
    expect(s.state).toBe('behind');
    expect(s.diffDays).toBe(-5);
  });
  it('±0.15kg以内はontrack', () => {
    expect(progressStatus(goal, '2026-08-13', 83.1)!.state).toBe('ontrack');
  });
});
