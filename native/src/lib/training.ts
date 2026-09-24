// 筋トレ記録（「🏋️ ベンチプレス 80kg×8×3、懸垂 +10kg×8」形式）の進捗判定
//
// 解析は lib/liftLog に一本化している。以前はここでも別の正規表現を持っていたため、
// 記録の書き方（自重・加重）を足したときに片方だけ読めなくなる事故が起きた。
import { parseLiftText, effectiveKg, totalKg, sidesOf } from './liftLog';
import { liftPartOf } from './lifts';

/**
 * kg は実負荷（自重種目は体重込み）。**片側入力（ダンベル）の kg は片手ぶん**で、
 * side が true のときだけ立つ（ボリュームは両側＝×2 で数える。liftLog.ts の方針）
 */
export type TrainSet = { name: string; kg: number; reps: number; sets: number; side?: boolean };

/** @param bodyWeight 自重種目の負荷に使う体重。省略すると加重ぶんだけが負荷になる */
export function parseTrainingText(text: string, bodyWeight?: number | null): TrainSet[] {
  const s = String(text ?? '');
  if (!s.startsWith('🏋️')) return [];
  return parseLiftText(s).map((e) => ({
    name: e.name, kg: effectiveKg(e, bodyWeight), reps: e.reps, sets: e.sets,
    ...(e.side ? { side: true } : {}),
  }));
}

/**
 * volume = Σ 両側の実負荷×回×set。maxKg はその日の最大実負荷（片側入力の種目は片側の重さ）。
 * side はその日に片側入力の記録が1つでもあれば true（グラフの単位に「片側」と添えるため）
 */
export type TrainPoint = { date: string; maxKg: number; volume: number; side?: boolean };

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
      // 最大重量は片側のまま（ダンベルは片側で語る）。ボリュームは両側ぶん
      cur.maxKg = Math.max(cur.maxKg, s.kg);
      cur.volume += s.kg * sidesOf(s) * s.reps * s.sets;
      if (s.side) cur.side = true;
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

// ===== 週×部位のボリューム統計 =====

/** 週の起点（月曜はじまり）。統計とカレンダーで同じ区切りを使う */
export function weekStartOf(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export type PartWeek = { week: string; total: number; byPart: Record<string, number> };

/**
 * 筋トレ記録を「週×部位」の総挙上量に集計する。
 * 「肩のボリュームが週ごとにどう変わっているか」を部位別に遡るための土台。
 * 部位は liftPartOf（基本種目のカタログ＋ユーザー追加種目の設定。どちらにも無ければ 'other'）。
 * 片側入力（ダンベル）の記録は両側ぶん（×2）で数える（totalKg）。
 * @param endDate  最新週を決める基準日（通常は今日）。ここを引数にしているのは
 *                 テストと再現性のため（内部で現在時刻を読まない）
 * @param weeks    返す週数。記録が無い週も0で埋める（休んだ週が見えることに意味がある）
 */
export function weeklyPartVolumes(
  rows: { date: string; text: string }[],
  weightAt: ((date: string) => number | null) | undefined,
  weeks: number,
  endDate: string,
): PartWeek[] {
  const byWeek = new Map<string, Record<string, number>>();
  for (const r of rows) {
    for (const e of parseLiftText(r.text)) {
      const wk = weekStartOf(r.date);
      const part = liftPartOf(e.name);
      const kg = totalKg(e, weightAt ? weightAt(r.date) : null);
      const m = byWeek.get(wk) ?? {};
      m[part] = (m[part] ?? 0) + kg * e.reps * e.sets;
      byWeek.set(wk, m);
    }
  }
  // 最新週から遡って weeks 週ぶんを並べる（古い週が先）
  const out: PartWeek[] = [];
  const end = new Date(weekStartOf(endDate) + 'T00:00:00');
  for (let i = weeks - 1; i >= 0; i--) {
    const dt = new Date(end);
    dt.setDate(dt.getDate() - i * 7);
    const wk = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const m = byWeek.get(wk) ?? {};
    const byPart: Record<string, number> = {};
    let total = 0;
    for (const [k, v] of Object.entries(m)) { byPart[k] = Math.round(v); total += v; }
    out.push({ week: wk, total: Math.round(total), byPart });
  }
  return out;
}
