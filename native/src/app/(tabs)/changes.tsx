// 身体の変化タブ（Phase 2）: KPIサマリー＋推移グラフ（系列・期間切替）。
// Web版ダッシュボードの中核の移植（カレンダー・傾向カード等はPhase 3）
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import SimpleChart, { type ChartPoint } from '@/components/SimpleChart';
import { mifflinBMR, targetKcal, todayJST, type ExLevel } from '@/lib/calc';
import { type Goal } from '@/lib/goal';

type Row = { date: string; intake: number | null; weight: number | null; waist: number | null; target: number; diff: number | null };
type Profile = { sex: 'male' | 'female'; height_cm: number; age: number; init_weight: number | null; life_factor: number };

const SERIES = [
  { key: 'weight', label: '体重', unit: 'kg', decimals: 1 },
  { key: 'waist', label: 'ウエスト', unit: 'cm', decimals: 1 },
  { key: 'intake', label: '摂取kcal', unit: '', decimals: 0 },
  { key: 'burn', label: '消費kcal', unit: '', decimals: 0 },
] as const;
const RANGES = [{ label: '30日', d: 30 }, { label: '90日', d: 90 }, { label: '全', d: 9999 }] as const;

function addDays(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function ChangesScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [serie, setSerie] = useState<typeof SERIES[number]['key']>('weight');
  const [range, setRange] = useState(30);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const [profRes, entRes, goalRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      supabase.from('entries').select('date,intake,weight,waist,ex,adj').order('date', { ascending: true }),
      supabase.from('goals').select('*').maybeSingle(),
    ]);
    const prof = profRes.data as Profile | null;
    if (goalRes.data) setGoal(goalRes.data as Goal);
    if (!prof || !entRes.data) return;
    let w: number = Number(prof.init_weight) || 70;
    setRows((entRes.data as { date: string; intake: number | null; weight: number | null; waist: number | null; ex: string | null; adj: number | null }[]).map((e) => {
      if (e.weight != null) w = Number(e.weight);
      const bmr = mifflinBMR(prof.sex, w, Number(prof.height_cm), Number(prof.age));
      const target = targetKcal(bmr, Number(prof.life_factor), (e.ex as ExLevel) || 'オフ', Number(e.adj) || 0);
      const intake = e.intake == null ? null : Number(e.intake);
      return {
        date: e.date, intake,
        weight: e.weight == null ? null : Number(e.weight),
        waist: e.waist == null ? null : Number(e.waist),
        target, diff: intake == null ? null : Math.round(intake - target),
      };
    }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = todayJST();
  const from = addDays(today, -range);
  const inRange = rows.filter((r) => range >= 9999 || r.date >= from);

  const points: ChartPoint[] = (() => {
    switch (serie) {
      case 'weight': return inRange.filter((r) => r.weight != null).map((r) => ({ date: r.date, value: r.weight! }));
      case 'waist': return inRange.filter((r) => r.waist != null).map((r) => ({ date: r.date, value: r.waist! }));
      case 'intake': return inRange.filter((r) => r.intake != null).map((r) => ({ date: r.date, value: r.intake! }));
      case 'burn': return inRange.map((r) => ({ date: r.date, value: r.target }));
    }
  })();
  const conf = SERIES.find((x) => x.key === serie)!;

  // KPI
  const weights = rows.filter((r) => r.weight != null);
  const latestW = weights.length ? weights[weights.length - 1].weight! : null;
  const firstW = weights.length ? weights[0].weight! : null;
  const sumAll = Math.round(rows.reduce((a, r) => a + (r.diff ?? 0), 0));
  let unrecorded = 0;
  if (rows.length > 0) {
    const yest = addDays(today, -1);
    const byDate = new Map(rows.map((r) => [r.date, r]));
    for (let d = rows[0].date; d <= yest; d = addDays(d, 1)) {
      const r = byDate.get(d);
      if (!r || r.intake == null) unrecorded++;
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Text style={s.h}>身体の変化</Text>

      {/* KPI */}
      <View style={s.kpiRow}>
        <View style={s.kpi}>
          <Text style={s.kpiL}>体重</Text>
          <Text style={s.kpiV}>{latestW != null ? latestW.toFixed(1) : '—'}<Text style={s.kpiU}>kg</Text></Text>
          {latestW != null && firstW != null && (
            <Text style={[s.kpiD, { color: latestW - firstW <= 0 ? C.teal : C.coral }]}>
              {latestW - firstW <= 0 ? '▼' : '▲'}{Math.abs(latestW - firstW).toFixed(1)}kg
            </Text>
          )}
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>累計収支</Text>
          <Text style={[s.kpiV, { color: sumAll <= 0 ? C.teal : C.coral }]}>{sumAll > 0 ? '+' : ''}{(sumAll / 1000).toFixed(1)}<Text style={s.kpiU}>k</Text></Text>
          <Text style={s.kpiD}>脂肪 約{(sumAll / 7200).toFixed(1)}kg</Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>未記録</Text>
          <Text style={s.kpiV}>{unrecorded}<Text style={s.kpiU}>日</Text></Text>
          <Text style={s.kpiD}>±0扱い</Text>
        </View>
      </View>

      {/* グラフ */}
      <View style={s.card}>
        <View style={s.chips}>
          {SERIES.map((x) => (
            <Pressable key={x.key} style={[s.chip, serie === x.key && s.chipOn]} onPress={() => setSerie(x.key)}>
              <Text style={[s.chipT, serie === x.key && { color: '#fff' }]}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
        <SimpleChart
          points={points} unit={conf.unit} decimals={conf.decimals}
          planValue={serie === 'weight' && goal?.target_weight != null ? Number(goal.target_weight) : null}
        />
        <View style={s.chips}>
          {RANGES.map((r) => (
            <Pressable key={r.label} style={[s.chip, range === r.d && s.chipOn]} onPress={() => setRange(r.d)}>
              <Text style={[s.chipT, range === r.d && { color: '#fff' }]}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
        {serie === 'weight' && goal?.target_weight != null && (
          <Text style={s.note}>点線＝目標 {Number(goal.target_weight).toFixed(1)}kg</Text>
        )}
      </View>

      <Text style={s.note}>カレンダー・食材の傾向・2週間レビューはPhase 3で移植予定（現行アプリで利用可）</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 64, paddingBottom: 40 },
  h: { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 12 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  kpi: { flex: 1, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 12 },
  kpiL: { fontSize: 10, fontWeight: '700', color: C.sub },
  kpiV: { fontSize: 20, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  kpiU: { fontSize: 11, color: C.sub, fontWeight: '600' },
  kpiD: { fontSize: 10, color: C.sub, marginTop: 2 },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 14, marginBottom: 12 },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontSize: 12, fontWeight: '700', color: C.sub },
  note: { fontSize: 11, color: C.faint, lineHeight: 18 },
});
