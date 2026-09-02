// 歩数→消費kcalの推定と、「きょうの動き」の消費表示の優先順位。
// 要件は「1万歩なのに0kcal」を絶対に見せないこと。実測が無くても歩数から推定が出る。
import { estimateStepsKcal, kcalPerStep, stepsForKcal, resolveBurnKcal, KCAL_PER_STEP_PER_KG } from '../stepsKcal';

describe('歩数からの消費kcal推定', () => {
  it('1万歩・70kgで約350kcal（歩数×0.0005×体重）', () => {
    expect(estimateStepsKcal(10000, 70)).toBe(350);
    expect(KCAL_PER_STEP_PER_KG).toBe(0.0005);
  });

  it('体重に比例する（同じ歩数でも重い人ほど消費が大きい）', () => {
    expect(estimateStepsKcal(10000, 100)).toBe(500);
    expect(estimateStepsKcal(10000, 50)).toBe(250);
  });

  it('0歩・負値・NaNは0（壊れた入力で変な数字を出さない）', () => {
    expect(estimateStepsKcal(0, 70)).toBe(0);
    expect(estimateStepsKcal(-500, 70)).toBe(0);
    expect(estimateStepsKcal(NaN, 70)).toBe(0);
  });

  it('体重が未記録（0/NaN）でも床値0.02kcal/歩で推定が出る（0除算しない）', () => {
    expect(kcalPerStep(0)).toBe(0.02);
    expect(kcalPerStep(NaN)).toBe(0.02);
    expect(estimateStepsKcal(10000, 0)).toBe(200);
    // 床値未満になる軽い体重（30kg=0.015）も床に張り付く
    expect(kcalPerStep(30)).toBe(0.02);
  });

  it('kcal→歩数の逆算は100歩単位で切り上げ、往復しても係数が同じ', () => {
    // 70kg: 0.035kcal/歩。200kcal ÷ 0.035 = 5,714歩 → 5,800歩
    expect(stepsForKcal(200, 70)).toBe(5800);
    expect(estimateStepsKcal(stepsForKcal(200, 70), 70)).toBeGreaterThanOrEqual(200);
    expect(stepsForKcal(0, 70)).toBe(0);
    expect(stepsForKcal(-10, 70)).toBe(0);
  });
});

describe('消費表示の優先順位（実測 → 歩数推定 → アプリ記録）', () => {
  it('①ヘルスケア実測が>0ならそれを使う', () => {
    expect(resolveBurnKcal({ measured: 620, steps: 10013, weightKg: 70, recorded: 120 }))
      .toEqual({ source: 'measured', kcal: 620 });
  });

  it('②実測が0/nullでも歩数があれば歩数からの推定（1万歩=0kcalを見せない）', () => {
    expect(resolveBurnKcal({ measured: 0, steps: 10013, weightKg: 70, recorded: 0 }))
      .toEqual({ source: 'steps', kcal: 350 });
    expect(resolveBurnKcal({ measured: null, steps: 10013, weightKg: 70, recorded: 0 }).source).toBe('steps');
  });

  it('③実測も歩数も無ければアプリ記録ぶんだけ（従来表示）', () => {
    expect(resolveBurnKcal({ measured: null, steps: null, weightKg: 70, recorded: 180.4 }))
      .toEqual({ source: 'recorded', kcal: 180 });
    expect(resolveBurnKcal({ measured: 0, steps: 0, weightKg: 70, recorded: 0 }))
      .toEqual({ source: 'recorded', kcal: 0 });
  });
});
