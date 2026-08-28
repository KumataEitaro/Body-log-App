// ホーム画面ウィジェット（iOS・B-9）への今日サマリー書き出し。
//
// 設計:
//  ・重い計画計算はしない。食事タブが lib/dayStatus に置いた計算結果（目標kcal・摂取済み）と、
//    軽量ストリーク quickStreak()（日付列だけの2クエリ＋5分キャッシュ）だけを使う
//  ・呼び出しは lib/sync.ts の syncEntriesForDate 末尾（＝全保存経路の合流点）から投げっぱなし
//  ・native module が無い環境（Expo Go / Android / Web / 旧ビルド / Jest）では
//    modules/widget-bridge 側が no-op になるため、ここでは存在を気にしない
import { getDayStatus } from '@/lib/dayStatus';
import { quickStreak } from '@/lib/achievements';
import { todayJST } from '@/lib/calc';
import { setWidgetData } from '../../modules/widget-bridge';

/** ウィジェット（native/widget/BodyLogWidget.swift）が読むJSONの形。キー名はSwift側と揃える */
export type WidgetPayload = {
  date: string;          // データが対象とする日 (yyyy-MM-dd, JST)
  left: number | null;   // 残りkcal（負=オーバー・null=今日の計画が未計算）
  goal: number | null;   // 目標kcal
  eaten: number | null;  // 摂取済みkcal
  streak: number;        // 連続記録日数（🔥）
  asOf: string;          // "12:34" 書き出し時刻（端末ローカル）
};

/**
 * ウィジェット用データを書き出す。投げっぱなし・失敗無視で呼ぶこと。
 * 注: quickStreak は5分キャッシュのため、保存直後は1日ぶん遅れることがある
 * （次の保存かキャッシュ切れで追いつく。ウィジェットは目安表示なので許容）。
 */
export async function updateWidgetData(): Promise<void> {
  try {
    const s = getDayStatus();   // 食事タブ未表示ならnull（その場合は残量なしで書く）
    const streak = await quickStreak();
    const now = new Date();
    const asOf = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const payload: WidgetPayload = {
      date: todayJST(),
      left: s ? Math.round(s.goalKcal - s.eaten) : null,
      goal: s ? Math.round(s.goalKcal) : null,
      eaten: s ? Math.round(s.eaten) : null,
      streak,
      asOf,
    };
    setWidgetData(JSON.stringify(payload));
  } catch {
    // ウィジェットは付随機能。失敗してもアプリ本体に影響させない
  }
}
