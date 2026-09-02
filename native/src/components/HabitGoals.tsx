// 「習慣」の目標（記録の週目標＋歩数の週目標）。
// 以前は設定画面に別々の行として置かれていたが、目標画面（GoalPanel hub）に統合した。
// どちらも「毎日じゃなくていい・週で帳尻が合えばOK」のソフト週目標（B-13 / B-15）で、
// 1日の欠けで全崩壊させない優しさ設計を共有する。値は端末保存（AsyncStorage）で即反映。
import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WEEK_GOAL_KEY } from '@/lib/achievements';
import { WEEK_STEPS_GOAL_KEY } from '@/components/WeekStepsBar';
import { SegmentedControl, Chip } from '@/components/ui/Selectable';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';

type WeekGoal = '7' | '5' | '4' | '3';
const STEPS_OPTIONS = [35000, 50000, 70000];

export default function HabitGoals() {
  // 記録の週目標。既定は「毎日」=現行と同じ意味なので、何もしない人の体験は一切変わらない。
  // 値は実績ページのバッジ判定と共有する
  const [weekGoal, setWeekGoal] = useState<WeekGoal>('7');
  useEffect(() => {
    AsyncStorage.getItem(WEEK_GOAL_KEY).then((v) => {
      if (v === '7' || v === '5' || v === '4' || v === '3') setWeekGoal(v);
    }).catch(() => {});
  }, []);
  function changeWeekGoal(v: WeekGoal) {
    setWeekGoal(v);
    AsyncStorage.setItem(WEEK_GOAL_KEY, v).catch(() => {});
  }

  // 歩数の週目標。日1万歩と違い、1日サボっても翌日に取り返せる。既定はオフ（0）
  const [stepsGoal, setStepsGoal] = useState<number>(0);
  useEffect(() => {
    AsyncStorage.getItem(WEEK_STEPS_GOAL_KEY).then((v) => {
      const n = Number(v);
      if (STEPS_OPTIONS.includes(n)) setStepsGoal(n);
    }).catch(() => {});
  }, []);
  function changeStepsGoal(n: number) {
    setStepsGoal(n);
    if (n > 0) AsyncStorage.setItem(WEEK_STEPS_GOAL_KEY, String(n)).catch(() => {});
    else AsyncStorage.removeItem(WEEK_STEPS_GOAL_KEY).catch(() => {});
  }

  return (
    <View>
      {/* ソフト週目標: 「毎日」を強いない自己契約。達成の表示は実績ページの「今週」ブロック */}
      <Text style={s.label}>{t('記録の週目標')}</Text>
      <Text style={s.sub}>{t('毎日じゃなくていい。自分で決めたペースを守れたら、それは成功です。')}</Text>
      <SegmentedControl
        options={[
          { key: '7', label: t('毎日') },
          { key: '5', label: t('週5日') },
          { key: '4', label: t('週4日') },
          { key: '3', label: t('週3日') },
        ]}
        value={weekGoal} onChange={changeWeekGoal}
      />

      <Text style={[s.label, { marginTop: 14 }]}>{t('歩数の週目標')}</Text>
      <Text style={s.sub}>{t('1日サボっても、週のなかで取り返せばOK。運動タブと概要に進捗バーが出ます。')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip label={t('オフ')} tone="ink" selected={stepsGoal === 0} onPress={() => changeStepsGoal(0)} />
        {STEPS_OPTIONS.map((n) => (
          <Chip key={n} label={t('{n}歩', { n: n.toLocaleString() })} tone="ink"
                selected={stepsGoal === n} onPress={() => changeStepsGoal(n)} />
        ))}
      </View>
    </View>
  );
}

const s = themed(() => ({
  label: { fontSize: 15, fontWeight: '800', color: C.ink },
  sub: { fontSize: 13, color: C.sub, lineHeight: 18, marginTop: 2, marginBottom: 10 },
}));
