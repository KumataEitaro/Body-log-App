// HealthKit連携（@kingstinct/react-native-healthkit のラッパー）
// Expo Goにはネイティブモジュールが無いため、動的requireで存在しない環境でも
// アプリ全体を落とさない（dev client / TestFlightビルドでのみ有効になる）。
import { supabase } from './supabase';
import { syncEntriesForDate } from './sync';
import { t } from '@/lib/i18n';

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
  // アクティブエネルギー（歩行・日常活動を含む実測消費）。歩数だけでは消費kcalが出せず
  // 「1万歩なのに消費0kcal」という不合理な表示になるため読み取り対象に加えた
  'HKQuantityTypeIdentifierActiveEnergyBurned',
] as const;

export async function requestHealthAuth(): Promise<boolean> {
  if (!hk) return false;
  try {
    return await hk.requestAuthorization({ toRead: READ_TYPES as unknown as readonly never[] });
  } catch { return false; }
}

/**
 * アクティブエネルギーの読み取り許可を「まだ聞いていない」か。
 * iOSは読み取りの許可/拒否を（プライバシー保護のため）アプリに教えない。
 * 分かるのは HKAuthorizationRequestStatus だけ:
 *   shouldRequest = まだダイアログを出していない（READ_TYPESに型を足した後の既存ユーザーがここ）
 *   unnecessary   = すでに聞いた（許可・拒否のどちらかは不明。拒否なら再ダイアログは出ない）
 * 戻り値: 'ask'=再要求すればダイアログが出る／'asked'=もう出ない（設定アプリへ案内）／null=判定不能
 */
export async function activeEnergyAuthState(): Promise<'ask' | 'asked' | null> {
  if (!hk) return null;
  try {
    const st = await hk.getRequestStatusForAuthorization({
      toRead: ['HKQuantityTypeIdentifierActiveEnergyBurned'] as unknown as readonly never[],
    });
    // enum: 0=unknown 1=shouldRequest 2=unnecessary（@kingstinct/react-native-healthkit v14）
    if (Number(st) === 1) return 'ask';
    if (Number(st) === 2) return 'asked';
    return null;
  } catch { return null; }
}

function dateKeyJST(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d); // YYYY-MM-DD
}

// 体重の過去分をヘルスケア→entriesへ取込（日ごとの最終値・既存の体重は上書きしない）
export async function importWeights(uid: string, days: number): Promise<{ imported: number } | { error: string }> {
  if (!hk) return { error: t('この機能はTestFlight版でのみ使えます（Expo Goでは動きません）。') };
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
    if (error) return { error: t('保存に失敗しました。もう一度お試しください。') };
    return { imported: rows.length };
  } catch {
    return { error: t('ヘルスケアの読み取りに失敗しました。許可設定を確認してください。') };
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
  '37': t('ランニング'), '52': t('ウォーキング'), '13': t('自転車'), '46': t('水泳'),
  '50': t('筋トレ'), '20': t('サーキットトレーニング'), '57': t('ヨガ'), '24': t('ハイキング'),
  '35': t('ピラティス'), '16': t('クロストレーニング'), '63': 'HIIT', '3000': t('ワークアウト'),
  running: t('ランニング'), walking: t('ウォーキング'), cycling: t('自転車'), swimming: t('水泳'),
  traditionalStrengthTraining: t('筋トレ'), functionalStrengthTraining: t('サーキットトレーニング'),
  yoga: t('ヨガ'), hiking: t('ハイキング'), pilates: t('ピラティス'),
  crossTraining: t('クロストレーニング'), highIntensityIntervalTraining: 'HIIT',
};

// 直近days日のワークアウト一覧（取込プレビュー用）
export async function listWorkouts(days: number): Promise<HKWorkout[] | { error: string }> {
  if (!hk) return { error: t('この機能はTestFlight版でのみ使えます（Expo Goでは動きません）。') };
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
      const wtype = String(w.workoutActivityType ?? '');
      out.push({
        id: String(w.uuid ?? `${w.startDate}-${wtype}`),
        date: dateKeyJST(new Date(w.startDate)),
        name: WORKOUT_NAMES[wtype] ?? t('ワークアウト'),
        minutes, km, kcal,
      });
    }
    return out;
  } catch {
    return { error: t('ワークアウトの読み取りに失敗しました。許可設定を確認してください。') };
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
      return { error: t('保存に失敗しました。もう一度お試しください。') };
    }
    imported++;
    dates.add(w.date);
  }
  for (const d of dates) await syncEntriesForDate(uid, d); // 日次サマリー（目標kcal連動）へ反映
  return { imported, skipped };
}

// 現在のJST時（0-23）。時間帯別チャートで「未来の時間帯」を空にする判定に使う
export function jstHourNow(): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  } catch {
    return new Date().getHours(); // Intl不調時は端末ローカル時で近似
  }
}

// その日の歩数を時間帯別（0-23時・JST）にバケツ分け（ヘルスケア式の棒グラフ用）。
// HealthKitが無い環境（Expo Go / Android）や読み取り失敗はnull（セクションごと出さない）
export async function readHourlySteps(date: string): Promise<number[] | null> {
  if (!hk) return null;
  try {
    const start = new Date(`${date}T00:00:00+09:00`);
    const end = new Date(start.getTime() + 86400000);
    const samples = await hk.queryQuantitySamples('HKQuantityTypeIdentifierStepCount', {
      unit: 'count', limit: -1, ascending: true,
      filter: { date: { startDate: start, endDate: end } },
    });
    const out: number[] = new Array(24).fill(0);
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' });
    for (const s of samples) {
      const h = Number(fmt.format(new Date(s.startDate)));
      if (h >= 0 && h < 24) out[h] += Number(s.quantity);
    }
    return out.map((v) => Math.round(v));
  } catch {
    return null;
  }
}

// ===== 睡眠ステージの内訳（B-14a・ヘルスケアの円グラフ相当） =====
// HKCategoryValueSleepAnalysis の実値（@kingstinct/react-native-healthkit
// src/generated/healthkit.generated.ts の enum CategoryValueSleepAnalysis で確認）:
//   0=inBed / 1=asleepUnspecified(asleep) / 2=awake / 3=asleepCore / 4=asleepDeep / 5=asleepREM
export type SleepStages = { awakeH: number; remH: number; coreH: number; deepH: number };

/**
 * dateの「起きた日」に計上される睡眠のステージ内訳（readActivitySummaryと同じ流儀＝
 * JSTで終了時刻がdateに落ちるサンプルを合算する）。
 * ステージデータが無い端末（Apple Watch無し等・全サンプルがasleepUnspecified）は
 * nullを返し、呼び出し側は合計だけの従来表示のままにする。
 * 1=asleepUnspecifiedはステージ計測があるときだけcore扱いで合算する。
 * HealthKitが無い環境（Expo Go / Android）や読み取り失敗もnull（非表示）。
 */
export async function readSleepStages(date: string): Promise<SleepStages | null> {
  if (!hk) return null;
  try {
    // 「昨夜の睡眠」はdate前日の昼〜date当日中に終わる。前日昼からの窓で十分に覆える
    const end = new Date(`${date}T23:59:59+09:00`);
    const start = new Date(new Date(`${date}T12:00:00+09:00`).getTime() - 86400000);
    const samples = await hk.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
      limit: -1, ascending: true, filter: { date: { startDate: start, endDate: end } },
    });
    const out: SleepStages = { awakeH: 0, remH: 0, coreH: 0, deepH: 0 };
    let staged = false;   // 3/4/5（Core/Deep/REM）が1つでもあればステージ計測あり
    for (const s of samples) {
      const v = Number(s.value);
      if (v === 0) continue;                              // inBedは睡眠ではない
      const en = new Date(s.endDate).getTime();
      if (dateKeyJST(new Date(en)) !== date) continue;    // 「起きた日」に計上（既存流儀）
      const h = Math.max(0, en - new Date(s.startDate).getTime()) / 3600000;
      if (v === 2) out.awakeH += h;
      else if (v === 5) { out.remH += h; staged = true; }
      else if (v === 4) { out.deepH += h; staged = true; }
      else if (v === 3) { out.coreH += h; staged = true; }
      else if (v === 1) out.coreH += h;                   // unspecifiedはcore扱い
    }
    if (!staged) return null;   // ステージ計測が無い（unspecifiedだけ）＝従来の合計表示に任せる
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return { awakeH: r2(out.awakeH), remH: r2(out.remH), coreH: r2(out.coreH), deepH: r2(out.deepH) };
  } catch {
    return null;
  }
}

// ===== アクティブカロリー（HKQuantityTypeIdentifierActiveEnergyBurned） =====
export type ActiveEnergyDay = { date: string; kcal: number };

/**
 * 直近days日のアクティブエネルギー（日別合計kcal・JST）。
 * 「アクティブ」は安静時代謝を超えて消費したぶんの実測で、歩行や日常活動も含む
 * （＝1万歩なら数百kcalになる）。HealthKitが無い環境（Expo Go / Android）や
 * 読み取り失敗はnull（呼び出し側は従来の手記録ぶんだけの表示にする）。
 * readHourlySteps / readSleepStages と同じ流儀。
 */
export async function readActiveEnergy(days: number): Promise<ActiveEnergyDay[] | null> {
  if (!hk) return null;
  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const samples = await hk.queryQuantitySamples('HKQuantityTypeIdentifierActiveEnergyBurned', {
      unit: 'kcal', limit: -1, ascending: true,
      filter: { date: { startDate: start, endDate: end } },
    });
    const map = new Map<string, number>();
    for (const s of samples) {
      const d = dateKeyJST(new Date(s.startDate));
      map.set(d, (map.get(d) ?? 0) + Math.max(0, Number(s.quantity) || 0));
    }
    return [...map.entries()]
      .map(([date, kcal]) => ({ date, kcal: Math.round(kcal) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  } catch {
    return null;
  }
}

// アクティブカロリーの読み取りキャッシュ。
// 「きょうの動き」「食事タブのヒーロー」「概要の歩数・睡眠」の3か所が同じ値を欲しがるので、
// 画面ごと・レンダーごとにHealthKitへ問い合わせるとムダが大きい。
// 過去日の値は変わらないが今日のぶんは動き続けるため、丸1日固定はしない
// （TTL内は同じ値を配り、TTLを過ぎた最初の1回だけ読み直す＝実質1日数回）。
const ACTIVE_TTL_MS = 15 * 60 * 1000;
let activeCache: { days: number; at: number; data: ActiveEnergyDay[] | null } | null = null;
let activeInflight: Promise<ActiveEnergyDay[] | null> | null = null;

/** readActiveEnergyのキャッシュ付き版（同時呼び出しは1本の読み取りに合流させる） */
export async function readActiveEnergyCached(days = 14): Promise<ActiveEnergyDay[] | null> {
  const now = Date.now();
  if (activeCache && activeCache.days >= days && now - activeCache.at < ACTIVE_TTL_MS) return activeCache.data;
  if (activeInflight) return activeInflight;
  activeInflight = (async () => {
    const data = await readActiveEnergy(days);
    activeCache = { days, at: Date.now(), data };
    return data;
  })().finally(() => { activeInflight = null; });
  return activeInflight;
}

/** 運動を記録した直後など、次の読み取りで必ず取り直したいときに呼ぶ */
export function invalidateActiveEnergyCache(): void {
  activeCache = null;
}

// 直近days日の歩数（日別合計）と睡眠時間（日別h）とアクティブkcal — 表示用サマリー
export type HealthDaySummary = { date: string; steps: number; sleepH: number; activeKcal: number };

export async function readActivitySummary(days: number): Promise<HealthDaySummary[] | { error: string }> {
  if (!hk) return { error: t('この機能はTestFlight版でのみ使えます（Expo Goでは動きません）。') };
  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const filter = { date: { startDate: start, endDate: end } };
    const [steps, sleep, active] = await Promise.all([
      hk.queryQuantitySamples('HKQuantityTypeIdentifierStepCount', { unit: 'count', limit: -1, ascending: true, filter }),
      hk.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', { limit: -1, ascending: true, filter }),
      // アクティブkcalはキャッシュ経由（食事タブのヒーローも同じ値を使う＝読み取りは1本に集約）
      readActiveEnergyCached(Math.max(days, 14)),
    ]);
    const map = new Map<string, HealthDaySummary>();
    const get = (d: string) => {
      let v = map.get(d);
      if (!v) { v = { date: d, steps: 0, sleepH: 0, activeKcal: 0 }; map.set(d, v); }
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
    // アクティブkcalはキャッシュの都合で窓より長い期間を持つことがあるため、
    // この呼び出しの期間（start以降）だけを取り込む＝返す日数が勝手に増えない
    const minDate = dateKeyJST(start);
    for (const a of active ?? []) {
      if (a.date < minDate) continue;
      get(a.date).activeKcal = a.kcal;
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((v) => ({ ...v, steps: Math.round(v.steps), sleepH: Math.round(v.sleepH * 10) / 10 }));
  } catch {
    return { error: t('ヘルスケアの読み取りに失敗しました。許可設定を確認してください。') };
  }
}
