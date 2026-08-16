// 1日複数記録（logs）→ 日次サマリー（entries）への集計

import { EX_ADD, EX_LEVELS, type ExLevel } from './calc';
import type { FoodItem } from './items';

export type LogRow = {
  id?: string;
  at?: string;
  items?: FoodItem[] | null;
  kcal?: number | null;
  p?: number | null;
  f?: number | null;
  c?: number | null;
  weight?: number | null;
  waist?: number | null;
  ex?: ExLevel | null;
  adj?: number | null;
  mood?: string | null;
  text?: string | null;
  photo_urls?: string[] | null;
};

export type DaySummary = {
  intake: number | null;
  p: number | null;
  f: number | null;
  c: number | null;
  weight: number | null;
  waist: number | null;
  ex: ExLevel;      // 表示用: その日の最高強度
  adj: number;      // 目安計算用: (Σ運動追加kcal + Σ補正) − EX_ADD[最高強度] を折り込む
  exKcalTotal: number; // その日の運動追加kcalの合計（表示用）
  mood: string;
  food_text: string;
  photo_urls: string[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

// その日の運動追加kcal合計 = Σ EX_ADD[レベル] + Σ 補正
export function dayExerciseKcal(logs: LogRow[]): number {
  return round1(logs.reduce((a, l) => a + (EX_ADD[(l.ex as ExLevel) || 'オフ'] ?? 0) + (Number(l.adj) || 0), 0));
}

// 最高強度レベル（表示用）
export function maxExLevel(logs: LogRow[]): ExLevel {
  let idx = 0;
  for (const l of logs) {
    const i = EX_LEVELS.indexOf((l.ex as ExLevel) || 'オフ');
    if (i > idx) idx = i;
  }
  return EX_LEVELS[idx];
}

// 日次サマリー。既存のダッシュボード計算（BMR×係数 + EX_ADD[ex] + adj）が
// そのまま加算式の合計と一致するよう、超過分をadjに折り込む。
export function summarizeDay(logs: LogRow[]): DaySummary {
  const meals = logs.filter((l) => l.kcal != null);
  const sum = (k: 'kcal' | 'p' | 'f' | 'c') =>
    meals.length ? round1(meals.reduce((a, l) => a + (Number(l[k]) || 0), 0)) : null;

  const weights = logs.filter((l) => l.weight != null);
  const waists = logs.filter((l) => l.waist != null);
  const moods = logs.filter((l) => l.mood && String(l.mood).trim() !== '');
  const ex = maxExLevel(logs);
  const exTotal = dayExerciseKcal(logs);

  return {
    intake: sum('kcal'),
    p: sum('p'),
    f: sum('f'),
    c: sum('c'),
    weight: weights.length ? Number(weights[weights.length - 1].weight) : null,
    waist: waists.length ? Number(waists[waists.length - 1].waist) : null,
    ex,
    adj: round1(exTotal - (EX_ADD[ex] ?? 0)),
    exKcalTotal: exTotal,
    mood: moods.length ? String(moods[moods.length - 1].mood) : '',
    food_text: logs.map((l) => String(l.text || '').trim()).filter(Boolean).join(' ／ '),
    photo_urls: logs.flatMap((l) => l.photo_urls || []),
  };
}
