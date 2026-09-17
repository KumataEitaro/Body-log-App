// レストタイマーの所有者を「筋トレ記録画面」から「アプリ」へ引き上げる（2026-09-17）。
//
// 【事故の形】熊田さん指摘:
//   「筋トレの記録挙動だけど、一度戻るボタンから戻ってしまうと、タイマーの通知が来ない」
//
// 原因は app/lift-session.tsx の AppState リスナーだった。
//   ・通知の予約は **背景に回った瞬間**（AppState が active 以外になったとき）にしか行われない
//   ・後片付け（画面のアンマウント）で `cancelRestNotif()` まで呼んでいた
//   → 戻るボタンで画面を離れると「予約はまだされていない」「もう誰も予約しない」状態になり、
//     レストが終わっても**何も起きない**。しかも残り時間を見る場所もどこにも無かった。
//
// 【直し方】レストの持ち主をこのモジュールにする。
//   ① レストを始めた瞬間に通知を予約する（前景・背景を問わず）。止めた・作り直した・
//      終わったら取り消す。画面の生き死にと通知の予約を**切り離す**
//   ② 残り時間は購読できる（どのタブにいても components/RestTimerBar が出る）
//   ③ 0 になった瞬間の触覚＋バイブは**ここで1回だけ**鳴らす（画面ごとに鳴らすと二重に鳴る）
//
// 前景で鳴らす音は要らない（アプリを見ているなら数字とバイブで足りる）。
// このアプリは setNotificationHandler を置いていないので、前景の通知は OS 側で出ない＝
// 「アプリを見ている間はバイブ」「離れている間は通知」が自然に両立する。
//
// iPhone のダイナミックアイランド（アプリを閉じていても残り分数が見える）は別件。
// この土台の上に載せる: docs/LIVE-ACTIVITY-2026-09.md
import { useEffect, useState } from 'react';
import { Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { t } from './i18n';
import { LIFT_SESSION_KEY, parseSessionState, serializeSessionState, restLeftSec } from './liftSession';

/** レスト終了時刻（epoch ms）。null=止まっている */
let endsAt: number | null = null;
/** 予約中のローカル通知ID（取り消しに要る） */
let notifId: string | null = null;
/** 0 を知らせ終えた終了時刻（同じレストで二度鳴らさない） */
let fired: number | null = null;
/** 残り時間を刻む唯一のタイマー（購読者が1人でもいる間だけ回る） */
let tick: ReturnType<typeof setInterval> | null = null;

type Listener = (endsAt: number | null) => void;
const listeners = new Set<Listener>();

function emit() { for (const fn of [...listeners]) { try { fn(endsAt); } catch { /* 購読者の事故で他を巻き込まない */ } } }

/** 現在のレスト終了時刻（epoch ms）。null=止まっている */
export function restEndsAt(): number | null { return endsAt; }

/** 残り秒（終わっていれば0・止まっていれば null）。表示用 */
export function restLeft(now = Date.now()): number | null { return restLeftSec(endsAt, now); }

// ===== 通知（レスト終了） =====
async function cancelNotif() {
  const id = notifId;
  notifId = null;
  if (id) { try { await Notifications.cancelScheduledNotificationAsync(id); } catch { /* 無視 */ } }
}
async function scheduleNotif(at: number) {
  await cancelNotif();
  // 直前すぎる予約は届く前に終わる。バイブで足りるので予約しない
  if (at - Date.now() < 1500) return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;   // 許可が無ければ黙って何もしない（催促しない）
    notifId = await Notifications.scheduleNotificationAsync({
      content: { title: t('レスト終了'), body: t('次のセットへ。'), sound: true, data: { url: 'bodylog://lift-session' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
    });
  } catch { /* Expo Go 等では黙って諦める */ }
}

/** セッション状態（AsyncStorage）の restEndsAt だけを書き換える。他のタブから止めても画面と食い違わない */
async function persist(at: number | null) {
  try {
    const st = parseSessionState(await AsyncStorage.getItem(LIFT_SESSION_KEY));
    if (!st) return;
    if (st.restEndsAt === at) return;
    await AsyncStorage.setItem(LIFT_SESSION_KEY, serializeSessionState({ ...st, restEndsAt: at }));
  } catch { /* 保存できなくてもタイマー自体は動く */ }
}

/**
 * レストを始める／止める／付け替える。**通知の予約もここで完結する**。
 * @param at 終了時刻（epoch ms）。null で停止
 * @param opts.persist 端末の保存にも書き戻すか（既定 true。画面側が自分で保存するときは false）
 */
export async function armRest(at: number | null, opts: { persist?: boolean } = {}): Promise<void> {
  const same = endsAt === at;
  endsAt = at;
  if (at != null && at > Date.now()) fired = null;   // 新しいレスト。また鳴らせるようにする
  if (!same) emit();
  if (opts.persist !== false) await persist(at);
  if (at == null || at <= Date.now()) { await cancelNotif(); return; }
  await scheduleNotif(at);
}

/** レストを止める（どの画面からでも） */
export async function stopRest(): Promise<void> { await armRest(null); }

/** アプリ起動時に、前回の途中のレストを拾い直す（端末を再起動しても残り時間が続く） */
export async function hydrateRest(): Promise<void> {
  try {
    const st = parseSessionState(await AsyncStorage.getItem(LIFT_SESSION_KEY));
    const at = st?.restEndsAt ?? null;
    if (at == null) return;
    if (at <= Date.now()) { endsAt = null; emit(); await persist(null); return; }   // 起動前に終わっていた
    await armRest(at, { persist: false });
  } catch { /* 無視 */ }
}

/** 0 になった瞬間に1回だけ知らせる（購読者の数に関係なく1回） */
function fireIfDone() {
  if (endsAt == null || fired === endsAt || Date.now() < endsAt) return;
  fired = endsAt;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  try { Vibration.vibrate(500); } catch { /* 端末設定次第 */ }
  notifId = null;   // 予約は届いた（or 前景で握り潰された）。取り消す相手はもういない
}

/** 残り秒を購読する。返り値は解除関数 */
export function subscribeRest(fn: Listener): () => void {
  listeners.add(fn);
  if (!tick) tick = setInterval(() => { fireIfDone(); emit(); }, 500);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && tick) { clearInterval(tick); tick = null; }
  };
}

/**
 * 残り秒を返すフック（止まっていれば null・終わった直後は 0）。
 * 画面が何枚あっても刻むのは上の1本だけ。
 */
export function useRestLeft(): number | null {
  const [left, setLeft] = useState<number | null>(() => restLeft());
  useEffect(() => subscribeRest(() => setLeft(restLeft())), []);
  return left;
}

/** テスト用: モジュールの内部状態を初期化する（本体からは呼ばない） */
export function __resetRestTimerForTest() {
  endsAt = null; notifId = null; fired = null;
  if (tick) { clearInterval(tick); tick = null; }
  listeners.clear();
}
