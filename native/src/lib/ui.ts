// C案デザイントークン（Web版globals.cssと同一の色体系）
// テーマカラーを後から差し替えられるよう、Cは可変オブジェクトにしてある。
import { StyleSheet } from 'react-native';

export const C = {
  bg: '#fbfbfa',
  panel: '#ffffff',
  ink: '#0e1116',
  sub: '#6a7280',
  faint: '#9aa1ab',
  line: '#e9eae7',
  teal: '#059669',      // アクセント（テーマで変わる）
  tealWeak: '#e1f5ee',  // アクセントの薄い色（テーマで変わる）
  coral: '#e85c50',
  coralWeak: '#fdeeec',
  amber: '#b8860b',
};

// StyleSheet.create で作った色は本来その場で固定されてしまい、
// あとからテーマを変えても反映されない。そこで生成されたスタイルを記録しておき、
// テーマ変更時に「古いアクセント色」を「新しいアクセント色」へ置換する。
// （このファイルは全コンポーネントがCをimportする＝必ず先に読み込まれるため、ここで差し込む）
type Sheet = Record<string, Record<string, unknown>>;
const sheets: Sheet[] = [];
const origCreate = StyleSheet.create.bind(StyleSheet);

// RNはプレーンなオブジェクトもstyleとして受け付けるので、凍結されない複製を返す
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(StyleSheet as any).create = (obj: Sheet): Sheet => {
  const out: Sheet = {};
  for (const k of Object.keys(obj)) out[k] = { ...obj[k] };
  sheets.push(out);
  return out;
};
void origCreate; // 元実装は使わない（検証のみで挙動は同じ）

/** アクセント色を差し替える。既存のスタイルも遡って置換するため即座に反映される。 */
export function applyAccent(accent: string, accentWeak: string): void {
  const oldAccent = C.teal;
  const oldWeak = C.tealWeak;
  if (oldAccent === accent && oldWeak === accentWeak) return;
  C.teal = accent;
  C.tealWeak = accentWeak;
  for (const sheet of sheets) {
    for (const key of Object.keys(sheet)) {
      const style = sheet[key];
      for (const prop of Object.keys(style)) {
        const v = style[prop];
        if (v === oldAccent) style[prop] = accent;
        else if (v === oldWeak) style[prop] = accentWeak;
      }
    }
  }
}
