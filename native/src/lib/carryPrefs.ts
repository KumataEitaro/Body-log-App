// 繰り越し調整（lib/carryover.ts）の**聞き方と日数**の端末保存と、それを読むフック。
//
// 保存先は端末（AsyncStorage）。lib/kcalAdjust.ts と同じ流儀で、DB の列を待たずに全画面へ即反映できる。
// 承認済みの調整そのもの（額・日数）は events テーブルの行に固定されているので、
// ここの日数を変えても過去の約束は変わらない（次に聞くときの既定になるだけ）。
//
//   mode: 'ask'（既定・ずれた日にカードで聞く）/ 'auto'（起床後に自動で織り込む）/ 'off'（使わない）
//   days: 何日に分けるか（既定 7）
//   dismissed: 「今回は調整しない」を選んだ日付（同じ日を二度聞かない。30日で掃除）
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { addDays } from './goal';
import { CARRY_DAYS_DEFAULT, clampCarryDays, type CarryMode } from './carryover';

export const CARRY_MODE_KEY = 'bl-carry-mode';
export const CARRY_DAYS_KEY = 'bl-carry-days';
export const CARRY_DISMISS_KEY = 'bl-carry-dismiss';

export type CarryPrefs = { mode: CarryMode; days: number };

export function parseCarryMode(v: unknown): CarryMode {
  return v === 'auto' || v === 'off' ? v : 'ask';
}

export async function readCarryPrefs(): Promise<CarryPrefs> {
  try {
    const [m, d] = await Promise.all([AsyncStorage.getItem(CARRY_MODE_KEY), AsyncStorage.getItem(CARRY_DAYS_KEY)]);
    return { mode: parseCarryMode(m), days: clampCarryDays(d ?? CARRY_DAYS_DEFAULT) };
  } catch { return { mode: 'ask', days: CARRY_DAYS_DEFAULT }; }
}

export async function writeCarryPrefs(p: Partial<CarryPrefs>): Promise<void> {
  try {
    if (p.mode != null) await AsyncStorage.setItem(CARRY_MODE_KEY, parseCarryMode(p.mode));
    if (p.days != null) await AsyncStorage.setItem(CARRY_DAYS_KEY, String(clampCarryDays(p.days)));
  } catch { /* 端末保存の失敗は静かに（既定で動き続ける） */ }
}

export async function readCarryDismissed(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(CARRY_DISMISS_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** その日の調整を「今回はしない」。30日より前の日付は掃除する。戻り値は保存後の一覧 */
export async function dismissCarry(date: string, todayISO: string): Promise<string[]> {
  const cur = await readCarryDismissed();
  const floor = addDays(todayISO, -30);
  const next = [...cur.filter((d) => d >= floor && d !== date), date];
  try { await AsyncStorage.setItem(CARRY_DISMISS_KEY, JSON.stringify(next)); } catch { /* 同上 */ }
  return next;
}

/**
 * 聞き方と日数（端末保存）。目標画面で変えて戻ってきたときに追従するよう、フォーカスごとに読み直す。
 * `loaded` が false の間は既定値が入っている＝カードの出し分けは loaded を待つ（既定の「聞く」で一瞬出さない）
 */
export function useCarryPrefs(): CarryPrefs & {
  loaded: boolean;
  setMode: (m: CarryMode) => void;
  setDays: (n: number) => void;
} {
  const [prefs, setPrefs] = useState<CarryPrefs>({ mode: 'ask', days: CARRY_DAYS_DEFAULT });
  const [loaded, setLoaded] = useState(false);
  const read = useCallback(() => { readCarryPrefs().then((p) => { setPrefs(p); setLoaded(true); }); }, []);
  useEffect(() => { read(); }, [read]);
  useFocusEffect(read);
  const setMode = useCallback((mode: CarryMode) => {
    setPrefs((p) => ({ ...p, mode }));
    writeCarryPrefs({ mode });
  }, []);
  const setDays = useCallback((n: number) => {
    const days = clampCarryDays(n);
    setPrefs((p) => ({ ...p, days }));
    writeCarryPrefs({ days });
  }, []);
  return { ...prefs, loaded, setMode, setDays };
}
