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
//   下の C.hairline を画面幅ぶん引く。右端の 38px は固定配置の HeaderGear（⚙）の席
import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, HEAD, SPACE, themed } from '@/lib/ui';

export default function TabHeader({ title, right, children }: {
  title: string;
  /** タイトル行の右側（日付ストリップ／編集モードのボタン群） */
  right?: ReactNode;
  /** タイトル行の下に一緒に貼り付ける補助要素（編集ヒント・未同期チップなど） */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.wrap, { paddingTop: insets.top + 8 }]}>
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginRight: 38, minHeight: 34 },
  title: { ...HEAD.page, color: C.ink },
}));
