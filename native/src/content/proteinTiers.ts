// たんぱく源ティアリスト（S〜E）＋個人化（食材ナビ）
//
// 参考動画「ダイエット中のたんぱく質ティアリスト」の視座: 鶏むね・レバー・砂肝＝S、手羽先は脂と食べすぎやすさで下位…
// と、**たんぱく質1gあたりのkcal・脂質比・食べすぎやすさ・調理の手間・価格帯** で格付けし、理由を一言添える。
// ここでは格付けを **決められた基準表の点数** で機械的に出す（人の好みで並べない＝リモートで値が直れば格付けも直る）。
//
// 【減量（cut）の基準】満点 11（＋栄養密度ボーナス 2）
//   ・P1gあたりkcal: ≤5 →4 / ≤6.5 →3 / ≤8 →2 / ≤12 →1 / それ以上 →0
//   ・脂質のkcal比（F×9/kcal）: ≤20% →2 / ≤40% →1 / それ以上 →0
//   ・食べすぎやすさ（tier.overeat 1〜3）: 1 →2 / 2 →1 / 3 →0
//   ・調理の手間（tier.ease 1〜3）: 1 →2 / 2 →1 / 3 →0
//   ・価格帯（tier.price 1〜3）: 1 →1 / 2 →0.5 / 3 →0
//   ・栄養密度ボーナス: 鉄≥5mg・亜鉛≥5mg・ビタミンA≥1,000µg・オメガ3≥2g のどれかで +2（レバー・砂肝・青魚の格を数字で担保）
//   S ≥9.75 / A ≥8 / B ≥6 / C ≥4.5 / D ≥3.5 / E <3.5
// 【増量（bulk）の基準】満点 10（＋同じボーナス）。kcal密度と食べやすさを評価する
//   ・100gあたりP: ≥20 →4 / ≥15 →2.5 / ≥10 →1 / それ以下 →0
//   ・100gあたりkcal: ≥180 →2 / ≥100 →1 / それ以下 →0
//   ・食べやすさ（= overeat を逆に読む）: 3 →1.5 / 2 →1 / 1 →0.5
//   ・調理の手間・価格帯: 減量と同じ
//   S ≥8.5 / A ≥7 / B ≥5.5 / C ≥4 / D ≥2.5 / E <2.5
//
// 【言い方】理由は事実の列挙（「P1gあたり4.5kcal・脂質16%・手間が少ない・安い」）で、審判しない。
// 「◯◯は食べるな」は書かない。smartSwap.FORBIDDEN_WORDS をテストで全文に当てる。
//
// 【個人化】直近30日の品目名を食材辞書に当て、たんぱく源の構成比（たんぱく質g加重）から
// 「Aティア以上が{p}%」と、最も食べているCティア以下の食材をSティアに替えた場合の1食あたりkcal差を出す
// （lib/laws.ts の kind 'protein_tier'）。
import { t } from '@/lib/i18n';
import { pickL10n } from '@/lib/remoteContent';
import { getNutrientDb, findFood, foodName, type NutrientFood } from './nutrientDb';
import type { SwapMode } from '@/lib/smartSwap';

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D' | 'E';
export const TIERS: Tier[] = ['S', 'A', 'B', 'C', 'D', 'E'];

/** ティアの序列（比較用。小さいほど上位） */
export function tierRank(tier: Tier): number { return TIERS.indexOf(tier); }

/** たんぱく源（tier の性格を持つ食材）だけ */
export function proteinFoods(db: NutrientFood[] = getNutrientDb()): NutrientFood[] {
  return db.filter((f) => f.tier != null && f.per100.p > 0);
}

/** 栄養密度ボーナスの条件（鉄・亜鉛・ビタミンA・オメガ3のどれかが目立つ） */
export function denseBonus(f: NutrientFood): boolean {
  const p = f.per100;
  return p.fe >= 5 || p.zn >= 5 || p.va >= 1000 || p.n3 >= 2;
}

/** 減量・増量それぞれの点数（内訳つき。画面の説明と理由文に使う） */
export type TierScore = { total: number; kcalPerP: number; fatPct: number; bonus: boolean };

export function tierScore(f: NutrientFood, mode: SwapMode): TierScore {
  const tr = f.tier ?? { ease: 2, price: 2, overeat: 2 };
  const p = f.per100;
  const kcalPerP = p.p > 0 ? p.kcal / p.p : Infinity;
  const fatPct = p.kcal > 0 ? Math.round(((p.f * 9) / p.kcal) * 100) : 0;
  const ease = tr.ease === 1 ? 2 : tr.ease === 2 ? 1 : 0;
  const price = tr.price === 1 ? 1 : tr.price === 2 ? 0.5 : 0;
  const bonus = denseBonus(f);
  let total = 0;
  if (mode === 'cut') {
    total += kcalPerP <= 5 ? 4 : kcalPerP <= 6.5 ? 3 : kcalPerP <= 8 ? 2 : kcalPerP <= 12 ? 1 : 0;
    total += fatPct <= 20 ? 2 : fatPct <= 40 ? 1 : 0;
    total += tr.overeat === 1 ? 2 : tr.overeat === 2 ? 1 : 0;
  } else {
    total += p.p >= 20 ? 4 : p.p >= 15 ? 2.5 : p.p >= 10 ? 1 : 0;
    total += p.kcal >= 180 ? 2 : p.kcal >= 100 ? 1 : 0;
    total += tr.overeat === 3 ? 1.5 : tr.overeat === 2 ? 1 : 0.5;
  }
  total += ease + price + (bonus ? 2 : 0);
  return { total, kcalPerP, fatPct, bonus };
}

export function tierOf(f: NutrientFood, mode: SwapMode): Tier {
  const s = tierScore(f, mode).total;
  if (mode === 'cut') return s >= 9.75 ? 'S' : s >= 8 ? 'A' : s >= 6 ? 'B' : s >= 4.5 ? 'C' : s >= 3.5 ? 'D' : 'E';
  return s >= 8.5 ? 'S' : s >= 7 ? 'A' : s >= 5.5 ? 'B' : s >= 4 ? 'C' : s >= 2.5 ? 'D' : 'E';
}

/** ティア表（S〜E → 食材。各ティア内は点数の高い順） */
export function tierTable(mode: SwapMode, db: NutrientFood[] = getNutrientDb()): Record<Tier, NutrientFood[]> {
  const out: Record<Tier, NutrientFood[]> = { S: [], A: [], B: [], C: [], D: [], E: [] };
  for (const f of proteinFoods(db)) out[tierOf(f, mode)].push(f);
  for (const tier of TIERS) out[tier].sort((a, b) => tierScore(b, mode).total - tierScore(a, mode).total);
  return out;
}

/**
 * 格付けの理由（1文・事実の列挙・非審判）。例: 「P1gあたり4.5kcal・脂質16%・手間が少ない・安い」
 * 増量では「100gでP23g・105kcal・食べやすい」の軸で書く
 */
export function tierReason(f: NutrientFood, mode: SwapMode): string {
  const tr = f.tier ?? { ease: 2, price: 2, overeat: 2 };
  const sc = tierScore(f, mode);
  const parts: string[] = [];
  if (mode === 'cut') {
    if (Number.isFinite(sc.kcalPerP)) parts.push(t('P1gあたり{n}kcal', { n: (Math.round(sc.kcalPerP * 10) / 10).toFixed(1) }));
    parts.push(t('脂質{n}%', { n: sc.fatPct }));
    if (tr.overeat === 3) parts.push(t('つい量が増えやすい'));
    else if (tr.overeat === 1) parts.push(t('量が決まりやすい'));
  } else {
    parts.push(t('100gでP{p}g・{k}kcal', { p: Math.round(f.per100.p), k: Math.round(f.per100.kcal) }));
    if (tr.overeat === 3) parts.push(t('量を増やしやすい'));
    else if (tr.overeat === 1) parts.push(t('量を増やしにくい'));
  }
  if (tr.ease === 1) parts.push(t('手間が少ない'));
  else if (tr.ease === 3) parts.push(t('下処理がいる'));
  if (tr.price === 1) parts.push(t('安い'));
  else if (tr.price === 3) parts.push(t('高め'));
  if (sc.bonus) parts.push(t('鉄・亜鉛・ビタミンA・オメガ3のどれかが多い'));
  return parts.join('・');
}

// ===== 個人化（直近の品目 → たんぱく源の構成） =====

export type TierShare = {
  /** たんぱく源として数えた品目数 */
  n: number;
  /** Aティア以上の割合（%・たんぱく質g加重） */
  pHigh: number;
  /** 最も食べている Cティア以下の食材（無ければ null） */
  worst: { food: NutrientFood; tier: Tier; count: number } | null;
  /** worst と同じたんぱく質量を Sティア（最上位）で取ったときの1食あたり kcal 差（正＝減る）。worst が無ければ 0 */
  kcalSaved: number;
  best: NutrientFood | null;
  mode: SwapMode;
};

/**
 * 品目名の列（直近30日ぶん・重複可）→ たんぱく源の構成。
 * 各品目は食材辞書の最長一致で1食材に寄せ、量は「1食の目安量」で数える（qty は使わない＝構成比なので十分）。
 * たんぱく源として数えられた品目が minN 未満なら null（法則にしない）
 */
export function tierShareOf(names: string[], mode: SwapMode, minN = 10, db: NutrientFood[] = getNutrientDb()): TierShare | null {
  const counts = new Map<string, { food: NutrientFood; count: number }>();
  for (const name of names) {
    const f = findFood(name, db);
    if (!f || !f.tier) continue;
    const cur = counts.get(f.id) ?? { food: f, count: 0 };
    cur.count += 1;
    counts.set(f.id, cur);
  }
  const rows = [...counts.values()];
  const n = rows.reduce((a, r) => a + r.count, 0);
  if (n < minN) return null;
  let total = 0; let high = 0;
  let worst: TierShare['worst'] = null;
  for (const r of rows) {
    const grams = r.food.per100.p * r.food.serving / 100 * r.count;   // たんぱく質gで加重
    total += grams;
    const tier = tierOf(r.food, mode);
    if (tierRank(tier) <= tierRank('A')) high += grams;
    if (tierRank(tier) >= tierRank('C') && (!worst || r.count > worst.count)) worst = { food: r.food, tier, count: r.count };
  }
  const pHigh = total > 0 ? Math.round((high / total) * 100) : 0;
  // 置き換え先: Sティアのうち点数最高の食材（無ければ A）。worst と同じたんぱく質量で kcal を比べる
  const table = tierTable(mode, db);
  const best = table.S[0] ?? table.A[0] ?? null;
  let kcalSaved = 0;
  if (worst && best) {
    const pG = worst.food.per100.p * worst.food.serving / 100;
    const kcalWorst = worst.food.per100.kcal * worst.food.serving / 100;
    const kcalBest = best.per100.p > 0 ? (pG / best.per100.p) * best.per100.kcal : kcalWorst;
    kcalSaved = Math.round(kcalWorst - kcalBest);
  }
  return { n, pHigh, worst, kcalSaved, best, mode };
}

/**
 * 「何を食べる？」のプロンプトに渡す要約（サーバーのプロンプトは日本語で組むため日本語固定・t()不要）。
 * 「減量向けのたんぱく源ティア: S=鶏むね肉（皮なし）・サラダチキン… / A=… / C以下=…」。400字以内
 */
export function tierPromptSummary(mode: SwapMode, db: NutrientFood[] = getNutrientDb()): string {
  const table = tierTable(mode, db);
  const names = (tier: Tier, max: number) => table[tier].slice(0, max).map((f) => pickL10n(f.name, 'ja')).join('・');
  const low = [...table.C, ...table.D, ...table.E].slice(0, 6).map((f) => pickL10n(f.name, 'ja')).join('・');
  const head = mode === 'bulk' ? '増量向けのたんぱく源ティア（kcal密度と食べやすさで格付け）' : '減量向けのたんぱく源ティア（P1gあたりkcal・脂質比・食べすぎやすさで格付け）';
  const text = `${head}: S=${names('S', 8)} / A=${names('A', 8)} / C以下=${low}`;
  return text.length > 400 ? text.slice(0, 399) + '…' : text;
}

/** 表示名（プロンプト以外・現在の言語） */
export const tierFoodName = foodName;
