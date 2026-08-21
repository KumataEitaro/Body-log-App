// テーマ設定（画面全体の配色 ＋ P/F/Cバーの配色。この2つは独立した設定）
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyPalette, type Palette } from './ui';

export type AccentKey =
  | 'green' | 'blue' | 'purple' | 'orange' | 'pink' | 'graphite'
  | 'teal' | 'sky' | 'indigo' | 'lime' | 'rose' | 'brown';

// 白と混ぜた淡色を作る（比率は手調整済みパレットから逆算した値）
function mixW(hex: string, ratio: number): string {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * ratio).toString(16).padStart(2, '0');
  };
  return '#' + ch(1) + ch(3) + ch(5);
}

// アクセント色1つからパレット一式を導出（新規テーマはこれで量産できる）
function derivePalette(accent: string): Palette {
  const a = (al: number) => {
    const r = parseInt(accent.slice(1, 3), 16), g = parseInt(accent.slice(3, 5), 16), b = parseInt(accent.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${al})`;
  };
  return {
    bg: mixW(accent, 0.985), panel: '#ffffff', ink: '#0e1116', sub: '#6a7280', faint: '#9aa1ab',
    line: mixW(accent, 0.91), teal: accent, tealWeak: mixW(accent, 0.88),
    accentSoft: mixW(accent, 0.95), accentBadge: mixW(accent, 0.90), accentBorder: a(0.30),
    track: mixW(accent, 0.92), chipBg: mixW(accent, 0.955), segTrack: mixW(accent, 0.93),
    pressed: mixW(accent, 0.94), calorieBar: '#3f4c5a', coral: '#e5484d', coralWeak: '#fdeeec', amber: '#b8860b',
  };
}

// アクセントだけでなく、背景・罫線・文字まで同じ色相へ寄せて雰囲気ごと変える
export const PALETTES: Record<AccentKey, Palette> = {
  green: {
    bg: '#fbfbfa', panel: '#ffffff', ink: '#0e1116', sub: '#6a7280', faint: '#9aa1ab', line: '#e9eae7',
    teal: '#059669', tealWeak: '#e1f5ee', accentSoft: '#f2faf7', accentBadge: '#e6f7f2',
    accentBorder: 'rgba(5,150,105,0.30)', track: '#eceeeb', chipBg: '#f4f5f3', segTrack: '#eef0ee',
    pressed: '#f1f3f0', calorieBar: '#3f4c5a', coral: '#e5484d', coralWeak: '#fdeeec', amber: '#b8860b',
  },
  blue: {
    bg: '#fafbfd', panel: '#ffffff', ink: '#0d1219', sub: '#64707f', faint: '#98a2b0', line: '#e5e9f0',
    teal: '#2563eb', tealWeak: '#e4ecfd', accentSoft: '#f4f7fe', accentBadge: '#e8effd',
    accentBorder: 'rgba(37,99,235,0.30)', track: '#e9edf3', chipBg: '#f2f5f9', segTrack: '#eaeff5',
    pressed: '#eef2f7', calorieBar: '#475569', coral: '#e5484d', coralWeak: '#fdeceb', amber: '#b07d0a',
  },
  purple: {
    bg: '#fcfafd', panel: '#ffffff', ink: '#130f18', sub: '#6d6579', faint: '#a099ab', line: '#ebe6f0',
    teal: '#7c3aed', tealWeak: '#eee7fd', accentSoft: '#f8f5fe', accentBadge: '#f0e9fd',
    accentBorder: 'rgba(124,58,237,0.30)', track: '#eee9f2', chipBg: '#f6f3f8', segTrack: '#f0ebf4',
    pressed: '#f2eef6', calorieBar: '#4a4257', coral: '#e5484d', coralWeak: '#fceced', amber: '#a9790f',
  },
  orange: {
    bg: '#fdfbf9', panel: '#ffffff', ink: '#171210', sub: '#7a6d64', faint: '#ada298', line: '#f0e9e3',
    teal: '#ea580c', tealWeak: '#fdeade', accentSoft: '#fef7f2', accentBadge: '#fdeee3',
    accentBorder: 'rgba(234,88,12,0.30)', track: '#f2ece7', chipBg: '#f8f5f2', segTrack: '#f3ede8',
    pressed: '#f5f0eb', calorieBar: '#5a4a3f', coral: '#e5484d', coralWeak: '#fceae7', amber: '#a97a12',
  },
  pink: {
    bg: '#fdfafb', panel: '#ffffff', ink: '#171114', sub: '#7a6772', faint: '#ad9ca5', line: '#f0e6eb',
    teal: '#db2777', tealWeak: '#fce4ef', accentSoft: '#fef5f9', accentBadge: '#fce8f1',
    accentBorder: 'rgba(219,39,119,0.30)', track: '#f2eaee', chipBg: '#f8f3f5', segTrack: '#f3ecef',
    pressed: '#f5eef1', calorieBar: '#57424c', coral: '#e5484d', coralWeak: '#fceae9', amber: '#a97a12',
  },
  graphite: {
    bg: '#fafafa', panel: '#ffffff', ink: '#101214', sub: '#6b7280', faint: '#9ca3af', line: '#e6e7e9',
    teal: '#475569', tealWeak: '#e7eaee', accentSoft: '#f5f6f8', accentBadge: '#eaedf1',
    accentBorder: 'rgba(71,85,105,0.32)', track: '#ebecee', chipBg: '#f4f5f6', segTrack: '#eef0f1',
    pressed: '#f0f1f3', calorieBar: '#1e293b', coral: '#e5484d', coralWeak: '#fceceb', amber: '#a9800f',
  },
  teal: derivePalette('#0d9488'),
  sky: derivePalette('#0284c7'),
  indigo: derivePalette('#4f46e5'),
  lime: derivePalette('#65a30d'),
  rose: derivePalette('#e11d48'),
  brown: derivePalette('#92400e'),
};

export const ACCENTS: { key: AccentKey; label: string; color: string }[] = [
  { key: 'green', label: 'グリーン', color: PALETTES.green.teal },
  { key: 'blue', label: 'ブルー', color: PALETTES.blue.teal },
  { key: 'purple', label: 'パープル', color: PALETTES.purple.teal },
  { key: 'orange', label: 'オレンジ', color: PALETTES.orange.teal },
  { key: 'pink', label: 'ピンク', color: PALETTES.pink.teal },
  { key: 'graphite', label: 'グラファイト', color: PALETTES.graphite.teal },
  { key: 'teal', label: 'ティール', color: PALETTES.teal.teal },
  { key: 'sky', label: 'スカイ', color: PALETTES.sky.teal },
  { key: 'indigo', label: 'インディゴ', color: PALETTES.indigo.teal },
  { key: 'lime', label: 'ライム', color: PALETTES.lime.teal },
  { key: 'rose', label: 'ローズ', color: PALETTES.rose.teal },
  { key: 'brown', label: 'ブラウン', color: PALETTES.brown.teal },
];

// ===== P/F/Cバーの配色（テーマとは独立した設定。3色を個別に選ぶ） =====
export type PfcColors = { p: string; f: string; c: string };

// 選択できる色（超過の赤 #e5484d とは十分に離した色だけを並べている）
export const PFC_SWATCHES: { key: string; label: string; color: string }[] = [
  { key: 'green', label: 'グリーン', color: '#059669' },
  { key: 'teal', label: 'ティール', color: '#0d9488' },
  { key: 'lime', label: 'ライム', color: '#65a30d' },
  { key: 'amber', label: 'アンバー', color: '#d97706' },
  { key: 'orange', label: 'オレンジ', color: '#ea580c' },
  { key: 'yellow', label: 'イエロー', color: '#ca8a04' },
  { key: 'blue', label: 'ブルー', color: '#2563eb' },
  { key: 'sky', label: 'スカイ', color: '#0284c7' },
  { key: 'indigo', label: 'インディゴ', color: '#4f46e5' },
  { key: 'purple', label: 'パープル', color: '#7c3aed' },
  { key: 'pink', label: 'ピンク', color: '#db2777' },
  { key: 'slate', label: 'スレート', color: '#475569' },
  { key: 'mint', label: 'ミント', color: '#10b981' },
  { key: 'emerald', label: 'エメラルド', color: '#047857' },
  { key: 'cyan', label: 'シアン', color: '#0891b2' },
  { key: 'navy', label: 'ネイビー', color: '#1e40af' },
  { key: 'violet', label: 'バイオレット', color: '#6d28d9' },
  { key: 'fuchsia', label: 'フューシャ', color: '#c026d3' },
  { key: 'rose', label: 'ローズ', color: '#be123c' },
  { key: 'brown', label: 'ブラウン', color: '#92400e' },
  { key: 'olive', label: 'オリーブ', color: '#4d7c0f' },
  { key: 'gold', label: 'ゴールド', color: '#a16207' },
  { key: 'charcoal', label: 'チャコール', color: '#1f2937' },
  { key: 'gray', label: 'グレー', color: '#6b7280' },
];

export const DEFAULT_PFC: PfcColors = { p: '#059669', f: '#d97706', c: '#2563eb' };

// 旧バージョンのプリセット名から個別色へ移行するための対応表
const LEGACY_PRESETS: Record<string, PfcColors> = {
  classic: { p: '#059669', f: '#d97706', c: '#2563eb' },
  warm: { p: '#db2777', f: '#ea580c', c: '#ca8a04' },
  cool: { p: '#4f46e5', f: '#0284c7', c: '#0d9488' },
  accessible: { p: '#2563eb', f: '#d97706', c: '#7c3aed' },
  mono: { p: '#0e1116', f: '#6b7280', c: '#b2b8c2' },
};

// 背景（カードの外側の下地）。テーマ色を薄く敷くか、白のままにするか。
// カードの面（panel）は白のまま変えない。下地だけを色づけることで
// 「箱が浮いている」関係を保ったまま、テーマを選んだ実感が画面全体に出る。
export type BgTint = 'white' | 'soft' | 'medium' | 'strong';

// 白を選んだときの下地（全テーマ共通。「白」は色相を持たない）
const NEUTRAL_BG = '#fbfbfa';

// 濃さ＝白との混合比。1.0が純白で、下げるほどアクセント色が濃くなる。
// カードの面(panel)は白のままなので、この値がそのまま「カードと下地の差」になる。
const BG_MIX: Record<Exclude<BgTint, 'white'>, number> = {
  soft: 0.955,     // アクセント4.5%。並べて初めて分かる
  medium: 0.90,    // 10%。色がついていると分かるが主張しない
  strong: 0.82,    // 18%。はっきり色を感じる（上限。これ以上はカードが沈む）
};

export const BG_TINTS: { key: BgTint; label: string }[] = [
  { key: 'white', label: '白' },
  { key: 'soft', label: 'ごく薄く' },
  { key: 'medium', label: '薄く' },
  { key: 'strong', label: 'しっかり' },
];

/** 選んだアクセントと背景設定から、実際に使うパレットを組む */
export function paletteFor(accent: AccentKey, bg: BgTint): Palette {
  const base = PALETTES[accent] ?? PALETTES.green;
  if (bg === 'white') return { ...base, bg: NEUTRAL_BG };
  return { ...base, bg: mixW(base.teal, BG_MIX[bg]) };
}

export type ThemePrefs = { accent: AccentKey; pfc: PfcColors; bg: BgTint };
export const DEFAULT_THEME: ThemePrefs = { accent: 'green', pfc: DEFAULT_PFC, bg: 'soft' };
const KEY = 'bl-theme';

let prefs: ThemePrefs = DEFAULT_THEME;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function pfcColors(): PfcColors { return prefs.pfc; }

export async function loadTheme(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ThemePrefs> & { pfc?: unknown };
      const pfc = typeof p.pfc === 'string'
        ? (LEGACY_PRESETS[p.pfc] ?? DEFAULT_PFC)               // 旧: プリセット名
        : { ...DEFAULT_PFC, ...(p.pfc as Partial<PfcColors>) }; // 新: 個別色
      const bg: BgTint = BG_TINTS.some((x) => x.key === p.bg)
        ? (p.bg as BgTint) : DEFAULT_THEME.bg;
      prefs = { ...DEFAULT_THEME, ...p, pfc, bg };
    }
  } catch { /* 既定のまま */ }
  applyPalette(paletteFor(prefs.accent, prefs.bg));
  emit();
}

export async function setTheme(patch: Partial<ThemePrefs>): Promise<void> {
  prefs = { ...prefs, ...patch };
  applyPalette(paletteFor(prefs.accent, prefs.bg));
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
