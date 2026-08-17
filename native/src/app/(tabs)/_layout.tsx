// ネイティブタブバー（HIG準拠の5タブ）。目標は「変化」タブに統合（進捗と目標は同一文脈）
import { Tabs } from 'expo-router';
import { Pencil, Dumbbell, BarChart3, MessageCircle, User } from 'lucide-react-native';
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
      <Tabs.Screen name="changes" options={{ title: '変化', tabBarIcon: ({ color, size }) => <BarChart3 color={color} size={size - 2} /> }} />
      <Tabs.Screen name="coach" options={{ title: '相談', tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size - 2} /> }} />
      <Tabs.Screen name="goal" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ title: 'マイページ', tabBarIcon: ({ color, size }) => <User color={color} size={size - 2} /> }} />
    </Tabs>
  );
}
