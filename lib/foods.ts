// マイ食品の「よく使う量」まわりのロジック

export type MyFoodRow = {
  id: string; name: string; unit: string;
  kcal: number; p: number; f: number; c: number;
  serving_label?: string | null;   // よく使う量の名前（例: 丼1杯）
  serving_ratio?: number | null;   // 基準量に対する倍率（例: 1/6 → 0.1667）
};

// 「1/6」「0.17」「2」などを倍率に変換
export function parseRatio(s: string): number | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const den = parseFloat(m[2]);
    if (den <= 0) return null;
    return parseFloat(m[1]) / den;
  }
  const v = parseFloat(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// チップで追加するときの1回分。
// 登録合計＝基準(×1)とし、serving_ratio（タップ時の量）を掛けた値を返す。
// qtyは「×0.17」形式（分量編集で数値を変えると自動再計算が効く）
export function servingOf(fd: MyFoodRow): { qty: string; kcal: number; p: number; f: number; c: number } {
  const r = fd.serving_ratio != null && Number(fd.serving_ratio) > 0 ? Number(fd.serving_ratio) : 1;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const rDisp = Math.round(r * 100) / 100;
  return {
    qty: `×${rDisp}`,
    kcal: round1((Number(fd.kcal) || 0) * r),
    p: round1((Number(fd.p) || 0) * r),
    f: round1((Number(fd.f) || 0) * r),
    c: round1((Number(fd.c) || 0) * r),
  };
}
