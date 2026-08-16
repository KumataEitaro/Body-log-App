// Phase 1では未移植のタブ用プレースホルダー（現行Web版への案内つき）
import { View, Text, StyleSheet } from 'react-native';
import { C } from '@/lib/ui';

export default function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.note}>{note ?? 'この画面はネイティブ版に移植中です。\nそれまでは現行のBodyLogアプリで利用できます（データは共通）。'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 18, fontWeight: '800', color: C.ink, marginBottom: 10 },
  note: { fontSize: 13, color: C.sub, textAlign: 'center', lineHeight: 22 },
});
