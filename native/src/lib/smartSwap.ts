// かしこい置き換え（食材ナビ・純関数）
//
// 参考動画「スマートな食材の置き換え」の視座: 「オレンジ3個より赤パプリカ1個（ビタミンC）」
// 「納豆3パックよりサラダチキン1個（たんぱく質）」＝ **同じ栄養素量を取るのに必要な個数とkcal** を
// 個数の対比で見せる。ここではその計算だけを持ち、表示（絵文字×N・1行の文）は関数で組む。
//
// 【式】食材A の1食の目安量 gA に含まれる栄養素 X = per100A[X] × gA/100。
//      候補 B が同じ X を得るのに必要な量 gB = X / per100B[X] × 100、個数 = gB / 1単位の重さ、kcalB = per100B.kcal × gB/100。
//      減量（cut）: kcalB が kcalA の 70% 以下の候補を kcal の少ない順に最大3件。
//      増量（bulk）: kcalB が kcalA の 130% 以上の候補を kcal の多い順に最大3件（同じ栄養素をとりながらエネルギーも稼げる）。
//      どちらも gB ≤ 300g・個数 ≤ 6（「オレンジ12個」のような非現実な対比は出さない）。
//
// 【言い方の規約】「◯◯の方が優れている」は禁止。栄養素を限定した効率だけを言う:
//   「ビタミンCなら、赤パプリカ1個でオレンジ3個ぶん」。FORBIDDEN_WORDS はテストで全出力に対して固定する。
//   食材の価値判断（体に良い／悪い・太る）や命令（避けて・やめて）は一切書かない。
import { t } from './i18n';
import { pickL10n } from './remoteContent';
import {
  getNutrientDb, findFood, nutrientOf, kcalOf, signatureNutrient, foodName, NUTRIENT_META,
  type NutrientFood, type NavNutrient,
} from '@/content/nutrientDb';

export type SwapMode = 'cut' | 'bulk';

/** 対比の片側（食材・個数・g・kcal） */
export type SwapSide = { food: NutrientFood; units: number; grams: number; kcal: number };

export type Swap = {
  nutrient: NavNutrient;
  /** 栄養素の量（両側で同じ） */
  amount: number;
  from: SwapSide;
  to: SwapSide;
};

/** 置き換えの文に書いてはいけない語（価値判断・命令・体型の話）。テストで全出力を検査する */
export const FORBIDDEN_WORDS = ['優れ', '劣', 'ダメ', '悪い', '良い', 'いい', 'マシ', '避け', 'やめ', '太る', '痩せる', 'べき', '正解', '不正解', '勝ち', '負け'];

const CUT_RATIO = 0.7;      // 減量: kcal がこれ以下（70%）の候補だけ
const BULK_RATIO = 1.3;     // 増量: kcal がこれ以上（130%）の候補だけ
const MAX_GRAMS = 300;      // 候補の量の上限（1食で現実的な範囲）
const MAX_UNITS = 6;        // 対比の個数の上限（絵文字×6まで）
const MIN_UNITS = 0.25;     // これ未満の個数は「1/4個」より細かく非現実
export const MAX_SWAPS = 3;

/** 個数を 0.5 刻みに丸める（「2.5個」までは直感で読める。それ以上細かい端数は誤差） */
export function roundUnits(u: number): number {
  return Math.round(u * 2) / 2;
}

/**
 * 食材 from の1食の目安量に含まれる栄養素 nutrient と同じ量を、より少ない（cut）／多い（bulk）kcal で
 * 取れる候補を最大3件。栄養素を指定しなければ from の「得意な栄養素」（signatureNutrient）。
 * from に得意な栄養素が無い（主食・油など）か、候補が無ければ空配列
 */
export function swapsForFood(from: NutrientFood, opts: { nutrient?: NavNutrient | null; mode?: SwapMode; db?: NutrientFood[] } = {}): Swap[] {
  const mode = opts.mode ?? 'cut';
  const nutrient = opts.nutrient ?? signatureNutrient(from);
  if (!nutrient) return [];
  const db = opts.db ?? getNutrientDb();
  const gA = from.serving;
  const amount = nutrientOf(from, nutrient, gA);
  if (amount <= 0) return [];
  const kcalA = kcalOf(from, gA);
  const fromSide: SwapSide = { food: from, units: roundUnits(gA / from.unit.g), grams: gA, kcal: Math.round(kcalA) };
  const out: Swap[] = [];
  for (const b of db) {
    if (b.id === from.id || b.per100[nutrient] <= 0) continue;
    // 油はビタミンE以外の置き換え先にはしない（大さじ◯杯の油を「置き換え」と呼ぶのは無理がある）
    if (b.cat === 'oil' && nutrient !== 've') continue;
    const gB = (amount / b.per100[nutrient]) * 100;
    if (gB > MAX_GRAMS) continue;
    const units = roundUnits(gB / b.unit.g);
    if (units < MIN_UNITS || units > MAX_UNITS) continue;
    const kcalB = kcalOf(b, gB);
    if (mode === 'cut' ? kcalB > kcalA * CUT_RATIO : kcalB < kcalA * BULK_RATIO) continue;
    out.push({ nutrient, amount, from: fromSide, to: { food: b, units, grams: Math.round(gB), kcal: Math.round(kcalB) } });
  }
  out.sort((x, y) => (mode === 'cut' ? x.to.kcal - y.to.kcal : y.to.kcal - x.to.kcal));
  return out.slice(0, MAX_SWAPS);
}

/**
 * 品目名 → 置き換え候補。名前が食材辞書に無ければ空配列（＝該当なし。行を出さない）。
 * 「サラダチキン＋鮭おにぎり」のような複合名は最長一致した1食材で考える
 */
export function swapsFor(itemName: string, opts: { nutrient?: NavNutrient | null; mode?: SwapMode; db?: NutrientFood[] } = {}): Swap[] {
  const from = findFood(itemName, opts.db);
  if (!from) return [];
  return swapsForFood(from, opts);
}

// ===== 表示 =====

/**
 * 個数の表記。「3個」「大さじ2」「1.5枚」。単位が prefix（大さじ・小さじ）なら前に置く。
 * 個数は 0.5 刻み（roundUnits 済みを想定）。1未満は「1/2個」ではなく「0.5個」（全言語で数字のまま読める）
 */
export function countText(side: SwapSide, locale?: string): string {
  const unit = pickL10n(side.food.unit.label, locale);
  const n = side.units % 1 === 0 ? String(side.units) : side.units.toFixed(1);
  return side.food.unit.prefix ? `${unit}${n}` : `${n}${unit}`;
}

/** 絵文字の対比「🍊×3」。絵文字が無い品は丸チップ「●×3」 */
export function emojiText(side: SwapSide): string {
  return `${side.food.emoji ?? '●'}×${side.units % 1 === 0 ? side.units : side.units.toFixed(1)}`;
}

/** 栄養素名（現在の言語） */
export function nutrientLabel(key: NavNutrient, locale?: string): string {
  return pickL10n(NUTRIENT_META[key].label, locale);
}

/**
 * 1行の文。「ビタミンCなら、赤パプリカ1個でオレンジ3個ぶん」。
 * 栄養素を限定した効率だけを言い、価値判断の語を含めない（FORBIDDEN_WORDS）
 */
export function swapLine(sw: Swap, locale?: string): string {
  return t('{x}なら、{b}で{a}ぶん', {
    x: nutrientLabel(sw.nutrient, locale),
    b: `${foodName(sw.to.food, locale)}${countText(sw.to, locale)}`,
    a: `${foodName(sw.from.food, locale)}${countText(sw.from, locale)}`,
  });
}

/** kcal の差の一言（減量: 「約−120kcal」／増量: 「約+180kcal」）。差が10kcal未満なら空文字 */
export function swapKcalDelta(sw: Swap): string {
  const d = sw.to.kcal - sw.from.kcal;
  if (Math.abs(d) < 10) return '';
  return t('約{n}kcal', { n: `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString()}` });
}

/** 文中に禁止語が無いか（テスト用に公開） */
export function hasForbiddenWord(s: string): boolean {
  return FORBIDDEN_WORDS.some((w) => s.includes(w));
}
