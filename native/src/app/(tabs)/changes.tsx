// 身体の変化タブ（Phase 2）: KPIサマリー＋推移グラフ（系列・期間切替）。
// Web版ダッシュボードの中核の移植（カレンダー・傾向カード等はPhase 3）
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import SimpleChart, { type ChartPoint } from '@/components/SimpleChart';
import MonthCalendar, { type DayMark } from '@/components/MonthCalendar';
import StatusBarMask from '@/components/StatusBarMask';
import QuickLogFab from '@/components/QuickLogFab';
import GoalPanel from '@/components/GoalPanel';
import LiftingProgress from '@/components/LiftingProgress';
import { healthAvailable, requestHealthAuth, readActivitySummary, type HealthDaySummary } from '@/lib/health';
import { mifflinBMR, targetKcal, todayJST, judge, type ExLevel } from '@/lib/calc';
import { type Goal } from '@/lib/goal';
import { buildItemDays, foodWeightEffects, type FoodEffect } from '@/lib/insights';
import { logIcon, logTitle } from '@/lib/feed';

type Row = { date: string; intake: number | null; weight: number | null; waist: number | null; target: number; diff: number | null };
import { type FoodItem } from '@/lib/items';
type DayDetail = { id: string; at: string | null; text: string; kcal: number | null; items: FoodItem[] | null; weight: number | null; ex: string | null; mood: string | null }[];
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
  const [foodFx, setFoodFx] = useState<FoodEffect[]>([]);
  const [daySel, setDaySel] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null);
  const [topSeg, setTopSeg] = useState<'body' | 'training'>('body');
  const [activity, setActivity] = useState<HealthDaySummary[] | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthMsg, setHealthMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const [profRes, entRes, goalRes, itemRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      supabase.from('entries').select('date,intake,weight,waist,ex,adj').order('date', { ascending: true }),
      supabase.from('goals').select('*').maybeSingle(),
      supabase.from('logs').select('date,items').order('date', { ascending: true }).limit(2000),
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
    // 食材×翌日体重の傾向（Web版ダッシュボードと同一の分析・ベストエフォート）
    try {
      const weightPts = (entRes.data as { date: string; weight: number | null }[])
        .filter((e) => e.weight != null).map((e) => ({ date: e.date, weight: Number(e.weight) }));
      setFoodFx(foodWeightEffects(buildItemDays((itemRes.data as { date: string; items?: { name?: string }[] }[]) || []), weightPts));
    } catch { /* 分析はベストエフォート */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // カレンダーの日タップ → その日の記録を取得して下に表示
  async function openDay(dateKey: string) {
    if (daySel === dateKey) { setDaySel(null); setDayDetail(null); return; }
    setDaySel(dateKey); setDayDetail(null);
    const { data } = await supabase.from('logs').select('id,at,text,kcal,items,weight,ex,mood')
      .eq('date', dateKey).order('at', { ascending: true });
    setDayDetail((data as DayDetail) || []);
  }

  // 歩数・睡眠サマリー（ヘルスケア）— ログデータの置き場は設定ではなくこのタブ
  async function loadActivity() {
    setHealthBusy(true); setHealthMsg(null);
    try {
      if (!(await requestHealthAuth())) { setHealthMsg('ヘルスケアへのアクセスが許可されませんでした。'); return; }
      const res = await readActivitySummary(7);
      if ('error' in res) { setHealthMsg(res.error); return; }
      setActivity(res);
      if (res.length === 0) setHealthMsg('直近7日のデータが見つかりませんでした。');
    } finally { setHealthBusy(false); }
  }

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

  // カレンダーのマーク（記録あり=緑 / 目標超過=赤 / 未記録=?）— Web版と同じ判定
  const marks = new Map<string, DayMark>(rows.map((r) => [
    r.date,
    { logged: r.intake != null, over: r.diff != null && judge(r.diff) === 'NG', unknown: r.intake == null },
  ]));
  if (rows.length > 0) {
    const yest = addDays(today, -1);
    for (let d = rows[0].date; d <= yest; d = addDays(d, 1)) {
      if (!marks.has(d)) marks.set(d, { logged: false, over: false, unknown: true });
    }
  }

  // KPI
  const weights = rows.filter((r) => r.weight != null);
  const latestW = weights.length ? weights[weights.length - 1].weight! : null;
  // 増減は直近30日の起点と比較（全期間比は取込データ起点になり実感と合わない）
  const w30 = weights.filter((r) => r.date >= addDays(today, -30));
  const firstW = w30.length ? w30[0].weight! : null;
  const sumAll = Math.round(rows.reduce((a, r) => a + (r.diff ?? 0), 0));
  // 未記録は「直近30日」に限定して数える（全期間だと取込データ起点で数千日になり意味を失う）
  let unrecorded = 0;
  if (rows.length > 0) {
    const yest = addDays(today, -1);
    const from30 = addDays(today, -30);
    const start = rows[0].date > from30 ? rows[0].date : from30;
    const byDate = new Map(rows.map((r) => [r.date, r]));
    for (let d = start; d <= yest; d = addDays(d, 1)) {
      const r = byDate.get(d);
      if (!r || r.intake == null) unrecorded++;
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <ScrollView
      style={{ flex: 1 }} contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Text style={s.h}>変化</Text>

      {/* トップセグメント: ターゲット軸で2択（実績と目標は同じ画面に縦積み） */}
      <View style={s.topSegWrap}>
        {([['body', '🧍 身体の変化'], ['training', '🏋️ 筋トレの成長']] as const).map(([k, l]) => (
          <Pressable key={k} style={[s.topSeg, topSeg === k && s.topSegOn]} onPress={() => setTopSeg(k)}>
            <Text style={[s.topSegT, topSeg === k && { color: '#fff' }]}>{l}</Text>
          </Pressable>
        ))}
      </View>

      {topSeg === 'training' && (
        <>
          <LiftingProgress />
          <GoalPanel mode="training" />
        </>
      )}

      {topSeg === 'body' && (
      <>
      {/* KPI */}
      <View style={s.kpiRow}>
        <View style={s.kpi}>
          <Text style={s.kpiL}>体重</Text>
          <Text style={s.kpiV}>{latestW != null ? latestW.toFixed(1) : '—'}<Text style={s.kpiU}>kg</Text></Text>
          {latestW != null && firstW != null && (
            <Text style={[s.kpiD, { color: latestW - firstW <= 0 ? C.teal : C.coral }]}>
              30日で{latestW - firstW <= 0 ? '▼' : '▲'}{Math.abs(latestW - firstW).toFixed(1)}kg
            </Text>
          )}
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>累計収支</Text>
          <Text style={[s.kpiV, { color: sumAll <= 0 ? C.teal : C.coral }]}>{sumAll > 0 ? '+' : ''}{(sumAll / 1000).toFixed(1)}<Text style={s.kpiU}>k</Text></Text>
          <Text style={s.kpiD}>脂肪 約{(sumAll / 7200).toFixed(1)}kg</Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>未記録（30日）</Text>
          <Text style={s.kpiV}>{unrecorded}<Text style={s.kpiU}>日</Text></Text>
          <Text style={s.kpiD}>±0扱い</Text>
        </View>
      </View>

      {/* カレンダー（サマリーの直下・日タップで詳細） */}
      <View style={s.card}>
        <Text style={s.h2}>📅 カレンダー</Text>
        <MonthCalendar today={today} marks={marks} selected={daySel} onSelect={openDay} />
        {daySel && (
          <View style={s.dayBox}>
            <Text style={s.dayHead}>{daySel.replace(/-/g, '/')} の記録</Text>
            {dayDetail === null && <Text style={s.note}>読み込み中…</Text>}
            {dayDetail !== null && dayDetail.length === 0 && <Text style={s.note}>この日の記録はありません。</Text>}
            {dayDetail?.map((l) => (
              <View key={l.id} style={s.dayRow}>
                <Text style={{ fontSize: 13 }}>{logIcon(l)}</Text>
                <Text style={s.dayText} numberOfLines={2}>{logTitle(l)}</Text>
                {l.kcal != null && (
                  <View style={s.kcalBadge}><Text style={s.kcalBadgeT}>{Math.round(Number(l.kcal)).toLocaleString()} kcal</Text></View>
                )}
              </View>
            ))}
          </View>
        )}
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

      {/* 目標設定＋チートデイ（グラフの直下＝実績と目標を同じ画面で） */}
      <GoalPanel mode="weight" />

      {/* 食材×体の傾向（データが揃うまで非表示・Web版と同じしきい値） */}
      {foodFx.length >= 3 && (() => {
        const down = foodFx.filter((f) => f.effect < -0.02).slice(0, 3);
        const up = [...foodFx].reverse().filter((f) => f.effect > 0.02).slice(0, 3);
        if (down.length === 0 && up.length === 0) return null;
        const g = (kg: number) => `${kg > 0 ? '+' : ''}${Math.round(kg * 1000)}g`;
        return (
          <View style={s.card}>
            <Text style={s.h2}>🔬 食材とあなたの体の傾向</Text>
            <Text style={s.note}>よく食べる食材ごとに「食べた翌日」と「食べなかった翌日」の体重変化を比べました。</Text>
            {down.length > 0 && <Text style={[s.fxHead, { color: C.teal }]}>▼ 食べた翌日、下がりやすい</Text>}
            {down.map((f) => (
              <View key={f.name} style={s.fxRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fxName}>{f.name}</Text>
                  <Text style={s.note}>食べた日{f.withN}日の平均 {g(f.withAvg)} ／ 食べない日 {g(f.withoutAvg)}</Text>
                </View>
                <Text style={[s.fxVal, { color: C.teal }]}>{g(f.effect)}</Text>
              </View>
            ))}
            {up.length > 0 && <Text style={[s.fxHead, { color: C.coral }]}>▲ 食べた翌日、上がりやすい</Text>}
            {up.map((f) => (
              <View key={f.name} style={s.fxRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fxName}>{f.name}</Text>
                  <Text style={s.note}>食べた日{f.withN}日の平均 {g(f.withAvg)} ／ 食べない日 {g(f.withoutAvg)}</Text>
                </View>
                <Text style={[s.fxVal, { color: C.coral }]}>{g(f.effect)}</Text>
              </View>
            ))}
            <Text style={s.note}>※相関であり因果ではありません（水分・塩分・食べ合わせの影響を含みます）。データが増えるほど精度が上がります。</Text>
          </View>
        );
      })()}

      {/* 歩数・睡眠（ヘルスケア連携が有効な環境のみ） */}
      {healthAvailable() && (
        <View style={s.card}>
          <Text style={s.h2}>⌚ 歩数・睡眠（直近7日）</Text>
          {activity === null ? (
            <Pressable style={s.actBtn} onPress={loadActivity} disabled={healthBusy}>
              <Text style={s.actBtnT}>{healthBusy ? '読み込み中…' : 'ヘルスケアから読み込む'}</Text>
            </Pressable>
          ) : (
            activity.map((a) => (
              <View key={a.date} style={s.actRow}>
                <Text style={s.actDate}>{a.date.slice(5).replace('-', '/')}</Text>
                <Text style={s.actVal}>👟 {a.steps.toLocaleString()}歩</Text>
                <Text style={s.actVal}>😴 {a.sleepH > 0 ? `${a.sleepH}h` : '—'}</Text>
              </View>
            ))
          )}
          {healthMsg && <Text style={[s.note, { color: C.coral }]}>{healthMsg}</Text>}
        </View>
      )}
      </>
      )}
    </ScrollView>
    <QuickLogFab />
    <StatusBarMask />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 64, paddingBottom: 40 },
  h: { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 12 },
  topSegWrap: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  topSeg: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  topSegOn: { backgroundColor: C.teal, borderColor: C.teal },
  topSegT: { fontSize: 13, fontWeight: '800', color: C.sub },
  actBtn: { backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 11, alignItems: 'center', marginTop: 4 },
  actBtnT: { fontSize: 12.5, fontWeight: '800', color: C.ink },
  actRow: { flexDirection: 'row', gap: 12, paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: C.line, alignItems: 'center' },
  actDate: { fontSize: 11.5, color: C.faint, fontWeight: '700', width: 40, fontVariant: ['tabular-nums'] },
  actVal: { fontSize: 12.5, color: C.ink, fontVariant: ['tabular-nums'] },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  kpi: { flex: 1, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 12 },
  kpiL: { fontSize: 10, fontWeight: '700', color: C.sub },
  kpiV: { fontSize: 20, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  kpiU: { fontSize: 11, color: C.sub, fontWeight: '600' },
  kpiD: { fontSize: 10, color: C.sub, marginTop: 2 },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 14, marginBottom: 12 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 8 },
  dayBox: { borderTopWidth: 0.5, borderTopColor: C.line, marginTop: 8, paddingTop: 8 },
  dayHead: { fontSize: 12.5, fontWeight: '800', color: C.ink, marginBottom: 4, fontVariant: ['tabular-nums'] },
  dayRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: C.line },
  dayText: { flex: 1, fontSize: 13, color: C.ink, lineHeight: 19 },
  kcalBadge: { backgroundColor: '#eef4f0', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  kcalBadgeT: { fontSize: 11.5, fontWeight: '800', color: C.teal, fontVariant: ['tabular-nums'] },
  fxHead: { fontSize: 11.5, fontWeight: '800', marginTop: 8, marginBottom: 2 },
  fxRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: C.line },
  fxName: { fontSize: 13.5, fontWeight: '700', color: C.ink },
  fxVal: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontSize: 12, fontWeight: '700', color: C.sub },
  note: { fontSize: 11, color: C.faint, lineHeight: 18 },
});
