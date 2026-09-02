// 日付跨ぎ（JST 0時）の追従。
//
// 食事タブ・運動タブの表示日 viewDate は useState(todayJST()) で一度だけ決まる。タブは常駐する
// ため、夜に開いたまま翌朝に戻ってくると viewDate は「昨日」のまま残り、
//  ・入力シートが「9/1(月) の記録」とアンバーで出る（本人は今日のつもり）
//  ・「いま」チップが消え、既定が 12:00 になる → 朝食が昨日の12:00として保存される
//  ・朝の気分カードが出ない（今日ではない扱い）
// という形で記録が1日ズレる（2026-09-02 自己監査 docs/SELF-AUDIT-1.1.md で発見）。
//
// 規則は純関数 rolloverDate に閉じ、フックはそれを「タブに戻ったとき」「アプリが前景に戻ったとき」に
// 呼ぶだけ。過去日をわざわざ見ている人の表示日は動かさない。
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { todayJST } from './calc';

/**
 * 表示日を新しい「今日」へ寄せるべきか。
 *  ・直前まで表示日 = その時点の今日 だった（＝本人は「今日」を見ていた）なら新しい今日へ
 *  ・過去日を見ていたなら触らない
 *  ・日付が変わっていなければそのまま
 */
export function rolloverDate(viewDate: string, prevToday: string, nowToday: string): string {
  if (prevToday === nowToday) return viewDate;
  return viewDate === prevToday ? nowToday : viewDate;
}

/** viewDate を「今日」に追従させる（タブのフォーカス時・アプリ前景復帰時に判定） */
export function useTodayRollover(viewDate: string, setViewDate: (d: string) => void): void {
  const knownToday = useRef(todayJST());
  const check = useCallback(() => {
    const now = todayJST();
    const next = rolloverDate(viewDate, knownToday.current, now);
    knownToday.current = now;
    if (next !== viewDate) setViewDate(next);
  }, [viewDate, setViewDate]);
  useFocusEffect(check);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
    return () => sub.remove();
  }, [check]);
}
