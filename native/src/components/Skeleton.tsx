// スケルトンローディング（汎用）。初回ロード中に「これから何が出るか」の骨組みを見せて、
// 空白やスピナーより待ち時間を短く感じさせる。シマーはopacityのゆるい往復だけ
// （グラデーション移動より軽く、ダークテーマでも破綻しない）。
// 視差軽減設定では往復を止めて静止した淡色ブロックにする。
import { useEffect } from 'react';
import { StyleSheet, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, {
  cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { C } from '@/lib/ui';
import { useReduceMotion } from '@/lib/motion';

type Props = {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

export default function Skeleton({ width = '100%', height = 14, radius = 8, style }: Props) {
  const reduce = useReduceMotion();
  const glow = useSharedValue(0.55);

  useEffect(() => {
    if (reduce) { cancelAnimation(glow); glow.value = 0.55; return; }
    // ゆるい呼吸（0.55⇄1.0を約0.9秒で往復）。-1=表示中は無限に繰り返す
    glow.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    return () => cancelAnimation(glow);
    // sharedValueは安定参照のため依存はreduceだけでよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  const shimmer = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Reanimated.View
      style={[s.block, { width, height, borderRadius: radius }, !reduce && shimmer, style]}
    />
  );
}

const s = StyleSheet.create({
  // 溝色（プログレスバーの下地と同じトークン）＝どのテーマでも「まだ中身がない面」に見える
  block: { backgroundColor: C.track, opacity: 0.55 },
});
