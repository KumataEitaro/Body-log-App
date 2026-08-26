// 今日のひとこと帯（ヘッダーとヒーローの間・約40px）。
//
// 設計（docs/design-trainer-feedback-ux.md）:
//  ・カードにしない（スクロールで通り過ぎるものに期待は生まれない）
//  ・開いた瞬間に目に入り、タップで展開、×でその日は閉じる
//  ・キャラは円と角丸だけの幾何キャラ。テーマ色を継承するので
//    テーマを変えるとキャラの色も変わる（それ自体が動的）
//  ・呼吸はゆっくり・ネイティブ駆動。reduce motion時は止める
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing } from 'react-native';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { useReduceMotion } from '@/lib/motion';
import type { Brief, BriefMood } from '@/lib/dailyBrief';

/** 円と角丸だけの幾何キャラ。表情は4つ（通常・喜び・気づき・応援） */
function Buddy({ mood, size = 26 }: { mood: BriefMood; size?: number }) {
  const eye = Math.max(2.5, size * 0.11);
  const happy = mood === 'happy' || mood === 'cheer';
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, backgroundColor: C.teal,
      alignItems: 'center', justifyContent: 'center',
    }}>
      {/* 目: 喜びは「にっこり弧」の代わりに少し下げた丸目、気づきは片目を大きく */}
      <View style={{ flexDirection: 'row', gap: size * 0.18, marginBottom: size * 0.06 }}>
        <View style={{
          width: mood === 'notice' ? eye * 1.5 : eye, height: happy ? eye * 0.55 : eye,
          borderRadius: eye, backgroundColor: '#ffffff',
        }} />
        <View style={{ width: eye, height: happy ? eye * 0.55 : eye, borderRadius: eye, backgroundColor: '#ffffff' }} />
      </View>
      {/* 口: 通常=点 / 喜び=横長 / 応援=大きめの楕円（オー！） */}
      <View style={{
        width: mood === 'cheer' ? eye * 1.6 : happy ? eye * 1.8 : eye * 0.9,
        height: mood === 'cheer' ? eye * 1.4 : eye * 0.6,
        borderRadius: eye, backgroundColor: 'rgba(255,255,255,0.9)',
      }} />
    </View>
  );
}

export default function DailyBrief({ brief, onClose }: { brief: Brief; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const reduce = useReduceMotion();

  // 呼吸: 4秒で1回のゆっくりした拡縮（ネイティブ駆動・装飾は控えめに）
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) { breath.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(breath, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [breath, reduce]);
  const scale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <Pressable style={s.wrap} onPress={() => setOpen((v) => !v)}>
      <View style={s.row}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <Buddy mood={brief.mood} />
        </Animated.View>
        <Text style={s.title} numberOfLines={open ? undefined : 1}>{brief.title}</Text>
        <Pressable hitSlop={10} onPress={onClose}>
          <Text style={s.x}>×</Text>
        </Pressable>
      </View>
      {open && (
        <View style={s.bodyBox}>
          <Text style={s.body}>{brief.body}</Text>
          <Text style={s.hint}>{t('（この帯は×でその日は閉じられます）')}</Text>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: C.accentSoft, borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 13, fontWeight: '700', color: C.ink, lineHeight: 18 },
  x: { fontSize: 17, color: C.faint, fontWeight: '700', paddingHorizontal: 2 },
  bodyBox: { marginTop: 8, marginLeft: 36 },
  body: { fontSize: 13, color: C.sub, lineHeight: 20 },
  hint: { fontSize: 10, color: C.faint, marginTop: 6 },
});
