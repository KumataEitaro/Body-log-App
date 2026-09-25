// 過食リスク v2（lib/bingeRisk）: 「頻度↑と精度維持の両立は情報が増えたときだけ」を数式と合成データの両方で固定する。
// 乱数は種固定の mulberry32（実行のたびに同じ系列＝テストは決定的）
import {
  RISK_FEATURES, RISK_KEYS, PRIOR_BASE_RATE, DEFAULT_THRESHOLDS, DEFAULT_GUARD, MIN_DAYS_SILENT,
  featureVector, labelOf, fitRiskModel, predictRisk, assessBingeRiskV2, backtestBingeRisk,
  brierScore, aucOf, calibrationBins, precisionRecallAt, alertsAtPrecision,
  binormalPrecision, maxAlertRateAtPrecision, normCdf, normInv,
  guardThresholds, withinWeeklyBudget, effectiveThresholds, thresholdFromUtility, tierOf, intradayLogit, readinessOf,
  sigmoid, logit, fitMapLogistic,
  type AlertOutcome, type Pred,
} from '../bingeRisk';
import { emptyDayFeature, shiftDate, type DayFeature } from '../features';

const TODAY = '2026-06-30';

/** 種固定の PRNG（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 合成履歴。日ごとに外生変数（睡眠・気分・たんぱく質・食事回数・夜食比）を引き、その日の朝に分かる
 * 特徴ベクトルを本物の featureVector で組み、真の重み trueW（RISK_KEYS 順）でロジスティックに結果を引く。
 * 前日の赤字・前日の過食は生成の途中で自然に決まる（本物と同じ動的構造）
 */
function synth(n: number, seed: number, trueW: Record<string, number>, baseLogit: number, opts: { cycle?: boolean } = {}): DayFeature[] {
  const r = rng(seed);
  const rows: DayFeature[] = [];
  const start = shiftDate(TODAY, -(n - 1));
  const target = 2000;
  for (let i = 0; i < n; i++) {
    const row = emptyDayFeature(shiftDate(start, i));
    row.recorded = true;
    row.target = target;
    row.sleep_h = Math.round((5 + r() * 3.5) * 10) / 10;
    row.mood = 1 + Math.floor(r() * 5);
    row.protein_g = Math.round(60 + r() * 80);
    row.meal_count = 1 + Math.floor(r() * 4);
    row.late_eating = Math.round(r() * 100) / 100;
    row.active_kcal = Math.round(r() * 700);
    row.weight = 70;
    if (opts.cycle) row.cycle_day = 1 + ((i + 3) % 28);
    rows.push(row);
    // ローリング値（features.ts と同じ定義を最小限に再現）
    const moods: number[] = [];
    for (let k = Math.max(0, i - 2); k <= i; k++) if (rows[k].mood != null) moods.push(rows[k].mood as number);
    row.mood_avg3 = moods.length >= 2 ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10 : null;
    let debt = 0; let have = 0;
    for (let k = Math.max(0, i - 4); k <= i; k++) { const s = rows[k].sleep_h; if (s == null) continue; have++; debt += Math.max(0, 7 - s); }
    row.sleep_debt5 = have >= 3 ? Math.round(debt * 10) / 10 : null;
    // 結果
    const x = featureVector(rows, i, {});
    let z = baseLogit;
    RISK_KEYS.forEach((k, j) => { const v = x[j]; if (v) z += trueW[k] ?? 0; });
    const y = r() < sigmoid(z);
    if (y) {
      row.over = 900 + Math.round(r() * 600);
    } else {
      // 非過食日: 半分は大きめの赤字（次の日の prev_deficit を作る）
      row.over = r() < 0.5 ? -(300 + Math.round(r() * 400)) : Math.round(-250 + r() * 500);
    }
    row.intake = target + row.over;
    row.binge = row.over >= 800;
  }
  return rows;
}

/** 情報のある世界の真の重み（事前分布とだいたい同じ向き・少し強め） */
const INFORMATIVE: Record<string, number> = {
  prev_deficit: 1.0, deficit_streak3: 0.5, prev_binge: 0.8, binge_recent: 0.2, prev_unlogged: 0,
  sleep_short: 0.9, sleep_debt: 0.4, mood_low: 1.1, fri_sat: 0.7, prev_low_protein: 0.3,
  prev_late_eating: 0.5, prev_few_meals: 0.5, luteal: 0.6, planned_event: 0, prev_hard_exercise: 0.2, weight_up: 0,
};
/** 情報の無い世界: どの特徴も結果と無関係 */
const NOISE: Record<string, number> = Object.fromEntries(RISK_KEYS.map((k) => [k, 0]));

describe('bingeRisk: 特徴量', () => {
  it('RISK_FEATURES の key は一意で、label は日本語原文を持つ', () => {
    expect(new Set(RISK_KEYS).size).toBe(RISK_FEATURES.length);
    for (const f of RISK_FEATURES) { expect(f.label.length).toBeGreaterThan(0); expect(f.tau).toBeGreaterThan(0); }
  });

  it('朝に分かるものだけ: 前日の赤字・前日の過食・昨夜の睡眠・曜日。判定不能は null', () => {
    const rows = [emptyDayFeature(shiftDate(TODAY, -1)), emptyDayFeature(TODAY)];
    rows[0].intake = 1600; rows[0].over = -400; rows[0].binge = false; rows[0].recorded = true;
    rows[1].sleep_h = 5.5;
    const x = featureVector(rows, 1, {});
    const at = (k: string) => x[RISK_KEYS.indexOf(k)];
    expect(at('prev_deficit')).toBe(1);
    expect(at('prev_binge')).toBe(0);
    expect(at('sleep_short')).toBe(1);
    expect(at('sleep_debt')).toBeNull();          // 5日のうち3日の睡眠データが無い
    expect(at('mood_low')).toBeNull();            // 気分の記録なし
    expect(at('luteal')).toBeNull();              // 周期OFF
    expect(at('planned_event')).toBeNull();       // ctx なし
    expect(at('deficit_streak3')).toBeNull();     // 履歴3日未満
    expect(featureVector(rows, 1, { plannedEvent: 'drink' })[RISK_KEYS.indexOf('planned_event')]).toBe(1);
    expect(featureVector(rows, 1, { plannedEvent: 'none' })[RISK_KEYS.indexOf('planned_event')]).toBe(0);
  });

  it('labelOf: 摂取が無い日は null（学習にも評価にも使わない）', () => {
    const r = emptyDayFeature(TODAY);
    expect(labelOf(r)).toBeNull();
    r.intake = 3000; r.binge = true;
    expect(labelOf(r)).toBe(true);
  });
});

describe('bingeRisk: (d) 事前分布への縮小', () => {
  it('学習行が0なら重み＝事前平均・切片＝logit(事前基礎率)', () => {
    const m = fitRiskModel([]);
    expect(m.nTrain).toBe(0);
    expect(m.readiness).toBe('silent');
    m.weights.forEach((w, j) => expect(w).toBeCloseTo(RISK_FEATURES[j].prior, 9));
    expect(m.intercept).toBeCloseTo(logit(PRIOR_BASE_RATE), 9);
  });

  it('少ないデータ（14日）では重みは事前分布の近くに留まる（最大でも τ=0.7 未満・平均 0.2 未満）', () => {
    const rows = synth(14, 11, INFORMATIVE, logit(0.15));
    const m = fitRiskModel(rows);
    const dev = m.weights.map((w, j) => Math.abs(w - RISK_FEATURES[j].prior));
    expect(Math.max(...dev)).toBeLessThan(0.7);
    expect(dev.reduce((a, b) => a + b, 0) / dev.length).toBeLessThan(0.2);
  });

  it('十分なデータでは本人の真の重みへ動く（事前より真値に近づく）', () => {
    // 事前 0.5 に対して真値 2.0 の強い因子（prev_deficit）と、事前 0.6 に対して真値 0 の因子（prev_binge）
    const W = { ...NOISE, prev_deficit: 2.0, prev_binge: 0 };
    const rows = synth(400, 7, W, logit(0.12));
    const m = fitRiskModel(rows);
    const j1 = RISK_KEYS.indexOf('prev_deficit'); const j2 = RISK_KEYS.indexOf('prev_binge');
    expect(Math.abs(m.weights[j1] - 2.0)).toBeLessThan(Math.abs(RISK_FEATURES[j1].prior - 2.0));
    expect(m.weights[j1]).toBeGreaterThan(1.2);
    expect(Math.abs(m.weights[j2] - 0)).toBeLessThan(Math.abs(RISK_FEATURES[j2].prior - 0));
  });

  it('決定的: 同じ入力なら同じ出力。null の特徴は寄与しない', () => {
    const rows = synth(60, 3, INFORMATIVE, logit(0.15));
    const a = fitRiskModel(rows); const b = fitRiskModel(rows);
    expect(a.weights).toEqual(b.weights);
    const x = RISK_KEYS.map(() => null as 0 | 1 | null);
    const pred = predictRisk(a, x);
    expect(pred.contributions).toHaveLength(0);
    expect(pred.p).toBeCloseTo(sigmoid(a.intercept), 12);
  });

  it('fitMapLogistic は完全分離でも発散しない（事前分布が正則化する）', () => {
    const X = [[1, 1], [1, 1], [1, 1], [1, 0], [1, 0], [1, 0]];
    const y = [1, 1, 1, 0, 0, 0];
    const { w } = fitMapLogistic(X, y, [0, 0], [1, 1]);
    expect(Number.isFinite(w[1])).toBe(true);
    expect(w[1]).toBeGreaterThan(0.5);
    expect(w[1]).toBeLessThan(6);
  });
});

describe('bingeRisk: (a) 頻度↑と精度維持は「情報が増えたときだけ」両立する', () => {
  it('理論（二正規モデル）: 同じ AUC ではアラート率を上げると精度は単調に下がる', () => {
    for (const auc of [0.65, 0.75, 0.85]) {
      let prev = 1;
      for (const perWeek of [0.5, 1, 2, 3, 4]) {
        const { precision } = binormalPrecision(auc, 0.08, perWeek / 7);
        expect(precision).toBeLessThanOrEqual(prev + 1e-9);
        prev = precision;
      }
    }
    // 基礎率 8%・精度床 0.5 を守れる週あたり本数: AUC 0.75 で約0.05本、0.85 で約0.37本、0.90 で約0.63本
    expect(maxAlertRateAtPrecision(0.75, 0.08, 0.5) * 7).toBeCloseTo(0.05, 1);
    expect(maxAlertRateAtPrecision(0.85, 0.08, 0.5) * 7).toBeCloseTo(0.37, 1);
    expect(maxAlertRateAtPrecision(0.9, 0.08, 0.5) * 7).toBeCloseTo(0.63, 1);
    // AUC が高いほど、同じ床で出せる本数は増える（＝両立の唯一の道は判別力）
    expect(maxAlertRateAtPrecision(0.85, 0.08, 0.3)).toBeGreaterThan(maxAlertRateAtPrecision(0.75, 0.08, 0.3));
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normInv(normCdf(1.3))).toBeCloseTo(1.3, 4);
  });

  // 情報のある世界: 基礎 logit(0.008) に特徴の寄与が乗って周辺の過食率 ≈ 12–13%/日（現実的な水準）
  // 情報の無い世界: 特徴は無関係で、過食率だけ同程度（≈12%）に合わせる
  it('合成データ: 特徴に情報があるときだけ、精度床を守ったまま出せる本数が増える', () => {
    const informative = backtestBingeRisk(synth(300, 33, INFORMATIVE, logit(0.008)));
    const noise = backtestBingeRisk(synth(300, 33, NOISE, logit(0.12)));
    expect(informative.n).toBeGreaterThan(250);
    expect(informative.baseRate).toBeGreaterThan(0.08);
    expect(informative.baseRate).toBeLessThan(0.2);
    expect(informative.auc as number).toBeGreaterThan(0.72);
    expect(Math.abs((noise.auc as number) - 0.5)).toBeLessThan(0.2);
    // モデルが基礎率より情報を持つ（Brier が「常に基礎率」より小さい）のは情報のある世界だけ
    expect(informative.brier).toBeLessThan(informative.brierBase);
    expect(noise.brier).toBeGreaterThanOrEqual(noise.brierBase - 0.01);
    // 精度床 0.35 を守れる本数
    const a = alertsAtPrecision(informative.preds, 0.35);
    const b = alertsAtPrecision(noise.preds, 0.35);
    expect(a.alertsPerWeek).toBeGreaterThan(0.5);
    expect(a.alertsPerWeek).toBeGreaterThan(b.alertsPerWeek * 2);
  });

  it('合成データ: 同じモデルで本数を増やすと精度は下がる（上位5件 ≥ 上位25件 ≥ 上位60件）', () => {
    const bt = backtestBingeRisk(synth(300, 33, INFORMATIVE, logit(0.008)));
    const sorted = [...bt.preds].sort((x, y) => y.p - x.p);
    const precAt = (k: number) => sorted.slice(0, k).filter((q) => q.y).length / k;
    expect(precAt(5)).toBeGreaterThanOrEqual(precAt(25));
    expect(precAt(25)).toBeGreaterThanOrEqual(precAt(60));
  });

  it('段（tier）: nudge は warning より多く出て、warning は nudge より精度が高い', () => {
    const bt = backtestBingeRisk(synth(300, 33, INFORMATIVE, logit(0.008)));
    const { nudge, warning } = bt.tiers;
    expect(nudge.alerts).toBeGreaterThan(warning.alerts);
    expect(warning.alerts).toBeGreaterThan(0);
    expect(warning.precision as number).toBeGreaterThanOrEqual(nudge.precision as number);
  });
});

describe('bingeRisk: (c) 較正の算術', () => {
  it('Brier: 完全予測で0・「常に0.2」で 0.2×0.64+0.8×0.04=0.16', () => {
    const preds: Pred[] = [];
    for (let i = 0; i < 100; i++) preds.push({ date: shiftDate(TODAY, -i), p: 0.2, y: i < 20 });
    expect(brierScore(preds)).toBeCloseTo(0.16, 9);
    expect(brierScore(preds.map((q) => ({ ...q, p: q.y ? 1 : 0 })))).toBe(0);
    expect(Number.isNaN(brierScore([]))).toBe(true);
  });

  it('較正ビン: 各ビンの平均予測と実際の発生率が並ぶ', () => {
    const preds: Pred[] = [];
    for (let i = 0; i < 50; i++) preds.push({ date: shiftDate(TODAY, -i), p: 0.07, y: i < 4 });        // 8%
    for (let i = 0; i < 40; i++) preds.push({ date: shiftDate(TODAY, -100 - i), p: 0.4, y: i < 16 });  // 40%
    const bins = calibrationBins(preds);
    const b1 = bins.find((b) => b.lo === 0.05)!; const b4 = bins.find((b) => b.lo === 0.35)!;
    expect(b1.n).toBe(50); expect(b1.meanP).toBeCloseTo(0.07); expect(b1.rate).toBeCloseTo(0.08);
    expect(b4.n).toBe(40); expect(b4.meanP).toBeCloseTo(0.4); expect(b4.rate).toBeCloseTo(0.4);
    expect(bins.reduce((a, b) => a + b.n, 0)).toBe(90);
  });

  it('AUC: 完全な順位で1・定数で0.5・陽性が無ければ null。precisionRecallAt / alertsAtPrecision', () => {
    const preds: Pred[] = [
      { date: 'a', p: 0.9, y: true }, { date: 'b', p: 0.8, y: true }, { date: 'c', p: 0.3, y: false },
      { date: 'd', p: 0.2, y: false }, { date: 'e', p: 0.1, y: false }, { date: 'f', p: 0.05, y: false }, { date: 'g', p: 0.5, y: false },
    ];
    expect(aucOf(preds)).toBeCloseTo(1);
    expect(aucOf(preds.map((q) => ({ ...q, p: 0.3 })))).toBeCloseTo(0.5);
    expect(aucOf(preds.filter((q) => !q.y))).toBeNull();
    const s = precisionRecallAt(preds, 0.5);
    expect(s.alerts).toBe(3); expect(s.hits).toBe(2); expect(s.precision).toBeCloseTo(2 / 3); expect(s.recall).toBe(1);
    expect(s.alertsPerWeek).toBeCloseTo(3);
    // 上位4件（0.9T, 0.8T, 0.5F, 0.3F）でちょうど精度 0.5 → 床を守れる最大は4件
    const a = alertsAtPrecision(preds, 0.5);
    expect(a.alerts).toBe(4); expect(a.threshold).toBe(0.3); expect(a.recall).toBe(1);
    expect(alertsAtPrecision(preds, 0.99).alerts).toBe(2);
    expect(alertsAtPrecision(preds.map((q) => ({ ...q, y: false })), 0.1).alerts).toBe(0);
  });

  it('バックテストの Brier は「常に基礎率」と比べられる。評価日は学習日数が足りる日だけ', () => {
    const rows = synth(60, 9, INFORMATIVE, logit(0.1));
    const bt = backtestBingeRisk(rows);
    expect(bt.n).toBe(60 - MIN_DAYS_SILENT);
    expect(bt.preds[0].date).toBe(rows[MIN_DAYS_SILENT].date);
    expect(Number.isFinite(bt.brierBase)).toBe(true);
    expect(bt.bins).toHaveLength(6);
  });
});

describe('bingeRisk: (b) 自己制限ガード', () => {
  const hist = (spec: { daysAgo: number; tier: 'nudge' | 'warning'; hit: boolean | null }[]): AlertOutcome[] =>
    spec.map((s) => ({ date: shiftDate(TODAY, -s.daysAgo), tier: s.tier, p: 0.2, outcome: s.hit }));

  it('直近28日の nudge の精度が床（0.15）を下回ると閾値が上がる（頻度が減る）。基準より下には下がらない', () => {
    const bad = hist(Array.from({ length: 10 }, (_v, i) => ({ daysAgo: 2 + i * 2, tier: 'nudge' as const, hit: i === 0 })));   // 1/10
    const g = guardThresholds(bad, DEFAULT_THRESHOLDS, TODAY);
    expect(g.precision.nudge).toBeCloseTo(0.1);
    expect(g.raised.nudge).toBe(true);
    expect(g.thresholds.nudge).toBeGreaterThan(DEFAULT_THRESHOLDS.nudge);
    expect(g.thresholds.nudge).toBeLessThanOrEqual(DEFAULT_THRESHOLDS.nudge * DEFAULT_GUARD.maxRaise + 1e-9);
    expect(g.thresholds.warning).toBeGreaterThanOrEqual(g.thresholds.nudge);
    const good = hist(Array.from({ length: 10 }, (_v, i) => ({ daysAgo: 2 + i * 2, tier: 'nudge' as const, hit: i < 5 })));   // 5/10
    const g2 = guardThresholds(good, DEFAULT_THRESHOLDS, TODAY);
    expect(g2.raised.nudge).toBe(false);
    expect(g2.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('結果が分からないアラート・古いアラート・今日のアラートは数えない（時効で自然に戻る）', () => {
    const unresolved = hist(Array.from({ length: 10 }, (_v, i) => ({ daysAgo: 2 + i, tier: 'nudge' as const, hit: null })));
    expect(guardThresholds(unresolved, DEFAULT_THRESHOLDS, TODAY).resolved.nudge).toBe(0);
    const old = hist(Array.from({ length: 10 }, (_v, i) => ({ daysAgo: 40 + i, tier: 'nudge' as const, hit: false })));
    expect(guardThresholds(old, DEFAULT_THRESHOLDS, TODAY).raised.nudge).toBe(false);
    const few = hist(Array.from({ length: 5 }, (_v, i) => ({ daysAgo: 2 + i, tier: 'nudge' as const, hit: false })));   // minResolved=6 未満
    expect(guardThresholds(few, DEFAULT_THRESHOLDS, TODAY).raised.nudge).toBe(false);
  });

  it('warning の床は 0.30。精度が悪いと warning だけ上がる', () => {
    const w = hist(Array.from({ length: 8 }, (_v, i) => ({ daysAgo: 1 + i * 3, tier: 'warning' as const, hit: i === 0 })));   // 1/8
    const g = guardThresholds(w, DEFAULT_THRESHOLDS, TODAY);
    expect(g.raised.warning).toBe(true);
    expect(g.raised.nudge).toBe(false);
    expect(g.thresholds.warning).toBeGreaterThan(DEFAULT_THRESHOLDS.warning);
  });

  it('週予算: 直近7日に nudge が4本あれば今日は出さない。warning は2本', () => {
    const four = hist([1, 2, 4, 6].map((d) => ({ daysAgo: d, tier: 'nudge' as const, hit: null })));
    expect(withinWeeklyBudget(four, TODAY, 'nudge')).toBe(false);
    expect(withinWeeklyBudget(four.slice(0, 3), TODAY, 'nudge')).toBe(true);
    expect(withinWeeklyBudget(four, TODAY, 'warning')).toBe(true);
    const twoW = hist([1, 3].map((d) => ({ daysAgo: d, tier: 'warning' as const, hit: null })));
    expect(withinWeeklyBudget(twoW, TODAY, 'warning')).toBe(false);
    // 8日前は数えない
    const stale = hist([8, 9, 10, 11].map((d) => ({ daysAgo: d, tier: 'nudge' as const, hit: null })));
    expect(withinWeeklyBudget(stale, TODAY, 'nudge')).toBe(true);
  });
});

describe('bingeRisk: 段・閾値・時間内ハザード・今日の判定', () => {
  it('閾値は期待効用から: nudge ≈ 0.156、warning ≈ 0.39。基礎率の床（1.5倍 / 3倍）が上回れば床が勝つ', () => {
    expect(thresholdFromUtility({ costFalseAlarm: 1, benefitPrevented: 8, efficacy: 0.8 })).toBeCloseTo(0.15625, 6);
    expect(DEFAULT_THRESHOLDS.nudge).toBeCloseTo(0.156, 2);
    expect(DEFAULT_THRESHOLDS.warning).toBeCloseTo(0.39, 2);
    const low = effectiveThresholds(DEFAULT_THRESHOLDS, 0.05);
    expect(low).toEqual(DEFAULT_THRESHOLDS);
    const high = effectiveThresholds(DEFAULT_THRESHOLDS, 0.3);
    expect(high.nudge).toBeCloseTo(0.45);
    expect(high.warning).toBeCloseTo(0.9);
    expect(thresholdFromUtility({ costFalseAlarm: 1, benefitPrevented: 0, efficacy: 1 })).toBe(1);
  });

  it('tierOf: silent は常に quiet、prior は nudge 止まり、full で warning', () => {
    const th = DEFAULT_THRESHOLDS;
    expect(tierOf(0.9, th, 'silent')).toBe('quiet');
    expect(tierOf(0.9, th, 'prior')).toBe('nudge');
    expect(tierOf(0.9, th, 'full')).toBe('warning');
    expect(tierOf(0.2, th, 'full')).toBe('nudge');
    expect(tierOf(0.1, th, 'full')).toBe('quiet');
    expect(readinessOf(10, 5)).toBe('silent');
    expect(readinessOf(20, 5)).toBe('prior');
    expect(readinessOf(40, 2)).toBe('prior');
    expect(readinessOf(40, 3)).toBe('full');
  });

  it('intradayLogit: 朝は0、夕方+0.3、夜+0.6、空腹5h+0.3/7h+0.5、合計は1.0で頭打ち', () => {
    expect(intradayLogit(9, 2)).toBe(0);
    expect(intradayLogit(18, null)).toBeCloseTo(0.3);
    expect(intradayLogit(21, null)).toBeCloseTo(0.6);
    expect(intradayLogit(null, 5.5)).toBeCloseTo(0.3);
    expect(intradayLogit(null, 8)).toBeCloseTo(0.5);
    expect(intradayLogit(22, 8)).toBe(1);
  });

  it('assessBingeRiskV2: 今日より前だけで学習し、今日の理由を正の寄与で返す。今日の結果は使わない（リーク防止）', () => {
    const rows = synth(90, 13, INFORMATIVE, logit(0.01));
    const today = rows[rows.length - 1];
    // 今日の朝に分かる条件を強く立てる
    today.sleep_h = 5; rows[rows.length - 2].over = -500; rows[rows.length - 2].intake = 1500; rows[rows.length - 2].binge = false;
    rows[rows.length - 2].mood = 1;
    const withBinge = assessBingeRiskV2(rows, today.date, { hour: 21, hoursSinceLastMeal: 6, plannedEvent: 'drink' });
    today.intake = 1500; today.over = -500; today.binge = false;
    const withoutBinge = assessBingeRiskV2(rows, today.date, { hour: 21, hoursSinceLastMeal: 6, plannedEvent: 'drink' });
    expect(withBinge.pDay).toBeCloseTo(withoutBinge.pDay, 12);   // 今日のラベルは判定に影響しない
    expect(withBinge.readiness).toBe('full');
    expect(withBinge.pNow).toBeGreaterThan(withBinge.pDay);       // 夜＋空腹＋飲み会でいまの確率は上がる
    expect(withBinge.reasons.length).toBeGreaterThan(0);
    expect(withBinge.reasons.every((c) => c.delta > 0)).toBe(true);
    expect(withBinge.reasons.map((c) => c.key)).toContain('planned_event');
    expect(withBinge.reasons.some((c) => c.key === 'sleep_short' || c.key === 'prev_deficit' || c.key === 'mood_low')).toBe(true);
    expect(withBinge.model.nTrain).toBe(89);
    expect(Object.keys(withBinge.model.weights)).toEqual(RISK_KEYS);
    // 今日の行が無ければ silent
    expect(assessBingeRiskV2(rows.slice(0, -1), today.date).tier).toBe('quiet');
  });

  it('データが14日未満なら silent（何も出さない）', () => {
    const rows = synth(10, 2, INFORMATIVE, logit(0.3));
    const r = assessBingeRiskV2(rows, rows[rows.length - 1].date, { hour: 22 });
    expect(r.readiness).toBe('silent');
    expect(r.tier).toBe('quiet');
  });
});
