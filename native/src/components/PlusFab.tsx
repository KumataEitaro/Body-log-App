// 右下の「＋」ボタン（2026-09-02・入力ドック廃止に伴う唯一の入力の入口）
//
// Appleヘルスケアと同じ「まず何を記録するかを選ぶ」構成に合わせ、食事タブの右下に1つだけ浮かせる。
// 2026年のUIトレンドに沿って: 56pxの大きめ・アクセント塗り・柔らかい影（C.shadow）・
// 押下でスケール・触覚。タップで PlusSheet（記録の種類 → 入力方法の2段シート）を開く。
//
// - 位置は insets.bottom + 12（NativeTabs のタブバー高さは取得できないが、iOSでは
//   insets.bottom にタブバーぶんが含まれるため、これでタブバーの上に浮く）
// - 保存前のトレイに品目が残っている間は左上に件数バッジを出す（シートを閉じても
//   「書きかけがある」ことが見えるように。閉じた＝捨てた、ではない）
// - ガイドツアーの照射対象 'dock'（旧・入力ドックのキー）をこのボタンに引き継ぐ。
//   旧ドック向けの章の文言は content/guideChapters.ts 側で「＋から」に書き換えた
import { useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, themed } from '@/lib/ui';
import { useGuideTarget } from '@/components/GuideTour';
import { t } from '@/lib/i18n';

export const FAB_SIZE = 56;

export default function PlusFab({ onPress, badge = 0 }: { onPress: () => void; badge?: number }) {
  const insets = useSafeAreaInsets();
  const target = useGuideTarget('dock');
  const sc = useRef(new Animated.Value(1)).current;
  const press = (v: number) => Animated.spring(sc, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  return (
    <View style={[s.wrap, { bottom: insets.bottom + 12 }]} ref={target} collapsable={false}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={t('記録を追加')}
        onPressIn={() => press(0.92)} onPressOut={() => press(1)}
        // ＋は入力の入口なので、シート内の行（Light）より一段はっきりした Medium で「押せた」を返す
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); onPress(); }}
        hitSlop={8}
      >
        <Animated.View style={[s.fab, { transform: [{ scale: sc }] }]}>
          {/* アクセント塗りの上の白は固定色（テーマ追従してはいけない・lib/ui.ts 規約） */}
          <Plus size={28} color="#fff" strokeWidth={3} />
        </Animated.View>
      </Pressable>
      {badge > 0 && (
        <View style={s.badge} pointerEvents="none">
          <Text style={s.badgeT} maxFontSizeMultiplier={1.2}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </View>
  );
}

const s = themed(() => ({
  wrap: { position: 'absolute', right: 18, zIndex: 20 },
  fab: {
    width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2,
    backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.shadow, shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  // ink地のバッジ（ダークでは明色地に暗文字へ反転する＝背景トークンで吸収）
  badge: {
    position: 'absolute', top: -4, left: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6,
    backgroundColor: C.ink, borderWidth: 2, borderColor: C.bg, alignItems: 'center', justifyContent: 'center',
  },
  badgeT: { fontSize: 11, fontWeight: '800', color: C.panel, fontVariant: ['tabular-nums'] },
}));
