// 目標→計画→標準進捗の計算ロジック

import { FAT_KCAL_PER_KG } from './calc';

export type Goal = {
  target_date: string;   // YYYY-MM-DD
  target_weight: number | null;
  target_bf: number | null;
  note: string;
  start_date: string;
  start_weight: number;
  absorb_days?: number | null; // チートデイ超過の吸収方式: null=目標日まで均等 / N=各チートデイ後N日で取り返す
};

export type PlanEvent = { date: string; title: string; extra_kcal: number };

const MS_DAY = 86400000;

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((new Date(toISO + 'T00:00:00Z').getTime() - new Date(fromISO + 'T00:00:00Z').getTime()) / MS_DAY);
}

export function addDays(iso: string, n: number): string {
  return new Date(new Date(iso + 'T00:00:00Z').getTime() + n * MS_DAY).toISOString().slice(0, 10);
}

// グラフ横軸用の日付目盛り（x0〜x1を最大n分割）
export function dateTicks(x0: string, x1: string, n = 6): string[] {
  const total = Math.max(daysBetween(x0, x1), 1);
  const count = Math.min(n, total);
  const ticks: string[] = [];
  for (let i = 0; i <= count; i++) {
    ticks.push(addDays(x0, Math.round((total * i) / count)));
  }
  return [...new Set(ticks)];
}

// その日付時点の「標準進捗の体重」（開始→目標の直線）
export function plannedWeightAt(goal: Goal, dateISO: string): number | null {
  if (goal.target_weight == null) return null;
  const total = daysBetween(goal.start_date, goal.target_date);
  if (total <= 0) return goal.target_weight;
  const elapsed = Math.min(Math.max(daysBetween(goal.start_date, dateISO), 0), total);
  const w = goal.start_weight + (goal.target_weight - goal.start_weight) * (elapsed / total);
  return Math.round(w * 100) / 100;
}

export type Plan = {
  remainingDays: number;        // 今日を含む残り日数
  remainingKg: number;          // あと何kg
  remainingDeficit: number;     // 必要な総赤字kcal
  requiredDaily: number;        // チートデイ無視の必要赤字/日
  eventsExtra: number;          // 未来のチートデイ見込み超過kcal合計
  absorbToday: number;          // 今日に上乗せする吸収kcal
  requiredDailyWithEvents: number; // 今日の必要赤字（吸収込み）
  mode: 'spread' | 'window';    // spread=目標日まで均等 / window=チートデイ後N日で取り返す
  absorbDays: number | null;
  feasibility: 'ok' | 'hard' | 'unrealistic'; // 1日赤字の現実性
};

// 現在体重と目標から、必要な1日赤字を算定。
// チートデイ超過の吸収は2方式:
//  - spread（absorbDaysなし）: 未来のチートデイ見込みを目標日までの全日数に均等配分（先回りで貯金）
//  - window（absorbDays=N）: 各チートデイの後N日間で取り返す（直前まで通常、直後が締まる）
export function computePlan(
  goal: Goal, todayISO: string, currentWeight: number,
  events: PlanEvent[], absorbDays?: number | null
): Plan | null {
  if (goal.target_weight == null) return null;
  const remainingDays = Math.max(daysBetween(todayISO, goal.target_date), 1);
  const remainingKg = Math.round((currentWeight - goal.target_weight) * 100) / 100;
  const remainingDeficit = Math.round(remainingKg * FAT_KCAL_PER_KG);
  const requiredDaily = Math.round(remainingDeficit / remainingDays);
  const eventsExtra = Math.round(events.filter((e) => e.date >= todayISO)
    .reduce((a, e) => a + (Number(e.extra_kcal) || 0), 0));

  let absorbToday: number;
  let requiredDailyWithEvents: number;
  if (absorbDays && absorbDays > 0) {
    // window: 過去N日以内のチートデイ超過を1/Nずつ今日に上乗せ
    absorbToday = Math.round(events
      .filter((e) => e.date < todayISO && daysBetween(e.date, todayISO) <= absorbDays)
      .reduce((a, e) => a + (Number(e.extra_kcal) || 0) / absorbDays, 0));
    requiredDailyWithEvents = requiredDaily + absorbToday;
  } else {
    // spread: 未来の見込みを残り全日数で均等吸収
    absorbToday = Math.round(eventsExtra / remainingDays);
    requiredDailyWithEvents = Math.round((remainingDeficit + eventsExtra) / remainingDays);
  }

  const feasibility: Plan['feasibility'] =
    requiredDailyWithEvents <= 700 ? 'ok' : requiredDailyWithEvents <= 1000 ? 'hard' : 'unrealistic';
  return {
    remainingDays, remainingKg, remainingDeficit, requiredDaily,
    eventsExtra, absorbToday, requiredDailyWithEvents,
    mode: absorbDays && absorbDays > 0 ? 'window' : 'spread',
    absorbDays: absorbDays && absorbDays > 0 ? absorbDays : null,
    feasibility,
  };
}

// 体重の移動平均（各点について「その日を含む過去windowDays日間」に記録された点の平均）
export function movingAverage(
  points: { date: string; weight: number }[],
  windowDays = 7
): { date: string; weight: number }[] {
  return points.map((p) => {
    const inWindow = points.filter(
      (q) => q.date <= p.date && daysBetween(q.date, p.date) < windowDays
    );
    const avg = inWindow.reduce((a, q) => a + q.weight, 0) / inWindow.length;
    return { date: p.date, weight: Math.round(avg * 100) / 100 };
  });
}

export type ProgressStatus = {
  plannedWeight: number;   // 今日あるべき体重
  actualWeight: number;    // 直近の実測
  diffKg: number;          // 実測 − 標準（マイナス=先行）
  diffDays: number;        // 何日ぶん進んでいる(+)/遅れている(−)
  state: 'ahead' | 'ontrack' | 'behind';
};

// 標準進捗との比較（±0.15kgはオントラック扱い）
export function progressStatus(goal: Goal, todayISO: string, actualWeight: number): ProgressStatus | null {
  const planned = plannedWeightAt(goal, todayISO);
  if (planned == null || goal.target_weight == null) return null;
  const total = daysBetween(goal.start_date, goal.target_date);
  const ratePerDay = total > 0 ? (goal.start_weight - goal.target_weight) / total : 0; // kg/日（減量なら正）
  const diffKg = Math.round((actualWeight - planned) * 100) / 100;
  const diffDays = ratePerDay > 0 ? Math.round(-diffKg / ratePerDay) : 0;
  const state: ProgressStatus['state'] = Math.abs(diffKg) <= 0.15 ? 'ontrack' : diffKg < 0 ? 'ahead' : 'behind';
  return { plannedWeight: planned, actualWeight, diffKg, diffDays, state };
}
