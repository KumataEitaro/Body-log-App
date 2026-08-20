// プロフィールのアイコン。
//
// profilesテーブルに列を足すとSQLの実行が必要になるため、まずは端末内に保存する。
// 見た目の設定であり、失われても記録に影響しないので端末ごとで問題ない
// （テーマや言語の設定と同じ扱い）。
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'bl-avatar';
const DEFAULT_AVATAR = '💪';

/**
 * 選べるアイコン（120種）。グループごとに並べ、選ぶときに探しやすくする。
 * 肌色や性別が固定される絵文字は、特定の人を排除しないよう避けている。
 */
export const AVATAR_GROUPS: { key: string; label: string; items: string[] }[] = [
  {
    key: 'body',
    label: '体づくり',
    items: ['💪', '🏋️', '🤸', '🧘', '🤾', '🚴', '🏃', '🚶', '🧗', '🤺',
            '🏊', '🏄', '⛷️', '🏂', '🛹', '🛼', '⛹️', '🤼', '🥊', '🥋'],
  },
  {
    key: 'sports',
    label: 'スポーツ',
    items: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🥏', '🎱', '🏓',
            '🏸', '🥅', '⛳', '🎣', '🥌', '🛷', '🎿', '🏹', '🏆', '🥇'],
  },
  {
    key: 'food',
    label: '食べもの',
    items: ['🥗', '🍎', '🍌', '🍇', '🍓', '🍊', '🥝', '🍉', '🥑', '🥦',
            '🥕', '🌽', '🍅', '🍠', '🥚', '🍳', '🍚', '🍞', '🐟', '🍗'],
  },
  {
    key: 'drink',
    label: '飲みもの',
    items: ['🥤', '☕', '🍵', '🧃', '🧋', '🥛', '💧', '🧊', '🍯', '🫖'],
  },
  {
    key: 'mood',
    label: '気分',
    items: ['😀', '😄', '😌', '🙂', '😎', '🤩', '🥳', '😤', '🫠', '🥱',
            '🔥', '⭐', '✨', '💫', '🎯', '🚀', '🌈', '☀️', '🌙', '⚡'],
  },
  {
    key: 'nature',
    label: '自然',
    items: ['🌱', '🌿', '🍀', '🌸', '🌻', '🌊', '⛰️', '🏔️', '🌲', '🍃'],
  },
  {
    key: 'animal',
    label: 'どうぶつ',
    items: ['🐶', '🐱', '🐰', '🐻', '🐼', '🦊', '🐧', '🦁', '🐯', '🐨',
            '🐮', '🐷', '🐸', '🐵', '🦄', '🐢', '🦋', '🐝', '🦉', '🐺'],
  },
];

/** 一覧（保存値の検証に使う） */
export const AVATARS: readonly string[] = AVATAR_GROUPS.flatMap((g) => g.items);

let current: string = DEFAULT_AVATAR;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadAvatar(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    // 一覧から消えた絵文字が保存されていても既定に戻す（表示が壊れないように）
    if (v && AVATARS.includes(v)) current = v;
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
