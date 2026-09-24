// マイ食品の「1回分のグラム」と微量栄養素の持ち回り（lib/foods.ts・2026-09-24）
import {
  addServing, composeMyFood, gramsFromQty, removeServing, servingCount, servingMult, servingOf, servingQty, sumNutrients,
  type MyFoodRow,
} from '../foods';

const chicken: MyFoodRow = {
  id: 'a', name: '鶏むね肉', unit: '150g', kcal: 165, p: 33, f: 2.3, c: 0,
  grams: 150, nutrients: { k: 525, fe: 0.5 },
};
const protein: MyFoodRow = { id: 'b', name: 'プロテイン', unit: '1回', kcal: 120, p: 24, f: 1.5, c: 3 };   // グラム登録なし（従来）

describe('gramsFromQty', () => {
  it('"150g" / "1杯（約150g）" / "80 g" からグラムを拾う。無ければ null', () => {
    expect(gramsFromQty('150g')).toBe(150);
    expect(gramsFromQty('1杯（約150g）')).toBe(150);
    expect(gramsFromQty('80 g')).toBe(80);
    expect(gramsFromQty('1個')).toBeNull();
    expect(gramsFromQty('×0.5')).toBeNull();
    expect(gramsFromQty('')).toBeNull();
  });
});

describe('servingOf / servingQty（グラム登録あり）', () => {
  it('1回分の qty はグラムで出て、微量栄養素も比例して載る', () => {
    const sv = servingOf(chicken);
    expect(sv.qty).toBe('150g');
    expect(sv.kcal).toBe(165);
    expect(sv.k).toBe(525);
    expect(sv.fe).toBe(0.5);
  });
  it('serving_ratio（タップ時の量）を掛ける: 0.5 → 75g・kcal も半分', () => {
    const half = servingOf({ ...chicken, serving_ratio: 0.5 });
    expect(half.qty).toBe('75g');
    expect(half.kcal).toBe(82.5);
    expect(half.k).toBe(262.5);
  });
  it('グラム登録が無い食品は従来どおり「×倍率」', () => {
    expect(servingOf(protein).qty).toBe('×1');
    expect(servingQty(protein, 0.5)).toBe('×0.5');
    expect(servingQty(chicken, 1.5)).toBe('225g');
  });
});

describe('addServing / removeServing / servingCount（グラム形式の行）', () => {
  it('2回タップで 300g、−で 150g、もう一度−で行ごと消える', () => {
    let items = addServing([], chicken);
    expect(items[0].qty).toBe('150g');
    items = addServing(items, chicken);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe('300g');
    expect(items[0].kcal).toBe(330);
    expect(items[0].k).toBe(1050);
    expect(servingCount(items, chicken)).toBe(2);
    items = removeServing(items, chicken);
    expect(items[0].qty).toBe('150g');
    items = removeServing(items, chicken);
    expect(items).toHaveLength(0);
  });
  it('量調整で 120g に直した行も「同じ食品の行」として数える（0.8回分）', () => {
    const items = [{ name: '鶏むね肉', qty: '120g', kcal: 132, p: 26.4, f: 1.8, c: 0 }];
    expect(servingMult(items[0], chicken)).toBeCloseTo(0.8);
    expect(servingCount(items, chicken)).toBe(0.8);
  });
  it('杯・個に手編集した行は別物（触らない）', () => {
    const items = [{ name: '鶏むね肉', qty: '1枚', kcal: 200, p: 40, f: 3, c: 0 }];
    expect(servingMult(items[0], chicken)).toBeNull();
    expect(addServing(items, chicken)).toHaveLength(2);
  });
  it('従来の ×倍率 形式も同じ関数で扱える', () => {
    let items = addServing([], protein);
    items = addServing(items, protein);
    expect(items[0].qty).toBe('×2');
    expect(servingCount(items, protein)).toBe(2);
  });
});

describe('composeMyFood（登録時のグラムと微量栄養素）', () => {
  it('単品は分量からグラムを拾い、栄養素を持ち込む', () => {
    const r = composeMyFood('', [{ name: '鶏むね肉', qty: '1枚（約150g）', kcal: 165, p: 33, f: 2.3, c: 0, k: 525 }]);
    expect(r.grams).toBe(150);
    expect(r.nutrients).toEqual({ k: 525 });
    expect(r.kind).toBe('food');
  });
  it('セットは全品目にグラムがあるときだけ合計、栄養素は合計', () => {
    const both = composeMyFood('定食', [
      { name: '鶏むね肉', qty: '150g', kcal: 165, p: 33, f: 2.3, c: 0, k: 525 },
      { name: '白米', qty: '150g', kcal: 234, p: 3.8, f: 0.5, c: 53, k: 44 },
    ]);
    expect(both.grams).toBe(300);
    expect(both.nutrients).toEqual({ k: 569 });
    const partial = composeMyFood('定食', [
      { name: '鶏むね肉', qty: '150g', kcal: 165, p: 33, f: 2.3, c: 0 },
      { name: 'みそ汁', qty: '1杯', kcal: 40, p: 3, f: 1, c: 5 },
    ]);
    expect(partial.grams).toBeNull();
    expect(partial.nutrients).toBeNull();
    expect(sumNutrients([])).toBeNull();
  });
});
