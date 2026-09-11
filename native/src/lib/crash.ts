// 自前のクラッシュ計測。
//
// これまで実機のクラッシュは「推測」しかできなかった（Sentry等は未導入）。
// 外部サービスのアカウントを増やさず、自分のSupabaseに集める:
//   JSの未捕捉例外・Promiseの未処理拒否・ErrorBoundaryの捕捉 → /api/crash → crash_reports
//
// 「Promiseの未処理拒否」の入れ方（QA P1-8。RN 0.86 の実装を読んで確かめた）:
//   ・Hermes が Promise を持つビルド（現行の既定）では global.Promise は Hermes ネイティブ製で、
//     promise ポリフィルの rejection-tracking は**効かない**。
//     HermesInternal.enablePromiseRejectionTracker を使う。
//     （node_modules/react-native/Libraries/Core/polyfillPromise.js が同じ分岐をしている）
//   ・JSC など Hermes 以外では promise/setimmediate 版が global.Promise になるので、
//     require('promise/setimmediate/rejection-tracking').enable(...) が効く。
//   ・RN はどちらも __DEV__ のときしか有効にしない＝**リリースビルドでは1件も観測できない**のが
//     P1-8 の中身。ここで本番にも入れる。
//   ・__DEV__ では RN が入れた LogBox 用のトラッカーを上書きしてしまうため触らない
//     （赤箱が消えると開発時の発見が遅れる。本番の観測が目的なのでDEVは現状維持）。
//
// 送信はベストエフォート（クラッシュ処理の中でさらに失敗しても何も壊さない）。
// 同じ内容（name+message）の連投だけを1分に1件へ絞る。種類が違うクラッシュは通す
// ＝起動直後に別種のクラッシュが続いても最初の1件で打ち切らない（QA P1-8 の副次指摘）。
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { supabase } from './supabase';
import { API } from './api';

/** 直近に送った時刻（キーは name+message）。同一内容の連投だけを間引く */
const lastSentAt = new Map<string, number>();
const THROTTLE_MS = 60_000;
/** 種類が無限に増えても地図が太らないように上限を置く（超えたら古い順に落とす） */
const MAX_KINDS = 50;

/** テスト用: 連投ガードの記憶を消す */
export function __resetCrashThrottle(): void {
  lastSentAt.clear();
}

/** 同一内容が1分以内に送られていなければ true（送ってよい）。送るなら時刻を記録する */
function passThrottle(key: string, now: number): boolean {
  const prev = lastSentAt.get(key);
  if (prev != null && now - prev < THROTTLE_MS) return false;
  lastSentAt.set(key, now);
  if (lastSentAt.size > MAX_KINDS) {
    const oldest = lastSentAt.keys().next();
    if (!oldest.done) lastSentAt.delete(oldest.value);
  }
  return true;
}

export async function reportCrash(name: string, message: string, stack?: string, fatal = false): Promise<void> {
  try {
    if (!passThrottle(`${name} ${message}`, Date.now())) return;
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

/** 拒否された値を name / message / stack に均す（Error以外も投げられる） */
function describeRejection(e: unknown): { name: string; message: string; stack?: string } {
  if (e instanceof Error) {
    return { name: e.name || 'UnhandledRejection', message: e.message || String(e), stack: e.stack };
  }
  if (e != null && typeof e === 'object') {
    const o = e as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof o.message === 'string') {
      return {
        name: typeof o.name === 'string' && o.name ? o.name : 'UnhandledRejection',
        message: o.message,
        stack: typeof o.stack === 'string' ? o.stack : undefined,
      };
    }
    try { return { name: 'UnhandledRejection', message: JSON.stringify(e).slice(0, 500) }; } catch { /* 循環参照 */ }
  }
  return { name: 'UnhandledRejection', message: String(e) };
}

type HermesGlobal = typeof globalThis & {
  HermesInternal?: {
    hasPromise?: () => boolean;
    enablePromiseRejectionTracker?: (opts: {
      allRejections: boolean;
      onUnhandled: (id: number, e: unknown) => void;
      onHandled?: (id: number) => void;
    }) => void;
  };
};

/**
 * 未処理拒否のトラッカーを入れる。どちらの経路で入ったかを返す（テスト・調査用）。
 * 'skipped-dev' は「DEVではRNのLogBox版をそのまま使う」という意図的な非設置。
 */
export function installRejectionTracker(): 'hermes' | 'polyfill' | 'skipped-dev' | 'none' {
  const onUnhandled = (_id: number, e: unknown) => {
    const d = describeRejection(e);
    void reportCrash(d.name, d.message, d.stack, false);
  };
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) return 'skipped-dev';
    const hermes = (globalThis as HermesGlobal).HermesInternal;
    if (hermes?.hasPromise?.() && typeof hermes.enablePromiseRejectionTracker === 'function') {
      hermes.enablePromiseRejectionTracker({ allRejections: true, onUnhandled });
      return 'hermes';
    }
    // Hermes以外（JSC等）: global.Promise は promise ポリフィルなので rejection-tracking が効く
    const tracking = require('promise/setimmediate/rejection-tracking') as {
      enable: (opts: { allRejections: boolean; onUnhandled: (id: number, e: unknown) => void }) => void;
    };
    tracking.enable({ allRejections: true, onUnhandled });
    return 'polyfill';
  } catch {
    return 'none';   // 計測が入らなくてもアプリは動く
  }
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
  installRejectionTracker();
}
