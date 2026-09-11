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
// - 2026-09-10: 運動・概要・相談タブにも同じ＋を置いた（components/PlusEntry.tsx が束ねる）。
//   照射キー 'dock' を登録するのは**食事タブの1つだけ**（guideKey='dock'）。複数のタブが同じキーを
//   登録すると、あとから登録した（別タブの・画面外の）ボタンへ照射がずれる。他タブは guideKey 省略＝未登録
// - 相談タブはコンポーザー（テキストボックス＋↑送信）にかぶらないよう bottomOffset でその上へ持ち上げる
import { useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, themed } from '@/lib/ui';
import { useGuideTarget } from '@/components/GuideTour';
import { t } from '@/lib/i18n';

export const FAB_SIZE = 56;
/** スクロール内容の下端が＋に隠れないための余白（insets.bottom に足す）。食事タブの 84（=56+28）に揃える */
export const FAB_CLEARANCE = FAB_SIZE + 28;
/** 照射キーを登録しないタブ用のダミーキー（どの章も参照しない）。フックは条件付きで呼べないため */
const GUIDE_KEY_NONE = 'plus-fab:unlit';

export default function PlusFab({ onPress, badge = 0, guideKey = null, bottomOffset = 0 }: {
  onPress: () => void;
  badge?: number;
  /** ガイドツアーの照射キー。食事タブだけ 'dock'。省略＝登録しない */
  guideKey?: 'dock' | null;
  /** 既定位置（insets.bottom + 12）からさらに持ち上げる高さ（相談タブ: コンポーザーの高さ） */
  bottomOffset?: number;
}) {
  const insets = useSafeAreaInsets();
  const target = useGuideTarget(guideKey ?? GUIDE_KEY_NONE);
  const sc = useRef(new Animated.Value(1)).current;
  const press = (v: number) => Animated.spring(sc, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  return (
    <View style={[s.wrap, { bottom: insets.bottom + 12 + bottomOffset }]} ref={target} collapsable={false}>
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
