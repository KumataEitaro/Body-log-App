// 品目リストの編集・再計算ロジック

// ===== 分析用の追加栄養素（AI解析から蓄積） =====
// 正本は native/src/lib/items.ts（同名の NUTRIENT_KEYS / NUTRIENT_META）。ここはサーバー側の鏡で、
// lib/parseFoodPrompt.ts が「各品目で推定する栄養素の行」と JSON 雛形をここから生成する。
// tests/items.test.ts が native 側と一字一句同じ並びであることを固定する（片方だけ増やすと落ちる）。
// キーは日本人の食事摂取基準（2025年版）で基準値が設定されている栄養素を網羅する（2026-09-25 に 10 → 31 キー）。
export const NUTRIENT_KEYS = [
  'salt', 'fib', 'sug', 'k', 'ca', 'mg', 'fe', 'zn', 'vd', 'vc',
  'satfat', 'n6', 'n3',
  'va', 've', 'vk',
  'vb1', 'vb2', 'nia', 'vb6', 'vb12', 'fol', 'pan', 'bio',
  'phos', 'cu', 'mn', 'iod', 'se', 'cr', 'mo',
] as const;
export type NutrientKey = typeof NUTRIENT_KEYS[number];

export type NutrientMeta = { label: string; unit: string; decimals: 0 | 1 | 2 };
export const NUTRIENT_META: Record<NutrientKey, NutrientMeta> = {
  salt:   { label: '食塩相当量',   unit: 'g',     decimals: 1 },
  fib:    { label: '食物繊維',     unit: 'g',     decimals: 1 },
  sug:    { label: '糖類',         unit: 'g',     decimals: 0 },
  k:      { label: 'カリウム',     unit: 'mg',    decimals: 0 },
  ca:     { label: 'カルシウム',   unit: 'mg',    decimals: 0 },
  mg:     { label: 'マグネシウム', unit: 'mg',    decimals: 0 },
  fe:     { label: '鉄',           unit: 'mg',    decimals: 1 },
  zn:     { label: '亜鉛',         unit: 'mg',    decimals: 1 },
  vd:     { label: 'ビタミンD',    unit: 'µg',    decimals: 1 },
  vc:     { label: 'ビタミンC',    unit: 'mg',    decimals: 0 },
  satfat: { label: '飽和脂肪酸',   unit: 'g',     decimals: 1 },
  n6:     { label: 'n-6系脂肪酸',  unit: 'g',     decimals: 1 },
  n3:     { label: 'n-3系脂肪酸',  unit: 'g',     decimals: 1 },
  va:     { label: 'ビタミンA',    unit: 'µgRAE', decimals: 0 },
  ve:     { label: 'ビタミンE',    unit: 'mg',    decimals: 1 },
  vk:     { label: 'ビタミンK',    unit: 'µg',    decimals: 0 },
  vb1:    { label: 'ビタミンB1',   unit: 'mg',    decimals: 2 },
  vb2:    { label: 'ビタミンB2',   unit: 'mg',    decimals: 2 },
  nia:    { label: 'ナイアシン',   unit: 'mgNE',  decimals: 1 },
  vb6:    { label: 'ビタミンB6',   unit: 'mg',    decimals: 2 },
  vb12:   { label: 'ビタミンB12',  unit: 'µg',    decimals: 1 },
  fol:    { label: '葉酸',         unit: 'µg',    decimals: 0 },
  pan:    { label: 'パントテン酸', unit: 'mg',    decimals: 1 },
  bio:    { label: 'ビオチン',     unit: 'µg',    decimals: 1 },
  phos:   { label: 'リン',         unit: 'mg',    decimals: 0 },
  cu:     { label: '銅',           unit: 'mg',    decimals: 2 },
  mn:     { label: 'マンガン',     unit: 'mg',    decimals: 2 },
  iod:    { label: 'ヨウ素',       unit: 'µg',    decimals: 0 },
  se:     { label: 'セレン',       unit: 'µg',    decimals: 0 },
  cr:     { label: 'クロム',       unit: 'µg',    decimals: 0 },
  mo:     { label: 'モリブデン',   unit: 'µg',    decimals: 0 },
};

/** AI プロンプト用: 「key=名前(単位,小数n)」を空白区切りで並べた1行 */
export function nutrientPromptSpec(): string {
  return NUTRIENT_KEYS.map((k) => {
    const m = NUTRIENT_META[k];
    return `${k}=${m.label}(${m.unit}${m.decimals > 0 ? `,小数${m.decimals}` : ''})`;
  }).join(' ');
}

/** AI プロンプト用: JSON 雛形の品目に並べる `"salt":0,"fib":0,...` */
export function nutrientPromptJson(): string {
  return NUTRIENT_KEYS.map((k) => `"${k}":0`).join(',');
}

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
