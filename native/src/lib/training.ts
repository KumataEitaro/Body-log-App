// 筋トレ記録（「🏋️ ベンチプレス 80kg×8×3、懸垂 +10kg×8」形式）の進捗判定
//
// 解析は lib/liftLog に一本化している。以前はここでも別の正規表現を持っていたため、
// 記録の書き方（自重・加重）を足したときに片方だけ読めなくなる事故が起きた。
import { parseLiftText, effectiveKg } from './liftLog';

export type TrainSet = { name: string; kg: number; reps: number; sets: number };

/** @param bodyWeight 自重種目の負荷に使う体重。省略すると加重ぶんだけが負荷になる */
export function parseTrainingText(text: string, bodyWeight?: number | null): TrainSet[] {
  const s = String(text ?? '');
  if (!s.startsWith('🏋️')) return [];
  return parseLiftText(s).map((e) => ({
    name: e.name, kg: effectiveKg(e, bodyWeight), reps: e.reps, sets: e.sets,
  }));
}

export type TrainPoint = { date: string; maxKg: number; volume: number }; // volume = Σ kg×回×set

// 履歴（date×text）→ 種目ごとの時系列（同日複数記録は maxKg=最大 / volume=合算）
// 自重種目の負荷は体重で変わるので、その日の体重を引ける関数を渡せるようにしている
export function trainingSeries(
  rows: { date: string; text: string }[],
  weightAt?: (date: string) => number | null,
): Map<string, TrainPoint[]> {
  const byName = new Map<string, Map<string, TrainPoint>>();
  for (const r of rows) {
    for (const s of parseTrainingText(r.text, weightAt ? weightAt(r.date) : null)) {
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
