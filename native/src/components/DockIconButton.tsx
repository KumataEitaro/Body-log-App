// 入力ドック用の統一アイコンボタン（32×32グリッド・r10・アイコン18px/sw2.0）
// 押下でスケール0.94＋薄い背景が点く（ミクロインタラクション統一）
import { Pressable, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { C } from '@/lib/ui';
import { useGuideTarget } from '@/components/GuideTour';

export default function DockIconButton({ Icon, onPress, onLongPress, disabled, tint, size = 18, guideKey }: {
  Icon: LucideIcon;
  onPress: () => void;
  onLongPress?: () => void;   // 隠し操作用（例: 成分表示ボタンの長押し=バーコード）
  disabled?: boolean;
  tint?: string;
  size?: number;
  guideKey?: string;          // ガイドツアーの照射対象キー（食事ドックのカメラ・成分表示が渡す）
}) {
  // ガイドの照射対象になれる（HeaderGearと同じ流儀: 未指定はダミーキーで登録）
  const target = useGuideTarget(guideKey ?? '__dock_unused__');
  return (
    <Pressable
      ref={target} collapsable={false}
      onPress={onPress} onLongPress={onLongPress} delayLongPress={450} disabled={disabled} hitSlop={6}
      style={({ pressed }) => [s.btn, pressed && s.pressed, disabled && { opacity: 0.35 }]}
    >
      <Icon size={size} color={tint ?? C.sub} strokeWidth={2} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: C.pressed, transform: [{ scale: 0.94 }] },
});
