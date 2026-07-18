import { describe, it, expect } from 'vitest';
import { parseRatio, servingOf, type MyFoodRow } from '../lib/foods';

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
