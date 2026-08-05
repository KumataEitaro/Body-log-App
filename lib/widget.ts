'use client';
// ホーム画面ウィジェットへの今日サマリー書き出し。
// 鉄則: 動的import禁止。静的registerPlugin＋キャッシュ（lib/health.ts / lib/photos.ts と同方式）。
// ウィジェット未搭載の旧バイナリ・Web版では静かに no-op。

import { registerPlugin } from '@capacitor/core';

export type WidgetData = {
  date: string;        // yyyy-MM-dd (JST)
  eaten: number;
  goal: number;
  left: number;
  pEaten: number;
  pGoal: number;
  todayLogged: boolean;
  yUnrec: boolean;     // 昨日が未記録
  asOf: string;        // "12:34"
};

type WidgetPluginT = { sync(o: { json: string }): Promise<{ ok: boolean }> };

type CapGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
};

function capGlobal(): CapGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
}

let _plugin: WidgetPluginT | null | undefined;
function plugin(): WidgetPluginT | null {
  const cap = capGlobal();
  if (!cap?.isNativePlatform?.() || cap.isPluginAvailable?.('Widget') !== true) return null;
  if (_plugin !== undefined) return _plugin;
  try { _plugin = registerPlugin<WidgetPluginT>('Widget'); } catch { _plugin = null; }
  return _plugin;
}

// 投げっぱなしでOK（失敗してもアプリ本体に影響させない）
export function widgetSync(data: WidgetData): void {
  const p = plugin();
  if (!p) return;
  try { void p.sync({ json: JSON.stringify(data) }).catch(() => { /* 無視 */ }); } catch { /* 無視 */ }
}
