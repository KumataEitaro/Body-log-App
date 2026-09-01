// 量補正（トレイ品目の倍率再計算）。「半分だけ食べた」の補正が
// 暗算とズレたり、選び直しで複利になったりすると信用を失うため境界を厚めに。
import { applyMult, currentMult, splitMult, MULT_STEPS } from '../mealAdjust';
import type { FoodItem } from '../items';

const rice: FoodItem = { name: 'ごはん', qty: '150g', kcal: 234, p: 3.8, f: 0.5, c: 53.4 };

describe('splitMult（qty付記の分離）', () => {
  it('付記なしは mult=1', () => {
    expect(splitMult('150g')).toEqual({ base: '150g', mult: 1 });
    expect(splitMult('1個（113g）')).toEqual({ base: '1個（113g）', mult: 1 });
    expect(splitMult('')).toEqual({ base: '', mult: 1 });
  });

  it('「150g ×0.5」は base=150g・mult=0.5 に分かれる', () => {
    expect(splitMult('150g ×0.5')).toEqual({ base: '150g', mult: 0.5 });
  });

  it('マイ食品の倍率qty「×0.17」全体は付記ではない（mult=1のまま）', () => {
    expect(splitMult('×0.17')).toEqual({ base: '×0.17', mult: 1 });
  });
});

describe('applyMult（倍率でkcal/PFCを再計算）', () => {
  it('×0.5でqtyに付記が付き、栄養値が半分になる', () => {
    const half = applyMult(rice, 0.5);
    expect(half.qty).toBe('150g ×0.5');
    expect(half.kcal).toBe(117);
    expect(half.p).toBe(1.9);
    expect(half.f).toBe(0.3);   // 0.25→四捨五入で0.3
    expect(half.c).toBe(26.7);
    expect(currentMult(half)).toBe(0.5);
  });

  it('×1に戻すと付記が消えて元の値に戻る（往復で壊れない）', () => {
    const back = applyMult(applyMult(rice, 0.5), 1);
    expect(back.qty).toBe('150g');
    expect(back.kcal).toBe(234);
    expect(back.c).toBe(53.4);
  });

  it('選び直しは複利にならない（×0.5→×2はベースの2倍）', () => {
    const twice = applyMult(applyMult(rice, 0.5), 2);
    expect(twice.qty).toBe('150g ×2');
    expect(twice.kcal).toBe(468);   // 234×2（117×2=234ではない）
    expect(twice.p).toBe(7.6);
  });

  it('マイ食品の倍率qty「×0.25」は単一倍率に畳み込まれる', () => {
    const it0: FoodItem = { name: '野菜鍋', qty: '×0.25', kcal: 100, p: 8, f: 3, c: 10 };
    const half = applyMult(it0, 0.5);
    expect(half.qty).toBe('×0.13');   // 0.25×0.5=0.125→小数2桁丸め
    expect(half.kcal).toBe(50);
    expect(half.p).toBe(4);
  });

  it('分析用の追加栄養素（salt等）も同じ倍率でスケールする', () => {
    const withSalt: FoodItem = { ...rice, salt: 2, fib: 4.2 };
    const half = applyMult(withSalt, 0.5);
    expect(half.salt).toBe(1);
    expect(half.fib).toBe(2.1);
    // 未定義の栄養素キーは生えない
    expect('sug' in half).toBe(false);
  });

  it('×1をそのまま選んだら何も変わらない（同一内容）', () => {
    expect(applyMult(rice, 1)).toEqual(rice);
  });

  it('qtyが空の品目は「×0.5」単体の表記になる', () => {
    const noQty: FoodItem = { name: 'みそ汁', qty: '', kcal: 40, p: 2, f: 1, c: 5 };
    const half = applyMult(noQty, 0.5);
    expect(half.qty).toBe('×0.5');
    expect(half.kcal).toBe(20);
  });

  it('不正な倍率（0以下・NaN）は無視して元の品目を返す', () => {
    expect(applyMult(rice, 0)).toEqual(rice);
    expect(applyMult(rice, NaN)).toEqual(rice);
  });

  it('チップの選択肢は0.5〜2.0で×1を含む', () => {
    expect(MULT_STEPS).toContain(1);
    expect(Math.min(...MULT_STEPS)).toBe(0.5);
    expect(Math.max(...MULT_STEPS)).toBe(2);
  });
});
