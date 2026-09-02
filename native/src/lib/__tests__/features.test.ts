// 日次特徴量（lib/features.deriveDayFeatures）の派生ロジックを固定する。
// 系列は「窓の全日を密に持つ」「ローリング値は履歴不足なら null」が前提
import { deriveDayFeatures, summarizeRecent, timeSlotIndex, shiftDate, type FeatureRaw } from '../features';

const TODAY = '2026-06-30';

function raw(over: Partial<FeatureRaw> = {}): FeatureRaw {
  return { today: TODAY, days: 10, entries: [], logs: [], health: [], stages: [], cycleStarts: [], cycleEnabled: false, ...over };
}

describe('deriveDayFeatures: 骨格', () => {
  it('窓の全日を昇順・密に返し、記録が無い日は recorded=false・null 列', () => {
    const rows = deriveDayFeatures(raw());
    expect(rows).toHaveLength(10);
    expect(rows[0].date).toBe(shiftDate(TODAY, -9));
    expect(rows[9].date).toBe(TODAY);
    expect(rows[5].recorded).toBe(false);
    expect(rows[5].intake).toBeNull();
    expect(rows[5].sleep_debt5).toBeNull();
    expect(rows[5].lift_volume_kg).toBe(0);
  });

  it('食: over / binge（+800超過 or 2,500超）/ たんぱく質', () => {
    const rows = deriveDayFeatures(raw({ entries: [
      { date: shiftDate(TODAY, -2), intake: 2900, p: 90, weight: null, mood: null, target: 2100 },   // +800 → binge
      { date: shiftDate(TODAY, -1), intake: 2600, p: 80, weight: null, mood: null, target: 2400 },   // +200 だが 2,500超 → binge
      { date: TODAY, intake: 2000, p: 70, weight: null, mood: null, target: 2100 },                  // −100 → 非binge
    ] }));
    expect(rows[7].over).toBe(800);
    expect(rows[7].binge).toBe(true);
    expect(rows[8].binge).toBe(true);
    expect(rows[9].binge).toBe(false);
    expect(rows[9].protein_g).toBe(70);
    expect(rows[9].recorded).toBe(true);
  });
});

describe('deriveDayFeatures: ローリング値', () => {
  it('sleep_debt5 = 直近5日の Σmax(0, 7−sleep)。データ3日未満なら null', () => {
    const health = [5, 6, 8, 6.5, 7].map((h, i) => ({ date: shiftDate(TODAY, -(4 - i)), steps: 0, sleepH: h, activeKcal: 0 }));
    const rows = deriveDayFeatures(raw({ health }));
    // 不足: 2 + 1 + 0 + 0.5 + 0 = 3.5
    expect(rows[9].sleep_debt5).toBe(3.5);
    // 3日目（データ3日）: 2+1+0 = 3
    expect(rows[7].sleep_debt5).toBe(3);
    // 2日目はデータ2日 → null
    expect(rows[6].sleep_debt5).toBeNull();
    expect(rows[9].sleep_h).toBe(7);
  });

  it('mood_avg3 は3日のうち2日以上に気分があるときだけ。weight_delta7 は7日前との差', () => {
    const entries = [
      { date: shiftDate(TODAY, -7), intake: null, p: null, weight: 70.0, mood: null, target: null },
      { date: shiftDate(TODAY, -2), intake: null, p: null, weight: null, mood: '2/5', target: null },
      { date: shiftDate(TODAY, -1), intake: null, p: null, weight: null, mood: null, target: null },
      { date: TODAY, intake: null, p: null, weight: 69.2, mood: '4/5', target: null },
    ];
    const rows = deriveDayFeatures(raw({ entries }));
    expect(rows[9].mood).toBe(4);
    expect(rows[9].mood_avg3).toBe(3);        // (2+4)/2
    expect(rows[7].mood_avg3).toBeNull();     // 前2日に気分なし → 1日だけ → null
    expect(rows[9].weight_delta7).toBe(-0.8);
    expect(rows[2].weight_delta7).toBeNull(); // 7日前が窓の外
  });
});

describe('deriveDayFeatures: ログ（時間帯・食材・筋トレ）', () => {
  it('time_slots は8区分のkcalシェア、late_eating は夜(20–23)＋深夜のシェア。食材gは辞書から', () => {
    const d = TODAY;
    const rows = deriveDayFeatures(raw({ logs: [
      { date: d, at: `${d}T08:00:00+09:00`, text: 'パン', items: [{ name: '食パン', qty: '2枚', kcal: 300 }] },
      { date: d, at: `${d}T21:30:00+09:00`, text: '夜', items: [{ name: 'ラーメン', qty: '1杯', kcal: 700 }] },
    ] }));
    const r = rows[9];
    expect(r.meal_count).toBe(2);
    expect(r.time_slots[1]).toBe(0.3);   // 朝7–10
    expect(r.time_slots[6]).toBe(0.7);   // 夜20–23
    expect(r.late_eating).toBe(0.7);
    expect(r.wheat_g).toBe(120 + 150);   // 2枚×60 + 1杯×150
    expect(r.rice_g).toBe(0);
    expect(timeSlotIndex(23)).toBe(7);
    expect(timeSlotIndex(3)).toBe(7);
    expect(timeSlotIndex(4)).toBe(0);
  });

  it('🏋️ログ: ボリューム・セッション数・自己ベスト（推定1RMが窓内の過去最高を超えた）', () => {
    const d1 = shiftDate(TODAY, -5); const d2 = TODAY;
    const rows = deriveDayFeatures(raw({ logs: [
      { date: d1, at: null, text: '🏋️ ベンチプレス 80kg×8×3', items: [] },
      { date: d2, at: null, text: '🏋️ ベンチプレス 85kg×8×3', items: [] },
    ] }));
    expect(rows[4].lift_sessions).toBe(1);
    expect(rows[4].lift_volume_kg).toBe(80 * 8 * 3);
    expect(rows[4].pr).toBe(false);            // 履歴が無い初回は自己ベストと呼ばない
    expect(rows[4].e1rm_delta).toBeNull();
    expect(rows[9].pr).toBe(true);
    expect(rows[9].e1rm_delta).toBeGreaterThan(0);
    expect(rows[9].recorded).toBe(true);
    expect(rows[9].meal_count).toBe(0);        // 運動ログは食事に数えない
  });
});

describe('deriveDayFeatures: 周期・サマリ', () => {
  it('生理周期がOFFなら cycle_day は null のまま。ONなら周期日と水分窓', () => {
    const start = shiftDate(TODAY, -2);
    const off = deriveDayFeatures(raw({ cycleStarts: [start], cycleEnabled: false }));
    expect(off[9].cycle_day).toBeNull();
    const on = deriveDayFeatures(raw({ cycleStarts: [start], cycleEnabled: true }));
    expect(on[9].cycle_day).toBe(3);
    expect(on[9].water_window).toBe(true);
    expect(on[0].water_window).toBe(false);
  });

  it('summarizeRecent: 直近7日の平均と日数', () => {
    const health = [6, 7, 8].map((h, i) => ({ date: shiftDate(TODAY, -(2 - i)), steps: 8000, sleepH: h, activeKcal: 0 }));
    const entries = [{ date: TODAY, intake: 3000, p: null, weight: null, mood: '3/5', target: 2000 }];
    const s = summarizeRecent(deriveDayFeatures(raw({ health, entries })), 7);
    expect(s.days).toBe(7);
    expect(s.sleepAvg).toBe(7);
    expect(s.stepsAvg).toBe(8000);
    expect(s.moodAvg).toBe(3);
    expect(s.overDays).toBe(1);
    expect(s.bingeDays).toBe(1);
    expect(s.recordedDays).toBe(1);
  });
});
