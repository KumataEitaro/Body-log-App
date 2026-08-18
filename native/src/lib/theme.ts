// テーマ設定（画面全体の配色 ＋ P/F/Cバーの配色。この2つは独立した設定）
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyPalette, type Palette } from './ui';

export type AccentKey = 'green' | 'blue' | 'purple' | 'orange' | 'pink' | 'graphite';

// アクセントだけでなく、背景・罫線・文字まで同じ色相へ寄せて雰囲気ごと変える
export const PALETTES: Record<AccentKey, Palette> = {
  green: {
    bg: '#fbfbfa', panel: '#ffffff', ink: '#0e1116', sub: '#6a7280', faint: '#9aa1ab', line: '#e9eae7',
    teal: '#059669', tealWeak: '#e1f5ee', accentSoft: '#f2faf7', accentBadge: '#e6f7f2',
    accentBorder: 'rgba(5,150,105,0.30)', track: '#eceeeb', chipBg: '#f4f5f3', segTrack: '#eef0ee',
    pressed: '#f1f3f0', calorieBar: '#3f4c5a', coral: '#e85c50', coralWeak: '#fdeeec', amber: '#b8860b',
  },
  blue: {
    bg: '#fafbfd', panel: '#ffffff', ink: '#0d1219', sub: '#64707f', faint: '#98a2b0', line: '#e5e9f0',
    teal: '#2563eb', tealWeak: '#e4ecfd', accentSoft: '#f4f7fe', accentBadge: '#e8effd',
    accentBorder: 'rgba(37,99,235,0.30)', track: '#e9edf3', chipBg: '#f2f5f9', segTrack: '#eaeff5',
    pressed: '#eef2f7', calorieBar: '#475569', coral: '#e2544f', coralWeak: '#fdeceb', amber: '#b07d0a',
  },
  purple: {
    bg: '#fcfafd', panel: '#ffffff', ink: '#130f18', sub: '#6d6579', faint: '#a099ab', line: '#ebe6f0',
    teal: '#7c3aed', tealWeak: '#eee7fd', accentSoft: '#f8f5fe', accentBadge: '#f0e9fd',
    accentBorder: 'rgba(124,58,237,0.30)', track: '#eee9f2', chipBg: '#f6f3f8', segTrack: '#f0ebf4',
    pressed: '#f2eef6', calorieBar: '#4a4257', coral: '#df5568', coralWeak: '#fceced', amber: '#a9790f',
  },
  orange: {
    bg: '#fdfbf9', panel: '#ffffff', ink: '#171210', sub: '#7a6d64', faint: '#ada298', line: '#f0e9e3',
    teal: '#ea580c', tealWeak: '#fdeade', accentSoft: '#fef7f2', accentBadge: '#fdeee3',
    accentBorder: 'rgba(234,88,12,0.30)', track: '#f2ece7', chipBg: '#f8f5f2', segTrack: '#f3ede8',
    pressed: '#f5f0eb', calorieBar: '#5a4a3f', coral: '#d94436', coralWeak: '#fceae7', amber: '#a97a12',
  },
  pink: {
    bg: '#fdfafb', panel: '#ffffff', ink: '#171114', sub: '#7a6772', faint: '#ad9ca5', line: '#f0e6eb',
    teal: '#db2777', tealWeak: '#fce4ef', accentSoft: '#fef5f9', accentBadge: '#fce8f1',
    accentBorder: 'rgba(219,39,119,0.30)', track: '#f2eaee', chipBg: '#f8f3f5', segTrack: '#f3ecef',
    pressed: '#f5eef1', calorieBar: '#57424c', coral: '#d6453f', coralWeak: '#fceae9', amber: '#a97a12',
  },
  graphite: {
    bg: '#fafafa', panel: '#ffffff', ink: '#101214', sub: '#6b7280', faint: '#9ca3af', line: '#e6e7e9',
    teal: '#475569', tealWeak: '#e7eaee', accentSoft: '#f5f6f8', accentBadge: '#eaedf1',
    accentBorder: 'rgba(71,85,105,0.32)', track: '#ebecee', chipBg: '#f4f5f6', segTrack: '#eef0f1',
    pressed: '#f0f1f3', calorieBar: '#1e293b', coral: '#dc5348', coralWeak: '#fceceb', amber: '#a9800f',
  },
};

export const ACCENTS: { key: AccentKey; label: string; color: string }[] = [
  { key: 'green', label: 'グリーン', color: PALETTES.green.teal },
  { key: 'blue', label: 'ブルー', color: PALETTES.blue.teal },
  { key: 'purple', label: 'パープル', color: PALETTES.purple.teal },
  { key: 'orange', label: 'オレンジ', color: PALETTES.orange.teal },
  { key: 'pink', label: 'ピンク', color: PALETTES.pink.teal },
  { key: 'graphite', label: 'グラファイト', color: PALETTES.graphite.teal },
];

// ===== P/F/Cバーの配色（テーマとは独立した設定） =====
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
  applyPalette(PALETTES[prefs.accent] ?? PALETTES.green);
  emit();
}

export async function setTheme(patch: Partial<ThemePrefs>): Promise<void> {
  prefs = { ...prefs, ...patch };
  applyPalette(PALETTES[prefs.accent] ?? PALETTES.green);
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
