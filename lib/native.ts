'use client';
// ネイティブアプリ（Capacitor）専用機能のヘルパー。
// 重要: 動的 import（await import('@capacitor/...')）は WebView + Service Worker 環境で
// 稀にチャンク読み込みが応答を返さず固まる。そのため一切使わず、ネイティブが必ず注入する
// window.Capacitor.Plugins を「同期」で参照して各プラグインを呼ぶ。
// ブラウザ実行時は window.Capacitor が無い/非ネイティブなので静かに no-op になる。

// 静的import：ページのJSチャンクに同梱され読込時に確定する（呼び出し時の動的フェッチが無く固まらない）。
import { registerPlugin } from '@capacitor/core';

export type NativePhoto = { blob: Blob; dataUrl: string; base64: string; mime: string };

type CapGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
};

function capGlobal(): CapGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
}

// 同期のネイティブ判定
export function isNativeSync(): boolean {
  return !!capGlobal()?.isNativePlatform?.();
}

// 指定プラグインのプロキシを同期で取得（未ネイティブなら null）。
// registerPlugin は同名で2回呼ぶと警告が出るため、モジュールスコープで1回だけ生成してキャッシュする。
const _plugins = new Map<string, unknown>();
function nativePlugin<T = Record<string, (...args: unknown[]) => Promise<unknown>>>(name: string): T | null {
  if (!isNativeSync()) return null;
  if (_plugins.has(name)) return _plugins.get(name) as T;
  try {
    const p = registerPlugin<T>(name);
    _plugins.set(name, p);
    return p;
  } catch {
    return null;
  }
}

// 実行時にカメラ呼び出しが失敗した場合に立てるフラグ。
// 以降のタップは同期でWebのファイル選択に落ちる（＝タップ起点のユーザー操作扱いが保たれ確実に開く）。
let cameraBrokenRuntime = false;

// ネイティブかつCameraプラグインが今のアプリバイナリに入っているか（同期）
export function isNativeCameraAvailable(): boolean {
  if (cameraBrokenRuntime) return false;
  const cap = capGlobal();
  return !!cap?.isNativePlatform?.() && cap.isPluginAvailable?.('Camera') === true;
}

// 互換のため残す（従来 await getIsNative() を使っていた箇所向け）。同期判定をPromiseで返すだけ。
export async function getIsNative(): Promise<boolean> {
  return isNativeSync();
}

// 起動時の見た目調整（ステータスバーをライトUIに合わせる）
export async function setupNativeChrome(): Promise<void> {
  const sb = nativePlugin<{ setStyle: (o: { style: string }) => Promise<void> }>('StatusBar');
  if (!sb) return;
  try { await sb.setStyle({ style: 'LIGHT' }); } catch { /* 非対応は無視 */ }
}

// 保存成功などの触覚フィードバック
export async function hapticSuccess(): Promise<void> {
  const h = nativePlugin<{ notification: (o: { type: string }) => Promise<void> }>('Haptics');
  if (!h) return;
  try { await h.notification({ type: 'SUCCESS' }); } catch { /* 無視 */ }
}

// 軽いタップ感
export async function hapticTap(): Promise<void> {
  const h = nativePlugin<{ impact: (o: { style: string }) => Promise<void> }>('Haptics');
  if (!h) return;
  try { await h.impact({ style: 'LIGHT' }); } catch { /* 無視 */ }
}

// ネイティブカメラの結果。photo=取得成功 / error=失敗理由（表示用） / 両方null=ユーザーキャンセル
export type PickPhotoResult = { photo: NativePhoto | null; error: string | null };

// ネイティブのカメラ/フォトピッカーで1枚取得（1024px・JPEG圧縮済み）。
// 失敗は握り潰さず理由を返す（呼び出し側でエラー表示＋ファイル選択へフォールバックする）。
export async function pickPhotoNative(): Promise<PickPhotoResult> {
  const cam = nativePlugin<{ getPhoto: (o: Record<string, unknown>) => Promise<{ base64String?: string }> }>('Camera');
  if (!cam) {
    cameraBrokenRuntime = true;
    return { photo: null, error: 'カメラプラグインを取得できませんでした' };
  }
  try {
    const photo = await cam.getPhoto({
      resultType: 'base64',
      source: 'PROMPT', // 撮影 or ライブラリを選ばせる
      quality: 80,
      width: 1024,
      correctOrientation: true,
    });
    const base64 = photo.base64String;
    if (!base64) return { photo: null, error: '写真データを取得できませんでした' };
    const mime = 'image/jpeg';
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return { photo: { blob: new Blob([arr], { type: mime }), dataUrl: `data:${mime};base64,${base64}`, base64, mime }, error: null };
  } catch (e) {
    const msg = e instanceof Error ? (e.message || e.name) : String(e);
    if (/cancel/i.test(msg)) return { photo: null, error: null }; // ユーザーキャンセルはエラー扱いしない
    if (/not implemented|unimplemented/i.test(msg)) cameraBrokenRuntime = true; // 以降はファイル選択へ直行
    return { photo: null, error: msg };
  }
}

// 毎日のリマインド通知（端末内で完結）
export async function setDailyReminder(enabled: boolean, hour = 20, minute = 0): Promise<boolean> {
  const ln = nativePlugin<{
    cancel: (o: unknown) => Promise<void>;
    requestPermissions: () => Promise<{ display: string }>;
    schedule: (o: unknown) => Promise<void>;
  }>('LocalNotifications');
  if (!ln) return false;
  try {
    await ln.cancel({ notifications: [{ id: 1 }] }).catch(() => { /* 未登録なら無視 */ });
    if (!enabled) return true;
    const perm = await ln.requestPermissions();
    if (perm.display !== 'granted') return false;
    await ln.schedule({
      notifications: [{
        id: 1,
        title: 'BodyLog',
        body: '今日の記録はまだですか？📝 続けることが一番の近道です',
        schedule: { on: { hour, minute } },
      }],
    });
    return true;
  } catch {
    return false;
  }
}

// アプリアイコンのバッジ
export async function setTodayRecordedBadge(recorded: boolean): Promise<void> {
  const badge = nativePlugin<{
    clear: () => Promise<void>;
    set: (o: { count: number }) => Promise<void>;
    checkPermissions: () => Promise<{ display: string }>;
    requestPermissions: () => Promise<{ display: string }>;
  }>('Badge');
  if (!badge) return;
  try {
    if (recorded) {
      await badge.clear();
    } else {
      const perm = await badge.checkPermissions();
      if (perm.display !== 'granted') {
        const req = await badge.requestPermissions();
        if (req.display !== 'granted') return;
      }
      await badge.set({ count: 1 });
    }
  } catch { /* 無視 */ }
}
