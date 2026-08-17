// 挙上重量の推移（「変化」タブ→筋トレの成長 用）
// トレタブから移設: 種目切替・重量/ボリューム切替・目標線・ボリューム判定
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import { TrendingUp, CalendarDays } from 'lucide-react-native';
import { trainingSeries, volumeVerdict } from '@/lib/training';
import InteractiveChart from '@/components/InteractiveChart';
import MonthCalendar, { type DayMark } from '@/components/MonthCalendar';

function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

type HistRow = { id: string; date: string; text: string };

export default function LiftingProgress() {
  const [history, setHistory] = useState<HistRow[]>([]);
  const [goalKg, setGoalKg] = useState<Map<string, number>>(new Map());
  const [selEx, setSelEx] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'kg' | 'volume'>('kg');
  const [exView, setExView] = useState<'chips' | 'list'>('chips');
  const [daySel, setDaySel] = useState<string | null>(null);

  useEffect(() => { AsyncStorage.getItem('bl-ex-view').then((v) => { if (v === 'list') setExView('list'); }).catch(() => {}); }, []);
  function toggleExView() {
    const v = exView === 'chips' ? 'list' : 'chips';
    setExView(v);
    AsyncStorage.setItem('bl-ex-view', v).catch(() => {});
  }

  const load = useCallback(async () => {
    const [{ data }, { data: tg }] = await Promise.all([
      supabase.from('logs').select('id,date,text').like('text', '🏋️%').order('at', { ascending: false }).limit(120),
      supabase.from('training_goals').select('name,target_kg'),
    ]);
    setHistory((data as HistRow[]) || []);
    if (tg) setGoalKg(new Map(tg.map((g: { name: string; target_kg: number }) => [g.name, Number(g.target_kg)])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const series = trainingSeries(history);
  const exercises = [...series.entries()].sort((a, b) => b[1].length - a[1].length).map(([n]) => n);
  const activeEx = selEx && series.has(selEx) ? selEx : exercises[0] ?? null;
  const exPoints = activeEx ? series.get(activeEx)! : [];
  const verdict = volumeVerdict(exPoints);

  // サマリー＋カレンダー用（トレ実施日ベース）
  const today = todayJST();
  const trainDates = [...new Set(history.map((h) => h.date))];
  const monthCount = trainDates.filter((d) => d.startsWith(today.slice(0, 7))).length;
  const last30 = trainDates.filter((d) => d >= shiftDate(today, -30)).length;
  const marks = new Map<string, DayMark>(trainDates.map((d) => [d, { logged: true, over: false }]));
  const dayItems = daySel ? history.filter((h) => h.date === daySel) : [];

  if (exercises.length === 0) {
    return (
      <View style={s.card}>
        <View style={s.h2Row}><TrendingUp size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>挙上重量の推移</Text></View>
        <Text style={s.muted}>トレタブで筋トレを記録すると、実施カレンダーと種目ごとの成長グラフがここに描かれます。</Text>
      </View>
    );
  }

  return (
    <View>
    {/* サマリー */}
    <View style={s.kpiRow}>
      <View style={s.kpi}>
        <Text style={s.kpiL}>今月のトレ</Text>
        <Text style={s.kpiV}>{monthCount}<Text style={s.kpiU}>日</Text></Text>
      </View>
      <View style={s.kpi}>
        <Text style={s.kpiL}>直近30日</Text>
        <Text style={s.kpiV}>{last30}<Text style={s.kpiU}>日</Text></Text>
      </View>
      <View style={s.kpi}>
        <Text style={s.kpiL}>種目数</Text>
        <Text style={s.kpiV}>{exercises.length}<Text style={s.kpiU}>種目</Text></Text>
      </View>
    </View>

    {/* トレーニングカレンダー */}
    <View style={s.card}>
      <View style={s.h2Row}><CalendarDays size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>トレーニングカレンダー</Text></View>
      <MonthCalendar today={today} marks={marks} selected={daySel} mode="training"
                     onSelect={(d) => setDaySel(daySel === d ? null : d)} />
      {daySel && (
        <View style={s.dayBox}>
          <Text style={s.dayHead}>{daySel.replace(/-/g, '/')} のトレーニング</Text>
          {dayItems.length === 0 && <Text style={s.muted}>この日の筋トレ記録はありません。</Text>}
          {dayItems.map((h) => (
            <Text key={h.id} style={s.dayText}>{h.text.replace(/^🏋️ /, '')}</Text>
          ))}
        </View>
      )}
    </View>

    {/* 推移グラフ */}
    <View style={s.card}>
      <View style={s.h2Row}><TrendingUp size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>挙上重量の推移</Text></View>
      <View style={s.chips}>
        {(['kg', 'volume'] as const).map((m) => (
          <Pressable key={m} style={[s.chip, chartMode === m && s.chipOn]} onPress={() => setChartMode(m)}>
            <Text style={[s.chipT, chartMode === m && { color: '#fff' }]}>{m === 'kg' ? '重量(kg)' : 'ボリューム'}</Text>
          </Pressable>
        ))}
      </View>
      <InteractiveChart
        points={exPoints.map((p) => ({ date: p.date, value: chartMode === 'kg' ? p.maxKg : p.volume }))}
        unit={chartMode === 'kg' ? 'kg' : 'kg·回'} decimals={0}
        planValue={chartMode === 'kg' && activeEx ? goalKg.get(activeEx) ?? null : null}
        presetDays={null}
      />
      {/* 種目セレクタ（チップ⇄リストの表示切替つき） */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {exView === 'chips' ? (
          <View style={[s.chips, { flex: 1 }]}>
            {exercises.map((n) => (
              <Pressable key={n} style={[s.chip, n === activeEx && s.chipOn]} onPress={() => setSelEx(n)}>
                <Text style={[s.chipT, n === activeEx && { color: '#fff' }]}>{n}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={{ flex: 1, marginVertical: 8 }}>
            {exercises.map((n) => (
              <Pressable key={n} style={s.listRow} onPress={() => setSelEx(n)}>
                <Text style={[s.listT, n === activeEx && { color: C.ink, fontWeight: '800' }]}>{n}</Text>
                {n === activeEx && <Text style={{ color: C.teal, fontWeight: '800' }}>✓</Text>}
              </Pressable>
            ))}
          </View>
        )}
        <Pressable onPress={toggleExView} hitSlop={8} style={s.viewToggle}>
          <Text style={s.viewToggleT}>{exView === 'chips' ? '☰' : '▤'}</Text>
        </Pressable>
      </View>
      {verdict && (
        <Text style={[s.verdict, { color: verdict.trend === 'down' ? C.amber : C.teal }]}>
          {verdict.trend === 'up' && `💪 ボリューム上昇中（直近 ${verdict.lastVolume.toLocaleString()}kg·回・平均比 +${verdict.pct}%）`}
          {verdict.trend === 'flat' && `➡️ ボリューム維持（平均比 ${verdict.pct > 0 ? '+' : ''}${verdict.pct}%）。減量中の維持は十分な成果`}
          {verdict.trend === 'down' && `⚠️ ボリューム低下（平均比 ${verdict.pct}%）。赤字が深すぎるサインかも。たんぱく質と睡眠を確認`}
        </Text>
      )}
      {activeEx && goalKg.has(activeEx) && chartMode === 'kg' && (
        <Text style={s.muted}>点線＝目標 {goalKg.get(activeEx)}kg</Text>
      )}
    </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 14, marginBottom: 12 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 8 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontSize: 12, fontWeight: '700', color: C.sub },
  verdict: { fontSize: 12.5, fontWeight: '600', lineHeight: 19, marginTop: 4 },
  muted: { fontSize: 11, color: C.faint, marginTop: 4 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  kpi: { flex: 1, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 12 },
  kpiL: { fontSize: 10, fontWeight: '700', color: C.sub },
  kpiV: { fontSize: 20, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  kpiU: { fontSize: 11, color: C.sub, fontWeight: '600' },
  dayBox: { borderTopWidth: 0.5, borderTopColor: C.line, marginTop: 8, paddingTop: 8 },
  dayHead: { fontSize: 12.5, fontWeight: '800', color: C.ink, marginBottom: 4, fontVariant: ['tabular-nums'] },
  dayText: { fontSize: 13, color: C.ink, lineHeight: 20, paddingVertical: 3 },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: C.line },
  listT: { fontSize: 13.5, color: C.sub, fontWeight: '600' },
  viewToggle: { marginLeft: 6, marginTop: 8, width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  viewToggleT: { fontSize: 13, color: C.sub, fontWeight: '700' },
});
