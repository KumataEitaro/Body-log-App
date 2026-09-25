// レストタイマーの所有者を「筋トレ記録画面」から「アプリ」へ引き上げる（2026-09-17）。
//
// 【事故の形】熊田さん指摘:
//   「筋トレの記録挙動だけど、一度戻るボタンから戻ってしまうと、タイマーの通知が来ない」
//
// 原因は app/lift-session.tsx の AppState リスナーだった。
//   ・画面の外への知らせは **背景に回った瞬間**（AppState が active 以外になったとき）にしか用意されない
//   ・後片付け（画面のアンマウント）で取り消していた
//   → 戻るボタンで画面を離れると「まだ用意されていない」「もう誰も用意しない」状態になり、
//     レストが終わっても**何も起きない**。しかも残り時間を見る場所もどこにも無かった。
//
// 【直し方】レストの持ち主をこのモジュールにする。
//   ① レストを始めた瞬間に画面の外の表示（下の④）を出す。止めた・作り直した・終わったら畳む。
//      画面の生き死にと**切り離す**
//   ② 残り時間は購読できる（どのタブにいても components/RestTimerBar が出る）
//   ③ 0 になった瞬間の触覚＋バイブは**ここで1回だけ**鳴らす（画面ごとに鳴らすと二重に鳴る）
//   ④ iPhone のダイナミックアイランド／ロック画面に、残り時間を **OS が数えて**出す
//      （lib/restActivity.ts 経由。描画本体は RestActivity.tsx）。アプリを閉じていても減っていく。
//      対応していない環境（Android・拡張なしビルド・設定でオフ）では静かに何もしない。
//
// 【2026-09-25 終了時のローカル通知を廃止】熊田さん:
//   「筋トレのレストタイマーの通知のイメージが違う。ダイナミックアイランドでの通知にして。
//     今ある通知の機能はなくしてよし」
//   以前は「終了時刻にローカル通知（レスト終了／次のセットへ。）」を予約していたが、
//   欲しいのは UberEats 型の「島で残り時間が減っていく」表示であって、終わってから届くバナーではない。
//   予約・取り消し・許可確認をすべて外し、画面の外の表示は Live Activity に一本化した。
//   通知の許可が無くても Live Activity は出る（別の権限。設定 › BodyLog › ライブアクティビティ）。
//   ビルドへの入れ方・Apple 側の準備・戻し方: docs/LIVE-ACTIVITY.md
//
// 前景で鳴らす音は要らない（アプリを見ているなら数字とバイブで足りる）。
import { useEffect, useState } from 'react';
import { Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { LIFT_SESSION_KEY, parseSessionState, serializeSessionState, restLeftSec } from './liftSession';
import { startRestActivity, endRestActivity, cleanupRestActivities } from './restActivity';

/** レスト終了時刻（epoch ms）。null=止まっている */
let endsAt: number | null = null;
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
 * レストを始める／止める／付け替える。**画面の外の表示（Live Activity）もここで完結する**。
 * @param at 終了時刻（epoch ms）。null で停止
 * @param opts.persist  端末の保存にも書き戻すか（既定 true。画面側が自分で保存するときは false）
 * @param opts.exercise 種目名。ダイナミックアイランドに出す（無くてもよい）
 */
export async function armRest(at: number | null, opts: { persist?: boolean; exercise?: string } = {}): Promise<void> {
  const same = endsAt === at;
  endsAt = at;
  if (at != null && at > Date.now()) fired = null;   // 新しいレスト。また鳴らせるようにする
  if (!same) emit();
  if (opts.persist !== false) await persist(at);
  if (at == null || at <= Date.now()) { await endRestActivity(); return; }
  // iPhone のダイナミックアイランド／ロック画面。カウントダウンは OS が描くので、
  // ここで1回出すだけ＝更新もプッシュも要らない。同じ終了時刻なら出し直さない（島がちらつく）。
  // 付け替え（別の終了時刻）のときは restActivity 側が前のを畳んでから出す
  if (!same) startRestActivity(Date.now(), at, opts.exercise ?? '');
}

/** レストを止める（どの画面からでも） */
export async function stopRest(): Promise<void> { await armRest(null); }

/** アプリ起動時に、前回の途中のレストを拾い直す（端末を再起動しても残り時間が続く） */
export async function hydrateRest(): Promise<void> {
  // 強制終了などで畳み損ねた Live Activity をまず片付ける（残骸が居座らないように）。
  // Live Activity はアプリのプロセスと独立に生きるので、殺されたぶんは次の起動でしか回収できない
  await cleanupRestActivities();
  try {
    const st = parseSessionState(await AsyncStorage.getItem(LIFT_SESSION_KEY));
    const at = st?.restEndsAt ?? null;
    if (at == null) return;
    if (at <= Date.now()) { endsAt = null; emit(); await persist(null); return; }   // 起動前に終わっていた
    // 最後に足したセットの種目＝いま休んでいる種目（筋トレ記録画面と同じ決め方）
    const exercise = st?.sets[st.sets.length - 1]?.name ?? '';
    await armRest(at, { persist: false, exercise });
  } catch { /* 無視 */ }
}

/** 0 になった瞬間に1回だけ知らせる（購読者の数に関係なく1回） */
function fireIfDone() {
  if (endsAt == null || fired === endsAt || Date.now() < endsAt) return;
  fired = endsAt;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  try { Vibration.vibrate(500); } catch { /* 端末設定次第 */ }
  void endRestActivity();   // 前景で 0 を見た＝畳める（背景で終わったぶんは次の起動時に掃除する）
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
  endsAt = null; fired = null;
  if (tick) { clearInterval(tick); tick = null; }
  listeners.clear();
}
