// 過食リスク v2（docs/BINGE-PREVENTION-RESEARCH-2026-09-25.md の実装コア）
//
// 熊田さんの要望「アラートの頻度を上げる。ただし精度は落とさない」への答えを、そのまま関数にした。
//
//  ・頻度と精度は同じ判別力（AUC）の下ではトレードオフで、片方を上げれば片方は必ず下がる
//    （§2 の二正規モデル `binormalPrecision` が数式で示す）。両立の道は3つしかない:
//      ① 情報を増やして判別力そのものを上げる（特徴量 `RISK_FEATURES`）
//      ② アラートを「段」に分けて、段ごとに違う精度床を持つ（`RiskTier`: nudge / warning）
//      ③ 精度が落ちたら自動で頻度を絞る（`guardThresholds`）＝落とさないことを機械的に保証する
//  ・モデルは「集団の事前分布（文献由来の重み）＋本人の履歴」を**MAPロジスティック回帰**で合成する。
//    ガウス事前（平均=文献の重み・分散=τ²）を置いた最尤推定なので、データが少ないうちは事前に
//    張り付き、たまるほど本人の値へ動く（経験ベイズ流の縮小）。ナイーブベイズ的な log-odds の
//    単純加算と違い、相関する特徴（睡眠不足と気分低下など）の二重計上を回帰が自動で調整する
//  ・純関数・決定的・端末内で完結。UI も I/O も持たない（配線は log.tsx 側で親がやる）
//  ・数値の意味は必ずコメントに書く（閾値を触るときの根拠）
//
// 用語:
//  ・「日 t の過食」= その日の摂取が分かっていて `DayFeature.binge`（超過+800 以上 or 2,500kcal超）。
//    定義そのものの妥当性は研究ドキュメント §1 で論じる（+400 の isBingeDay とは別物）
//  ・特徴量は**朝の時点で分かるもの**だけ（前日の状態・昨夜の睡眠・曜日・周期・今日の予定）。
//    同日の歩数のように夜まで分からないものは事前アラートに使えないので入れない
import type { DayFeature } from './features';

// ===== 型 =====

/** 2値特徴。null＝その日は判定できない（睡眠データが無い等）。回帰では 0 として扱う＝「証拠なし」 */
export type Bit = 0 | 1 | null;

/** 今日の予定（lib/dayPlan.ts の DayPlanKind と同じ語彙）。過去日の再現（バックテスト）では null */
export type PlannedEvent = 'eatout' | 'drink' | 'workout' | 'none';

export type RiskContext = {
  plannedEvent?: PlannedEvent | null;
  /** 現在の時（0–23）。時間内ハザード（夕方〜夜で上がる）に使う。省略時は日単位の確率のみ */
  hour?: number | null;
  /** 最後の食事からの経過時間（h）。5h を超えると上がる。省略時は考慮しない */
  hoursSinceLastMeal?: number | null;
};

export type RiskFeatureDef = {
  key: string;
  /** 日本語原文。表示側で t() に通す（correlate.CONDITIONS と同じ流儀。辞書はUI配線時に足す） */
  label: string;
  /** 集団の事前重み（log-odds）。根拠は研究ドキュメント §3 の表 */
  prior: number;
  /** 事前の標準偏差 τ。小さいほど本人データで動きにくい */
  tau: number;
  /** rows[i] の日の朝に分かる値。rows は昇順・密（features.ts が保証） */
  test: (rows: DayFeature[], i: number, ctx: RiskContext) => boolean | null;
};

export type Readiness = 'silent' | 'prior' | 'full';
export type RiskTier = 'quiet' | 'nudge' | 'warning';
export type TierThresholds = { nudge: number; warning: number };

export type Contribution = { key: string; label: string; delta: number };

export type RiskModel = {
  keys: string[];
  weights: number[];        // keys と同じ並び
  priors: number[];
  intercept: number;
  interceptPrior: number;
  nTrain: number;           // 結果が分かる日数
  nBinge: number;           // うち過食日
  readiness: Readiness;
  iterations: number;       // Newton 反復回数（デバッグ用）
};

export type RiskPrediction = { p: number; logit: number; contributions: Contribution[] };

export type BingeRiskV2 = {
  date: string;
  readiness: Readiness;
  /** 今日1日のどこかで過食が起きる確率 */
  pDay: number;
  /** 現在時刻・最終食事からの経過を織り込んだ「いま」の確率（時間内ハザード）。ctx が無ければ pDay と同じ */
  pNow: number;
  tier: RiskTier;
  /** 実効閾値（本人の基礎率による床を適用したあと） */
  thresholds: TierThresholds;
  /** 正の寄与・大きい順。label は日本語原文 */
  reasons: Contribution[];
  model: { nTrain: number; nBinge: number; baseRate: number; weights: Record<string, number> };
};

// ===== 定数（意味は各コメント） =====

/** 集団の事前基礎率（1日あたりの過食確率）。減量中の一般成人で「+800kcal超過」が週0.5回程度という控えめな仮定 */
export const PRIOR_BASE_RATE = 0.08;
/** 切片の事前SD。基礎率は本人差が大きいので特徴の重みより早く動かす */
export const INTERCEPT_TAU = 1.5;
/** 特徴の重みの既定の事前SD。±2τ（±1.4 log-odds ≒ 4倍）まで本人データで動ける */
export const FEATURE_TAU = 0.7;

/** 結果が分かる日がこれ未満なら何も言わない（correlate.MIN_DAYS と同じ線） */
export const MIN_DAYS_SILENT = 14;
/** これ以上かつ過食≥3回で全段解禁。それまでは nudge 止まり（事前分布が支配的な時期に強い警告を出さない） */
export const MIN_DAYS_FULL = 28;
export const MIN_BINGE_FULL = 3;

/**
 * 段の閾値を期待効用から出す: 「p × 防げる利益 × 介入の効きめ > 誤報のコスト」⇔ p > cost/(benefit×efficacy)。
 * nudge  … 食事タブの控えめなカード1枚（コスト1）。過食1回を防ぐ利益を8・介入の効きめ0.8 → p* ≈ 0.156
 * warning… 朝の通知＋目立つカード（コスト2.5＝無視できない割り込み）→ p* ≈ 0.39
 */
export type UtilityCfg = { costFalseAlarm: number; benefitPrevented: number; efficacy: number };
export const NUDGE_UTILITY: UtilityCfg = { costFalseAlarm: 1, benefitPrevented: 8, efficacy: 0.8 };
export const WARNING_UTILITY: UtilityCfg = { costFalseAlarm: 2.5, benefitPrevented: 8, efficacy: 0.8 };

export function thresholdFromUtility(u: UtilityCfg): number {
  const denom = u.benefitPrevented * u.efficacy;
  if (!(denom > 0)) return 1;
  return Math.min(1, Math.max(0, u.costFalseAlarm / denom));
}

export const DEFAULT_THRESHOLDS: TierThresholds = {
  nudge: thresholdFromUtility(NUDGE_UTILITY),
  warning: thresholdFromUtility(WARNING_UTILITY),
};

/**
 * 基礎率による床。本人の基礎率 π̂ が高い（例 0.25）人に p=0.16 で nudge を出すのは
 * 「平均より低い日に警告する」ことになり情報がない。nudge は π̂ の1.5倍以上、warning は3倍以上のときだけ
 */
export const LIFT_FLOOR: TierThresholds = { nudge: 1.5, warning: 3 };

export function effectiveThresholds(base: TierThresholds, personalBaseRate: number): TierThresholds {
  const pi = Number.isFinite(personalBaseRate) ? Math.max(0, Math.min(1, personalBaseRate)) : 0;
  const nudge = Math.min(0.95, Math.max(base.nudge, pi * LIFT_FLOOR.nudge));
  const warning = Math.min(0.99, Math.max(base.warning, pi * LIFT_FLOOR.warning, nudge));
  return { nudge, warning };
}

// ===== 特徴量（朝の時点で分かるものだけ） =====

const DEFICIT_KCAL = -300;          // 「大きめの赤字」（insights.DEFICIT_KCAL と同じ）
const SLEEP_SHORT_H = 6;            // 短時間睡眠の線（Al Khatib 2017 の介入研究は 4–5.5h だが、実生活の6h未満で拾う）
const SLEEP_DEBT_H = 5;             // 5日累計の不足（correlate.sleep_debt5_ge5 と同じ）
const MOOD_LOW = 2;                 // 5段階で2以下
const MOOD_AVG3_LOW = 2.5;
const LATE_SHARE = 0.3;             // 20時以降のkcal比 3割以上
const FEW_MEALS = 2;                // 食事ログ2件以下
const LUTEAL_FROM = 15;             // 周期15日目以降を黄体期とみなす（28日周期の目安。Klump 2013 は中黄体期にピーク）
const HARD_ACTIVE_KCAL = 500;       // 前日のアクティブ消費 500kcal 以上
const WEIGHT_UP_KG = 0.5;           // 7日で +0.5kg 以上
const RECENT_BINGE_DAYS = 7;        // 2〜7日前の過食

function dowOf(date: string): number { return new Date(date + 'T00:00:00').getDay(); }

/** 前日の行。密な系列なので index−1（日付の連続も一応確かめる） */
function prevOf(rows: DayFeature[], i: number): DayFeature | null {
  if (i <= 0) return null;
  const p = rows[i - 1];
  return p && p.date === shiftDateLocal(rows[i].date, -1) ? p : null;
}

/** 本人のたんぱく質の中央値（rows[<i] の記録日から）。「普段より少ない」の基準。3日未満なら null */
function proteinMedianBefore(rows: DayFeature[], i: number): number | null {
  const xs: number[] = [];
  for (let k = 0; k < i; k++) { const v = rows[k].protein_g; if (v != null && v > 0) xs.push(v); }
  if (xs.length < 3) return null;
  xs.sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export const RISK_FEATURES: readonly RiskFeatureDef[] = [
  // --- 制限→反動（Zunker 2011: 制限した日と翌日に過食のオッズ上昇。Polivy & Herman の逆制御理論） ---
  { key: 'prev_deficit', label: '前日が目標より300kcal以上少なかった', prior: 0.5, tau: FEATURE_TAU,
    test: (rows, i) => { const p = prevOf(rows, i); return p?.over == null ? null : p.over <= DEFICIT_KCAL; } },
  { key: 'deficit_streak3', label: '3日つづけて目標未満だった', prior: 0.4, tau: FEATURE_TAU,
    test: (rows, i) => {
      if (i < 3) return null;
      for (let k = 1; k <= 3; k++) { const r = rows[i - k]; if (r.over == null) return null; if (r.over >= 0) return false; }
      return true;
    } },
  // --- 連鎖（Zunker 2011: 前日の過食は翌日の過食を予測。本アプリの bingeAnalysis.after.chainRate と同じ観察） ---
  { key: 'prev_binge', label: '前日に食べすぎた', prior: 0.6, tau: FEATURE_TAU,
    test: (rows, i) => { const p = prevOf(rows, i); return p == null || p.intake == null ? null : p.binge; } },
  { key: 'binge_recent', label: 'この1週間に食べすぎがあった', prior: 0.3, tau: FEATURE_TAU,
    test: (rows, i) => {
      let known = false;
      for (let k = 2; k <= RECENT_BINGE_DAYS; k++) { const r = rows[i - k]; if (!r) break; if (r.intake == null) continue; known = true; if (r.binge) return true; }
      return known ? false : null;
    } },
  // --- 記録の途切れ（本アプリの観察: 過食の翌日に記録が途切れやすい。逆向きも同じ日に集まりやすい） ---
  { key: 'prev_unlogged', label: '前日の記録が途切れていた', prior: 0.4, tau: FEATURE_TAU,
    test: (rows, i) => { const p = prevOf(rows, i); return p == null ? null : p.intake == null && !p.recorded; } },
  // --- 睡眠（Al Khatib 2017 メタ解析: 部分断眠で翌日の摂取 +385kcal。sleep_h は「起きた日」に計上＝今朝分かる） ---
  { key: 'sleep_short', label: '昨夜の睡眠が6時間未満', prior: 0.4, tau: FEATURE_TAU,
    test: (rows, i) => (rows[i].sleep_h == null ? null : (rows[i].sleep_h as number) < SLEEP_SHORT_H) },
  { key: 'sleep_debt', label: '睡眠不足が5時間以上たまっている', prior: 0.3, tau: FEATURE_TAU,
    test: (rows, i) => (rows[i].sleep_debt5 == null ? null : (rows[i].sleep_debt5 as number) >= SLEEP_DEBT_H) },
  // --- 気分（Haedt-Matt & Keel 2011 メタ解析: 過食の前に負の感情が高まる d=0.63） ---
  { key: 'mood_low', label: '気分が低め（前日2以下・または3日平均2.5以下）', prior: 0.6, tau: FEATURE_TAU,
    test: (rows, i) => {
      const p = prevOf(rows, i);
      const m = p?.mood ?? null; const a = p?.mood_avg3 ?? null;
      if (m == null && a == null) return null;
      return (m != null && m <= MOOD_LOW) || (a != null && a <= MOOD_AVG3_LOW);
    } },
  // --- 曜日（Racette 2008: 週末に摂取増。Smyth 2009: 週末に過食が多い） ---
  { key: 'fri_sat', label: '金曜・土曜', prior: 0.4, tau: FEATURE_TAU,
    test: (rows, i) => { const d = dowOf(rows[i].date); return d === 5 || d === 6; } },
  // --- たんぱく質（Leidy 2015: 高たんぱく食の満腹感は中程度。効果は小さいので事前重みも小さい） ---
  { key: 'prev_low_protein', label: '前日のたんぱく質が普段より少なかった', prior: 0.2, tau: FEATURE_TAU,
    test: (rows, i) => {
      const p = prevOf(rows, i); const med = proteinMedianBefore(rows, i);
      return p?.protein_g == null || med == null ? null : p.protein_g < med;
    } },
  // --- 夜型（De Young 2022 の概日モデル・Smyth 2009: 夕方〜夜に過食が集中） ---
  { key: 'prev_late_eating', label: '前日は夜（20時以降）に3割以上食べた', prior: 0.3, tau: FEATURE_TAU,
    test: (rows, i) => { const p = prevOf(rows, i); return p?.late_eating == null ? null : p.late_eating >= LATE_SHARE; } },
  // --- 食事の間隔（食事回数が少ない＝長い空腹の代理。長い間隔は次の食事の量を増やす） ---
  { key: 'prev_few_meals', label: '前日の食事が2回以下だった', prior: 0.3, tau: FEATURE_TAU,
    test: (rows, i) => { const p = prevOf(rows, i); return p == null || p.intake == null ? null : p.meal_count > 0 && p.meal_count <= FEW_MEALS; } },
  // --- 周期（Klump 2013: 情動的摂食・過食は中黄体期にピーク。周期モードON時のみ値が入る） ---
  { key: 'luteal', label: '生理周期の後半（15日目以降）', prior: 0.4, tau: FEATURE_TAU,
    test: (rows, i) => (rows[i].cycle_day == null ? null : (rows[i].cycle_day as number) >= LUTEAL_FROM) },
  // --- 今日の予定（飲酒は摂取を 9–26% 増やす: Yeomans 2010。外食も同方向。過去日の再現では不明＝null） ---
  { key: 'planned_event', label: '今日は外食・飲み会の予定', prior: 0.8, tau: 0.5,
    test: (_rows, _i, ctx) => (ctx.plannedEvent == null ? null : ctx.plannedEvent === 'eatout' || ctx.plannedEvent === 'drink') },
  // --- 前日の運動（本アプリの bingeAnalysis 'hard-exercise'。代償性の食欲増は個人差が大きいので小さめ） ---
  { key: 'prev_hard_exercise', label: '前日に運動を頑張った', prior: 0.2, tau: FEATURE_TAU,
    test: (rows, i) => {
      const p = prevOf(rows, i);
      if (p == null) return null;
      if (p.active_kcal == null && p.lift_sessions === 0 && !p.recorded) return null;
      return (p.active_kcal != null && p.active_kcal >= HARD_ACTIVE_KCAL) || p.lift_sessions > 0;
    } },
  // --- 体重の反発（7日で+0.5kg。落胆→「どうせなら」の引き金。今朝の体重が無ければ前日の値） ---
  { key: 'weight_up', label: '体重が1週間で0.5kg以上増えた', prior: 0.2, tau: FEATURE_TAU,
    test: (rows, i) => {
      const d = rows[i].weight_delta7 ?? prevOf(rows, i)?.weight_delta7 ?? null;
      return d == null ? null : d >= WEIGHT_UP_KG;
    } },
];

export const RISK_KEYS: readonly string[] = RISK_FEATURES.map((f) => f.key);

export function riskFeatureLabel(key: string): string {
  return RISK_FEATURES.find((f) => f.key === key)?.label ?? key;
}

/** rows[i] の日の特徴ベクトル（RISK_FEATURES と同じ並び）。判定不能は null */
export function featureVector(rows: DayFeature[], i: number, ctx: RiskContext = {}): Bit[] {
  return RISK_FEATURES.map((f) => {
    const v = f.test(rows, i, ctx);
    return v == null ? null : v ? 1 : 0;
  });
}

/** 結果ラベル。摂取の記録が無い日は「分からない」（null）＝学習にも評価にも使わない */
export function labelOf(row: DayFeature): boolean | null {
  return row.intake == null ? null : row.binge;
}

// ===== 数学ユーティリティ =====

export function sigmoid(z: number): number {
  if (z >= 0) { const e = Math.exp(-z); return 1 / (1 + e); }
  const e = Math.exp(z); return e / (1 + e);
}
export function logit(p: number): number {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(q / (1 - q));
}
/** log(1+e^z)（オーバーフローしない） */
function softplus(z: number): number { return z > 30 ? z : z < -30 ? 0 : Math.log1p(Math.exp(z)); }

/** コレスキー分解で対称正定値の連立一次方程式 A x = b を解く（A は上書きしない）。n≤20 想定 */
function solveSPD(A: number[][], b: number[]): number[] {
  const n = b.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        // 事前分布の精度が対角に乗るので理論上は正定値。数値誤差の保険として小さな下駄を履かせる
        L[i][i] = Math.sqrt(Math.max(s, 1e-9));
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}

/**
 * MAP ロジスティック回帰（ガウス事前・Newton 法）。
 *  目的関数 L(w) = Σ_i [softplus(z_i) − y_i z_i] + ½ Σ_j λ_j (w_j − m_j)²、 z_i = w·x_i、 λ_j = 1/τ_j²
 *  勾配 g = Xᵀ(σ(z) − y) + Λ(w − m)、 ヘッセ H = Xᵀ S X + Λ、 S = diag(σ(1−σ))
 *  Λ が正なので H は常に正定値＝完全分離（ある特徴の日に全部過食）でも発散しない。
 *  ステップは損失が減るまで半分にする（バックトラッキング）。決定的（乱数なし・初期値=事前平均）
 */
export function fitMapLogistic(X: number[][], y: number[], m: number[], lambda: number[], maxIter = 40): { w: number[]; iterations: number } {
  const d = m.length;
  let w = m.slice();
  const lossOf = (wv: number[]): number => {
    let L = 0;
    for (let i = 0; i < X.length; i++) {
      let z = 0; for (let j = 0; j < d; j++) z += wv[j] * X[i][j];
      L += softplus(z) - y[i] * z;
    }
    for (let j = 0; j < d; j++) L += 0.5 * lambda[j] * (wv[j] - m[j]) ** 2;
    return L;
  };
  let L0 = lossOf(w);
  let it = 0;
  for (; it < maxIter; it++) {
    const g = new Array<number>(d).fill(0);
    const H: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    for (let j = 0; j < d; j++) { g[j] = lambda[j] * (w[j] - m[j]); H[j][j] = lambda[j]; }
    for (let i = 0; i < X.length; i++) {
      const x = X[i];
      let z = 0; for (let j = 0; j < d; j++) z += w[j] * x[j];
      const s = sigmoid(z);
      const r = s - y[i];
      const v = s * (1 - s);
      for (let j = 0; j < d; j++) {
        if (x[j] === 0) continue;
        g[j] += r * x[j];
        for (let k = 0; k < d; k++) if (x[k] !== 0) H[j][k] += v * x[j] * x[k];
      }
    }
    const step = solveSPD(H, g);
    let t = 1;
    let next = w.map((v, j) => v - t * step[j]);
    let L1 = lossOf(next);
    let guard = 0;
    while (L1 > L0 + 1e-12 && guard < 20) { t /= 2; next = w.map((v, j) => v - t * step[j]); L1 = lossOf(next); guard++; }
    const maxMove = Math.max(...step.map((s) => Math.abs(s * t)));
    w = next; L0 = L1;
    if (maxMove < 1e-7) { it++; break; }
  }
  return { w, iterations: it };
}

// ===== 学習・予測 =====

export type FitOpts = {
  /** 事前基礎率（既定 PRIOR_BASE_RATE）。ラベル定義を変えたら合わせて変える */
  priorBaseRate?: number;
  /** 特徴の事前SDを一括で上書き（テスト・感度分析用） */
  tauScale?: number;
  ctx?: RiskContext;
};

export function readinessOf(nTrain: number, nBinge: number): Readiness {
  if (nTrain < MIN_DAYS_SILENT) return 'silent';
  if (nTrain < MIN_DAYS_FULL || nBinge < MIN_BINGE_FULL) return 'prior';
  return 'full';
}

/**
 * rows[0..n) の「結果が分かる日」で学習する。各日の特徴はその日の朝に分かるもの（rows[<i] と rows[i] の睡眠・周期）。
 * 学習に使う行が0でも壊れない（重み＝事前平均・切片＝logit(事前基礎率)）
 */
export function fitRiskModel(rows: DayFeature[], opts: FitOpts = {}): RiskModel {
  const pi0 = opts.priorBaseRate ?? PRIOR_BASE_RATE;
  const tauScale = opts.tauScale ?? 1;
  const ctx = opts.ctx ?? {};
  const keys = RISK_KEYS.slice();
  const priors = RISK_FEATURES.map((f) => f.prior);
  const m = [logit(pi0), ...priors];
  const lambda = [1 / (INTERCEPT_TAU * tauScale) ** 2, ...RISK_FEATURES.map((f) => 1 / (f.tau * tauScale) ** 2)];
  const X: number[][] = [];
  const y: number[] = [];
  let nBinge = 0;
  for (let i = 0; i < rows.length; i++) {
    const lab = labelOf(rows[i]);
    if (lab == null) continue;
    // 過去日の再現では「今日の予定」は分からない（ctx は今日にだけ効く）＝学習行では null
    const x = featureVector(rows, i, i === rows.length - 1 ? ctx : {});
    X.push([1, ...x.map((v) => (v == null ? 0 : v))]);
    y.push(lab ? 1 : 0);
    if (lab) nBinge++;
  }
  const { w, iterations } = fitMapLogistic(X, y, m, lambda);
  return {
    keys, weights: w.slice(1), priors, intercept: w[0], interceptPrior: m[0],
    nTrain: X.length, nBinge, readiness: readinessOf(X.length, nBinge), iterations,
  };
}

export function predictRisk(model: RiskModel, x: Bit[]): RiskPrediction {
  let z = model.intercept;
  const contributions: Contribution[] = [];
  for (let j = 0; j < model.keys.length; j++) {
    const v = x[j];
    if (v == null || v === 0) continue;
    const delta = model.weights[j] * v;
    z += delta;
    contributions.push({ key: model.keys[j], label: riskFeatureLabel(model.keys[j]), delta });
  }
  contributions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.key < b.key ? -1 : 1));
  return { p: sigmoid(z), logit: z, contributions };
}

/**
 * 時間内ハザード（1日の中で危険が集まる時間帯）。事前分布のみ＝本人データでは学習しない
 * （結果ラベルが日単位なので学習できない。研究ドキュメント §4.3）。
 *  ・夕方17時以降 +0.3、20時以降 +0.6（Smyth 2009: 午後遅く〜夜にピーク）
 *  ・最後の食事から5h以上 +0.3、7h以上 +0.5（長い間隔は次の食事量を増やす）
 *  合計は +1.0（≒2.7倍）で頭打ち
 */
export function intradayLogit(hour: number | null | undefined, hoursSinceLastMeal: number | null | undefined): number {
  let z = 0;
  if (hour != null && Number.isFinite(hour)) {
    if (hour >= 20 || hour < 3) z += 0.6;
    else if (hour >= 17) z += 0.3;
  }
  if (hoursSinceLastMeal != null && Number.isFinite(hoursSinceLastMeal)) {
    if (hoursSinceLastMeal >= 7) z += 0.5;
    else if (hoursSinceLastMeal >= 5) z += 0.3;
  }
  return Math.min(1, z);
}

/** 確率 → 段。silent は常に quiet、prior は nudge 止まり */
export function tierOf(p: number, th: TierThresholds, readiness: Readiness): RiskTier {
  if (readiness === 'silent') return 'quiet';
  if (p >= th.warning && readiness === 'full') return 'warning';
  if (p >= th.nudge) return 'nudge';
  return 'quiet';
}

/** 寄与の説明: 正の寄与だけ・大きい順・最大 max 件（0.05 log-odds 未満は「理由」と呼ばない） */
export function topReasons(contribs: Contribution[], max = 4): Contribution[] {
  return contribs.filter((c) => c.delta >= 0.05).slice(0, max);
}

/**
 * 今日の判定（配線用の入口）。rows は昇順・密で today の行を含むこと（無ければ末尾＋1日として扱わず silent）。
 * 学習は today より前の行だけ（今日の結果を見てから今日を判定しない＝リーク防止）
 */
export function assessBingeRiskV2(rows: DayFeature[], today: string, ctx: RiskContext = {}, opts: { thresholds?: TierThresholds; fit?: FitOpts } = {}): BingeRiskV2 {
  const idx = rows.findIndex((r) => r.date === today);
  const history = idx >= 0 ? rows.slice(0, idx) : rows.filter((r) => r.date < today);
  const model = fitRiskModel(history, opts.fit);
  const baseRate = model.nTrain > 0 ? model.nBinge / model.nTrain : (opts.fit?.priorBaseRate ?? PRIOR_BASE_RATE);
  const thresholds = effectiveThresholds(opts.thresholds ?? DEFAULT_THRESHOLDS, baseRate);
  const weights: Record<string, number> = {};
  model.keys.forEach((k, j) => { weights[k] = Math.round(model.weights[j] * 1000) / 1000; });
  if (idx < 0) {
    return { date: today, readiness: 'silent', pDay: sigmoid(model.intercept), pNow: sigmoid(model.intercept), tier: 'quiet', thresholds, reasons: [],
      model: { nTrain: model.nTrain, nBinge: model.nBinge, baseRate, weights } };
  }
  const x = featureVector(rows, idx, ctx);
  const pred = predictRisk(model, x);
  const zNow = pred.logit + intradayLogit(ctx.hour, ctx.hoursSinceLastMeal);
  const pNow = sigmoid(zNow);
  return {
    date: today, readiness: model.readiness, pDay: pred.p, pNow,
    tier: tierOf(pNow, thresholds, model.readiness), thresholds,
    reasons: topReasons(pred.contributions),
    model: { nTrain: model.nTrain, nBinge: model.nBinge, baseRate, weights },
  };
}

// ===== 自己制限ガード（精度が落ちたら頻度を絞る） =====

export type AlertOutcome = {
  date: string;
  tier: 'nudge' | 'warning';
  p: number;
  /** その日に過食が起きたか。まだ分からない（当日・未記録）なら null＝数えない */
  outcome: boolean | null;
};

export type GuardCfg = {
  /** 直近この日数のアラートだけを見る。古い失敗が永久に閾値を上げ続けないための時効 */
  windowDays: number;
  /** 判断に必要な「結果が分かったアラート」の最低数（これ未満は基準閾値のまま） */
  minResolved: number;
  /** 段ごとの精度床。nudge は基礎率0.08の約2倍、warning は約4倍 */
  floor: TierThresholds;
  /** 閾値を上げる倍率の上限 */
  maxRaise: number;
  /** 週あたりの上限本数（ガードとは独立の予算） */
  maxPerWeek: TierThresholds;
};

export const DEFAULT_GUARD: GuardCfg = {
  windowDays: 28, minResolved: 6,
  floor: { nudge: 0.15, warning: 0.30 },
  maxRaise: 2,
  maxPerWeek: { nudge: 4, warning: 2 },
};

export type GuardResult = {
  thresholds: TierThresholds;
  precision: { nudge: number | null; warning: number | null };
  resolved: { nudge: number; warning: number };
  raised: { nudge: boolean; warning: boolean };
};

/**
 * 直近 windowDays 日の「結果が分かったアラート」の精度が床を下回ったら、その段の閾値を
 * (床 / 観測精度) 倍（上限 maxRaise）に上げる＝頻度が自動で減る。精度が戻れば（または古い失敗が
 * 時効で消えれば）基準閾値に戻る。閾値は基準より下には決して動かない（基準＝期待効用の線）
 */
export function guardThresholds(history: AlertOutcome[], base: TierThresholds, today: string, cfg: GuardCfg = DEFAULT_GUARD): GuardResult {
  const floorDate = shiftDateLocal(today, -cfg.windowDays);
  const recent = history.filter((h) => h && h.date >= floorDate && h.date < today && h.outcome != null);
  const stat = (tier: 'nudge' | 'warning') => {
    const xs = recent.filter((h) => h.tier === tier);
    const hits = xs.filter((h) => h.outcome === true).length;
    return { n: xs.length, precision: xs.length > 0 ? hits / xs.length : null };
  };
  const nd = stat('nudge'); const wn = stat('warning');
  const raise = (th: number, s: { n: number; precision: number | null }, floor: number): { th: number; raised: boolean } => {
    if (s.n < cfg.minResolved || s.precision == null || s.precision >= floor) return { th, raised: false };
    const factor = Math.min(cfg.maxRaise, floor / Math.max(s.precision, 0.02));
    return { th: Math.min(0.95, th * factor), raised: true };
  };
  const n2 = raise(base.nudge, nd, cfg.floor.nudge);
  const w2 = raise(base.warning, wn, cfg.floor.warning);
  const thresholds = { nudge: n2.th, warning: Math.max(w2.th, n2.th) };
  return { thresholds, precision: { nudge: nd.precision, warning: wn.precision }, resolved: { nudge: nd.n, warning: wn.n }, raised: { nudge: n2.raised, warning: w2.raised } };
}

/** 週予算: 直近7日（today を除く）にその段のアラートが maxPerWeek 以上あれば今日は出さない */
export function withinWeeklyBudget(history: AlertOutcome[], today: string, tier: 'nudge' | 'warning', cfg: GuardCfg = DEFAULT_GUARD): boolean {
  const from = shiftDateLocal(today, -7);
  const n = history.filter((h) => h && h.tier === tier && h.date >= from && h.date < today).length;
  return n < cfg.maxPerWeek[tier];
}

// ===== 評価（バックテスト） =====

export type Pred = { date: string; p: number; y: boolean };
export type CalBin = { lo: number; hi: number; n: number; meanP: number; rate: number };

export function brierScore(preds: Pred[]): number {
  if (preds.length === 0) return NaN;
  let s = 0;
  for (const q of preds) s += (q.p - (q.y ? 1 : 0)) ** 2;
  return s / preds.length;
}

/** ROC 曲線下面積（Mann–Whitney）。同点は 0.5。陽性か陰性が無ければ null */
export function aucOf(preds: Pred[]): number | null {
  const pos = preds.filter((q) => q.y).map((q) => q.p);
  const neg = preds.filter((q) => !q.y).map((q) => q.p);
  if (pos.length === 0 || neg.length === 0) return null;
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

export const CAL_EDGES: readonly number[] = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 1.000001];

export function calibrationBins(preds: Pred[], edges: readonly number[] = CAL_EDGES): CalBin[] {
  const out: CalBin[] = [];
  for (let b = 0; b + 1 < edges.length; b++) {
    const lo = edges[b]; const hi = edges[b + 1];
    const xs = preds.filter((q) => q.p >= lo && q.p < hi);
    const n = xs.length;
    out.push({
      lo, hi: Math.min(hi, 1), n,
      meanP: n ? xs.reduce((a, q) => a + q.p, 0) / n : NaN,
      rate: n ? xs.filter((q) => q.y).length / n : NaN,
    });
  }
  return out;
}

export type TierStat = { threshold: number; alerts: number; hits: number; precision: number | null; recall: number | null; alertsPerWeek: number };

export function precisionRecallAt(preds: Pred[], threshold: number): TierStat {
  const alerts = preds.filter((q) => q.p >= threshold);
  const hits = alerts.filter((q) => q.y).length;
  const pos = preds.filter((q) => q.y).length;
  return {
    threshold, alerts: alerts.length, hits,
    precision: alerts.length ? hits / alerts.length : null,
    recall: pos ? hits / pos : null,
    alertsPerWeek: preds.length ? (alerts.length / preds.length) * 7 : 0,
  };
}

/**
 * 「精度 ≥ minPrecision を守れる最大のアラート数」。確率の高い順に並べ、上から k 件取ったときの
 * 精度が床以上になる最大の k を返す（＝この床を守ったまま出せる週あたり本数）。1件も無理なら 0
 */
export function alertsAtPrecision(preds: Pred[], minPrecision: number): { alerts: number; alertsPerWeek: number; threshold: number | null; recall: number | null } {
  const sorted = [...preds].sort((a, b) => b.p - a.p);
  const pos = preds.filter((q) => q.y).length;
  let best = 0; let hitsAtBest = 0; let hits = 0;
  for (let k = 1; k <= sorted.length; k++) {
    if (sorted[k - 1].y) hits++;
    if (hits / k >= minPrecision) { best = k; hitsAtBest = hits; }
  }
  return {
    alerts: best,
    alertsPerWeek: preds.length ? (best / preds.length) * 7 : 0,
    threshold: best > 0 ? sorted[best - 1].p : null,
    recall: pos ? hitsAtBest / pos : null,
  };
}

// --- 二正規 ROC モデル（理論値。研究ドキュメント §2 の表はこれで作った） ---

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26（最大誤差 1.5e-7）
  const s = x < 0 ? -1 : 1; const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
}
export function normCdf(z: number): number { return 0.5 * (1 + erf(z / Math.SQRT2)); }
export function normInv(p: number): number {
  let lo = -8; let hi = 8;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (normCdf(m) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * スコアが 過食日〜N(d',1)・非過食日〜N(0,1) に従うとき（AUC = Φ(d'/√2)）、
 * 基礎率 π で「1日あたりアラート率 α」を出すと精度・再現率はいくつか。
 * α を増やすと精度は単調に下がる（尤度比が閾値で単調＝Neyman–Pearson）＝「頻度↑・精度維持」は
 * 同じ AUC では不可能、の数式的な根拠
 */
export function binormalPrecision(auc: number, baseRate: number, alertRate: number): { precision: number; recall: number } {
  const pi = Math.min(1 - 1e-9, Math.max(1e-9, baseRate));
  const a = Math.min(1, Math.max(1e-9, alertRate));
  const d = Math.SQRT2 * normInv(Math.min(1 - 1e-9, Math.max(0.5, auc)));
  let lo = -8; let hi = 8;
  for (let i = 0; i < 80; i++) {
    const c = (lo + hi) / 2;
    const rate = pi * (1 - normCdf(c - d)) + (1 - pi) * (1 - normCdf(c));
    if (rate > a) lo = c; else hi = c;
  }
  const c = (lo + hi) / 2;
  const tpr = 1 - normCdf(c - d);
  return { precision: Math.min(1, (pi * tpr) / a), recall: tpr };
}

/** 精度床 minPrecision を守れる最大のアラート率（1日あたり）。無理なら 0 */
export function maxAlertRateAtPrecision(auc: number, baseRate: number, minPrecision: number): number {
  let lo = 1e-6; let hi = 1;
  if (binormalPrecision(auc, baseRate, lo).precision < minPrecision) return 0;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (binormalPrecision(auc, baseRate, m).precision >= minPrecision) lo = m; else hi = m; }
  return lo;
}

export type BacktestOpts = {
  /** 学習に最低必要な「結果が分かる日」。既定 MIN_DAYS_SILENT */
  minTrain?: number;
  thresholds?: TierThresholds;
  fit?: FitOpts;
};

export type BacktestResult = {
  n: number;                 // 評価した日数
  nBinge: number;
  baseRate: number;
  brier: number;             // モデルの Brier（小さいほど良い）
  brierBase: number;         // 「常に基礎率」を答えたときの Brier（これを下回らなければ情報がない）
  auc: number | null;
  bins: CalBin[];
  tiers: { nudge: TierStat; warning: TierStat };
  preds: Pred[];
};

/**
 * ローリング・オリジン検証: 日 t の予測は t より前の日だけで学習したモデルで出す（未来を見ない）。
 * 結果が分かる日だけ評価する。学習日数が minTrain 未満の t は飛ばす
 */
export function backtestBingeRisk(rows: DayFeature[], opts: BacktestOpts = {}): BacktestResult {
  const minTrain = opts.minTrain ?? MIN_DAYS_SILENT;
  const preds: Pred[] = [];
  for (let t = 0; t < rows.length; t++) {
    const lab = labelOf(rows[t]);
    if (lab == null) continue;
    const history = rows.slice(0, t);
    const nKnown = history.filter((r) => labelOf(r) != null).length;
    if (nKnown < minTrain) continue;
    const model = fitRiskModel(history, opts.fit);
    const x = featureVector(rows, t, {});
    preds.push({ date: rows[t].date, p: predictRisk(model, x).p, y: lab });
  }
  const nBinge = preds.filter((q) => q.y).length;
  const baseRate = preds.length ? nBinge / preds.length : 0;
  const th = effectiveThresholds(opts.thresholds ?? DEFAULT_THRESHOLDS, baseRate);
  return {
    n: preds.length, nBinge, baseRate,
    brier: brierScore(preds),
    brierBase: preds.length ? brierScore(preds.map((q) => ({ ...q, p: baseRate }))) : NaN,
    auc: aucOf(preds),
    bins: calibrationBins(preds),
    tiers: { nudge: precisionRecallAt(preds, th.nudge), warning: precisionRecallAt(preds, th.warning) },
    preds,
  };
}

// features.ts と同じ計算（循環importを避けてここにも置く。correlate.ts と同じ流儀）
function shiftDateLocal(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
