// 🔥ストリーク常設チップ。記録の連続日数を食事タブに常に見せる（継続の最重要指標）。
// タップで実績ページへ。0日のときは煽らず、静かに「実績」への入口だけ出す。
import { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Award, Flame } from 'lucide-react-native';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { quickStreak } from '@/lib/achievements';

export default function StreakChip() {
  const router = useRouter();
  const [days, setDays] = useState<number | null>(null);
  useFocusEffect(useCallback(() => {
    let alive = true;
    quickStreak().then((d) => { if (alive) setDays(d); }).catch(() => {});
    return () => { alive = false; };
  }, []));

  if (days == null) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 6 }}>
      <Pressable style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}
                 onPress={() => router.push('/achievements' as never)} hitSlop={6}>
        {days > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Flame size={13} color={C.teal} fill={C.teal} />
            <Text style={s.t}><Text style={s.n}>{days}</Text>{t('日連続')}</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Award size={13} color={C.sub} />
            <Text style={[s.t, { color: C.sub }]}>{t('実績')}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5,
  },
  t: { fontSize: 12, fontWeight: '700', color: C.ink },
  n: { fontSize: 13, fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'] },
});
