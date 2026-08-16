'use client';
import { useEffect } from 'react';
import { registerPlugin } from '@capacitor/core';

// iOS WKWebViewで「キーボードを閉じた後も表示領域がずれたまま戻らない」既知バグの矯正。
// （上に空白ができ、タブバーが画面途中に浮く症状）
// ①フォーカスが外れた時 ②キーボードが閉じてvisualViewportの高さが戻った時 ③ネイティブの
// keyboardDidHideイベント（対応ビルドのみ）でスクロール位置と表示領域を強制的に復元する。

type CapGlobal = { isNativePlatform?: () => boolean; isPluginAvailable?: (n: string) => boolean };
type KeyboardPluginT = { addListener: (ev: string, fn: () => void) => Promise<{ remove: () => void }> };

export default function ViewportFix() {
  useEffect(() => {
    const restore = () => {
      setTimeout(() => {
        try {
          window.scrollTo(0, 0);
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
        } catch { /* 無視 */ }
      }, 60);
    };

    window.addEventListener('focusout', restore);

    const vv = window.visualViewport;
    const onVv = () => {
      // キーボードが閉じた（表示領域の高さがほぼ全画面に戻った）タイミングで矯正
      if (vv && vv.height >= window.innerHeight - 60) restore();
    };
    vv?.addEventListener('resize', onVv);

    // ネイティブのKeyboardプラグイン（次ビルド以降）: 閉じたイベントで確実に矯正
    let sub: { remove: () => void } | null = null;
    try {
      const cap = (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
      if (cap?.isNativePlatform?.() && cap.isPluginAvailable?.('Keyboard')) {
        const kb = registerPlugin<KeyboardPluginT>('Keyboard');
        kb.addListener('keyboardDidHide', restore).then((s) => { sub = s; }).catch(() => { /* 無視 */ });
      }
    } catch { /* 無視 */ }

    return () => {
      window.removeEventListener('focusout', restore);
      vv?.removeEventListener('resize', onVv);
      sub?.remove();
    };
  }, []);
  return null;
}
