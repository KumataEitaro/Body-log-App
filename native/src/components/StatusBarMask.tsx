// ステータスバー領域の下敷き。スクロール時にコンテンツが時計・Dynamic Islandと
// 重なって読めなくなるのを防ぐ（各画面のルートViewの最後に置くこと）
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function StatusBarMask() {
  const insets = useSafeAreaInsets();
  if (insets.top <= 0) return null;
  return <View pointerEvents="none" style={[s.mask, { height: insets.top }]} />;
}

const s = StyleSheet.create({
  mask: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    backgroundColor: 'rgba(251,251,250,0.96)',
  },
});
