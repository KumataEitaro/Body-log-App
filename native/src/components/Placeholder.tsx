// Phase 1では未移植のタブ用プレースホルダー（現行Web版への案内つき）
import { View, Text } from 'react-native';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';

export default function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.note}>{note ?? t('この画面はネイティブ版に移植中です。')}</Text>
    </View>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 21, fontWeight: '800', color: C.ink, marginBottom: 10 },
  note: { fontSize: 15, color: C.sub, textAlign: 'center', lineHeight: 22 },
}));
