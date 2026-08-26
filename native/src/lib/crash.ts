// 自前のクラッシュ計測。
//
// これまで実機のクラッシュは「推測」しかできなかった（Sentry等は未導入）。
// 外部サービスのアカウントを増やさず、自分のSupabaseに集める:
//   JSの未捕捉例外・Promiseの未処理拒否・ErrorBoundaryの捕捉 → /api/crash → crash_reports
//
// 送信はベストエフォート（クラッシュ処理の中でさらに失敗しても何も壊さない）。
// 同じ内容の連投を防ぐため、1分に1件までに絞る。
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { supabase } from './supabase';
import { API } from './api';

let lastSentAt = 0;

export async function reportCrash(name: string, message: string, stack?: string, fatal = false): Promise<void> {
  try {
    const now = Date.now();
    if (now - lastSentAt < 60_000) return;   // 連投ガード
    lastSentAt = now;
    let userId: string | undefined;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      userId = session?.user?.id;
    } catch { /* 未ログインでも送る */ }
    await fetch(`${API}/api/crash`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: Platform.OS,
        app_version: Application.nativeApplicationVersion ?? '',
        fatal, name, message, stack,
        user_id: userId,
      }),
    });
  } catch { /* クラッシュ報告自体の失敗は無視 */ }
}

/** 起動時に一度呼ぶ。グローバルの例外ハンドラを重ねる（元のハンドラは必ず呼ぶ） */
export function installCrashReporter(): void {
  try {
    type GlobalWithErrorUtils = typeof globalThis & {
      ErrorUtils?: {
        getGlobalHandler(): (e: Error, isFatal?: boolean) => void;
        setGlobalHandler(h: (e: Error, isFatal?: boolean) => void): void;
      };
    };
    const eu = (globalThis as GlobalWithErrorUtils).ErrorUtils;
    if (eu) {
      const prev = eu.getGlobalHandler();
      eu.setGlobalHandler((e, isFatal) => {
        void reportCrash(e?.name ?? 'Error', e?.message ?? String(e), e?.stack, isFatal === true);
        prev(e, isFatal);   // 元の挙動（赤画面/終了処理）は変えない
      });
    }
  } catch { /* 計測が入らなくてもアプリは動く */ }
}
