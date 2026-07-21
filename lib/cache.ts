'use client';
// 前回表示データの端末キャッシュ（stale-while-revalidate用）。
// 「まずキャッシュを即表示→裏で最新を取得して差し替え」に使う。
// localStorageが使えない環境では静かに何もしない。

const PREFIX = 'blc:';

export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* 容量超過などは無視 */ }
}

// ログアウト時に全キャッシュを消す（共用端末での他人データ表示を防ぐ）
export function cacheClearAll(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX) || k.startsWith('blq:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* 無視 */ }
}
