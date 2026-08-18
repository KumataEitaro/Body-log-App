// ローカル通知（リマインダー）: 記録リマインダー(毎日21:00)・週1体写真(日曜19:00)・チートデイ前日(20:00)
// Expo Goでは動作が制限されるため全て安全に失敗する（TestFlight/dev clientで完全動作）
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { t } from './i18n';

const IDS_KEY = 'bl-notif-ids'; // { daily?: string; weekly?: string }

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

// 毎日21:00「今日の記録は済みましたか？」
export async function setDailyLogReminder(on: boolean): Promise<boolean> {
  await cancel('daily');
  if (!on) return true;
  if (!(await ensureNotifPermission())) return false;
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: t('今日の記録、忘れていませんか？'), body: t('食べたものを1行書くだけでOK。続けるほどAIのアドバイスが賢くなります。') },
      // v57からトリガーはtype必須（旧形式{hour,minute,repeats}は例外を投げる）
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 21, minute: 0 },
    });
    const ids = await getIds(); ids.daily = id; await setIds(ids);
    return true;
  } catch { return false; }
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

/** 言語変更時などに、ONになっている通知を今の言語で登録し直す */
export async function reregisterAll(): Promise<void> {
  try {
    const kv = await AsyncStorage.multiGet(['bl-notif-daily', 'bl-notif-weekly']);
    if (kv[0]?.[1] === '1') await setDailyLogReminder(true);
    if (kv[1]?.[1] === '1') await setWeeklyPhotoReminder(true);
  } catch { /* 失敗しても既存の通知が残るだけ */ }
}
