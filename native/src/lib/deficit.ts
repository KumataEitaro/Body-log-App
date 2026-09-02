// ダイエットの基本原理を1か所の純関数に集める。
//
// 「体重は1日ではなく、週と月の合計（収支）で決まる」。
// 今日+500kcal多くても、週の合計が目標の赤字に収まっていれば計画どおり。
// 逆に毎日ピッタリ守るのは非現実的で、それを唯一の正解に見せると挫折を生む。
//
// この考え方をUIに一貫して出すため、
//   - 目標画面の「必要な赤字（日/週/月）」「1日あたり食べられる量」「手動調整後の目標日」
//   - 食事タブの「超過の3段階」「週間・月間の収支カード」
// は、すべてここにある同じ関数から数字を作る（画面ごとに式を持たない）。
//
// 定数: 体脂肪1kg ≒ 7,200kcal（calc.ts FAT_KCAL_PER_KG）。計画計算（goal.ts computePlan）と共用。
import { FAT_KCAL_PER_KG } from './calc';
import { addDays, daysBetween } from './goal';

/** 体脂肪1kgぶんのkcal。目標画面と食事タブの収支が同じ物差しになるよう再エクスポート */
export const KCAL_PER_KG = FAT_KCAL_PER_KG;

/** 週1kg超の減量は筋量・ホルモンへの負担が大きくリバウンド率も高い（guard.tsと同じ上限） */
export const MAX_WEEKLY_LOSS_KG = 1;
/** 週0.5kg以上は「やや速い」の注意を添える帯 */
export const FAST_WEEKLY_LOSS_KG = 0.5;

export type DeficitPlan = {
  direction: 'cut' | 'bulk' | 'keep'; // 減量 / 増量 / 維持（目標=現在）
  kg: number;          // 現在 − 目標（正=減量・小数2桁）
  days: number;        // 今日→目標日の日数（最低1）
  total: number;       // 必要な総赤字kcal（正=赤字・負=増量の黒字）
  perDay: number;      // 1日あたり（符号はtotalと同じ）
  perWeek: number;     // 1週間あたり（perDay×7）
  perMonth: number;    // 1か月あたり（perDay×30・30日換算）
  weeklyPaceKg: number; // 週あたりの体重変化kg（正=減量）
  tooFast: boolean;    // 減量で週1kg超（ハードロック相当）
  fast: boolean;       // 減量で週0.5〜1kg（注意だけ）
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 目標体重と目標日から必要な赤字を算出する。
 *   総赤字 = (現在 − 目標)kg × 7,200kcal
 *   1日 = 総赤字 / 日数、1週 = 1日×7、1か月 = 1日×30
 * 目標日が今日以前なら日数は1として扱う（0除算を避け、非現実的な数字をそのまま見せる）。
 */
export function deficitPlan(currentKg: number, targetKg: number, todayISO: string, targetDateISO: string): DeficitPlan {
  const kg = round2(currentKg - targetKg);
  const days = Math.max(daysBetween(todayISO, targetDateISO), 1);
  const total = Math.round(kg * KCAL_PER_KG);
  const perDay = Math.round(total / days);
  const weeklyPaceKg = round2(kg / (days / 7));
  const direction: DeficitPlan['direction'] = kg > 0 ? 'cut' : kg < 0 ? 'bulk' : 'keep';
  return {
    direction, kg, days, total, perDay,
    perWeek: perDay * 7,
    perMonth: perDay * 30,
    weeklyPaceKg,
    tooFast: direction === 'cut' && weeklyPaceKg > MAX_WEEKLY_LOSS_KG,
    fast: direction === 'cut' && weeklyPaceKg >= FAST_WEEKLY_LOSS_KG && weeklyPaceKg <= MAX_WEEKLY_LOSS_KG,
  };
}

/**
 * 1日に食べられるkcal（食事タブのヒーロー「目標」と同じ式）。
 *   食べられる量 = max(維持kcal − 必要赤字/日 + 手動調整, BMR)
 * BMRを下限にするのは、基礎代謝を下回る目標は健康リスクが大きいため（手動調整でも割らせない）。
 * 手動調整=0・赤字=0 なら維持kcalそのまま（従来の「（維持）」表示と一致）。
 */
export function dailyAllowance(maintenanceKcal: number, requiredDaily: number, bmr: number, adjust = 0): number {
  const raw = Math.round(maintenanceKcal - requiredDaily + (Number.isFinite(adjust) ? adjust : 0));
  return Math.max(raw, Math.round(bmr));
}

/**
 * 「この設定だと目標日はいつごろになるか」。
 * 手動調整で1日の赤字が変わったとき、目標日をこっそり固定したまま数字だけ動かすのは不正直なので、
 * 赤字から逆算した到達日を見せる。
 * @param dailyDeficit 1日の赤字kcal（減量なら正・増量なら負）。方向が合わない／0なら null（＝届かない）
 */
export function projectedTargetDate(currentKg: number, targetKg: number, todayISO: string, dailyDeficit: number): string | null {
  const total = Math.round((currentKg - targetKg) * KCAL_PER_KG);
  if (total === 0) return todayISO;
  if (!Number.isFinite(dailyDeficit) || dailyDeficit === 0) return null;
  if (Math.sign(total) !== Math.sign(dailyDeficit)) return null;
  const days = Math.ceil(total / dailyDeficit);
  return addDays(todayISO, days);
}

/** 手動調整の幅。±1,000kcal/日を超える調整は事故（打ち間違い）と見て丸める */
export const ADJUST_LIMIT = 1000;
export function clampAdjust(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-ADJUST_LIMIT, Math.min(ADJUST_LIMIT, Math.round(n)));
}

// ===== 超過の3段階 =====
// 「ピッタリかマイナスだけが正解」に見せない。〜+300は誤差の範囲、+800までは週で吸収できる幅、
// それ以上ではじめて従来の赤（coral）にする。
export type OverLevel = 'none' | 'mild' | 'mid' | 'high';
export const OVER_MILD_MAX = 300;
export const OVER_MID_MAX = 800;
export function overLevel(overKcal: number): OverLevel {
  if (!(overKcal > 0)) return 'none';
  if (overKcal <= OVER_MILD_MAX) return 'mild';
  if (overKcal <= OVER_MID_MAX) return 'mid';
  return 'high';
}

// ===== 週間・月間の収支 =====
export type BalanceDay = {
  date: string;
  intake: number | null;   // 記録が無い日は null（合計に入れない・点は空）
  maintenance: number;     // その日の維持kcal（BMR×係数＋運動）
  allowance: number;       // その日の目標kcal（維持 − 赤字 + 調整）
};
export type DotState = 'under' | 'even' | 'over' | 'none';
export type Balance = {
  actual: number;    // Σ(摂取 − 維持)。負=赤字（減量が進む方向）
  goal: number;      // −必要赤字/日 × 日数（減量なら負・増量なら正）
  recorded: number;  // 記録のあった日数
  days: number;      // 対象日数
  dots: DotState[];  // 日別の目標対比（green=不足/gray=ほぼ/amber=超過）
};
/** 「ほぼ目標どおり」とみなす幅（±kcal/日） */
export const EVEN_BAND = 100;

export function balanceOf(days: BalanceDay[], perDayDeficit: number): Balance {
  let actual = 0;
  let recorded = 0;
  const dots: DotState[] = days.map((d) => {
    if (d.intake == null) return 'none';
    recorded += 1;
    actual += d.intake - d.maintenance;
    const diff = d.intake - d.allowance;
    if (diff < -EVEN_BAND) return 'under';
    if (diff <= EVEN_BAND) return 'even';
    return 'over';
  });
  return {
    actual: Math.round(actual),
    goal: -Math.round(perDayDeficit) * days.length,
    recorded, days: days.length, dots,
  };
}

/** 収支バーの塗り率（0〜1）。目標と同じ方向に進んだぶんだけ満ちる（逆方向・目標0は0） */
export function balanceFill(b: Balance): number {
  if (b.goal === 0) return 0;
  const ratio = b.actual / b.goal;
  if (!(ratio > 0)) return 0;
  return Math.min(1, ratio);
}
