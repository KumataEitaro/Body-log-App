// Live Activity（ダイナミックアイランドのレスト残り時間）への口。2026-09-17。
//
// 鉄則は widget-bridge と同じ ——「**無い環境では静かに no-op**」。
// 呼び出し側（lib/restTimer.ts）は、ここが動いたかどうかを一切気にしない。
//   ・Android / Web / Jest ……… そもそも ActivityKit が無い
//   ・ENABLE_LIVE_ACTIVITY を付けずに焼いたビルド … 拡張ターゲットが入っていない
//   ・ユーザーが設定アプリで Live Activity を切っている … Apple が許している正規の状態
//   ・Expo Go
// どれも「失敗」ではなく「この端末には出ないだけ」。例外はすべてここで飲む。
//
// 読み込みは**遅延**にする。モジュール先頭で expo-widgets を import すると、
// 上のどの環境でも読み込み時点で落ちうるため（アプリ本体を巻き込まない）。
import { Platform } from 'react-native';
import { t } from './i18n';

/** start() が返すハンドル。end() を呼ぶためだけに持つ */
type Handle = { end: (policy?: string) => Promise<void> };
type Factory = {
  start: (props: Record<string, unknown>, url?: string) => Handle;
  getInstances?: () => Handle[];
};

let current: Handle | null = null;

/** 遅延読み込み。失敗したら null（以後も毎回 null が返るだけで害はない） */
function factory(): Factory | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../liveactivity/RestActivity') as { default?: Factory };
    return mod?.default ?? null;
  } catch {
    return null;
  }
}

/**
 * レストの Live Activity を出す。
 * カウントダウンは OS が描くので、**開始時に1回呼ぶだけ**（更新は要らない）。
 * @param exercise 種目名（空でもよい）
 */
export function startRestActivity(startedAtMs: number, endsAtMs: number, exercise = ''): void {
  if (endsAtMs - Date.now() < 1500) return;   // 一瞬で終わるレストに出しても邪魔なだけ
  const f = factory();
  if (!f) return;
  try {
    void endRestActivity();   // 前のが残っていたら畳んでから
    current = f.start(
      { startedAtMs, endsAtMs, exercise, label: t('レスト') },
      'bodylog://lift-session',   // バナーをタップしたときの行き先（ローカル通知と揃える）
    );
  } catch { /* 非対応端末・設定でオフ・拡張なしビルド。黙って諦める */ }
}

/** レストの Live Activity を畳む（止めた・終わった・保存した・破棄した） */
export async function endRestActivity(): Promise<void> {
  const h = current;
  current = null;
  try { await h?.end('immediate'); } catch { /* 無視 */ }
}

/**
 * アプリを強制終了したあとに残っている Live Activity を掃除する（起動時に1回）。
 * バックグラウンドでは JS が止まるので「0 になった瞬間に end()」が呼べず、
 * 次に開くまで残ることがある。その取りこぼしをここで回収する。
 */
export async function cleanupRestActivities(): Promise<void> {
  const f = factory();
  if (!f?.getInstances) return;
  try {
    for (const h of f.getInstances()) { try { await h.end('immediate'); } catch { /* 無視 */ } }
  } catch { /* 無視 */ }
  current = null;
}
