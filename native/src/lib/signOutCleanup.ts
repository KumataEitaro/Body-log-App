// サインアウト時の端末データ掃除（QA 2026-09-10 P1-3 / P1-5）。
//
// 事故の形: ログアウト・アカウント切替・退会のどれでも端末のデータを1バイトも消していなかった。
// 同じ端末で別のアカウントにログインすると、
//   ・相談タブに前の人の**AI相談の全会話**が出る（'bl-coach-history'・最大800件）
//   ・前の人の**アレルギー設定**で食事に警告が出る（'bl-diet'・安全に直結）
//   ・概要タブに前の人の**90日分の体重・摂取・睡眠**が出る（'bl-day-features'）
//   ・プランと管理者免除・RevenueCatのidentityが前の人のまま（gate.ts / purchases.ts → P1-5）
// 退会（settings.tsx の deleteAccount）も同じ signOut を通るので、
// 「記録・写真・目標・マイ食品のすべてが削除されます」という確認文言と端末の実態が食い違っていた。
//
// ■ 方針: 除外リストではなく **許可リスト**
// 「消さないもの」を列挙し、それ以外を全部消す。新しいキーが増えたときに
// 自動で「消す側（安全側）」に倒れる。逆（消すものを列挙）だと、キーを足した人が
// 掃除リストへの追記を忘れた瞬間に静かな漏えいが生まれる。
//
// ■ 消さないもの＝端末の設定であって「その人のデータ」ではないもの
// テーマ・言語・単位・起動エラー記録・リモートコンテンツのキャッシュ・食品DBのキャッシュ、
// そして **未送信のオフラインキュー**（消すと圏外で記録したものが失われる。別人に送られる心配は
// lib/offlineQueue.ts の uid 判定で塞いだ＝P0-2）。
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { resetGate } from './gate';
import { resetDiet } from './diet';
import { logOutPurchases } from './purchases';
import { clearWidgetData } from './widget';
import { resetProfileRowCache } from './profileRow';

/** サインアウトしても残すキー（完全一致） */
export const KEEP_KEYS: readonly string[] = [
  'bl-locale',           // 表示言語（端末の設定）
  'bl-theme',            // テーマ（明暗・アクセント）
  'bl-units',            // 単位（kg/lb・cm/ft）
  'bl-boot-errors',      // 起動時の初期化エラー記録（端末の診断情報。設定の最下部から読む）
  'bl-remote-content',   // 読み物・バッジ・法則の文言キャッシュ（全員共通の配信物）
  'bl-offline-logs',     // 未送信のオフラインキュー（消すと圏外の記録が失われる → P0-2）
  'bl-offline-dropped',  // 「同期できなかった記録が N 件」の控え（次回起動で伝える）
];

/** サインアウトしても残すキーの接頭辞（前方一致） */
export const KEEP_PREFIXES: readonly string[] = [
  'bl-fooddb-',          // 食品DBの検索キャッシュ（公開データ。個人の記録ではない）
];

/**
 * サインアウトで消すキーの目録（前方一致）。
 *
 * **実行時にはこの一覧を使わない**（許可リスト方式なので、載っていなくても消える）。
 * ここに書く目的は2つ:
 *   1. 何が消えるのかをレビューで読めるようにする
 *   2. 規約テスト（__tests__/signOutCleanup.test.ts）で「native/src に現れる 'bl-…' は
 *      KEEP か CLEARED のどちらかに必ず載っている」を機械的に確かめる
 *      ＝新しいキーを足した人に「これは個人データか、端末設定か」を必ず考えさせる
 */
export const CLEARED_KEYS: readonly string[] = [
  // --- 記録・分析（本人のデータそのもの） ---
  'bl-coach-history',      // AI相談の全会話
  'bl-day-features',       // 90日分の体重・摂取・PFC・歩数・睡眠・過食日・周期
  'bl-diet',               // 食事の制約（アレルギー・宗教/ベジ）
  'bl-laws', 'bl-laws-seen',
  'bl-highlight-v1',
  'bl-cycle-enabled',      // 生理周期モード
  'bl-lift-session',       // 中断中の筋トレセッション
  'bl-custom-lifts',
  'bl-parse-jobs',         // 送信中の食事解析ジョブ（写真を含む）
  'bl-day-plan:',          // 日ごとの予定（プレフィックス）
  'bl-day-plan-ask-off',
  'bl-kcal-adjust',
  'bl-week-goal', 'bl-week-steps-goal',
  'bl-active-kcal-to-goal', 'bl-act-last-min',
  'bl-food-freq-v2', 'bl-food-seen',
  'bl-purpose',            // ダイエットの目的（バルク/カット）
  'bl-wake-time',
  // --- 実績・バッジ ---
  'bl-badges-earned', 'bl-badges-seen-defs', 'bl-badges-unseen', 'bl-badges-banner',
  // --- 初回体験・ガイドの進捗（lib/firstrun.ts が :uid を付けるが、掃除は前方一致で拾う） ---
  'bl-guide-done', 'bl-guide-chapters', 'bl-onboard-done',
  'bl-comeback-shown', 'bl-start-checklist-done',
  'bl-day12-banner', 'bl-day12-done',
  'bl-voice-hint-seen',
  // --- 画面の状態・並び順・表示の出し分け ---
  'bl-cards-log', 'bl-cards-exercise',
  'bl-order-all2', 'bl-order-exercise', 'bl-hidden-all2',
  'bl-foods-order', 'bl-foods-view', 'bl-ex-view',
  'bl-columns-read',
  'bl-avatar',
  'bl-rest-sec', 'bl-rest-count',
  // --- スヌーズ・「今日は出さない」系（その人の今日の状態） ---
  'bl-brief-closed', 'bl-brief-off',
  'bl-backfill-snooze', 'bl-mood-snooze', 'bl-risk-snooze',
  'bl-diet-tip-shown', 'bl-diet-tip-declined',
  'bl-food-suggest-shown', 'bl-food-suggest-declined',
  'bl-insight-alert-closed', 'bl-insight-alert-history', 'bl-insight-alert-notified',
  'bl-review-asked', 'bl-feedback-bug-at',
  // --- 通知（予約IDと設定。掃除の前に予約そのものも取り消す） ---
  'bl-notif-ids', 'bl-notif-smart-ids', 'bl-notif-daily', 'bl-notif-daily-mode',
  'bl-notif-daily-time', 'bl-notif-weekly', 'bl-notif-weekly-review-id',
  'bl-notif-gap', 'bl-notif-gap-id', 'bl-notif-insight', 'bl-notif-insight-id',
  'bl-weekly-notified:',   // プレフィックス（+ 週キー）
  'bl-daily', 'bl-later-2h', 'bl-skip-today',   // 通知カテゴリ/アクションの識別子
  // --- 課金・広告の出し分け ---
  'bl-ad-impressions', 'bl-ad-pitch', 'bl-interstitial',
  // --- ヘルスケア連携（次の人が前の人の最終同期時刻で切り詰められないように） ---
  'bl-health-linked', 'bl-health-last-sync', 'bl-health-prefer-manual-weight',
  // --- 規約同意（アカウントごとに取り直す） ---
  'bl-terms-version',
];

/** そのキーを残すか */
export function shouldKeep(key: string): boolean {
  return KEEP_KEYS.includes(key) || KEEP_PREFIXES.some((p) => key.startsWith(p));
}

/** 掃除対象のキーを選ぶ（純関数・テストしやすいよう分けている） */
export function keysToRemove(allKeys: readonly string[]): string[] {
  return allKeys.filter((k) => !shouldKeep(k));
}

/**
 * サインアウト時に端末のユーザーデータを消す。
 *
 * 呼び出しは native/src/app/_layout.tsx の onAuthStateChange で `ev === 'SIGNED_OUT'` のとき1か所だけ。
 * 退会（settings.tsx の deleteAccount）も最後に signOut を呼ぶので、同じ経路でここを通る。
 * どの段でコケても後段まで進む（掃除が半分で止まる方が、残ったデータが見えるより悪い）。
 */
export async function clearLocalUserState(): Promise<void> {
  // 1) 予約済みのローカル通知を取り消す。キーだけ消すと「IDが分からないのに予約は生きている」
  //    通知が残り、次の人の端末で前の人のリマインダーが鳴る
  try {
    const cancelAll = (Notifications as { cancelAllScheduledNotificationsAsync?: () => Promise<void> })
      .cancelAllScheduledNotificationsAsync;
    if (typeof cancelAll === 'function') await cancelAll();
  } catch { /* Expo Go 等では失敗する。掃除は続ける */ }

  // 2) AsyncStorage: 許可リスト以外を全部消す
  try {
    const all = await AsyncStorage.getAllKeys();
    const remove = keysToRemove(all);
    if (remove.length > 0) await AsyncStorage.multiRemove(remove);
  } catch { /* ストレージ不調。次のサインアウトで再試行される */ }

  // 3) モジュールスコープのキャッシュ（AsyncStorageを消しても、これが残ると前の人の値が生き続ける）
  try { resetGate(); } catch { /* 続行 */ }
  try { resetDiet(); } catch { /* 続行 */ }
  try { resetProfileRowCache(); } catch { /* 続行 */ }

  // 4) RevenueCat の identity（次の人の購入が前の人のプランを更新しないように）
  try { await logOutPurchases(); } catch { /* 続行 */ }

  // 5) ホーム画面ウィジェット（ロック画面からも見える）
  try { clearWidgetData(); } catch { /* 続行 */ }
}
