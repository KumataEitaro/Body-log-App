// 🔥ストリーク常設チップ。記録の連続日数を食事タブに常に見せる（継続の最重要指標）。
// タップで実績ページへ。0日のときは煽らず、静かに「実績」への入口だけ出す。
//
// 未読バッジのドット: バッジを獲得しても気づけないという最大の弱点への対策。
// 実績ページを開くまで赤丸に数字が残る（設定の実績行にも同じドットを出す）。
import { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Award, Flame } from 'lucide-react-native';
import { TodoBadge } from '@/components/NotificationCenter';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { quickStreak, maybeEvaluateBadges, unseenBadgeCount } from '@/lib/achievements';

export default function StreakChip() {
  const router = useRouter();
  const [days, setDays] = useState<number | null>(null);
  const [unseen, setUnseen] = useState(0);
  useFocusEffect(useCallback(() => {
    let alive = true;
    quickStreak().then((d) => { if (alive) setDays(d); }).catch(() => {});
    // 獲得判定は間隔付き（maybeEvaluateBadges）。同時に走っても中でクエリは1回にまとまる
    maybeEvaluateBadges()
      .then(() => unseenBadgeCount())
      .then((n) => { if (alive) setUnseen(n); })
      .catch(() => {});
    return () => { alive = false; };
  }, []));

  if (days == null) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 6 }}>
      <Pressable style={({ pressed }) => [s.chip, unseen > 0 && s.chipNew, pressed && { opacity: 0.7 }]}
                 onPress={() => router.push('/achievements' as never)} hitSlop={6}>
        {days > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Flame size={13} color={C.teal} fill={C.teal} />
            <Text style={s.t}><Text style={s.n}>{days}</Text>{t('日連続')}</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Award size={13} color={unseen > 0 ? C.teal : C.sub} />
            <Text style={[s.t, unseen === 0 && { color: C.sub }]}>{t('実績')}</Text>
          </View>
        )}
        {/* 未読バッジ数（通知センターのバッジと同じ見え方に揃える） */}
        <TodoBadge count={unseen} style={{ marginLeft: 6 }} />
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
  // 未読があるときだけアクセント寄りの枠にして、見に行く価値があると分かるようにする
  chipNew: { borderColor: C.accentBorder, backgroundColor: C.accentSoft },
  t: { fontSize: 12, fontWeight: '700', color: C.ink },
  n: { fontSize: 13, fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'] },
});
