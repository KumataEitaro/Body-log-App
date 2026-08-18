// HealthKit連携（@kingstinct/react-native-healthkit のラッパー）
// Expo Goにはネイティブモジュールが無いため、動的requireで存在しない環境でも
// アプリ全体を落とさない（dev client / TestFlightビルドでのみ有効になる）。
import { supabase } from './supabase';
import { syncEntriesForDate } from './sync';

type HK = typeof import('@kingstinct/react-native-healthkit');

const hk: HK | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@kingstinct/react-native-healthkit') as HK;
  } catch {
    return null; // Expo Go等・モジュール未リンク
  }
})();

export function healthAvailable(): boolean {
  try { return hk != null && hk.isHealthDataAvailable(); } catch { return false; }
}

const READ_TYPES = [
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierStepCount',
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKWorkoutTypeIdentifier',
] as const;

export async function requestHealthAuth(): Promise<boolean> {
  if (!hk) return false;
  try {
    return await hk.requestAuthorization({ toRead: READ_TYPES as unknown as readonly never[] });
  } catch { return false; }
}

function dateKeyJST(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d); // YYYY-MM-DD
}

// 体重の過去分をヘルスケア→entriesへ取込（日ごとの最終値・既存の体重は上書きしない）
export async function importWeights(uid: string, days: number): Promise<{ imported: number } | { error: string }> {
  if (!hk) return { error: 'この機能はTestFlight版でのみ使えます（Expo Goでは動きません）。' };
  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const samples = await hk.queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', {
      unit: 'kg', limit: -1, ascending: true,
      filter: { date: { startDate: start, endDate: end } },
    });
    // 日ごとの最終値
    const byDate = new Map<string, number>();
    for (const s of samples) byDate.set(dateKeyJST(new Date(s.startDate)), Math.round(Number(s.quantity) * 10) / 10);
    if (byDate.size === 0) return { imported: 0 };
    // 既にentriesに体重がある日は尊重（アプリ手入力を正とする）
    const { data: existing } = await supabase.from('entries')
      .select('date,weight').in('date', [...byDate.keys()]);
    const has = new Set((existing || []).filter((e: { weight: number | null }) => e.weight != null).map((e: { date: string }) => e.date));
    const rows = [...byDate.entries()].filter(([d]) => !has.has(d))
      .map(([date, weight]) => ({ user_id: uid, date, weight }));
    if (rows.length === 0) return { imported: 0 };
    const { error } = await supabase.from('entries').upsert(rows, { onConflict: 'user_id,date' });
    if (error) return { error: '保存に失敗しました。もう一度お試しください。' };
    return { imported: rows.length };
  } catch {
    return { error: 'ヘルスケアの読み取りに失敗しました。許可設定を確認してください。' };
  }
}

// ===== ワークアウト取込（Apple Watch等の運動記録→logsへ） =====
export type HKWorkout = {
  id: string;        // HealthKitのUUID（source_idとして重複排除に使う）
  date: string;      // JST日付
  name: string;      // 種目名（日本語）
  minutes: number;
  km: number | null;
  kcal: number;      // アクティブ消費カロリー
};

// HKWorkoutActivityTypeの主要値→日本語名（それ以外は「ワークアウト」）
const WORKOUT_NAMES: Record<string, string> = {
  '37': 'ランニング', '52': 'ウォーキング', '13': '自転車', '46': '水泳',
  '50': '筋トレ', '20': 'サーキットトレーニング', '57': 'ヨガ', '24': 'ハイキング',
  '35': 'ピラティス', '16': 'クロストレーニング', '63': 'HIIT', '3000': 'ワークアウト',
  running: 'ランニング', walking: 'ウォーキング', cycling: '自転車', swimming: '水泳',
  traditionalStrengthTraining: '筋トレ', functionalStrengthTraining: 'サーキットトレーニング',
  yoga: 'ヨガ', hiking: 'ハイキング', pilates: 'ピラティス',
  crossTraining: 'クロストレーニング', highIntensityIntervalTraining: 'HIIT',
};

// 直近days日のワークアウト一覧（取込プレビュー用）
export async function listWorkouts(days: number): Promise<HKWorkout[] | { error: string }> {
  if (!hk) return { error: 'この機能はTestFlight版でのみ使えます（Expo Goでは動きません）。' };
  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyHk = hk as any;
    const list = await anyHk.queryWorkoutSamples({
      limit: -1, ascending: false, filter: { date: { startDate: start, endDate: end } },
    });
    const out: HKWorkout[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const w of (list || []) as any[]) {
      const minutes = Math.round(Number(w.duration ?? 0) / 60);
      if (minutes <= 0) continue;
      const kcal = Math.round(Number(w.totalEnergyBurned?.quantity ?? 0));
      const distRaw = Number(w.totalDistance?.quantity ?? 0);
      const unit = String(w.totalDistance?.unit ?? 'm');
      const km = distRaw > 0 ? Math.round((unit === 'km' ? distRaw : distRaw / 1000) * 100) / 100 : null;
      const t = String(w.workoutActivityType ?? '');
      out.push({
        id: String(w.uuid ?? `${w.startDate}-${t}`),
        date: dateKeyJST(new Date(w.startDate)),
        name: WORKOUT_NAMES[t] ?? 'ワークアウト',
        minutes, km, kcal,
      });
    }
    return out;
  } catch {
    return { error: 'ワークアウトの読み取りに失敗しました。許可設定を確認してください。' };
  }
}

// 選択したワークアウトをlogsへ登録（source_id=hk:UUIDで二重登録を自動スキップ）
export async function importWorkouts(uid: string, items: HKWorkout[]): Promise<{ imported: number; skipped: number } | { error: string }> {
  let imported = 0;
  let skipped = 0;
  const dates = new Set<string>();
  for (const w of items) {
    const base = {
      user_id: uid, date: w.date, items: [], kcal: null, p: null, f: null, c: null,
      weight: null, ex: 'オフ', adj: w.kcal, mood: '',
      text: `🏃 ${w.name} ${w.minutes}分${w.km ? ` ${w.km}km` : ''}（約${w.kcal}kcal消費）⌚`, photo_urls: [],
    };
    let { error } = await supabase.from('logs')
      .insert({ ...base, ex_minutes: w.minutes, ex_km: w.km, source_id: `hk:${w.id}` });
    if (error && /ex_minutes|ex_km|source_id|column|schema/i.test(error.message)) {
      ({ error } = await supabase.from('logs').insert(base)); // v17未適用DBフォールバック（重複排除なし）
    }
    if (error) {
      if (/duplicate|unique|23505/i.test(error.message)) { skipped++; continue; } // 取込済み
      return { error: '保存に失敗しました。もう一度お試しください。' };
    }
    imported++;
    dates.add(w.date);
  }
  for (const d of dates) await syncEntriesForDate(uid, d); // 日次サマリー（目標kcal連動）へ反映
  return { imported, skipped };
}

// 直近days日の歩数（日別合計）と睡眠時間（日別h）— 表示用サマリー
export type HealthDaySummary = { date: string; steps: number; sleepH: number };

export async function readActivitySummary(days: number): Promise<HealthDaySummary[] | { error: string }> {
  if (!hk) return { error: 'この機能はTestFlight版でのみ使えます（Expo Goでは動きません）。' };
  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const filter = { date: { startDate: start, endDate: end } };
    const [steps, sleep] = await Promise.all([
      hk.queryQuantitySamples('HKQuantityTypeIdentifierStepCount', { unit: 'count', limit: -1, ascending: true, filter }),
      hk.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', { limit: -1, ascending: true, filter }),
    ]);
    const map = new Map<string, HealthDaySummary>();
    const get = (d: string) => {
      let v = map.get(d);
      if (!v) { v = { date: d, steps: 0, sleepH: 0 }; map.set(d, v); }
      return v;
    };
    for (const s of steps) get(dateKeyJST(new Date(s.startDate))).steps += Number(s.quantity);
    for (const s of sleep) {
      // value: 0=inBed / 1,3,4,5=asleep系（asleepUnspecified/Core/Deep/REM）。inBedは除外
      if (Number(s.value) === 0) continue;
      const st = new Date(s.startDate).getTime();
      const en = new Date(s.endDate).getTime();
      // 睡眠は「起きた日」に計上（JSTで終了時刻の日付）
      get(dateKeyJST(new Date(en))).sleepH += Math.max(0, en - st) / 3600000;
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((v) => ({ ...v, steps: Math.round(v.steps), sleepH: Math.round(v.sleepH * 10) / 10 }));
  } catch {
    return { error: 'ヘルスケアの読み取りに失敗しました。許可設定を確認してください。' };
  }
}
