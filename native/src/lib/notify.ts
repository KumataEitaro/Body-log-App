// ローカル通知（リマインダー）: 記録リマインダー・週1体写真(日曜19:00)・チートデイ前日(20:00)
// Expo Goでは動作が制限されるため全て安全に失敗する（TestFlight/dev clientで完全動作）
//
// 記録リマインダーは3モード:
//  - smart（既定）: その日なにか記録していれば通知しない。単発通知を14日ぶん先まで積み、
//    記録が入った瞬間に「今日のぶん」だけ取り消す（ローカル通知は配信時に条件分岐できないため）。
//    14日ひらかないと自動で静かになる＝離れた人を追いかけて責めない（L4思想）
//  - always: 毎日決まった時刻に必ず（習慣のアンカーとして使う人向け）
//  - off
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { t } from './i18n';
import { todayJST } from './calc';
import { supabase } from './supabase';

const IDS_KEY = 'bl-notif-ids';         // { daily?: string; weekly?: string }
const SMART_KEY = 'bl-notif-smart-ids'; // { 'YYYY-MM-DD': notificationId }
const MODE_KEY = 'bl-notif-daily-mode'; // 'off' | 'smart' | 'always'
const TIME_KEY = 'bl-notif-daily-time'; // 'HH:00'
const SMART_HORIZON = 14;               // smartで先積みする日数

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

export async function getDailyReminderPrefs(): Promise<{ mode: DailyReminderMode; hour: number }> {
  try {
    const kv = await AsyncStorage.multiGet([MODE_KEY, TIME_KEY, 'bl-notif-daily']);
    let mode = kv[0]?.[1] as DailyReminderMode | null;
    if (mode !== 'off' && mode !== 'smart' && mode !== 'always') {
      // 旧トグル('1'/'0')からの移行。ONだった人は「記録がない日だけ」へ
      // （全部入力した日にも鳴るのが不満の起点だったため、賢い方を新既定にする）
      mode = kv[2]?.[1] === '1' ? 'smart' : 'off';
    }
    const hour = Number(String(kv[1]?.[1] ?? '21').split(':')[0]);
    return { mode, hour: hour >= 0 && hour <= 23 ? hour : 21 };
  } catch { return { mode: 'off', hour: 21 }; }
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
  return applyDailyReminder();
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
        content: { ...REMINDER_COPY()[0], data: { url: 'bodylog://log?quick=1' } },
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
        content: { ...copies[i % copies.length], data: { url: 'bodylog://log?quick=1' } },
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

/** 言語変更・アプリ起動時に、いまの設定どおり登録し直す
 *  （smartは単発14日ぶんの先積みなので、起動ごとの補充を兼ねる） */
export async function reregisterAll(): Promise<void> {
  try {
    const { mode } = await getDailyReminderPrefs();
    if (mode !== 'off') await applyDailyReminder();
    const kv = await AsyncStorage.multiGet(['bl-notif-weekly']);
    if (kv[0]?.[1] === '1') await setWeeklyPhotoReminder(true);
  } catch { /* 失敗しても既存の通知が残るだけ */ }
}

/** 通知タップ→クイック入力へ。ルートレイアウトで一度だけ呼ぶ。戻り値は解除関数 */
export function attachNotificationTapRouting(open: (url: string) => void): () => void {
  try {
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const url = res.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('bodylog://')) open(url);
    });
    return () => sub.remove();
  } catch { return () => {}; }
}
