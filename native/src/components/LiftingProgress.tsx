// 挙上重量の推移（「変化」タブ→筋トレの成長 用）
// トレタブから移設: 種目切替・重量/ボリューム切替・目標線・ボリューム判定
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { trainingSeries, volumeVerdict } from '@/lib/training';
import SimpleChart from '@/components/SimpleChart';

type HistRow = { id: string; date: string; text: string };

export default function LiftingProgress() {
  const [history, setHistory] = useState<HistRow[]>([]);
  const [goalKg, setGoalKg] = useState<Map<string, number>>(new Map());
  const [selEx, setSelEx] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'kg' | 'volume'>('kg');

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

  if (exercises.length === 0) {
    return (
      <View style={s.card}>
        <Text style={s.h2}>📈 挙上重量の推移</Text>
        <Text style={s.muted}>トレタブで筋トレを記録すると、種目ごとの成長グラフがここに描かれます。</Text>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <Text style={s.h2}>📈 挙上重量の推移</Text>
      <View style={s.chips}>
        {(['kg', 'volume'] as const).map((m) => (
          <Pressable key={m} style={[s.chip, chartMode === m && s.chipOn]} onPress={() => setChartMode(m)}>
            <Text style={[s.chipT, chartMode === m && { color: '#fff' }]}>{m === 'kg' ? '重量(kg)' : 'ボリューム'}</Text>
          </Pressable>
        ))}
      </View>
      <SimpleChart
        points={exPoints.map((p) => ({ date: p.date, value: chartMode === 'kg' ? p.maxKg : p.volume }))}
        unit={chartMode === 'kg' ? 'kg' : 'kg·回'} decimals={0}
        planValue={chartMode === 'kg' && activeEx ? goalKg.get(activeEx) ?? null : null}
      />
      <View style={s.chips}>
        {exercises.map((n) => (
          <Pressable key={n} style={[s.chip, n === activeEx && s.chipOn]} onPress={() => setSelEx(n)}>
            <Text style={[s.chipT, n === activeEx && { color: '#fff' }]}>{n}</Text>
          </Pressable>
        ))}
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
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 14, marginBottom: 12 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 8 },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontSize: 12, fontWeight: '700', color: C.sub },
  verdict: { fontSize: 12.5, fontWeight: '600', lineHeight: 19, marginTop: 4 },
  muted: { fontSize: 11, color: C.faint, marginTop: 4 },
});
