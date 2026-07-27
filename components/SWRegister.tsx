'use client';
import { useEffect } from 'react';

// 以前導入した Service Worker を「解除」する。
// SWの資産キャッシュが、動的importのハングや古いJSの配信など、ネイティブ機能の不具合を
// 繰り返し引き起こしていたため無効化する。データキャッシュ（localStorage）とオフライン記録
// キューはSWとは無関係に動くため、そちらのオフライン機能は維持される。
export default function SWRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        // SWが作った資産キャッシュも掃除（常に最新JSが読まれるように）
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.filter((k) => k.startsWith('bl-')).map((k) => caches.delete(k)));
        }
      } catch { /* 無視 */ }
    })();
  }, []);
  return null;
}
