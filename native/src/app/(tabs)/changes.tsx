// 身体の変化タブ（Phase 2）: KPIサマリー＋推移グラフ（系列・期間切替）。
// Web版ダッシュボードの中核の移植（カレンダー・傾向カード等はPhase 3）
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import InteractiveChart, { type ChartPoint } from '@/components/InteractiveChart';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReorderableCards from '@/components/ReorderableCards';
import { useGuide, useGuideTarget } from '@/components/GuideTour';
import { useRouter, useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { CalendarDays, FlaskConical, Footprints, PersonStanding, Dumbbell } from 'lucide-react-native';
import HeaderGear from '@/components/HeaderGear';
import GoalSummaryCard from '@/components/GoalSummaryCard';
import BodyPhotosCard from '@/components/BodyPhotosCard';

// 並び替えはReorderableCards（gesture-handler+reanimated 4の自前実装・インプレイスの
// 長押しドラッグ。外部D&Dライブラリは白画面事故があったため使わない）
import MonthCalendar, { type DayMark } from '@/components/MonthCalendar';
import StatusBarMask from '@/components/StatusBarMask';
import QuickLogFab from '@/components/QuickLogFab';
import GoalPanel from '@/components/GoalPanel';
import { LiftKpiCard, LiftCalendarCard, LiftChartCard } from '@/components/LiftingProgress';
import { healthAvailable, requestHealthAuth, readActivitySummary, type HealthDaySummary } from '@/lib/health';
import { mifflinBMR, targetKcal, todayJST, judge, type ExLevel } from '@/lib/calc';
import { type Goal } from '@/lib/goal';
import { buildItemDays, foodWeightEffects, type FoodEffect } from '@/lib/insights';
import { logIcon, logTitle } from '@/lib/feed';

type Row = { date: string; intake: number | null; weight: number | null; waist: number | null; bodyfat: number | null; target: number; diff: number | null };
import { type FoodItem } from '@/lib/items';
type DayDetail = { id: string; at: string | null; text: string; kcal: number | null; items: FoodItem[] | null; weight: number | null; ex: string | null; mood: string | null }[];
type Profile = { sex: 'male' | 'female'; height_cm: number; age: number; init_weight: number | null; life_factor: number };

const SERIES = [
  { key: 'weight', label: '体重', unit: 'kg', decimals: 1 },
  { key: 'waist', label: 'ウエスト', unit: 'cm', decimals: 1 },
  { key: 'bodyfat', label: '体脂肪率', unit: '%', decimals: 1 },
  { key: 'intake', label: '摂取kcal', unit: '', decimals: 0 },
  { key: 'burn', label: '消費kcal', unit: '', decimals: 0 },
] as const;
const RANGES = [{ label: '30日', d: 30 }, { label: '90日', d: 90 }, { label: '全', d: 9999 }] as const;

// ===== レイアウト並び替え（iOS風Jiggle Mode） =====
const BODY_ORDER_DEFAULT = ['kpi', 'calendar', 'chart', 'photos', 'goal', 'trends', 'health'];
const TRAIN_ORDER_DEFAULT = ['tkpi', 'tcal', 'tchart', 'tgoal'];
const CARD_LABELS: Record<string, string> = {
  kpi: 'サマリー', calendar: 'カレンダー', chart: '推移グラフ', photos: '体の写真', goal: '目標',
  trends: '食材の傾向', health: '歩数・睡眠',
  tkpi: 'トレのサマリー', tcal: 'トレーニングカレンダー', tchart: '挙上重量グラフ', tgoal: '種目別目標',
};
// 保存済み順序を現行カード構成とマージ（将来カードが増えても壊れない）
function mergeOrder(saved: string[], def: string[]): string[] {
  const kept = saved.filter((k) => def.includes(k));
  return [...kept, ...def.filter((k) => !kept.includes(k))];
}


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
  const [liveDays, setLiveDays] = useState<number | null>(null); // ピンチ/パン後の実表示日数
  const [liveFull, setLiveFull] = useState(false);
  const [chartNonce, setChartNonce] = useState(0); // 同じプリセット再タップでも窓をリセットするため
  const [refreshing, setRefreshing] = useState(false);
  const [foodFx, setFoodFx] = useState<FoodEffect[]>([]);
  const [daySel, setDaySel] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null);
  const router = useRouter();
  const guide = useGuide();
  const chartTarget = useGuideTarget('chart');
  const [topSeg, setTopSeg] = useState<'body' | 'training'>('body');
  const [editing, setEditing] = useState(false);
  const [orderBody, setOrderBody] = useState<string[]>(BODY_ORDER_DEFAULT);
  const [orderTrain, setOrderTrain] = useState<string[]>(TRAIN_ORDER_DEFAULT);

  // 並び順の復元
  useEffect(() => {
    (async () => {
      try {
        const b = JSON.parse((await AsyncStorage.getItem('bl-order-body')) || 'null');
        if (Array.isArray(b)) setOrderBody(mergeOrder(b, BODY_ORDER_DEFAULT));
        const t = JSON.parse((await AsyncStorage.getItem('bl-order-train')) || 'null');
        if (Array.isArray(t)) setOrderTrain(mergeOrder(t, TRAIN_ORDER_DEFAULT));
      } catch { /* 初回など */ }
    })();
  }, []);

  // 離脱時確定用に最新値をrefへ同期（AppState/blurリスナーの古いクロージャ対策）
  const editStateRef = useRef({ editing: false, body: BODY_ORDER_DEFAULT, train: TRAIN_ORDER_DEFAULT });
  editStateRef.current = { editing, body: orderBody, train: orderTrain };

  const finishEditing = useCallback(async () => {
    setEditing(false);
    try {
      await AsyncStorage.setItem('bl-order-body', JSON.stringify(editStateRef.current.body));
      await AsyncStorage.setItem('bl-order-train', JSON.stringify(editStateRef.current.train));
    } catch { /* 保存失敗はレイアウトが戻るだけ */ }
  }, []);

  // 編集中にホーム画面へ戻った（バックグラウンド化）ら、その時点の並びで確定する
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if ((st === 'background' || st === 'inactive') && editStateRef.current.editing) finishEditing();
    });
    return () => sub.remove();
  }, [finishEditing]);

  // 編集中に他タブへ移動した場合も確定する
  useFocusEffect(
    useCallback(() => () => { if (editStateRef.current.editing) finishEditing(); }, [finishEditing])
  );
  const [activity, setActivity] = useState<HealthDaySummary[] | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthMsg, setHealthMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const [profRes, entResRaw, goalRes, itemRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      supabase.from('entries').select('date,intake,weight,waist,bodyfat,ex,adj').order('date', { ascending: true }),
      supabase.from('goals').select('*').maybeSingle(),
      supabase.from('logs').select('date,items').order('date', { ascending: true }).limit(2000),
    ]);
    // bodyfat列が無い旧DB（v16未適用）でも画面が壊れないようフォールバック
    const entRes = entResRaw.error
      ? await supabase.from('entries').select('date,intake,weight,waist,ex,adj').order('date', { ascending: true })
      : entResRaw;
    const prof = profRes.data as Profile | null;
    if (goalRes.data) setGoal(goalRes.data as Goal);
    if (!prof || !entRes.data) return;
    let w: number = Number(prof.init_weight) || 70;
    setRows((entRes.data as { date: string; intake: number | null; weight: number | null; waist: number | null; bodyfat: number | null; ex: string | null; adj: number | null }[]).map((e) => {
      if (e.weight != null) w = Number(e.weight);
      const bmr = mifflinBMR(prof.sex, w, Number(prof.height_cm), Number(prof.age));
      const target = targetKcal(bmr, Number(prof.life_factor), (e.ex as ExLevel) || 'オフ', Number(e.adj) || 0);
      const intake = e.intake == null ? null : Number(e.intake);
      return {
        date: e.date, intake,
        weight: e.weight == null ? null : Number(e.weight),
        waist: e.waist == null ? null : Number(e.waist),
        bodyfat: e.bodyfat == null ? null : Number(e.bodyfat),
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

  // チャートには全期間を渡し、表示窓（presetDays＋ピンチ/パン）で絞る
  const points: ChartPoint[] = (() => {
    switch (serie) {
      case 'weight': return rows.filter((r) => r.weight != null).map((r) => ({ date: r.date, value: r.weight! }));
      case 'waist': return rows.filter((r) => r.waist != null).map((r) => ({ date: r.date, value: r.waist! }));
      case 'bodyfat': return rows.filter((r) => r.bodyfat != null).map((r) => ({ date: r.date, value: r.bodyfat! }));
      case 'intake': return rows.filter((r) => r.intake != null).map((r) => ({ date: r.date, value: r.intake! }));
      case 'burn': return rows.map((r) => ({ date: r.date, value: r.target }));
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

  // ===== カード定義（表示順はorderBody/orderTrainの配列で制御） =====
  const kpiCard = (
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
  );

  const calendarCard = (
      <View style={s.card}>
        <View style={s.h2Row}><CalendarDays size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>カレンダー</Text></View>
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
  );

  const chartCard = (
      <View style={s.card} ref={chartTarget} collapsable={false}>
        <View style={s.chips}>
          {SERIES.map((x) => (
            <Pressable key={x.key} style={[s.chip, serie === x.key && s.chipOn]} onPress={() => setSerie(x.key)}>
              <Text style={[s.chipT, serie === x.key && { color: '#fff' }]}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
        <InteractiveChart
          key={chartNonce}
          points={points} unit={conf.unit} decimals={conf.decimals}
          planValue={serie === 'weight' && goal?.target_weight != null ? Number(goal.target_weight) : null}
          presetDays={range >= 9999 ? null : range}
          onDaysChange={(d, isFull) => { setLiveDays(d); setLiveFull(isFull); }}
        />
        {/* 期間チップ＝状態表示兼ショートカット。ピンチ後は実表示日数に追従し、どれにも該当しなければ実日数チップが出る */}
        <View style={s.chips}>
          {(() => {
            const isActive = (d: number) =>
              liveDays == null
                ? range === d
                : d >= 9999 ? liveFull : (!liveFull && Math.abs(liveDays - d) / d <= 0.25);
            const noneActive = liveDays != null && !RANGES.some((r) => isActive(r.d));
            return (
              <>
                {RANGES.map((r) => (
                  <Pressable key={r.label} style={[s.chip, isActive(r.d) && s.chipOn]}
                             onPress={() => { setRange(r.d); setLiveDays(null); setChartNonce((n) => n + 1); }}>
                    <Text style={[s.chipT, isActive(r.d) && { color: '#fff' }]}>{r.label}</Text>
                  </Pressable>
                ))}
                {noneActive && (
                  <View style={[s.chip, s.chipOn, { borderStyle: 'dashed' }]}>
                    <Text style={[s.chipT, { color: '#fff' }]}>{liveDays}日</Text>
                  </View>
                )}
              </>
            );
          })()}
        </View>
        {serie === 'weight' && goal?.target_weight != null && (
          <Text style={s.note}>点線＝目標 {Number(goal.target_weight).toFixed(1)}kg</Text>
        )}
      </View>
  );

  const trendsCard = foodFx.length >= 3 ? (() => {
        const down = foodFx.filter((f) => f.effect < -0.02).slice(0, 3);
        const up = [...foodFx].reverse().filter((f) => f.effect > 0.02).slice(0, 3);
        if (down.length === 0 && up.length === 0) return null;
        const g = (kg: number) => `${kg > 0 ? '+' : ''}${Math.round(kg * 1000)}g`;
        return (
          <View style={s.card}>
            <View style={s.h2Row}><FlaskConical size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>食材とあなたの体の傾向</Text></View>
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
      })() : null;

  const healthCard = healthAvailable() ? (
        <View style={s.card}>
          <View style={s.h2Row}><Footprints size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>歩数・睡眠（直近7日）</Text></View>
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
  ) : null;

  function card(key: string): ReactNode {
    switch (key) {
      case 'kpi': return kpiCard;
      case 'calendar': return calendarCard;
      case 'chart': return chartCard;
      case 'photos': return <BodyPhotosCard />;
      case 'goal': return <GoalSummaryCard mode="weight" />;
      case 'trends': return trendsCard;
      case 'health': return healthCard;
      case 'tkpi': return <LiftKpiCard />;
      case 'tcal': return <LiftCalendarCard />;
      case 'tchart': return <LiftChartCard />;
      case 'tgoal': return <GoalSummaryCard mode="training" />;
      default: return null;
    }
  }

  const order = topSeg === 'body' ? orderBody : orderTrain;
  const setOrder = topSeg === 'body' ? setOrderBody : setOrderTrain;

  // 最初の並びに戻す
  async function resetOrder() {
    setOrderBody(BODY_ORDER_DEFAULT);
    setOrderTrain(TRAIN_ORDER_DEFAULT);
    try {
      await AsyncStorage.removeItem('bl-order-body');
      await AsyncStorage.removeItem('bl-order-train');
    } catch { /* 無視 */ }
  }

  const headerJSX = (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        {/* ⚙は固定配置のHeaderGear（右余白38で衝突回避） */}
        <Text style={s.pageTitle}>概要</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginRight: 38 }}>
          {editing ? (
            <>
              <Pressable onPress={resetOrder} style={s.editBtn} hitSlop={8}><Text style={s.editBtnT}>元に戻す</Text></Pressable>
              <Pressable onPress={finishEditing} style={s.doneBtn} hitSlop={8}><Text style={s.doneBtnT}>完了</Text></Pressable>
            </>
          ) : (
            <Pressable onPress={() => setEditing(true)} hitSlop={8} style={s.editBtn}><Text style={s.editBtnT}>≡ 並べ替え</Text></Pressable>
          )}
        </View>
      </View>
      <View style={s.topSegWrap}>
        {([['body', '身体の変化', PersonStanding], ['training', '筋トレの成長', Dumbbell]] as const).map(([k, l, Icon]) => (
          <Pressable key={k} style={[s.topSeg, topSeg === k && s.topSegOn]} onPress={() => setTopSeg(k)}>
            <Icon size={14} color={topSeg === k ? '#fff' : C.sub} />
            <Text style={[s.topSegT, topSeg === k && { color: '#fff' }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      {editing && <Text style={s.editHint}>カードを長押し→そのままドラッグで移動。「完了」で保存します</Text>}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* インプレイスのドラッグ並び替え（通常時は普通のスクロール・カード長押しで編集モードへ） */}
      <ReorderableCards
        key={topSeg}
        editing={editing}
        order={order}
        onOrderChange={setOrder}
        renderCard={card}
        ghostLabel={(k) => CARD_LABELS[k] ?? k}
        header={headerJSX}
        onEnterEdit={() => setEditing(true)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        contentContainerStyle={s.scroll}
        onScroller={(fn) => guide.registerScroller('/changes', fn)}
      />
      {!editing && <QuickLogFab />}
      <StatusBarMask />
      <HeaderGear guideKey="gear" />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 64, paddingBottom: 40 },
  h: { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 12 },
  pageTitle: { fontSize: 21, fontWeight: '600', color: C.ink },
  topSegWrap: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  topSeg: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  gearBtn: { width: 30, height: 30, borderRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' },
  topSegOn: { backgroundColor: C.teal, borderColor: C.teal },
  topSegT: { fontSize: 13, fontWeight: '800', color: C.sub },
  editBtn: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.panel },
  editBtnT: { fontSize: 12, fontWeight: '800', color: C.sub },
  doneBtn: { backgroundColor: C.teal, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  doneBtnT: { fontSize: 12.5, fontWeight: '800', color: '#fff' },
  editHint: { fontSize: 11, color: C.sub, marginBottom: 10, textAlign: 'center' },
  lifted: {
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 10 },
    elevation: 12, borderRadius: 20, backgroundColor: C.bg,
  },
  ghostCard: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed',
    borderRadius: 20, padding: 18, marginBottom: 12, alignItems: 'center',
  },
  ghostT: { fontSize: 12.5, color: C.sub, fontWeight: '600' },
  moveCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10,
  },
  moveLabel: { fontSize: 14, fontWeight: '700', color: C.ink },
  moveBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  moveBtnT: { fontSize: 16, fontWeight: '800', color: C.teal },
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
