// 気づきアラートの配線（docs/INSIGHTS-ENGINE.md §8・E2）
// 判定そのもの（evaluateAlerts / suppressAlerts）は lib/correlate.ts の純関数。ここは
//  ・「出した日」の履歴（AsyncStorage 'bl-insight-alert-history'・30日で掃除）
//  ・×で今日は閉じる（'bl-insight-alert-closed'）
//  ・同時に出す枚数（最大2枚・caution 優先）
//  ・朝の通知の判断（smart モードのときだけ・1日1件・caution のみ）
// を担う。判断はすべて純関数にしてテストし、保存・通知の I/O は末尾の薄い関数に寄せる
import AsyncStorage from '@react-native-async-storage/async-storage';
import { todayJST } from './calc';
import { t } from './i18n';
import { buildDayFeatures, shiftDate } from './features';
import { evaluateAlerts, mineDefaultRules, suppressAlerts, type Alert, type AlertHistory, type Insight } from './correlate';
import { getDailyReminderPrefs, getInsightNotifyEnabled, scheduleInsightNotification } from './notify';
import { WAKE_DEFAULT_HM, beforeWake, minutesSinceWake, readWakeHm, type Hm } from './wakeTime';
import type { LawKind, LawParams } from './laws';

export const HISTORY_KEY = 'bl-insight-alert-history';   // AlertHistory[]（{id,date}）
export const CLOSED_KEY = 'bl-insight-alert-closed';     // AlertHistory[]（×で閉じた {id,date}）
export const NOTIFIED_KEY = 'bl-insight-alert-notified'; // 'YYYY-MM-DD'（朝の通知を出した日）
export const HISTORY_KEEP_DAYS = 30;
export const MAX_CARDS = 2;
/**
 * 朝の通知の時刻。
 * 【2026-09-04 変更】固定の 8:00 をやめ、**設定「起床時刻」**（lib/wakeTime.ts・既定7:00）に追従させた。
 * 5時起きの人には遅すぎ、10時起きの人には寝ている間に鳴っていた（＝通知を開かない癖がつく）。
 * @deprecated 旧固定値（既定値の説明用に残置）。判定は planMorningNotification が wake から組む
 */
export const MORNING_HOUR = 8;
/** @deprecated 旧固定値。窓の長さは MORNING_WINDOW_MIN（起床から2時間）に置き換わった */
export const MORNING_END_HOUR = 10;
/** 起床時刻から「朝」として通知してよい長さ（分）。旧実装の 8:00〜10:00 と同じ2時間幅を保つ */
export const MORNING_WINDOW_MIN = 120;
/** 起床時刻を過ぎてからの起動は、いま開いているアプリ内のカードが役目を果たすので、少し置いてから鳴らす */
export const NOTIFY_DELAY_MIN = 3;

// ===== 履歴（純関数） =====

/** 古い履歴を落とす（today から keepDays 日より前のもの）。壊れた行も落とす */
export function pruneHistory(history: AlertHistory[], today: string, keepDays = HISTORY_KEEP_DAYS): AlertHistory[] {
  const floor = shiftDate(today, -keepDays);
  return history.filter((h) => h && typeof h.id === 'string' && typeof h.date === 'string' && h.date >= floor);
}

/** 今日出したアラートを履歴に足す（同 id・同日は二重登録しない）＋掃除 */
export function mergeHistory(history: AlertHistory[], shown: Alert[], today: string): AlertHistory[] {
  const out = [...history];
  const have = new Set(out.map((h) => `${h.id}@${h.date}`));
  for (const a of shown) {
    const k = `${a.id}@${today}`;
    if (have.has(k)) continue;
    have.add(k);
    out.push({ id: a.id, date: today });
  }
  return pruneHistory(out, today);
}

// ===== カードに出す枚数（純関数） =====

/**
 * 食事タブのカードに出すアラートを決める。
 *  1) 抑制（3日連続で出たら4日目は休む）。ただし**今日の履歴は除いて**判定する
 *     （suppressAlerts の「同idは1日1回」はカードには当たらない: カードは1日中出ていてよい）
 *  2) ×で今日閉じたものは出さない
 *  3) caution 優先で最大 max 枚（evaluateAlerts の並びを尊重しつつ tone で安定ソート）
 */
export function resolveCardAlerts(alerts: Alert[], history: AlertHistory[], closed: AlertHistory[], today: string, max = MAX_CARDS): Alert[] {
  const past = history.filter((h) => h.date !== today);
  const closedToday = new Set(closed.filter((c) => c.date === today).map((c) => c.id));
  const live = suppressAlerts(alerts, past, today).filter((a) => !closedToday.has(a.id));
  const sorted = [...live].sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'caution' ? -1 : 1));
  return sorted.slice(0, Math.max(0, max));
}

// ===== 朝の通知（純関数） =====

export type NotifyPlanInput = {
  alerts: Alert[];
  mode: 'off' | 'smart' | 'always';   // 記録リマインダーのモード
  enabled: boolean;                    // 設定「気づきの通知」
  lastNotified: string | null;         // 最後に通知した日
  today: string;
  now: Date;
  /** 設定「起床時刻」（省略時は既定 7:00）。通知の時刻はここに追従する */
  wake?: Hm;
};

export type NotifyPlan = { alert: Alert; at: Date; title: string; body: string };

/** 通知の文言（非審判・「今日は◯◯の日。無理せず、いつもどおりで」） */
export function alertNotificationCopy(alert: Alert): { title: string; body: string } {
  const f = alert.factors[0] ?? '';
  return {
    title: t('今日は{f}の日', { f }),
    body: t('無理せず、いつもどおりで。条件がそろった日ほど、ふだんの記録が味方になります。'),
  };
}

/**
 * 朝の通知を出すか、出すなら何時に。
 *  ・記録リマインダーが smart のときだけ（always/off では出さない）
 *  ・設定「気づきの通知」ON のときだけ
 *  ・1日1件（lastNotified === today なら出さない）
 *  ・caution だけ（positive は通知しない＝背中押しはアプリ内で十分）
 *  ・**起床時刻より前の起動 → 今日の起床時刻に予約**（0:30 に開いた人にも、朝ちょうどに届く）。
 *    起床〜＋2時間（MORNING_WINDOW_MIN）の起動 → 3分後（開いている間はフォアグラウンドで
 *    表示されないので、カードで足りた人には届かない）。それ以降は「朝」ではないので出さない
 *
 * 時刻は端末ローカル時刻で組む（起床時刻の設定も端末の時計で選ぶので一致する）。
 */
export function planMorningNotification(inp: NotifyPlanInput): NotifyPlan | null {
  if (!inp.enabled || inp.mode !== 'smart') return null;
  if (inp.lastNotified === inp.today) return null;
  const caution = inp.alerts.find((a) => a.tone === 'caution');
  if (!caution) return null;
  const now = inp.now;
  const wake = inp.wake ?? WAKE_DEFAULT_HM;
  const nowHm: Hm = { h: now.getHours(), m: now.getMinutes() };
  const since = minutesSinceWake(nowHm, wake);
  const at = new Date(now.getTime());
  if (since < MORNING_WINDOW_MIN) {
    // 起きた直後にもう開いている人。カードが役目を果たすので、少し置いてから鳴らす
    at.setTime(now.getTime() + NOTIFY_DELAY_MIN * 60000);
  } else if (beforeWake(nowHm, wake)) {
    // まだ起きる前（深夜に開いた人も含む）＝今日の起床時刻に予約する
    at.setHours(wake.h, wake.m, 0, 0);
  } else {
    return null;   // 朝の窓を過ぎた起動。いま鳴らしても「朝の通知」ではない
  }
  return { alert: caution, at, ...alertNotificationCopy(caution) };
}

// ===== 「この法則の解説を読む」のリンク先（純関数） =====

/**
 * アラートの元ルール → /law-detail の kind と生値。
 *  ・単独因子の睡眠負債 → sleep_debt_binge、単独因子の気分3日低め → mood_lag_binge（専用の解説がある）
 *  ・それ以外の食べすぎ系 → multi_binge（p.f は因子キーの組。lawText が現在の言語で組み直す）
 *  ・positive（lift_volume_up）→ lift_sleep（睡眠7h→トレの伸び）。因子が睡眠でなければリンク無し（null）
 */
export function lawLinkForAlert(alert: Alert, insight: Insight | undefined): { kind: LawKind; p: LawParams } | null {
  if (!insight) return null;
  const x = Math.round((insight.effect ?? 0) * 10) / 10;
  if (insight.outcome === 'binge') {
    if (insight.factors.length === 1 && insight.factors[0] === 'sleep_debt5_ge5') return { kind: 'sleep_debt_binge', p: { x, n: insight.n, h: insight.hits ?? 0 } };
    if (insight.factors.length === 1 && insight.factors[0] === 'mood_avg3_low') return { kind: 'mood_lag_binge', p: { k: 1, x, n: insight.n } };
    return { kind: 'multi_binge', p: { f: insight.factors.join('+'), x, n: insight.n, h: insight.hits ?? 0 } };
  }
  if (insight.outcome === 'lift_volume_up' && insight.factors.includes('sleep_ge7')) {
    // lift_sleep の生値は {dir, pct, a, b}。ルールからは群の日数が出ないので support/n を当てる（記事本文は kind で決まる）
    return { kind: 'lift_sleep', p: { dir: 'up', pct: Math.max(0, Math.round((x - 1) * 100)), a: insight.support ?? 0, b: Math.max(0, insight.n - (insight.support ?? 0)) } };
  }
  return null;
}

// ===== I/O（AsyncStorage） =====

async function readList(key: string): Promise<AlertHistory[]> {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(key)) || '[]');
    return Array.isArray(v) ? (v as AlertHistory[]) : [];
  } catch { return []; }
}

export type InsightAlertState = {
  cards: Alert[];                                  // 表示するカード（最大2枚・caution 優先）
  insightsById: Map<string, Insight>;              // 解説リンク用（ruleId → Insight）
  all: Alert[];                                    // 抑制前の全発火（通知の判断に使う）
};

/**
 * 食事タブを開いたときに1回呼ぶ: 特徴量 → ルール → 判定 → 抑制 → 履歴に記録。
 * 通信・キャッシュはすべて buildDayFeatures 側（15分TTL）。データ不足やエラーは空で返す
 */
export async function loadInsightAlerts(today = todayJST()): Promise<InsightAlertState> {
  const empty: InsightAlertState = { cards: [], insightsById: new Map(), all: [] };
  try {
    const features = await buildDayFeatures(90);
    if (features.length === 0) return empty;
    const todayRow = features.find((f) => f.date === today);
    if (!todayRow) return empty;
    const insights = mineDefaultRules(features);
    if (insights.length === 0) return empty;
    const all = evaluateAlerts(todayRow, features, insights);
    if (all.length === 0) return empty;
    const [history, closed] = await Promise.all([readList(HISTORY_KEY), readList(CLOSED_KEY)]);
    const cards = resolveCardAlerts(all, history, closed, today);
    const next = mergeHistory(history, cards, today);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {});
    return { cards, insightsById: new Map(insights.map((i) => [i.id, i])), all };
  } catch { return empty; }
}

/**
 * 朝の通知（§8 ②）: 設定・モード・1日1件を見て、caution があれば予約する。
 * 食事タブは起動時に最初に開くタブなので、loadInsightAlerts の直後に呼べば「判定はアプリ起動時」になる
 */
export async function maybeScheduleMorningNotification(all: Alert[], today = todayJST(), now = new Date()): Promise<boolean> {
  try {
    const [{ mode }, enabled, lastNotified, wake] = await Promise.all([
      getDailyReminderPrefs(), getInsightNotifyEnabled(), AsyncStorage.getItem(NOTIFIED_KEY), readWakeHm(),
    ]);
    const plan = planMorningNotification({ alerts: all, mode, enabled, lastNotified, today, now, wake });
    if (!plan) return false;
    return scheduleInsightNotification(plan, today, NOTIFIED_KEY);
  } catch { return false; }
}

/** ×で今日は閉じる（同じ id は今日もう出ない。明日はまた判定から） */
export async function closeInsightAlert(id: string, today = todayJST()): Promise<void> {
  try {
    const closed = pruneHistory(await readList(CLOSED_KEY), today, 3);
    if (!closed.some((c) => c.id === id && c.date === today)) closed.push({ id, date: today });
    await AsyncStorage.setItem(CLOSED_KEY, JSON.stringify(closed));
  } catch { /* 閉じられないだけ */ }
}
