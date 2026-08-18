// デザイントークン。テーマ変更で「アクセントだけ」でなく、背景・枠線・文字・面の色まで
// まとめて差し替わるよう、全色をこのオブジェクトに集約している。
import { StyleSheet } from 'react-native';

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
  coral: '#ff2d2d',
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
