import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  qtyNumber, rescaleByQty, sumItems, emptyItem, NUTRIENT_KEYS, NUTRIENT_META, nutrientPromptJson, nutrientPromptSpec,
  type FoodItem,
} from '../lib/items';
import { buildParseFoodPrompt } from '../lib/parseFoodPrompt';

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
  it('新しい微量栄養素（ビタミンB1・セレン）も比例する', () => {
    const r = rescaleByQty({ ...chicken, vb1: 0.4, se: 10 }, '100g');
    expect(r.vb1).toBeCloseTo(0.8);
    expect(r.se).toBe(20);
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

// ===== 栄養素キーの正本と鏡（2026-09-25・栄養ランキング改修） =====
// native/src/lib/items.ts が正本。ここ（サーバー側 lib/items.ts）はプロンプト生成用の鏡で、
// 片方だけ増やすと AI が出す JSON とアプリの集計が食い違う。並びまで一字一句同じであることを固定する
function keysFromSource(src: string): string[] {
  const m = src.match(/export const NUTRIENT_KEYS = \[([\s\S]*?)\] as const;/);
  if (!m) throw new Error('NUTRIENT_KEYS が見つからない');
  return [...m[1].matchAll(/'([a-z0-9]+)'/g)].map((x) => x[1]);
}

describe('NUTRIENT_KEYS（正本＝native と鏡＝lib）', () => {
  it('31キー・重複なし・2025年版の基準がある栄養素を網羅', () => {
    expect(NUTRIENT_KEYS.length).toBe(31);
    expect(new Set(NUTRIENT_KEYS).size).toBe(NUTRIENT_KEYS.length);
    for (const k of ['salt', 'fib', 'sug', 'k', 'ca', 'mg', 'fe', 'zn', 'vd', 'vc', 'satfat', 'n6', 'n3', 'va', 've', 'vk',
      'vb1', 'vb2', 'nia', 'vb6', 'vb12', 'fol', 'pan', 'bio', 'phos', 'cu', 'mn', 'iod', 'se', 'cr', 'mo']) {
      expect(NUTRIENT_KEYS).toContain(k);
    }
    // 先頭10キーは旧並びのまま（旧プロンプト・seed-demo との互換）
    expect(NUTRIENT_KEYS.slice(0, 10)).toEqual(['salt', 'fib', 'sug', 'k', 'ca', 'mg', 'fe', 'zn', 'vd', 'vc']);
  });

  it('native/src/lib/items.ts と並びまで一致する', () => {
    const native = readFileSync(join(__dirname, '..', 'native', 'src', 'lib', 'items.ts'), 'utf8');
    expect(keysFromSource(native)).toEqual([...NUTRIENT_KEYS]);
    // META の表示名・単位・桁も同じ（native 側の表を正規表現で読む）
    const ROW = /^\s*([a-z0-9]+):\s*\{\s*label:\s*'([^']+)',\s*unit:\s*'([^']+)',\s*decimals:\s*(\d)/gm;
    const rows = new Map<string, { label: string; unit: string; decimals: number }>();
    for (const m of native.matchAll(ROW)) rows.set(m[1], { label: m[2], unit: m[3], decimals: Number(m[4]) });
    for (const k of NUTRIENT_KEYS) {
      expect({ k, row: rows.get(k) }).toEqual({ k, row: { label: NUTRIENT_META[k].label, unit: NUTRIENT_META[k].unit, decimals: NUTRIENT_META[k].decimals } });
    }
  });

  it('プロンプトの項目行と JSON 雛形に全キーが載る', () => {
    const spec = nutrientPromptSpec();
    const json = nutrientPromptJson();
    for (const k of NUTRIENT_KEYS) {
      expect(spec).toContain(`${k}=${NUTRIENT_META[k].label}(`);
      expect(json).toContain(`"${k}":0`);
    }
    expect(spec).toContain('vb1=ビタミンB1(mg,小数2)');
    expect(spec).toContain('sug=糖類(g)');   // 小数指定なし＝整数
    const p = buildParseFoodPrompt({ text: 'ごはん', dictBlock: '', outLang: '', historyBlock: '' });
    expect(p).toContain(spec);
    expect(p).toContain(`"c":0,${json}}`);
  });
});
