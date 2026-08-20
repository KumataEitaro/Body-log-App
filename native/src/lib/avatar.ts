// プロフィールのアイコン。
//
// profilesテーブルに列を足すとSQLの実行が必要になるため、まずは端末内に保存する。
// 見た目の設定であり、失われても記録に影響しないので端末ごとで問題ない
// （テーマや言語の設定と同じ扱い）。
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'bl-avatar';
const DEFAULT_AVATAR = '💪';

/** 選べるアイコン。体づくり・食事・気分の順に並べる */
export const AVATARS = [
  '💪', '🏃', '🚶', '🧘', '🏋️', '🚴', '🏊', '⚽',
  '🥗', '🍎', '🥦', '🍚', '🍳', '☕', '🍵', '🥤',
  '😀', '😌', '🔥', '⭐', '🌱', '🌸', '🌊', '⛰️',
  '🐶', '🐱', '🐰', '🐻', '🐼', '🦊', '🐧', '🦁',
] as const;

let current: string = DEFAULT_AVATAR;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadAvatar(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    // 一覧から消えた絵文字が保存されていても既定に戻す（表示が壊れないように）
    if (v && (AVATARS as readonly string[]).includes(v)) current = v;
  } catch { /* 既定のまま */ }
  emit();
}

export async function setAvatar(v: string): Promise<void> {
  current = v;
  emit();
  try { await AsyncStorage.setItem(KEY, v); } catch { /* 表示は既に変わっている */ }
}

export function getAvatar(): string { return current; }

export function useAvatar(): string {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getAvatar,
    getAvatar,
  );
}
