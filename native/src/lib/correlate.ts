// 相関エンジン（インサイト・エンジン §2・§8・docs/INSIGHTS-ENGINE.md）
//
// 日次特徴量（lib/features.ts の DayFeature）から「個人の法則」の候補を見つける純関数群。
// 統計の判断根拠は各関数のコメントに厚く書く（閾値を触るときはここを読んでから）。
//
//  ・ラグ付き Spearman: 特徴X(t−k) と結果Y(t)。順位相関なので外れ値（1日だけの5,000kcal）に強い
//  ・条件付きリスク比: P(結果 | 条件) / P(結果 | 条件なし)。「◯倍起きやすい」の元になる数
//  ・多要素ルール: 2〜3条件のAND。アプリオリ流に「支持度が足りる組」だけ広げ、部分集合より
//    リフトが上がる組だけ採択する（「睡眠不足」単独で説明できることに「水曜」を足して見せない）
//  ・安全弁: n<14日は空を返す。両群とも4日以上。相関は因果と言わない（文言は「〜のとき〜が起きやすい」）
//  ・§8 気づきアラート: 採択済みルールの条件側を「今日」の特徴量が満たしたら発火。抑制は別関数
//
// ここは UI を持たない。文言は t() で組むが、法則図鑑に載せる文章は laws.ts が生値から組み直す
import { t } from './i18n';
import type { DayFeature } from './features';

// ===== 型 =====

export type Confidence = 'low' | 'mid' | 'high';
export type InsightKind = 'lag_corr' | 'risk_ratio' | 'rule';

/** エンジンの出力1件（設計書 §2）。evidenceKey は E1b（解説記事）が文献を紐づけるためのキー */
export type Insight = {
  id: string;             // 決定的（同じ因子の組なら毎日同じ）
  kind: InsightKind;
  factors: string[];      // 条件キー（CONDITIONS の key。ラベルは conditionLabel で引く）
  outcome: string;        // 結果キー（OUTCOMES の key）
  effect: number;         // rule/risk_ratio: リスク比、lag_corr: Spearman ρ
  n: number;              // 判定に使った日数（結果が分かっている日）
  confidence: Confidence;
  text: string;           // 現在の言語での説明文
  evidenceKey: string;
  lag?: number;           // lag_corr のみ
  support?: number;       // rule: 条件を満たした日数
  hits?: number;          // rule: そのうち結果が起きた日数
  baseRate?: number;      // rule: 全体での結果の発生率
};

/** 安全弁: これ未満の日数では何も言わない（§2） */
export const MIN_DAYS = 14;

// ===== Spearman =====

/** 平均順位（同順位は平均）。1始まり */
export function rankAvg(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman の順位相関。null を含む対は落とす。n<3 または一方が定数なら null。
 * 同順位があるため「順位の Pearson」で計算する（1−6Σd²/(n(n²−1)) は同順位で歪む）
 */
export function spearman(xs: (number | null)[], ys: (number | null)[]): { rho: number; n: number } | null {
  const px: number[] = []; const py: number[] = [];
  const m = Math.min(xs.length, ys.length);
  for (let i = 0; i < m; i++) {
    const x = xs[i]; const y = ys[i];
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    px.push(x); py.push(y);
  }
  const n = px.length;
  if (n < 3) return null;
  const rx = rankAvg(px); const ry = rankAvg(py);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx); const my = mean(ry);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - mx; const dy = ry[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;   // 定数列（全日同じ値）は相関を定義できない
  return { rho: sxy / Math.sqrt(sxx * syy), n };
}

/**
 * ラグ付き相関: xs[t−lag] と ys[t]。lag=1 なら「前日のXと今日のY」。
 * 系列は日付順・密（features.ts が保証）であることが前提
 */
export function laggedSpearman(xs: (number | null)[], ys: (number | null)[], lag: number): { rho: number; n: number } | null {
  const k = Math.max(0, Math.round(lag));
  if (k >= ys.length) return null;
  const ax: (number | null)[] = []; const ay: (number | null)[] = [];
  for (let tIdx = k; tIdx < ys.length; tIdx++) { ax.push(xs[tIdx - k] ?? null); ay.push(ys[tIdx] ?? null); }
  return spearman(ax, ay);
}

/**
 * ρ が偶然でないと言えるか（両側 p<.05 の近似）。
 * t = ρ√((n−2)/(1−ρ²)) を t 分布の臨界値と比べる。df=12で2.18、df=20で2.09、df=30で2.04、df→∞で1.96。
 * 分析の n は14〜90日なので、臨界値は 2.1 の定数で近似する（n=14: |ρ|≥0.52、n=30: |ρ|≥0.37、n=90: |ρ|≥0.22）
 */
export function spearmanSignificant(rho: number, n: number): boolean {
  if (n < 4 || !Number.isFinite(rho)) return false;
  const r2 = Math.min(rho * rho, 0.999999);
  const tStat = Math.abs(rho) * Math.sqrt((n - 2) / (1 - r2));
  return tStat >= 2.1;
}

// ===== リスク比 =====

export type RiskRatio = {
  rr: number;            // P(結果|条件) / P(結果|条件なし)
  withN: number; withHits: number; withRate: number;
  withoutN: number; withoutHits: number; withoutRate: number;
  baseRate: number;      // 全体の発生率
  n: number;             // withN + withoutN
};

/** 条件も結果も「分からない日（null）」は除外して数える。両群が minGroup 未満なら null */
export function riskRatio<T>(
  rows: T[],
  cond: (r: T, i: number, all: T[]) => boolean | null,
  outcome: (r: T, i: number, all: T[]) => boolean | null,
  minGroup = 4,
): RiskRatio | null {
  let withN = 0; let withHits = 0; let withoutN = 0; let withoutHits = 0;
  rows.forEach((r, i) => {
    const c = cond(r, i, rows);
    const o = outcome(r, i, rows);
    if (c == null || o == null) return;
    if (c) { withN++; if (o) withHits++; } else { withoutN++; if (o) withoutHits++; }
  });
  if (withN < minGroup || withoutN < minGroup) return null;
  const withRate = withHits / withN;
  const withoutRate = withoutHits / withoutN;
  // 「条件なし」群で一度も起きていないとき、比は無限大になる。Haldane 流に 0.5 件を足した率で
  // 割り、5倍で頭打ちにする（「∞倍」と言わない。n が小さいときの過大な倍率も抑える）
  let rr: number;
  if (withHits === 0) rr = 0;
  else if (withoutHits === 0) rr = Math.min(5, withRate / (0.5 / withoutN));
  else rr = withRate / withoutRate;
  return {
    rr, withN, withHits, withRate, withoutN, withoutHits, withoutRate,
    baseRate: (withHits + withoutHits) / (withN + withoutN), n: withN + withoutN,
  };
}

/**
 * 信頼度3段階（n と効果量から）。
 *  high: n≥30 かつ効果が大きい（リスク比2倍以上 / |ρ|≥0.4）
 *  mid : n≥21、または n≥14 で効果が大きい
 *  low : それ以外（n≥14）
 * 「high でも因果ではない」ことは文言側で必ず断る
 */
export function confidenceOf(n: number, effectStrong: boolean): Confidence {
  if (n >= 30 && effectStrong) return 'high';
  if (n >= 21 || (n >= MIN_DAYS && effectStrong)) return 'mid';
  return 'low';
}

// ===== 条件カタログ（閾値化した特徴） =====
//
// key は翻訳非依存（ルール id と図鑑の保存に使う）。label は日本語原文で、表示時に t() で訳す。
// morning=true は「その日の朝の時点で分かる条件」（前夜の睡眠・前日の気分・曜日…）。
// 食べすぎの**事前**アラート（§8）に使えるのはこの種類だけ（同日の歩数は夜まで分からない）

export type CondCtx = {
  proteinMedian: number | null;   // 本人のたんぱく質の中央値（「普段より少ない」の基準）
  liftMedian: number | null;      // 本人のトレ日ボリュームの中央値
};

export type Condition = {
  key: string;
  label: string;
  morning: boolean;
  test: (f: DayFeature, prev: DayFeature | null, ctx: CondCtx) => boolean | null;
};

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
const dowOf = (date: string) => new Date(date + 'T00:00:00').getDay();

export const CONDITIONS: Condition[] = [
  // 睡眠（前夜〜直近。朝の時点で分かる）
  { key: 'sleep_debt5_ge5', label: '睡眠不足が5時間以上たまっている', morning: true, test: (f) => (f.sleep_debt5 == null ? null : f.sleep_debt5 >= 5) },
  { key: 'sleep_lt6', label: '睡眠が6時間未満', morning: true, test: (f) => (f.sleep_h == null ? null : f.sleep_h < 6) },
  { key: 'sleep_ge7', label: '7時間以上眠れた', morning: true, test: (f) => (f.sleep_h == null ? null : f.sleep_h >= 7) },
  // 前日の状態
  { key: 'prev_mood_low', label: '前日の気分が低め', morning: true, test: (_f, p) => (p?.mood == null ? null : p.mood <= 2) },
  { key: 'mood_avg3_low', label: '気分が3日つづけて低め', morning: true, test: (f) => (f.mood_avg3 == null ? null : f.mood_avg3 <= 2.5) },
  { key: 'prev_deficit', label: '前日が大きめの赤字', morning: true, test: (_f, p) => (p?.over == null ? null : p.over <= -300) },
  { key: 'prev_binge', label: '前日に食べすぎた', morning: true, test: (_f, p) => (p == null || (p.intake == null && !p.recorded) ? null : p.binge) },
  { key: 'prev_lift', label: '前日にトレした', morning: true, test: (_f, p) => (p == null ? null : p.lift_sessions > 0) },
  { key: 'prev_wheat', label: '前日が小麦中心', morning: true, test: (_f, p) => (p == null || !p.recorded ? null : p.wheat_g >= 200 && p.wheat_g > p.rice_g) },
  { key: 'prev_sugar_drink', label: '前日に甘い飲み物', morning: true, test: (_f, p) => (p == null || !p.recorded ? null : p.sugar_drink > 0) },
  { key: 'prev_late_eating', label: '前日は夜に3割以上食べた', morning: true, test: (_f, p) => (p?.late_eating == null ? null : p.late_eating >= 0.3) },
  // 周期
  { key: 'water_window', label: '生理の前後', morning: true, test: (f) => (f.cycle_day == null ? null : f.water_window) },
  // 曜日（毎日必ず分かる）
  ...[0, 1, 2, 3, 4, 5, 6].map((d): Condition => ({
    key: `dow_${d}`, label: `${DOW_JA[d]}曜日`, morning: true, test: (f) => dowOf(f.date) === d,
  })),
  // 同日（夜になって分かる。事前アラートには使えないが、法則の説明には使える）
  { key: 'steps_low', label: '歩数5,000未満', morning: false, test: (f) => (f.steps == null ? null : f.steps < 5000) },
  { key: 'steps_high', label: '1万歩以上歩いた', morning: false, test: (f) => (f.steps == null ? null : f.steps >= 10000) },
  { key: 'lift_day', label: 'トレした日', morning: false, test: (f) => (f.recorded ? f.lift_sessions > 0 : null) },
  { key: 'protein_low', label: 'たんぱく質が普段より少ない', morning: false,
    test: (f, _p, ctx) => (f.protein_g == null || ctx.proteinMedian == null ? null : f.protein_g < ctx.proteinMedian) },
];

const COND_BY_KEY = new Map(CONDITIONS.map((c) => [c.key, c]));

export function conditionOf(key: string): Condition | undefined { return COND_BY_KEY.get(key); }

/** 条件キー → 現在の言語のラベル。曜日は t('水') のように曜日1文字を訳してから組む。未知キーはそのまま */
export function conditionLabel(key: string): string {
  const m = key.match(/^dow_(\d)$/);
  if (m) return t('{d}曜日', { d: t(DOW_JA[Number(m[1])]) });
  // 辞書抽出（scripts/i18n-keys.js）は t('リテラル') しか拾えないため、ラベルはここで一度リテラルとして書く
  switch (key) {
    case 'sleep_debt5_ge5': return t('睡眠不足が5時間以上たまっている');
    case 'sleep_lt6': return t('睡眠が6時間未満');
    case 'sleep_ge7': return t('7時間以上眠れた');
    case 'prev_mood_low': return t('前日の気分が低め');
    case 'mood_avg3_low': return t('気分が3日つづけて低め');
    case 'prev_deficit': return t('前日が大きめの赤字');
    case 'prev_binge': return t('前日に食べすぎた');
    case 'prev_lift': return t('前日にトレした');
    case 'prev_wheat': return t('前日が小麦中心');
    case 'prev_sugar_drink': return t('前日に甘い飲み物');
    case 'prev_late_eating': return t('前日は夜に3割以上食べた');
    case 'water_window': return t('生理の前後');
    case 'steps_low': return t('歩数5,000未満');
    case 'steps_high': return t('1万歩以上歩いた');
    case 'lift_day': return t('トレした日');
    case 'protein_low': return t('たんぱく質が普段より少ない');
  }
  const c = COND_BY_KEY.get(key);
  return c ? t(c.label) : key;
}

/** 結果キー → 現在の言語のラベル（同上・リテラルで登録） */
export function outcomeLabel(key: string): string {
  switch (key) {
    case 'binge': return t('食べすぎ');
    case 'mood_low': return t('気分の落ち込み');
    case 'lift_volume_up': return t('トレのボリューム増');
  }
  const o = OUTCOME_BY_KEY.get(key);
  return o ? t(o.label) : key;
}

/** 本人基準の閾値（中央値）を系列から出す */
export function condCtxOf(rows: DayFeature[]): CondCtx {
  const median = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  return {
    proteinMedian: median(rows.map((r) => r.protein_g).filter((v): v is number => v != null && v > 0)),
    liftMedian: median(rows.filter((r) => r.lift_sessions > 0).map((r) => r.lift_volume_kg)),
  };
}

// ===== 結果カタログ =====

export type OutcomeDef = {
  key: string;
  label: string;                    // 日本語原文（表示時に t()）
  tone: 'caution' | 'positive';     // §8: 警告か背中押しか
  test: (f: DayFeature, ctx: CondCtx) => boolean | null;
};

export const OUTCOMES: OutcomeDef[] = [
  // 食べすぎ: 摂取の記録がある日だけ判定できる
  { key: 'binge', label: '食べすぎ', tone: 'caution', test: (f) => (f.intake == null ? null : f.binge) },
  // 気分の落ち込み: 気分の記録がある日だけ
  { key: 'mood_low', label: '気分の落ち込み', tone: 'caution', test: (f) => (f.mood == null ? null : f.mood <= 2) },
  // トレの伸び: トレした日だけ判定（普段のボリューム中央値を超えたか）
  { key: 'lift_volume_up', label: 'トレのボリューム増', tone: 'positive',
    test: (f, ctx) => (f.lift_sessions === 0 || ctx.liftMedian == null ? null : f.lift_volume_kg > ctx.liftMedian) },
];

const OUTCOME_BY_KEY = new Map(OUTCOMES.map((o) => [o.key, o]));
export function outcomeOf(key: string): OutcomeDef | undefined { return OUTCOME_BY_KEY.get(key); }

// ===== 多要素ルール =====

export type RuleOpts = {
  minSupport?: number;     // 条件を満たした日数の下限（既定6・§2）
  minLift?: number;        // リスク比の下限（既定1.5・§2）
  maxFactors?: number;     // 条件数の上限（既定3）
  minGroup?: number;       // 両群の下限日数（既定4）
  conditions?: string[];   // 使う条件キー。既定＝morning 条件（事前に分かるものだけ）
  top?: number;            // 返す件数（既定10）
};

/** 系列の各行について、前日の行を返す（密な系列なので index−1） */
function prevOf(rows: DayFeature[], i: number): DayFeature | null { return i > 0 ? rows[i - 1] : null; }

/**
 * 2〜3条件のANDルールを掘る。
 *  1) 結果が判定できる日が MIN_DAYS 未満なら空
 *  2) 各条件を bool|null の列にする（null＝その日は判定不能）
 *  3) 1因子から順に、支持度（条件true かつ 結果が分かる日）が minSupport 以上の組だけを広げる（アプリオリ）
 *  4) 採択: リスク比 ≥ minLift・両群 ≥ minGroup・かつ**どの部分集合ルールよりもリスク比が高い**
 *     （因子を足しても倍率が上がらないなら、その因子は説明に要らない）
 *  5) 並び: リスク比の高い順 → 支持度の多い順 → 因子キーの辞書順（毎日同じ順になる）
 * id は 'rule:<outcome>:<key1+key2>'（キーはソート済み）＝因子の組で決定的
 */
export function mineRules(features: DayFeature[], outcomeKey: string, opts: RuleOpts = {}): Insight[] {
  const out = OUTCOME_BY_KEY.get(outcomeKey);
  if (!out) return [];
  const minSupport = opts.minSupport ?? 6;
  const minLift = opts.minLift ?? 1.5;
  const maxFactors = Math.max(1, Math.min(3, opts.maxFactors ?? 3));
  const minGroup = opts.minGroup ?? 4;
  const top = opts.top ?? 10;
  const ctx = condCtxOf(features);

  const y: (boolean | null)[] = features.map((f) => out.test(f, ctx));
  const n = y.filter((v) => v != null).length;
  if (n < MIN_DAYS) return [];
  const baseHits = y.filter((v) => v === true).length;
  if (baseHits < 2) return [];   // 結果が1回以下なら「起きやすい」は言えない

  const keys = (opts.conditions ?? CONDITIONS.filter((c) => c.morning).map((c) => c.key)).filter((k) => COND_BY_KEY.has(k));
  const cols = new Map<string, (boolean | null)[]>();
  for (const k of keys) {
    const c = COND_BY_KEY.get(k)!;
    cols.set(k, features.map((f, i) => c.test(f, prevOf(features, i), ctx)));
  }
  const andCols = (ks: string[]): (boolean | null)[] => features.map((_f, i) => {
    let all = true;
    for (const k of ks) {
      const v = cols.get(k)![i];
      if (v == null) return null;
      if (!v) all = false;
    }
    return all;
  });
  const supportOf = (col: (boolean | null)[]) => col.filter((v, i) => v === true && y[i] != null).length;

  type Cand = { keys: string[]; col: (boolean | null)[]; rr: RiskRatio | null };
  const rrOf = (col: (boolean | null)[]) => riskRatio(features, (_f, i) => col[i], (_f, i) => y[i], minGroup);
  const bestSub = new Map<string, number>();   // 組（ソート済みキー結合）→ そのリスク比（部分集合との比較用）
  const accepted: Cand[] = [];

  // 1因子（支持度が足りるものだけ。足りない因子は組み合わせにも使わない＝アプリオリの単調性）
  const singles: Cand[] = [];
  const singleKeys = new Set<string>();
  for (const k of keys.slice().sort()) {
    const col = cols.get(k)!;
    if (supportOf(col) < minSupport) continue;
    const rr = rrOf(col);
    const cand = { keys: [k], col, rr };
    singles.push(cand);
    singleKeys.add(k);
    if (rr) bestSub.set(k, rr.rr);
    if (rr && rr.rr >= minLift) accepted.push(cand);
  }
  // k因子は (k−1)因子の組に、辞書順で後ろのキーを1つ足して作る（同じ組を二度作らない）
  let frontier: Cand[] = singles;
  for (let size = 2; size <= maxFactors; size++) {
    const next: Cand[] = [];
    for (const base of frontier) {
      const last = base.keys[base.keys.length - 1];
      for (const k of keys.slice().sort()) {
        if (k <= last) continue;
        if (!singleKeys.has(k)) continue;
        const ks = [...base.keys, k];
        const col = andCols(ks);
        if (supportOf(col) < minSupport) continue;
        const rr = rrOf(col);
        const cand = { keys: ks, col, rr };
        next.push(cand);
        if (!rr) continue;
        // 部分集合のどれよりも倍率が上がっているか（上がらないなら足した因子は要らない）
        let subMax = 0;
        for (let i = 0; i < ks.length; i++) {
          const sub = ks.filter((_x, j) => j !== i).join('+');
          subMax = Math.max(subMax, bestSub.get(sub) ?? 0);
        }
        bestSub.set(ks.join('+'), rr.rr);
        if (rr.rr >= minLift && rr.rr > subMax + 1e-9) accepted.push(cand);
      }
    }
    frontier = next;
  }

  // 部分集合ルールが採択済みで、上位集合も採択されているとき、両方は出さない（上位集合＝より具体的なほうを残す）
  const acceptedKeys = new Set(accepted.map((c) => c.keys.join('+')));
  const pruned = accepted.filter((c) => {
    for (const other of acceptedKeys) {
      const oks = other.split('+');
      if (oks.length > c.keys.length && c.keys.every((k) => oks.includes(k))) return false;
    }
    return true;
  });

  pruned.sort((a, b) => {
    const d = (b.rr!.rr - a.rr!.rr);
    if (Math.abs(d) > 1e-9) return d;
    const s = b.rr!.withN - a.rr!.withN;
    if (s !== 0) return s;
    return a.keys.join('+') < b.keys.join('+') ? -1 : 1;
  });

  return pruned.slice(0, top).map((c) => {
    const rr = c.rr!;
    const strong = rr.rr >= 2;
    return {
      id: `rule:${outcomeKey}:${c.keys.join('+')}`,
      kind: 'rule' as const,
      factors: c.keys,
      outcome: outcomeKey,
      effect: Math.round(rr.rr * 10) / 10,
      n: rr.n,
      confidence: confidenceOf(rr.n, strong),
      text: ruleText(outcomeKey, c.keys, rr.rr, rr.withN),
      evidenceKey: `multi_${outcomeKey}`,
      support: rr.withN,
      hits: rr.withHits,
      baseRate: Math.round(rr.baseRate * 100) / 100,
    };
  });
}

/** ルールの説明文（「〜のとき〜が起きやすい」。断定・因果・診断の語は使わない） */
export function ruleText(outcomeKey: string, factorKeys: string[], rr: number, support: number): string {
  const o = OUTCOME_BY_KEY.get(outcomeKey);
  const oLabel = o ? outcomeLabel(outcomeKey) : outcomeKey;
  const a = factorKeys.map((k) => `「${conditionLabel(k)}」`).join('');
  const x = Math.round(rr * 10) / 10;
  return factorKeys.length >= 2
    ? t('{a}がそろった日は、{o}が{x}倍起きやすい（該当{n}日）', { a, o: oLabel, x, n: support })
    : t('{a}の日は、{o}が{x}倍起きやすい（該当{n}日）', { a, o: oLabel, x, n: support });
}

/** 既定の掘り方: 食べすぎ（注意）とトレの伸び（背中押し）の両方 */
export function mineDefaultRules(features: DayFeature[], opts: RuleOpts = {}): Insight[] {
  return [...mineRules(features, 'binge', opts), ...mineRules(features, 'lift_volume_up', opts)];
}

// ===== §8 気づきアラート =====

export type Alert = {
  id: string;                    // 'alert:' + ruleId
  tone: 'caution' | 'positive';
  factors: string[];             // 満たした条件の日本語ラベル（現在の言語）
  text: string;
  ruleId: string;                // 元になった Insight.id
};

/**
 * 今日の特徴量が、採択済みルールの**条件側**を全て満たしていたら発火。
 *  ・n<14 の法則からは出さない（§8）
 *  ・条件が判定不能（null）なら満たしたとみなさない（睡眠データが無い日に睡眠の警告を出さない）
 *  ・前日の行は recent から「today の前日」を探す（無ければ recent の末尾が today より前ならそれ）
 *  ・同じ ruleId は1件。並びは caution 優先→因子数の多い順→id
 */
export function evaluateAlerts(todayFeatures: DayFeature, recentFeatures: DayFeature[], insights: Insight[]): Alert[] {
  const prevDate = shiftDateLocal(todayFeatures.date, -1);
  const sorted = [...recentFeatures].filter((r) => r.date < todayFeatures.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const prev = sorted.find((r) => r.date === prevDate) ?? null;
  const ctx = condCtxOf([...sorted, todayFeatures]);
  const out: Alert[] = [];
  const seen = new Set<string>();
  for (const ins of insights) {
    if (ins.kind !== 'rule' && ins.kind !== 'risk_ratio') continue;
    if (ins.n < MIN_DAYS || ins.factors.length === 0) continue;
    if (seen.has(ins.id)) continue;
    const o = OUTCOME_BY_KEY.get(ins.outcome);
    if (!o) continue;
    let all = true;
    for (const k of ins.factors) {
      const c = COND_BY_KEY.get(k);
      if (!c) { all = false; break; }
      const v = c.test(todayFeatures, prev, ctx);
      if (v !== true) { all = false; break; }
    }
    if (!all) continue;
    seen.add(ins.id);
    const labels = ins.factors.map(conditionLabel);
    const text = o.tone === 'caution'
      ? t('今日は「{o}」が起きやすい条件が{n}つそろっています。無理せず、いつもどおりで', { o: outcomeLabel(o.key), n: labels.length })
      : t('今日は「{o}」につながる条件がそろっています。良い日にしやすいタイミング', { o: outcomeLabel(o.key) });
    out.push({ id: `alert:${ins.id}`, tone: o.tone, factors: labels, text, ruleId: ins.id });
  }
  out.sort((a, b) => {
    if (a.tone !== b.tone) return a.tone === 'caution' ? -1 : 1;
    if (a.factors.length !== b.factors.length) return b.factors.length - a.factors.length;
    return a.id < b.id ? -1 : 1;
  });
  return out;
}

export type AlertHistory = { id: string; date: string };

/**
 * 抑制（慣れ防止・§8）:
 *  ・同じ id は1日1回（history に today の同 id があれば落とす）
 *  ・連続3日出たら4日目は休む（today−1, −2, −3 のすべてに同 id があれば落とす。休んだ翌日からまた出る）
 * history は表示側が保持する「出した日」の記録（id, date）。純関数なので保存はしない
 */
export function suppressAlerts(alerts: Alert[], history: AlertHistory[], today: string): Alert[] {
  const shown = new Set(history.map((h) => `${h.id}@${h.date}`));
  const d1 = shiftDateLocal(today, -1); const d2 = shiftDateLocal(today, -2); const d3 = shiftDateLocal(today, -3);
  return alerts.filter((a) => {
    if (shown.has(`${a.id}@${today}`)) return false;
    if (shown.has(`${a.id}@${d1}`) && shown.has(`${a.id}@${d2}`) && shown.has(`${a.id}@${d3}`)) return false;
    return true;
  });
}

// features.ts と同じ計算（循環importを避けてここにも置く）
function shiftDateLocal(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
