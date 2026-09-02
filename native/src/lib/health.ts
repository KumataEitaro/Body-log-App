// HealthKit連携（@kingstinct/react-native-healthkit のラッパー）
// Expo Goにはネイティブモジュールが無いため、動的requireで存在しない環境でも
// アプリ全体を落とさない（dev client / TestFlightビルドでのみ有効になる）。
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { syncEntriesForDate } from './sync';
import { t } from '@/lib/i18n';
import {
  HEALTH_LINKED_KEY, HEALTH_PREFER_MANUAL_WEIGHT_KEY, HEALTH_LAST_SYNC_KEY,
  BACKGROUND_DELIVERY_TYPES, BACKGROUND_DELIVERY_FREQUENCY,
  resolveLinkState, needsReauth, decideWeightImport, latestPerDay, weightSourceId, isHealthKitSource, changeKindOf,
  type HealthLinkState,
} from './healthLink';
import { setHealthLinkState, setHealthLastSync, bumpHealthVersion, healthStoreState } from './healthStore';

type HK = typeof import('@kingstinct/react-native-healthkit');

const hk: HK | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@kingstinct/react-native-healthkit') as HK;
  } catch {
    return null; // Expo Go等・モジュール未リンク
  }
})();

// HealthKitはiOS専用。Androidでは常に false（Health Connectは将来検討）。
// hk自体はAndroidでもimportできてしまう（ダミー実装）ので、OSで先に切る
export function healthAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
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

// ===== 連携状態（1か所で判定・全画面はこれだけを見る） =====
// 「連携済み」は AsyncStorage 'bl-health-linked'。初回の requestAuthorization が成功した時点で立て、
// 以後は二度と「ヘルスケアと連携する」ボタンを出さない（iOSは許可/拒否を教えないので、
// 「ダイアログを一度出した」＝連携済み、と定義する。拒否した人は設定アプリで直す導線のみ）。
let linkedFlag = false;
let linkLoaded = false;

/** 連携状態。loadHealthLink() 前は 'unlinked' 扱い（起動直後の一瞬だけ） */
export function healthLinkState(): HealthLinkState {
  return resolveLinkState(healthAvailable(), linkedFlag);
}

/** 起動時に一度呼ぶ（_layout）。保存済みのフラグと最終同期時刻をストアへ載せる */
export async function loadHealthLink(): Promise<HealthLinkState> {
  try {
    const [v, ls] = await Promise.all([
      AsyncStorage.getItem(HEALTH_LINKED_KEY),
      AsyncStorage.getItem(HEALTH_LAST_SYNC_KEY),
    ]);
    linkedFlag = v === '1';
    const n = Number(ls);
    if (Number.isFinite(n) && n > 0) setHealthLastSync(n);
  } catch { /* 読めなければ未連携扱い（ボタンが出るだけ・壊れない） */ }
  linkLoaded = true;
  const st = healthLinkState();
  setHealthLinkState(st, true);
  return st;
}

async function markLinked(): Promise<void> {
  linkedFlag = true;
  setHealthLinkState(healthLinkState(), linkLoaded);
  try { await AsyncStorage.setItem(HEALTH_LINKED_KEY, '1'); } catch { /* 次回また聞かれるだけ */ }
}

/**
 * 許可ダイアログを出す（低レベル）。成功したら連携済みフラグを立てる。
 * 通常の画面からは linkHealth() / ensureHealthAuth() を使う。
 */
export async function requestHealthAuth(): Promise<boolean> {
  if (!hk || !healthAvailable()) return false;
  try {
    const ok = await hk.requestAuthorization({ toRead: READ_TYPES as unknown as readonly never[] });
    if (ok) await markLinked();
    return ok;
  } catch { return false; }
}

/**
 * 「ヘルスケアと連携する」ボタンの唯一の入口。許可→フラグ→購読・バックグラウンド配信の開始→
 * 初回の体重取り込み、まで一気に済ませる。以後はユーザー操作なしで全項目が自動同期される。
 */
export async function linkHealth(): Promise<boolean> {
  const ok = await requestHealthAuth();
  if (!ok) return false;
  await startHealthAutoSync();
  return true;
}

/**
 * 読み取り前の許可確認。連携済みなら何もしない（iOSは一度聞いた型については
 * requestAuthorization を呼んでもダイアログを出さないが、呼ぶだけ無駄なので省く）。
 * 未連携なら linkHealth() と同じ（ここが実質の初回連携になる）。
 */
export async function ensureHealthAuth(): Promise<boolean> {
  if (!healthAvailable()) return false;
  if (linkedFlag) return true;
  return linkHealth();
}

/**
 * READ_TYPES に型を足した後の既存ユーザー向け: 追加ぶんの許可ダイアログを起動時に自動で出す。
 * getRequestStatusForAuthorization が shouldRequest のときだけ requestAuthorization を再呼び出し。
 * iOSは既に聞いた型のダイアログは出さないので、未処理の型ぶんだけが1回出る（毎回は出ない）。
 */
export async function reauthIfNeeded(): Promise<boolean> {
  if (!hk || !healthAvailable() || !linkedFlag) return false;
  try {
    const st = await hk.getRequestStatusForAuthorization({ toRead: READ_TYPES as unknown as readonly never[] });
    if (!needsReauth(Number(st))) return false;
    await hk.requestAuthorization({ toRead: READ_TYPES as unknown as readonly never[] });
    return true;
  } catch { return false; }
}

/** 「連携を見直す」: iOSの設定アプリ（BodyLogerのページ）を開く。ヘルスケアの許可はそこから辿れる */
export function openHealthSettings(): void {
  Linking.openSettings().catch(() => {});
}

// ===== 体重は手入力を優先（設定トグル・既定OFF） =====
let preferManualWeight = false;
export async function loadPreferManualWeight(): Promise<boolean> {
  try { preferManualWeight = (await AsyncStorage.getItem(HEALTH_PREFER_MANUAL_WEIGHT_KEY)) === '1'; } catch { /* 既定OFF */ }
  return preferManualWeight;
}
export function getPreferManualWeight(): boolean { return preferManualWeight; }
export async function setPreferManualWeight(on: boolean): Promise<void> {
  preferManualWeight = on;
  try { await AsyncStorage.setItem(HEALTH_PREFER_MANUAL_WEIGHT_KEY, on ? '1' : '0'); } catch { /* 次回起動で既定に戻るだけ */ }
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
// ヘルスケア側の変更イベント（healthStore.version）が来たらTTL内でも捨てる＝
// 「数値が変わったきっかけで更新」を実現しつつ、変化が無いあいだは一切読み直さない
const ACTIVE_TTL_MS = 15 * 60 * 1000;
let activeCache: { days: number; at: number; ver: number; data: ActiveEnergyDay[] | null } | null = null;
let activeInflight: Promise<ActiveEnergyDay[] | null> | null = null;

/** readActiveEnergyのキャッシュ付き版（同時呼び出しは1本の読み取りに合流させる） */
export async function readActiveEnergyCached(days = 14): Promise<ActiveEnergyDay[] | null> {
  const now = Date.now();
  const ver = healthStoreState().version;
  if (activeCache && activeCache.days >= days && activeCache.ver === ver && now - activeCache.at < ACTIVE_TTL_MS) return activeCache.data;
  if (activeInflight) return activeInflight;
  activeInflight = (async () => {
    const data = await readActiveEnergy(days);
    activeCache = { days, at: Date.now(), ver, data };
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

// =====================================================================
// 自動同期（変更イベント駆動・バックグラウンド配信・体重の自動取り込み）
// =====================================================================
//
// ■ 方針
// 「一度連携したら、以後は全項目を自動で取り込む。定時ではなく、ヘルスケア側の数値が
// 変わったきっかけで更新する」（熊田さん要望）。
//   前景: subscribeToChanges（HKObserverQuery）を READ_TYPES 全種に張り、コールバックで
//         キャッシュを無効化→healthStore の世代を上げる→各画面の読み込みeffectが再実行。
//   背景: configureBackgroundTypes（＝AppDelegate起動時にネイティブ側が HKObserverQuery を
//         再登録＋enableBackgroundDelivery）。アプリが終了していてもiOSが起こしてくれる。
//         起こされたら JS が起動→startHealthAutoSync→体重の取り込みまで済ませる。通知は出さない。
//
// ■ 頻度は hourly（immediate にしない）
// immediate はサンプルが書かれるたびに起床し、歩数のように数分おきに書かれる型では
// 電池を明確に食う。加えて審査で「バックグラウンド起床の必要性」を問われやすい。
// 体重・睡眠は1日1〜2回しか変わらないので hourly で十分、歩数・アクティブは前景で
// 開いた瞬間に observer が即時に鳴るため、背景側は「アプリを開かない日の体重取り込み」だけ
// 拾えればよい。iOS自体も background delivery は最短 hourly 相当に丸めることがある。
//
// ■ 対象の型
// 背景配信は歩数・アクティブ・体重・睡眠の4種。ワークアウトは手動取込のまま（勝手に
// logs へ運動記録を増やすと「アプリに記録した運動」との二重計上を本人が制御できない）。
let autoSyncStarted = false;
let subscriptions: { remove: () => void }[] = [];
let weightImportInflight: Promise<void> | null = null;

async function touchLastSync(): Promise<void> {
  const now = Date.now();
  setHealthLastSync(now);
  try { await AsyncStorage.setItem(HEALTH_LAST_SYNC_KEY, String(now)); } catch { /* 表示だけの値 */ }
}

/** 現在のログインユーザー（無ければnull）。体重取り込みの user_id に使う */
async function currentUid(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch { return null; }
}

/**
 * 変更イベント1件の処理。キャッシュ無効化→世代更新→（体重なら）取り込み。
 * 画面側の再読込は世代更新で自動的に走るので、ここで個別に何かを読みはしない。
 */
async function onHealthChange(typeIdentifier: string): Promise<void> {
  const kind = changeKindOf(typeIdentifier);
  if (kind === 'active' || kind === 'steps' || kind === 'workout') invalidateActiveEnergyCache();
  bumpHealthVersion(kind);
  if (kind === 'weight') {
    const uid = await currentUid();
    if (uid) await importWeightsAuto(uid, 7).catch(() => {});
  }
  touchLastSync().catch(() => {});
}

/**
 * 連携済みなら購読とバックグラウンド配信を開始する（起動時・連携直後に呼ぶ。二重起動は無視）。
 * 未連携・非対応環境では何もしない（Androidは healthAvailable() が false なので全て no-op）。
 */
export async function startHealthAutoSync(): Promise<void> {
  if (!hk || !healthAvailable()) return;
  if (!linkLoaded) await loadHealthLink();
  if (!linkedFlag) return;
  loadPreferManualWeight().catch(() => {});
  // READ_TYPES に型を足していたら、ここで追加ぶんの許可を（ユーザー操作なしで）取り直す
  const reasked = await reauthIfNeeded();
  if (reasked) invalidateActiveEnergyCache();

  if (!autoSyncStarted) {
    autoSyncStarted = true;
    // 前景の変更購読（HKObserverQuery）。型ごとに1本・アプリ生存中ずっと張っておく
    for (const id of READ_TYPES) {
      try {
        const sub = hk.subscribeToChanges(id as never, (args) => {
          if (args?.errorMessage) return;   // 権限なし等。黙って次のイベントを待つ
          onHealthChange(String(args?.typeIdentifier ?? id)).catch(() => {});
        });
        subscriptions.push(sub);
      } catch { /* 型が無い旧iOS等。その型は購読しない */ }
    }
    // バックグラウンド配信（hourly）。types と frequency は UserDefaults に保存され、
    // 次回以降のコールドローンチで AppDelegate（config plugin が差し込む
    // BackgroundDeliveryManager.setupBackgroundObservers）が再登録する。
    // entitlement com.apple.developer.healthkit.background-delivery が必須（app.json）
    try {
      await hk.configureBackgroundTypes([...BACKGROUND_DELIVERY_TYPES], BACKGROUND_DELIVERY_FREQUENCY as never);
    } catch { /* 旧ビルド（entitlement無し）では失敗する。前景購読だけで動く */ }
  }

  // 起動直後の取り込み（背景起床のときはこれが本体）。直近7日の体重の差分を entries へ
  const uid = await currentUid();
  if (uid) await importWeightsAuto(uid, 7).catch(() => {});
  bumpHealthVersion('other');   // 起動時に各画面のキャッシュを一度はほどく
  touchLastSync().catch(() => {});
}

/** 購読を全部外す（ログアウト時など）。バックグラウンド配信の設定は残す（連携そのものは恒久） */
export function stopHealthAutoSync(): void {
  for (const s of subscriptions) { try { s.remove(); } catch { /* 既に外れている */ } }
  subscriptions = [];
  autoSyncStarted = false;
}

/**
 * 体重の自動取り込み（確認なし）。直近days日の HealthKit 体重を日ごとの最終値にまとめ、
 * lib/healthLink.ts decideWeightImport の規則で entries へ反映する。
 *   - 取り込みは logs に 'hk:bm:<日付>' の1行として書く（1日1行・更新で上書き）。
 *     entries.weight は logs→summarizeDay の合流点（syncEntriesForDate）で決まるので、
 *     entries を直接書くと次の食事記録で消えてしまう。logs 経由なら手入力と同じ土俵に乗る。
 *   - 手入力（source_id が hk: でない体重ログ）がある日は、設定「手入力を優先」ON なら触らず、
 *     OFF でも HealthKit の計測時刻が新しいときだけ上書きする。
 *   - source_id 列が無い旧DB（v17未適用）は entries を直接 upsert する旧経路へフォールバック。
 * 同時呼び出し（起動時＋変更イベントが重なる）は1本に合流させる。
 */
export async function importWeightsAuto(uid: string, days: number): Promise<void> {
  if (weightImportInflight) return weightImportInflight;
  weightImportInflight = (async () => {
    if (!hk || !healthAvailable() || !linkedFlag) return;
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    let samples: readonly { quantity: number; startDate: Date }[];
    try {
      samples = await hk.queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', {
        unit: 'kg', limit: -1, ascending: true,
        filter: { date: { startDate: start, endDate: end } },
      });
    } catch { return; }
    const perDay = latestPerDay(
      samples.map((s) => ({ kg: Math.round(Number(s.quantity) * 10) / 10, at: new Date(s.startDate).getTime() })),
      (at) => dateKeyJST(new Date(at)),
    );
    if (perDay.size === 0) return;
    const dates = [...perDay.keys()];
    // 同日の体重ログ（手入力・取込済みの両方）を1回で引く
    const { data: existingRaw, error: selErr } = await supabase.from('logs')
      .select('id,date,at,weight,source_id').in('date', dates).not('weight', 'is', null);
    if (selErr && /source_id|column|schema/i.test(selErr.message)) {
      // 旧DB: 重複排除の列が無いので、既存値を尊重する旧ロジック（importWeights）に任せる
      await importWeights(uid, days).catch(() => {});
      return;
    }
    const existing = (existingRaw ?? []) as { id: string; date: string; at: string; weight: number; source_id: string | null }[];
    const touched = new Set<string>();
    for (const [date, hkv] of perDay) {
      const rows = existing.filter((r) => r.date === date);
      const manualRows = rows.filter((r) => !isHealthKitSource(r.source_id))
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      const manual = manualRows.length
        ? { kg: Number(manualRows[manualRows.length - 1].weight), at: new Date(manualRows[manualRows.length - 1].at).getTime() }
        : null;
      const importedRow = rows.find((r) => r.source_id === weightSourceId(date)) ?? null;
      const imported = importedRow ? { kg: Number(importedRow.weight), at: new Date(importedRow.at).getTime() } : null;
      const decision = decideWeightImport({ hk: hkv, manual, imported, preferManual: preferManualWeight });
      if (decision !== 'write') continue;
      const at = new Date(hkv.at).toISOString();
      if (importedRow) {
        const { error } = await supabase.from('logs').update({ weight: hkv.kg, at }).eq('id', importedRow.id);
        if (error) continue;
      } else {
        const { error } = await supabase.from('logs').insert({
          user_id: uid, date, at, items: [], kcal: null, p: null, f: null, c: null,
          weight: hkv.kg, ex: 'オフ', adj: 0, mood: '', text: '', photo_urls: [],
          source_id: weightSourceId(date),
        });
        if (error) {
          if (/source_id|column|schema/i.test(error.message)) { await importWeights(uid, days).catch(() => {}); return; }
          continue;
        }
      }
      touched.add(date);
    }
    for (const d of touched) await syncEntriesForDate(uid, d).catch(() => {});
    if (touched.size > 0) bumpHealthVersion('weight');
  })().finally(() => { weightImportInflight = null; });
  return weightImportInflight;
}
