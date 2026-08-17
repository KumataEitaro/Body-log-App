// インタラクティブチャートの数学（純関数）: ビン集計・移動平均・ベジェ補間・nice目盛り
// Web版 components/InteractiveChart.tsx のズームロジックをRN向けに再整理したもの

export type RawPoint = { date: string; value: number }; // date: YYYY-MM-DD（昇順前提）

// ===== 日付 ⇄ 連番（エポックからの日数） =====
export function dateToIdx(d: string): number {
  return Math.round(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86400000);
}
export function idxToDate(i: number): string {
  const dt = new Date(i * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// ===== 表示窓に応じたビン単位（日/週/月） =====
export type BinUnit = 'day' | 'week' | 'month';
export function unitForDays(days: number): BinUnit {
  if (days <= 60) return 'day';
  if (days <= 400) return 'week';
  return 'month';
}
// 移動平均の窓幅（単位ごと）
export const MA_WINDOW: Record<BinUnit, number> = { day: 7, week: 4, month: 3 };

export type Bin = { idx: number; value: number };

// 全データを単位で集計（値は平均・idxはビン中心の日連番）
export function binPoints(points: RawPoint[], unit: BinUnit): Bin[] {
  if (points.length === 0) return [];
  const groups = new Map<string, { sum: number; n: number; idxSum: number }>();
  for (const p of points) {
    const idx = dateToIdx(p.date);
    let key: string;
    if (unit === 'day') key = p.date;
    else if (unit === 'week') key = String(Math.floor((idx + 4) / 7)); // 週番号（境界は固定でよい）
    else key = p.date.slice(0, 7);
    const g = groups.get(key) ?? { sum: 0, n: 0, idxSum: 0 };
    g.sum += p.value; g.n += 1; g.idxSum += idx;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ idx: g.idxSum / g.n, value: g.sum / g.n }))
    .sort((a, b) => a.idx - b.idx);
}

// 中心移動平均（端は片側のみで平均＝端点も欠けない）
export function movingAvg(bins: Bin[], w: number): Bin[] {
  if (w <= 1 || bins.length === 0) return bins;
  const half = Math.floor(w / 2);
  return bins.map((b, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(bins.length - 1, i + half); j++) {
      sum += bins[j].value; n++;
    }
    return { idx: b.idx, value: sum / n };
  });
}

// ===== Y軸 nice目盛り（1-2-5系列） =====
export function niceTicks(min: number, max: number, target = 5): { ticks: number[]; lo: number; hi: number } {
  if (!(max > min)) { min -= 1; max += 1; }
  const rawStep = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { ticks, lo, hi };
}

// ===== X軸目盛り（ズーム率に応じて日→週→月→年の密度を自動調整） =====
export type XTick = { idx: number; label: string };
export function xTicks(startIdx: number, endIdx: number, maxLabels = 5): XTick[] {
  const days = endIdx - startIdx;
  const out: XTick[] = [];
  const first = new Date(Math.ceil(startIdx) * 86400000);
  if (days <= 21) {
    // 日単位: N日おきに M/D
    const step = Math.max(1, Math.ceil(days / maxLabels));
    for (let i = Math.ceil(startIdx); i <= Math.floor(endIdx); i += step) {
      const d = new Date(i * 86400000);
      out.push({ idx: i, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` });
    }
  } else if (days <= 450) {
    // 月境界: 1日ごとに M月（数が多ければ間引き）
    const months: XTick[] = [];
    const cur = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    while (cur.getTime() / 86400000 <= endIdx) {
      const idx = cur.getTime() / 86400000;
      if (idx >= startIdx) {
        months.push({ idx, label: cur.getUTCMonth() === 0 ? `${String(cur.getUTCFullYear()).slice(2)}/1` : `${cur.getUTCMonth() + 1}月` });
      }
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    const step = Math.max(1, Math.ceil(months.length / maxLabels));
    for (let i = 0; i < months.length; i += step) out.push(months[i]);
  } else {
    // 年境界
    const cur = new Date(Date.UTC(first.getUTCFullYear(), 0, 1));
    while (cur.getTime() / 86400000 <= endIdx) {
      const idx = cur.getTime() / 86400000;
      if (idx >= startIdx) out.push({ idx, label: `${cur.getUTCFullYear()}年` });
      cur.setUTCFullYear(cur.getUTCFullYear() + 1);
    }
  }
  return out;
}

// ===== Catmull-Rom → 3次ベジェのSVGパス（滑らかなトレンド曲線） =====
export function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

// 直線ポリライン用
export function linePath(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}
