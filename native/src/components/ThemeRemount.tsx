// テーマ世代の「壁」: 明暗・アクセントが切り替わったら、この中の子ツリーを**丸ごと作り直す**。
//
// なぜ要るか（2026-09-10・食事タブ「週と月の収支」の見出しだけがダークの色で薄く残った）
//   いまのテーマ方式は「C（色トークン）を書き換えて世代を進め、各ルートが useThemeRefresh() で
//   再描画する」。これは**子ツリー全体が本当に再描画される**ことに依存している。ところが React には
//   再描画を省く仕組みが多い（React.memo・useMemo で作った JSX・同じ element の再利用・
//   FlatList の行・Animated が抱えるスタイル・sticky header の複製…）。どれか1つでも噛むと、
//   その要素だけ前の世代の色を抱えたまま残る＝「まだら」。個々の書き方を規約とテストで縛ってきたが
//   （themeSafety.test.ts）、それは「知っている抜け道」しか塞げず、3回再発した。
//
// この部品は発想を変える: **世代が変わったら key を変えて子を全部アンマウント→マウント**する。
// 再描画の省略がどこに潜んでいても、要素そのものが新しく作られるので古い色は物理的に残れない。
// TabHeader が 2026-09-04 から同じ手（`key={theme-${gen}}`）で自衛して以来、ヘッダーの再発はゼロ。
//
// 使い方: 各タブのスクロール本体（ScrollView とその中身）をこれで包む。
//   <ThemeRemount><ScrollView>…</ScrollView></ThemeRemount>
// 包まないもの: Modal・ボトムシート・FAB（兄弟に置く）。Modal を作り直すと iOS で古いモーダルが残る
// （2026-09-04 に「Stack を key で再マウント」を廃止した理由）。画面の state（読込済みデータ・
// 入力途中）は親コンポーネントが持っているので、この壁の再マウントでは消えない。
// 代償はテーマ切替時にスクロール位置が先頭へ戻ること。切替は日没/日の出の自動切替か設定操作の
// ときだけなので許容する。
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { themeGeneration } from '@/lib/ui';
import { useTheme } from '@/lib/theme';

export default function ThemeRemount({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  // 自分で世代を購読する（親が再描画を省いても、ここは必ず再描画される）
  useTheme();
  const gen = themeGeneration();
  return (
    <View key={`theme-${gen}`} style={style ?? styles.fill} testID="theme-remount">
      {children}
    </View>
  );
}

// 色を持たない寸法だけの定義なので themed は使わない（コメントにも「themed 開き括弧」の並びを書かない＝規約テストが誤検出する）
const styles = { fill: { flex: 1 } as ViewStyle };
