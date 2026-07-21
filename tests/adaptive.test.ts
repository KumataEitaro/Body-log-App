import { describe, it, expect } from 'vitest';
import { reviewMaintenance, lifeFactorFor, detectStruggle, type DayStat } from '@/lib/adaptive';

// 14日分のダミーデータを作る
function makeDays(opts: {
  intake?: (i: number) => number | null;
  target?: number;
  weights?: Record<number, number>; // index→kg
}): DayStat[] {
  const { intake = () => 1800, target = 2000, weights = {} } = opts;
  return Array.from({ length: 14 }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    intake: intake(i),
    target,
    weight: weights[i] ?? null,
  }));
}

describe('reviewMaintenance (メンテナンスカロリー再校正)', () => {
  it('理論どおり痩せていれば keep（±60kcal未満は変更しない）', () => {
    // 毎日-200kcal → 14日で -0.389kg。実測もほぼ同じ
    const days = makeDays({ intake: () => 1800, target: 2000, weights: { 0: 75.0, 13: 74.61 } });
    const r = reviewMaintenance(days, 2000, 1540);
    expect(r.status).toBe('keep');
  });

  it('理論より痩せていない → メンテナンスは実際は低い（下方修正を提案）', () => {
    // 毎日-200kcalのはずが体重が全く減っていない → 実base ≈ 2000-200 = 1800
    const days = makeDays({ intake: () => 1800, target: 2000, weights: { 0: 75.0, 13: 75.0 } });
    const r = reviewMaintenance(days, 2000, 1540);
    expect(r.status).toBe('change');
    if (r.status === 'change') {
      expect(r.newBase).toBeLessThan(2000);
      expect(r.newBase).toBeGreaterThanOrEqual(1700); // ±300ガード内
    }
  });

  it('理論より大きく痩せている → メンテナンスは実際は高い（上方修正=例の1800→2000型）', () => {
    // 目安1800で毎日ぴったり食べたのに 14日で-0.78kg減 → 実base ≈ 2200 (+300クランプ→2100)
    const days = makeDays({ intake: () => 1800, target: 1800, weights: { 0: 75.0, 13: 74.22 } });
    const r = reviewMaintenance(days, 1800, 1540);
    expect(r.status).toBe('change');
    if (r.status === 'change') {
      expect(r.newBase).toBeGreaterThan(1800);
      expect(r.newBase).toBeLessThanOrEqual(2100); // +300ガード
    }
  });

  it('変更は±300kcalにクランプされる', () => {
    // 異常に大きな乖離でも±300まで
    const days = makeDays({ intake: () => 1500, target: 2000, weights: { 0: 75.0, 13: 76.5 } });
    const r = reviewMaintenance(days, 2000, 1540);
    expect(r.status).toBe('change');
    if (r.status === 'change') expect(r.newBase).toBe(1700);
  });

  it('基礎代謝は下回らない', () => {
    const days = makeDays({ intake: () => 1500, target: 1600, weights: { 0: 75.0, 13: 76.0 } });
    const r = reviewMaintenance(days, 1600, 1550);
    if (r.status === 'change') expect(r.newBase).toBeGreaterThanOrEqual(1550);
  });

  it('摂取記録が10日未満なら insufficient', () => {
    const days = makeDays({ intake: (i) => (i < 5 ? 1800 : null), weights: { 0: 75, 13: 74.5 } });
    expect(reviewMaintenance(days, 2000, 1540).status).toBe('insufficient');
  });

  it('期間端に体重記録がなければ insufficient', () => {
    const days = makeDays({ weights: { 6: 75.0, 7: 74.8 } }); // 中央にしかない
    expect(reviewMaintenance(days, 2000, 1540).status).toBe('insufficient');
  });

  it('体重アンカーは複数日の平均でブレを抑える', () => {
    const days = makeDays({
      intake: () => 1800, target: 2000,
      weights: { 0: 75.4, 1: 74.6, 12: 74.9, 13: 74.3 }, // 平均: 75.0 → 74.6
    });
    const r = reviewMaintenance(days, 2000, 1540);
    expect(r.status).not.toBe('insufficient');
    if (r.status !== 'insufficient') expect(r.actualDelta).toBeCloseTo(-0.4, 5);
  });
});

describe('lifeFactorFor', () => {
  it('base/bmr を3桁丸めで返す', () => {
    expect(lifeFactorFor(2000, 1540)).toBeCloseTo(1.299, 3);
    expect(lifeFactorFor(1800, 1540)).toBeCloseTo(1.169, 3);
  });
  it('bmr=0でも安全', () => {
    expect(lifeFactorFor(2000, 0)).toBe(1.3);
  });
});

describe('detectStruggle (つらい/爆食の検知)', () => {
  it('つらい系を検知する', () => {
    expect(detectStruggle(['今日は結構つらい'])).toBe('hard');
    expect(detectStruggle(['正直しんどい…'])).toBe('hard');
    expect(detectStruggle([null, undefined, 'もう無理かも'])).toBe('hard');
  });
  it('爆食系を検知する（hardより優先）', () => {
    expect(detectStruggle(['夜に爆食した'])).toBe('binge');
    expect(detectStruggle(['つらくて食べ過ぎた'])).toBe('binge');
    expect(detectStruggle(['ドカ食いしてしまった'])).toBe('binge');
  });
  it('普通の記録では反応しない', () => {
    expect(detectStruggle(['牛丼並盛とサラダ', '調子いい', '筋トレ楽しい'])).toBeNull();
    expect(detectStruggle([])).toBeNull();
  });
});
