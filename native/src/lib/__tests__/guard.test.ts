// 安全ガードの判定式（G1: BMI下限・減量ペース / G8: 体重の外れ値）。
// 閾値は健康リスクの境界そのものなので、式の退行をテストで固定する。
import { bmiFloorKg, weeklyLossPace, isOutlierWeight, deleteConfirmMatches } from '../guard';

describe('bmiFloorKg（BMI18.5の下限体重）', () => {
  it('170cmなら53.5kg前後になる', () => {
    expect(bmiFloorKg(170)).toBeCloseTo(53.5, 1);
  });
  it('150cmなら41.6kg前後になる', () => {
    expect(bmiFloorKg(150)).toBeCloseTo(41.6, 1);
  });
});

describe('weeklyLossPace（減量ペースkg/週）', () => {
  it('4週間で4kg減なら週1.0kg', () => {
    expect(weeklyLossPace(80, 76, '2026-01-01', '2026-01-29')).toBeCloseTo(1.0, 5);
  });
  it('増量方向（目標>現在）は判定対象外でnull', () => {
    expect(weeklyLossPace(70, 75, '2026-01-01', '2026-03-01')).toBeNull();
  });
  it('目標日が今日以前ならnull（0除算・負のペースを作らない）', () => {
    expect(weeklyLossPace(80, 76, '2026-01-10', '2026-01-10')).toBeNull();
    expect(weeklyLossPace(80, 76, '2026-01-10', '2026-01-01')).toBeNull();
  });
});

describe('isOutlierWeight（前回から±15%以上）', () => {
  it('前回値が無ければ判定しない（初回記録を邪魔しない）', () => {
    expect(isOutlierWeight(null, 60)).toBe(false);
    expect(isOutlierWeight(undefined, 60)).toBe(false);
  });
  it('±15%未満は通す', () => {
    expect(isOutlierWeight(60, 68.9)).toBe(false);   // +14.8%
    expect(isOutlierWeight(60, 51.1)).toBe(false);   // -14.8%
  });
  it('±15%以上は外れ値として確認対象', () => {
    expect(isOutlierWeight(60, 69)).toBe(true);      // +15%
    expect(isOutlierWeight(60, 51)).toBe(true);      // -15%
    expect(isOutlierWeight(52.8, 528)).toBe(true);   // 桁の打ち間違い
  });
});

describe('deleteConfirmMatches（アカウント削除の確認語）', () => {
  it('日本語の原文「削除」はどの言語でも通る', () => {
    expect(deleteConfirmMatches('削除', 'Delete')).toBe(true);
  });
  it('翻訳後の確認語（英語UIなら Delete）も通る。前後の空白と大文字小文字は無視', () => {
    expect(deleteConfirmMatches('Delete', 'Delete')).toBe(true);
    expect(deleteConfirmMatches('  delete ', 'Delete')).toBe(true);
  });
  it('空・別の語は通らない', () => {
    expect(deleteConfirmMatches('', 'Delete')).toBe(false);
    expect(deleteConfirmMatches('   ', 'Delete')).toBe(false);
    expect(deleteConfirmMatches('さくじょ', 'Delete')).toBe(false);
  });
});
