// 身体の変化タブ（Phase 2）: KPIサマリー＋推移グラフ（系列・期間切替）。
// Web版ダッシュボードの中核の移植（カレンダー・傾向カード等はPhase 3）
import { useCallback, useEffect, useRef, useState, type ReactNode, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import InteractiveChart, { type ChartPoint } from '@/components/InteractiveChart';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReorderableCards from '@/components/ReorderableCards';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AddCardSheet } from '@/components/CardLayout';
import { Plus } from 'lucide-react-native';
import { useGuide, useGuideTarget } from '@/components/GuideTour';
import { useRouter, useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { CalendarDays, FlaskConical, Footprints, PersonStanding, Dumbbell } from 'lucide-react-native';
import HeaderGear from '@/components/HeaderGear';
import GoalSummaryCard from '@/components/GoalSummaryCard';
import BodyPhotosCard from '@/components/BodyPhotosCard';
import BingeTriggerCard from '@/components/BingeTriggerCard';
import { BodyTable, LiftTable, TableEntryCard } from '@/components/DataTableCard';
import { Table2 } from 'lucide-react-native';
import { SegmentedControl } from '@/components/ui/Selectable';

// 並び替えはReorderableCards（gesture-handler+reanimated 4の自前実装・インプレイスの
// 長押しドラッグ。外部D&Dライブラリは白画面事故があったため使わない）
import MonthCalendar, { type DayMark } from '@/components/MonthCalendar';
import StatusBarMask from '@/components/StatusBarMask';
import QuickLogFab from '@/components/QuickLogFab';
import GoalPanel from '@/components/GoalPanel';
import { LiftKpiCard, LiftCalendarCard, LiftChartCard, BalanceCard, PartVolumeCard } from '@/components/LiftingProgress';
import ErrorBoundary from '@/components/ErrorBoundary';
import { healthAvailable, requestHealthAuth, readActivitySummary, type HealthDaySummary } from '@/lib/health';
import { mifflinBMR, targetKcal, todayJST, judge, type ExLevel } from '@/lib/calc';
import { type Goal } from '@/lib/goal';
import { buildItemDays, foodWeightEffects, type FoodEffect } from '@/lib/insights';
import { logIcon, logTitle } from '@/lib/feed';

type Row = { date: string; intake: number | null; weight: number | null; waist: number | null; bodyfat: number | null; target: number; diff: number | null };
import { type FoodItem } from '@/lib/items';
import { t } from '@/lib/i18n';
type DayDetail = { id: string; at: string | null; text: string; kcal: number | null; items: FoodItem[] | null; weight: number | null; ex: string | null; mood: string | null }[];
type Profile = { sex: 'male' | 'female'; height_cm: number; age: number; init_weight: number | null; life_factor: number };

const series = () => [
  { key: 'weight', label: t('体重'), unit: 'kg', decimals: 1 },
  { key: 'waist', label: t('ウエスト'), unit: 'cm', decimals: 1 },
  { key: 'bodyfat', label: t('体脂肪率'), unit: '%', decimals: 1 },
  { key: 'intake', label: t('摂取kcal'), unit: '', decimals: 0 },
  { key: 'burn', label: t('消費kcal'), unit: '', decimals: 0 },
] as const;
const ranges = () => [{ label: t('30日'), d: 30 }, { label: t('90日'), d: 90 }, { label: t('全'), d: 9999 }] as const;

// ===== レイアウト並び替え（iOS風Jiggle Mode） =====
const BODY_ORDER_DEFAULT = ['kpi', 'calendar', 'chart', 'table', 'photos', 'binge', 'goal', 'trends', 'health'];
const TRAIN_ORDER_DEFAULT = ['tkpi', 'tcal', 'tbal', 'tpart', 'tchart', 'ttable', 'tgoal'];
const CARD_LABELS = (): Record<string, string> => ({
  kpi: t('サマリー'), calendar: t('カレンダー'), chart: t('推移グラフ'), photos: t('体の写真'), binge: t('過食の引き金'), goal: t('目標'),
  table: t('数字で見る'), trends: t('食材の傾向'), health: t('歩数・睡眠'), ttable: t('挙上重量の表'),
  tkpi: t('週間サマリー'), tcal: t('運動カレンダー'), tbal: t('週別バランス'), tpart: t('部位別ボリューム'), tchart: t('筋トレの成長'), tgoal: t('運動目標'),
});
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
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [serie, setSerie] = useState<ReturnType<typeof series>[number]['key']>('weight');
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
  const [hiddenBody, setHiddenBody] = useState<string[]>([]);
  const [hiddenTrain, setHiddenTrain] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [bodyTableOpen, setBodyTableOpen] = useState(false);
  const [liftTableOpen, setLiftTableOpen] = useState(false);
  const [tableMetric, setTableMetric] = useState<'weight' | 'waist' | 'bodyfat'>('weight');

  // グラフやKPIから「数字の一覧」へ飛ぶ
  function openBodyTable(metric: 'weight' | 'waist' | 'bodyfat' = 'weight') {
    setTableMetric(metric);
    setBodyTableOpen(true);
  }

  // 並び順の復元
  useEffect(() => {
    (async () => {
      try {
        const b = JSON.parse((await AsyncStorage.getItem('bl-order-body')) || 'null');
        if (Array.isArray(b)) setOrderBody(mergeOrder(b, BODY_ORDER_DEFAULT));
        const t = JSON.parse((await AsyncStorage.getItem('bl-order-train')) || 'null');
        if (Array.isArray(t)) setOrderTrain(mergeOrder(t, TRAIN_ORDER_DEFAULT));
        const hb = JSON.parse((await AsyncStorage.getItem('bl-hidden-body')) || 'null');
        if (Array.isArray(hb)) setHiddenBody(hb.filter((k: string) => BODY_ORDER_DEFAULT.includes(k)));
        const ht = JSON.parse((await AsyncStorage.getItem('bl-hidden-train')) || 'null');
        if (Array.isArray(ht)) setHiddenTrain(ht.filter((k: string) => TRAIN_ORDER_DEFAULT.includes(k)));
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
      if (!(await requestHealthAuth())) { setHealthMsg(t('ヘルスケアへのアクセスが許可されませんでした。')); return; }
      const res = await readActivitySummary(7);
      if ('error' in res) { setHealthMsg(res.error); return; }
      setActivity(res);
      if (res.length === 0) setHealthMsg(t('直近7日のデータが見つかりませんでした。'));
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
  const conf = series().find((x) => x.key === serie)!;

  // カレンダーのマーク（記録あり=緑 / 目標超過=赤 / 未記録=?）— Web版と同じ判定
  //
  // 未記録日の穴埋めは、以前は「最古の記録日から昨日まで」を描画のたびに1日ずつ回していた。
  // 取込データで数年ぶんあると1描画で数千回まわり、グラフをピンチしている間は
  // フレームごとに再計算されて操作が固まる。useMemoに入れ、表示に必要な範囲だけ埋める。
  const marks = useMemo(() => {
    const m = new Map<string, DayMark>(rows.map((r) => [
      r.date,
      { logged: r.intake != null, over: r.diff != null && judge(r.diff) === 'NG', unknown: r.intake == null },
    ]));
    if (rows.length > 0) {
      const yest = addDays(today, -1);
      // カレンダーは1か月ずつ見るものなので、穴埋めは直近14か月ぶんで足りる
      const from = addDays(today, -430);
      const start = rows[0].date > from ? rows[0].date : from;
      for (let d = start; d <= yest; d = addDays(d, 1)) {
        if (!m.has(d)) m.set(d, { logged: false, over: false, unknown: true });
      }
    }
    return m;
  }, [rows, today]);

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
          <Text style={s.kpiL}>{t('体重')}</Text>
          <Text style={s.kpiV}>{latestW != null ? latestW.toFixed(1) : '—'}<Text style={s.kpiU}>kg</Text></Text>
          {latestW != null && firstW != null && (
            <Text style={[s.kpiD, { color: latestW - firstW <= 0 ? C.teal : C.coral }]}>
              {t('30日で')}{latestW - firstW <= 0 ? '▼' : '▲'}{Math.abs(latestW - firstW).toFixed(1)}kg
            </Text>
          )}
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>{t('累計収支')}</Text>
          <Text style={[s.kpiV, { color: sumAll <= 0 ? C.teal : C.coral }]}>{sumAll > 0 ? '+' : ''}{(sumAll / 1000).toFixed(1)}<Text style={s.kpiU}>k</Text></Text>
          <Text style={s.kpiD}>{t('脂肪 約')}{(sumAll / 7200).toFixed(1)}kg</Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>{t('未記録（30日）')}</Text>
          <Text style={s.kpiV}>{unrecorded}<Text style={s.kpiU}>{t('{n}日', { n: '' })}</Text></Text>
          <Text style={s.kpiD}>{t('±0扱い')}</Text>
        </View>
      </View>
  );

  const calendarCard = (
      <View style={s.card}>
        <View style={s.h2Row}><CalendarDays size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('カレンダー')}</Text></View>
        <MonthCalendar today={today} marks={marks} selected={daySel} onSelect={openDay} />
        {daySel && (
          <View style={s.dayBox}>
            <Text style={s.dayHead}>{daySel.replace(/-/g, '/')} {t('の記録')}</Text>
            {dayDetail === null && <Text style={s.note}>{t('読み込み中…')}</Text>}
            {dayDetail !== null && dayDetail.length === 0 && <Text style={s.note}>{t('この日の記録はありません。')}</Text>}
            {dayDetail?.map((l) => (
              <View key={l.id} style={s.dayRow}>
                <Text style={{ fontSize: 15 }}>{logIcon(l)}</Text>
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
        {/* 系列チップと「表で見る」は同じ行に並べる。絶対配置にするとチップが折り返したときや
            並び替え中の⊖ボタンと重なるため、レイアウトに乗せて重なりが起きない形にしている */}
        <View style={s.chipsHead}>
          <View style={[s.chips, s.chipsFlex]}>
            {series().map((x) => (
              <Pressable key={x.key} style={[s.chip, serie === x.key && s.chipOn]} onPress={() => setSerie(x.key)}>
                <Text style={[s.chipT, serie === x.key && { color: '#fff' }]}>{x.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={s.toTable}
                     onPress={() => openBodyTable(serie === 'waist' ? 'waist' : serie === 'bodyfat' ? 'bodyfat' : 'weight')}
                     hitSlop={8}>
            <Table2 size={13} color={C.teal} />
            <Text style={s.toTableT}>{t('表で見る')}</Text>
          </Pressable>
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
            const noneActive = liveDays != null && !ranges().some((r) => isActive(r.d));
            return (
              <>
                {ranges().map((r) => (
                  <Pressable key={r.label} style={[s.chip, isActive(r.d) && s.chipOn]}
                             onPress={() => { setRange(r.d); setLiveDays(null); setChartNonce((n) => n + 1); }}>
                    <Text style={[s.chipT, isActive(r.d) && { color: '#fff' }]}>{r.label}</Text>
                  </Pressable>
                ))}
                {noneActive && (
                  <View style={[s.chip, s.chipOn, { borderStyle: 'dashed' }]}>
                    <Text style={[s.chipT, { color: '#fff' }]}>{t('{n}日', { n: liveDays })}</Text>
                  </View>
                )}
              </>
            );
          })()}
        </View>
        {serie === 'weight' && goal?.target_weight != null && (
          <Text style={s.note}>{t('点線＝目標')} {Number(goal.target_weight).toFixed(1)}kg</Text>
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
            <View style={s.h2Row}><FlaskConical size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('食材とあなたの体の傾向')}</Text></View>
            <Text style={s.note}>{t('よく食べる食材ごとに「食べた翌日」と「食べなかった翌日」の体重変化を比べました。')}</Text>
            {down.length > 0 && <Text style={[s.fxHead, { color: C.teal }]}>{t('▼ 食べた翌日、下がりやすい')}</Text>}
            {down.map((f) => (
              <View key={f.name} style={s.fxRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fxName}>{f.name}</Text>
                  <Text style={s.note}>{t('食べた日{n}日の平均', { n: f.withN })} {g(f.withAvg)} ／ {t('食べない日')} {g(f.withoutAvg)}</Text>
                </View>
                <Text style={[s.fxVal, { color: C.teal }]}>{g(f.effect)}</Text>
              </View>
            ))}
            {up.length > 0 && <Text style={[s.fxHead, { color: C.coral }]}>{t('▲ 食べた翌日、上がりやすい')}</Text>}
            {up.map((f) => (
              <View key={f.name} style={s.fxRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fxName}>{f.name}</Text>
                  <Text style={s.note}>{t('食べた日{n}日の平均', { n: f.withN })} {g(f.withAvg)} ／ {t('食べない日')} {g(f.withoutAvg)}</Text>
                </View>
                <Text style={[s.fxVal, { color: C.coral }]}>{g(f.effect)}</Text>
              </View>
            ))}
            <Text style={s.note}>{t('※相関であり因果ではありません（水分・塩分・食べ合わせの影響を含みます）。データが増えるほど精度が上がります。')}</Text>
          </View>
        );
      })() : null;

  const healthCard = healthAvailable() ? (
        <View style={s.card}>
          <View style={s.h2Row}><Footprints size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('歩数・睡眠（直近7日）')}</Text></View>
          {activity === null ? (
            <Pressable style={s.actBtn} onPress={loadActivity} disabled={healthBusy}>
              <Text style={s.actBtnT}>{healthBusy ? '読み込み中…' : t('ヘルスケアから読み込む')}</Text>
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

  // カード1枚の例外で概要タブ全体が落ちないよう、1枚ずつ境界で包む。
  // どのカードで起きたかを名前で出せるので、原因の切り分けにもなる
  function card(key: string): ReactNode {
    return (
      <ErrorBoundary compact name={CARD_LABELS()[key] ?? key}>
        {cardBody(key)}
      </ErrorBoundary>
    );
  }

  function cardBody(key: string): ReactNode {
    switch (key) {
      case 'kpi': return kpiCard;
      case 'calendar': return calendarCard;
      case 'chart': return chartCard;
      case 'photos': return <BodyPhotosCard />;
      case 'binge': return <BingeTriggerCard />;
      case 'table': return <TableEntryCard onOpenBody={() => openBodyTable('weight')} onOpenLift={() => setLiftTableOpen(true)} />;
      case 'ttable': return <TableEntryCard onOpenBody={() => openBodyTable('weight')} onOpenLift={() => setLiftTableOpen(true)} />;
      case 'goal': return <GoalSummaryCard mode="weight" />;
      case 'trends': return trendsCard;
      case 'health': return healthCard;
      case 'tkpi': return <LiftKpiCard />;
      case 'tcal': return <LiftCalendarCard />;
      case 'tbal': return <BalanceCard />;
      case 'tpart': return <PartVolumeCard />;
      case 'tchart': return <LiftChartCard />;
      case 'tgoal': return <GoalSummaryCard mode="training" />;
      default: return null;
    }
  }

  const order = topSeg === 'body' ? orderBody : orderTrain;
  const setOrderRaw = topSeg === 'body' ? setOrderBody : setOrderTrain;
  const hidden = topSeg === 'body' ? hiddenBody : hiddenTrain;
  const setHidden = topSeg === 'body' ? setHiddenBody : setHiddenTrain;
  const hiddenKey = topSeg === 'body' ? 'bl-hidden-body' : 'bl-hidden-train';
  const visibleOrder = order.filter((k) => !hidden.includes(k));

  // 表示中カードの並べ替え結果を、非表示カードの位置を保ったまま全体の順序へ戻す
  const setOrder = (nextVisible: string[]) => {
    let i = 0;
    setOrderRaw(order.map((k) => (hidden.includes(k) ? k : nextVisible[i++])));
  };

  function hideCard(key: string) {
    const next = [...hidden, key];
    setHidden(next);
    AsyncStorage.setItem(hiddenKey, JSON.stringify(next)).catch(() => {});
  }
  function showCard(key: string) {
    const next = hidden.filter((k) => k !== key);
    setHidden(next);
    AsyncStorage.setItem(hiddenKey, JSON.stringify(next)).catch(() => {});
  }

  // 最初の並びに戻す
  async function resetOrder() {
    setOrderBody(BODY_ORDER_DEFAULT);
    setOrderTrain(TRAIN_ORDER_DEFAULT);
    setHiddenBody([]);
    setHiddenTrain([]);
    try {
      await AsyncStorage.removeItem('bl-order-body');
      await AsyncStorage.removeItem('bl-order-train');
      await AsyncStorage.removeItem('bl-hidden-body');
      await AsyncStorage.removeItem('bl-hidden-train');
    } catch { /* 無視 */ }
  }

  const headerJSX = (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        {/* ⚙は固定配置のHeaderGear（右余白38で衝突回避） */}
        <Text style={s.pageTitle}>{t('概要')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginRight: 38 }}>
          {editing ? (
            <>
              <Pressable onPress={() => setAddOpen(true)} style={s.addBtn} hitSlop={8}>
                <Plus size={16} color="#fff" strokeWidth={3} />
              </Pressable>
              <Pressable onPress={resetOrder} style={s.editBtn} hitSlop={8}><Text style={s.editBtnT}>{t('元に戻す')}</Text></Pressable>
              <Pressable onPress={finishEditing} style={s.doneBtn} hitSlop={8}><Text style={s.doneBtnT}>{t('完了')}</Text></Pressable>
            </>
          ) : (
            <Pressable onPress={() => setEditing(true)} hitSlop={8} style={s.editBtn}><Text style={s.editBtnT}>{t('≡ 並べ替え')}</Text></Pressable>
          )}
        </View>
      </View>
      <View style={{ marginBottom: 4 }}>
        <SegmentedControl
          options={[
            { key: 'body', label: t('身体の変化'), icon: <PersonStanding size={14} color={C.sub} /> },
            { key: 'training', label: '運動の記録', icon: <Dumbbell size={14} color={C.sub} /> },
          ]}
          value={topSeg} onChange={setTopSeg}
        />
      </View>
      {editing && <Text style={s.editHint}>{t('カードを長押し→そのままドラッグで移動。「完了」で保存します')}</Text>}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* インプレイスのドラッグ並び替え（通常時は普通のスクロール・カード長押しで編集モードへ） */}
      {/* セグメント切替はクロスフェード。ヘッダーは両側で同一なので静止して見え、
          中身だけが入れ替わる。key再マウントは意図的（編集状態や開閉を持ち越さない） */}
      <Animated.View key={topSeg} style={{ flex: 1 }}
                     entering={FadeIn.duration(180)}>
      <ReorderableCards
        editing={editing}
        order={visibleOrder}
        onOrderChange={setOrder}
        renderCard={card}
        onHide={hideCard}
        ghostLabel={(k) => CARD_LABELS()[k] ?? k}
        header={headerJSX}
        onEnterEdit={() => setEditing(true)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8 }]}
        onScroller={(fn) => guide.registerScroller('/changes', fn)}
      />
      </Animated.View>
      {!editing && <QuickLogFab />}
      <AddCardSheet
        visible={addOpen} onClose={() => setAddOpen(false)}
        hidden={hidden} shownKeys={visibleOrder} labels={CARD_LABELS()} onShow={showCard}
      />
      <BodyTable visible={bodyTableOpen} onClose={() => setBodyTableOpen(false)} initialMetric={tableMetric} />
      <LiftTable visible={liftTableOpen} onClose={() => setLiftTableOpen(false)} />
      <StatusBarMask />
      <HeaderGear guideKey="gear" />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },
  h: { fontSize: 21, fontWeight: '800', color: C.ink, marginBottom: 12 },
  pageTitle: { fontSize: 26, fontWeight: '600', color: C.ink },
  topSegWrap: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  topSeg: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  gearBtn: { width: 30, height: 30, borderRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' },
  topSegOn: { backgroundColor: C.teal, borderColor: C.teal },
  topSegT: { fontSize: 15, fontWeight: '800', color: C.sub },
  // 系列チップと同じ行に置く（チップが折り返しても重ならない）
  chipsHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  chipsFlex: { flex: 1, marginRight: 0 },
  toTable: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12,
    backgroundColor: C.accentBadge, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
  },
  toTableT: { fontSize: 11, fontWeight: '800', color: C.teal },
  addBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: C.teal,
    alignItems: 'center', justifyContent: 'center',
  },
  editBtn: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.panel },
  editBtnT: { fontSize: 13, fontWeight: '800', color: C.sub },
  doneBtn: { backgroundColor: C.teal, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  doneBtnT: { fontSize: 13, fontWeight: '800', color: '#fff' },
  editHint: { fontSize: 13, color: C.sub, marginBottom: 10, textAlign: 'center' },
  lifted: {
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 10 },
    elevation: 12, borderRadius: 20, backgroundColor: C.bg,
  },
  ghostCard: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed',
    borderRadius: 20, padding: 18, marginBottom: 12, alignItems: 'center',
  },
  ghostT: { fontSize: 13, color: C.sub, fontWeight: '600' },
  moveCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10,
  },
  moveLabel: { fontSize: 15, fontWeight: '700', color: C.ink },
  moveBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  moveBtnT: { fontSize: 17, fontWeight: '800', color: C.teal },
  actBtn: { backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 11, alignItems: 'center', marginTop: 4 },
  actBtnT: { fontSize: 13, fontWeight: '800', color: C.ink },
  actRow: { flexDirection: 'row', gap: 12, paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: C.line, alignItems: 'center' },
  actDate: { fontSize: 13, color: C.faint, fontWeight: '700', width: 40, fontVariant: ['tabular-nums'] },
  actVal: { fontSize: 13, color: C.ink, fontVariant: ['tabular-nums'] },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  kpi: { flex: 1, backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(14,17,22,0.08)', borderRadius: 16, shadowColor: '#0e1116', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 12 },
  kpiL: { fontSize: 11, fontWeight: '700', color: C.sub },
  kpiV: { fontSize: 21, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  kpiU: { fontSize: 13, color: C.sub, fontWeight: '600' },
  kpiD: { fontSize: 11, color: C.sub, marginTop: 2 },
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(14,17,22,0.08)', borderRadius: 20, shadowColor: '#0e1116', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 14, marginBottom: 12 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink, marginBottom: 8 },
  dayBox: { borderTopWidth: 0.5, borderTopColor: C.line, marginTop: 8, paddingTop: 8 },
  dayHead: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 4, fontVariant: ['tabular-nums'] },
  dayRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: C.line },
  dayText: { flex: 1, fontSize: 15, color: C.ink, lineHeight: 21 },
  kcalBadge: { backgroundColor: '#eef4f0', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  kcalBadgeT: { fontSize: 13, fontWeight: '800', color: C.teal, fontVariant: ['tabular-nums'] },
  fxHead: { fontSize: 13, fontWeight: '800', marginTop: 8, marginBottom: 2 },
  fxRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: C.line },
  fxName: { fontSize: 15, fontWeight: '700', color: C.ink },
  fxVal: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontSize: 13, fontWeight: '700', color: C.sub },
  note: { fontSize: 13, color: C.faint, lineHeight: 18 },
});
