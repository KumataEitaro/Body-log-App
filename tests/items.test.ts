import { describe, it, expect } from 'vitest';
import { qtyNumber, rescaleByQty, sumItems, emptyItem, type FoodItem } from '../lib/items';

const chicken: FoodItem = { name: 'サラダチキン', qty: '50g', kcal: 54, p: 11, f: 1, c: 1 };

describe('qtyNumber（分量文字列→数値）', () => {
  it('単位つきグラム', () => expect(qtyNumber('50g')).toBe(50));
  it('先頭の数値を採用（"1個(113g)"→1: 個数でスケール）', () => expect(qtyNumber('1個(113g)')).toBe(1));
  it('小数', () => expect(qtyNumber('1.5杯')).toBe(1.5));
  it('数値なしはnull', () => expect(qtyNumber('少々')).toBeNull());
  it('空文字はnull', () => expect(qtyNumber('')).toBeNull());
});

describe('rescaleByQty（分量変更→栄養素の比例再計算）', () => {
  it('50g→110g で2.2倍にスケール', () => {
    const r = rescaleByQty(chicken, '110g');
    expect(r.kcal).toBeCloseTo(118.8);
    expect(r.p).toBeCloseTo(24.2);
    expect(r.qty).toBe('110g');
  });
  it('1個→2個 で2倍', () => {
    const yogurt: FoodItem = { name: 'ヨーグルト', qty: '1個(113g)', kcal: 90, p: 10, f: 0, c: 12 };
    const r = rescaleByQty(yogurt, '2個');
    expect(r.kcal).toBe(180);
    expect(r.c).toBe(24);
  });
  it('新分量に数値が無ければ栄養素はそのまま', () => {
    const r = rescaleByQty(chicken, '少々');
    expect(r.kcal).toBe(54);
    expect(r.qty).toBe('少々');
  });
  it('元分量に数値が無ければスケールしない', () => {
    const r = rescaleByQty({ ...chicken, qty: 'ひとつかみ' }, '100g');
    expect(r.kcal).toBe(54);
  });
  it('元が0ならスケールしない（ゼロ除算防止）', () => {
    const r = rescaleByQty({ ...chicken, qty: '0g' }, '100g');
    expect(r.kcal).toBe(54);
  });
  it('元のオブジェクトは変更しない（イミュータブル）', () => {
    rescaleByQty(chicken, '100g');
    expect(chicken.kcal).toBe(54);
  });
});

describe('sumItems（合計の自動再計算）', () => {
  it('複数品目の合計', () => {
    const items: FoodItem[] = [
      { name: 'a', qty: '', kcal: 100.5, p: 10.2, f: 1, c: 5 },
      { name: 'b', qty: '', kcal: 200.4, p: 20.1, f: 2, c: 10 },
    ];
    const t = sumItems(items);
    expect(t.kcal).toBeCloseTo(300.9);
    expect(t.p).toBeCloseTo(30.3);
  });
  it('空配列は全て0', () => {
    expect(sumItems([])).toEqual({ kcal: 0, p: 0, f: 0, c: 0 });
  });
  it('数値でない値は0扱い', () => {
    const t = sumItems([{ name: 'x', qty: '', kcal: NaN, p: 5, f: 0, c: 0 }]);
    expect(t.kcal).toBe(0);
    expect(t.p).toBe(5);
  });
  it('emptyItemは合計に影響しない', () => {
    const t = sumItems([chicken, emptyItem()]);
    expect(t.kcal).toBe(54);
  });
});
