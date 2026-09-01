// デザイントークン。テーマ変更で「アクセントだけ」でなく、背景・枠線・文字・面の色まで
// まとめて差し替わるよう、全色をこのオブジェクトに集約している。
import { Platform, StatusBar, StyleSheet } from 'react-native';

/** シート（pageSheetモーダル）の上端パディング。
 *  iOS: pageSheetはOSが上を空けるので素の値をそのまま返す＝iOSの見た目は完全に不変。
 *  Android: presentationStyleは無視されて全画面になり、さらにSDK 57はエッジツーエッジ既定で
 *  コンテンツがステータスバーの下に潜るため、時計とヘッダーが重ならないよう高さを足す。 */
export function sheetTopPad(base: number): number {
  return Platform.OS === 'android' ? base + (StatusBar.currentHeight ?? 24) : base;
}

// ===== 寸法のトークン（2026-09-02 統一） =====
// 新アイコン（水色地・白い皿）に合わせてUIを見直したとき、同じ役割の寸法が画面ごとに
// 違っていることが分かった（カードの角丸 16/18/20、カード余白 14/16/18、
// 画面タイトル 26/600・26/800・21/800、アイコン 12/13/15/16/17/18/19 の混在）。
//
// **数値は現状の多数派をそのまま採っている**。目的は今後のばらつきを止めることで、
// 見た目を作り変えることではない（少数派だけを多数派へ寄せる＝アプリの印象は保つ）。
// 新しい画面・部品は必ずこのトークンから選ぶ。無い寸法が要るときは、まずここへ足す。

/** 角丸。役割ごとに1つだけ持つ（円・バー・サムネの幾何的な角丸は各所の実数のまま） */
export const RADIUS = {
  card: 20,   // 画面直下の大カード（食事・運動・概要のcardが20）
  panel: 16,  // カード内のパネル・行タイル・吹き出し
  tile: 14,   // 情報ボックス・帯・トレイ・大きめのボタン
  input: 12,  // 入力欄・小さなバナー
  chip: 999,  // チップ・ピル・丸ボタン（全体で最多の値）
} as const;

/** 余白。画面のスクロール余白は全画面で16で例外が無かったので、それを正とする */
export const SPACE = {
  screen: 16, // 画面のスクロール余白
  card: 16,   // カードの内側余白（padding全体でも16が最多）
} as const;

/** lucideアイコンの寸法。既存の役割ぶんの段を残している（1段に潰すと印象が変わる） */
export const ICON = {
  xs: 13,        // 注記・警告行の中の小さな印
  sm: 15,        // チップや行内の補助
  md: 16,        // 標準（本文行・カード見出し・ドックの補助）
  lg: 18,        // シート見出し・一覧の矢印
  xl: 19,        // 設定の行頭・入力欄のシェブロン
  hero: 22,      // 空状態・お祝いの見せ場
  stroke: 2.5,   // 既定の線幅
  strokeBold: 3, // 塗り面の上に載る白いアイコン
} as const;

/** 見出しの段。fontWeightはTextStyleに渡せる文字列リテラルとして固定する */
export const HEAD = {
  page: { fontSize: 26, fontWeight: '600' },      // 画面タイトル（食事・運動・相談・概要が26/600）
  section: { fontSize: 21, fontWeight: '800' },   // 画面内の節
  sub: { fontSize: 18, fontWeight: '800' },       // 節の中の小見出し
  card: { fontSize: 17, fontWeight: '800' },      // カードの見出し（h2相当）
} as const;

export type Palette = {
  bg: string;           // 画面の背景
  panel: string;        // カードの面
  ink: string;          // 主要な文字
  sub: string;          // 補助文字
  faint: string;        // 最も薄い文字
  line: string;         // 罫線・枠線
  teal: string;         // アクセント（歴史的な名前。実体はテーマ色）
  tealWeak: string;     // アクセントの薄い面
  accentSoft: string;   // 強調カードの背景（アクセントのごく薄い面）
  accentBadge: string;  // バッジ・選択中セルの背景
  accentBorder: string; // アクセント寄りの枠線
  track: string;        // プログレスバーの溝
  chipBg: string;       // チップ・未選択面
  segTrack: string;     // セグメントコントロールの溝
  pressed: string;      // 押下時の面
  calorieBar: string;   // 合計カロリーのバー（P/F/Cとは必ず別色にする）
  coral: string;
  coralWeak: string;
  amber: string;
};

// 既定はグリーン（従来の配色）
export const C: Palette = {
  bg: '#fbfbfa',
  panel: '#ffffff',
  ink: '#0e1116',
  sub: '#6a7280',
  faint: '#9aa1ab',
  line: '#e9eae7',
  teal: '#059669',
  tealWeak: '#e1f5ee',
  accentSoft: '#f2faf7',
  accentBadge: '#e6f7f2',
  accentBorder: 'rgba(5,150,105,0.30)',
  track: '#eceeeb',
  chipBg: '#f4f5f3',
  segTrack: '#eef0ee',
  pressed: '#f1f3f0',
  calorieBar: '#3f4c5a',
  coral: '#e5484d',
  coralWeak: '#fdeeec',
  amber: '#b8860b',
};

/** '#rrggbb' を 'rgba(r,g,b,a)' に変換（テーマ色から透過色を作るため） */
export function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// StyleSheet.create で作った色はその場で固定されるため、あとからテーマを変えても
// 反映されない。そこで生成されたスタイルを控えておき、変更時に旧色→新色へ置換する。
// （このファイルは全コンポーネントが必ずimportするので、確実に先に読み込まれる）
type Sheet = Record<string, Record<string, unknown>>;
const sheets: Sheet[] = [];

// RNはプレーンなオブジェクトもstyleとして受け付けるので、凍結されない複製を返す
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(StyleSheet as any).create = (obj: Sheet): Sheet => {
  const out: Sheet = {};
  for (const k of Object.keys(obj)) out[k] = { ...obj[k] };
  sheets.push(out);
  return out;
};

/** パレットを丸ごと差し替える。既存スタイルの色も遡って置換するので即座に反映される。 */
export function applyPalette(next: Palette): void {
  // 「旧い値 → 新しい値」の対応表を作る（変わらない色は無視）
  const map = new Map<string, string>();
  (Object.keys(next) as (keyof Palette)[]).forEach((k) => {
    if (C[k] !== next[k]) map.set(C[k], next[k]);
  });
  if (map.size === 0) return;

  for (const sheet of sheets) {
    for (const key of Object.keys(sheet)) {
      const style = sheet[key];
      for (const prop of Object.keys(style)) {
        const v = style[prop];
        if (typeof v === 'string') {
          const hit = map.get(v);
          if (hit) style[prop] = hit;
        }
      }
    }
  }
  Object.assign(C, next);
}
