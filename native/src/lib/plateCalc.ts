// プレート計算: 目標総重量とバー重量から「片側に付けるプレート」を出す純関数。
// ジムの床で暗算しなくて済むようにする（100kg・バー20kg → 片側40kg = 25+15）。
// 浮動小数の誤差を避けるため、内部は0.01kg単位の整数で計算する。

/** 一般的なジムのプレート（kg・降順）。貪欲法はこの並びで上から当てる */
export const PLATE_SIZES = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

/** 選べるバー重量（kg）。20=オリンピックバー・15=女子バー・10=軽量バー */
export const BAR_OPTIONS = [20, 15, 10] as const;

const toCent = (kg: number) => Math.round(kg * 100);

/**
 * 片側のプレート構成（降順）。
 * 目標がバー重量以下なら空配列（プレートなし＝バーのみ、または届かない）。
 * 1.25kg未満の端数は付けられないので切り捨てる（端数は plateRemainder で出す）。
 */
export function platesFor(total: number, bar: number): number[] {
  let side = toCent(total - bar) / 2;   // 片側に載せる量（0.01kg単位）
  if (side <= 0) return [];
  const out: number[] = [];
  for (const p of PLATE_SIZES) {
    const pc = toCent(p);
    while (side >= pc) { out.push(p); side -= pc; }
  }
  return out;
}

/** プレートで作れない片側の端数（kg・1.25kg未満）。端数なし・バー以下は0 */
export function plateRemainder(total: number, bar: number): number {
  const side = toCent(total - bar) / 2;
  if (side <= 0) return 0;
  const used = platesFor(total, bar).reduce((sum, p) => sum + toCent(p), 0);
  return (side - used) / 100;
}
