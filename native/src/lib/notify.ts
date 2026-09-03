// ローカル通知（リマインダー）: 記録リマインダー・週1体写真(日曜19:00)・チートデイ前日(20:00)・
// 食間リマインド(増量向け・最後の食事から5時間後)
// Expo Goでは動作が制限されるため全て安全に失敗する（TestFlight/dev clientで完全動作）
//
// 記録リマインダーは3モード:
//  - smart（既定）: その日なにか記録していれば通知しない。単発通知を14日ぶん先まで積み、
//    記録が入った瞬間に「今日のぶん」だけ取り消す（ローカル通知は配信時に条件分岐できないため）。
//    14日ひらかないと自動で静かになる＝離れた人を追いかけて責めない（L4思想）
//  - always: 毎日決まった時刻に必ず（習慣のアンカーとして使う人向け）
//  - off
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { t } from './i18n';
import { todayJST } from './calc';
import { supabase } from './supabase';
// purpose→notifyの依存は一方向（purposeはnotifyをimportしない）なので循環しない。
// sync.ts→notify.tsの既存依存もそのまま（notifyからsyncはimportしない）
import { getPurpose } from './purpose';
// 起床時刻は「未選択時の既定値の算出」にだけ使う（wakeTime は notify を import しないので循環しない）
import { WAKE_DEFAULT_HM, WAKE_TIME_KEY, defaultReminderHour, wakeOrDefault } from './wakeTime';

const IDS_KEY = 'bl-notif-ids';         // { daily?: string; weekly?: string }
const SMART_KEY = 'bl-notif-smart-ids'; // { 'YYYY-MM-DD': notificationId }
const MODE_KEY = 'bl-notif-daily-mode'; // 'off' | 'smart' | 'always'
const TIME_KEY = 'bl-notif-daily-time'; // 'HH:00'
const SMART_HORIZON = 14;               // smartで先積みする日数
const GAP_PREF_KEY = 'bl-notif-gap';    // 食間リマインド設定 '1' | '0'
const GAP_ID_KEY = 'bl-notif-gap-id';   // 予約中の食間通知ID（予約し直す前にキャンセルする）

// 記録リマインダーのアクションボタン（iOSの長押し/引き下げで出る）
const DAILY_CATEGORY = 'bl-daily';
const ACTION_LATER_2H = 'bl-later-2h';     // あとで（2時間後）
const ACTION_SKIP_TODAY = 'bl-skip-today'; // 今日は聞かないで

export type DailyReminderMode = 'off' | 'smart' | 'always';

export async function ensureNotifPermission(): Promise<boolean> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return !!req.granted;
  } catch { return false; }
}

async function getIds(): Promise<Record<string, string>> {
  try { return JSON.parse((await AsyncStorage.getItem(IDS_KEY)) || '{}'); } catch { return {}; }
}
async function setIds(ids: Record<string, string>) {
  await AsyncStorage.setItem(IDS_KEY, JSON.stringify(ids)).catch(() => {});
}

async function cancel(key: string) {
  const ids = await getIds();
  if (ids[key]) {
    try { await Notifications.cancelScheduledNotificationAsync(ids[key]); } catch { /* 無視 */ }
    delete ids[key];
    await setIds(ids);
  }
}

// ===== 記録リマインダー =====

// 文言は日替わりでローテ（毎日同じ文だと3日で「見えない通知」になる）。トーンは責めない
const REMINDER_COPY = () => [
  { title: t('今日の記録、忘れていませんか？'), body: t('食べたものを1行書くだけでOK。続けるほどAIのアドバイスが賢くなります。') },
  { title: t('今日はどんな1日でしたか？'), body: t('夜のうちに1行だけ。思い出せるうちがいちばん正確です。') },
  { title: t('1行だけ、今日を残しませんか？'), body: t('完璧じゃなくて大丈夫。ざっくり書けばAIが数えます。') },
  { title: t('今日のごはん、なんでしたか？'), body: t('つぶやくだけで記録になります。写真1枚でもOK。') },
];

/**
 * 記録リマインダーの設定（モード・時刻）。
 *
 * 【2026-09-04】**未選択のときの既定値だけ**、設定「起床時刻」から算出する
 * （`defaultReminderHour` = 起床＋14時間＝寝る少し前。既定7:00なら21:00で従来と完全に一致）。
 * すでに本人が時刻を選んでいる場合は**絶対に上書きしない**。夜勤の人が「起床時刻より前の時刻」を
 * 選んでいても、それは本人の生活では正しい時刻なので警告も出さない（勝手な最適化はしない）。
 */
export async function getDailyReminderPrefs(): Promise<{ mode: DailyReminderMode; hour: number }> {
  try {
    const kv = await AsyncStorage.multiGet([MODE_KEY, TIME_KEY, 'bl-notif-daily', WAKE_TIME_KEY]);
    let mode = kv[0]?.[1] as DailyReminderMode | null;
    if (mode !== 'off' && mode !== 'smart' && mode !== 'always') {
      // 旧トグル('1'/'0')からの移行。ONだった人は「記録がない日だけ」へ
      // （全部入力した日にも鳴るのが不満の起点だったため、賢い方を新既定にする）
      mode = kv[2]?.[1] === '1' ? 'smart' : 'off';
    }
    const fallback = defaultReminderHour(wakeOrDefault(kv[3]?.[1]));
    const stored = kv[1]?.[1];
    if (stored == null) return { mode, hour: fallback };
    const hour = Number(String(stored).split(':')[0]);
    return { mode, hour: hour >= 0 && hour <= 23 ? hour : fallback };
  } catch { return { mode: 'off', hour: defaultReminderHour(WAKE_DEFAULT_HM) }; }
}

async function getSmartIds(): Promise<Record<string, string>> {
  try { return JSON.parse((await AsyncStorage.getItem(SMART_KEY)) || '{}'); } catch { return {}; }
}

async function cancelSmartAll(): Promise<void> {
  const map = await getSmartIds();
  for (const id of Object.values(map)) {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch { /* 無視 */ }
  }
  await AsyncStorage.setItem(SMART_KEY, '{}').catch(() => {});
}

// 今日すでに何か記録があるか（食事・体重・運動いずれでも「忘れてはいない」）
async function hasLogToday(): Promise<boolean> {
  try {
    const { data } = await supabase.from('logs').select('id').eq('date', todayJST()).limit(1);
    return (data?.length ?? 0) > 0;
  } catch { return false; }
}

/** 設定（モード・時刻）を保存して通知を組み直す。falseなら権限なし */
export async function setDailyReminderPrefs(mode: DailyReminderMode, hour: number): Promise<boolean> {
  await AsyncStorage.multiSet([[MODE_KEY, mode], [TIME_KEY, `${hour}:00`], ['bl-notif-daily', mode === 'off' ? '0' : '1']]).catch(() => {});
  const ok = await applyDailyReminder();
  // 週次レビュー（日曜21:00）は記録リマインダーのモードに従う。offにした瞬間に取り消す
  await scheduleWeeklyReviewNotification().catch(() => {});
  return ok;
}

/** いまの設定どおりに通知を組み直す（起動時・言語変更時・設定変更時に呼ぶ） */
export async function applyDailyReminder(): Promise<boolean> {
  const { mode, hour } = await getDailyReminderPrefs();
  await cancel('daily');
  await cancelSmartAll();
  if (mode === 'off') return true;
  if (!(await ensureNotifPermission())) return false;
  try {
    if (mode === 'always') {
      const id = await Notifications.scheduleNotificationAsync({
        content: { ...REMINDER_COPY()[0], data: { url: 'bodylog://log?quick=1' }, categoryIdentifier: DAILY_CATEGORY },
        // v57からトリガーはtype必須（旧形式{hour,minute,repeats}は例外を投げる）
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute: 0 },
      });
      const ids = await getIds(); ids.daily = id; await setIds(ids);
      return true;
    }
    // smart: 今日から14日ぶんの単発。今日は「時刻を過ぎている」「もう記録がある」ならスキップ
    const copies = REMINDER_COPY();
    const skipToday = await hasLogToday();
    const map: Record<string, string> = {};
    const now = new Date();
    for (let i = 0; i < SMART_HORIZON; i++) {
      const d = new Date(now.getTime() + i * 86400000);
      d.setHours(hour, 0, 0, 0);
      if (d.getTime() <= Date.now()) continue;              // 今日の時刻がもう過ぎている
      if (i === 0 && skipToday) continue;                   // 今日はもう記録済み
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const id = await Notifications.scheduleNotificationAsync({
        content: { ...copies[i % copies.length], data: { url: 'bodylog://log?quick=1' }, categoryIdentifier: DAILY_CATEGORY },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d },
      });
      map[dateKey] = id;
    }
    await AsyncStorage.setItem(SMART_KEY, JSON.stringify(map)).catch(() => {});
    return true;
  } catch { return false; }
}

/** 今日のぶんの記録リマインダーを取り消す。
 *  記録が保存された瞬間（lib/sync）と「今日は聞かないで」から呼ばれる */
export async function skipTodayReminder(): Promise<void> {
  try {
    const map = await getSmartIds();
    const today = todayJST();
    const id = map[today];
    if (!id) return;
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    delete map[today];
    await AsyncStorage.setItem(SMART_KEY, JSON.stringify(map)).catch(() => {});
  } catch { /* Expo Go等では黙って諦める */ }
}

/** 旧API互換（設定画面の旧トグル用に残置していたが、新UIはsetDailyReminderPrefsを使う） */
export async function setDailyLogReminder(on: boolean): Promise<boolean> {
  return setDailyReminderPrefs(on ? 'smart' : 'off', (await getDailyReminderPrefs()).hour);
}

// 毎週日曜19:00「今週の体写真を撮りましょう」
export async function setWeeklyPhotoReminder(on: boolean): Promise<boolean> {
  await cancel('weekly');
  if (!on) return true;
  if (!(await ensureNotifPermission())) return false;
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: t('週1回の体チェック📸'), body: t('同じ場所・同じポーズで1枚。「概要」タブの体の写真から記録できます。') },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: 19, minute: 0 }, // weekday 1=日曜
    });
    const ids = await getIds(); ids.weekly = id; await setIds(ids);
    return true;
  } catch { return false; }
}

// チートデイ前日20:00（単発。イベント登録時に呼ぶ・許可が無ければ静かにスキップ）
export async function scheduleCheatDayEve(dateStr: string): Promise<void> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (!cur.granted) return;
    const d = new Date(`${dateStr}T20:00:00`);
    d.setDate(d.getDate() - 1);
    if (d.getTime() <= Date.now()) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: t('明日はチートデイ🍖'), body: t('今日は普段どおりでOK。明日は罪悪感なく楽しみましょう。前後の日で計画が自動調整されます。') },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d },
    });
  } catch { /* Expo Go等では黙って諦める */ }
}

// ===== 食間リマインド（増量向け・B-3） =====
// 増量の失敗は「食べ過ぎ」ではなく「食べ忘れ」。食事保存のたびに5時間後の単発を
// 予約し直す（＝食べている限り鳴らない・空いたときだけ鳴る）。呼び出し元はlib/sync

/** 食間リマインドの設定を読む（既定はOFF） */
export async function getMealGapEnabled(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(GAP_PREF_KEY)) === '1'; } catch { return false; }
}

/** 予約中の食間通知を取り消す（設定OFF時・予約し直しの前に呼ぶ） */
export async function cancelMealGapReminder(): Promise<void> {
  try {
    const id = await AsyncStorage.getItem(GAP_ID_KEY);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      await AsyncStorage.removeItem(GAP_ID_KEY).catch(() => {});
    }
  } catch { /* Expo Go等では黙って諦める */ }
}

/** 最後の食事から5時間後に食間リマインドを予約し直す。
 *  lastMealAt=その日の最後の食事時刻（sync側が渡す）。同じ食事なら同じ着地時刻に
 *  なるので、体重だけ保存した再同期などで呼ばれてもタイマーは延びない */
export async function rescheduleMealGapReminder(lastMealAt: Date): Promise<void> {
  try {
    // 前回分を必ず消してから判定する（OFFや目的変更で「消すだけ」になるケースも正しく動く）
    await cancelMealGapReminder();
    if (!(await getMealGapEnabled())) return;
    if (getPurpose() !== 'bulk') return;            // 増量目的の人だけ（減量中に「食べろ」は逆効果）
    const cur = await Notifications.getPermissionsAsync();
    if (!cur.granted) return;
    const d = new Date(lastMealAt.getTime() + 5 * 3600000);
    if (d.getTime() <= Date.now()) return;          // 着地がもう過去（古い食事での再同期）
    // 静音時間: 21:30以降〜翌7:00前に着地するなら鳴らさない（就寝を邪魔しない）
    const mins = d.getHours() * 60 + d.getMinutes();
    if (mins >= 21 * 60 + 30 || mins < 7 * 60) return;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: t('そろそろ補給の時間です'),
        body: t('食間が5時間あきました。シェイク1杯でも立派な1食です。'),
        data: { url: 'bodylog://log?quick=1' },     // タップでクイック入力へ（既存ルーティングが処理）
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d },
    });
    await AsyncStorage.setItem(GAP_ID_KEY, id).catch(() => {});
  } catch { /* Expo Go等では黙って諦める */ }
}

// ===== 週次レビュー（日曜21:00・docs/STRATEGY.md §6週末 / §7 N4） =====
//
// 【なぜ日曜21:00の1件だけなのか】
// 週の振り返りは「終わった週」に対してしか意味を持たない。日曜の夜は週が事実上
// 終わっていて、かつ翌週の予定を考える時間帯でもあるので、来週の目標を1つ受け取るのに
// いちばん素直な瞬間になる。
//
// 【月曜の朝には出さない】
// 月曜は「今週」が始まってしまっているため、通知から開くと画面の見出しが
// 『今週』なのに中身は先週、という混乱が起きる（週の切り替わりを跨いだ振り返りは
// 通知にしない）。月曜以降に開きたい人のために、概要タブの「週のふりかえり」行が
// 常設の入口として残っている＝通知は"きっかけ"だけを担い、導線は二重に持たない。
//
// 【条件】記録リマインダーが off 以外のときだけ（通知そのものを止めている人には出さない）。
// 1週1回だけ（bl-weekly-notified:<その日曜が属する週の月曜>）。

const WEEKLY_REVIEW_ID_KEY = 'bl-notif-weekly-review-id';  // 予約中の通知ID
const WEEKLY_REVIEW_DONE = 'bl-weekly-notified:';          // + 週キー（'1'=その週はもう積んだ）

/** 「次の日曜21:00」。日曜の21:00を過ぎていれば翌週の日曜（純関数・テスト対象） */
export function nextWeeklyReviewAt(now: Date): Date {
  const d = new Date(now.getTime());
  d.setHours(21, 0, 0, 0);
  const toSunday = (7 - d.getDay()) % 7;      // getDay: 0=日曜
  d.setDate(d.getDate() + toSunday);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 7);
  return d;
}

/** その日が属する週の月曜（achievements.weekKey と同じ定義。1週1回の記録キーに使う） */
function weekKeyOf(d: Date): string {
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** 予約中の週次レビュー通知を取り消す（リマインダーOFF時・積み直しの前） */
export async function cancelWeeklyReviewNotification(): Promise<void> {
  try {
    const id = await AsyncStorage.getItem(WEEKLY_REVIEW_ID_KEY);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      await AsyncStorage.removeItem(WEEKLY_REVIEW_ID_KEY).catch(() => {});
    }
  } catch { /* Expo Go等では黙って諦める */ }
}

/** 次の日曜21:00に週次レビューの通知を1件だけ積む（起動ごと・設定変更ごとに呼ぶ） */
export async function scheduleWeeklyReviewNotification(): Promise<boolean> {
  try {
    const { mode } = await getDailyReminderPrefs();
    if (mode === 'off') { await cancelWeeklyReviewNotification(); return true; }
    const cur = await Notifications.getPermissionsAsync();
    if (!cur.granted) return false;
    const at = nextWeeklyReviewAt(new Date());
    const wk = weekKeyOf(at);
    // 1週1回: その週ぶんを一度積んだら、起動を繰り返しても二重に積まない
    if ((await AsyncStorage.getItem(WEEKLY_REVIEW_DONE + wk)) === '1') return true;
    await cancelWeeklyReviewNotification();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: t('今週のふりかえりができました'),
        body: t('体重の変化と、来週の目標を1つだけ用意しました。1分で読めます。'),
        data: { url: 'bodylog://weekly-review' },   // タップで週次レビュー画面へ
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
    await AsyncStorage.multiSet([[WEEKLY_REVIEW_ID_KEY, id], [WEEKLY_REVIEW_DONE + wk, '1']]).catch(() => {});
    return true;
  } catch { return false; }
}

// ===== Day12「最初の法則」（B-7） =====

/** 最初の法則の通知を21:05に1回だけ予約する（当日を過ぎていれば翌日）。
 *  即時に鳴らさないのは、発見の瞬間はアプリ内の帯が担い、通知は「夜の再訪のきっかけ」
 *  に徹するため。許可が無ければ静かにスキップ（帯だけで伝わる） */
export async function scheduleFirstLawNotification(): Promise<void> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (!cur.granted) return;
    const d = new Date();
    d.setHours(21, 5, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: t('あなたの最初の法則が見つかりました🔍'),
        body: t('記録から、あなただけの傾向が見えてきました。図鑑で確かめてみましょう。'),
        data: { url: 'bodylog://laws' },   // タップで法則図鑑へ（既存ルーティングが処理）
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d },
    });
  } catch { /* Expo Go等では黙って諦める */ }
}

// ===== 気づきの通知（docs/INSIGHTS-ENGINE.md §8・E2） =====
// 「食べすぎが起きやすい条件」がそろった朝に1件だけ。判断（smartのときだけ・1日1件・cautionのみ・
// 8:00前の起動は8:00に予約）は lib/insightAlerts.planMorningNotification（純関数）。ここは予約の I/O だけ

const INSIGHT_PREF_KEY = 'bl-notif-insight';   // '1' | '0'（既定ON）
const INSIGHT_ID_KEY = 'bl-notif-insight-id';  // 予約中の通知ID（同日に組み直すとき前回分を消す）

/** 設定「気づきの通知」（既定ON。記録リマインダーが smart のときだけ実際に届く） */
export async function getInsightNotifyEnabled(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(INSIGHT_PREF_KEY)) !== '0'; } catch { return true; }
}

export async function setInsightNotifyEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(INSIGHT_PREF_KEY, on ? '1' : '0').catch(() => {});
  if (!on) await cancelInsightNotification();
}

/** 予約中の気づき通知を取り消す（設定OFF時） */
export async function cancelInsightNotification(): Promise<void> {
  try {
    const id = await AsyncStorage.getItem(INSIGHT_ID_KEY);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      await AsyncStorage.removeItem(INSIGHT_ID_KEY).catch(() => {});
    }
  } catch { /* Expo Go等では黙って諦める */ }
}

/** 気づき通知を1件予約する。許可が無ければ静かにスキップ（アプリ内のカードで伝わる）。
 *  「1日1件」の記録（bl-insight-alert-notified）は予約できたときだけ書く＝権限が無い日にカウントを消費しない */
export async function scheduleInsightNotification(plan: { title: string; body: string; at: Date }, today: string, notifiedKey: string): Promise<boolean> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (!cur.granted) return false;
    await cancelInsightNotification();
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: plan.title, body: plan.body, data: { url: 'bodylog://log' } },   // タップで食事タブ（カードが出ている）
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.at },
    });
    await AsyncStorage.multiSet([[INSIGHT_ID_KEY, id], [notifiedKey, today]]).catch(() => {});
    return true;
  } catch { return false; }
}

// ===== 記録リマインダーのアクションボタン（B-10） =====

/** 記録リマインダー用の通知カテゴリを登録する。
 *  ボタン文言は登録時の言語で固定されるため、言語変更時にも再登録が必要
 *  （reregisterAllから呼ばれることで両方カバーする） */
export async function registerReminderCategory(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(DAILY_CATEGORY, [
      { identifier: ACTION_LATER_2H, buttonTitle: t('あとで（2時間後）') },
      { identifier: ACTION_SKIP_TODAY, buttonTitle: t('今日は聞かないで') },
    ]);
  } catch { /* Expo Goではカテゴリ未対応でも全体を落とさない */ }
}

/** Android: 通知チャンネルを登録する（チャンネルが無いとAndroidでは通知が一切表示されない）。
 *  名前は端末の通知設定画面に出るため翻訳キーを使い、言語変更時はreregisterAll経由で
 *  名前だけ更新される（既存チャンネルへのsetNotificationChannelAsyncは名前の更新になる）。
 *  iOSではチャンネルの概念が無いので何もしない＝iOS挙動は不変 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: t('通知'),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch { /* Expo Go等では黙って諦める */ }
}

/** 「あとで」→ 同じ内容の単発を2時間後に1回だけ。
 *  カテゴリを付けない＝スヌーズの連鎖はさせない（先送りが無限に続くのを防ぐ） */
async function snoozeReminder2h(content: { title?: string | null; body?: string | null; data?: Record<string, unknown> }): Promise<void> {
  try {
    const now = new Date();
    const d = new Date(now.getTime() + 2 * 3600000);
    // 着地が翌1:00を超えるなら予約しない（深夜に起こしてまで催促しない）
    const isNextDay = d.getDate() !== now.getDate();
    if (isNextDay && d.getHours() * 60 + d.getMinutes() > 60) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: content.title ?? undefined, body: content.body ?? undefined, data: content.data },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d },
    });
  } catch { /* Expo Go等では黙って諦める */ }
}

/** 「今日は聞かないで」→ 今夜のリマインダー取消＋気分カードのスヌーズと同じキーに書く
 *  （アプリ内の「今日は聞かないで」と意味を揃える: 通知からの意思表示も気分カードに波及） */
async function skipTodayFromAction(): Promise<void> {
  await skipTodayReminder();
  await AsyncStorage.setItem('bl-mood-snooze', todayJST()).catch(() => {});
}

/** 言語変更・アプリ起動時に、いまの設定どおり登録し直す
 *  （smartは単発14日ぶんの先積みなので、起動ごとの補充を兼ねる） */
export async function reregisterAll(): Promise<void> {
  try {
    // Androidのみ: チャンネルを先に用意する（無いと以降の通知が全て表示されない）
    await ensureAndroidChannel();
    // カテゴリはここで毎回登録し直す（ボタン文言が登録時の言語で固定されるため）
    await registerReminderCategory();
    const { mode } = await getDailyReminderPrefs();
    if (mode !== 'off') await applyDailyReminder();
    const kv = await AsyncStorage.multiGet(['bl-notif-weekly']);
    if (kv[0]?.[1] === '1') await setWeeklyPhotoReminder(true);
    // 週次レビュー（日曜21:00・1週1回）。起動ごとに次の日曜ぶんを補充する
    await scheduleWeeklyReviewNotification().catch(() => {});
  } catch { /* 失敗しても既存の通知が残るだけ */ }
}

/** 通知タップ→クイック入力へ。ルートレイアウトで一度だけ呼ぶ。戻り値は解除関数
 *  アクションボタン（あとで/今日は聞かないで）もここで分岐する */
export function attachNotificationTapRouting(open: (url: string) => void): () => void {
  try {
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const action = res.actionIdentifier;
      if (action === ACTION_LATER_2H) {
        void snoozeReminder2h(res.notification.request.content);
        return;
      }
      if (action === ACTION_SKIP_TODAY) {
        void skipTodayFromAction().catch(() => {});
        return;
      }
      // 本体タップ（DEFAULT_ACTION_IDENTIFIER）は従来どおりURLを開く
      const url = res.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('bodylog://')) open(url);
    });
    return () => sub.remove();
  } catch { return () => {}; }
}
