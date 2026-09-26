// 「摂取カロリー」棒グラフ（components/IntakeBarsCard.tsx）の集計（2026-09-26）。
//
// 熊田さんが参考にした他社アプリ（Calorie Tracker の Insights）: 7D/30D/90D の切替、「avg 1,742 kcal」、
// 日別の緑の棒と点線の目標ライン。ここはその **数字の部分** だけを純関数で持ち、描画はカードに任せる。
//
//   ・区間の切り出し: 今日を右端に days 日ぶんを「毎日1本」で並べる（未記録日も空の棒として枠を取る＝
//     日付の間隔が均等になり、記録の抜けも見える）
//   ・平均: 記録がある日だけの単純平均（未記録日は分母に入れない。表の「期間平均」と同じ流儀）
//   ・目標クリア判定: intake <= goal（曜日ヒートマップの「超過 = diff > 0」と同じ境界。ちょうど目標なら達成）
//   ・y 軸: 0 起点で 3〜4 目盛り。最大値（棒と目標線の大きい方）を「切りのいい数」に丸める
//
// 集計はここ、色と形はカード。jest（lib/__tests__/intakeBars.test.ts）で境界を固定する。

export type IntakeRow = { date: string; intake: number | null; goal: number | null };

/** 区間セグメントの選択肢（日数） */
export type IntakeRange = 7 | 30 | 90;
export const INTAKE_RANGES: readonly IntakeRange[] = [7, 30, 90];
export const DEFAULT_INTAKE_RANGE: IntakeRange = 7;

/** AsyncStorage に入っていた文字列を区間に戻す。壊れていれば既定（7日） */
export function parseIntakeRange(raw: string | null | undefined): IntakeRange {
  const n = Number(raw);
  return (INTAKE_RANGES as readonly number[]).includes(n) ? (n as IntakeRange) : DEFAULT_INTAKE_RANGE;
}

export type IntakeBar = {
  date: string;
  intake: number | null;
  goal: number | null;
  /** 目標を超えたか。intake か goal が無ければ null（色を付けない） */
  over: boolean | null;
};

export type IntakeBarsStat = {
  /** 区間の毎日（古い順・days 本） */
  bars: IntakeBar[];
  /** 記録がある日の平均摂取kcal。1日も無ければ null */
  avg: number | null;
  /** 記録がある日数 */
  recorded: number;
  /** 目標内（クリア）だった日数 */
  within: number;
  /** 超過した日数 */
  over: number;
  /** 目標ラインの高さ＝区間内で目標が分かる日の平均目標。無ければ null */
  goalAvg: number | null;
  /** y 軸の目盛り（0 起点・昇順・最後が上端） */
  ticks: number[];
};

/** 'YYYY-MM-DD' に n 日足す（UTC 正午基準で DST の影響を受けない） */
export function addDaysIso(date: string, n: number): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  const t = Date.UTC(y, m - 1, d, 12) + n * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** 目標を超えたか。どちらかが無ければ null。ちょうど目標は「クリア」 */
export function isOverGoal(intake: number | null | undefined, goal: number | null | undefined): boolean | null {
  if (intake == null || goal == null || !Number.isFinite(intake) || !Number.isFinite(goal)) return null;
  return intake > goal;
}

/**
 * y 軸の目盛りを 0 起点で 3〜4 本にする。
 * 上端は max 以上で「切りのいい数」（1・2・5 × 10^n の刻み）。max が 0 以下なら 0〜1000 を返す。
 */
export function intakeTicks(max: number): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 500, 1000];
  const raw = max / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

/** 今日を右端に days 日ぶんを切り出し、毎日1本の棒にする（未記録日は intake null） */
export function sliceIntakeRange(rows: readonly IntakeRow[], days: number, today: string): IntakeBar[] {
  const by = new Map<string, IntakeRow>();
  for (const r of rows) by.set(r.date, r);   // 同じ日付が複数あれば後勝ち（概要タブの rows は日付ユニーク）
  const start = addDaysIso(today, -(days - 1));
  const out: IntakeBar[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysIso(start, i);
    const r = by.get(date);
    const intake = r?.intake != null && Number.isFinite(Number(r.intake)) ? Number(r.intake) : null;
    const goal = r?.goal != null && Number.isFinite(Number(r.goal)) ? Number(r.goal) : null;
    out.push({ date, intake, goal, over: isOverGoal(intake, goal) });
  }
  return out;
}

/** カードが描くものを全部まとめて出す */
export function intakeBarsStats(rows: readonly IntakeRow[], days: number, today: string): IntakeBarsStat {
  const bars = sliceIntakeRange(rows, days, today);
  let sum = 0, recorded = 0, within = 0, over = 0, goalSum = 0, goalN = 0, max = 0;
  for (const b of bars) {
    if (b.intake != null) {
      sum += b.intake; recorded += 1;
      if (b.intake > max) max = b.intake;
      if (b.over === true) over += 1;
      else if (b.over === false) within += 1;
    }
    if (b.goal != null) {
      goalSum += b.goal; goalN += 1;
      if (b.goal > max) max = b.goal;
    }
  }
  return {
    bars,
    avg: recorded > 0 ? sum / recorded : null,
    recorded, within, over,
    goalAvg: goalN > 0 ? goalSum / goalN : null,
    ticks: intakeTicks(max),
  };
}
