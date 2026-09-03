// N1「今日の予定ヒアリング（朝の1問）＋プラン動的再配分」（docs/STRATEGY.md §6朝・§7 N1）
//
// 戦略のどのゲートに効くか:
//   ③次の行動が分かる … 「夜に飲み会がある」と分かっていれば、昼の判断が変わる。
//     残量を一律に3等分するのではなく、イベントに枠を確保して残りを朝昼へ配る。
//   ④成長実感 … 予定を先に言えば「守れる計画」になる。守れた日が積み上がる。
//   ⑤明日開く理由 … 朝にアプリが1問だけ聞き、その答えでその日のプランが変わる。
//     「聞かれたから答える」ではなく「答えると今日が楽になる」体験にする。
//
// 【設計方針】
//  - **サーバー不要**: 予定は端末内の見込みであって記録ではない。AsyncStorage `bl-day-plan:<date>` に置き、
//    7日より古いキーは掃除する。AIにも渡さない（端末内の算術で完結＝コスト0）。
//  - **質問攻めにしない**: 1日1回・朝の窓（起床時刻〜＋5時間・設定で変えられる）に1問だけ。
//    外食/飲み会を選んだときだけ2問目（時刻）を許可。
//    答えたら即カードは畳む。「聞かないで」で以後この質問を出さない（`bl-day-plan-ask-off`）。
//  - **嘘の緩和を作らない**: チートデイ（lib/goal.ts requiredDailyWithEvents で既に吸収済み）が
//    登録されている日は再配分を出さない。二重に緩めた数字は「食べていい」の嘘になる。
//  - **二重計上しない**: トレーニング予定は「見込み」。実際の運動記録が入った日は予定側を無効にする
//    （既存の activeKcalGoalBonus / dayExerciseKcal と足し合わさらないように）。
//
// 純関数（この下半分）と端末保存（上半分）を分け、判断のロジックは全部テストできる形にする。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseHm } from './timeSlots';
import { WAKE_DEFAULT_HM, isMorningWindow, type Hm } from './wakeTime';

// ===== モデル =====

/** 今日の予定の種類。'none'＝「予定はない」と本人が答えた状態（未回答とは区別する） */
export type DayPlanKind = 'eatout' | 'drink' | 'workout' | 'none';

export type DayPlan = {
  kind: DayPlanKind;
  /** イベントの時刻 'H:mm'（外食・飲み会で2問目に答えたときだけ入る） */
  at?: string;
  /** イベントの想定kcal（外食/飲み会）または想定消費kcal（トレーニング） */
  estKcal?: number;
};

/** イベント想定kcalの既定値。±チップで調整できる（EST_STEP刻み・EST_MIN〜EST_MAX） */
export const EST_DEFAULT: Record<DayPlanKind, number> = {
  eatout: 800,
  drink: 1000,
  workout: 300,   // 消費側の見込み（EX_ADD「高」400より控えめ＝盛らない）
  none: 0,
};
export const EST_STEP = 100;
export const EST_MIN = 100;
export const EST_MAX = 2500;

/** 2問目「何時ごろ？」のプリセット。夕食〜飲み会の現実的な帯だけ出す（時刻ピッカーで任意の時刻も選べる） */
export const AT_PRESETS: readonly string[] = ['18:00', '19:00', '20:00', '21:00'];

/** 想定kcalを刻みと範囲に丸める（打ち間違い・チップ連打で非現実的な数字を作らせない） */
export function clampEst(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n / EST_STEP) * EST_STEP;
  return Math.max(EST_MIN, Math.min(EST_MAX, r));
}

/** イベント想定kcalの解決（未指定なら種類の既定値）。'none' は常に0 */
export function estKcalOf(plan: DayPlan | null): number {
  if (!plan || plan.kind === 'none') return 0;
  return plan.estKcal != null ? clampEst(plan.estKcal) : EST_DEFAULT[plan.kind];
}

/** 保存値の検証（壊れた値・未知の種類は null＝未回答として扱う。予定は見込みなので取りこぼしを許容する） */
export function validateDayPlan(v: unknown): DayPlan | null {
  if (typeof v !== 'object' || v == null) return null;
  const o = v as Record<string, unknown>;
  const kind = o.kind;
  if (kind !== 'eatout' && kind !== 'drink' && kind !== 'workout' && kind !== 'none') return null;
  const out: DayPlan = { kind };
  if (typeof o.at === 'string' && parseHm(o.at) != null) out.at = o.at;
  if (typeof o.estKcal === 'number' && Number.isFinite(o.estKcal)) out.estKcal = clampEst(o.estKcal);
  return out;
}

// ===== 聞き方（頻度・条件） =====

/**
 * 朝の1問を出す時限。
 *
 * 【2026-09-04 変更】固定の 11 時をやめ、**起床時刻＋MORNING_SPAN_HOURS（5時間）**の窓に置き換えた。
 * 固定時刻だと、5時起きの人は「もう昼前」でもまだ聞かれ、10時起きの人は起きた時点で窓が閉じている。
 * さらに 0:30 に開くと（JSTの日付はもう次の日なので）「今日の予定は？」が深夜に出てしまい、
 * 本人の体感ではまだ「昨日の夜」なので答えられない＝1日1回の質問を無駄に消費していた。
 * 起床時刻に紐づけると、早起きの人は早く閉じ、遅起きの人は遅くまで聞ける（生活リズムの個人差に追従）。
 *
 * @deprecated 参照しないこと（旧実装の名残・既定値の説明用に残置）。判定は `shouldAskPlan` が
 *             lib/wakeTime.ts `isMorningWindow` で行う
 */
export const ASK_UNTIL_HOUR = 11;
/** 2問目（時刻）を聞く対象＝食べる側のイベントだけ。トレーニングに時刻は要らない（消費の見込みだけ足す） */
export function needsTimeQuestion(kind: DayPlanKind): boolean {
  return kind === 'eatout' || kind === 'drink';
}

export type AskInput = {
  /** 表示中の日付が今日か（過去日に「今日の予定」を聞かない） */
  isToday: boolean;
  /** 現在の時（0-23） */
  hour: number;
  /** 現在の分（0-59・省略時0）。起床時刻が 7:30 のように15分刻みなので分まで見る */
  minute?: number;
  /** 起床時刻（省略時は既定 7:00）。ここから MORNING_SPAN_HOURS の間だけ聞く */
  wake?: Hm;
  /** すでに今日の予定に答えているか */
  answered: boolean;
  /** 「聞かないで」を選んだか */
  askOff: boolean;
  /** その日にチートデイが登録済みか（既存の吸収と衝突するので聞かない＝再配分もしない） */
  hasCheatDay: boolean;
};

/**
 * 朝の1問を出すか。**1日1回・朝の窓（起床時刻〜＋5時間）・今日だけ**。
 * 答えた／「聞かないで」／チートデイ登録済み／過去日 のいずれでも出さない。
 *
 * 窓を起床時刻に紐づけている理由は ASK_UNTIL_HOUR のコメント参照。
 * `isMorningWindow` は日付を跨ぐ形で判定するので、起床23:00 の夜勤の人でも 23:00〜翌4:00 に聞ける。
 */
export function shouldAskPlan(i: AskInput): boolean {
  if (!i.isToday) return false;
  if (i.answered || i.askOff) return false;
  if (i.hasCheatDay) return false;
  if (!Number.isFinite(i.hour)) return false;
  const now: Hm = { h: i.hour, m: Number.isFinite(i.minute) ? Number(i.minute) : 0 };
  return isMorningWindow(now, i.wake ?? WAKE_DEFAULT_HM);
}

// ===== 二重計上・衝突の判定（ここが嘘を作らない止め金） =====

export type PlanEffectInput = {
  plan: DayPlan | null;
  /** その日にチートデイ（PlanEvent）が登録済みか */
  hasCheatDay: boolean;
  /** その日にすでに記録された運動の消費kcal（dayExerciseKcal + アクティブ上乗せ） */
  recordedExerciseKcal: number;
};

/** 予定が「いま効いているか」と、効いていない理由 */
export type PlanEffect = {
  active: boolean;
  reason: 'ok' | 'none' | 'cheatDay' | 'alreadyLogged';
};

/**
 * 予定を再配分に使ってよいかを1か所で決める（純関数）。
 *  - `cheatDay`: チートデイが登録済みの日は既に requiredDailyWithEvents が緩めている。
 *    その上に予定の再配分を重ねると二重の緩和＝嘘になるので、予定は効かせない。
 *  - `alreadyLogged`: トレーニング予定は「見込み」。実際の運動記録が入ったら（=1kcalでも）
 *    その実測が既に目標kcalへ入っているので、予定側は無効にする（二重計上しない）。
 *    食べる側の予定（外食・飲み会）は運動記録とは独立なので影響しない。
 */
export function planEffect(i: PlanEffectInput): PlanEffect {
  const p = i.plan;
  if (!p || p.kind === 'none') return { active: false, reason: 'none' };
  if (i.hasCheatDay) return { active: false, reason: 'cheatDay' };
  if (p.kind === 'workout' && Math.round(i.recordedExerciseKcal) > 0) {
    return { active: false, reason: 'alreadyLogged' };
  }
  return { active: true, reason: 'ok' };
}

// ===== 再配分 =====

/** イベント前の時間帯か・イベント中／後か。'before' の間だけ「いまは約{n}kcalまで」を出す */
export type PlanSlot = 'before' | 'after';

export type Redistribution = {
  /** イベント前に使える分（朝昼の合計） */
  beforeEvent: number;
  /** イベントのために確保した分 */
  forEvent: number;
  /** イベント後に残る分（通常0。トレーニングは上乗せぶんがここに乗る） */
  afterEvent: number;
  /** いま食べてよい上限（nowSlot='before' なら beforeEvent、'after' なら残り全部） */
  nowLimit: number;
  /** 再配分の対象になった予定の種類（'none'＝再配分なし） */
  kind: DayPlanKind;
};

/**
 * 今日の配分を予定に応じて組み替える（純関数）。
 *
 *  外食・飲み会:
 *    forEvent    = min(イベント想定kcal, 残量)           ← 残量より大きい枠は作れない
 *    beforeEvent = max(残量 − forEvent, 0)               ← 残りを朝昼に配る
 *    afterEvent  = 0
 *    ヒーロー下の1行は「夜に約{forEvent}kcal残す → いまは約{beforeEvent}kcalまで」
 *
 *  トレーニング:
 *    消費の見込みぶん食べられる量が増える。イベントの枠は作らない。
 *    beforeEvent = 残量、afterEvent = 想定消費、forEvent = 0
 *    （実記録が入った日は planEffect が無効化するので、呼び出し側はそこで plan=null を渡す）
 *
 * @param allowance いまの残量kcal（ヒーローの `left`）。マイナス（超過）でも壊れない
 * @param plan      今日の予定（null / 'none' なら再配分なし）
 * @param nowSlot   イベント前か後か
 */
export function redistribute(allowance: number, plan: DayPlan | null, nowSlot: PlanSlot = 'before'): Redistribution {
  const left = Math.round(Number.isFinite(allowance) ? allowance : 0);
  if (!plan || plan.kind === 'none') {
    return { beforeEvent: Math.max(left, 0), forEvent: 0, afterEvent: 0, nowLimit: left, kind: 'none' };
  }
  const est = estKcalOf(plan);
  if (plan.kind === 'workout') {
    // 運動ぶんは「食べ戻せる量」。超過中（left<0）でも見込みぶんは足す（それが運動の意味）
    return { beforeEvent: Math.max(left, 0), forEvent: 0, afterEvent: est, nowLimit: left + est, kind: 'workout' };
  }
  const forEvent = Math.max(0, Math.min(est, Math.max(left, 0)));
  const beforeEvent = Math.max(left - forEvent, 0);
  return {
    beforeEvent, forEvent, afterEvent: 0,
    nowLimit: nowSlot === 'before' ? beforeEvent : Math.max(left, 0),
    kind: plan.kind,
  };
}

/**
 * 「いまはイベント前か後か」。予定の時刻（未回答なら19時とみなす）と現在の時で決める。
 * 分は見ない（1時間単位で足りる。境界の1分で表示が入れ替わる意味はない）
 */
export function slotForPlan(plan: DayPlan | null, hour: number): PlanSlot {
  if (!plan || !needsTimeQuestion(plan.kind)) return 'before';
  const hm = plan.at ? parseHm(plan.at) : null;
  const eventHour = hm ? hm.h : 19;
  const h = Number.isFinite(hour) ? hour : 0;
  return h < eventHour ? 'before' : 'after';
}

// ===== 端末保存（AsyncStorage） =====

export const PLAN_KEY_PREFIX = 'bl-day-plan:';
export const PLAN_ASK_OFF_KEY = 'bl-day-plan-ask-off';
/** 予定を残す日数。過ぎた日の見込みに価値は無いので7日で掃除する */
export const PLAN_KEEP_DAYS = 7;

export function planKeyOf(dateISO: string): string { return `${PLAN_KEY_PREFIX}${dateISO}`; }

/** キー名（'bl-day-plan:2026-09-03'）から日付を取り出す。形が違えば null */
export function dateOfPlanKey(key: string): string | null {
  if (!key.startsWith(PLAN_KEY_PREFIX)) return null;
  const d = key.slice(PLAN_KEY_PREFIX.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * 掃除の対象キーを決める（純関数）。`todayISO` から PLAN_KEEP_DAYS 日より古い予定キーだけ返す。
 * 未来日（旅行の予定を先に入れた等）は消さない
 */
export function stalePlanKeys(keys: string[], todayISO: string, keepDays = PLAN_KEEP_DAYS): string[] {
  const limit = new Date(todayISO + 'T00:00:00Z').getTime() - keepDays * 86400000;
  return keys.filter((k) => {
    const d = dateOfPlanKey(k);
    if (!d) return false;
    return new Date(d + 'T00:00:00Z').getTime() < limit;
  });
}

export async function readDayPlan(dateISO: string): Promise<DayPlan | null> {
  try {
    const raw = await AsyncStorage.getItem(planKeyOf(dateISO));
    if (!raw) return null;
    return validateDayPlan(JSON.parse(raw));
  } catch { return null; }   // 壊れた値は未回答扱い（朝の1問がもう一度出るだけ）
}

export async function writeDayPlan(dateISO: string, plan: DayPlan | null): Promise<void> {
  try {
    if (plan == null) await AsyncStorage.removeItem(planKeyOf(dateISO));
    else await AsyncStorage.setItem(planKeyOf(dateISO), JSON.stringify(plan));
  } catch { /* 端末保存の失敗は静かに諦める（今日のプランが再配分されないだけ） */ }
}

export async function readAskOff(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(PLAN_ASK_OFF_KEY)) === '1'; } catch { return false; }
}
export async function writeAskOff(off: boolean): Promise<void> {
  try {
    if (off) await AsyncStorage.setItem(PLAN_ASK_OFF_KEY, '1');
    else await AsyncStorage.removeItem(PLAN_ASK_OFF_KEY);
  } catch { /* 同上 */ }
}

/** 7日より古い予定キーを消す（朝の読み込みのついでに1回だけ呼ぶ） */
export async function sweepDayPlans(todayISO: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = stalePlanKeys([...keys], todayISO);
    if (stale.length > 0) await AsyncStorage.multiRemove(stale);
  } catch { /* 掃除の失敗は無害（次回また試す） */ }
}
