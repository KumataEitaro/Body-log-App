// ネイティブタブバー（4タブ構成）。設定は「概要」ヘッダーの⚙から（タブ非表示のルートとして残す）
// GuideProviderで包み、初回ガイドのスポットライトがタブバーごと覆えるようにする
import { Tabs } from 'expo-router';
import { Utensils, Dumbbell, ChartLine, MessageCircle } from 'lucide-react-native';
import { C } from '@/lib/ui';
import { GuideProvider } from '@/components/GuideTour';

export default function TabsLayout() {
  return (
    <GuideProvider>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.teal,
        tabBarInactiveTintColor: C.faint,
        tabBarStyle: { backgroundColor: C.panel },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="log" options={{ title: '食事', tabBarIcon: ({ color, size }) => <Utensils color={color} size={size - 2} /> }} />
      <Tabs.Screen name="training" options={{ title: 'トレ', tabBarIcon: ({ color, size }) => <Dumbbell color={color} size={size - 2} /> }} />
      <Tabs.Screen name="changes" options={{ title: '概要', tabBarIcon: ({ color, size }) => <ChartLine color={color} size={size - 2} /> }} />
      <Tabs.Screen name="coach" options={{ title: '相談', tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size - 2} /> }} />
      <Tabs.Screen name="goal" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
    </GuideProvider>
  );
}
