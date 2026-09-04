// テーマ設定（画面全体の配色 ＋ P/F/Cバーの配色 ＋ 明暗モード）
//
// 2026-09-02 新アイコン（アクア地・白い皿・鮮やかな食材）に合わせて配色を刷新した。
//   - 新アクセント「エレクトリック」(#4D7CFF) を追加し、未設定ユーザーの既定にした
//   - 既存の12色はそのまま選べる（保存済みの選択を壊さない）
//   - 意味色（達成=Leaf / 注意=Citrus / 超過=Berry）は全アクセント共通
//   - 文字色は全アクセント共通（ink=Dark Navy / sub / faint）。アクセントごとに文字色の色相を
//     ずらしていた旧方式は、コントラストの管理が13色ぶん散らばるためやめた
//   - 白地の文字用アクセント accentInk は WCAG AA(4.5:1) を満たすまで自動で濃くする（lib/contrast.ts）
//   - ダークは Navy(#0B1220) の地 ＋ Card Gray(#111827) の面の2階調に固定。アクセントで地を染めない
import { useSyncExternalStore } from 'react';
import { Appearance as RNAppearance, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyPalette, rgba, type Palette } from './ui';
import { ensureContrast, mixHex, AA_TEXT, AA_LARGE } from './contrast';

export type AccentKey =
  | 'electric'
  | 'green' | 'blue' | 'purple' | 'orange' | 'pink' | 'graphite'
  | 'teal' | 'sky' | 'indigo' | 'lime' | 'rose' | 'brown';

// ===== 基準色（このファイルと ui.ts 以外に生のHEXを書かない） =====
const WHITE = '#ffffff';
// 文字色（ライト・全アクセント共通）。Dark Navy を主要文字に、補助は白地で4.7:1、ヒントは2.4:1（ヒント専用）
const LIGHT_INK = '#0b1220';
const LIGHT_SUB = '#6b7580';
const LIGHT_FAINT = '#a2aab3';
// 意味色（全アクセント共通）
const LEAF = '#34b36a';    // 達成・成功
const CITRUS = '#ffa62b';  // 注意
const BERRY = '#e43d5b';   // 超過・警告
const AQUA = '#c7f5f6';    // アイコンの地。強調面と背景トーン「アクア」の元
// ダークの2階調
const DARK_BG = '#0b1220';     // Dark Navy
const DARK_PANEL = '#111827';  // Card Gray

// 白と混ぜた淡色を作る（比率は手調整済みパレットから逆算した値）
function mixW(hex: string, ratio: number): string {
  return mixHex(WHITE, hex, ratio);
}

/** finalize で埋めるトークンを除いた「素」のパレット（アクセントごとに書くのはここまで） */
type RawPalette = Omit<Palette,
  'accentInk' | 'accentHi' | 'aqua' | 'success' | 'successInk' | 'successWeak' | 'coral' | 'coralWeak' | 'amber'>;

/**
 * 素のパレットに、全アクセント共通の派生トークンを足して完成させる。
 *   accentInk: 白地の文字用。teal を panel に対して AA(4.5:1) を満たすまで黒へ寄せる。
 *              既に満たしている色（ブルー・パープル・グラファイト等）は teal と同値になる
 *   amber:     Citrus 原色は白地で 2:1 しかない。注意の文字は太字で使う前提で 3:1 まで濃くする
 *   successInk: Leaf 原色は白地で 2.7:1。文字用に 4.5:1 まで濃くする
 * overrides はデザインで明示的に決めた値（エレクトリックの accentInk=#2F5FE6 等）を優先するため
 */
function finalizeLight(raw: RawPalette, overrides: Partial<Palette> = {}): Palette {
  return {
    ...raw,
    accentInk: ensureContrast(raw.teal, raw.panel, AA_TEXT, 'darker'),
    accentHi: mixW(raw.teal, 0.30),
    aqua: AQUA,
    success: LEAF,
    successInk: ensureContrast(LEAF, raw.panel, AA_TEXT, 'darker'),
    successWeak: mixW(LEAF, 0.88),
    coral: BERRY,
    coralWeak: mixW(BERRY, 0.88),
    amber: ensureContrast(CITRUS, raw.panel, AA_LARGE, 'darker'),
    ...overrides,
  };
}

// アクセント色1つからパレット一式を導出（新規テーマはこれで量産できる）
function derivePalette(accent: string, overrides: Partial<Palette> = {}): Palette {
  return finalizeLight({
    bg: mixW(accent, 0.985), panel: WHITE, ink: LIGHT_INK, sub: LIGHT_SUB, faint: LIGHT_FAINT,
    line: mixW(accent, 0.91), teal: accent, tealWeak: mixW(accent, 0.88),
    accentSoft: mixW(accent, 0.95), accentBadge: mixW(accent, 0.90), accentBorder: rgba(accent, 0.30),
    track: mixW(accent, 0.92), chipBg: mixW(accent, 0.955), segTrack: mixW(accent, 0.93),
    pressed: mixW(accent, 0.94), calorieBar: '#3b4a63', hairline: 'rgba(14,17,22,0.08)', shadow: LIGHT_INK,
  }, overrides);
}

// 手調整済みの6色（背景・罫線の色相をアクセントへ寄せた値）。文字色と意味色は共通値に統一
const tuned = (p: Omit<RawPalette, 'panel' | 'ink' | 'sub' | 'faint' | 'hairline' | 'shadow'>): Palette =>
  finalizeLight({ ...p, panel: WHITE, ink: LIGHT_INK, sub: LIGHT_SUB, faint: LIGHT_FAINT, hairline: 'rgba(14,17,22,0.08)', shadow: LIGHT_INK });

// アクセントだけでなく、背景・罫線まで同じ色相へ寄せて雰囲気ごと変える
export const PALETTES: Record<AccentKey, Palette> = {
  // 新アイコンの配色。accentInk はデザインで決めた #2F5FE6（白地で5.4:1。自動導出だと #456EE3 で止まり
  // やや紫寄りに見えるため、明示的に一段濃い青を採る）。グラデーションの明端 #6AA3FF も固定値
  electric: derivePalette('#4d7cff', { accentInk: '#2f5fe6', accentHi: '#6aa3ff' }),
  green: tuned({
    bg: '#fbfbfa', line: '#e9eae7',
    teal: '#059669', tealWeak: '#e1f5ee', accentSoft: '#f2faf7', accentBadge: '#e6f7f2',
    accentBorder: 'rgba(5,150,105,0.30)', track: '#eceeeb', chipBg: '#f4f5f3', segTrack: '#eef0ee',
    pressed: '#f1f3f0', calorieBar: '#3f4c5a',
  }),
  blue: tuned({
    bg: '#fafbfd', line: '#e5e9f0',
    teal: '#2563eb', tealWeak: '#e4ecfd', accentSoft: '#f4f7fe', accentBadge: '#e8effd',
    accentBorder: 'rgba(37,99,235,0.30)', track: '#e9edf3', chipBg: '#f2f5f9', segTrack: '#eaeff5',
    pressed: '#eef2f7', calorieBar: '#475569',
  }),
  purple: tuned({
    bg: '#fcfafd', line: '#ebe6f0',
    teal: '#7c3aed', tealWeak: '#eee7fd', accentSoft: '#f8f5fe', accentBadge: '#f0e9fd',
    accentBorder: 'rgba(124,58,237,0.30)', track: '#eee9f2', chipBg: '#f6f3f8', segTrack: '#f0ebf4',
    pressed: '#f2eef6', calorieBar: '#4a4257',
  }),
  orange: tuned({
    bg: '#fdfbf9', line: '#f0e9e3',
    teal: '#ea580c', tealWeak: '#fdeade', accentSoft: '#fef7f2', accentBadge: '#fdeee3',
    accentBorder: 'rgba(234,88,12,0.30)', track: '#f2ece7', chipBg: '#f8f5f2', segTrack: '#f3ede8',
    pressed: '#f5f0eb', calorieBar: '#5a4a3f',
  }),
  pink: tuned({
    bg: '#fdfafb', line: '#f0e6eb',
    teal: '#db2777', tealWeak: '#fce4ef', accentSoft: '#fef5f9', accentBadge: '#fce8f1',
    accentBorder: 'rgba(219,39,119,0.30)', track: '#f2eaee', chipBg: '#f8f3f5', segTrack: '#f3ecef',
    pressed: '#f5eef1', calorieBar: '#57424c',
  }),
  graphite: tuned({
    bg: '#fafafa', line: '#e6e7e9',
    teal: '#475569', tealWeak: '#e7eaee', accentSoft: '#f5f6f8', accentBadge: '#eaedf1',
    accentBorder: 'rgba(71,85,105,0.32)', track: '#ebecee', chipBg: '#f4f5f6', segTrack: '#eef0f1',
    pressed: '#f0f1f3', calorieBar: '#1e293b',
  }),
  teal: derivePalette('#0d9488'),
  sky: derivePalette('#0284c7'),
  indigo: derivePalette('#4f46e5'),
  lime: derivePalette('#65a30d'),
  rose: derivePalette('#e11d48'),
  brown: derivePalette('#92400e'),
};

// 選択肢の並び。新既定のエレクトリックを先頭に、以降は従来の順
export const ACCENTS: { key: AccentKey; label: string; color: string }[] = [
  { key: 'electric', label: 'エレクトリック', color: PALETTES.electric.teal },
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

// 選択できる色。先頭5つは新アイコンの色（エレクトリック/リーフ/シトラス/ベリー/アクア）。
// ベリーは超過の赤（C.coral）と同じ値なので、選ぶと超過が見分けにくくなる。設定画面で注意を出す
export const PFC_SWATCHES: { key: string; label: string; color: string }[] = [
  { key: 'electric', label: 'エレクトリック', color: '#4d7cff' },
  { key: 'leaf', label: 'リーフ', color: LEAF },
  { key: 'citrus', label: 'シトラス', color: CITRUS },
  { key: 'berry', label: 'ベリー', color: BERRY },
  { key: 'aqua', label: 'アクア', color: AQUA },
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

// プリセット（3色をまとめて選ぶ）。先頭「アイコン調」が新規ユーザーの既定。
// 「クラシック」は旧既定（P=グリーン/F=アンバー/C=ブルー）、「くっきり」は色覚多様性でも
// 3本を見分けやすい組（青・橙・紫＝色相が120度ずつ離れ、明度も段になる）
export const PFC_PRESETS: { key: string; label: string; colors: PfcColors }[] = [
  { key: 'icon', label: 'アイコン調', colors: { p: '#4d7cff', f: CITRUS, c: LEAF } },
  { key: 'classic', label: 'クラシック', colors: { p: '#059669', f: '#d97706', c: '#2563eb' } },
  { key: 'accessible', label: 'くっきり', colors: { p: '#2563eb', f: '#d97706', c: '#7c3aed' } },
];

export const DEFAULT_PFC: PfcColors = PFC_PRESETS[0].colors;

// 旧バージョンのプリセット名から個別色へ移行するための対応表
const LEGACY_PRESETS: Record<string, PfcColors> = {
  classic: { p: '#059669', f: '#d97706', c: '#2563eb' },
  warm: { p: '#db2777', f: '#ea580c', c: '#ca8a04' },
  cool: { p: '#4f46e5', f: '#0284c7', c: '#0d9488' },
  accessible: { p: '#2563eb', f: '#d97706', c: '#7c3aed' },
  mono: { p: '#0e1116', f: '#6b7280', c: '#b2b8c2' },
};

// 背景（カードの外側の下地）。テーマ色を薄く敷くか、白のままにするか、アイコンのアクアにするか。
// カードの面（panel）は白のまま変えない。下地だけを色づけることで
// 「箱が浮いている」関係を保ったまま、テーマを選んだ実感が画面全体に出る。
export type BgTint = 'white' | 'soft' | 'medium' | 'strong' | 'aqua';

// 白を選んだときの下地（全テーマ共通。「白」は色相を持たない）
const NEUTRAL_BG = '#fbfbfa';

// 「アクア」の下地（全テーマ共通）。アイコンの地 #C7F5F6 をそのまま全面に敷くとカードが沈み
// 補助文字が読みづらくなるため、白と 55:45 で混ぜて明るくした値（ink 17:1・sub 4.3:1）
const AQUA_BG = mixW(AQUA, 0.55);

// 濃さ＝白との混合比。1.0が純白で、下げるほどアクセント色が濃くなる。
// カードの面(panel)は白のままなので、この値がそのまま「カードと下地の差」になる。
const BG_MIX: Record<Exclude<BgTint, 'white' | 'aqua'>, number> = {
  soft: 0.955,     // アクセント4.5%。並べて初めて分かる
  medium: 0.90,    // 10%。色がついていると分かるが主張しない
  strong: 0.82,    // 18%。はっきり色を感じる（上限。これ以上はカードが沈む）
};

export const BG_TINTS: { key: BgTint; label: string }[] = [
  { key: 'white', label: '白' },
  { key: 'soft', label: 'ごく薄く' },
  { key: 'medium', label: '薄く' },
  { key: 'strong', label: 'しっかり' },
  { key: 'aqua', label: 'アクア' },
];

/** 選んだアクセントと背景設定から、実際に使うパレットを組む */
export function paletteFor(accent: AccentKey, bg: BgTint): Palette {
  const base = PALETTES[accent] ?? PALETTES.electric;
  if (bg === 'white') return { ...base, bg: NEUTRAL_BG };
  if (bg === 'aqua') return { ...base, bg: AQUA_BG };
  return { ...base, bg: mixW(base.teal, BG_MIX[bg]) };
}

// ===== ダークパレット =====
/**
 * アクセント1色からダークパレット一式を導出する。
 * 方針: 地と面は Navy / Card Gray の2階調に固定（アクセントで染めない＝どのアクセントでも同じ暗さ）。
 * アクセント自体は暗背景でのコントラスト確保のため少し明るく持ち上げるが、
 * その上に載る白文字が 3:1 を割るところまでは上げない（ライムが該当。持ち上げると白文字が薄くなる）。
 * 文字用の accentInk は面に対して AA(4.5:1) を満たすまで白へ寄せる（グラファイト・インディゴが該当）。
 */
export function darkPaletteFor(accent: AccentKey): Palette {
  const a = (PALETTES[accent] ?? PALETTES.electric).teal;
  const lifted = ensureContrast(mixW(a, 0.12), WHITE, AA_LARGE, 'darker');
  return {
    bg: DARK_BG,
    panel: DARK_PANEL,
    ink: '#e6ebf2',    // 冷たい白（Navyの地に馴染む）。bgに対して15.6:1
    sub: '#9aa4b2',    // 面に対して7.0:1
    faint: '#6b7583',  // ヒント専用。面に対して3.8:1
    line: '#1e2738',
    teal: lifted,
    accentInk: ensureContrast(lifted, DARK_PANEL, AA_TEXT, 'lighter'),
    accentHi: mixW(lifted, 0.30),
    tealWeak: mixHex(a, DARK_PANEL, 0.28),
    accentSoft: mixHex(a, DARK_PANEL, 0.10),
    accentBadge: mixHex(a, DARK_PANEL, 0.20),
    accentBorder: rgba(a, 0.45),
    aqua: '#173a40',   // 暗所のアクア面（原色は眩しすぎるため深いティール寄りに）
    track: '#1c2536',
    chipBg: '#182132',
    segTrack: '#182132',
    pressed: '#1e2738',
    calorieBar: '#94a2b1', hairline: 'rgba(230,235,242,0.12)', shadow: '#000000',
    // 意味色は暗い面で沈まないよう少し明るく。文字と塗りの両方に使える濃さ（面に対して5.6〜9:1）
    success: '#3fbf74', successInk: '#3fbf74', successWeak: '#14302a',
    coral: '#f0607a', coralWeak: '#3a1b25',
    amber: CITRUS,     // 暗い面では原色のままで 9:1
  };
}

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePrefs = { accent: AccentKey; pfc: PfcColors; bg: BgTint; mode: ThemeMode };
// 未設定ユーザーの既定＝新アイコンの配色。保存済みの設定は loadTheme でそのまま復元される
export const DEFAULT_THEME: ThemePrefs = { accent: 'electric', pfc: DEFAULT_PFC, bg: 'soft', mode: 'system' };
const KEY = 'bl-theme';

let prefs: ThemePrefs = DEFAULT_THEME;
const listeners = new Set<() => void>();

/** 実際に画面へ効いている明暗（mode=systemのときはOS設定に従う） */
export function currentScheme(): 'light' | 'dark' {
  if (prefs.mode !== 'system') return prefs.mode;
  try { return RNAppearance.getColorScheme() === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

// useSyncExternalStore用スナップショット（scheme込み。emitのたびに作り直す）
export type ThemeSnapshot = ThemePrefs & { scheme: 'light' | 'dark' };
let snapshot: ThemeSnapshot = { ...prefs, scheme: 'light' };
const emit = () => { snapshot = { ...prefs, scheme: currentScheme() }; listeners.forEach((l) => l()); };

export function pfcColors(): PfcColors { return prefs.pfc; }

// いま画面に効いている明暗（applyCurrent が最後に適用したもの）。
// AppState 復帰時に OS の明暗と比べて「ずれていれば再同期」するための基準
let appliedScheme: 'light' | 'dark' | null = null;
// 最後に RNAppearance.setColorScheme へ渡した値。同じ値を毎回渡すと iOS が外観変更イベントを
// 再発火させ、リスナー → applyCurrent → setColorScheme → リスナー… の連鎖になりうる
let lastOverride: 'light' | 'dark' | null | undefined = undefined;
// 再入防止（setColorScheme が同期的にリスナーを呼ぶ環境でも一度しか適用しない）
let applying = false;

function applyCurrent(): void {
  if (applying) return;
  applying = true;
  try {
    const scheme = currentScheme();
    appliedScheme = scheme;
    applyPalette(scheme === 'dark' ? darkPaletteFor(prefs.accent) : paletteFor(prefs.accent, prefs.bg));
    // ネイティブUI（タブバー・ヘッダー・シート）も同じ明暗に固定する。
    // mode=systemのときはOS追従（null）。これを怠るとLiquid Glassのバーだけ暗い事故が再発する。
    // 値が変わるときだけ呼ぶ（上の lastOverride の理由）。
    // 型定義がnull（=OS追従に戻す）を受け付けない版があるためキャストする（ランタイムは対応済み）
    const override = prefs.mode === 'system' ? null : prefs.mode;
    if (override !== lastOverride) {
      lastOverride = override;
      try { RNAppearance.setColorScheme(override as unknown as 'light' | 'dark'); } catch { /* 旧RNでは無視 */ }
    }
  } finally {
    applying = false;
  }
}

/**
 * OS の明暗と「いま効いている明暗」がずれていれば適用し直す（mode=system のときだけ）。
 * 背景にいる間に OS が自動ダークへ切り替わると、Appearance のイベントが JS に届かない／
 * 順序が崩れることがある（2026-09-04 19:12 の「上の帯だけ白い」スクリーンショット）。
 * AppState が active に戻った瞬間に呼び、ずれていたら applyCurrent()+emit() する。
 * 戻り値: 適用したか（テストと診断用）
 */
export function resyncSchemeFromOS(): boolean {
  if (prefs.mode !== 'system') return false;
  if (currentScheme() === appliedScheme) return false;
  applyCurrent();
  emit();
  return true;
}

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
      const mode: ThemeMode = p.mode === 'light' || p.mode === 'dark' ? p.mode : 'system';
      // 保存済みのアクセントが選択肢に無い（将来の削除・破損）ときだけ既定へ戻す。既存の選択は必ず尊重する
      const accent: AccentKey = p.accent && p.accent in PALETTES ? p.accent : DEFAULT_THEME.accent;
      prefs = { ...DEFAULT_THEME, ...p, accent, pfc, bg, mode };
    }
  } catch { /* 既定のまま */ }
  applyCurrent();
  emit();
}

// OSの外観切替（自動ダークモード等）に追従する（mode=systemの間だけ実質的に効く）
try {
  RNAppearance.addChangeListener(() => {
    if (prefs.mode !== 'system') return;
    applyCurrent();
    emit();
  });
} catch { /* テスト環境等では無視 */ }

// 背景から戻った瞬間に OS の明暗と再同期する（上の resyncSchemeFromOS のコメント参照）。
// Appearance のイベントが取りこぼされても、ここで必ず追いつく
try {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') resyncSchemeFromOS();
  });
} catch { /* テスト環境等では無視 */ }

export async function setTheme(patch: Partial<ThemePrefs>): Promise<void> {
  prefs = { ...prefs, ...patch };
  applyCurrent();
  emit();
  try { await AsyncStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 表示は既に切り替わっている */ }
}

export function getTheme(): ThemeSnapshot { return snapshot; }

/**
 * 「テーマが変わったらこの画面を再描画する」だけの購読。値は要らない。
 * 各ルート（画面）の先頭で呼ぶ。themed で作ったスタイルは世代が変わると新しいオブジェクトを返すので、
 * 再描画さえ起きれば全ての色が揃う。以前は _layout の Stack を key で丸ごと再マウントしていたが、
 * 開いている Modal（テーマシート）も破棄→即再表示になり iOS で古いモーダルが残る事故があった（2026-09-04）。
 * __tests__/themeSubscription.test.ts が「全ルートが購読している」ことを見張る。
 */
export function useThemeRefresh(): void { useTheme(); }

export function useTheme(): ThemeSnapshot {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getTheme,
    getTheme,
  );
}
