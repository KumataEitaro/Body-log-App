'use client';
// 自前のフォトライブラリブリッジ（plugins/capacitor-health/ios/Plugin/PhotosPlugin.swift）のJS側。
// 鉄則: 動的 import（await import('@capacitor/...')）は WebView 環境で固まることがあるため使わない。
// 静的 registerPlugin ＋ モジュールキャッシュで同期取得する（lib/native.ts / lib/health.ts と同じ方式）。

import { registerPlugin } from '@capacitor/core';
import { base64ToPhoto, recordDiag, type NativePhoto, type PickPhotoResult } from '@/lib/native';

export type PhotoAuth = 'granted' | 'limited' | 'denied' | 'notDetermined' | 'unavailable';
export type RecentPhoto = { id: string; thumbUrl: string };

type PhotosPluginT = {
  authStatus(): Promise<{ status: string }>;
  requestAccess(): Promise<{ status: string }>;
  getRecents(o: { count?: number; size?: number }): Promise<{ photos: { id: string; thumb: string }[]; status: string }>;
  getPhoto(o: { id: string; maxSize?: number }): Promise<{ base64: string; mime: string }>;
  pickPhoto(): Promise<{ base64?: string; mime?: string; cancelled?: boolean }>;
  openSettings(): Promise<{ opened: boolean }>;
  presentLimitedPicker(): Promise<void>;
  binaryInfo(): Promise<{ version: string; build: string }>;
};

type CapGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
};

function capGlobal(): CapGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
}

// ネイティブかつ Photos プラグインが今のアプリバイナリに入っているか（同期）。
// 古いバイナリ（プラグイン未搭載）では false → 呼び出し側はアルバムタイル等へフォールバック。
export function isNativePhotosAvailable(): boolean {
  const cap = capGlobal();
  return !!cap?.isNativePlatform?.() && cap.isPluginAvailable?.('Photos') === true;
}

let _plugin: PhotosPluginT | null = null;
function plugin(): PhotosPluginT | null {
  if (!isNativePhotosAvailable()) return null;
  if (_plugin) return _plugin;
  try {
    _plugin = registerPlugin<PhotosPluginT>('Photos');
    return _plugin;
  } catch {
    return null;
  }
}

// ネイティブ呼び出しが返ってこない事故に備えたタイムアウト
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))]);
}

function toAuth(s: string | undefined): PhotoAuth {
  if (s === 'granted' || s === 'limited' || s === 'denied' || s === 'notDetermined') return s;
  return 'unavailable';
}

export async function photosAuthStatus(): Promise<PhotoAuth> {
  const p = plugin();
  if (!p) return 'unavailable';
  try {
    const r = await withTimeout(p.authStatus(), 5000);
    return toAuth(r?.status);
  } catch {
    return 'unavailable';
  }
}

export async function photosRequestAccess(): Promise<PhotoAuth> {
  const p = plugin();
  if (!p) return 'unavailable';
  try {
    const r = await withTimeout(p.requestAccess(), 120000); // 許可ダイアログの操作待ち
    return toAuth(r?.status);
  } catch {
    return 'unavailable';
  }
}

// 直近のカメラロール画像サムネイル（表示用dataURLに変換して返す）
export async function photosRecents(count = 24, size = 160): Promise<RecentPhoto[]> {
  const p = plugin();
  if (!p) return [];
  try {
    const r = await withTimeout(p.getRecents({ count, size }), 12000);
    if (!r) recordDiag('photos.getRecents: タイムアウト(12秒)');
    return (r?.photos || []).map((x) => ({ id: x.id, thumbUrl: `data:image/jpeg;base64,${x.thumb}` }));
  } catch (e) {
    recordDiag(`photos.getRecents: ${e instanceof Error ? e.message : String(e)}`.slice(0, 140));
    return [];
  }
}

// バイナリのバージョン情報（設定画面の診断で「どのビルドが入っているか」を確認する用）
export async function photosBinaryInfo(): Promise<{ version: string; build: string } | null> {
  const p = plugin();
  if (!p) return null;
  try {
    return await withTimeout(p.binaryInfo(), 5000);
  } catch {
    return null;
  }
}

// サムネイルで選んだ1枚をフルサイズで取得（iCloud写真のダウンロードがあり得るため長め）
export async function photosFull(id: string): Promise<NativePhoto | null> {
  const p = plugin();
  if (!p) return null;
  try {
    const r = await withTimeout(p.getPhoto({ id, maxSize: 1280 }), 30000);
    if (!r?.base64) { recordDiag('photos.getPhoto: 空応答/タイムアウト'); return null; }
    return base64ToPhoto(r.base64, r.mime || 'image/jpeg');
  } catch (e) {
    recordDiag(`photos.getPhoto: ${e instanceof Error ? e.message : String(e)}`.slice(0, 140));
    return null;
  }
}

// アプリの設定画面を開く（写真アクセスが「なし/限定」の時にフルアクセスへ誘導する）
export async function photosOpenSettings(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    const r = await withTimeout(p.openSettings(), 8000);
    return !!r?.opened;
  } catch {
    return false;
  }
}

// 限定アクセス時に「選択した写真」を追加・変更するOSシートを開く（閉じるまで待つ）
export async function photosPresentLimitedPicker(): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    await withTimeout(p.presentLimitedPicker(), 300000); // シート操作待ち
  } catch { /* 無視 */ }
}

// OSの写真グリッド（PHPicker）を直接開く。権限不要・選択プロンプトなし
export async function photosPick(): Promise<PickPhotoResult> {
  const p = plugin();
  if (!p) return { photo: null, error: '写真プラグインが利用できません' };
  try {
    const r = await withTimeout(p.pickPhoto(), 180000); // 選択操作待ち
    if (!r || r.cancelled || !r.base64) return { photo: null, error: null }; // キャンセル扱い
    return { photo: base64ToPhoto(r.base64, r.mime || 'image/jpeg'), error: null };
  } catch (e) {
    return { photo: null, error: e instanceof Error ? e.message : String(e) };
  }
}
