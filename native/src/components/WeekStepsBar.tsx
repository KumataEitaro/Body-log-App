// 週間歩数目標のプログレスバー（B-15）。
//
// 思想メモ: 「日1万歩」は1日サボった瞬間に失敗が確定するが、週間目標なら
// 明日多めに歩けば取り返せる。ソフト週目標（B-13・記録の週目標）と同じ
// 「1日の欠けで全崩壊させない優しさ設計」。だから既定はオフで、目標も
// 35,000/50,000/70,000歩（日5,000〜10,000歩相当）のゆるい3段だけを用意する。
//
// 置き場所: 運動タブ「きょうの動き」の週歩数ミニバーの上＋概要「歩数・睡眠」詳細。
// 週は月曜起点（calcStreak・週別バランスと同じweekKeyの流儀）。
import { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { C, rgba, themed } from '@/lib/ui';
import { useReduceMotion } from '@/lib/motion';
import { t } from '@/lib/i18n';

// 「歩数の週目標」の保存キー（設定画面と共有）。値は歩数の文字列（'70000'等）・未設定/0=オフ
export const WEEK_STEPS_GOAL_KEY = 'bl-week-steps-goal';

/** 歩数の週目標（オフ=null）。設定画面で変えて戻ってきたときに追従するよう、フォーカスごとに読み直す */
export function useWeekStepsGoal(): number | null {
  const [goal, setGoal] = useState<number | null>(null);
  const read = useCallback(() => {
    AsyncStorage.getItem(WEEK_STEPS_GOAL_KEY).then((v) => {
      const n = Number(v);
      setGoal(Number.isFinite(n) && n > 0 ? n : null);
    }).catch(() => {});
  }, []);
  useEffect(() => { read(); }, [read]);
  useFocusEffect(read);
  return goal;
}

/** 今週（月曜起点）の歩数合計。days=readActivitySummaryの日別サマリー（直近7日で月曜を必ず含む） */
export function weekStepsOf(days: { date: string; steps: number }[], today: string): number {
  const dt = new Date(today + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));   // 月曜へ
  const mon = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  return days.filter((d) => d.date >= mon && d.date <= today).reduce((a, d) => a + d.steps, 0);
}

/** 週プログレス1本。「今週 42,300 / 70,000歩」＋スプリングで満ちるバー（達成でteal） */
export default function WeekStepsBar({ days, today, goal }: {
  days: { date: string; steps: number }[];
  today: string;
  goal: number;
}) {
  const steps = weekStepsOf(days, today);
  const pctN = Math.min(100, (steps / goal) * 100);
  const done = steps >= goal;
  const reduce = useReduceMotion();
  const pct = useSharedValue(0);
  useEffect(() => {
    // スプリングで満ちる（視差軽減設定では即値・跳ねない）
    pct.value = reduce ? pctN : withSpring(pctN, { damping: 18, stiffness: 140, overshootClamping: true });
  }, [pctN, reduce, pct]);
  const fill = useAnimatedStyle(() => ({ width: `${pct.value}%` }));
  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.label}>{t('歩数の週目標')}</Text>
        <Text style={[s.val, done && { color: C.successInk }]}>
          {t('今週 {n} / {g}歩', { n: steps.toLocaleString(), g: goal.toLocaleString() })}
          {done ? ' 🎉' : ''}
        </Text>
      </View>
      <View style={s.track}>
        <Animated.View style={[s.fill, { backgroundColor: done ? C.teal : rgba(C.teal, 0.45) }, fill]} />
      </View>
    </View>
  );
}

const s = themed(() => ({
  wrap: { marginTop: 14 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 },
  label: { fontSize: 11, fontWeight: '800', color: C.sub, letterSpacing: 0.2 },
  val: { fontSize: 12.5, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  track: { height: 10, borderRadius: 5, backgroundColor: C.track, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
}));
