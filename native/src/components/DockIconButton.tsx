// 入力ドック用の統一アイコンボタン（32×32グリッド・r10・アイコン18px/sw2.0）
// 押下でスケール0.94＋薄い背景が点く（ミクロインタラクション統一）
import { Pressable, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { C } from '@/lib/ui';

export default function DockIconButton({ Icon, onPress, disabled, tint, size = 18 }: {
  Icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  tint?: string;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress} disabled={disabled} hitSlop={6}
      style={({ pressed }) => [s.btn, pressed && s.pressed, disabled && { opacity: 0.35 }]}
    >
      <Icon size={size} color={tint ?? C.sub} strokeWidth={2} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: '#f1f3f0', transform: [{ scale: 0.94 }] },
});
