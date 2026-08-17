// 全タブ共通の右上⚙ボタン（どの画面からでも設定へ飛べる）
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { C } from '@/lib/ui';

export default function HeaderGear() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <Pressable
      style={[s.btn, { top: insets.top + 8 }]}
      onPress={() => router.push('/settings')}
      hitSlop={10}
    >
      <Settings size={16} color={C.sub} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: {
    position: 'absolute', right: 16, zIndex: 30,
    width: 30, height: 30, borderRadius: 9,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.panel,
    alignItems: 'center', justifyContent: 'center',
  },
});
