// 過食リスク v2 の I/O 層（lib/bingeRisk.ts は純関数。ここが端末保存を担う）
//
//  ・学習済みモデルのキャッシュ 'bl-binge-model'（日付＋学習日数をキーに1日1回だけ学習し直す）
//  ・出したアラートと結果 'bl-binge-alert-outcomes'（{date,tier,p,outcome}・30日で掃除・
//    翌日以降にその日のラベルで outcome を埋める＝自己制限ガードの材料）
//  ・夜の渇望チェックの「今日は閉じる」 'bl-craving-snooze'
// 判断（結果の解決・最終食事からの経過）は純関数にしてテストする（__tests__/bingeRiskStore.test.ts）
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DayFeature } from './features';
import { fitRiskModel, labelOf, type AlertOutcome, type RiskModel } from './bingeRisk';

export const MODEL_KEY = 'bl-binge-model';
export const OUTCOMES_KEY = 'bl-binge-alert-outcomes';
export const CRAVING_SNOOZE_KEY = 'bl-craving-snooze';
export const OUTCOMES_KEEP_DAYS = 30;
const MODEL_V = 1;   // RISK_FEATURES の列を変えたら上げる（古い重みを捨てる）

// ===== 純関数 =====

/** 最後の食事（kcal のある記録）からの経過時間（h）。食事が無ければ null */
export function hoursSinceLastMeal(logs: readonly { at?: string | null; kcal?: number | null }[], nowMs: number): number | null {
  let last = -Infinity;
  for (const l of logs) {
    if (l.kcal == null || !l.at) continue;
    const ms = Date.parse(l.at);
    if (Number.isFinite(ms) && ms > last) last = ms;
  }
  if (!Number.isFinite(last)) return null;
  return Math.max(0, (nowMs - last) / 3600000);
}

function shiftDateLocal(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * 出したアラートの結果を、その日のラベル（過食だったか）で埋める。
 *  ・today より前の日だけ解決する（今日はまだ結果が出ていない）
 *  ・ラベルが不明（未記録）の日は null のまま（ガードは数えない）
 *  ・keepDays より古い行は落とす
 * 純関数（入力を書き換えない）
 */
export function resolveOutcomes(outcomes: readonly AlertOutcome[], rows: readonly DayFeature[], today: string, keepDays = OUTCOMES_KEEP_DAYS): AlertOutcome[] {
  const floor = shiftDateLocal(today, -keepDays);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return outcomes
    .filter((o) => o && typeof o.date === 'string' && o.date >= floor)
    .map((o) => {
      if (o.date >= today || o.outcome != null) return { ...o };
      const r = byDate.get(o.date);
      const lab = r ? labelOf(r) : null;
      return { ...o, outcome: lab };
    });
}

/** 1日1件に保つ（同じ日に nudge → warning と上がったら上書き。下がる方向には触らない） */
export function upsertOutcome(outcomes: readonly AlertOutcome[], entry: AlertOutcome): AlertOutcome[] {
  const rank = (t: AlertOutcome['tier']) => (t === 'warning' ? 2 : 1);
  const idx = outcomes.findIndex((o) => o.date === entry.date);
  if (idx < 0) return [...outcomes, { ...entry }];
  const cur = outcomes[idx];
  if (rank(entry.tier) <= rank(cur.tier)) return outcomes.map((o) => ({ ...o }));
  return outcomes.map((o, i) => (i === idx ? { ...cur, tier: entry.tier, p: entry.p } : { ...o }));
}

// ===== 端末保存 =====

type StoredModel = { v: number; date: string; nTrain: number; model: RiskModel };

/**
 * today より前の日で学習したモデル。同じ日・同じ学習日数ならキャッシュを返す（1日1回の学習）。
 * 日付が変わる／履歴の長さが変わる（穴埋め・削除）と学習し直す
 */
export async function loadOrFitModel(rows: readonly DayFeature[], today: string): Promise<RiskModel> {
  const history = rows.filter((r) => r.date < today);
  const nTrain = history.filter((r) => labelOf(r) != null).length;
  try {
    const raw = await AsyncStorage.getItem(MODEL_KEY);
    if (raw) {
      const c = JSON.parse(raw) as StoredModel;
      if (c && c.v === MODEL_V && c.date === today && c.nTrain === nTrain && c.model && Array.isArray(c.model.weights)) return c.model;
    }
  } catch { /* 壊れていれば学習し直す */ }
  const model = fitRiskModel(history);
  try { await AsyncStorage.setItem(MODEL_KEY, JSON.stringify({ v: MODEL_V, date: today, nTrain, model } satisfies StoredModel)); } catch { /* 次回また学習するだけ */ }
  return model;
}

export async function readOutcomes(): Promise<AlertOutcome[]> {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(OUTCOMES_KEY)) || '[]');
    return Array.isArray(v) ? (v as AlertOutcome[]) : [];
  } catch { return []; }
}

async function writeOutcomes(list: AlertOutcome[]): Promise<void> {
  try { await AsyncStorage.setItem(OUTCOMES_KEY, JSON.stringify(list)); } catch { /* 次回また */ }
}

/** 過去のアラートの結果を今日のラベル表で埋めて保存し、最新の一覧を返す（食事タブを開くたびに1回） */
export async function syncOutcomes(rows: readonly DayFeature[], today: string): Promise<AlertOutcome[]> {
  const next = resolveOutcomes(await readOutcomes(), rows, today);
  await writeOutcomes(next);
  return next;
}

/** 今日アラートを出したことを記録する（1日1件・段が上がれば上書き） */
export async function recordAlert(today: string, tier: 'nudge' | 'warning', p: number): Promise<AlertOutcome[]> {
  const next = upsertOutcome(await readOutcomes(), { date: today, tier, p: Math.round(p * 1000) / 1000, outcome: null });
  await writeOutcomes(next);
  return next;
}

export async function readCravingSnoozed(today: string): Promise<boolean> {
  try { return (await AsyncStorage.getItem(CRAVING_SNOOZE_KEY)) === today; } catch { return false; }
}
export async function writeCravingSnooze(today: string): Promise<void> {
  try { await AsyncStorage.setItem(CRAVING_SNOOZE_KEY, today); } catch { /* 閉じられないだけ */ }
}
