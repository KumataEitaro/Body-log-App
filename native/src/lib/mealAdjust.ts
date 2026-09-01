// トレイ品目の量補正（AI推定への1タップ補正・精度不信対策）。
// 「半分だけ食べた」の現実に合わせ、品目の栄養値を倍率で再計算する純関数群。
// qtyの表記規約:
//   ・通常qty（'50g'・'1個（113g）'等）: 補正は末尾に「 ×0.5」を付記する（'50g ×0.5'）。
//     ベースqtyが残るので、続けて別の倍率を選んでも複利にならない（常に×1相当から掛け直す）。
//   ・倍率だけのqty（マイ食品の '×0.17' 等）: 単一倍率に畳み込む（'×0.09'）。
//     この形式はチップの−/回数バッジ（servingCount）が解釈するため付記形式にしない。
//     畳み込み後の補正は「今トレイにある量」に対する相対倍率になる。
import { NUTRIENT_KEYS, type FoodItem, type NutrientKey } from './items';

/** 量補正チップの選択肢（スライダーの代わり。依存追加なしでこのアプリの流儀に合わせる） */
export const MULT_STEPS = [0.5, 0.75, 1, 1.5, 2] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * qty末尾の補正付記「 ×0.5」を分離する。
 * '50g ×0.5' → { base:'50g', mult:0.5 } / '50g' → { base:'50g', mult:1 }
 * '×0.17'（マイ食品の倍率qty全体）は付記ではないので base のまま mult=1。
 */
export function splitMult(qty: string): { base: string; mult: number } {
  const s = String(qty ?? '');
  const m = s.match(/^(.*\S)\s+[×x](\d+(?:\.\d+)?)$/);
  if (m) {
    const v = parseFloat(m[2]);
    if (Number.isFinite(v) && v > 0) return { base: m[1], mult: v };
  }
  return { base: s, mult: 1 };
}

/** 現在の補正倍率（量調整ポップの選択状態の表示に使う） */
export function currentMult(item: FoodItem): number {
  return splitMult(item.qty).mult;
}

type Scaled = Pick<FoodItem, 'kcal' | 'p' | 'f' | 'c'> & Partial<Record<NutrientKey, number>>;

// kcal/PFC＋分析用の追加栄養素をまとめて倍率スケールする
function scaleAll(item: FoodItem, r: number): Scaled {
  const out: Scaled = {
    kcal: round1((Number(item.kcal) || 0) * r),
    p: round1((Number(item.p) || 0) * r),
    f: round1((Number(item.f) || 0) * r),
    c: round1((Number(item.c) || 0) * r),
  };
  for (const k of NUTRIENT_KEYS) {
    const v = item[k];
    if (typeof v === 'number') out[k] = round1(v * r);
  }
  return out;
}

/**
 * 品目に補正倍率を適用してkcal/PFC/追加栄養素を再計算する。
 * mult はベース（×1相当）に対する倍率。連続で選び直しても複利にならない。
 */
export function applyMult(item: FoodItem, mult: number): FoodItem {
  if (!(mult > 0) || !Number.isFinite(mult)) return item;
  const { base, mult: cur } = splitMult(item.qty);
  // 倍率だけのqty（'×0.17'）は単一倍率へ畳み込む（servingCount等の既存解釈と互換）
  const pure = base.match(/^[×x](\d+(?:\.\d+)?)$/);
  if (pure && cur === 1) {
    if (mult === 1) return item;
    return { ...item, ...scaleAll(item, mult), qty: `×${round2(parseFloat(pure[1]) * mult)}` };
  }
  // 付記形式: いったんベース（×1相当）に戻す倍率を含めて一度に掛ける
  const r = mult / cur;
  const qty = mult === 1 ? base : base ? `${base} ×${round2(mult)}` : `×${round2(mult)}`;
  if (r === 1 && qty === item.qty) return item;
  return { ...item, ...scaleAll(item, r), qty };
}
