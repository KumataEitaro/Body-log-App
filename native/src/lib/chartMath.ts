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
  const span = max - min;
  const rawStep = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  // きれいな刻み（1-2-5系）を大→小の順に試し、ラベル数がtarget本に届く
  // 最初の刻みを採用する（「画面上に最低8個の数字」を保証するため）
  const cands = [10, 5, 2, 1, 0.5, 0.2, 0.1].map((k) => k * mag);
  let step = cands[cands.length - 1];
  for (const c of cands) {
    if (Math.floor(span / c) + 1 >= target) { step = c; break; }
  }
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { ticks, lo, hi };
}

// ===== X軸目盛り =====
// Withings準拠: 縦グリッドは「全境界」に引き、ラベルだけ間引く（label=''はグリッドのみ）
export type XTick = { idx: number; label: string };
export function xTicks(startIdx: number, endIdx: number, maxLabels = 8): XTick[] {
  const days = endIdx - startIdx;
  const out: XTick[] = [];
  const first = new Date(Math.ceil(startIdx) * 86400000);
  if (days <= 32) {
    // 日境界: グリッドは毎日、ラベルはmaxLabels本まで
    const labelStep = Math.max(1, Math.ceil(days / maxLabels));
    for (let i = Math.ceil(startIdx); i <= Math.floor(endIdx); i += 1) {
      const d = new Date(i * 86400000);
      const labeled = (i - Math.ceil(startIdx)) % labelStep === 0;
      out.push({ idx: i, label: labeled ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : '' });
    }
  } else if (days <= 500) {
    // 月境界: グリッドは全月＋（〜200日は週の補助線も）、ラベルは全月（多すぎる時だけ間引き）
    const months: XTick[] = [];
    const cur = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    while (cur.getTime() / 86400000 <= endIdx) {
      const idx = cur.getTime() / 86400000;
      if (idx >= startIdx) {
        months.push({ idx, label: cur.getUTCMonth() === 0 ? `${String(cur.getUTCFullYear()).slice(2)}/1` : `${cur.getUTCMonth() + 1}` });
      }
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    const labelStep = Math.max(1, Math.ceil(months.length / maxLabels));
    months.forEach((m, i) => out.push({ idx: m.idx, label: i % labelStep === 0 ? m.label : '' }));
    if (days <= 200) {
      // 週の補助線（月曜・ラベルなし）
      for (let i = Math.ceil(startIdx); i <= Math.floor(endIdx); i += 1) {
        if (((i + 3) % 7) === 0 && !out.some((t) => Math.abs(t.idx - i) < 1)) out.push({ idx: i, label: '' });
      }
      out.sort((a, b) => a.idx - b.idx);
    }
  } else {
    // 年境界: グリッドは全年＋四半期の補助線、ラベルは全年
    const cur = new Date(Date.UTC(first.getUTCFullYear(), 0, 1));
    while (cur.getTime() / 86400000 <= endIdx) {
      const idx = cur.getTime() / 86400000;
      if (idx >= startIdx) out.push({ idx, label: `${cur.getUTCFullYear()}` });
      for (const q of [3, 6, 9]) {
        const mid = new Date(cur); mid.setUTCMonth(q);
        const midIdx = mid.getTime() / 86400000;
        if (midIdx >= startIdx && midIdx <= endIdx) out.push({ idx: midIdx, label: '' });
      }
      cur.setUTCFullYear(cur.getUTCFullYear() + 1);
    }
    out.sort((a, b) => a.idx - b.idx);
  }
  return out;
}

// ===== 滑らかなトレンド（1日刻みのゼロ位相EMA） =====
// 記録のある日だけの点をベジェで繋ぐと、間隔がまばらな所で折れ・平坦→急坂が出る。
// 対策: ①ビンを1日刻みに線形補間して密な系列にする → ②EMAを前向き→後ろ向きの
// 2パスでかける（ゼロ位相＝遅れなし）。密な点列になるのでパスはどこでも滑らか。
export function smoothTrend(bins: Bin[], unit: BinUnit): Bin[] {
  if (bins.length < 2) return bins;
  const start = Math.ceil(bins[0].idx), end = Math.floor(bins[bins.length - 1].idx);
  if (end <= start) return bins;
  // 1日刻みへ線形補間
  const daily: number[] = [];
  let j = 0;
  for (let i = start; i <= end; i++) {
    while (j < bins.length - 2 && bins[j + 1].idx < i) j++;
    const a = bins[j], b = bins[Math.min(j + 1, bins.length - 1)];
    const t = b.idx === a.idx ? 0 : (i - a.idx) / (b.idx - a.idx);
    daily.push(a.value + (b.value - a.value) * Math.min(1, Math.max(0, t)));
  }
  // ゼロ位相EMA（半減期は表示単位に応じて）
  const halflife = { day: 3.5, week: 14, month: 45 }[unit];
  const alpha = 1 - Math.pow(0.5, 1 / halflife);
  const fwd = [...daily];
  for (let i = 1; i < fwd.length; i++) fwd[i] = fwd[i - 1] + (daily[i] - fwd[i - 1]) * alpha;
  const out = [...fwd];
  for (let i = out.length - 2; i >= 0; i--) out[i] = out[i + 1] + (fwd[i] - out[i + 1]) * alpha;
  return out.map((v, k) => ({ idx: start + k, value: v }));
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
