// タブ画面のスティッキーヘッダー（2026-09-02・「日付は下にスクロールしても固定表示」）
//
// 食事・運動・概要の3タブで、画面タイトルと右側の操作（日付ストリップ／編集ボタン）を
// ScrollView の先頭子要素として置き、stickyHeaderIndices=[0] で上端に貼り付ける。
//
// 【設計判断】
// - 「ScrollViewの外に固定Viewを置く」のではなく sticky にしたのは、引っ張って更新の
//   オーバースクロールでヘッダーも一緒に下がる（＝ネイティブの手触り）ためと、
//   ガイドツアーの自動スクロール量の計算（コンテンツ座標）を変えないため
// - ステータスバー領域はこのヘッダー自身の paddingTop（insets.top）で覆う。以前の
//   StatusBarMask（透過96%の帯）は、貼り付いたヘッダーの上に重なって二重の面になるので
//   この3タブでは使わない（ヘッダーが不透明 C.bg なので下を通るカードは見えない）
// - スクロール余白（SPACE.screen）の内側に置かれるため、負のマージンで左右いっぱいに広げ、
//   下の C.hairline を画面幅ぶん引く。
// - 以前は右端 38px を固定配置の⚙ボタンの席として空けていたが、2026-09-04 に⚙を廃止
//   （設定は概要タブの「設定」ブロックへ移動）したので、その予約席も返した
//
// 【ダークモードで上部だけ白く残る事故の再発防止（2026-09-04）】
// この帯だけが古いテーマのまま残る報告が3回続いた（設定での切替・OSの自動ダーク）。
// RN の sticky header は子を Animated.View（ネイティブ駆動の translateY）で包み、子の style を
// `styles.fill` に差し替える。この経路は「親が再描画したから子も新しい色で描き直される」という
// 前提が最も崩れやすい場所（Fabric＋Animated の props 更新の取りこぼし・親のメモ化・
// テーマ変更時にこの画面がアクティブでない等）。そこで**親に頼らず自衛**する:
//   1) 自分で useTheme() を購読し、テーマが変われば必ず自分が再描画される
//   2) 内側の View に世代（themeGeneration）を key で付け、テーマが変わったら
//      **ネイティブビューごと作り直す**（色の差分送信に頼らない）
// これで「どの経路でテーマが変わっても、この帯は必ず新しい色で描かれる」が構造的に成立する。
// __tests__/tabHeader.test.tsx が「親を再描画しなくても背景色が切り替わる」ことを見張る。
import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, HEAD, SPACE, themed, themeGeneration } from '@/lib/ui';
import { useTheme } from '@/lib/theme';

export default function TabHeader({ title, right, children }: {
  title: string;
  /** タイトル行の右側（日付ストリップ／編集モードのボタン群） */
  right?: ReactNode;
  /** タイトル行の下に一緒に貼り付ける補助要素（編集ヒント・未同期チップなど） */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // 親の再描画に依存せず、テーマの変更で自分が必ず再描画される（上のコメント参照）
  useTheme();
  const gen = themeGeneration();
  return (
    // key に世代を含める＝テーマが変わるとネイティブビューを作り直す（色の差分送信に頼らない）
    <View key={`theme-${gen}`} style={[s.wrap, { paddingTop: insets.top + 8 }]} testID="tab-header">
      <View style={s.row}>
        <Text style={s.title}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

/** stickyHeaderIndices に渡す値（ヘッダーは常に先頭の子） */
export const STICKY_FIRST = [0];

const s = themed(() => ({
  wrap: {
    backgroundColor: C.bg,
    marginHorizontal: -SPACE.screen, paddingHorizontal: SPACE.screen,
    paddingBottom: 10, marginBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.hairline,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 34 },
  title: { ...HEAD.page, color: C.ink },
}));
