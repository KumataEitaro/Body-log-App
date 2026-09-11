// 安全ガードの判定式（G1: BMI下限・減量ペース / G8: 体重の外れ値）。
// 閾値は健康リスクの境界そのものなので、式の退行をテストで固定する。
import {
  bmiFloorKg, weeklyLossPace, isOutlierWeight, deleteConfirmMatches,
  inWeightRange, inBodyfatRange, inHeightRange, inAgeRange, assessWeightGoal,
} from '../guard';

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

describe('範囲ガード（QA B-2・入力口ごとの閾値ズレを潰す正本）', () => {
  it('体重は20kg超〜300kg未満だけを通す', () => {
    expect(inWeightRange(20)).toBe(false);
    expect(inWeightRange(20.1)).toBe(true);
    expect(inWeightRange(72.5)).toBe(true);
    expect(inWeightRange(299.9)).toBe(true);
    expect(inWeightRange(300)).toBe(false);
    expect(inWeightRange(NaN)).toBe(false);
    expect(inWeightRange(null)).toBe(false);
  });

  it('体脂肪率は3〜70%だけを通す（体写真カードに範囲が無かった）', () => {
    expect(inBodyfatRange(2.9)).toBe(false);
    expect(inBodyfatRange(3)).toBe(true);
    expect(inBodyfatRange(22)).toBe(true);
    expect(inBodyfatRange(70)).toBe(true);
    expect(inBodyfatRange(70.1)).toBe(false);
    expect(inBodyfatRange(1234)).toBe(false);   // 打ち間違いでグラフが潰れていた値
    expect(inBodyfatRange(null)).toBe(false);
  });

  it('身長・年齢はBMRの入力なので現実的な幅に収める', () => {
    expect(inHeightRange(170)).toBe(true);
    expect(inHeightRange(99)).toBe(false);
    expect(inHeightRange(251)).toBe(false);
    expect(inAgeRange(30)).toBe(true);
    expect(inAgeRange(9)).toBe(false);
    expect(inAgeRange(121)).toBe(false);
  });
});

// QA P1-6: goals.target_weight を書く経路（目標パネル・AIコーチの承認カード）が
// 同じ壁を通るよう、判定式はこの純関数に集約してある。
describe('assessWeightGoal（G1 BMI下限・減量ペース / G3 妊娠授乳中）', () => {
  const TODAY = '2026-09-11';

  it('無理のない目標は通す', () => {
    expect(assessWeightGoal({
      heightCm: 170, currentKg: 70, targetKg: 66, targetDate: '2026-12-11', today: TODAY,
    })).toEqual({ ok: true });
  });

  it('BMI18.5を下回る目標は弾く（165cmで40kg）', () => {
    const r = assessWeightGoal({ heightCm: 165, currentKg: 60, targetKg: 40, targetDate: '2027-09-11', today: TODAY });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('BMI18.5');
  });

  it('身長が未登録ならBMI下限だけスキップする（他の判定は生きる）', () => {
    expect(assessWeightGoal({ heightCm: null, currentKg: 60, targetKg: 40, targetDate: '2027-09-11', today: TODAY }).ok).toBe(true);
  });

  it('妊娠・授乳中は減量方向の目標を弾く', () => {
    const r = assessWeightGoal({
      heightCm: 165, currentKg: 60, targetKg: 57, targetDate: '2027-09-11', today: TODAY, maternity: true,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('妊娠');
  });

  it('妊娠・授乳中でも維持・増量方向は通す', () => {
    expect(assessWeightGoal({
      heightCm: 165, currentKg: 60, targetKg: 62, targetDate: '2027-09-11', today: TODAY, maternity: true,
    }).ok).toBe(true);
  });

  it('週1kg超の減量ペースは弾く（2週間で10kg）', () => {
    const r = assessWeightGoal({
      heightCm: 175, currentKg: 80, targetKg: 70, targetDate: '2026-09-25', today: TODAY,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('速すぎ');
  });

  it('週0.5〜1kgは保存を通しつつ注意を添える', () => {
    const r = assessWeightGoal({
      heightCm: 175, currentKg: 80, targetKg: 76, targetDate: '2026-10-09', today: TODAY,
    });
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.warn).toBeTruthy();
  });

  it('目標日が無ければペース判定はスキップ（BMI下限は生きる）', () => {
    expect(assessWeightGoal({ heightCm: 175, currentKg: 80, targetKg: 70, targetDate: null, today: TODAY }).ok).toBe(true);
    expect(assessWeightGoal({ heightCm: 175, currentKg: 80, targetKg: 40, targetDate: null, today: TODAY }).ok).toBe(false);
  });

  it('目標体重が提案に無い（日付だけ変える）ときは判定対象外', () => {
    expect(assessWeightGoal({ heightCm: 165, currentKg: 60, targetKg: null, targetDate: '2026-09-25', today: TODAY }))
      .toEqual({ ok: true });
  });
});
