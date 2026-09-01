// ステータスバー領域の下敷き。スクロール時にコンテンツが時計・Dynamic Islandと
// 重なって読めなくなるのを防ぐ（各画面のルートViewの最後に置くこと）。
//
// 色は必ず C.bg（背景トークン）から作る。以前は rgba(251,251,250,0.96) と
// ライトの背景色をハードコードしていたため、ダークモードで上部だけが白く残っていた
// （βフィードバック 2026-09-01）。テーマを変えるとツリーが作り直されるので、
// レンダー時に C を読めばそのまま追従する。
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, rgba } from '@/lib/ui';

export default function StatusBarMask() {
  const insets = useSafeAreaInsets();
  if (insets.top <= 0) return null;
  return (
    <View
      pointerEvents="none"
      style={[s.mask, { height: insets.top, backgroundColor: rgba(C.bg, 0.96) }]}
    />
  );
}

const s = StyleSheet.create({
  mask: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
});
