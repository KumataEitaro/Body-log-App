// 身体の変化タブ（Phase 2）: KPIサマリー＋推移グラフ（系列・期間切替）。
// Web版ダッシュボードの中核の移植（カレンダー・傾向カード等はPhase 3）
import { useCallback, useEffect, useRef, useState, type ReactNode, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl, useWindowDimensions } from 'react-native';
import { supabase } from '@/lib/supabase';
import { C, rgba, RADIUS, SPACE, ICON, HEAD, themed } from '@/lib/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import InteractiveChart, { type ChartPoint } from '@/components/InteractiveChart';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReorderableCards from '@/components/ReorderableCards';
import Animated, {
  FadeInDown, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Skeleton from '@/components/Skeleton';
import { useUndoSnackbar } from '@/components/UndoSnackbar';
import { AddCardSheet } from '@/components/CardLayout';
import { Plus, Moon, Camera, Salad, Trophy, ChevronLeft, Flame } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Polyline, Line, Rect } from 'react-native-svg';
import { useGuide, useGuideTarget } from '@/components/GuideTour';
import { useRouter, useFocusEffect, useNavigation } from 'expo-router';
import { BackHandler } from 'react-native';
import { AppState } from 'react-native';
import { CalendarDays, FlaskConical, Footprints, PersonStanding, Dumbbell, Gauge } from 'lucide-react-native';
import LeanBulkCard from '@/components/LeanBulkCard';
import CycleCard from '@/components/CycleCard';
import { usePurpose, fetchPurposePeriods, cycleLabel, type PurposePeriod } from '@/lib/purpose';
import { Repeat } from 'lucide-react-native';
import { useGate } from '@/lib/gate';
import CrownBadge from '@/components/CrownBadge';
import HeaderGear from '@/components/HeaderGear';
import GoalSummaryCard from '@/components/GoalSummaryCard';
import BodyPhotosCard from '@/components/BodyPhotosCard';
import BingeTriggerCard from '@/components/BingeTriggerCard';
import WeekdayHeatmapCard from '@/components/WeekdayHeatmapCard';
import { BodyTable, LiftTable, TableEntryCard } from '@/components/DataTableCard';
import { toItemEntries, slotOf } from '@/lib/itemLog';
import { Table2, Share2 } from 'lucide-react-native';
import ShareStickerModal, { type StickerData } from '@/components/ShareSticker';

// 並び替えはReorderableCards（gesture-handler+reanimated 4の自前実装・インプレイスの
// 長押しドラッグ。外部D&Dライブラリは白画面事故があったため使わない）
import MonthCalendar, { type DayMark } from '@/components/MonthCalendar';
import StatusBarMask from '@/components/StatusBarMask';
import GoalPanel from '@/components/GoalPanel';
import { LiftKpiCard, LiftCalendarCard, LiftChartCard, BalanceCard, PartVolumeCard, PersonalBestCard } from '@/components/LiftingProgress';
import LiftHistoryCard from '@/components/LiftHistoryCard';
import ErrorBoundary from '@/components/ErrorBoundary';
import { healthAvailable, requestHealthAuth, readActivitySummary, readSleepStages, type HealthDaySummary, type SleepStages } from '@/lib/health';
import WeekStepsBar, { useWeekStepsGoal } from '@/components/WeekStepsBar';
import { mifflinBMR, targetKcal, todayJST, judge, type ExLevel } from '@/lib/calc';
import { type Goal } from '@/lib/goal';
import { buildItemDays, foodWeightEffects, type FoodEffect } from '@/lib/insights';
import { latestLawSummary } from '@/lib/laws';
import { BookOpen } from 'lucide-react-native';
import { logIcon, logTitle, moodLevelOf } from '@/lib/feed';
import { bigKcalParts } from '@/lib/format';
import { trendPhrase, trendBands } from '@/lib/trend';
import { MoodInline } from '@/components/MoodFace';
import HighlightCard from '@/components/HighlightCard';
import { type HighlightTarget } from '@/lib/highlight';
import VitalsCard from '@/components/VitalsCard';
import { listVitals, vitalsSummary, type Vital } from '@/lib/vitals';
import { HeartPulse, Droplet } from 'lucide-react-native';
import MenstrualCycleCard from '@/components/MenstrualCycleCard';
import {
  useCycleEnabled, listCycleStarts, cycleSummary, cycleDay,
  isWaterRetentionWindow, menstrualBands, PERIOD_BAND_DAYS,
} from '@/lib/cycle';

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
// bulkguardは増量目的（purpose==='bulk'）のときだけメニューに現れる（下のvisibleOrderで絞る）
// lawsは詳細ページではなく /laws（法則図鑑）への外部遷移行（menuRowで分岐する）
// cyclesは目的の切替履歴（purpose_periods）が2サイクル以上あるときだけ現れる（下のunavailableで絞る）
//
// 統合カード（項目が多すぎ・概念かぶりのβ指摘対応）: 旧23行を10行前後に統合し、
// 詳細ページで統合元カードを縦に積む（各カード自体は無改造）
// cycle（生理周期モード）は設定「生理周期を記録する」をONにした人にだけ現れる（既定OFF）。
// 既存のcycles（増量/減量サイクル比較）とは別物なので、キー名を混同しないこと
const ALL_ORDER_DEFAULT = ['body', 'vitals', 'cycle', 'photos', 'laws', 'bulkguard', 'cycles', 'eating', 'week', 'volume', 'strength', 'health'];
// 統合行→詳細で縦に積む旧カードの並び
const DETAIL_STACKS: Record<string, string[]> = {
  body: ['goal', 'kpi', 'chart', 'table'],
  eating: ['slots', 'weekmap', 'trends', 'binge'],
  week: ['digest', 'calendar'],
  volume: ['tkpi', 'tcal', 'tbal', 'tpart', 'ttable'],
  // lifthist=筋トレ履歴（運動タブから移設。入力は運動タブ・振り返りは概要タブの役割分離）
  strength: ['tchart', 'tpr', 'tgoal', 'lifthist'],
};
// メニューのセクション小見出し（Appleヘルスケアの「トレンド」「ハイライト」式）。
// キー→セクションの対応は固定。描画は常に「セクション順→セクション内は保存順」に正規化するため、
// ドラッグでセクションを跨いで落としても自セクション内の相対位置だけが反映される（クラッシュしない）
const SECTION_DEFS: { title: () => string; keys: string[] }[] = [
  { title: () => t('からだ'), keys: ['body', 'vitals', 'cycle', 'photos', 'laws', 'bulkguard', 'cycles'] },
  { title: () => t('食事'), keys: ['eating', 'week'] },
  { title: () => t('運動'), keys: ['volume', 'strength', 'health'] },
];
// セクション順→セクション内は引数の相対順。未知キーは末尾へ（防御・落とさない）
function normalizeOrder(order: string[]): string[] {
  const out: string[] = [];
  for (const sec of SECTION_DEFS) out.push(...order.filter((k) => sec.keys.includes(k)));
  out.push(...order.filter((k) => !out.includes(k)));
  return out;
}
const CARD_LABELS = (): Record<string, string> => ({
  // 統合行（メニュー・詳細タイトル・⊕シートで使う）
  body: t('体の記録'), eating: t('食べ方の分析'), week: t('週のふりかえり'), volume: t('運動の量'), strength: t('筋トレの成長'),
  laws: t('あなたの法則'), bulkguard: t('リーンバルク・ガード'), cycles: t('サイクル比較'), photos: t('体の写真'), health: t('歩数・睡眠'),
  vitals: t('バイタル'), cycle: t('生理周期'),
  // 統合詳細の中の旧カード名（エラー境界の表示名として残す）
  digest: t('週間ダイジェスト'), slots: t('食べる時間帯'), kpi: t('サマリー'), calendar: t('カレンダー'), chart: t('推移グラフ'), binge: t('過食の引き金'), weekmap: t('曜日のリズム'), goal: t('目標'),
  table: t('数字で見る'), trends: t('食材の傾向'), ttable: t('挙上重量の表'),
  tkpi: t('週間サマリー'), tcal: t('運動カレンダー'), tbal: t('週別バランス'), tpart: t('部位別ボリューム'), tchart: t('挙上重量の推移'), tgoal: t('運動目標'), tpr: t('自己ベスト'), lifthist: t('筋トレ履歴'),
});
// 保存済み順序を現行カード構成とマージ（将来カードが増えても壊れない）
function mergeOrder(saved: string[], def: string[]): string[] {
  const kept = saved.filter((k) => def.includes(k));
  return [...kept, ...def.filter((k) => !kept.includes(k))];
}


// メニュー行に添えるミニスパークライン（体重の直近30日）
function MiniSpark({ vals, color }: { vals: number[]; color: string }) {
  if (vals.length < 2) return null;
  const w = 54; const h = 22;
  const min = Math.min(...vals); const max = Math.max(...vals);
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = max === min ? h / 2 : h - (((v - min) / (max - min)) * (h - 4) + 2);
    return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
  }).join(' ');
  return (
    <Svg width={w} height={h}>
      <Polyline points={pts} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// トレンドの2期間平均線（B-17・ヘルスケアの「12週間平均 vs 直近の平均」風）。
// 前8週の平均を左にグレー、直近4週の平均を右にアクセントの水平線で描き、差分を一言添える。
// 体重4週分未満（trendBandsがnull）なら呼び出し側で出さない
function TrendBands({ older, recent, width }: { older: number; recent: number; width: number }) {
  const h = 44;                        // 帯グラフ本体。ラベル行と合わせて全体で60px程度
  const diff = Math.round((recent - older) * 10) / 10;
  // 2値を[12, h-12]に割り付ける（差がごく小さい時は中央に寄せて重なりを許す）
  const top = Math.max(older, recent);
  const span = Math.abs(older - recent);
  const y = (v: number) => (span < 1e-9 ? h / 2 : 12 + ((top - v) / span) * (h - 24));
  return (
    <View style={s.bandBox}>
      <View style={s.bandHead}>
        <Text style={s.bandTitle}>{t('2期間の平均')}</Text>
        <Text style={s.bandDiff}>{t('平均 {d}kg', { d: `${diff > 0 ? '+' : ''}${diff.toFixed(1)}` })}</Text>
      </View>
      <Svg width={width} height={h}>
        {/* 古い方（前8週）はグレー・新しい方（直近4週）はアクセント */}
        <Line x1={4} y1={y(older)} x2={width * 0.46} y2={y(older)} stroke={C.faint} strokeWidth={3} strokeLinecap="round" />
        <Line x1={width * 0.54} y1={y(recent)} x2={width - 4} y2={y(recent)} stroke={C.teal} strokeWidth={3} strokeLinecap="round" />
      </Svg>
      <View style={s.bandLegend}>
        <View style={s.bandLegendItem}>
          <View style={[s.bandDot, { backgroundColor: C.faint }]} />
          <Text style={s.bandLegendT}>{t('前8週')} {older.toFixed(1)}kg</Text>
        </View>
        <View style={s.bandLegendItem}>
          <View style={[s.bandDot, { backgroundColor: C.teal }]} />
          <Text style={s.bandLegendT}>{t('直近4週')} {recent.toFixed(1)}kg</Text>
        </View>
      </View>
    </View>
  );
}

function weekStartOf2(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function addDays(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function ChangesScreen() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[]>([]);
  // 食べる時間帯カード用（id/at/items付きの生ログ）
  const [logRows, setLogRows] = useState<{ id: string; date: string; at?: string | null; items?: FoodItem[] | null }[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [serie, setSerie] = useState<ReturnType<typeof series>[number]['key']>('weight');
  const [range, setRange] = useState(30);
  const [liveDays, setLiveDays] = useState<number | null>(null); // ピンチ/パン後の実表示日数
  const [liveFull, setLiveFull] = useState(false);
  const [chartNonce, setChartNonce] = useState(0); // 同じプリセット再タップでも窓をリセットするため
  const [refreshing, setRefreshing] = useState(false);
  const [foodFx, setFoodFx] = useState<FoodEffect[]>([]);
  // 法則図鑑のサマリー行（最新の法則の一文。端末内のAsyncStorageから読むだけで軽い）
  const [lawLine, setLawLine] = useState<string | null>(null);
  // サイクル履歴（B-5）。null=テーブル未作成等で取得不能（サイクル機能を静かに非表示）
  const [periods, setPeriods] = useState<PurposePeriod[] | null>(null);
  // バイタル（血圧・脈拍・血糖）のメニュー要約用。migration-25未適用なら空配列＝誘い文
  const [vitals, setVitals] = useState<Vital[]>([]);
  // 生理周期モード（既定OFF）。ONの人だけカード・グラフの帯・水分の説明が現れる。
  // OFFの間はcycle_logsへの読み書きが一度も起きない（最も機微なデータなので触れない）
  const cycleOn = useCycleEnabled();
  const [cycleStarts, setCycleStarts] = useState<string[]>([]);
  const [daySel, setDaySel] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null);
  const router = useRouter();
  const guide = useGuide();
  // 王冠ゲーティング（MFP式）。課金基盤が無効なビルドでは active=false で何も変わらない
  const gate = useGate();
  // リーンバルク・ガードは増量目的のときだけ意味を持つ（減量中は判定が全部ノイズになる）
  const purpose = usePurpose();
  const chartTarget = useGuideTarget('chart');
  // 開いている詳細ページ（nullならマスタメニュー）。ヘルスケア式のメニュー→詳細
  const [detailKey, setDetailKey] = useState<string | null>(null);
  // 初回ロードが終わったか（スケルトン解除の判定。ロード自体は既存のload()）
  const [menuLoaded, setMenuLoaded] = useState(false);
  // 削除のUndoスナックバー（筋トレ履歴カードに貸す。カード内の絶対配置では
  // 画面下部に固定できないため、画面側で1つだけ持つ）
  const undoBar = useUndoSnackbar(insets.bottom + 16);

  // ===== エッジスワイプで戻る（iOS標準の戻りジェスチャ・Material 3のpredictive backと同方向） =====
  // 画面左端(32px)から始まった右スワイプだけを拾い、指に追従して詳細ページをスライドさせる。
  // 左端開始の条件を厳守することで、詳細内の横スクロール要素（チップ等）と取り合わない
  const winW = useWindowDimensions().width;
  const detailTx = useSharedValue(0);
  const closeDetailByGesture = useCallback(() => { setDetailKey(null); }, []);
  const backPan = useMemo(() => Gesture.Pan()
    .hitSlop({ left: 0, width: 32 })   // 左端32pxで始まったタッチだけを対象にする
    .activeOffsetX(12)                 // 右へ12px動いてはじめて発火（タップと区別）
    .failOffsetY([-16, 16])            // 先に縦へ動いたら縦スクロールに譲る
    .onUpdate((e) => {
      'worklet';
      detailTx.value = Math.max(0, e.translationX);   // 左へは押し戻さない（追従は右方向だけ）
    })
    .onEnd((e) => {
      'worklet';
      // 離した位置が幅の1/3超 or 十分な速度なら閉じる。未満ならスプリングで元の位置へ
      if (e.translationX > winW / 3 || e.velocityX > 800) {
        detailTx.value = withTiming(winW, { duration: 150 }, () => { runOnJS(closeDetailByGesture)(); });
      } else {
        detailTx.value = withSpring(0, { damping: 20, stiffness: 220 });
      }
    }), [winW, detailTx, closeDetailByGesture]);
  const detailSlide = useAnimatedStyle(() => ({ transform: [{ translateX: detailTx.value }] }));

  // iOS HIG標準「タブの再選択でルートへ戻る」: 概要タブを表示中にもう一度「概要」を
  // タップしたら、詳細ページを閉じてメニューに戻す（迷子のリセットボタンになる）
  const navigation = useNavigation();
  useEffect(() => {
    const sub = (navigation as { addListener: (ev: string, cb: () => void) => () => void })
      .addListener('tabPress', () => {
        if (detailKey != null) setDetailKey(null);
      });
    return sub;
  }, [navigation, detailKey]);

  // Androidの戻るボタン/戻るジェスチャ: 詳細表示中はアプリ終了ではなくメニューへ戻る
  useEffect(() => {
    if (detailKey == null) return;
    const h = BackHandler.addEventListener('hardwareBackPress', () => { setDetailKey(null); return true; });
    return () => h.remove();
  }, [detailKey]);
  const [editing, setEditing] = useState(false);
  const [orderAll, setOrderAll] = useState<string[]>(ALL_ORDER_DEFAULT);
  const [hiddenAll, setHiddenAll] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [bodyTableOpen, setBodyTableOpen] = useState(false);
  const [liftTableOpen, setLiftTableOpen] = useState(false);
  const [tableMetric, setTableMetric] = useState<'weight' | 'waist' | 'bodyfat'>('weight');
  // 体重変化グラフの共有ステッカー（体の記録の詳細ページ右上の共有アイコンから）
  const [sticker, setSticker] = useState<StickerData | null>(null);

  // グラフやKPIから「数字の一覧」へ飛ぶ
  function openBodyTable(metric: 'weight' | 'waist' | 'bodyfat' = 'weight') {
    setTableMetric(metric);
    setBodyTableOpen(true);
  }

  // 並び順の復元。カード統合でキー体系が変わったため保存キーをv2に更新。
  // 旧キー（bl-order-all等）は読まない＝全員新既定から再スタート
  // （旧構成のキーが混ざる事故を避ける最も安全な方法。フィルタで消えるだけだが読む意味もない）
  useEffect(() => {
    (async () => {
      try {
        const all = JSON.parse((await AsyncStorage.getItem('bl-order-all2')) || 'null');
        if (Array.isArray(all)) setOrderAll(mergeOrder(all, ALL_ORDER_DEFAULT));
        const hAll = JSON.parse((await AsyncStorage.getItem('bl-hidden-all2')) || 'null');
        if (Array.isArray(hAll)) setHiddenAll(hAll.filter((k: string) => ALL_ORDER_DEFAULT.includes(k)));
      } catch { /* 初回など */ }
    })();
  }, []);

  // 離脱時確定用に最新値をrefへ同期（AppState/blurリスナーの古いクロージャ対策）
  const editStateRef = useRef({ editing: false, all: ALL_ORDER_DEFAULT });
  editStateRef.current = { editing, all: orderAll };

  const finishEditing = useCallback(async () => {
    setEditing(false);
    try {
      await AsyncStorage.setItem('bl-order-all2', JSON.stringify(editStateRef.current.all));
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
  // 昨夜の睡眠のステージ内訳（B-14a）。null=hk無し/ステージ計測なし＝合計だけの従来表示
  const [sleepStages, setSleepStages] = useState<SleepStages | null>(null);
  // 歩数の週目標（B-15・オフ=null）。health詳細にも「きょうの動き」と同じ週プログレスを出す
  const weekStepsGoal = useWeekStepsGoal();

  const load = useCallback(async () => {
    try {
      await loadBody();
    } finally {
      // スケルトン解除はロードの成否に関わらず必ず（未ログイン・失敗時は空状態の誘い文に落ちる）
      setMenuLoaded(true);
    }
  }, []);
  const loadBody = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const [profRes, entResRaw, goalRes, itemRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      supabase.from('entries').select('date,intake,weight,waist,bodyfat,ex,adj').order('date', { ascending: true }),
      supabase.from('goals').select('*').maybeSingle(),
      supabase.from('logs').select('id,date,at,items').order('date', { ascending: true }).limit(2000),
    ]);
    // bodyfat列が無い旧DB（v16未適用）でも画面が壊れないようフォールバック
    const entRes = entResRaw.error
      ? await supabase.from('entries').select('date,intake,weight,waist,ex,adj').order('date', { ascending: true })
      : entResRaw;
    setLogRows((itemRes.data as { id: string; date: string; at?: string | null; items?: FoodItem[] | null }[]) ?? []);
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
    // 法則図鑑のサマリー（未発見ならnullのまま＝誘い文に落ちる）
    try { setLawLine(await latestLawSummary()); } catch { /* サマリーは飾り */ }
    // サイクル履歴（B-5）。テーブル未作成ならnullが返り、cyclesはメニューに出ない
    setPeriods(await fetchPurposePeriods());
    // バイタルの要約（migration-25未適用・通信失敗は空配列＝誘い文のまま）
    try { setVitals(await listVitals(30)); } catch { /* 要約は飾り */ }
  };
  useEffect(() => { load(); }, [load]);

  // 月経開始日の読み込み。ONにした瞬間・設定から戻った瞬間に反映する。
  // OFFのときは問い合わせもせず、持っていた値も捨てる（画面に残骸を残さない）
  const loadCycle = useCallback(async () => {
    if (!cycleOn) { setCycleStarts([]); return; }
    try { setCycleStarts((await listCycleStarts()).map((c) => c.start_date)); }
    catch { setCycleStarts([]); /* migration-28未適用は空扱い＝静かに非表示 */ }
  }, [cycleOn]);
  useEffect(() => { loadCycle(); }, [loadCycle]);

  // 設定で生理周期をOFFにしたら、開きっぱなしの詳細ページも閉じる
  // （「消したはずの画面」が残っていると、見せない約束を破ったことになる）
  useEffect(() => {
    if (!cycleOn) setDetailKey((k) => (k === 'cycle' ? null : k));
  }, [cycleOn]);

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
      // 昨夜の睡眠（今朝起きたぶん）のステージ内訳。ステージが無い端末はnull＝従来表示のまま
      try { setSleepStages(await readSleepStages(todayJST())); } catch { /* ステージは飾り */ }
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
  // ===== 週間ダイジェスト: 今週(月〜) vs 先週を数字で。AIを呼ばずローカル集計 =====
  const digestCard = (() => {
    const ws = weekStartOf2(today);
    const lastWs = addDays(ws, -7);
    const pick = (from: string, to: string) => rows.filter((r) => r.date >= from && r.date < to);
    const thisW = pick(ws, addDays(today, 1));
    const lastW = pick(lastWs, ws);
    const avg2 = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x != null);
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    const wOf = (list: typeof rows) => {
      const w = list.filter((r) => r.weight != null);
      return w.length ? Number(w[w.length - 1].weight) : null;
    };
    const tIn = avg2(thisW.map((r) => r.intake));
    const lIn = avg2(lastW.map((r) => r.intake));
    const tDf = avg2(thisW.map((r) => r.diff));
    const rec = thisW.filter((r) => r.intake != null).length;
    const wNow = wOf(thisW) ?? wOf(rows);
    const wPrev = wOf(lastW);
    const dW = wNow != null && wPrev != null ? Math.round((wNow - wPrev) * 10) / 10 : null;
    const line = (label: string, v: string, sub?: string) => (
      <View key={label} style={s.dgRow}>
        <Text style={s.dgLabel}>{label}</Text>
        <Text style={s.dgVal}>{v}</Text>
        {sub ? <Text style={s.dgSub}>{sub}</Text> : null}
      </View>
    );
    return (
      <View style={s.card}>
        <View style={s.h2Row}><CalendarDays size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('週間ダイジェスト')}<Text style={s.h2sub}>{t('— 今週と先週')}</Text></Text></View>
        {line(t('記録した日'), t('{n}日', { n: rec }))}
        {tIn != null && line(t('平均摂取'), `${tIn.toLocaleString()}kcal`, lIn != null ? t('先週 {n}', { n: lIn.toLocaleString() }) : undefined)}
        {tDf != null && line(t('平均収支'), `${tDf > 0 ? '+' : ''}${tDf.toLocaleString()}kcal`)}
        {dW != null && line(t('体重の変化'), `${dW > 0 ? '+' : ''}${dW}kg`)}
        {rec === 0 && <Text style={s.note}>{t('今週の記録が貯まると、ここに先週との比較が出ます。')}</Text>}
      </View>
    );
  })();

  // ===== 食べる時間帯: 直近14日のkcalを朝/昼/夕/夜に配分 =====
  const slotsCard = (() => {
    const from14 = addDays(today, -14);
    const entriesItems = toItemEntries(
      (logRows as { id: string; date: string; at?: string | null; items?: FoodItem[] | null }[])
        .filter((r) => r.date >= from14),
    );
    const share: Record<string, number> = { morning: 0, noon: 0, evening: 0, night: 0 };
    for (const it of entriesItems) {
      if (it.hour == null) continue;
      share[slotOf(it.hour)] += it.kcal;
    }
    const total = share.morning + share.noon + share.evening + share.night;
    if (total <= 0) return (
      <View style={s.card}>
        <View style={s.h2Row}><FlaskConical size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('食べる時間帯')}</Text></View>
        <Text style={s.note}>{t('食事の記録が貯まると、どの時間帯に食べているかの内訳が出ます。')}</Text>
      </View>
    );
    const defs = [
      { k: 'morning', label: t('朝(5-10時)'), color: C.teal },
      { k: 'noon', label: t('昼(11-15時)'), color: '#4f9cf9' },
      { k: 'evening', label: t('夕(16-20時)'), color: '#f59e0b' },
      { k: 'night', label: t('夜(21-4時)'), color: '#8b5cf6' },
    ] as const;
    const nightPct = Math.round((share.night / total) * 100);
    return (
      <View style={s.card}>
        <View style={s.h2Row}><FlaskConical size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('食べる時間帯')}<Text style={s.h2sub}>{t('— 直近14日のkcal内訳')}</Text></Text></View>
        <View style={s.slotBar}>
          {defs.map((d) => share[d.k] > 0 && (
            <View key={d.k} style={{ flex: share[d.k], backgroundColor: d.color }} />
          ))}
        </View>
        <View style={s.slotLegend}>
          {defs.map((d) => (
            <View key={d.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={[s.slotDot, { backgroundColor: d.color }]} />
              <Text style={s.slotT}>{d.label} {Math.round((share[d.k] / total) * 100)}%</Text>
            </View>
          ))}
        </View>
        {nightPct >= 25 && (
          <Text style={s.note}>{t('夜（21時以降）が{p}%。夜の配分を昼へ移すと、睡眠と翌朝の食欲が安定しやすくなります。', { p: nightPct })}</Text>
        )}
      </View>
    );
  })();

  const kpiCard = (
      <View style={s.kpiRow}>
        <View style={s.kpi}>
          <Text style={s.kpiL}>{t('体重')}</Text>
          <Text style={s.kpiV} maxFontSizeMultiplier={1.3}>{latestW != null ? latestW.toFixed(1) : '—'}<Text style={s.kpiU}>kg</Text></Text>
          {latestW != null && firstW != null && (
            <Text style={[s.kpiD, { color: latestW - firstW <= 0 ? C.teal : C.coral }]}>
              {t('30日で')}{latestW - firstW <= 0 ? '▼' : '▲'}{Math.abs(latestW - firstW).toFixed(1)}kg
            </Text>
          )}
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>{t('累計収支')}</Text>
          <Text style={[s.kpiV, { color: sumAll <= 0 ? C.teal : C.coral }]} maxFontSizeMultiplier={1.3}>{bigKcalParts(sumAll).num}<Text style={s.kpiU}>{bigKcalParts(sumAll).unit}</Text></Text>
          <Text style={s.kpiD}>{t('脂肪 約')}{(sumAll / 7200).toFixed(1)}kg</Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>{t('未記録（30日）')}</Text>
          <Text style={s.kpiV} maxFontSizeMultiplier={1.3}>{unrecorded}<Text style={s.kpiU}>{t('{n}日', { n: '' })}</Text></Text>
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
                {moodLevelOf(l) != null ? (
                  <View style={{ flex: 1 }}><MoodInline level={moodLevelOf(l)!} /></View>
                ) : (<>
                <Text style={{ fontSize: 15 }}>{logIcon(l)}</Text>
                <Text style={s.dayText} numberOfLines={2}>{logTitle(l)}</Text>
                </>)}
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
                <Text style={[s.chipT, serie === x.key && { color: C.panel }]}>{x.label}</Text>
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
          // サイクル境界（B-5）: 体重系列のみ。先頭の期間開始は「切替」ではないので2本目以降だけ
          markers={serie === 'weight' && periods != null && periods.length >= 2
            ? periods.slice(1).map((p) => ({ date: p.started_at, label: t('{name}開始', { name: cycleLabel(p.purpose) }) }))
            : undefined}
          // 生理周期モード: 月経期間の薄い帯を体重グラフにだけ重ねる。
          // 「増えた」と見える山が周期と重なっているかを、本人の目で確かめられるようにする
          bands={serie === 'weight' && cycleOn && cycleStarts.length > 0
            ? menstrualBands(cycleStarts)
            : undefined}
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
                    <Text style={[s.chipT, isActive(r.d) && { color: C.panel }]}>{r.label}</Text>
                  </Pressable>
                ))}
                {noneActive && (
                  <View style={[s.chip, s.chipOn, { borderStyle: 'dashed' }]}>
                    <Text style={[s.chipT, { color: C.panel }]}>{t('{n}日', { n: liveDays })}</Text>
                  </View>
                )}
              </>
            );
          })()}
        </View>
        {serie === 'weight' && goal?.target_weight != null && (
          <Text style={s.note}>{t('点線＝目標')} {Number(goal.target_weight).toFixed(1)}kg</Text>
        )}
        {/* 帯の凡例。5日間はあくまで目安であることを断り、期間を断定しない */}
        {serie === 'weight' && cycleOn && cycleStarts.length > 0 && (
          <Text style={s.note}>{t('薄い帯＝記録した月経期間（開始日から{n}日間の目安・長さには個人差があります）', { n: PERIOD_BAND_DAYS })}</Text>
        )}
      </View>
  );

  // 詳細ページの空白防止: nullを返すと「タイトルだけの真っ白なページ」になる
  // （βフィードバック 2026-09-01「食材の傾向」が空）。条件を満たさない時も必ず説明カードを出す
  const emptyDetail = (text: string) => (
    <View style={s.emptyCard}><Text style={s.emptyCardT}>{text}</Text></View>
  );

  const trendsCard = (() => {
        if (foodFx.length < 3) {
          return emptyDetail(t('品目つきの食事記録と翌日の体重が3組以上たまると、「あなたに合う食材・合わない食材」の傾向がここに出ます。いつもの記録を続けるだけで大丈夫です。'));
        }
        const down = foodFx.filter((f) => f.effect < -0.02).slice(0, 3);
        const up = [...foodFx].reverse().filter((f) => f.effect > 0.02).slice(0, 3);
        if (down.length === 0 && up.length === 0) {
          return emptyDetail(t('いまのところ、体重をはっきり動かす食材は見つかっていません（それ自体が良い知らせです）。記録が増えると小さな傾向も見えてきます。'));
        }
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
      })();

  const healthCard = healthAvailable() ? (
        <View style={s.card}>
          <View style={s.h2Row}><Footprints size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('歩数・睡眠（直近7日）')}</Text></View>
          {/* 週間歩数目標（B-15）: 「きょうの動き」と同じ週プログレス。目標オフ/未読込時は出さない */}
          {weekStepsGoal != null && activity != null && activity.length > 0 && (
            <View style={{ marginTop: -4, marginBottom: 12 }}>
              <WeekStepsBar days={activity} today={today} goal={weekStepsGoal} />
            </View>
          )}
          {/* 昨夜の睡眠（B-14a・ヘルスケアの円グラフ相当）: 合計の大表示＋ステージ横帯。
              ステージデータが無い端末（Apple Watch無し等）はsleepStages=null＝下の7日表だけの従来表示 */}
          {sleepStages != null && (() => {
            const st = sleepStages;
            const asleepH = st.deepH + st.coreH + st.remH;   // 「睡眠時間」は覚醒を除いた合計
            if (asleepH <= 0.01) return null;
            const fmtHM = (h: number) => {
              const m = Math.round(h * 60);
              return m >= 60 ? t('{h}時間{m}分', { h: Math.floor(m / 60), m: m % 60 }) : t('{n}分', { n: m });
            };
            // ステージの配色はC.tealの濃淡3段（深いほど濃い）＋覚醒だけ淡いcoral
            const segs = [
              { k: 'deep', label: t('深い睡眠'), h: st.deepH, color: C.teal },
              { k: 'core', label: t('コア睡眠'), h: st.coreH, color: rgba(C.teal, 0.55) },
              { k: 'rem', label: t('レム睡眠'), h: st.remH, color: rgba(C.teal, 0.3) },
              { k: 'awake', label: t('覚醒'), h: st.awakeH, color: rgba(C.coral, 0.4) },
            ].filter((x) => x.h > 0.01);
            const totalAll = segs.reduce((a, x) => a + x.h, 0);
            const bw = Math.max(60, winW - 60);   // 画面幅 − ページ余白32 − カード内余白28
            let x = 0;
            return (
              <View style={s.slpBox}>
                <Text style={s.slpTitle}>{t('昨夜の睡眠')}</Text>
                <Text style={s.slpVal} maxFontSizeMultiplier={1.3}>{fmtHM(asleepH)}</Text>
                <View style={s.slpBarWrap}>
                  <Svg width={bw} height={14}>
                    {segs.map((sg) => {
                      const w = (sg.h / totalAll) * bw;
                      const r = <Rect key={sg.k} x={x} y={0} width={w} height={14} fill={sg.color} />;
                      x += w;
                      return r;
                    })}
                  </Svg>
                </View>
                <View style={s.slpLegend}>
                  {segs.map((sg) => (
                    <View key={sg.k} style={s.slpLegendItem}>
                      <View style={[s.slpDot, { backgroundColor: sg.color }]} />
                      <Text style={s.slpLegendT}>{sg.label} {fmtHM(sg.h)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}
          {activity === null ? (
            <Pressable style={s.actBtn} onPress={loadActivity} disabled={healthBusy}>
              <Text style={s.actBtnT}>{healthBusy ? '読み込み中…' : t('ヘルスケアから読み込む')}</Text>
            </Pressable>
          ) : (
            <>
              {activity.map((a) => (
                <View key={a.date} style={s.actRow}>
                  <Text style={s.actDate}>{a.date.slice(5).replace('-', '/')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Footprints size={13} color={C.sub} /><Text style={s.actVal}>{a.steps.toLocaleString()}歩</Text></View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Moon size={13} color={C.sub} /><Text style={s.actVal}>{a.sleepH > 0 ? `${a.sleepH}h` : '—'}</Text></View>
                  {/* アクティブkcal（ヘルスケア実測・歩行や日常活動を含む）。
                      歩数だけでは「動いた量」がカロリーで見えないため列を足した */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Flame size={13} color={C.sub} /><Text style={s.actVal}>{a.activeKcal > 0 ? `${a.activeKcal.toLocaleString()}kcal` : '—'}</Text></View>
                </View>
              ))}
              {activity.some((a) => a.activeKcal > 0) && (
                <Text style={s.note}>{t('アクティブは安静時を超えて消費したぶんの実測です（歩行・日常の動きを含み、アプリ記録ぶんも含まれることがあります）。')}</Text>
              )}
            </>
          )}
          {healthMsg && <Text style={[s.note, { color: C.coral }]}>{healthMsg}</Text>}
        </View>
  ) : emptyDetail(t('ヘルスケア連携はiOSのTestFlight版で使えます。連携すると、直近7日の歩数と睡眠がここに並びます。'));

  // 統合行は詳細ページで旧カードを縦に積む（各カードのmarginBottom:12がそのまま余白になる）。
  // カード1枚の例外でページ全体が落ちないよう、旧カード単位で境界を保つ。
  // どのカードで起きたかを名前で出せるので、原因の切り分けにもなる
  function card(key: string): ReactNode {
    const stack = DETAIL_STACKS[key];
    if (stack) return <View>{stack.map((k) => <View key={k}>{subCard(k)}</View>)}</View>;
    return subCard(key);
  }

  function subCard(key: string): ReactNode {
    return (
      <ErrorBoundary compact name={CARD_LABELS()[key] ?? key}>
        {cardBody(key)}
      </ErrorBoundary>
    );
  }

  function cardBody(key: string): ReactNode {
    switch (key) {
      case 'digest': return digestCard;
      case 'bulkguard': return <LeanBulkCard />;
      // 画面が既に持っているperiodsと体重rowsを渡す（🏋️日数だけカード側でベストエフォート取得）
      case 'cycles': return <CycleCard periods={periods ?? []} weights={wRows.map((r) => ({ date: r.date, weight: Number(r.weight) }))} />;
      case 'slots': return slotsCard;
      case 'kpi': return kpiCard;
      case 'calendar': return calendarCard;
      case 'chart': return chartCard;
      case 'photos': return <BodyPhotosCard />;
      // バイタル（血圧・脈拍・血糖）。migration-25未適用でも空状態で成立する
      case 'vitals': return <VitalsCard width={winW - 60} />;
      // 生理周期（migration-28未適用でも空状態で成立する）。保存・削除のたびに帯を貼り直す
      case 'cycle': return <MenstrualCycleCard onChanged={loadCycle} />;
      case 'binge': return <BingeTriggerCard />;
      // 画面が既に持っているrows（date/intake/target）をそのまま渡す（再取得しない最小構成）
      case 'weekmap': return <WeekdayHeatmapCard rows={rows} />;
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
      case 'tpr': return <PersonalBestCard />;
      case 'tgoal': return <GoalSummaryCard mode="training" />;
      case 'lifthist': return <LiftHistoryCard showUndo={undoBar.show} />;
      default: return null;
    }
  }

  // 増量目的でないときはbulkguardをメニューにも⊕シートにも出さない（並び順は保持）。
  // cyclesも同様: 切替経験なし（サイクル1つ以下）またはテーブル未作成（periods=null）なら出さない
  // 生理周期は設定でONにした人にだけ出す（既定OFF＝記録しない人の画面には現れない）
  const unavailable = [
    ...(purpose === 'bulk' ? [] : ['bulkguard']),
    ...((periods?.length ?? 0) >= 2 ? [] : ['cycles']),
    ...(cycleOn ? [] : ['cycle']),
  ];
  const hidden = hiddenAll;
  // 描画は常にセクション正規化した並びを使う（保存値がセクションを跨いでいても壊れない）
  const orderNorm = normalizeOrder(orderAll);
  const visibleOrder = orderNorm.filter((k) => !hidden.includes(k) && !unavailable.includes(k));

  // 表示中カードの並べ替え結果を、非表示・非対象カードの位置を保ったまま全体の順序へ戻す。
  // ドラッグ確定はそのまま保存してよい（描画側で毎回正規化するので、セクションを跨いだ
  // 落下も自セクション内の相対位置だけが反映される＝跨ぎは実質無効）
  const setOrder = (nextVisible: string[]) => {
    let i = 0;
    setOrderAll(orderNorm.map((k) => (hidden.includes(k) || unavailable.includes(k) ? k : nextVisible[i++])));
  };

  function hideCard(key: string) {
    const next = [...hidden, key];
    setHiddenAll(next);
    AsyncStorage.setItem('bl-hidden-all2', JSON.stringify(next)).catch(() => {});
  }
  function showCard(key: string) {
    const next = hidden.filter((k) => k !== key);
    setHiddenAll(next);
    AsyncStorage.setItem('bl-hidden-all2', JSON.stringify(next)).catch(() => {});
  }

  // 最初の並びに戻す（旧世代の保存キーもここで掃除する）
  async function resetOrder() {
    setOrderAll(ALL_ORDER_DEFAULT);
    setHiddenAll([]);
    try {
      await AsyncStorage.removeItem('bl-order-all2');
      await AsyncStorage.removeItem('bl-hidden-all2');
      await AsyncStorage.removeItem('bl-order-all');
      await AsyncStorage.removeItem('bl-hidden-all');
      await AsyncStorage.removeItem('bl-order-body');
      await AsyncStorage.removeItem('bl-order-train');
      await AsyncStorage.removeItem('bl-hidden-body');
      await AsyncStorage.removeItem('bl-hidden-train');
    } catch { /* 無視 */ }
  }

  // ===== マスタメニューの要約行（ヘルスケア式: 名前＋変化の言語化＋ミニチャート） =====
  function weekDeltaOf(sel: (r: Row) => number | null): number | null {
    const xs = rows.filter((r) => sel(r) != null);
    if (xs.length < 2) return null;
    const last = xs[xs.length - 1];
    const cutoff = addDays(last.date, -7);
    let base = xs[0];
    for (const r of xs) { if (r.date <= cutoff) base = r; else break; }
    const d = Number(sel(last)) - Number(sel(base));
    return Math.round(d * 10) / 10;
  }
  const wRows = rows.filter((r) => r.weight != null);
  const latestW2 = wRows.length ? Number(wRows[wRows.length - 1].weight) : null;
  const weekW = weekDeltaOf((r) => r.weight);

  function summaryOf(key: string): string {
    switch (key) {
      case 'body': {
        // 旧kpi行の要約: 現在体重＋1週間の変化（30日の流れは詳細のヘッダー・グラフで見せる）
        if (latestW2 == null) return t('体重を記録するとここに変化が出ます');
        const d = weekW != null ? `・${t('1週間で')}${weekW <= 0 ? '▼' : '▲'}${Math.abs(weekW).toFixed(1)}kg` : '';
        return `${latestW2.toFixed(1)}kg${d}`;
      }
      case 'eating': {
        // 旧slotsの要約（最多時間帯）を優先。データが無いうちは旧bingeの誘い文
        const from14 = addDays(today, -14);
        const share: Record<string, number> = { morning: 0, noon: 0, evening: 0, night: 0 };
        for (const it of toItemEntries(logRows.filter((r) => r.date >= from14))) {
          if (it.hour == null) continue;
          share[slotOf(it.hour)] += it.kcal;
        }
        const total = share.morning + share.noon + share.evening + share.night;
        if (total <= 0) return t('食べすぎの引き金を分析');
        const names: Record<string, string> = { morning: t('朝'), noon: t('昼'), evening: t('夕'), night: t('夜') };
        const top = Object.keys(share).reduce((a, b) => (share[a] >= share[b] ? a : b));
        return t('{slot}が最多（{p}%）', { slot: names[top], p: Math.round((share[top] / total) * 100) });
      }
      case 'week': {
        // 旧digestの要約: 今週の記録日数＋先週比の体重変化（digestCardと同じ集計を1行に）
        const ws = weekStartOf2(today);
        const rec = rows.filter((r) => r.date >= ws && r.date <= today && r.intake != null).length;
        if (rec === 0) return t('今週のふりかえり');
        const wOf = (from: string, to: string) => {
          const l = wRows.filter((r) => r.date >= from && r.date < to);
          return l.length ? Number(l[l.length - 1].weight) : null;
        };
        const wNow = wOf(ws, addDays(today, 1)) ?? latestW2;
        const wPrev = wOf(addDays(ws, -7), ws);
        const dW = wNow != null && wPrev != null ? Math.round((wNow - wPrev) * 10) / 10 : null;
        return dW != null
          ? t('今週{n}日記録・体重{d}kg', { n: rec, d: `${dW > 0 ? '+' : ''}${dW.toFixed(1)}` })
          : t('今週{n}日記録', { n: rec });
      }
      case 'laws': return lawLine ?? t('記録が貯まると、あなたの法則が見つかります');
      case 'bulkguard': return t('週あたりの増量ペースを見張る');
      case 'cycles': {
        // 現在のサイクル「増量 5週目・+1.2kg」（進行中の期間＋期間内の体重変化）
        const open = periods?.find((p) => p.ended_at == null);
        if (!open) return t('サイクルごとの変化を比べる');
        const days = Math.max(0, Math.round((new Date(today + 'T00:00:00').getTime() - new Date(open.started_at + 'T00:00:00').getTime()) / 86400000));
        const ws = wRows.filter((r) => r.date >= open.started_at);
        const d = ws.length >= 2 ? Math.round((Number(ws[ws.length - 1].weight) - Number(ws[0].weight)) * 10) / 10 : null;
        const wk = t('{n}週目', { n: Math.floor(days / 7) + 1 });
        return `${cycleLabel(open.purpose)} ${wk}${d != null ? `・${d > 0 ? '+' : ''}${d.toFixed(1)}kg` : ''}`;
      }
      case 'photos': return t('見た目の変化を並べて見る');
      // 「周期14日目・これまでの平均29日」式（未記録なら記録への誘い）。予測は含まない
      case 'cycle': return cycleSummary(cycleStarts, today);
      // 最新の血圧（無ければ誘い文）。取得は画面ロードのベストエフォート
      case 'vitals': return vitalsSummary(vitals);
      // 旧tkpi/tprの誘い文（週次集計はカード側が持つデータなのでここでは静的に）
      case 'volume': return t('今週のセット数・ボリューム');
      case 'strength': return t('自己ベストと共有ステッカー');
      case 'health': {
        const st = activity?.find((d) => d.date === today)?.steps;
        return st != null ? t('きょう{n}歩', { n: st.toLocaleString() }) : t('歩数・睡眠をヘルスケアから');
      }
      default: return '';
    }
  }
  function menuIconOf(key: string) {
    const p = { size: 17, color: C.teal } as const;
    switch (key) {
      case 'body': return <PersonStanding {...p} />;
      case 'eating': return <Salad {...p} />;
      case 'week': return <CalendarDays {...p} />;
      case 'volume': return <Dumbbell {...p} />;
      case 'strength': return <Trophy {...p} />;
      case 'laws': return <BookOpen {...p} />;
      case 'bulkguard': return <Gauge {...p} />;
      case 'cycles': return <Repeat {...p} />;
      case 'photos': return <Camera {...p} />;
      case 'vitals': return <HeartPulse {...p} />;
      case 'cycle': return <Droplet {...p} />;
      case 'health': return <Footprints {...p} />;
      default: return <FlaskConical {...p} />;
    }
  }
  // 体重のミニスパークライン（kpi/chart行に添える。直近30日）
  const sparkVals = wRows.slice(-30).map((r) => Number(r.weight));
  // 体重変化グラフのステッカー: 期間はグラフの期間チップに追従（30日 / 90日。「全」は90日に丸める）。
  // 増量目的（bulk）のときは「増えた」が良い方向＝色づけを反転する（ShareSticker.weightDelta）
  const stickerDays = range === 30 ? 30 : 90;
  const stickerPoints = wRows.filter((r) => r.date >= addDays(today, -stickerDays)).map((r) => ({ date: r.date, kg: Number(r.weight) }));
  function openWeightSticker() {
    if (stickerPoints.length < 2) return;
    Haptics.selectionAsync().catch(() => {});
    setSticker({ kind: 'weight', points: stickerPoints, days: stickerDays, bulk: purpose === 'bulk' });
  }
  function openDetail(key: string) {
    Haptics.selectionAsync().catch(() => {});
    detailTx.value = 0;   // 前回スワイプ途中の位置が残らないようにする
    setDetailKey(key);
  }

  // ===== 詳細ページのヘルスケア式ヘッダー（A-8残） =====
  // 数値系の主要ページ（body=体重・health=歩数）だけ、タイトル直下に
  // 「大きな現在値＋トレンド文章（{n}週間で下向き等）」を1段足す。
  // 中身のカードは不変。トレンドはlib/trend.tsのtrendPhrase（週平均の平滑変化）。
  // bodyは体重ヘッダーのみ（系列別のヘッダーはページ内のグラフカードのチップに任せる）
  function detailHeader(key: string): ReactNode {
    let val: string | null = null;
    let unit = '';
    let src: { date: string; value: number }[] = [];
    if (key === 'body') {
      if (latestW2 == null) return null;
      val = latestW2.toFixed(1); unit = 'kg';
      src = wRows.map((r) => ({ date: r.date, value: Number(r.weight) }));
    } else if (key === 'health') {
      const st = activity?.find((d) => d.date === today)?.steps;
      if (st == null) return null; // 未読込・未連携ならヘッダーなし（カードの読込ボタンに任せる）
      val = st.toLocaleString(); unit = t('歩');
      src = (activity ?? []).map((a) => ({ date: a.date, value: a.steps }));
    } else {
      return null;
    }
    // 体重ヘッダーだけ2期間平均線（B-17）を足す。体重4週分未満はtrendBandsがnull＝出さない
    const bands = key === 'body' ? trendBands(src) : null;
    // 生理周期モードの説明（この機能の本体）。月経開始の3日前〜開始後3日に体重が増えて
    // いるときだけ、「水分かもしれない」の一言を添える。
    // **断定しない**: 「痩せていない」とも「大丈夫」とも言わず、可能性の提示にとどめる。
    // 増えていないとき（weekW<=0）は何も足さない＝安心を押し売りしない
    const waterDay = key === 'body' && cycleOn && weekW != null && weekW > 0
      && isWaterRetentionWindow(cycleStarts, today)
      ? cycleDay(cycleStarts, today)
      : null;
    return (
      <View style={s.detailHead}>
        {/* 大数字は文字サイズ拡大でレイアウトが崩れやすいため上限1.3（本文系は制限しない） */}
        <Text style={s.detailVal} maxFontSizeMultiplier={1.3}>
          {val}
          <Text style={s.detailUnit}> {unit}</Text>
        </Text>
        <Text style={s.detailTrend}>{trendPhrase(src)}</Text>
        {waterDay != null && (
          <Text style={s.detailWater}>{t('この時期の増加は水分の可能性があります（周期{n}日目）', { n: waterDay })}</Text>
        )}
        {bands && <TrendBands older={bands.older} recent={bands.recent} width={winW - 32} />}
      </View>
    );
  }
  // セクション先頭キー→見出し（正規化済みvisibleOrderで先頭判定。非表示/unavailableで
  // 先頭が変われば自動で次の行に付く。編集中も表示されるがドラッグの対象にはならない）
  const sectionHeadOf = new Map<string, string>();
  for (const sec of SECTION_DEFS) {
    const first = visibleOrder.find((k) => sec.keys.includes(k));
    if (first) sectionHeadOf.set(first, sec.title());
  }
  function menuRow(key: string) {
    const withSpark = key === 'body' && sparkVals.length >= 2;
    // 王冠ゲーティング: 有料機能は行を隠さず王冠つきで見せ、タップで文脈ペイウォールへ
    // （moment of intent）。gate.activeがfalse（現在の全機能無料ビルド）では従来どおり。
    // 旧digest行の王冠は統合先のweek行へ付け替え（ペイウォールsrcはdigestのまま）。
    // 新ティア: 食べ方の分析（eating詳細）もスタンダード以上の機能（src=eating）
    const crowned = (key === 'week' && gate.gated('digest')) || (key === 'eating' && gate.gated('eating'));
    const secTitle = sectionHeadOf.get(key);
    const row = (
      <Pressable style={({ pressed }) => [s.menuRow, pressed && { transform: [{ scale: 0.985 }], opacity: 0.9 }]}
                 // Androidリップル（Material 3の作法）。menuRow自身のborderRadius 16内にクリップされる
                 android_ripple={{ color: rgba(C.teal, 0.14), borderless: false }}
                 // ガイドツアーの「変化を見る」ハイライトは体の記録行に当てる（詳細はタップ先）
                 ref={key === 'body' ? chartTarget : undefined} collapsable={false}
                 onPress={() => {
                   if (crowned) {
                     Haptics.selectionAsync().catch(() => {});
                     // typed routesが動的srcを知らないためas never（onboarding.tsxと同じ流儀）
                     router.push((key === 'eating' ? '/paywall?src=eating' : '/paywall?src=digest') as never);
                     return;
                   }
                   // lawsはカード詳細ではなく法則図鑑（スタック画面）への外部遷移
                   // （実績と同じ「別ページに住む機能」なのでdetailKeyには入れない）
                   if (key === 'laws') {
                     Haptics.selectionAsync().catch(() => {});
                     router.push('/laws' as never);
                     return;
                   }
                   openDetail(key);
                 }}
                 onLongPress={() => setEditing(true)} delayLongPress={400}>
        <View style={s.menuIcon}>{menuIconOf(key)}</View>
        <View style={{ flex: 1 }}>
          <Text style={s.menuT}>{CARD_LABELS()[key] ?? key}</Text>
          <Text style={s.menuSub} numberOfLines={1}>{summaryOf(key)}</Text>
        </View>
        {crowned && <CrownBadge size={14} />}
        {withSpark && <MiniSpark vals={sparkVals} color={C.teal} />}
        <Text style={s.menuGo}>›</Text>
      </Pressable>
    );
    // セクション先頭ならヘルスケア風の小見出し＋余白を上に足す（見出しは行と一体で描くため、
    // ReorderableCards側に見出し行を挿入する改造が不要＝並べ替えの座標計算も従来のまま）
    if (secTitle == null) return row;
    return (
      <View>
        <Text style={s.sectionH}>{secTitle}</Text>
        {row}
      </View>
    );
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
                <Plus size={ICON.md} color="#fff" strokeWidth={ICON.strokeBold} />
              </Pressable>
              <Pressable onPress={resetOrder} style={s.editBtn} hitSlop={8}><Text style={s.editBtnT}>{t('元に戻す')}</Text></Pressable>
              <Pressable onPress={finishEditing} style={s.doneBtn} hitSlop={8}><Text style={s.doneBtnT}>{t('完了')}</Text></Pressable>
            </>
          ) : (
            <Pressable onPress={() => setEditing(true)} hitSlop={8} style={s.editBtn}><Text style={s.editBtnT}>{t('≡ 並べ替え')}</Text></Pressable>
          )}
        </View>
      </View>
      {editing && <Text style={s.editHint}>{t('行を長押し→そのままドラッグで並び替え。「完了」で保存します')}</Text>}
      {/* きょうのハイライト（B-16）: セクション見出しより上の最上部に1枚だけ。
          並び替え中は非表示（ドラッグの視界を邪魔しない）。lawsは図鑑へ、他は詳細ページへ */}
      {!editing && (
        <HighlightCard
          rows={rows} today={today} ready={menuLoaded}
          onOpen={(target: HighlightTarget) => {
            if (target === 'laws') { router.push('/laws' as never); return; }
            openDetail(target);
          }}
        />
      )}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {detailKey == null && !menuLoaded && rows.length === 0 ? (
        // ===== スケルトンローディング =====
        // 初回ロード中（rowsが空でロード完了前）だけ、メニュー行の骨組みを5本見せる。
        // 空白よりも「ここに行リストが出る」ことが先に伝わり、体感の待ちが短くなる
        <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}>
          {headerJSX}
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={s.skelRow}>
              <Skeleton width={34} height={34} radius={17} />
              <View style={{ flex: 1, gap: 7 }}>
                <Skeleton width="52%" height={13} radius={6} />
                <Skeleton width="78%" height={10} radius={5} />
              </View>
            </View>
          ))}
        </ScrollView>
      ) : detailKey == null ? (
        // ===== マスタメニュー（ヘルスケア式: 要約行のリスト。行の長押しで並び替え） =====
        <ReorderableCards
          editing={editing}
          order={visibleOrder}
          onOrderChange={setOrder}
          renderCard={menuRow}
          onHide={hideCard}
          ghostLabel={(k) => CARD_LABELS()[k] ?? k}
          header={headerJSX}
          onEnterEdit={() => setEditing(true)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
          onScroller={(fn) => guide.registerScroller('/changes', fn)}
        />
      ) : (
        // ===== 詳細ページ（メニュー行タップで展開。既存カードをそのまま全画面で見せる） =====
        // エッジスワイプ（左端開始のPan）で指に追従してスライドし、1/3超か勢いがあれば閉じる
        <GestureDetector gesture={backPan}>
          <Animated.View style={[{ flex: 1 }, detailSlide]}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
            >
              <Animated.View key={detailKey} entering={FadeInDown.duration(260)}>
                <Pressable style={s.backRow} onPress={() => { Haptics.selectionAsync().catch(() => {}); setDetailKey(null); }} hitSlop={8}>
                  <ChevronLeft size={ICON.xl} color={C.teal} />
                  <Text style={s.backT}>{t('概要')}</Text>
                </Pressable>
                {/* 見出し行。体の記録だけ右上に共有アイコン（体重変化グラフの透過ステッカー。体重が2点以上あるとき） */}
                <View style={s.detailTitleRow}>
                  <Text style={[s.detailTitle, { flex: 1, marginBottom: 0 }]}>{CARD_LABELS()[detailKey] ?? ''}</Text>
                  {detailKey === 'body' && stickerPoints.length >= 2 && (
                    <Pressable onPress={openWeightSticker} hitSlop={10} style={s.detailShare}
                               accessibilityRole="button" accessibilityLabel={t('体重の変化をストーリーに共有')}>
                      <Share2 size={ICON.md} color={C.teal} />
                    </Pressable>
                  )}
                </View>
                {detailHeader(detailKey)}
                <ErrorBoundary>{card(detailKey)}</ErrorBoundary>
              </Animated.View>
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      )}      {/* 削除のUndoスナックバー（筋トレ履歴の削除で使う。タブの上に出す） */}
      {undoBar.element}
      <AddCardSheet
        visible={addOpen} onClose={() => setAddOpen(false)}
        hidden={hidden.filter((k) => !unavailable.includes(k))} shownKeys={visibleOrder} labels={CARD_LABELS()} onShow={showCard}
      />
      <BodyTable visible={bodyTableOpen} onClose={() => setBodyTableOpen(false)} initialMetric={tableMetric} />
      <LiftTable visible={liftTableOpen} onClose={() => setLiftTableOpen(false)} />
      <ShareStickerModal data={sticker} visible={sticker != null} onClose={() => setSticker(null)} />
      <StatusBarMask />
      <HeaderGear guideKey="gear" />
    </View>
  );
}

const s = themed(() => ({
  scroll: { padding: SPACE.screen, paddingBottom: 24 },   // 下端はinsets.bottom（タブバー高さ込み）を描画側で足す
  h: { ...HEAD.section, color: C.ink, marginBottom: 12 },
  pageTitle: { ...HEAD.page, color: C.ink },
  topSegWrap: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  topSeg: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  gearBtn: { width: 30, height: 30, borderRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' },
  topSegOn: { backgroundColor: C.teal, borderColor: C.teal },
  topSegT: { fontSize: 15, fontWeight: '800', color: C.sub },
  // 系列チップと同じ行に置く（チップが折り返しても重ならない）
  chipsHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  chipsFlex: { flex: 1, marginRight: 0 },
  toTable: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12,
    backgroundColor: C.accentBadge, borderRadius: RADIUS.chip, paddingHorizontal: 9, paddingVertical: 4,
  },
  toTableT: { fontSize: 11, fontWeight: '800', color: C.teal },
  addBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: C.teal,
    alignItems: 'center', justifyContent: 'center',
  },
  editBtn: { borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.chip, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.panel },
  editBtnT: { fontSize: 13, fontWeight: '800', color: C.sub },
  doneBtn: { backgroundColor: C.teal, borderRadius: RADIUS.chip, paddingHorizontal: 16, paddingVertical: 7 },
  doneBtnT: { fontSize: 13, fontWeight: '800', color: '#fff' },
  editHint: { fontSize: 13, color: C.sub, marginBottom: 10, textAlign: 'center' },
  lifted: {
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 10 },
    elevation: 12, borderRadius: RADIUS.card, backgroundColor: C.bg,
  },
  ghostCard: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed',
    borderRadius: RADIUS.card, padding: SPACE.card, marginBottom: 12, alignItems: 'center',
  },
  ghostT: { fontSize: 13, color: C.sub, fontWeight: '600' },
  // 詳細ページの空状態（データが揃う前の説明。ghostCardより読ませる文章向けに左寄せ・行間広め）
  emptyCard: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed',
    borderRadius: RADIUS.card, padding: SPACE.card, marginBottom: 12,
  },
  emptyCardT: { fontSize: 13.5, color: C.sub, fontWeight: '600', lineHeight: 21 },
  moveCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.panel,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10,
  },
  moveLabel: { fontSize: 15, fontWeight: '700', color: C.ink },
  moveBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  moveBtnT: { fontSize: 17, fontWeight: '800', color: C.teal },
  actBtn: { backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, paddingVertical: 11, alignItems: 'center', marginTop: 4 },
  actBtnT: { fontSize: 13, fontWeight: '800', color: C.ink },
  actRow: { flexDirection: 'row', gap: 12, paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: C.line, alignItems: 'center' },
  // 昨夜の睡眠（B-14a）: 合計の大表示＋ステージ横帯＋凡例
  slpBox: { marginBottom: 12 },
  slpTitle: { fontSize: 11, fontWeight: '800', color: C.sub, letterSpacing: 0.2 },
  slpVal: { fontSize: 26, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  slpBarWrap: { borderRadius: 7, overflow: 'hidden', marginTop: 8, backgroundColor: C.track },
  slpLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  slpLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  slpDot: { width: 8, height: 8, borderRadius: 4 },
  slpLegendT: { fontSize: 11, color: C.sub, fontWeight: '700', fontVariant: ['tabular-nums'] },
  actDate: { fontSize: 13, color: C.faint, fontWeight: '700', width: 40, fontVariant: ['tabular-nums'] },
  actVal: { fontSize: 13, color: C.ink, fontVariant: ['tabular-nums'] },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  kpi: { flex: 1, backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: RADIUS.panel, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 12 },
  kpiL: { fontSize: 11, fontWeight: '700', color: C.sub },
  kpiV: { fontSize: 21, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  kpiU: { fontSize: 13, color: C.sub, fontWeight: '600' },
  kpiD: { fontSize: 11, color: C.sub, marginTop: 2 },
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: RADIUS.card, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: SPACE.card, marginBottom: 12 },
  h2: { ...HEAD.card, color: C.ink, marginBottom: 8 },
  h2sub: { fontSize: 12, fontWeight: '700', color: C.faint },
  dayBox: { borderTopWidth: 0.5, borderTopColor: C.line, marginTop: 8, paddingTop: 8 },
  dayHead: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 4, fontVariant: ['tabular-nums'] },
  dayRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: C.line },
  dayText: { flex: 1, fontSize: 15, color: C.ink, lineHeight: 21 },
  kcalBadge: { backgroundColor: C.accentBadge, borderRadius: RADIUS.chip, paddingHorizontal: 9, paddingVertical: 3 },  // 生HEX淡緑はダークで浮くためトークン化
  kcalBadgeT: { fontSize: 13, fontWeight: '800', color: C.teal, fontVariant: ['tabular-nums'] },
  fxHead: { fontSize: 13, fontWeight: '800', marginTop: 8, marginBottom: 2 },
  fxRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: C.line },
  fxName: { fontSize: 15, fontWeight: '700', color: C.ink },
  fxVal: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontSize: 13, fontWeight: '700', color: C.sub },
  dgRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: C.line },
  dgLabel: { width: 96, fontSize: 13, color: C.sub, fontWeight: '700' },
  dgVal: { fontSize: 17, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  dgSub: { fontSize: 12, color: C.faint },
  slotBar: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: C.track, marginTop: 4 },
  slotLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  slotDot: { width: 8, height: 8, borderRadius: 4 },
  slotT: { fontSize: 11, color: C.sub, fontWeight: '700' },
  note: { fontSize: 13, color: C.faint, lineHeight: 18 },
  // セクション小見出し（ヘルスケアの「トレンド」「ハイライト」風。上余白を大きめに取り
  // グループの切れ目を作る。先頭セクションにも同じ余白でリズムを揃える）
  sectionH: { ...HEAD.sub, color: C.ink, marginTop: 14, marginBottom: 10, marginLeft: 2 },
  // マスタメニュー（ヘルスケア式）
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
    borderRadius: RADIUS.panel, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 9,
    shadowColor: C.shadow, shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1,
  },
  menuIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: C.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  // スケルトン行（menuRowと同じ枠寸法。中身だけ角丸ブロックに置き換える）
  skelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
    borderRadius: RADIUS.panel, paddingHorizontal: 14, paddingVertical: 15, marginBottom: 9,
  },
  menuT: { fontSize: 15.5, fontWeight: '800', color: C.ink },
  menuSub: { fontSize: 12.5, color: C.sub, marginTop: 2, fontVariant: ['tabular-nums'] },
  menuGo: { fontSize: 21, color: C.faint, fontWeight: '600', marginLeft: 2 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: 4, marginBottom: 2 },
  backT: { fontSize: 15, fontWeight: '800', color: C.teal },
  detailTitle: { fontSize: 24, fontWeight: '900', color: C.ink, marginBottom: 12 },
  // 見出し＋右上の共有アイコン（体の記録）。アイコンは丸い薄いアクセント面（toTable と同じトーン）
  detailTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  detailShare: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center' },
  // 詳細ページのヘルスケア式ヘッダー（大きな現在値＋トレンド文章）
  detailHead: { marginTop: -6, marginBottom: 14 },
  detailVal: { fontSize: 36, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  detailUnit: { fontSize: 16, fontWeight: '700', color: C.sub },
  detailTrend: { fontSize: 13.5, fontWeight: '700', color: C.sub, marginTop: 2 },
  detailWater: { fontSize: 13, fontWeight: '700', color: C.teal, lineHeight: 19, marginTop: 4 },
  // トレンドの2期間平均線（B-17）
  bandBox: { marginTop: 10 },
  bandHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  bandTitle: { fontSize: 11, fontWeight: '800', color: C.sub, letterSpacing: 0.2 },
  bandDiff: { fontSize: 12.5, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  bandLegend: { flexDirection: 'row', gap: 14, marginTop: 2 },
  bandLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bandDot: { width: 8, height: 8, borderRadius: 4 },
  bandLegendT: { fontSize: 11, color: C.sub, fontWeight: '700', fontVariant: ['tabular-nums'] },
}));
