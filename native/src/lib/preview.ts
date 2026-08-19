// 保存前プレビューの計算（純関数・テスト対象）
// 「確定済み(base)」「トレイの他の食品(others)」「注目中の食品(focus)」を
// バーの割合へ変換する。合計は必ず100%以内に収める（枠からはみ出させない）。
export type BarPreview = {
  basePct: number;   // 確定済みの埋まり(0-100)
  ghostPct: number;  // 未保存分の埋まり(0-100)。base+ghost<=100
  over: boolean;     // 保存すると目標を超える
  overNow: boolean;  // すでに超えている（保存前から）
};

export function previewFill(eaten: number, staged: number, target: number): BarPreview {
  const t = Math.max(1, target);
  const e = Math.max(0, eaten);
  const g = Math.max(0, staged);
  const basePct = Math.min(100, (e / t) * 100);
  const totalPct = Math.min(100, ((e + g) / t) * 100);
  return {
    basePct,
    ghostPct: Math.max(0, totalPct - basePct),
    over: e + g > t,
    overNow: e > t,
  };
}

export type SplitPreview = {
  basePct: number;    // 確定済み
  othersPct: number;  // トレイのうち注目していない食品
  focusPct: number;   // 注目中の食品（1品だけ強調するため分離）
  over: boolean;
};

/** トレイの1品を強調表示するための3分割。合計は100%に収める */
export function previewFillSplit(
  eaten: number, others: number, focus: number, target: number,
): SplitPreview {
  const t = Math.max(1, target);
  const e = Math.max(0, eaten);
  const o = Math.max(0, others);
  const f = Math.max(0, focus);
  const basePct = Math.min(100, (e / t) * 100);
  const withOthers = Math.min(100, ((e + o) / t) * 100);
  const withAll = Math.min(100, ((e + o + f) / t) * 100);
  return {
    basePct,
    othersPct: Math.max(0, withOthers - basePct),
    focusPct: Math.max(0, withAll - withOthers),
    over: e + o + f > t,
  };
}
