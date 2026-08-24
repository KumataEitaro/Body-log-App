// ダイエット目的のプリセット。
// 係数はcoachActionの許容範囲（P0.5〜4.0 / F0.2〜2.0）に必ず収まること。
// AIが目的から係数を提案→適用する経路があるため、範囲外だと承認が通らなくなる。
import { PURPOSES, purposeOf } from '../purpose';

describe('目的プリセット', () => {
  it('キーが重複しない', () => {
    const keys = PURPOSES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('係数がAI提案の許容範囲に収まる（P0.5〜4.0 / F0.2〜2.0）', () => {
    for (const p of PURPOSES) {
      expect(p.p).toBeGreaterThanOrEqual(0.5);
      expect(p.p).toBeLessThanOrEqual(4.0);
      expect(p.f).toBeGreaterThanOrEqual(0.2);
      expect(p.f).toBeLessThanOrEqual(2.0);
    }
  });

  it('筋肉維持減量は既定(2.0)と同じP係数（既存ユーザーの体験が変わらない）', () => {
    expect(purposeOf('cut_lean')!.p).toBe(2.0);
  });

  it('未知のキーはnull（DBに古い値が残っても落ちない）', () => {
    expect(purposeOf('unknown')).toBeNull();
    expect(purposeOf(null)).toBeNull();
  });
});
