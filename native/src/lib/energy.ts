// ヘルスケア（HealthKit）の活動エネルギーから「その日の消費kcal」を推計する純ロジック。
// 消費推計(TDEE) = 基礎代謝 + 活動kcal。
// 従来式（基礎代謝×生活係数＋手動運動加算）の代わりに、実測が取れる日はこちらを使う。

export const HK_NOISE_FLOOR = 50; // これ未満のkcalは「データなし」扱い（Watch未装着日は0が返るため）

// 直近日の活動kcal配列から平均を出す。信頼できる日（>=FLOOR）が3日未満なら null
export function averageActive(past: (number | null)[]): number | null {
  const vals = past.filter((v): v is number => v != null && v >= HK_NOISE_FLOOR);
  if (vals.length < 3) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * その日の計算に使う活動kcalを決める。
 * ・今日: 消費はまだ積み上がり中なので「当日実測」と「直近平均」の大きい方
 *   （朝に目標カロリーが低く出すぎるのを防ぐ。実測が平均を超えたら実測に従う）
 * ・過去日: その日の実測のみ（平均で補完しない）
 * ・データが無ければ null（呼び出し側で従来式にフォールバック）
 */
export function resolveActiveKcal(actual: number | null, avg: number | null, isToday: boolean): number | null {
  const act = actual != null && actual >= HK_NOISE_FLOOR ? actual : null;
  if (isToday) {
    if (act == null && avg == null) return null;
    return Math.max(act ?? 0, avg ?? 0);
  }
  return act;
}

// 消費kcal（TDEE推計）
export function tdeeFromHealth(bmr: number, activeKcal: number): number {
  return Math.round(bmr + activeKcal);
}
