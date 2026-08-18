// テーマ設定（アクセント色 ＋ P/F/Cバーの色）
// 保存はAsyncStorage。変更するとui.tsのapplyAccentが既存スタイルまで遡って書き換える。
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyAccent } from './ui';

export type AccentKey = 'green' | 'blue' | 'purple' | 'orange' | 'pink' | 'graphite';

export const ACCENTS: { key: AccentKey; label: string; color: string; weak: string }[] = [
  { key: 'green', label: 'グリーン', color: '#059669', weak: '#e1f5ee' },
  { key: 'blue', label: 'ブルー', color: '#2563eb', weak: '#e4ecfd' },
  { key: 'purple', label: 'パープル', color: '#7c3aed', weak: '#eee7fd' },
  { key: 'orange', label: 'オレンジ', color: '#ea580c', weak: '#fdeae0' },
  { key: 'pink', label: 'ピンク', color: '#db2777', weak: '#fce4ef' },
  { key: 'graphite', label: 'グラファイト', color: '#334155', weak: '#e6e9ee' },
];

// P/F/Cバーの配色プリセット
export type PfcKey = 'classic' | 'warm' | 'cool' | 'accessible' | 'mono';
export type PfcColors = { p: string; f: string; c: string };

export const PFC_PRESETS: { key: PfcKey; label: string; note: string; colors: PfcColors }[] = [
  { key: 'classic', label: 'スタンダード', note: '緑・橙・青', colors: { p: '#059669', f: '#d97706', c: '#3b82f6' } },
  { key: 'warm', label: 'ウォーム', note: '赤・橙・黄', colors: { p: '#dc2626', f: '#ea580c', c: '#ca8a04' } },
  { key: 'cool', label: 'クール', note: '藍・青・水', colors: { p: '#4f46e5', f: '#0891b2', c: '#0ea5e9' } },
  { key: 'accessible', label: '色覚に配慮', note: '青・橙・紫（識別しやすい）', colors: { p: '#0072b2', f: '#e69f00', c: '#9061c2' } },
  { key: 'mono', label: 'モノトーン', note: '濃淡だけで区別', colors: { p: '#1f2937', f: '#6b7280', c: '#b2b8c2' } },
];

export type ThemePrefs = { accent: AccentKey; pfc: PfcKey };
export const DEFAULT_THEME: ThemePrefs = { accent: 'green', pfc: 'classic' };
const KEY = 'bl-theme';

let prefs: ThemePrefs = DEFAULT_THEME;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function accentOf(k: AccentKey) { return ACCENTS.find((a) => a.key === k) ?? ACCENTS[0]; }
export function pfcColors(k: PfcKey = prefs.pfc): PfcColors {
  return (PFC_PRESETS.find((p) => p.key === k) ?? PFC_PRESETS[0]).colors;
}

export async function loadTheme(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ThemePrefs>;
      prefs = { ...DEFAULT_THEME, ...p };
    }
  } catch { /* 既定のまま */ }
  const a = accentOf(prefs.accent);
  applyAccent(a.color, a.weak);
  emit();
}

export async function setTheme(patch: Partial<ThemePrefs>): Promise<void> {
  prefs = { ...prefs, ...patch };
  const a = accentOf(prefs.accent);
  applyAccent(a.color, a.weak);
  emit();
  try { await AsyncStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 表示は既に切り替わっている */ }
}

export function getTheme(): ThemePrefs { return prefs; }

export function useTheme(): ThemePrefs {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getTheme,
    getTheme,
  );
}
