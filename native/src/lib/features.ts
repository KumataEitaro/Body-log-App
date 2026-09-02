// 日次特徴量ストア（インサイト・エンジン §1・docs/INSIGHTS-ENGINE.md）
//
// すべての相関分析の土台。**1日＝1行**の特徴ベクトルを端末内で組み立て、AsyncStorage
// 'bl-day-features' にキャッシュする。生データ（entries / logs / HealthKit / cycle_logs）は
// それぞれの場所に既にあるので、ここは**派生値だけ**を持つ。
//
// 設計:
//  ・派生は純関数 deriveDayFeatures(raw) に閉じる（テスト対象）。取得と保存は buildDayFeatures が担う
//  ・系列は「窓の全日」を密に持つ（記録が無い日も recorded=false の行を置く）。ラグ相関や
//    「前日の◯◯」は配列の添字 = 日付差 で引けるほうが間違えにくい
//  ・差分更新: 睡眠ステージだけは日ごとの HealthKit 読取（1日=1クエリ）で重いため、
//    キャッシュに無い日と直近2日だけ読み直し、あとはキャッシュの値を引き継ぐ。他の列は
//    90日ぶんの再計算が数msで済むので毎回組み直す（正しさを優先）
//  ・数値の意味は必ずコメントに書く（相関エンジン側で閾値を決めるときの根拠になる）
//  ・端末内で完結する（サーバへは何も送らない）
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { todayJST, mifflinBMR, targetKcal, type ExLevel } from './calc';
import { moodScore } from './bingeAnalysis';
import { parseLiftText, volumeOf, effectiveKg } from './liftLog';
import { epley1RM } from './rm';
import { healthAvailable, readActivitySummary, readSleepStages } from './health';
import { isCycleEnabled, listCycleStarts, cycleDay, isWaterRetentionWindow } from './cycle';
import { sumTagGrams, FOOD_TAGS, type FoodTag } from '@/content/foodTags';

// ===== 型 =====

/** 食べた時間の8区分（§4）。早朝4–7 / 朝7–10 / 午前10–12 / 昼12–14 / 午後14–17 / 夕17–20 / 夜20–23 / 深夜23–4 */
export const TIME_SLOTS = ['dawn', 'morning', 'forenoon', 'noon', 'afternoon', 'evening', 'night', 'midnight'] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

export function timeSlotIndex(hour: number): number {
  if (hour >= 4 && hour < 7) return 0;
  if (hour >= 7 && hour < 10) return 1;
  if (hour >= 10 && hour < 12) return 2;
  if (hour >= 12 && hour < 14) return 3;
  if (hour >= 14 && hour < 17) return 4;
  if (hour >= 17 && hour < 20) return 5;
  if (hour >= 20 && hour < 23) return 6;
  return 7;   // 23〜翌4時
}

/** 1日ぶんの特徴量。null＝その日の値が無い（未記録・未連携）。0 と null を混ぜない */
export type DayFeature = {
  date: string;              // YYYY-MM-DD（JST）
  recorded: boolean;         // 食事 or 体重 or ログのどれかがある日
  // --- 食（entries / logs） ---
  intake: number | null;     // 摂取kcal
  target: number | null;     // 目安kcal（BMR×活動係数＋運動加算。changes.tsxと同じ式）
  over: number | null;       // 摂取−目安（+超過 / −赤字）
  binge: boolean;            // 食べすぎ日: over ≥ +800 または intake > 2,500（§1の定義。insights.isBingeDay の400より厳しい）
  protein_g: number | null;  // たんぱく質g
  meal_count: number;        // 食事ログの件数（運動ログは数えない）
  late_eating: number | null;// 21時以降のkcal比（0–1）。時刻つきkcalが無い日はnull
  time_slots: number[];      // 8区分のkcalシェア（合計1。時刻つきkcalが無い日は全0）
  // --- 食材（content/foodTags の辞書マッチ・推定g） ---
  wheat_g: number; rice_g: number; chicken_g: number; salmon_g: number; fish_g: number; dairy_g: number;
  sugar_drink: number;       // 甘い飲み物の推定ml
  // --- 体（entries） ---
  weight: number | null;
  weight_delta7: number | null; // 7日前（±3日で最も近い記録）との差kg
  mood: number | null;       // 1–5（bingeAnalysis.moodScore）
  mood_avg3: number | null;  // 直近3日（当日含む）の平均。2日以上の記録があるときだけ
  // --- 睡眠（HealthKit・「起きた日」に計上） ---
  sleep_h: number | null;
  sleep_debt5: number | null;// 直近5日の Σmax(0, 7h − sleep_h)。5日のうち3日以上の睡眠データがあるときだけ
  deep_min: number | null;
  rem_min: number | null;
  // --- 動（HealthKit / 🏋️ログ） ---
  steps: number | null;
  active_kcal: number | null;
  lift_volume_kg: number;    // その日の総挙上量（自重種目はその日の体重で換算）
  lift_sessions: number;     // 🏋️ログの件数（0=トレなし）
  e1rm_delta: number | null; // その日の主要種目（最大ボリューム種目）の推定1RM − 窓内のそれまでの最高。履歴が無ければnull
  pr: boolean;               // どれかの種目で推定1RMが窓内の過去最高を上回った（自己ベスト更新）
  // --- 周期（cycle.ts・生理周期ON時のみ） ---
  cycle_day: number | null;
  water_window: boolean;     // 月経開始の3日前〜開始後3日
};

/** deriveDayFeatures への入力。DB行から機械的に組める形（純関数テストのため） */
export type FeatureRaw = {
  today: string;                                             // YYYY-MM-DD
  days: number;                                              // 窓の長さ（今日を含む）
  entries: { date: string; intake: number | null; p: number | null; weight: number | null; mood: string | null; target: number | null }[];
  logs: { date: string; at: string | null; text: string | null; items: { name?: string; qty?: string; kcal?: number }[] | null }[];
  health: { date: string; steps: number; sleepH: number; activeKcal: number }[];
  stages: { date: string; deepMin: number; remMin: number }[];
  cycleStarts: string[];
  cycleEnabled: boolean;
};

// ===== 閾値（意味は各コメントに） =====
export const BINGE_OVER = 800;        // 超過+800kcal以上を「食べすぎ」（§1）
export const BINGE_INTAKE = 2500;     // 摂取2,500kcal超も「食べすぎ」（目安が高い人でも絶対量で拾う）
export const SLEEP_GOAL_H = 7;        // 睡眠負債の基準（成人の推奨下限7h・AASM/SRS 2015）
const DEBT_MIN_DAYS = 3;              // 5日のうち睡眠データがこれ未満なら負債は出さない（過小評価を避ける）
const MOOD_AVG_MIN = 2;               // 3日平均は2日以上の記録があるときだけ

// ===== 日付ユーティリティ =====
export function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** JSTの時(0-23)。itemLog.hourJST と同じ計算 */
function hourJST(at: string | null | undefined): number | null {
  if (!at) return null;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + 9 * 3600_000).getUTCHours();
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 全列が「値なし」の1行（テストや部分的な組み立ての土台） */
export function emptyDayFeature(date: string): DayFeature {
  return {
    date, recorded: false,
    intake: null, target: null, over: null, binge: false, protein_g: null, meal_count: 0, late_eating: null, time_slots: new Array(8).fill(0),
    wheat_g: 0, rice_g: 0, chicken_g: 0, salmon_g: 0, fish_g: 0, dairy_g: 0, sugar_drink: 0,
    weight: null, weight_delta7: null, mood: null, mood_avg3: null,
    sleep_h: null, sleep_debt5: null, deep_min: null, rem_min: null,
    steps: null, active_kcal: null, lift_volume_kg: 0, lift_sessions: 0, e1rm_delta: null, pr: false,
    cycle_day: null, water_window: false,
  };
}

// ===== 派生（純関数） =====

/**
 * 生データ → 窓の全日の特徴量（昇順・密）。
 * ローリング値（mood_avg3 / sleep_debt5 / weight_delta7 / e1rm_delta）は窓の先頭で履歴が
 * 足りないぶんは null になる（分析側は null を「不明」として除外する）
 */
export function deriveDayFeatures(raw: FeatureRaw): DayFeature[] {
  const days = Math.max(1, Math.round(raw.days));
  const start = shiftDate(raw.today, -(days - 1));
  const rows: DayFeature[] = [];
  const index = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = shiftDate(start, i);
    index.set(d, i);
    rows.push(emptyDayFeature(d));
  }
  const at = (d: string) => { const i = index.get(d); return i == null ? null : rows[i]; };

  // --- entries: 食・体 ---
  for (const e of raw.entries) {
    const r = at(e.date);
    if (!r) continue;
    r.intake = e.intake == null ? null : Number(e.intake);
    r.target = e.target == null ? null : Number(e.target);
    r.protein_g = e.p == null ? null : Number(e.p);
    r.weight = e.weight == null ? null : Number(e.weight);
    r.mood = moodScore(e.mood);
    if (r.intake != null && r.target != null) r.over = Math.round(r.intake - r.target);
    r.binge = (r.over != null && r.over >= BINGE_OVER) || (r.intake != null && r.intake > BINGE_INTAKE);
    if (r.intake != null || r.weight != null) r.recorded = true;
  }

  // --- logs: 食事の件数・時間帯・食材、🏋️の量 ---
  // 体重は「その日以前の直近」で引く（自重種目の換算。毎日測る人ばかりではない）
  const weightAt = (d: string): number | null => {
    const i = index.get(d);
    if (i == null) return null;
    for (let k = i; k >= 0; k--) if (rows[k].weight != null) return rows[k].weight;
    return null;
  };
  const timedKcal = new Map<string, number[]>();       // date → 8区分のkcal
  const dayItems = new Map<string, { name?: string; qty?: string }[]>();
  // 推定1RMの「窓内のそれまでの最高」（種目名 → kg）。日付順に流すため logs を日付で並べる
  const sortedLogs = [...raw.logs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const bestSoFar = new Map<string, number>();
  let curDate = '';
  let dayBest = new Map<string, { e1rm: number; volume: number }>();
  const flushDay = () => {
    if (!curDate) return;
    const r = at(curDate);
    if (r && dayBest.size > 0) {
      let mainLift: string | null = null; let mainVol = -1;
      for (const [name, v] of dayBest) {
        if (v.volume > mainVol) { mainVol = v.volume; mainLift = name; }
        const prev = bestSoFar.get(name);
        if (prev != null && v.e1rm > prev + 0.05) r.pr = true;   // 丸め誤差ぶんの余裕
      }
      if (mainLift) {
        const prev = bestSoFar.get(mainLift);
        r.e1rm_delta = prev == null ? null : r1(dayBest.get(mainLift)!.e1rm - prev);
      }
      for (const [name, v] of dayBest) bestSoFar.set(name, Math.max(bestSoFar.get(name) ?? 0, v.e1rm));
    }
    dayBest = new Map();
  };
  for (const l of sortedLogs) {
    const r = at(l.date);
    if (!r) continue;
    r.recorded = true;
    const text = String(l.text ?? '');
    if (text.startsWith('🏋️')) {
      if (l.date !== curDate) { flushDay(); curDate = l.date; }
      const w = weightAt(l.date);
      const entries = parseLiftText(text);
      if (entries.length === 0) continue;
      r.lift_sessions += 1;
      for (const e of entries) {
        const vol = volumeOf(e, w);
        r.lift_volume_kg += vol;
        const e1 = epley1RM(effectiveKg(e, w), e.reps);
        const cur = dayBest.get(e.name) ?? { e1rm: 0, volume: 0 };
        dayBest.set(e.name, { e1rm: Math.max(cur.e1rm, e1), volume: cur.volume + vol });
      }
      continue;
    }
    if (text.startsWith('🏃')) continue;   // 運動ログ（adjはentriesの目安に既に反映済み）
    const items = l.items ?? [];
    if (items.length === 0) continue;
    r.meal_count += 1;
    const list = dayItems.get(l.date) ?? [];
    for (const it of items) list.push({ name: it?.name, qty: it?.qty });
    dayItems.set(l.date, list);
    const hour = hourJST(l.at);
    if (hour != null) {
      const kcal = items.reduce((a, it) => a + Math.max(0, Number(it?.kcal) || 0), 0);
      if (kcal > 0) {
        const arr = timedKcal.get(l.date) ?? new Array(8).fill(0);
        arr[timeSlotIndex(hour)] += kcal;
        timedKcal.set(l.date, arr);
      }
    }
  }
  flushDay();
  for (const r of rows) {
    r.lift_volume_kg = Math.round(r.lift_volume_kg);
    const items = dayItems.get(r.date);
    if (items) {
      const g = sumTagGrams(items);
      for (const tag of FOOD_TAGS) setTag(r, tag, g[tag]);
    }
    const tk = timedKcal.get(r.date);
    if (tk) {
      const total = tk.reduce((a, b) => a + b, 0);
      if (total > 0) {
        r.time_slots = tk.map((v) => Math.round((v / total) * 1000) / 1000);
        // 21時以降 = 夜(20–23)のうち21時以降＋深夜。区分が20時起点なので「夜＋深夜」で近似する
        // （既存 timeslot 法則の slotOf は21時起点。ここでは §4 の8区分に合わせる）
        r.late_eating = Math.round(((tk[6] + tk[7]) / total) * 1000) / 1000;
      }
    }
  }

  // --- HealthKit ---
  for (const h of raw.health) {
    const r = at(h.date);
    if (!r) continue;
    r.steps = Math.round(Number(h.steps) || 0);
    r.active_kcal = Math.round(Number(h.activeKcal) || 0);
    r.sleep_h = h.sleepH > 0 ? r1(h.sleepH) : null;
  }
  for (const s of raw.stages) {
    const r = at(s.date);
    if (!r) continue;
    r.deep_min = Math.round(s.deepMin);
    r.rem_min = Math.round(s.remMin);
  }

  // --- 周期（ON時のみ。OFFなら一切触らない＝null/false のまま） ---
  if (raw.cycleEnabled && raw.cycleStarts.length > 0) {
    for (const r of rows) {
      r.cycle_day = cycleDay(raw.cycleStarts, r.date);
      r.water_window = isWaterRetentionWindow(raw.cycleStarts, r.date);
    }
  }

  // --- ローリング値 ---
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // mood_avg3: 当日含む3日のうち2日以上に記録があるときだけ
    const moods: number[] = [];
    for (let k = Math.max(0, i - 2); k <= i; k++) if (rows[k].mood != null) moods.push(rows[k].mood as number);
    if (moods.length >= MOOD_AVG_MIN) r.mood_avg3 = r1(moods.reduce((a, b) => a + b, 0) / moods.length);
    // sleep_debt5: 直近5日（当日含む）の 7h からの不足の累計。データが3日未満なら不明
    let debt = 0; let have = 0;
    for (let k = Math.max(0, i - 4); k <= i; k++) {
      const s = rows[k].sleep_h;
      if (s == null) continue;
      have += 1;
      debt += Math.max(0, SLEEP_GOAL_H - s);
    }
    if (have >= DEBT_MIN_DAYS) r.sleep_debt5 = r1(debt);
    // weight_delta7: 7日前を中心に ±3日で最も近い記録との差
    if (r.weight != null) {
      let ref: number | null = null; let bestGap = 99;
      for (let off = 4; off <= 10; off++) {
        const k = i - off;
        if (k < 0) break;
        const w = rows[k].weight;
        if (w == null) continue;
        const gap = Math.abs(off - 7);
        if (gap < bestGap) { bestGap = gap; ref = w; }
      }
      if (ref != null) r.weight_delta7 = r1(r.weight - ref);
    }
  }

  return rows;
}

function setTag(r: DayFeature, tag: FoodTag, g: number): void {
  switch (tag) {
    case 'wheat': r.wheat_g = g; break;
    case 'rice': r.rice_g = g; break;
    case 'chicken': r.chicken_g = g; break;
    case 'salmon': r.salmon_g = g; break;
    case 'fish': r.fish_g = g; break;
    case 'dairy': r.dairy_g = g; break;
    case 'sugar_drink': r.sugar_drink = g; break;
  }
}

/** 直近n日のサマリ（AI相談の dataBlock・§6 用）。値が無い項目は null */
export function summarizeRecent(rows: DayFeature[], n = 7): {
  days: number; recordedDays: number; sleepAvg: number | null; moodAvg: number | null; stepsAvg: number | null;
  overDays: number; bingeDays: number; liftDays: number;
} {
  const recent = rows.slice(-n);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const sleep = avg(recent.map((r) => r.sleep_h));
  const mood = avg(recent.map((r) => r.mood));
  const steps = avg(recent.map((r) => r.steps));
  return {
    days: recent.length,
    recordedDays: recent.filter((r) => r.recorded).length,
    sleepAvg: sleep == null ? null : r1(sleep),
    moodAvg: mood == null ? null : r1(mood),
    stepsAvg: steps == null ? null : Math.round(steps),
    overDays: recent.filter((r) => r.over != null && r.over > 0).length,
    bingeDays: recent.filter((r) => r.binge).length,
    liftDays: recent.filter((r) => r.lift_sessions > 0).length,
  };
}

// ===== 取得＋キャッシュ =====

const CACHE_KEY = 'bl-day-features';
const CACHE_V = 1;                       // 列を増やしたら上げる（古いキャッシュを捨てる）
const TTL_MS = 15 * 60 * 1000;           // 同じ日の中は15分は組み直さない（相談・図鑑・ハイライトが同じ値を欲しがる）
const STAGE_READS_MAX = 14;              // 1回の構築で読む睡眠ステージの日数上限（1日=1クエリなので）
const STAGE_REFRESH_DAYS = 2;            // 直近2日はキャッシュがあっても読み直す（当日の睡眠は後から増える）

type Cache = { v: number; builtAt: number; today: string; days: number; rows: DayFeature[] };

let mem: Cache | null = null;
let inflight: Promise<DayFeature[]> | null = null;
let dirty = false;

async function readCache(): Promise<Cache | null> {
  if (mem) return mem;
  try {
    const c = JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) || 'null') as Cache | null;
    if (c && c.v === CACHE_V && Array.isArray(c.rows)) { mem = c; return c; }
  } catch { /* 壊れていれば作り直す */ }
  return null;
}

/** キャッシュだけを返す（通信も HealthKit も触らない。相談の送信直前など「いまある値」で足りる場面用） */
export async function readCachedDayFeatures(): Promise<DayFeature[]> {
  const c = await readCache();
  return c?.rows ?? [];
}

/** 食事や体重を保存したあとに呼ぶ（次の buildDayFeatures で必ず組み直す） */
export function invalidateDayFeatures(): void {
  dirty = true;
}

type ProfileRow = { sex: 'male' | 'female'; height_cm: number; age: number; init_weight: number | null; life_factor: number };
type EntryRow = { date: string; intake: number | null; p: number | null; weight: number | null; mood: string | null; ex: string | null; adj: number | null };
type LogRow = { date: string; at: string | null; text: string | null; items: { name?: string; qty?: string; kcal?: number }[] | null };

/** entries / logs / HealthKit / cycle を1回ずつ読んで FeatureRaw を組む（未ログインは null） */
async function fetchRaw(today: string, days: number, cachedStages: Map<string, { deepMin: number; remMin: number }>): Promise<FeatureRaw | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const from = shiftDate(today, -(days - 1));
  const [profRes, entRes, logRes, cycleOn] = await Promise.all([
    supabase.from('profiles').select('sex,height_cm,age,init_weight,life_factor').eq('id', session.user.id).maybeSingle(),
    supabase.from('entries').select('date,intake,p,weight,mood,ex,adj').gte('date', from).order('date', { ascending: true }).limit(1000),
    supabase.from('logs').select('date,at,text,items').gte('date', from).order('date', { ascending: true }).limit(3000),
    isCycleEnabled(),
  ]);
  const prof = profRes.data as ProfileRow | null;
  const entries = (entRes.data ?? []) as EntryRow[];
  const logs = (logRes.data ?? []) as LogRow[];

  // 目安kcal: changes.tsx / laws.ts と同じ式（BMR×活動係数＋運動加算adj）。プロフィール無しなら目安は出せない
  let w = Number(prof?.init_weight) || 70;
  const rawEntries: FeatureRaw['entries'] = entries.map((e) => {
    if (e.weight != null) w = Number(e.weight);
    let target: number | null = null;
    if (prof) {
      const bmr = mifflinBMR(prof.sex, w, Number(prof.height_cm), Number(prof.age));
      target = targetKcal(bmr, Number(prof.life_factor), (e.ex as ExLevel) || 'オフ', Number(e.adj) || 0);
    }
    return { date: e.date, intake: e.intake == null ? null : Number(e.intake), p: e.p == null ? null : Number(e.p),
      weight: e.weight == null ? null : Number(e.weight), mood: e.mood, target };
  });

  // HealthKit（hk無し環境・未許可・失敗は空＝睡眠/歩数の列が null になるだけ）
  let health: FeatureRaw['health'] = [];
  const stages: FeatureRaw['stages'] = [];
  try {
    if (healthAvailable()) {
      const r = await readActivitySummary(days);
      if (!('error' in r)) health = r;
      // 睡眠ステージ: キャッシュに無い日＋直近2日だけ読む（差分更新）。上限14日/回
      const sleptDates = health.filter((h) => h.sleepH > 0).map((h) => h.date).sort().reverse();
      let reads = 0;
      for (const d of sleptDates) {
        const cached = cachedStages.get(d);
        const recent = d >= shiftDate(today, -(STAGE_REFRESH_DAYS - 1));
        if (cached && !recent) { stages.push({ date: d, ...cached }); continue; }
        if (reads >= STAGE_READS_MAX) { if (cached) stages.push({ date: d, ...cached }); continue; }
        reads += 1;
        const st = await readSleepStages(d);
        if (st) stages.push({ date: d, deepMin: Math.round(st.deepH * 60), remMin: Math.round(st.remH * 60) });
        else if (cached) stages.push({ date: d, ...cached });
      }
    }
  } catch { /* 健康データはベストエフォート */ }

  let cycleStarts: string[] = [];
  if (cycleOn) {
    try { cycleStarts = (await listCycleStarts()).map((c) => c.start_date); } catch { /* 未作成テーブル等は空 */ }
  }

  return { today, days, entries: rawEntries, logs, health, stages, cycleStarts, cycleEnabled: cycleOn };
}

/**
 * 日次特徴量（昇順・密・days日ぶん）。
 * キャッシュが今日のもので15分以内・invalidate されていなければそのまま返す。
 * 同時呼び出しは1本の構築に合流させる（health.readActiveEnergyCached と同じ流儀）。
 * 未ログインや取得失敗時はキャッシュ（あれば）を返す＝呼び出し側は空配列にも耐えること
 */
export async function buildDayFeatures(days = 90, opts?: { force?: boolean }): Promise<DayFeature[]> {
  const today = todayJST();
  const cache = await readCache();
  const fresh = cache && cache.today === today && cache.days >= days && Date.now() - cache.builtAt < TTL_MS;
  if (cache && fresh && !dirty && !opts?.force) return cache.rows.slice(-days);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const cachedStages = new Map<string, { deepMin: number; remMin: number }>();
      for (const r of cache?.rows ?? []) if (r.deep_min != null || r.rem_min != null) cachedStages.set(r.date, { deepMin: r.deep_min ?? 0, remMin: r.rem_min ?? 0 });
      const raw = await fetchRaw(today, days, cachedStages);
      if (!raw) return cache?.rows ?? [];
      const rows = deriveDayFeatures(raw);
      const next: Cache = { v: CACHE_V, builtAt: Date.now(), today, days, rows };
      mem = next;
      dirty = false;
      try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* 次回また組む */ }
      return rows;
    } catch {
      return cache?.rows ?? [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
