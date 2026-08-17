// 月グリッドカレンダー（Web版 components/Calendar.tsx の移植）
// 記録あり=緑ドット / 目標超過=赤ドット / 未記録=? / 今日=強調。日タップで onSelect(dateKey)
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { C } from '@/lib/ui';

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

export type DayMark = { logged: boolean; over: boolean; unknown?: boolean };

function keyOf(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function MonthCalendar({
  today, marks, selected, onSelect, mode = 'body',
}: {
  today: string;
  marks: Map<string, DayMark>;
  selected: string | null;
  onSelect: (dateKey: string) => void;
  mode?: 'body' | 'training'; // trainingは「実施日ドット」のみの凡例にする
}) {
  const [y0, m0] = today.split('-').map(Number);
  const [view, setView] = useState({ y: y0, m: m0 - 1 }); // m: 0-11

  const isCurrentMonth = view.y === y0 && view.m === m0 - 1; // 未来月へは進めない（全部空になるだけ）
  const first = new Date(view.y, view.m, 1);
  const lastDate = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: lastDate }, (_, i) => i + 1)];

  function shiftMonth(n: number) {
    const d = new Date(view.y, view.m + n, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  }

  return (
    <View>
      <View style={s.head}>
        <Pressable style={s.nav} onPress={() => shiftMonth(-1)} hitSlop={8}><Text style={s.navT}>‹</Text></Pressable>
        <Text style={s.month}>{view.y}年{view.m + 1}月</Text>
        <Pressable style={s.nav} onPress={() => shiftMonth(1)} hitSlop={8} disabled={isCurrentMonth}>
          <Text style={[s.navT, isCurrentMonth && { opacity: 0.25 }]}>›</Text>
        </Pressable>
      </View>
      <View style={s.grid}>
        {DOW.map((d, i) => (
          <View key={d} style={s.cell}>
            <Text style={[s.dow, i === 0 && { color: C.coral }, i === 6 && { color: '#3b82f6' }]}>{d}</Text>
          </View>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <View key={`e${i}`} style={s.cell} />;
          const k = keyOf(view.y, view.m, day);
          const mk = marks.get(k);
          const isToday = k === today;
          const isSel = k === selected;
          const future = k > today;
          return (
            <Pressable key={k} style={[s.cell, isSel && s.sel]} onPress={() => onSelect(k)} disabled={future}>
              <Text style={[s.num, isToday && s.today, future && { color: C.faint }]}>{day}</Text>
              {!future && (
                mk?.unknown && !isToday
                  ? <Text style={s.q}>?</Text>
                  : <View style={[s.dot, { backgroundColor: !mk?.logged ? 'transparent' : mk.over ? C.coral : C.teal }]} />
              )}
            </Pressable>
          );
        })}
      </View>
      <View style={s.legend}>
        {mode === 'training' ? (
          <>
            <View style={[s.legDot, { backgroundColor: C.teal }]} /><Text style={s.legT}>トレした日</Text>
            <Text style={s.legT}>・タップで内容を表示</Text>
          </>
        ) : (
          <>
            <View style={[s.legDot, { backgroundColor: C.teal }]} /><Text style={s.legT}>記録あり</Text>
            <View style={[s.legDot, { backgroundColor: C.coral }]} /><Text style={s.legT}>目標超過</Text>
            <Text style={[s.legT, { fontWeight: '800' }]}>?</Text><Text style={s.legT}>未記録</Text>
            <Text style={s.legT}>・タップで詳細</Text>
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginBottom: 6 },
  nav: { paddingHorizontal: 10, paddingVertical: 2 },
  navT: { fontSize: 20, fontWeight: '800', color: C.sub },
  month: { fontSize: 14, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 5, borderRadius: 10 },
  sel: { backgroundColor: '#e8f5f0' },
  dow: { fontSize: 10.5, fontWeight: '700', color: C.sub },
  num: { fontSize: 13.5, fontWeight: '600', color: C.ink, fontVariant: ['tabular-nums'] },
  today: { color: C.teal, fontWeight: '800' },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  q: { fontSize: 9, fontWeight: '800', color: C.faint, marginTop: 0 },
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 6, flexWrap: 'wrap' },
  legDot: { width: 7, height: 7, borderRadius: 4, marginLeft: 6 },
  legT: { fontSize: 10, color: C.sub },
});
