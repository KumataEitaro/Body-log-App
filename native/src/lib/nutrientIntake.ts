// 自分の記録から栄養素の摂取を集計し、食事摂取基準と比べる（純関数・画面は描くだけ）
//
// 栄養ランキング画面（app/nutrient-rank.tsx・2026-09-25 改修）の土台。
//  ・「自分の摂取」タブ: logs.items[] を品目名で名寄せ（lib/foodName の foodKey）し、栄養素ごとに
//    「1日あたりの平均量」で並べる。分母は **記録のある日数**（品目が1つでもある日）。
//  ・「不足栄養素」タブ: 30日の1日平均を content/dri2025 の基準（性別×年齢×体重）と比べ、静かな判定語を付ける。
//
// 【不明と 0 を混ぜない】
//   ・kcal / P / F / C はどの品目にもある（無ければ 0）。
//   ・微量栄養素は「その品目に値があるとき」だけ数える。AI 解析の品目は 31 キーを持つが、旧記録（10キー）・
//     2026-09-24 以前に登録したマイ食品（PFC のみ）は持たない。プロンプトは「不明・微量は 0」と指示しているので
//     全キーが 0／欠損の品目は **値なし** として扱う（1つでも正の値があれば、その品目の 0 は本当の 0）。
//   ・平均は「値のある品目の合計 ÷ 記録のある日数」。値の無い品目が混ざる分だけ過小になり得るので、
//     画面は coverage（値のある品目 / 全品目）を必ず添える。
import { NUTRIENT_KEYS, NUTRIENT_META, type NutrientKey } from './items';
import { foodBaseName, foodKey } from './foodName';
import { type NutrientRef, type RefKey } from '@/content/dri2025';
import { LOG_TO_NAV, RICH_FOOD_IDS, LIVER_IDS } from '@/content/nutrientFoods';
import { findFood, getNutrientDb, nutrientOf, rankByNutrient, type NutrientFood } from '@/content/nutrientDb';

export type IntakeKey = 'kcal' | RefKey;
export const INTAKE_KEYS: readonly IntakeKey[] = ['kcal', 'p', 'f', 'c', ...NUTRIENT_KEYS] as const;

/** 直近何日を見るか（今日を含む） */
export const WINDOW_DAYS = 30;

type Meta = { label: string; unit: string; decimals: 0 | 1 | 2 };
const MACRO_META: Record<'kcal' | 'p' | 'f' | 'c', Meta> = {
  kcal: { label: 'カロリー', unit: 'kcal', decimals: 0 },
  p: { label: 'たんぱく質', unit: 'g', decimals: 1 },
  f: { label: '脂質', unit: 'g', decimals: 1 },
  c: { label: '炭水化物', unit: 'g', decimals: 1 },
};

/** 表示名（日本語原文）・単位・桁 */
export function intakeMeta(key: IntakeKey): Meta {
  return key === 'kcal' || key === 'p' || key === 'f' || key === 'c' ? MACRO_META[key] : NUTRIENT_META[key];
}

/** 画面のチップ分け（主要 / ビタミン / ミネラル） */
export type IntakeGroup = 'main' | 'vitamin' | 'mineral';
export const INTAKE_GROUPS: Record<IntakeGroup, readonly IntakeKey[]> = {
  main: ['p', 'f', 'c', 'fib', 'salt', 'sug', 'satfat', 'n3', 'n6'],
  vitamin: ['va', 'vd', 've', 'vk', 'vb1', 'vb2', 'nia', 'vb6', 'vb12', 'fol', 'pan', 'bio', 'vc'],
  mineral: ['k', 'ca', 'mg', 'phos', 'fe', 'zn', 'cu', 'mn', 'iod', 'se', 'cr', 'mo'],
};

export type RawLog = { date: string; items: unknown };

export type FoodAgg = {
  /** 名寄せキー（foodKey） */
  key: string;
  /** 表示名（分量を落とした最初の表記） */
  name: string;
  /** 記録回数（品目の出現数） */
  times: number;
  /** 食べた日数 */
  days: number;
  /** 30日の合計（値のある品目のみ） */
  total: Partial<Record<IntakeKey, number>>;
  /** 値のあった品目数 */
  known: Partial<Record<IntakeKey, number>>;
};

export type IntakeAgg = {
  /** 記録のある日数（品目が1つでもある日） */
  days: number;
  /** 品目の総数 */
  items: number;
  foods: FoodAgg[];
  total: Partial<Record<IntakeKey, number>>;
  known: Partial<Record<IntakeKey, number>>;
  /** 出てきた品目名（重複なし・元の表記）。図鑑の「食べたことがある」判定に使う */
  eatenNames: string[];
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** その品目に微量栄養素の値があるか（1つでも正の値がある） */
export function hasMicroData(it: Record<string, unknown>): boolean {
  for (const k of NUTRIENT_KEYS) { const v = it[k]; if (isNum(v) && v > 0) return true; }
  return false;
}

/** 品目のある栄養素の値。kcal/PFC は常に数値（無ければ 0）、微量栄養素は値が無ければ null */
export function itemValue(it: Record<string, unknown>, key: IntakeKey, micro = hasMicroData(it)): number | null {
  if (key === 'kcal' || key === 'p' || key === 'f' || key === 'c') return Math.max(0, Number(it[key]) || 0);
  if (!micro) return null;
  const v = it[key];
  return isNum(v) ? Math.max(0, v) : null;
}

/** logs の行（date, items）を集計する。items が配列でない行・名前の無い品目は飛ばす */
export function aggregateIntake(rows: readonly RawLog[]): IntakeAgg {
  const foods = new Map<string, FoodAgg & { dates: Set<string> }>();
  const dates = new Set<string>();
  const total: Partial<Record<IntakeKey, number>> = {};
  const known: Partial<Record<IntakeKey, number>> = {};
  const eaten = new Set<string>();
  let items = 0;
  for (const r of rows) {
    if (!Array.isArray(r.items)) continue;
    for (const raw of r.items) {
      if (typeof raw !== 'object' || raw == null) continue;
      const it = raw as Record<string, unknown>;
      const name = typeof it.name === 'string' ? it.name.trim() : '';
      if (!name) continue;
      const key = foodKey(name);
      if (!key) continue;
      items++;
      dates.add(r.date);
      eaten.add(name);
      let f = foods.get(key);
      if (!f) { f = { key, name: foodBaseName(name) || name, times: 0, days: 0, total: {}, known: {}, dates: new Set() }; foods.set(key, f); }
      f.times++;
      f.dates.add(r.date);
      const micro = hasMicroData(it);
      for (const k of INTAKE_KEYS) {
        const v = itemValue(it, k, micro);
        if (v == null) continue;
        f.total[k] = (f.total[k] ?? 0) + v;
        f.known[k] = (f.known[k] ?? 0) + 1;
        total[k] = (total[k] ?? 0) + v;
        known[k] = (known[k] ?? 0) + 1;
      }
    }
  }
  const list: FoodAgg[] = [...foods.values()].map(({ dates: d, ...rest }) => ({ ...rest, days: d.size }));
  return { days: dates.size, items, foods: list, total, known, eatenNames: [...eaten] };
}

/** 1日あたりの平均（値のある品目の合計 ÷ 記録のある日数）。値が1つも無ければ null */
export function perDayAverage(agg: IntakeAgg, key: IntakeKey): number | null {
  if (agg.days === 0 || !(agg.known[key] ?? 0)) return null;
  return (agg.total[key] ?? 0) / agg.days;
}

/** 値のある品目数 / 全品目数 */
export function coverageOf(agg: IntakeAgg, key: IntakeKey): { known: number; items: number } {
  return { known: agg.known[key] ?? 0, items: agg.items };
}

export type FoodRank = { food: FoodAgg; perDay: number; total: number };

/** その栄養素を多く運んだ食材（30日合計の多い順）。値が 0 の食材は載せない */
export function rankFoods(agg: IntakeAgg, key: IntakeKey, top = 10): FoodRank[] {
  if (agg.days === 0) return [];
  return agg.foods
    .filter((f) => (f.known[key] ?? 0) > 0 && (f.total[key] ?? 0) > 0)
    .map((f) => ({ food: f, perDay: (f.total[key] ?? 0) / agg.days, total: f.total[key] ?? 0 }))
    .sort((a, b) => b.total - a.total || a.food.name.localeCompare(b.food.name))
    .slice(0, top);
}

// ===== 判定 =====

export type Verdict = 'ok' | 'slightlyLow' | 'low' | 'over' | 'noData' | 'noRef';
/** 並び順: 少なめ → やや少なめ → 超えている → 足りている → 記録に値なし → 基準なし */
export const VERDICT_ORDER: Record<Verdict, number> = { low: 0, slightlyLow: 1, over: 2, ok: 3, noData: 4, noRef: 5 };
/** 判定語（日本語原文。画面は t() に通す） */
export const VERDICT_LABEL: Record<Verdict, string> = {
  ok: '足りている', slightlyLow: 'やや少なめ', low: '少なめ', over: '超えている', noData: '記録に値なし', noRef: '基準なし',
};

/** 基準の 90% 以上で「足りている」、70% 以上で「やや少なめ」。それ未満は「少なめ」 */
export const OK_RATIO = 0.9;
export const SLIGHT_RATIO = 0.7;

/**
 * 平均と基準から判定する。
 *  ・上限型（食塩・飽和脂肪酸）: 上限以下なら ok、超えれば over
 *  ・範囲型（脂質・炭水化物の %E）: 下限未満は下限との比で少なめ判定、上限超えは over、間は ok
 *  ・推奨量・目安量・目標量（下限）・アプリの目標: 目標との比で判定
 */
export function judge(avg: number | null, ref: NutrientRef | null): { verdict: Verdict; ratio: number | null } {
  if (avg == null) return { verdict: 'noData', ratio: null };
  if (!ref) return { verdict: 'noRef', ratio: null };
  if (ref.kind === 'dg_upper') {
    const ratio = ref.target > 0 ? avg / ref.target : null;
    return { verdict: ratio != null && ratio > 1 ? 'over' : 'ok', ratio };
  }
  if (ref.kind === 'dg_range' && ref.upper != null) {
    if (avg > ref.upper) return { verdict: 'over', ratio: avg / ref.upper };
    const ratio = ref.target > 0 ? avg / ref.target : null;
    return { verdict: lowVerdict(ratio), ratio };
  }
  const ratio = ref.target > 0 ? avg / ref.target : null;
  return { verdict: lowVerdict(ratio), ratio };
}

function lowVerdict(ratio: number | null): Verdict {
  if (ratio == null) return 'noRef';
  if (ratio >= OK_RATIO) return 'ok';
  if (ratio >= SLIGHT_RATIO) return 'slightlyLow';
  return 'low';
}

export type GapRow = {
  key: RefKey;
  avg: number | null;
  ref: NutrientRef | null;
  verdict: Verdict;
  ratio: number | null;
  known: number;
  items: number;
};

/** 全栄養素の判定行。不足が先（少なめ → やや少なめ → 超えている → 足りている → 値なし → 基準なし）、同じ判定内は比の小さい順 */
export function buildGapRows(agg: IntakeAgg, refs: Record<RefKey, NutrientRef | null>, keys: readonly RefKey[]): GapRow[] {
  const rows: GapRow[] = keys.map((key) => {
    const avg = perDayAverage(agg, key);
    const ref = refs[key];
    const { verdict, ratio } = judge(avg, ref);
    const cov = coverageOf(agg, key);
    return { key, avg, ref, verdict, ratio, known: cov.known, items: cov.items };
  });
  return rows.sort((a, b) => {
    const o = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
    if (o !== 0) return o;
    if (a.verdict === 'over') return (b.ratio ?? 0) - (a.ratio ?? 0);
    return (a.ratio ?? 0) - (b.ratio ?? 0);
  });
}

// ===== おすすめ食材 =====

export type Suggestion = {
  food: NutrientFood;
  /** 直近30日に食べたことがあるか */
  eaten: boolean;
  /** 1食の目安量に含まれる量（図鑑に軸があるときだけ） */
  perServing: number | null;
  /** レバー類（注記つき） */
  liver: boolean;
};

/** 記録の品目名 → 図鑑の食材 id の集合 */
export function eatenFoodIds(names: readonly string[], db: NutrientFood[] = getNutrientDb()): Set<string> {
  const out = new Set<string>();
  for (const n of names) { const f = findFood(n, db); if (f) out.add(f.id); }
  return out;
}

/**
 * その栄養素が多い食材。図鑑に軸があれば 1食の目安量あたりの多い順、無ければ content/nutrientFoods の並び。
 * 食べたことのある食材を先頭に、レバー類は末尾に。上限型（食塩・飽和脂肪酸）と糖類は候補を出さない
 */
export function suggestFoods(key: RefKey, eaten: Set<string>, db: NutrientFood[] = getNutrientDb(), limit = 6): Suggestion[] {
  if (key === 'salt' || key === 'satfat' || key === 'sug') return [];
  const nav = LOG_TO_NAV[key];
  let list: Suggestion[];
  if (nav) {
    list = rankByNutrient(nav, 'serving', 24, db).map((r) => ({ food: r.food, eaten: eaten.has(r.food.id), perServing: r.amount, liver: LIVER_IDS.includes(r.food.id) }));
  } else {
    const ids = RICH_FOOD_IDS[key] ?? [];
    list = ids.map((id) => db.find((f) => f.id === id)).filter((f): f is NutrientFood => !!f)
      .map((food) => ({ food, eaten: eaten.has(food.id), perServing: nav ? nutrientOf(food, nav, food.serving) : null, liver: LIVER_IDS.includes(food.id) }));
  }
  // 安定ソート: 食べたもの → 食べていないもの、それぞれ元の順。レバーは各グループの末尾
  const rank = (s: Suggestion) => (s.eaten ? 0 : 2) + (s.liver ? 1 : 0);
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map((x) => x.s)
    .slice(0, limit);
}

// ===== 数値の整形（toLocaleString / Intl は使わない。Hermes で環境依存になるため） =====

/** 栄養素の桁で丸め、3桁区切りを付ける（1234.5 → "1,234.5"） */
export function fmtAmount(key: IntakeKey, v: number, decimals: number = intakeMeta(key).decimals): string {
  const d = Math.max(0, Math.min(2, decimals));
  const r = Math.round(v * 10 ** d) / 10 ** d;
  const [int, frac] = r.toFixed(d).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac != null ? `${grouped}.${frac}` : grouped;
}

/** 基準値の表示（基準は桁が少ないので不要な小数を落とす: 7.5 → "7.5"、150 → "150"、0.9 → "0.9"） */
export function fmtRef(v: number): string {
  const r = Math.round(v * 100) / 100;
  const d = Number.isInteger(r) ? 0 : Number.isInteger(r * 10) ? 1 : 2;
  return fmtAmount('kcal', r, d);
}

/** 割合の % 表示（四捨五入・0 未満は 0） */
export function fmtPercent(ratio: number | null): string {
  if (ratio == null) return '—';
  return `${Math.max(0, Math.round(ratio * 100))}%`;
}
