'use client';
import { useEffect } from 'react';

// オフラインシェル用 Service Worker の登録（機内モードでも画面骨格を表示するため）。
// 過去に旧SWが動的importのハングを引き起こした教訓から、新SW（public/sw.js）は
// 「ネットワーク優先・API/外部オリジン非介入・キャッシュ優先はハッシュ付き静的アセットのみ」
// の最小介入設計になっている（動的import自体も全廃済み）。
// データのオフライン表示（localStorageキャッシュ）と記録キューはSWと無関係に従来どおり動く。
export default function SWRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 未対応環境は無視 */ });
  }, []);
  return null;
}
