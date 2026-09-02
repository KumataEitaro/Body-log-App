// 「1日に食べられる量」の手動調整（kcal/日）。
//
// 目標画面は体重・目標日から食べられる量を自動で算出するが、その数字が「きつい」と感じる人が
// 自分で±調整できる余地を残す（続かない計画は最悪の計画）。値は自動値からの差分で持つ。
// 絶対値で持たないのは、体重が変わって自動値が動いたときも「+150kcalゆるめ」の意図を保つため。
//
// 保存先は端末（AsyncStorage）。目標kcalの計算は食事タブ・FAB・運動タブが端末内で行っており、
// DBの列追加（apply-pending.sql）を待たずに全経路へ即反映できる。未設定（null）＝自動値そのまま。
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { clampAdjust } from './deficit';

export const KCAL_ADJUST_KEY = 'bl-kcal-adjust';

/** 保存値を読む（未設定・壊れた値は0） */
export async function readKcalAdjust(): Promise<number> {
  try {
    const v = await AsyncStorage.getItem(KCAL_ADJUST_KEY);
    if (v == null || v === '') return 0;
    return clampAdjust(Number(v));
  } catch { return 0; }
}

/** 手動調整を保存する。null または 0 で「自動値に戻す」（キー自体を消す） */
export async function writeKcalAdjust(n: number | null): Promise<void> {
  try {
    const v = n == null ? 0 : clampAdjust(n);
    if (v === 0) await AsyncStorage.removeItem(KCAL_ADJUST_KEY);
    else await AsyncStorage.setItem(KCAL_ADJUST_KEY, String(v));
  } catch { /* 端末保存の失敗は静かに諦める（自動値で動き続ける） */ }
}

/**
 * 手動調整（kcal/日・0=自動）。目標画面で変えて戻ってきたときに追従するよう、フォーカスごとに読み直す。
 * 返り値の setter は保存もまとめて行う。
 */
export function useKcalAdjust(): [number, (n: number | null) => void] {
  const [adjust, setAdjust] = useState(0);
  const read = useCallback(() => { readKcalAdjust().then(setAdjust); }, []);
  useEffect(() => { read(); }, [read]);
  useFocusEffect(read);
  const set = useCallback((n: number | null) => {
    const v = n == null ? 0 : clampAdjust(n);
    setAdjust(v);
    writeKcalAdjust(v);
  }, []);
  return [adjust, set];
}
