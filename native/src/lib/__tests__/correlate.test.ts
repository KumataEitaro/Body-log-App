// 相関エンジン（lib/correlate）: Spearman・リスク比・多要素ルール・§8アラートと抑制。
// テストはロケール未設定（=日本語キーがそのまま返る）前提で日本語文字列を比較する
import {
  rankAvg, spearman, laggedSpearman, spearmanSignificant, riskRatio, confidenceOf,
  mineRules, conditionLabel, evaluateAlerts, suppressAlerts, MIN_DAYS, type Insight,
} from '../correlate';
import { emptyDayFeature, shiftDate, type DayFeature } from '../features';

const TODAY = '2026-06-30';

/** 密な系列: 今日を末尾に n 日。fill(i, row) で各行を上書き */
function series(n: number, fill: (i: number, r: DayFeature) => void): DayFeature[] {
  const out: DayFeature[] = [];
  for (let i = 0; i < n; i++) {
    const r = emptyDayFeature(shiftDate(TODAY, -(n - 1 - i)));
    fill(i, r);
    out.push(r);
  }
  return out;
}

describe('correlate: Spearman', () => {
  it('rankAvg は同順位を平均順位にする', () => {
    expect(rankAvg([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('単調増加で ρ=1、逆で ρ=−1。null の対は落とす', () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])!.rho).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])!.rho).toBeCloseTo(-1);
    const r = spearman([1, null, 3, 4, 5], [10, 20, null, 40, 50]);
    expect(r!.n).toBe(3);
  });

  it('n<3 または定数列は null', () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });

  it('laggedSpearman は xs[t−lag] と ys[t] を対にする', () => {
    // ys は xs を1日遅らせたもの → lag=1 で完全相関、lag=0 では崩れる
    const xs = [5, 1, 4, 2, 3, 6, 0, 7];
    const ys = [null, ...xs.slice(0, -1)];
    expect(laggedSpearman(xs, ys, 1)!.rho).toBeCloseTo(1);
    expect(Math.abs(laggedSpearman(xs, ys, 0)!.rho)).toBeLessThan(1);
    expect(laggedSpearman(xs, ys, 99)).toBeNull();
  });

  it('spearmanSignificant: n=14 なら |ρ|≥0.52 程度、n=90 なら 0.22 程度で有意', () => {
    expect(spearmanSignificant(0.55, 14)).toBe(true);
    expect(spearmanSignificant(0.45, 14)).toBe(false);
    expect(spearmanSignificant(0.25, 90)).toBe(true);
    expect(spearmanSignificant(0.9, 3)).toBe(false);
  });
});

describe('correlate: riskRatio / confidence', () => {
  type R = { c: boolean | null; o: boolean | null };
  const rows = (spec: [boolean | null, boolean | null][]): R[] => spec.map(([c, o]) => ({ c, o }));

  it('P(結果|条件)/P(結果|条件なし)。null は数えない', () => {
    // 条件あり4日中2回、なし4日中1回 → 0.5/0.25 = 2
    const rr = riskRatio(rows([[true, true], [true, true], [true, false], [true, false], [false, true], [false, false], [false, false], [false, false], [null, true], [true, null]]),
      (r) => r.c, (r) => r.o);
    expect(rr!.rr).toBeCloseTo(2);
    expect(rr!.n).toBe(8);
    expect(rr!.baseRate).toBeCloseTo(3 / 8);
  });

  it('両群が4日未満なら null（安全弁）', () => {
    expect(riskRatio(rows([[true, true], [true, true], [true, false], [false, true], [false, false], [false, false], [false, false]]), (r) => r.c, (r) => r.o)).toBeNull();
  });

  it('条件なし群で0回なら Haldane 補正で有限の倍率、5倍で頭打ち', () => {
    const rr = riskRatio(rows([[true, true], [true, true], [true, true], [true, true], [false, false], [false, false], [false, false], [false, false]]), (r) => r.c, (r) => r.o);
    expect(rr!.rr).toBe(5);
    const zero = riskRatio(rows([[true, false], [true, false], [true, false], [true, false], [false, true], [false, false], [false, false], [false, false]]), (r) => r.c, (r) => r.o);
    expect(zero!.rr).toBe(0);
  });

  it('confidenceOf: n と効果量から3段階', () => {
    expect(confidenceOf(30, true)).toBe('high');
    expect(confidenceOf(30, false)).toBe('mid');
    expect(confidenceOf(21, false)).toBe('mid');
    expect(confidenceOf(14, true)).toBe('mid');
    expect(confidenceOf(14, false)).toBe('low');
  });
});

/**
 * 仕込み: 42日。睡眠負債≥5h は i%3==0 の日、前日の気分低（mood≤2）は奇数日に置く＝偶数日で真。
 * 両方そろう日 = i%6==0（i=6..36 の6日。i=0 は前日が無い）。食べすぎはその6日＋i=5 の1日
 */
function plantedBinge(): DayFeature[] {
  return series(42, (i, r) => {
    r.recorded = true;
    r.intake = 2000; r.target = 2000; r.over = 0;
    r.sleep_h = 7;
    r.sleep_debt5 = i % 3 === 0 ? 6 : 1;
    r.mood = i % 2 === 1 ? 1 : 4;
    const both = i % 6 === 0 && i > 0;
    if (both || i === 5) { r.binge = true; r.over = 900; r.intake = 2900; }
  });
}

describe('correlate: mineRules', () => {
  it('n<14 なら空（安全弁）', () => {
    const rows = series(13, (_i, r) => { r.recorded = true; r.intake = 2000; r.binge = true; });
    expect(mineRules(rows, 'binge')).toEqual([]);
  });

  it('仕込んだ2因子ルール（睡眠負債×前日気分低）を最上位で見つけ、部分集合の単独ルールは畳む', () => {
    const rules = mineRules(plantedBinge(), 'binge', { minSupport: 6, minLift: 1.5, maxFactors: 3 });
    expect(rules.length).toBeGreaterThan(0);
    const top = rules[0];
    expect(top.factors).toEqual(['prev_mood_low', 'sleep_debt5_ge5']);
    expect(top.id).toBe('rule:binge:prev_mood_low+sleep_debt5_ge5');
    expect(top.effect).toBeGreaterThanOrEqual(1.5);
    expect(top.support).toBe(6);
    expect(top.hits).toBe(6);
    expect(top.evidenceKey).toBe('multi_binge');
    expect(top.kind).toBe('rule');
    expect(top.n).toBeGreaterThanOrEqual(MIN_DAYS);
    // 単独の sleep_debt5_ge5 は上位集合が採択されたので出さない
    expect(rules.find((r) => r.factors.length === 1 && r.factors[0] === 'sleep_debt5_ge5')).toBeUndefined();
    expect(top.text).toContain('「前日の気分が低め」「睡眠不足が5時間以上たまっている」がそろった日は、食べすぎが');
  });

  it('決定的: 同じ入力なら同じ id・同じ順', () => {
    const a = mineRules(plantedBinge(), 'binge').map((r) => r.id);
    const b = mineRules(plantedBinge(), 'binge').map((r) => r.id);
    expect(a).toEqual(b);
  });

  it('maxFactors=1 なら単独ルールだけ。minLift を上げると採択されない', () => {
    const singles = mineRules(plantedBinge(), 'binge', { maxFactors: 1 });
    expect(singles.every((r) => r.factors.length === 1)).toBe(true);
    expect(singles.some((r) => r.factors[0] === 'sleep_debt5_ge5')).toBe(true);
    expect(mineRules(plantedBinge(), 'binge', { minLift: 100 })).toEqual([]);
  });

  it('未知の結果キーは空。conditionLabel は曜日を組み立てる', () => {
    expect(mineRules(plantedBinge(), 'nope')).toEqual([]);
    expect(conditionLabel('dow_3')).toBe('水曜日');
    expect(conditionLabel('sleep_lt6')).toBe('睡眠が6時間未満');
    expect(conditionLabel('unknown_key')).toBe('unknown_key');
  });
});

// ===== §8 気づきアラート =====

function insight(over: Partial<Insight> = {}): Insight {
  return {
    id: 'rule:binge:prev_mood_low+sleep_debt5_ge5', kind: 'rule', factors: ['prev_mood_low', 'sleep_debt5_ge5'], outcome: 'binge',
    effect: 3.2, n: 30, confidence: 'mid', text: '', evidenceKey: 'multi_binge', support: 6, hits: 5, ...over,
  };
}

function today(over: Partial<DayFeature> = {}): DayFeature { return { ...emptyDayFeature(TODAY), ...over }; }
function yesterday(over: Partial<DayFeature> = {}): DayFeature { return { ...emptyDayFeature(shiftDate(TODAY, -1)), recorded: true, ...over }; }

describe('correlate: evaluateAlerts（§8）', () => {
  it('条件側を今日＋前日が満たせば発火（caution・満たした条件のラベル）', () => {
    const alerts = evaluateAlerts(today({ sleep_debt5: 5.5 }), [yesterday({ mood: 1 })], [insight()]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tone).toBe('caution');
    expect(alerts[0].ruleId).toBe('rule:binge:prev_mood_low+sleep_debt5_ge5');
    expect(alerts[0].id).toBe('alert:rule:binge:prev_mood_low+sleep_debt5_ge5');
    expect(alerts[0].factors).toEqual(['前日の気分が低め', '睡眠不足が5時間以上たまっている']);
    expect(alerts[0].text).toBe('今日は「食べすぎ」が起きやすい条件が2つそろっています。無理せず、いつもどおりで');
  });

  it('条件が1つでも欠ければ発火しない。判定不能（null）も満たしたとみなさない', () => {
    expect(evaluateAlerts(today({ sleep_debt5: 2 }), [yesterday({ mood: 1 })], [insight()])).toEqual([]);
    expect(evaluateAlerts(today({ sleep_debt5: null }), [yesterday({ mood: 1 })], [insight()])).toEqual([]);
    expect(evaluateAlerts(today({ sleep_debt5: 6 }), [], [insight()])).toEqual([]);   // 前日が無い
  });

  it('n<14 の法則からは出さない。rule/risk_ratio 以外の kind も出さない', () => {
    expect(evaluateAlerts(today({ sleep_debt5: 6 }), [yesterday({ mood: 1 })], [insight({ n: 13 })])).toEqual([]);
    expect(evaluateAlerts(today({ sleep_debt5: 6 }), [yesterday({ mood: 1 })], [insight({ kind: 'lag_corr' })])).toEqual([]);
    expect(evaluateAlerts(today({ sleep_debt5: 6 }), [yesterday({ mood: 1 })], [insight({ n: 14 })])).toHaveLength(1);
  });

  it('ポジティブ側: 7時間以上眠れた → トレのボリューム増につながる条件（positive）', () => {
    const pos = insight({ id: 'rule:lift_volume_up:sleep_ge7', factors: ['sleep_ge7'], outcome: 'lift_volume_up' });
    const alerts = evaluateAlerts(today({ sleep_h: 7.4 }), [yesterday()], [pos]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tone).toBe('positive');
    expect(alerts[0].factors).toEqual(['7時間以上眠れた']);
    expect(alerts[0].text).toBe('今日は「トレのボリューム増」につながる条件がそろっています。良い日にしやすいタイミング');
    expect(evaluateAlerts(today({ sleep_h: 6 }), [yesterday()], [pos])).toEqual([]);
  });

  it('同じ ruleId は1件。並びは caution → 因子数の多い順', () => {
    const pos = insight({ id: 'rule:lift_volume_up:sleep_ge7', factors: ['sleep_ge7'], outcome: 'lift_volume_up' });
    const alerts = evaluateAlerts(today({ sleep_debt5: 6, sleep_h: 7.5 }), [yesterday({ mood: 1 })], [pos, insight(), insight()]);
    expect(alerts.map((a) => a.tone)).toEqual(['caution', 'positive']);
  });
});

describe('correlate: suppressAlerts（§8 抑制）', () => {
  const a = { id: 'alert:x', tone: 'caution' as const, factors: [], text: '', ruleId: 'x' };
  const d = (n: number) => shiftDate(TODAY, -n);

  it('同じ id は1日1回（今日すでに出していれば落とす）', () => {
    expect(suppressAlerts([a], [{ id: 'alert:x', date: TODAY }], TODAY)).toEqual([]);
    expect(suppressAlerts([a], [{ id: 'alert:other', date: TODAY }], TODAY)).toEqual([a]);
  });

  it('連続3日出たら4日目は休む。2日なら出す。飛び飛び（1・3日前）なら出す', () => {
    expect(suppressAlerts([a], [{ id: 'alert:x', date: d(1) }, { id: 'alert:x', date: d(2) }, { id: 'alert:x', date: d(3) }], TODAY)).toEqual([]);
    expect(suppressAlerts([a], [{ id: 'alert:x', date: d(1) }, { id: 'alert:x', date: d(2) }], TODAY)).toEqual([a]);
    expect(suppressAlerts([a], [{ id: 'alert:x', date: d(1) }, { id: 'alert:x', date: d(3) }], TODAY)).toEqual([a]);
    // 休んだ翌日（4日前〜2日前に3連続・昨日は休み）は再び出る
    expect(suppressAlerts([a], [{ id: 'alert:x', date: d(2) }, { id: 'alert:x', date: d(3) }, { id: 'alert:x', date: d(4) }], TODAY)).toEqual([a]);
  });
});
