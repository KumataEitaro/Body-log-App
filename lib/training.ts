// 筋トレ記録（「🏋️ ベンチプレス 80kg×8×3、スクワット 100kg×5」形式）のパースと進捗判定

export type TrainSet = { name: string; kg: number; reps: number; sets: number };

export function parseTrainingText(text: string): TrainSet[] {
  const t = String(text ?? '');
  if (!t.startsWith('🏋️')) return [];
  return t.replace(/^🏋️\s*/, '').split('、').map((part) => {
    const m = part.trim().match(/^(.+?)\s+([\d.]+)kg×(\d+)(?:×(\d+))?$/);
    if (!m) return null;
    return { name: m[1].trim(), kg: parseFloat(m[2]), reps: parseInt(m[3], 10), sets: m[4] ? parseInt(m[4], 10) : 1 };
  }).filter((x): x is TrainSet => x != null);
}

export type TrainPoint = { date: string; maxKg: number; volume: number }; // volume = Σ kg×回×set

// 履歴（date×text）→ 種目ごとの時系列（同日複数記録は maxKg=最大 / volume=合算）
export function trainingSeries(rows: { date: string; text: string }[]): Map<string, TrainPoint[]> {
  const byName = new Map<string, Map<string, TrainPoint>>();
  for (const r of rows) {
    for (const s of parseTrainingText(r.text)) {
      if (!byName.has(s.name)) byName.set(s.name, new Map());
      const days = byName.get(s.name)!;
      const cur = days.get(r.date) ?? { date: r.date, maxKg: 0, volume: 0 };
      cur.maxKg = Math.max(cur.maxKg, s.kg);
      cur.volume += s.kg * s.reps * s.sets;
      days.set(r.date, cur);
    }
  }
  const out = new Map<string, TrainPoint[]>();
  for (const [name, days] of byName) {
    out.set(name, [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)));
  }
  return out;
}

export type VolumeVerdict = { trend: 'up' | 'flat' | 'down'; pct: number; lastVolume: number; baseVolume: number } | null;

// 直近セッションのボリュームを、その前の最大3回の平均と比較（±5%を維持ゾーンとする）
export function volumeVerdict(points: TrainPoint[]): VolumeVerdict {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const prev = points.slice(-4, -1);
  const base = prev.reduce((a, p) => a + p.volume, 0) / prev.length;
  if (base <= 0) return null;
  const pct = Math.round(((last.volume - base) / base) * 100);
  const trend = pct > 5 ? 'up' : pct < -5 ? 'down' : 'flat';
  return { trend, pct, lastVolume: Math.round(last.volume), baseVolume: Math.round(base) };
}
