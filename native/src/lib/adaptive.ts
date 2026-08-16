// メンテナンスカロリーの適応的再校正。
// 理論値（カロリー収支から計算した体重変化）と実測の体重変化のズレから、
// その人の本当のメンテナンスカロリー（基礎代謝×生活係数の部分）を逆算する。
//
// 原理: ΣIntake − TDEE_real×N = Δkg × 7200
//   → base_real = (ΣIntake − Δkg×7200 − Σ運動kcal) / N
// （7200kcal ≒ 体脂肪1kg。運動分は日々のtargetに含まれるため除いてbase部分だけを推定）

export const KCAL_PER_KG = 7200;
export const REVIEW_INTERVAL_DAYS = 14;

export type DayStat = {
  date: string;             // YYYY-MM-DD 昇順で渡す
  intake: number | null;    // その日の摂取kcal（未記録はnull）
  target: number;           // その日の目安kcal（base+運動）
  weight: number | null;    // その日の体重（未記録はnull）
};

export type MaintReview =
  | { status: 'insufficient'; reason: string }
  | { status: 'keep'; newBase: number; actualDelta: number; expectedDelta: number }
  | { status: 'change'; newBase: number; actualDelta: number; expectedDelta: number };

/**
 * 直近期間のデータから実測ベースのメンテナンスカロリー(base)を推定する。
 * @param days 直近14日ぶんの日次データ（昇順）
 * @param currentBase 現在のメンテナンスカロリー（基礎代謝×生活係数、運動を含まない）
 * @param bmr 基礎代謝
 */
export function reviewMaintenance(days: DayStat[], currentBase: number, bmr: number): MaintReview {
  if (days.length < 10) return { status: 'insufficient', reason: '期間が短すぎます' };

  const intakeDays = days.filter((d) => d.intake != null);
  if (intakeDays.length < 10) return { status: 'insufficient', reason: '摂取記録が10日未満です' };

  // 体重アンカー: 期間の最初/最後の4日以内に体重記録が必要
  const head = days.slice(0, 4).filter((d) => d.weight != null);
  const tail = days.slice(-4).filter((d) => d.weight != null);
  if (head.length === 0 || tail.length === 0) {
    return { status: 'insufficient', reason: '期間の最初と最後に体重記録が必要です' };
  }
  // ブレを抑えるため、ある分は平均する
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const startW = avg(head.map((d) => Number(d.weight)));
  const endW = avg(tail.map((d) => Number(d.weight)));
  const actualDelta = Math.round((endW - startW) * 100) / 100; // kg

  // 未記録日は「目安どおり食べた」とみなして偏りを避ける
  const sumIntake = days.reduce((a, d) => a + (d.intake ?? d.target), 0);
  const sumTarget = days.reduce((a, d) => a + d.target, 0);
  const sumEx = days.reduce((a, d) => a + Math.max(0, d.target - currentBase), 0);
  const n = days.length;

  const expectedDelta = Math.round(((sumIntake - sumTarget) / KCAL_PER_KG) * 100) / 100; // kg

  // 実測から逆算したbase
  const rawBase = (sumIntake - actualDelta * KCAL_PER_KG - sumEx) / n;
  // 安全ガード: 1回の見直しで動かすのは±300kcalまで、基礎代謝は下回らない
  const clamped = Math.min(currentBase + 300, Math.max(currentBase - 300, rawBase));
  const floored = Math.max(Math.round(bmr), clamped);
  const newBase = Math.round(floored / 10) * 10;

  if (Math.abs(newBase - currentBase) < 60) {
    return { status: 'keep', newBase: currentBase, actualDelta, expectedDelta };
  }
  return { status: 'change', newBase, actualDelta, expectedDelta };
}

/** 新しいbaseに対応する生活係数（profiles.life_factorに保存する値） */
export function lifeFactorFor(newBase: number, bmr: number): number {
  if (bmr <= 0) return 1.3;
  return Math.round((newBase / bmr) * 1000) / 1000;
}

// ===== 気分・テキストからの「つらい/爆食」検知 =====

const HARD_RE = /(つらい|辛い|ツライ|しんどい|きつい|キツい|キツイ|限界|やめたい|挫折|心が折れ|もう無理|ストレスやばい)/;
const BINGE_RE = /(爆食|ばくしょく|食べ過ぎ|食べすぎ|過食|ドカ食い|どか食い|やけ食い|暴食|チートしすぎ|我慢できな)/;

export type StruggleKind = 'hard' | 'binge' | null;

/** 気分・メモのテキスト群から無理のサインを検知する */
export function detectStruggle(texts: (string | null | undefined)[]): StruggleKind {
  const joined = texts.filter(Boolean).join(' ');
  if (BINGE_RE.test(joined)) return 'binge';
  if (HARD_RE.test(joined)) return 'hard';
  return null;
}
