// 日本人の食事摂取基準（2025年版）— 成人の基準値（性別 × 年齢区分）と、本人の属性からの解決
//
// 【出典・版】厚生労働省「日本人の食事摂取基準（2025年版）」策定検討会報告書（令和6年10月・使用期間 2025年4月〜2030年3月）
//   報告書の掲載ページ: https://www.mhlw.go.jp/stf/newpage_44138.html
//   各論 PDF（一次資料）:
//     たんぱく質            https://www.mhlw.go.jp/content/10904750/001316462.pdf
//     脂質（飽和脂肪酸・n-6・n-3） https://www.mhlw.go.jp/content/10904750/001316463.pdf
//     炭水化物（食物繊維）  https://www.mhlw.go.jp/content/10904750/001316464.pdf
//     エネルギー産生栄養素バランス https://www.mhlw.go.jp/content/10904750/001316465.pdf
//     脂溶性ビタミン（A・D・E・K） https://www.mhlw.go.jp/content/10904750/001316466.pdf
//     水溶性ビタミン（B1・B2・ナイアシン・B6・B12・葉酸・パントテン酸・ビオチン・C） https://www.mhlw.go.jp/content/10904750/001316467.pdf
//     多量ミネラル（Na・K・Ca・Mg・P） https://www.mhlw.go.jp/content/10904750/001316468.pdf
//     微量ミネラル（Fe・Zn・Cu・Mn・I・Se・Cr・Mo） https://www.mhlw.go.jp/content/10904750/001316469.pdf
//   転記の確認に使った二次資料（同報告書の表を栄養素ごとに掲載）: 健康長寿ネット（公益財団法人長寿科学振興財団）
//     https://www.tyojyu.or.jp/net/kenkou-tyoju/eiyouso/ 配下の各栄養素ページ（2025年版に更新済み）と
//     高齢者の食事摂取基準 https://www.tyojyu.or.jp/net/kenkou-tyoju/koureisha-shokuji/koureisha-sesshu-kijun.html
//   転記日: 2026-09-25。ナイアシン 30〜49歳男性の推奨量は資料により 15／16 mgNE の表記揺れがあり、表形式の2資料が一致する 16 を採用。
//
// 【扱い方】
//   ・成人（18歳以上）の5区分だけを持つ。18歳未満・性別/年齢未設定は近い区分を「参考値」として使う（approximate=true）。
//   ・妊婦・授乳婦の付加量は持たない（本アプリは妊娠・授乳中の利用を想定しない。docs/LEGAL.md）。
//   ・耐容上限量は判定に使わない（上限超えの判定は目標量に上限がある食塩・飽和脂肪酸だけ）。
//   ・たんぱく質はアプリの目標（体重×g/kg）を優先し、体重が無いときだけ推奨量にフォールバックする。
//   ・脂質・炭水化物・飽和脂肪酸は %エネルギーの目標量。維持カロリーが分かるときだけ g に換算して比べる。
//   ・糖類は 2025年版に基準が無いので null（記録のみ）。
//   ・鉄の女性は「月経あり／なし」で推奨量が違う。50歳未満は月経ありを既定にし、画面で切り替えられる（判定の根拠を必ず表示する）。
import { NUTRIENT_KEYS, NUTRIENT_META, type NutrientKey } from '@/lib/items';
import { PROTEIN_PER_KG_DEFAULT } from '@/lib/goal';

export const DRI_EDITION = '日本人の食事摂取基準（2025年版）';
export const DRI_SOURCE_URL = 'https://www.mhlw.go.jp/stf/newpage_44138.html';

export type Sex = 'male' | 'female';
export type AgeBand = '18-29' | '30-49' | '50-64' | '65-74' | '75+';
export const AGE_BANDS: readonly AgeBand[] = ['18-29', '30-49', '50-64', '65-74', '75+'] as const;
export const AGE_BAND_LABEL: Record<AgeBand, string> = { '18-29': '18〜29歳', '30-49': '30〜49歳', '50-64': '50〜64歳', '65-74': '65〜74歳', '75+': '75歳以上' };

/** 基準値の種類。判定の向きが違う（下限型＝足りているか／上限型＝超えていないか／範囲型） */
export type RefKind = 'rda' | 'ai' | 'dg_lower' | 'dg_upper' | 'dg_range' | 'app';
export const REF_KIND_LABEL: Record<RefKind, string> = {
  rda: '推奨量', ai: '目安量', dg_lower: '目標量', dg_upper: '目標量（上限）', dg_range: '目標量（範囲）', app: 'アプリの目標',
};

/** 基準値を持つキー（たんぱく質・脂質・炭水化物 ＋ 微量栄養素） */
export type RefKey = 'p' | 'f' | 'c' | NutrientKey;
export const REF_KEYS: readonly RefKey[] = ['p', 'f', 'c', ...NUTRIENT_KEYS] as const;

type Row = readonly [number, number, number, number, number];   // 18-29 / 30-49 / 50-64 / 65-74 / 75+
type Table = {
  kind: 'rda' | 'ai' | 'dg_lower' | 'dg_upper';
  male: Row; female: Row;
  /** 推定平均必要量（推奨量型のみ。判定の補助情報） */
  earMale?: Row; earFemale?: Row;
  /** 鉄だけ: 女性・月経ありの 18-29 / 30-49 / 50-64 */
  femaleMenses?: readonly [number, number, number];
  earFemaleMenses?: readonly [number, number, number];
};

const same = (v: number): Row => [v, v, v, v, v];

/** 1日あたりの基準値（単位は lib/items.ts NUTRIENT_META と同じ。たんぱく質は g/日） */
export const DRI: Record<Exclude<RefKey, 'f' | 'c' | 'sug' | 'satfat'>, Table> = {
  // ---- たんぱく質（推奨量 g/日）。目標量は 13〜20%E（65歳以上は 15〜20%E）だがここでは持たない ----
  p:    { kind: 'rda', male: [65, 65, 65, 60, 60], female: same(50), earMale: same(50), earFemale: same(40) },
  // ---- 多量ミネラル ----
  salt: { kind: 'dg_upper', male: same(7.5), female: same(6.5) },                       // 食塩相当量 g/日 未満
  k:    { kind: 'dg_lower', male: same(3000), female: same(2600) },                     // 目安量は 2,500 / 2,000
  ca:   { kind: 'rda', male: [800, 750, 750, 750, 750], female: [650, 650, 650, 650, 600],
          earMale: [650, 650, 600, 600, 600], earFemale: [550, 550, 550, 550, 500] },
  mg:   { kind: 'rda', male: [340, 380, 370, 350, 330], female: [280, 290, 290, 280, 270],
          earMale: [280, 320, 310, 290, 270], earFemale: [230, 240, 240, 240, 220] },
  phos: { kind: 'ai', male: same(1000), female: same(800) },
  // ---- 微量ミネラル ----
  fe:   { kind: 'rda', male: [7.0, 7.5, 7.0, 7.0, 6.5], female: [6.0, 6.0, 6.0, 6.0, 5.5],
          earMale: [5.5, 6.0, 6.0, 5.5, 5.5], earFemale: [5.0, 5.0, 5.0, 5.0, 4.5],
          femaleMenses: [10.0, 10.5, 10.5], earFemaleMenses: [7.0, 7.5, 7.5] },
  zn:   { kind: 'rda', male: [9.0, 9.5, 9.5, 9.0, 9.0], female: [7.5, 8.0, 8.0, 7.5, 7.0],
          earMale: [7.5, 8.0, 8.0, 7.5, 7.5], earFemale: [6.0, 6.5, 6.5, 6.5, 6.0] },
  cu:   { kind: 'rda', male: [0.8, 0.9, 0.9, 0.8, 0.8], female: same(0.7), earMale: [0.7, 0.8, 0.7, 0.7, 0.7], earFemale: same(0.6) },
  mn:   { kind: 'ai', male: same(3.5), female: same(3.0) },
  iod:  { kind: 'rda', male: same(140), female: same(140), earMale: same(100), earFemale: same(100) },
  se:   { kind: 'rda', male: [30, 35, 30, 30, 30], female: same(25), earMale: same(25), earFemale: same(20) },
  cr:   { kind: 'ai', male: same(10), female: same(10) },
  mo:   { kind: 'rda', male: [30, 30, 30, 30, 25], female: same(25), earMale: [20, 25, 25, 20, 20], earFemale: same(20) },
  // ---- 脂溶性ビタミン ----
  va:   { kind: 'rda', male: [850, 900, 900, 850, 800], female: [650, 700, 700, 700, 650],
          earMale: [600, 650, 650, 600, 550], earFemale: [450, 500, 500, 500, 450] },
  vd:   { kind: 'ai', male: same(9.0), female: same(9.0) },
  ve:   { kind: 'ai', male: [6.5, 6.5, 6.5, 7.5, 7.0], female: [5.0, 6.0, 6.0, 7.0, 6.0] },
  vk:   { kind: 'ai', male: same(150), female: same(150) },
  // ---- 水溶性ビタミン ----
  vb1:  { kind: 'rda', male: [1.1, 1.2, 1.1, 1.0, 1.0], female: [0.8, 0.9, 0.8, 0.8, 0.7],
          earMale: [0.8, 0.8, 0.8, 0.7, 0.7], earFemale: [0.6, 0.6, 0.6, 0.6, 0.5] },
  vb2:  { kind: 'rda', male: [1.6, 1.7, 1.6, 1.4, 1.4], female: [1.2, 1.2, 1.2, 1.1, 1.1],
          earMale: [1.3, 1.4, 1.3, 1.2, 1.1], earFemale: [1.0, 1.0, 1.0, 0.9, 0.9] },
  nia:  { kind: 'rda', male: [15, 16, 15, 14, 13], female: [11, 12, 11, 11, 10],
          earMale: [13, 13, 13, 11, 11], earFemale: [9, 10, 9, 9, 8] },
  vb6:  { kind: 'rda', male: [1.5, 1.5, 1.5, 1.4, 1.4], female: same(1.2), earMale: same(1.2), earFemale: same(1.0) },
  vb12: { kind: 'ai', male: same(4.0), female: same(4.0) },
  fol:  { kind: 'rda', male: same(240), female: same(240), earMale: same(200), earFemale: same(200) },
  pan:  { kind: 'ai', male: same(6), female: same(5) },
  bio:  { kind: 'ai', male: same(50), female: same(50) },
  vc:   { kind: 'rda', male: same(100), female: same(100), earMale: same(80), earFemale: same(80) },
  // ---- 脂質の内訳・食物繊維 ----
  n6:   { kind: 'ai', male: [12, 11, 11, 10, 9], female: [9, 9, 9, 9, 8] },
  n3:   { kind: 'ai', male: [2.2, 2.2, 2.3, 2.3, 2.3], female: [1.7, 1.7, 1.9, 2.0, 2.0] },
  fib:  { kind: 'dg_lower', male: [20, 22, 22, 21, 20], female: [18, 18, 18, 18, 17] },
};

/** %エネルギーの目標量（成人・男女共通）。維持カロリーが分かるときだけ g に換算する */
export const DRI_PERCENT_E = {
  f: { lower: 20, upper: 30, kcalPerG: 9 },        // 脂質 20〜30%E
  c: { lower: 50, upper: 65, kcalPerG: 4 },        // 炭水化物 50〜65%E
  satfat: { upper: 7, kcalPerG: 9 },               // 飽和脂肪酸 7%E 以下（18歳以上）
} as const;

/** 年齢 → 区分。18歳未満は最も近い 18-29（参考値扱いは呼び出し側）。不明は null */
export function ageBandOf(age: number | null | undefined): AgeBand | null {
  const a = Number(age);
  if (!Number.isFinite(a) || a <= 0) return null;
  if (a < 30) return '18-29';
  if (a < 50) return '30-49';
  if (a < 65) return '50-64';
  if (a < 75) return '65-74';
  return '75+';
}

export type RefProfile = {
  sex: Sex | null;
  age: number | null;
  /** 最新の体重（たんぱく質の目標＝体重×g/kg） */
  weightKg: number | null;
  /** 維持カロリー（%E の目標量を g に換算する分母）。不明なら null */
  targetKcal: number | null;
  proteinPerKg?: number | null;
  /** 女性の鉄。null は「未設定」＝50歳未満なら月経ありとみなす */
  menstruating?: boolean | null;
};

export type NutrientRef = {
  key: RefKey;
  kind: RefKind;
  /** 比べる値（下限型・推奨量型は目標、上限型は上限、範囲型は下限） */
  target: number;
  /** 範囲型の上限 */
  upper?: number;
  /** 推定平均必要量（推奨量型のみ） */
  ear?: number;
  unit: string;
  /** 解決に使った属性。approximate は「性別/年齢が未設定・18歳未満」などで近い区分を代用したとき */
  sexUsed: Sex;
  bandUsed: AgeBand;
  approximate: boolean;
  /** 鉄（女性）だけ: 月経ありの値を使ったか */
  menses?: boolean;
  /** たんぱく質（アプリの目標）だけ: g/kg */
  perKg?: number;
  /** %E 型だけ: 元の %E */
  percentE?: { lower?: number; upper?: number };
};

function unitOf(key: RefKey): string {
  return key === 'p' || key === 'f' || key === 'c' ? 'g' : NUTRIENT_META[key].unit;
}

/**
 * 本人の属性から1栄養素の基準値を解決する。基準が無い（糖類）・換算できない（維持カロリー不明の %E 型）は null。
 * 性別が未設定なら女性（値の低い側）、年齢が未設定なら 30〜49歳 を代用して approximate=true にする。
 */
export function resolveReference(key: RefKey, profile: RefProfile): NutrientRef | null {
  if (key === 'sug') return null;
  const sexUsed: Sex = profile.sex === 'male' || profile.sex === 'female' ? profile.sex : 'female';
  const band = ageBandOf(profile.age);
  const bandUsed: AgeBand = band ?? '30-49';
  const approximate = profile.sex !== sexUsed || band == null || Number(profile.age) < 18;
  const unit = unitOf(key);
  const idx = AGE_BANDS.indexOf(bandUsed);

  // たんぱく質: アプリの目標（体重×g/kg）を優先
  if (key === 'p' && profile.weightKg != null && profile.weightKg > 0) {
    const perKg = profile.proteinPerKg != null && profile.proteinPerKg > 0 ? profile.proteinPerKg : PROTEIN_PER_KG_DEFAULT;
    return { key, kind: 'app', target: Math.round(profile.weightKg * perKg), unit, sexUsed, bandUsed, approximate: false, perKg };
  }
  // %E 型: 維持カロリーが要る
  if (key === 'f' || key === 'c' || key === 'satfat') {
    const kcal = profile.targetKcal;
    if (kcal == null || !(kcal > 0)) return null;
    if (key === 'satfat') {
      const sf = DRI_PERCENT_E.satfat;
      return { key, kind: 'dg_upper', target: Math.round((kcal * sf.upper / 100) / sf.kcalPerG), unit, sexUsed, bandUsed, approximate, percentE: { upper: sf.upper } };
    }
    const pe = DRI_PERCENT_E[key];
    const lower = Math.round((kcal * pe.lower / 100) / pe.kcalPerG);
    const upper = Math.round((kcal * pe.upper / 100) / pe.kcalPerG);
    return { key, kind: 'dg_range', target: lower, upper, unit, sexUsed, bandUsed, approximate, percentE: { lower: pe.lower, upper: pe.upper } };
  }
  const table = DRI[key];
  if (!table) return null;
  // 鉄（女性・50歳未満）: 月経あり／なし
  if (key === 'fe' && sexUsed === 'female' && idx <= 2) {
    const menses = profile.menstruating ?? true;
    if (menses && table.femaleMenses) {
      return { key, kind: table.kind, target: table.femaleMenses[idx], ear: table.earFemaleMenses?.[idx], unit, sexUsed, bandUsed, approximate, menses: true };
    }
    return { key, kind: table.kind, target: table.female[idx], ear: table.earFemale?.[idx], unit, sexUsed, bandUsed, approximate, menses: false };
  }
  const row = sexUsed === 'male' ? table.male : table.female;
  const earRow = sexUsed === 'male' ? table.earMale : table.earFemale;
  return { key, kind: table.kind, target: row[idx], ear: earRow?.[idx], unit, sexUsed, bandUsed, approximate };
}

/** 全キーぶんまとめて解決する（画面は1回呼ぶだけ） */
export function resolveAllReferences(profile: RefProfile): Record<RefKey, NutrientRef | null> {
  const out = {} as Record<RefKey, NutrientRef | null>;
  for (const k of REF_KEYS) out[k] = resolveReference(k, profile);
  return out;
}
