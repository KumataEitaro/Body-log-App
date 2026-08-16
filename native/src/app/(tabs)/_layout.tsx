// ネイティブタブバー（OS標準・6タブ）— WebView時代の「タブバーが浮く」問題はここで構造的に解決される
import { Tabs } from 'expo-router';
import { Pencil, Dumbbell, BarChart3, MessageCircle, Target, Settings } from 'lucide-react-native';
import { C } from '@/lib/ui';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.teal,
        tabBarInactiveTintColor: C.faint,
        tabBarStyle: { backgroundColor: C.panel },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="log" options={{ title: '食事', tabBarIcon: ({ color, size }) => <Pencil color={color} size={size - 2} /> }} />
      <Tabs.Screen name="training" options={{ title: 'トレ', tabBarIcon: ({ color, size }) => <Dumbbell color={color} size={size - 2} /> }} />
      <Tabs.Screen name="changes" options={{ title: '身体の変化', tabBarIcon: ({ color, size }) => <BarChart3 color={color} size={size - 2} /> }} />
      <Tabs.Screen name="coach" options={{ title: '相談', tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size - 2} /> }} />
      <Tabs.Screen name="goal" options={{ title: '目標', tabBarIcon: ({ color, size }) => <Target color={color} size={size - 2} /> }} />
      <Tabs.Screen name="settings" options={{ title: '設定', tabBarIcon: ({ color, size }) => <Settings color={color} size={size - 2} /> }} />
    </Tabs>
  );
}
