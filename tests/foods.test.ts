import { describe, it, expect } from 'vitest';
import { parseRatio, servingOf, matchFoodsLocally, type MyFoodRow } from '../lib/foods';

const nabe: MyFoodRow = {
  id: '1', name: '野菜鍋', unit: '全量',
  kcal: 1800, p: 90, f: 60, c: 120,
  serving_label: '丼1杯', serving_ratio: 1 / 6,
};

describe('parseRatio（よく使う量の倍率パース）', () => {
  it('分数 "1/6"', () => expect(parseRatio('1/6')).toBeCloseTo(0.1667, 3));
  it('小数 "0.17"', () => expect(parseRatio('0.17')).toBe(0.17));
  it('整数 "2"（2個ぶん等）', () => expect(parseRatio('2')).toBe(2));
  it('スペース入り "1 / 4"', () => expect(parseRatio('1 / 4')).toBe(0.25));
  it('空文字はnull', () => expect(parseRatio('')).toBeNull());
  it('0や負はnull', () => {
    expect(parseRatio('0')).toBeNull();
    expect(parseRatio('-1')).toBeNull();
  });
  it('ゼロ除算はnull', () => expect(parseRatio('1/0')).toBeNull());
  it('文字列はnull', () => expect(parseRatio('たくさん')).toBeNull());
});

describe('servingOf（チップ追加時の1回分＝登録合計×タップ時の量）', () => {
  it('割合1/6ならスケールされた値・qtyは×表記', () => {
    const s = servingOf(nabe);
    expect(s.qty).toBe('×0.17');
    expect(s.kcal).toBe(300);
    expect(s.p).toBe(15);
    expect(s.c).toBe(20);
  });
  it('割合未設定なら×1（登録合計そのまま）', () => {
    const s = servingOf({ ...nabe, serving_label: null, serving_ratio: null });
    expect(s.qty).toBe('×1');
    expect(s.kcal).toBe(1800);
  });
  it('割合が1超（2個ぶん）も可', () => {
    const s = servingOf({ ...nabe, kcal: 90, p: 10, f: 0, c: 12, serving_ratio: 2 });
    expect(s.qty).toBe('×2');
    expect(s.kcal).toBe(180);
    expect(s.p).toBe(20);
  });
  it('qtyの数値は分量編集の自動再計算に使える（×0.17→数値0.17）', () => {
    expect(servingOf(nabe).qty).toMatch(/0\.17/);
  });
});

describe('matchFoodsLocally (辞書だけで解ける入力のローカル即答)', () => {
  const foods: MyFoodRow[] = [
    { id: '1', name: 'プロテイン', unit: '1杯', kcal: 120, p: 24, f: 2, c: 3, serving_label: null, serving_ratio: null },
    { id: '2', name: 'ゆで卵', unit: '1個', kcal: 80, p: 7, f: 5, c: 0, serving_label: null, serving_ratio: null },
    { id: '3', name: 'プロテインバー', unit: '1本', kcal: 200, p: 20, f: 8, c: 15, serving_label: null, serving_ratio: null },
    { id: '4', name: '野菜鍋', unit: '全量', kcal: 1800, p: 90, f: 60, c: 120, serving_label: '丼1杯', serving_ratio: 0.17 },
  ];

  it('単品名だけ → 1回分で即答', () => {
    const r = matchFoodsLocally('プロテイン', foods)!;
    expect(r).toHaveLength(1);
    expect(r[0].kcal).toBe(120);
  });
  it('「と」区切りの複数品目', () => {
    const r = matchFoodsLocally('プロテインとゆで卵', foods)!;
    expect(r.map((i) => i.name).sort()).toEqual(['ゆで卵', 'プロテイン']);
  });
  it('個数指定（2回・×2）を反映', () => {
    expect(matchFoodsLocally('プロテイン2回', foods)![0].kcal).toBe(240);
    expect(matchFoodsLocally('ゆで卵×2', foods)![0].kcal).toBe(160);
  });
  it('長い名前を優先（プロテインバー≠プロテイン）', () => {
    const r = matchFoodsLocally('プロテインバー', foods)!;
    expect(r[0].name).toBe('プロテインバー');
    expect(r[0].kcal).toBe(200);
  });
  it('serving_ratio付きは1回分で計算', () => {
    const r = matchFoodsLocally('野菜鍋', foods)!;
    expect(r[0].kcal).toBe(306); // 1800×0.17
    expect(r[0].qty).toBe('×0.17');
  });
  it('辞書で説明できない語が残る → null（AIへ）', () => {
    expect(matchFoodsLocally('プロテイン飲んだ', foods)).toBeNull();
    expect(matchFoodsLocally('体重75.2kg', foods)).toBeNull();
    expect(matchFoodsLocally('牛丼並盛', foods)).toBeNull();
    expect(matchFoodsLocally('プロテインと牛丼', foods)).toBeNull();
  });
  it('空文字 → null', () => {
    expect(matchFoodsLocally('', foods)).toBeNull();
  });
});
