// ネイティブタブバー（4タブ構成）。設定は「概要」ヘッダーの⚙から（タブ非表示のルートとして残す）
// GuideProviderで包み、初回ガイドのスポットライトがタブバーごと覆えるようにする
import { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Utensils, Activity, ChartLine, MessageCircle } from 'lucide-react-native';
import { C } from '@/lib/ui';
import { GuideProvider } from '@/components/GuideTour';
import { t, useLocale } from '@/lib/i18n';

export default function TabsLayout() {
  useLocale(); // 言語を切り替えたらタブ名も即座に追従
  return (
    <GuideProvider>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.teal,
        tabBarInactiveTintColor: C.faint,
        tabBarStyle: { backgroundColor: C.panel },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        // タブ間はシフト遷移（無アニメの瞬間差し替えだと安っぽく見える）。
        // 【重要】freezeOnBlurは付けない: shiftと併用すると凍結解除がアニメと競合し、
        // フォーカス済みタブが空（背景色だけ＝白飛び）で表示されるバグが実際に起きた
        animation: 'shift',
      }}
      screenListeners={{
        // 切り替えの手応え（音のない小さなクリック感）
        tabPress: () => { Haptics.selectionAsync().catch(() => {}); },
      }}
    >
      <Tabs.Screen name="log" options={{ title: t('食事'), tabBarIcon: ({ color, size }) => <Utensils color={color} size={size - 2} /> }} />
      <Tabs.Screen name="training" options={{ title: t('運動'), tabBarIcon: ({ color, size }) => <Activity color={color} size={size - 2} /> }} />
      <Tabs.Screen name="coach" options={{ title: t('相談'), tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size - 2} /> }} />
      <Tabs.Screen name="changes" options={{ title: t('概要'), tabBarIcon: ({ color, size }) => <ChartLine color={color} size={size - 2} /> }} />
      <Tabs.Screen name="goal" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
    </GuideProvider>
  );
}
