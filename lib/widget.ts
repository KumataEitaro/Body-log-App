'use client';
// ホーム画面ウィジェットへの今日サマリー書き出し。
// 鉄則: 動的import禁止。静的registerPlugin＋キャッシュ（lib/health.ts / lib/photos.ts と同方式）。
// ウィジェット未搭載の旧バイナリ・Web版では静かに no-op。

import { registerPlugin } from '@capacitor/core';

// 中サイズ用: 過去の1日分の収支（v=null は未記録日）
export type WidgetDay = { l: string; v: number | null };

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
  days?: WidgetDay[];  // 昨日までの6日（古い順・曜日ラベル＋収支）
  weekSum?: number;    // 上記の合計（記録日のみ）
  weekUnknown?: number; // 未記録日数
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
