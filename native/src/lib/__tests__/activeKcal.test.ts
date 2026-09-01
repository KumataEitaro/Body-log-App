// アクティブカロリーの目標上乗せ（二重計上を避ける式）。
// 目標kcal = BMR × life_factor + EX_ADD + adj であり、life_factor には日常活動が
// すでに含まれている。だからアクティブ全量を足すと二重計上になる。
// 上乗せ = max(0, アクティブ − BMR × (life_factor − 1)) が守るべき性質をここで固定する。
import { activeKcalGoalBonus } from '../activeKcal';

describe('アクティブkcalの目標上乗せ', () => {
  const BMR = 1700;   // 87kg・175cm・40歳男性あたりの想定

  it('想定日常活動の範囲内なら0（二重計上しない）', () => {
    // BMR1700 × (1.3 − 1) = 510kcal がすでに目標に入っている想定ぶん。
    // アクティブ400kcal（=よくある在宅日）は想定内なので目標は動かない
    expect(activeKcalGoalBonus(400, BMR, 1.3)).toBe(0);
    expect(activeKcalGoalBonus(510, BMR, 1.3)).toBe(0);
  });

  it('想定を超えて動いた分だけ上乗せする', () => {
    // 1万歩超えでアクティブ800kcalの日: 800 − 510 = 290kcalだけ増える
    expect(activeKcalGoalBonus(800, BMR, 1.3)).toBe(290);
    expect(activeKcalGoalBonus(1000, BMR, 1.3)).toBe(490);
  });

  it('アクティブ0（未計測・未連携相当）は0', () => {
    expect(activeKcalGoalBonus(0, BMR, 1.3)).toBe(0);
  });

  it('生活係数が高い人は上乗せが起きにくい（すでに目標に織り込まれているため）', () => {
    // 同じアクティブ800kcalでも、係数が上がるほど「想定ぶん」が増えて上乗せは減る
    expect(activeKcalGoalBonus(800, BMR, 1.2)).toBe(460);   // 想定340
    expect(activeKcalGoalBonus(800, BMR, 1.3)).toBe(290);   // 想定510
    expect(activeKcalGoalBonus(800, BMR, 1.4)).toBe(120);   // 想定680
    expect(activeKcalGoalBonus(800, BMR, 1.5)).toBe(0);     // 想定850＝想定内
    // 係数が大きいほど上乗せは単調に小さくなる
    const bonuses = [1.2, 1.3, 1.4, 1.5, 1.725].map((lf) => activeKcalGoalBonus(800, BMR, lf));
    for (let i = 1; i < bonuses.length; i++) expect(bonuses[i]).toBeLessThanOrEqual(bonuses[i - 1]);
  });

  it('マイナスにならない（動かなかった日に目標を削らない）', () => {
    // 「記録が罰になる」表示を避けるため、想定を下回っても目標は減らさない
    expect(activeKcalGoalBonus(100, BMR, 1.9)).toBe(0);
    expect(activeKcalGoalBonus(1, 3000, 2.0)).toBe(0);
    expect(activeKcalGoalBonus(-500, BMR, 1.3)).toBe(0);   // 実測がおかしい値でも下振れしない
  });

  it('壊れた入力（プロフィール未ロード・係数1未満）でも安全側に倒れる', () => {
    expect(activeKcalGoalBonus(800, 0, 1.3)).toBe(0);            // BMR未算出なら上乗せしない
    expect(activeKcalGoalBonus(800, NaN, 1.3)).toBe(0);
    expect(activeKcalGoalBonus(NaN, BMR, 1.3)).toBe(0);
    expect(activeKcalGoalBonus(800, BMR, 1)).toBe(800);          // 想定日常活動0＝実測そのまま
    expect(activeKcalGoalBonus(800, BMR, 0.5)).toBe(800);        // あり得ない係数も1扱い
  });

  it('整数で返す（表示で端数が出ない）', () => {
    const v = activeKcalGoalBonus(777.7, 1666.6, 1.35);
    expect(Number.isInteger(v)).toBe(true);
  });
});
