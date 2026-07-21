'use client';
import { useEffect } from 'react';

// Service Worker登録（本番のみ。ローカル開発では登録しない）
export default function SWRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 非対応環境は無視 */ });
  }, []);
  return null;
}
