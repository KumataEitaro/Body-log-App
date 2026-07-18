// 品目リストの編集・再計算ロジック

export type FoodItem = { name: string; qty: string; kcal: number; p: number; f: number; c: number };

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
    return {
      ...item, qty: newQty,
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
