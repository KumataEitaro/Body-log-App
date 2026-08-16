// 品目リストの編集・再計算ロジック

// 分析用の追加栄養素（AI解析から蓄積。UIには表示せずDBに貯める）
// salt=食塩相当量g / fib=食物繊維g / sug=糖類g / k=カリウムmg / ca=カルシウムmg /
// mg=マグネシウムmg / fe=鉄mg / zn=亜鉛mg / vd=ビタミンDμg / vc=ビタミンCmg
export const NUTRIENT_KEYS = ['salt', 'fib', 'sug', 'k', 'ca', 'mg', 'fe', 'zn', 'vd', 'vc'] as const;
export type NutrientKey = typeof NUTRIENT_KEYS[number];

export type FoodItem = {
  name: string; qty: string; kcal: number; p: number; f: number; c: number;
} & Partial<Record<NutrientKey, number>>;

const round1 = (n: number) => Math.round(n * 10) / 10;

// 分量文字列から最初の数値を取り出す（"50g"→50, "1個(113g)"→1, "大さじ2"→2）
export function qtyNumber(qty: string): number | null {
  const m = String(qty).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

// 分量を変更したら栄養素を比例スケールする（数値が読み取れない場合は分量だけ差し替え）
export function rescaleByQty(item: FoodItem, newQty: string): FoodItem {
  const oldN = qtyNumber(item.qty);
  const newN = qtyNumber(newQty);
  if (oldN != null && newN != null && oldN > 0) {
    const r = newN / oldN;
    const scaled: Partial<Record<NutrientKey, number>> = {};
    for (const key of NUTRIENT_KEYS) {
      const v = item[key];
      if (typeof v === 'number') scaled[key] = round1(v * r);
    }
    return {
      ...item, ...scaled, qty: newQty,
      kcal: round1(item.kcal * r), p: round1(item.p * r), f: round1(item.f * r), c: round1(item.c * r),
    };
  }
  return { ...item, qty: newQty };
}

// 品目の合計（＝表示欄・保存に使う総量）
export function sumItems(items: FoodItem[]): { kcal: number; p: number; f: number; c: number } {
  return {
    kcal: round1(items.reduce((a, it) => a + (Number(it.kcal) || 0), 0)),
    p: round1(items.reduce((a, it) => a + (Number(it.p) || 0), 0)),
    f: round1(items.reduce((a, it) => a + (Number(it.f) || 0), 0)),
    c: round1(items.reduce((a, it) => a + (Number(it.c) || 0), 0)),
  };
}

export function emptyItem(): FoodItem {
  return { name: '', qty: '', kcal: 0, p: 0, f: 0, c: 0 };
}
