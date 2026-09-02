// 歩数→消費kcalの推定（純関数）と、「きょうの動き」の消費表示の優先順位。
//
// ■ なぜ推定を必ず用意するのか
// feat/active-kcal で「ヘルスケアのアクティブエネルギー実測」を消費の主表示にしたが、
// 実機では依然「10,013歩なのに 0kcal」が出た。原因は1つに絞れない:
//   (a) READ_TYPES にアクティブエネルギーを足しても、既存ユーザーは再許可されていない
//   (b) Apple Watch なしの iPhone 単体では、アクティブエネルギーがほぼ記録されない
//   (c) 直近7日が全部0のときは「消費（記録）」表示に落ちる設計＝結局アプリ記録の0が出る
// どの原因でも「1万歩＝0kcal」を見せないのが要件。歩数さえ取れていれば、
// 歩数から「およそ」の消費を出せるので、実測が無いときはこちらを見せる。
//
// ■ 推定式
//     消費kcal ≒ 歩数 × 0.0005 × 体重kg
// 体重70kg・1万歩で約350kcal。根拠: 歩行は体重1kgあたり・1kmあたり約0.5kcal
// （ACSMの歩行代謝式から導かれるおおまかな値）で、1歩≒0.7m とすると
// 1km≒1,400歩 → 0.5kcal ÷ 1,400歩 ≒ 0.00036kcal/kg/歩。ここに日常歩行に混じる
// 階段・小走り・荷物のぶんを見て 0.0005 に丸めている（≒運動タブが従来から逆算に
// 使っていた「体重×0.0005kcal/歩」と同じ係数＝数字の整合）。
// 歩幅・速度・体組成で±30%程度は動くため、UIでは必ず「およそ」「推定」を明示する。

/** 体重1kg・1歩あたりの消費kcal（歩数→kcal・kcal→歩数の両方向で同じ係数を使う） */
export const KCAL_PER_STEP_PER_KG = 0.0005;

/** 体重が未記録・不正なときの下限係数（40kg相当）。0除算や「あと∞歩」を出さないための床 */
const KCAL_PER_STEP_FLOOR = 0.02;

/** 1歩あたりの消費kcal（体重連動）。体重が取れないときは床値 */
export function kcalPerStep(weightKg: number): number {
  const w = Number(weightKg);
  if (!Number.isFinite(w) || w <= 0) return KCAL_PER_STEP_FLOOR;
  return Math.max(KCAL_PER_STEP_FLOOR, w * KCAL_PER_STEP_PER_KG);
}

/**
 * 歩数からの消費kcal推定（整数・0以上）。
 * 例: estimateStepsKcal(10000, 70) = 350
 */
export function estimateStepsKcal(steps: number, weightKg: number): number {
  const n = Number(steps);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * kcalPerStep(weightKg));
}

/**
 * kcalを歩数に逆算（100歩単位で切り上げ）。「あと約N歩で帳尻が合う」の1行が使う。
 * estimateStepsKcal と同じ係数を通すので、往復しても数字が食い違わない
 */
export function stepsForKcal(kcal: number, weightKg: number): number {
  const k = Number(kcal);
  if (!Number.isFinite(k) || k <= 0) return 0;
  return Math.ceil(k / kcalPerStep(weightKg) / 100) * 100;
}

/** 消費表示の出どころ。measured=ヘルスケア実測／steps=歩数からの推定／recorded=アプリ記録のみ */
export type BurnSource = 'measured' | 'steps' | 'recorded';

/**
 * 「きょうの動き」に出す消費kcalを決める（表示の優先順位を1か所に固定する）。
 *   ① ヘルスケア実測が >0 ならそれ（Apple Watch等がある人）
 *   ② 実測が 0/取れないが歩数 >0 なら歩数からの推定（iPhone単体・未許可の人）
 *   ③ どちらも無ければアプリに手で記録した運動ぶんだけ（従来表示）
 * ①②のkcalは activeKcalGoalBonus に渡せる「アクティブ相当」。③は目標側にすでに
 * adjとして入っているので上乗せに使ってはいけない（呼び出し側で source を見て判断する）
 */
export function resolveBurnKcal(input: {
  measured: number | null;
  steps: number | null;
  weightKg: number;
  recorded: number;
}): { source: BurnSource; kcal: number } {
  const m = Number(input.measured);
  if (input.measured != null && Number.isFinite(m) && m > 0) return { source: 'measured', kcal: Math.round(m) };
  const st = Number(input.steps);
  if (input.steps != null && Number.isFinite(st) && st > 0) {
    return { source: 'steps', kcal: estimateStepsKcal(st, input.weightKg) };
  }
  const r = Number(input.recorded);
  return { source: 'recorded', kcal: Number.isFinite(r) && r > 0 ? Math.round(r) : 0 };
}
