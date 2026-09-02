// 食事タブ（Phase 1コア）: ヒーロー・今日のフィード・AI解析コンポーザー・マイ食品チップ・体重クイック入力
// ロジックはWeb版のlib/*をそのまま移植して使用（データ・計算式は完全互換）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, Image, Alert, Animated, Easing, Modal,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Pencil, History, Camera, Images, Weight, Activity, ChevronDown, ArrowUp, Smile, Sparkles, UtensilsCrossed } from 'lucide-react-native';
import DockIconButton from '@/components/DockIconButton';
import VoiceHintButton from '@/components/VoiceHintButton';
import AdBanner from '@/components/AdBanner';
import BarcodeScanner from '@/components/BarcodeScanner';
import { lookupBarcode, packageNutrition } from '@/lib/foodDb';
import DateStrip from '@/components/DateStrip';
import { LiveBar, GhostPair, usePulse } from '@/components/LivePreviewBar';
import SpotlightTip from '@/components/SpotlightTip';
import AddFoodSheet, { type MyFoodDraft } from '@/components/AddFoodSheet';
import MenuAdvisor from '@/components/MenuAdvisor';
import { recordItems, pickSuggestion, markShown, markDeclined, type Suggestion } from '@/lib/foodSuggest';
import { removeItemAt } from '@/lib/itemLog';
import { previewFill } from '@/lib/preview';
import * as Haptics from 'expo-haptics';
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { MinusBadge, AddCardSheet, useCardLayout } from '@/components/CardLayout';
import { Plus } from 'lucide-react-native';
import { Chip, OptionButton } from '@/components/ui/Selectable';
import { pfcAdvice, PFC_LABEL, PFC_SHORT } from '@/lib/pfcAdvice';
import { pfcColors } from '@/lib/theme';
import { useUnits, displayToKg, kgToDisplay, fmtWeight } from '@/lib/units';
import { Keyboard } from 'react-native';
import { useKeyboardVisible } from '@/lib/useKeyboardVisible';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useLocalSearchParams, useFocusEffect, useRouter, useNavigation } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { analyzeFood, saveParsed, type QuickImage } from '@/lib/quicklog';
import {
  makeJob, addJob, removeJob, markFailed, markRunning, triageJobs, isSlow,
  claimOnce, releaseClaim, loadJobs, saveJobs, readPhotoPayloads, type ParseJob,
} from '@/lib/parseJobs';
import { syncEntriesForDate } from '@/lib/sync';
import { C, rgba, RADIUS, SPACE, ICON, HEAD, themed } from '@/lib/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mifflinBMR, EX_ADD, todayJST, LIFE_FACTOR_DEFAULT, type ExLevel } from '@/lib/calc';
import { activeKcalGoalBonus, useActiveKcal, useActiveKcalToGoal, useStepsOfDay } from '@/lib/activeKcal';
import { resolveBurnKcal } from '@/lib/stepsKcal';
import {
  MEAL_TIME_PRESETS, MEAL_TIME_NOW, MEAL_TIME_STEP_MIN,
  resolveMealTime, buildAtJST, hmJST, parseHm, fmtHm, roundHm,
} from '@/lib/timeSlots';
import { assessBingeRisk, type BingeRisk, type InsightDay } from '@/lib/insights';
// 気づきアラート（docs/INSIGHTS-ENGINE.md §8・E2）: 本人の法則で駆動する事前アラート。判定は lib/correlate、配線は lib/insightAlerts
import { loadInsightAlerts, closeInsightAlert, maybeScheduleMorningNotification, lawLinkForAlert, type InsightAlertState } from '@/lib/insightAlerts';
import type { Alert as InsightAlert } from '@/lib/correlate';
import { buildDailyBrief, type Brief } from '@/lib/dailyBrief';
import DailyBrief from '@/components/DailyBrief';
import { getColumns } from '@/content/columns';
import { detectStruggle } from '@/lib/adaptive';
import { summarizeDay, dayExerciseKcal, type LogRow } from '@/lib/day';
import { sumItems, type FoodItem } from '@/lib/items';
import { addServing, removeServing, servingCount, type MyFoodRow } from '@/lib/foods';
import { listMyMeals, deleteMyMeal, saveMyMeal, type MyMeal } from '@/lib/meals';
import { applyMult, currentMult, MULT_STEPS } from '@/lib/mealAdjust';
import SaveMealSheet from '@/components/SaveMealSheet';
import { logIcon, logTitle, moodLevelOf } from '@/lib/feed';
import { skipTodayReminder, scheduleFirstLawNotification } from '@/lib/notify';
import { getFirstRunFlag } from '@/lib/firstrun';
import { checkFirstLawUnlock, consumeFirstLawBanner } from '@/lib/laws';
import { BookOpen } from 'lucide-react-native';
import StatusBarMask from '@/components/StatusBarMask';
import { useGuide, useGuideTarget, useGuideScroller } from '@/components/GuideTour';
import { useLaunch } from '@/components/LaunchIntro';
import ReorderableChips from '@/components/ReorderableChips';
import HeaderGear from '@/components/HeaderGear';
import StreakChip from '@/components/StreakChip';
import BadgeIcon from '@/components/BadgeIcon';
// 食事の制約（B-18・docs/DIET-MODES.md）。警告は情報提供だけで、保存は絶対にブロックしない
import { useDiet, isDietOff } from '@/lib/diet';
import { shouldShowDietTip, markDietTipShown, markDietTipDeclined } from '@/lib/dietTip';
import { mergeAlerts, rulesFor, type DietAlert, type DietLevel } from '@/lib/dietCheck';
import { DietWarnRow, DietMark, DietSilenceNote } from '@/components/DietNotes';
import { useGate } from '@/lib/gate';
import MoodFace, { MoodInline } from '@/components/MoodFace';
import ComebackSheet from '@/components/ComebackSheet';
import StartChecklist from '@/components/StartChecklist';
import { invalidateStreak, maybeEvaluateBadges, peekBadgeBanner, consumeBadgeBanner, badgeById } from '@/lib/achievements';
import { computePlan, macroTargets, type Goal, type PlanEvent } from '@/lib/goal';
import { dailyAllowance, overLevel, balanceOf, balanceFill, type BalanceDay, type Balance } from '@/lib/deficit';
import { useKcalAdjust } from '@/lib/kcalAdjust';
import { t, apiLang } from '@/lib/i18n';
import { useReduceMotion, useCountUp } from '@/lib/motion';
import { consumePendingMeal } from '@/lib/pendingMeal';
import { usePurpose, purposeOf } from '@/lib/purpose';
import { setDayStatus } from '@/lib/dayStatus';
import { confirmOutlierWeight } from '@/lib/guard';
import { useUndoSnackbar } from '@/components/UndoSnackbar';

type Profile = { sex: 'male' | 'female'; height_cm: number; age: number; init_weight: number | null; life_factor: number; display_name: string };
type MyFood = MyFoodRow & { id: string };
type DayLog = LogRow & { id: string; at: string };
type Parsed = { items: FoodItem[]; weight: number | null; waist: number | null; ex: ExLevel | null; adj: number; mood: string | null };
const LOG_CARDS = ['hero', 'balance', 'checklist', 'mood', 'feed', 'recent', 'weight'];
const LOG_LABELS = (): Record<string, string> => ({
  hero: t('あと食べられる量'), balance: t('週と月の収支'), checklist: t('スタートチェックリスト'), mood: t('いまの気分は？'),
  feed: t('今日の記録'), recent: t('前の食事をもう一度'), weight: t('体重を記録'),
});

type RecentMeal = { id: string; date: string; items: FoodItem[]; kcal: number };

function timeJST(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// ===== 週間・月間の収支カード =====
// 「この1週間: −3,200kcal（目標 −3,500）」をバー＋数字で。日別の超過/不足は7個のドット
// （teal=不足 / 灰=ほぼ目標どおり / アンバー=超過 / 枠だけ=未記録）。
// 数字の物差しは lib/deficit.ts（目標画面の赤字算出と同じ関数）。
function fmtSigned(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toLocaleString()}`;
}
function BalanceRow({ label, b, isBulk }: { label: string; b: Balance; isBulk: boolean }) {
  const fill = balanceFill(b);
  // 目標に届いた（減量なら赤字が目標以上・増量なら黒字が目標以上）ときだけteal。途中は落ち着いたcalorieBar
  const reached = b.goal !== 0 && fill >= 1;
  const noGoal = b.goal === 0;
  return (
    <View style={{ marginTop: 8 }}>
      <View style={bs.row}>
        <Text style={bs.label}>{label}</Text>
        <Text style={bs.num} maxFontSizeMultiplier={1.3}>
          {b.recorded === 0 ? t('記録なし') : `${fmtSigned(b.actual)}kcal`}
          {!noGoal && <Text style={bs.goal}>（{t('目標')} {fmtSigned(b.goal)}）</Text>}
          {noGoal && <Text style={bs.goal}>（{isBulk ? t('増量') : t('維持')}）</Text>}
        </Text>
      </View>
      <View style={bs.track}>
        <View style={[bs.fill, { width: `${Math.round(fill * 100)}%`, backgroundColor: reached ? C.teal : C.calorieBar }]} />
      </View>
    </View>
  );
}
function BalanceCard({ days, perDayDeficit, isBulk }: { days: BalanceDay[]; perDayDeficit: number; isBulk: boolean }) {
  const week = balanceOf(days.slice(-7), perDayDeficit);
  const month = balanceOf(days.slice(-30), perDayDeficit);
  return (
    <View>
      <Text style={bs.h2}>{t('週と月の収支')}</Text>
      <BalanceRow label={t('この1週間')} b={week} isBulk={isBulk} />
      {/* 日別ドット（左=6日前 … 右=今日）。増量ではドットの意味が反転するため色を入れ替える */}
      <View style={bs.dots}>
        {week.dots.map((d, i) => {
          const good = isBulk ? d === 'over' : d === 'under';
          const bad = isBulk ? d === 'under' : d === 'over';
          return (
            <View key={i} style={[bs.dot,
              d === 'none' ? bs.dotNone : good ? { backgroundColor: C.teal } : bad ? { backgroundColor: C.amber } : { backgroundColor: C.faint }]} />
          );
        })}
        <Text style={bs.dotsLegend}>{t('緑=控えめ・灰=ほぼ目標・橙=多め')}</Text>
      </View>
      <BalanceRow label={t('この1か月')} b={month} isBulk={isBulk} />
      <Text style={bs.principle}>{t('体重は1日ではなく、週と月の合計で決まります。今日多めでも、週で戻せば大丈夫です。')}</Text>
    </View>
  );
}
const bs = themed(() => ({
  h2: { ...HEAD.card, color: C.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  label: { fontSize: 13, fontWeight: '700', color: C.sub },
  num: { fontSize: 15, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  goal: { fontSize: 12, fontWeight: '600', color: C.sub },
  track: { height: 6, backgroundColor: C.track, borderRadius: 3, overflow: 'hidden', marginTop: 5 },
  fill: { height: 6, borderRadius: 3 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotNone: { borderWidth: 1.5, borderColor: C.line, backgroundColor: 'transparent' },
  dotsLegend: { fontSize: 11, color: C.faint, marginLeft: 6 },
  principle: { fontSize: 13, color: C.sub, lineHeight: 19, marginTop: 10 },
}));

export default function LogScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // 削除のUndoスナックバー。インプットドックの上に重なる位置に出す（ドック高より少し上）
  const undoBar = useUndoSnackbar(insets.bottom + 96);
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [events, setEvents] = useState<(PlanEvent & { id: string })[]>([]);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [myFoods, setMyFoods] = useState<MyFood[]>([]);
  // マイ食品（セット・複数品目）。migration-24未適用のDBでは常に空＝チップが出ないだけ
  const [myMeals, setMyMeals] = useState<MyMeal[]>([]);
  // セット登録シートの下書き（alsoSave=トレイの✓保存長押し経由: 保存も一緒に行う）
  const [mealDraft, setMealDraft] = useState<{ items: FoodItem[]; alsoSave: boolean } | null>(null);
  const [dayLogs, setDayLogs] = useState<DayLog[]>([]);
  const [chat, setChat] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; upgrade?: boolean; kind?: 'text' | 'photo' | 'coach' } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [wWeight, setWWeight] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; base64: string }[]>([]);
  const [recentMeals, setRecentMeals] = useState<RecentMeal[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  // バーコード照会中の行（AIを使わない端末→OFF直の問い合わせ。数秒で終わるので永続化しない）
  const [pendingTexts, setPendingTexts] = useState<{ id: number; text: string }[]>([]);
  // AI解析の送信ジョブ。送信の瞬間に端末（bl-parse-jobs）へ書き、トレイに反映できたら消す。
  // アプリを閉じても残るので、次にこの画面を開いたときに未完了ぶんを自動で再送する
  const [jobs, setJobs] = useState<ParseJob[]>([]);
  const jobsRef = useRef<ParseJob[]>([]);       // 非同期の完了同士が互いの更新を消さないための現在値
  const startedRef = useRef<Set<string>>(new Set());   // 同じジョブを二重に投げない
  const settledRef = useRef<Set<string>>(new Set());   // 同じジョブの結果を二重に反映しない
  const [nowMs, setNowMs] = useState(() => Date.now());   // 「混み合っています」の判定用（解析中だけ1秒刻み）
  // AIの会話的な返し（一言・仮定・聞き返し）。表示のみでDBには書かない
  const [aiNote, setAiNote] = useState<{ reply: string; questions: string[]; assumptions: string[] } | null>(null);
  // 食事の制約（B-18）: AIが品目に付けた判定（品目名→強さ）。トレイを破棄するまで保持する。
  // FoodItemには入れない＝logs.itemsに推定の判定を焼き付けない（記録は事実だけを残す）
  const [aiDietFlags, setAiDietFlags] = useState<Record<string, DietLevel>>({});
  // 聞き返しに「1/4玉」とだけ返しても文脈が繋がるように、直前のやりとりを覚えておく
  const parseHistory = useRef<{ role: 'user' | 'ai'; text: string }[]>([]);
  const pendingSeq = useRef(0);
  const [stagedNote, setStagedNote] = useState(''); // トレイ確定時にlogs.textへ書く元テキストの蓄積
  const [foodsView, setFoodsView] = useState<'row' | 'grid'>('row');
  const [foodsOrder, setFoodsOrder] = useState<string[]>([]);
  const [inputH, setInputH] = useState(40);   // 1行から始めて最大5行まで自動で伸びる

  // マイ食品の並び順（保存済み順とサーバーの食品一覧をマージ・新規は末尾）
  useEffect(() => {
    (async () => {
      let saved: string[] = [];
      try { saved = JSON.parse((await AsyncStorage.getItem('bl-foods-order')) || '[]'); } catch { /* 初回 */ }
      const ids = myFoods.map((f) => f.id);
      const kept = saved.filter((id) => ids.includes(id));
      setFoodsOrder([...kept, ...ids.filter((id) => !kept.includes(id))]);
    })();
  }, [myFoods]);

  function persistFoodsOrder(next: string[]) {
    setFoodsOrder(next);
    AsyncStorage.setItem('bl-foods-order', JSON.stringify(next)).catch(() => {});
  }
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const wInputRef = useRef<TextInput>(null);   // 体重クイック入力（スタートチェックリストからの誘導先）
  const kbVisible = useKeyboardVisible();
  // iOS HIG標準「タブ再選択で先頭へ」: 食事タブ表示中にもう一度「食事」をタップ→最上部へ
  const navigation = useNavigation();
  useEffect(() => {
    const sub = (navigation as { addListener: (ev: string, cb: () => void) => () => void })
      .addListener('tabPress', () => { scrollRef.current?.scrollTo({ y: 0, animated: true }); });
    return sub;
  }, [navigation]);

  useEffect(() => { AsyncStorage.getItem('bl-foods-view').then((v) => { if (v === 'grid') setFoodsView('grid'); }).catch(() => {}); }, []);

  // 入力ドックのパルス発光（画面を開いた瞬間に「ここが入力欄」と分かるように）。
  // 以前はborderColor/shadowOpacityを直接補間していたが、色はネイティブ駆動できず
  // 常時60fpsのJS負荷になっていた。全開の縁を重ねてopacityだけ動かす方式に変更
  const glow = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (reduceMotion) { glow.setValue(0.4); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1250, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 1250, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [glow, reduceMotion]);
  function toggleFoodsView() {
    const v = foodsView === 'row' ? 'grid' : 'row';
    setFoodsView(v);
    AsyncStorage.setItem('bl-foods-view', v).catch(() => {});
  }

  // ウィジェット/ディープリンク（bodylog://log?quick=1）→ ドックに即フォーカス
  const { quick } = useLocalSearchParams<{ quick?: string }>();
  useEffect(() => {
    if (quick) setTimeout(() => inputRef.current?.focus(), 400);
  }, [quick]);

  // 初回ガイドツアー: 未実施なら自動起動（完了/スキップでbl-guide-doneが立つ）
  const guide = useGuide();
  const heroTarget = useGuideTarget('hero');
  const dockTarget = useGuideTarget('dock');
  const scrollYNow = useRef(0);
  useGuideScroller('/log', useCallback((delta: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, scrollYNow.current + delta), animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));
  const { introDone } = useLaunch();
  useEffect(() => {
    if (!introDone) return; // 起動イントロが終わってから案内を始める
    // ユーザー単位フラグ（同じ端末の別アカウントでもチュートリアルが正しく始まる）
    getFirstRunFlag('bl-guide-done').then((v: string | null) => {
      if (!v) setTimeout(() => guide.start('auto'), 900); // 初回は「入力のきほん」だけ自動再生
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introDone]);

  // 起動時の時差入場（Withings風）: ヘッダー→ヒーロー→カード→ドックの順にフェード＋スライドイン
  const enterV = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (!introDone) return;
    Animated.stagger(70, enterV.map((v) =>
      Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    )).start();
  }, [introDone, enterV]);
  const enter = enterV.map((v, i) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [i === 3 ? 18 : 14, 0] }) }],
  }));

  // 記録先の日付（既定=今日。過去日にも記録できる。旧Web版の日付選択の復活）
  const units = useUnits();

  // 表示/非表示できるカード（⊖で隠し、見出しの⊕から戻す）
  const cards = useCardLayout('bl-cards-log', LOG_CARDS);
  const vis = (k: string) => !cards.layout.hidden.includes(k);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [viewDate, setViewDate] = useState(todayJST());
  const today = viewDate;
  // ヘルスケアのアクティブkcal（実測）と、それを目標へ反映する設定（既定OFF）。
  // 読み取りはlib/health.ts側でキャッシュ済み＝毎レンダーでHealthKitを叩かない
  const activeKcalToday = useActiveKcal(viewDate);
  const stepsOfView = useStepsOfDay(viewDate);
  const activeToGoal = useActiveKcalToGoal();

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    setUid(userId);
    const [profRes, goalRes, evRes, wRes, foodRes, logRes, recentRes, mealsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('goals').select('*').maybeSingle(),
      supabase.from('events').select('id,date,title,extra_kcal').order('date', { ascending: true }),
      supabase.from('entries').select('weight,date').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
      supabase.from('my_foods').select('id,name,kind,unit,kcal,p,f,c,serving_label,serving_ratio').order('created_at', { ascending: true }).limit(30),
      supabase.from('logs').select('*').eq('date', viewDate).order('at', { ascending: true }),
      supabase.from('logs').select('id,date,items,kcal')
        .lt('date', viewDate).not('kcal', 'is', null)
        .order('at', { ascending: false }).limit(40),
      listMyMeals(),   // テーブル未作成なら空（セットのチップが出ないだけ）
    ]);
    if (profRes.data) setProfile(profRes.data as Profile);
    if (goalRes.data) setGoal(goalRes.data as Goal);
    setEvents((evRes.data as (PlanEvent & { id: string })[]) || []);
    if (wRes.data?.length) setLatestWeight(Number(wRes.data[0].weight));
    setMyFoods((foodRes.data as MyFood[]) || []);
    setMyMeals(mealsRes);
    setDayLogs((logRes.data as DayLog[]) || []);
    // 「もう一度食べる」候補: 品目内訳のある過去の食事を、同じ品目構成は最新1件に重複排除
    const seen = new Set<string>();
    const meals: RecentMeal[] = [];
    for (const r of (recentRes.data as RecentMeal[]) || []) {
      const items = (r.items as FoodItem[]) || [];
      if (items.length === 0) continue;
      const key = items.map((it) => `${it.name}|${it.qty || ''}`).sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      meals.push({ ...r, items });
      if (meals.length >= 6) break;
    }
    setRecentMeals(meals);
  }, [viewDate]);

  useEffect(() => { load(); }, [load]);

  // ===== 目安・ヒーロー計算（Web版と同一ロジック） =====
  const summary = summarizeDay(dayLogs);


  const weightForBmr = summary.weight ?? latestWeight ?? (profile?.init_weight != null ? Number(profile.init_weight) : 70);
  const bmr = profile ? mifflinBMR(profile.sex, weightForBmr, Number(profile.height_cm), Number(profile.age)) : 0;
  // アクティブぶんの上乗せ（設定「アクティブカロリーを目標に反映する」・既定OFF）。
  // OFFのときは activeBonus=0 ＝これまでの目標計算から一切変わらない。
  // ONのときも足すのは max(0, アクティブ − BMR×(生活係数−1)) だけ。
  // 生活係数（既定1.3）には日常活動がすでに入っているので、実測全量を足すと
  // 日常活動を二重に数えてしまう。だから「想定より多く動いた分」に絞る（lib/activeKcal.ts）
  //
  // アクティブ相当の出どころは運動タブ「きょうの動き」と同じ3段階（lib/stepsKcal.ts resolveBurnKcal）:
  //   ① 実測>0 → 実測 ／ ② 実測0で歩数>0 → 歩数からの推定（「（推定）」を添える）／ ③ どちらも無し → 上乗せなし
  // ③の「アプリ記録ぶん（adj）」は target の dayExerciseKcal にすでに入っているので recorded=0 で渡し、
  // source が 'recorded' のときは上乗せしない（二重計上しない）
  const heroBurn = resolveBurnKcal({ measured: activeKcalToday, steps: stepsOfView, weightKg: weightForBmr, recorded: 0 });
  const activeEquivalent = heroBurn.source !== 'recorded' ? heroBurn.kcal : null;
  const activeBonus = activeToGoal && activeEquivalent != null
    ? activeKcalGoalBonus(activeEquivalent, bmr, Number(profile?.life_factor ?? LIFE_FACTOR_DEFAULT)) : 0;
  const [kcalAdjust] = useKcalAdjust();
  const target = profile ? Math.round(bmr * Number(profile.life_factor)) + Math.round(dayExerciseKcal(dayLogs)) + activeBonus : 0;
  const plan = goal && profile ? computePlan(goal, today, weightForBmr, events, goal.absorb_days) : null;
  const todayEvent = events.find((e) => e.date === today) ?? null;
  // 1日に食べられる量 = max(維持 − 必要赤字/日 + 手動調整, BMR)。目標画面の「結論」と同じ関数（lib/deficit.ts）。
  // 手動調整（目標画面「きつければ自分で調整」・端末保存）が0なら従来の計算と完全に一致する
  const planIntakeBase = profile ? dailyAllowance(target, plan ? plan.requiredDailyWithEvents : 0, Math.round(bmr), kcalAdjust) : 0;
  const goalKcal = plan && todayEvent ? planIntakeBase + Math.round(Number(todayEvent.extra_kcal)) : planIntakeBase;
  const eaten = Math.round(summary.intake ?? 0);
  const left = goalKcal - eaten;
  const heroLeft = useCountUp(left);   // 保存の瞬間、残量が数え下がって見える
  // 係数が未設定の間は、選んだ目的の既定値を使う（未選択なら従来の既定 P2.0/F0.9）
  const purposeKey = usePurpose();
  const purposePreset = purposeOf(purposeKey);
  // 増量目的では残量の意味が反転する: 失敗は「食べすぎ」ではなく「食べ忘れ」。
  // 残っていても責め色（coral）にせず「まだやることがある」アンバー、
  // 食べきったら減量の超過赤とは逆の達成表現（teal）にする
  const isBulk = purposeKey === 'bulk';
  // 超過の3段階: 〜+300「少し多め」/ +300〜+800「多め。週で調整できます」/ +800超「かなり多め」。
  // ピッタリかマイナスだけを正解に見せない（体重は週・月の収支で決まる）。増量では使わない（反転ロジックは別）
  const overLv = isBulk ? 'none' : overLevel(-left);
  const overColor = overLv === 'none' ? null : overLv === 'high' ? C.coral : C.amber;
  const overBar = overLv === 'high' ? C.coral : overLv === 'mild' ? rgba(C.amber, 0.7) : C.amber;
  const openGoalHub = () => router.push({ pathname: '/settings', params: { open: 'goal', ts: String(Date.now()) } });
  const macros = profile ? macroTargets(
    weightForBmr, goalKcal,
    goal?.protein_per_kg ?? purposePreset?.p,
    goal?.fat_per_kg ?? purposePreset?.f,
    goal?.fat_max_g,
  ) : null;
  const eatenP = Math.round(summary.p ?? 0);
  const eatenF = Math.round(summary.f ?? 0);
  const eatenC = Math.round(summary.c ?? 0);
  // FABのクイック記録でも同じ残量を見せるため、計算結果を共有ストアへ置く
  useEffect(() => {
    if (!profile || !macros) return;
    setDayStatus({
      goalKcal, eaten,
      p: { eaten: eatenP, target: Math.round(macros.p) },
      f: { eaten: eatenF, target: Math.round(macros.f) },
      c: { eaten: eatenC, target: Math.round(macros.c) },
    });
  });

  // ===== 写真の取得（Web版と同じ最大辺1280px・JPEG品質0.72に圧縮してAPIへ） =====
  async function compressToPayload(uri: string): Promise<{ uri: string; base64: string } | null> {
    try {
      const out = await manipulateAsync(uri, [{ resize: { width: 1280 } }], { compress: 0.72, format: SaveFormat.JPEG, base64: true });
      return out.base64 ? { uri: out.uri, base64: out.base64 } : null;
    } catch { return null; }
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setMsg({ ok: false, text: t('カメラの許可が必要です（設定アプリ→BodyLog）。') }); return; }
    // quality:1 は端末の最大解像度そのまま（48MP級）。デコードだけで数百MB使うため落としておく。
    // このあと1280pxへ縮小するので、取り込み段階の解像度は画質に影響しない
    const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (res.canceled || !res.assets?.length) return;
    const p = await compressToPayload(res.assets[0].uri);
    if (p) setPhotos((prev) => [...prev, p].slice(0, 4));
  }

  async function pickPhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg({ ok: false, text: t('写真ライブラリの許可が必要です（設定アプリ→BodyLog）。') }); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 4 - photos.length, quality: 0.8,
    });
    if (res.canceled || !res.assets?.length) return;
    // Promise.allだと4枚を同時にデコードしてしまい、高画素の写真ではメモリ不足で
    // アプリが強制終了する（JSの例外ではないので境界でも受けられない）。1枚ずつ処理する
    const list: { uri: string; base64: string }[] = [];
    for (const a of res.assets) {
      const p = await compressToPayload(a.uri);
      if (p) list.push(p);
      if (list.length >= 4 - photos.length) break;
    }
    setPhotos((prev) => [...prev, ...list].slice(0, 4));
  }

  // ===== バーコード→公式DB（Open Food Facts）: ヒットで品目をトレイに直接積む =====
  // 端末→OFF直の照会なのでAI枠は消費しない。未ヒットは成分表示写真（AI読み取り）へ案内する
  const [scanOpen, setScanOpen] = useState(false);

  async function scannedBarcode(jan: string) {
    const pid = ++pendingSeq.current;
    setPendingTexts((p) => [...p, { id: pid, text: t('バーコードを照会中…') }]);
    try {
      const fd = await lookupBarcode(jan);
      if (!fd) {
        // 未ヒット: 既存のカメラ撮影（成分表示→AI解析）へ1タップで進める
        Alert.alert(
          t('データベースに見つかりませんでした。成分表示の写真を撮ると正確に読み取れます。'), '',
          [
            { text: t('成分表示を撮る'), onPress: () => takePhoto() },
            { text: t('キャンセル'), style: 'cancel' },
          ],
        );
        return;
      }
      // 1品として投入。qtyは「1個」既定・内容量が取れたら1個ぶんのkcalを計算、
      // 取れなければ100gあたり（qty=100g。分量編集のg再計算がそのまま効く）
      const name = fd.brand ? `${fd.brand} ${fd.name}` : fd.name;
      const pkg = packageNutrition(fd);
      const item: FoodItem = pkg
        ? { name, qty: t('1個（{g}g）', { g: pkg.g }), kcal: pkg.kcal, p: pkg.p, f: pkg.f, c: pkg.c }
        : fd.serving && fd.serving.p != null && fd.serving.f != null && fd.serving.c != null
          ? { name, qty: fd.serving.size ? t('1個（{size}）', { size: fd.serving.size }) : t('1個'), kcal: fd.serving.kcal, p: fd.serving.p, f: fd.serving.f, c: fd.serving.c }
          : { name, qty: '100g', kcal: fd.per100g.kcal, p: fd.per100g.p, f: fd.per100g.f, c: fd.per100g.c };
      setParsed((p2) => ({
        items: [...(p2?.items ?? []), item],
        weight: p2?.weight ?? null, waist: p2?.waist ?? null,
        ex: p2?.ex ?? null, adj: p2?.adj ?? 0, mood: p2?.mood ?? null,
      }));
      setMsg({ ok: true, text: t('公式データベースの値でトレイに入れました。量を調整して✓保存してください。') });
    } finally {
      setPendingTexts((p) => p.filter((x) => x.id !== pid));
    }
  }

  // ===== ボトムドックからの送信: AI解析→トレイに積む（保存は✓保存で確定・連投可） =====
  const canSend = chat.trim().length > 0 || photos.length > 0;

  // ジョブ一覧の更新は必ずここを通す（画面・現在値・端末の3つを同時に合わせる）
  const putJobs = useCallback((fn: (l: ParseJob[]) => ParseJob[]) => {
    const next = fn(jobsRef.current);
    jobsRef.current = next;
    setJobs(next);
    saveJobs(next);
  }, []);

  // ジョブ1件を実行してトレイへ反映する。成功＝ジョブを消す／失敗＝失敗のまま残す（静かに消さない）
  const runJob = useCallback(async (job: ParseJob, imgs: QuickImage[]) => {
    try {
      const res = await analyzeFood(job.text, imgs, parseHistory.current);
      // 冪等の要: 再送中に旧い応答が返ってきても、先に着いた1回ぶんだけを反映する
      if (!claimOnce(settledRef.current, job.id)) return;
      if (!res.ok) {
        putJobs((l) => markFailed(l, job.id, res.error));
        // プラン上限だけは「プランを見る →」の導線が要るので画面のメッセージ欄にも出す
        if (res.upgrade) setMsg({ ok: false, text: res.error, upgrade: true, kind: res.kind });
        return;
      }
      const r = res.result;
      const ex2 = res.extras;
      // 会話の記憶は直近1往復だけ（古い文脈を引きずると誤解釈のもと）
      const aiSaid = [ex2.reply, ...ex2.questions].filter(Boolean).join(' ');
      parseHistory.current = [
        { role: 'user' as const, text: job.text },
        ...(aiSaid ? [{ role: 'ai' as const, text: aiSaid }] : []),
      ];
      // AIの一言。何も抽出できなかったときも、ここが必ず何か言う（無言の禁止）
      setAiNote(ex2.reply || ex2.questions.length || ex2.assumptions.length ? ex2 : null);
      // 食事の制約（B-18）のAI判定を溜める（複数回の解析ぶんが1つのトレイに合流するため）
      if (Object.keys(ex2.dietFlags).length > 0) setAiDietFlags((m) => ({ ...m, ...ex2.dietFlags }));
      const gotNothing = r.items.length === 0 && r.weight == null && r.waist == null && !r.ex && !r.mood;
      if (gotNothing && !ex2.reply) {
        setMsg({ ok: false, text: t('食事として読み取れませんでした。品目と量（例: キャベツ1/4玉）で書くか、相談は相談タブへどうぞ。') });
      }
      setParsed((p) => {
        const next = {
          items: [...(p?.items ?? []), ...r.items],
          weight: r.weight ?? p?.weight ?? null,
          waist: r.waist ?? p?.waist ?? null,
          ex: r.ex ?? p?.ex ?? null,
          adj: r.adj || p?.adj || 0,
          mood: r.mood ?? p?.mood ?? null,
        };
        // 何も載らないのに空のトレイ骨格を作らない
        if (p == null && next.items.length === 0 && next.weight == null && next.waist == null && !next.ex && !next.mood) return null;
        return next;
      });
      if (job.text && r.items.length > 0) setStagedNote((n) => (n ? `${n}、${job.text}` : job.text));
      putJobs((l) => removeJob(l, job.id));   // トレイに載ったのでジョブは役目を終える
    } catch {
      // analyzeFoodは例外を投げない作りだが、想定外の失敗でも送信を無かったことにしない
      if (!claimOnce(settledRef.current, job.id)) return;
      putJobs((l) => markFailed(l, job.id, t('通信に失敗しました。電波状況を確認してください。')));
    }
  }, [putJobs]);

  // 未完了ジョブを走らせる（復元・再試行の共通経路）。写真はURIから読み直す
  const resumeJob = useCallback(async (job: ParseJob) => {
    let imgs: QuickImage[] = [];
    if (job.photoUris.length > 0) {
      const got = await readPhotoPayloads(job.photoUris);
      if (!got) {
        // カメラの一時ファイルはOSがいつでも掃除する。再開できない旨を告げて捨てる
        putJobs((l) => removeJob(l, job.id));
        setMsg({ ok: false, text: t('写真の解析を再開できませんでした。もう一度撮影して送信してください。') });
        return;
      }
      imgs = got;
    }
    await runJob(job, imgs);
  }, [putJobs, runJob]);

  // マウント時: 端末に残った未完了ジョブを引き取る（アプリを閉じても解析が迷子にならない）
  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await loadJobs();
      if (!alive || stored.length === 0) return;
      const { resume, keep } = triageJobs(stored, todayJST(), Date.now());
      // 別の日のぶん・24時間より古いぶんは黙って捨てる（勝手に今日へ積まない）
      const kept = [...resume.map((j) => ({ ...j, state: 'running' as const, error: undefined })), ...keep];
      jobsRef.current = kept;
      setJobs(kept);
      saveJobs(kept);
      for (const j of resume) {
        if (!claimOnce(startedRef.current, j.id)) continue;
        resumeJob(j);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 解析中のあいだだけ1秒刻みで現在時刻を進める（8秒超えで「混み合っています」を添えるため）
  const hasRunningJob = jobs.some((j) => j.state === 'running');
  useEffect(() => {
    if (!hasRunningJob) return;
    setNowMs(Date.now());
    const h = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(h);
  }, [hasRunningJob]);

  async function sendQuick() {
    if (!canSend || !uid) return;
    const text = chat.trim();
    const imgs = photos.map((p) => ({ data: p.base64, mime: 'image/jpeg' }));
    const uris = photos.map((p) => p.uri);
    setChat(''); setPhotos([]); setMsg(null);
    // 送信できたことを指先で返す（AIの返事を待たずに次の行動へ移ってよい、という合図）
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    inputRef.current?.focus(); // キーボードを閉じずに次の入力へ（連投）
    const job = makeJob({ text, photoUris: uris, date: viewDate }, Date.now(), Math.random);
    putJobs((l) => addJob(l, job));
    claimOnce(startedRef.current, job.id);
    await runJob(job, imgs);   // 初回は手元のbase64をそのまま使う（ファイル読み直し不要）
  }

  // 失敗した送信をもう一度投げる（本人が押したときだけ関門を開け直す）
  async function retryJob(job: ParseJob) {
    releaseClaim(settledRef.current, job.id);
    releaseClaim(startedRef.current, job.id);
    const now = Date.now();
    putJobs((l) => markRunning(l, job.id, now));
    claimOnce(startedRef.current, job.id);
    await resumeJob({ ...job, state: 'running', error: undefined, createdAt: now });
  }

  // 失敗した送信を捨てる（本人の判断。勝手に消さないための対）
  function discardJob(job: ParseJob) {
    putJobs((l) => removeJob(l, job.id));
  }

  // マイ食品チップ: 長押しで「1回分をそのまま即記録」（トレイを経由しない最短経路）
  async function quickSaveFood(fd: MyFood) {
    if (!uid || saving) return;
    setSaving(true);
    try {
      const items = addServing([], fd);
      const r = await saveParsed(uid, {
        items, weight: null, waist: null, ex: null, adj: 0, mood: null,
      }, fd.name, viewDate, mealAt);   // 時刻はトレイのチップと同じ解決（過去日に現在時刻を入れない）
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setMsg({ ok: true, text: t('「{name}」を記録しました（長押しで即記録）', { name: fd.name }) });
      await load();
    } finally { setSaving(false); }
  }

  // マイ食品チップ: タップでトレイに積む（保存は✓保存で確定・−で減らせる）
  function tapFood(fd: MyFood) {
    const items = addServing(parsed?.items ?? [], fd);
    setParsed((p) => ({ items, weight: p?.weight ?? null, waist: p?.waist ?? null, ex: p?.ex ?? null, adj: p?.adj ?? 0, mood: p?.mood ?? null }));
  }
  // セット（複数品目のマイ食品）のチップ: タップでセットの全品目をトレイへ投入
  // （AI解析なし・保存済みの栄養値をそのまま使う＝「前の食事↺」と同じ流儀）
  function tapMeal(m: MyMeal) {
    Haptics.selectionAsync().catch(() => {});
    setParsed((p) => ({
      items: [...(p?.items ?? []), ...m.items],
      weight: p?.weight ?? null, waist: p?.waist ?? null,
      ex: p?.ex ?? null, adj: p?.adj ?? 0, mood: p?.mood ?? null,
    }));
  }

  // セットのチップ: 長押しで削除（確認ダイアログなし・Undoスナックバーで約5秒の取り消し猶予）。
  // 復元は削除前に控えた内容を新しい行として保存し直す（idはDB採番）
  async function deleteMealNow(m: MyMeal) {
    if (!uid) return;
    const ok = await deleteMyMeal(m.id);
    if (!ok) { setMsg({ ok: false, text: t('削除に失敗しました。もう一度お試しください。') }); return; }
    setMyMeals(await listMyMeals());
    undoBar.show(t('マイ食品「{name}」を削除しました', { name: m.name }), async () => {
      const r = await saveMyMeal(uid, m.name, m.items);
      if (!r.ok) { setMsg({ ok: false, text: t('元に戻せませんでした。通信環境を確認してください。') }); return; }
      setMyMeals(await listMyMeals());
    });
  }

  function decFood(fd: MyFood) {
    if (!parsed) return;
    const items = removeServing(parsed.items, fd);
    if (items.length === 0 && parsed.weight == null && !parsed.ex) setParsed(null);
    else setParsed({ ...parsed, items });
    setFocusItem(null);   // 品目が変わったら注目を解除（消えた品を指し続けないため）
  }

  // トレイの個別削除
  function removeTrayItem(i: number) {
    if (!parsed) return;
    const items = parsed.items.filter((_, j) => j !== i);
    if (items.length === 0 && parsed.weight == null && !parsed.ex) setParsed(null);
    else setParsed({ ...parsed, items });
    setFocusItem(null);   // 品目が変わったら注目を解除（消えた品を指し続けないため）
  }
  function clearTray() {
    setParsed(null); setStagedNote(''); setFocusItem(null); setMealTime(null);
    setAiNote(null); parseHistory.current = [];
    setAiDietFlags({});   // 制約の判定はこのトレイ限りのもの（次の解析に持ち越さない）
  }

  // 食べた時間のピッカーを開く。初期値は選択中の時刻（「いま」なら現在時刻）を15分刻みに丸めたもの
  function openTimePicker() {
    const now = new Date();
    const base = mealTimeResolved === MEAL_TIME_NOW ? null : parseHm(mealTimeResolved);
    const src = base ?? { h: now.getHours(), m: now.getMinutes() };
    const r = roundHm(src.h, src.m);
    const d = new Date(); d.setHours(r.h, r.m, 0, 0);
    setTimeDraft(d);
    setTimePickerOpen(true);
  }
  // ピッカーの値を 'H:mm' にしてチップの選択へ（端末ローカル時刻の時・分をそのまま使う＝
  // 表示中の日付とJSTで組むのは buildAtJST 側の仕事）
  function commitTime(d: Date) {
    setMealTime(fmtHm(d.getHours(), d.getMinutes()));
    Haptics.selectionAsync().catch(() => {});
  }

  // 量調整ポップ: 注目中の1品に倍率を適用してkcal/PFCを再計算する
  // （「半分だけ食べた」の1タップ補正。保存前のトレイ内だけで完結し、保存後は既存の書き換え機能）
  function adjustFocused(mult: number) {
    if (!parsed || focusItem == null || !parsed.items[focusItem]) return;
    Haptics.selectionAsync().catch(() => {});
    setParsed({ ...parsed, items: parsed.items.map((it, i) => (i === focusItem ? applyMult(it, mult) : it)) });
  }

  // 記録の長押しメニュー: 書き換え（トレイへ戻す）と削除。
  // 削除は「本当に？」を挟まず即実行し、Undoスナックバーで約5秒の取り消し猶予を出す
  // （確認ダイアログは毎回の手を止めるわりに誤タップ防止にならない。メニュー自体は残す）
  function confirmDeleteLog(l: DayLog) {
    const items = (l.items as FoodItem[] | null) ?? [];
    const canEdit = items.length > 0 || l.weight != null;
    Alert.alert(canEdit ? t('この記録をどうしますか？') : t('この記録を削除しますか？'), logTitle(l), [
      { text: t('キャンセル'), style: 'cancel' },
      ...(canEdit ? [{ text: t('書き換える'), onPress: () => startEditLog(l) }] : []),
      // マイ食品（セット）: 品目内訳のある食事だけ登録できる（気分・体重だけの行では出さない）
      ...(items.length > 0 ? [{ text: t('マイ食品に登録'), onPress: () => setMealDraft({ items, alsoSave: false }) }] : []),
      { text: t('削除する'), style: 'destructive' as const, onPress: () => deleteLogNow(l) },
    ]);
  }

  // 即削除＋Undo。復元データ（行の全カラム）は削除前にメモリへ控え、
  // 「元に戻す」で元のid無しで再insertする（idはDB採番・atは元の時刻のまま＝並びが崩れない）
  async function deleteLogNow(l: DayLog) {
    const restore = { ...(l as unknown as Record<string, unknown>) };
    delete restore.id;
    // 行が持つ日付でサマリーを合わせる（過去日の記録を消したときも正しい日が再集計される）
    const date = typeof restore.date === 'string' ? restore.date : viewDate;
    const { error } = await supabase.from('logs').delete().eq('id', l.id);
    // 削除APIが失敗したらスナックバーは出さず従来のエラーメッセージ
    if (error) { setMsg({ ok: false, text: t('削除に失敗しました。もう一度お試しください。') }); return; }
    if (uid) await syncEntriesForDate(uid, date);
    await load();
    undoBar.show(t('削除しました'), async () => {
      const { error: e2 } = await supabase.from('logs').insert(restore);
      if (e2) { setMsg({ ok: false, text: t('元に戻せませんでした。通信環境を確認してください。') }); return; }
      if (uid) await syncEntriesForDate(uid, date);
      await load();
    });
  }

  // 記録をトレイへ戻して編集状態にする（保存すると元の記録を置き換える）
  function startEditLog(l: DayLog) {
    const items = (l.items as FoodItem[] | null) ?? [];
    setParsed({
      items,
      weight: l.weight != null ? Number(l.weight) : null,
      waist: null,
      ex: (l.ex as ExLevel | null) ?? null,
      adj: Number(l.adj) || 0,
      mood: l.mood || null,
    });
    setStagedNote(typeof l.text === 'string' ? l.text : '');
    setFocusItem(null);
    setEditingId(l.id);
    // 元の記録の時刻を「食べた時間」の既定にする（置き換え保存で時刻が「いま」にずれない）
    setMealTime(hmJST(l.at));
    editingDateRef.current = viewDate;
    setMsg({ ok: true, text: t('下のトレイに戻しました。直して✓保存すると置き換わります。') });
  }

  // 編集をやめる（記録は元のまま残る）
  function cancelEdit() {
    setParsed(null); setStagedNote(''); setFocusItem(null); setEditingId(null); setMealTime(null);
    editingDateRef.current = null;
    setMsg(null);
  }

  // 記録から1品目だけを取り除く（合計は残りから再計算される）。
  // 確認は出さず即実行し、Undoで元のitems配列（と元の合計値）へ戻す
  async function deleteOneItem(l: DayLog, index: number) {
    const items = (l.items ?? []) as FoodItem[];
    // 復元データは削除前にメモリへ控える。最後の1品で行ごと消えるケースは行の全カラムで戻す
    const original = { items, kcal: l.kcal ?? null, p: l.p ?? null, f: l.f ?? null, c: l.c ?? null };
    const restoreRow = { ...(l as unknown as Record<string, unknown>) };
    delete restoreRow.id;
    const r = removeItemAt(items, index);
    const q = r.kind === 'delete'
      ? supabase.from('logs').delete().eq('id', l.id)
      : supabase.from('logs').update({ items: r.items, kcal: r.kcal, p: r.p, f: r.f, c: r.c }).eq('id', l.id);
    const { error } = await q;
    // 削除APIが失敗したらスナックバーは出さず従来のエラーメッセージ
    if (error) { setMsg({ ok: false, text: t('削除に失敗しました。もう一度お試しください。') }); return; }
    if (uid) await syncEntriesForDate(uid, viewDate);   // 日次サマリーを合わせる
    await load();
    undoBar.show(t('削除しました'), async () => {
      const { error: e2 } = r.kind === 'delete'
        ? await supabase.from('logs').insert(restoreRow)         // 行ごと消えた→id無しで再insert
        : await supabase.from('logs').update(original).eq('id', l.id);  // 品目だけ→元のitemsへ戻す
      if (e2) { setMsg({ ok: false, text: t('元に戻せませんでした。通信環境を確認してください。') }); return; }
      if (uid) await syncEntriesForDate(uid, viewDate);
      await load();
    });
  }

  // 過去の食事の品目一式を保存前確認へ投入（AI解析なし・栄養素は記録済みの値をそのまま使う）
  // 相談タブでAIが提案した献立を受け取ってトレイに載せる（確定は本人の✓保存）
  useFocusEffect(useCallback(() => {
    const items = consumePendingMeal();
    if (!items || items.length === 0) return;
    setParsed((p2) => ({
      items: [...(p2?.items ?? []), ...items],
      weight: p2?.weight ?? null, waist: p2?.waist ?? null,
      ex: p2?.ex ?? null, adj: p2?.adj ?? 0, mood: p2?.mood ?? null,
    }));
    setMsg({ ok: true, text: t('AIの献立をトレイに入れました。量を調整して✓保存してください。') });
  }, []));

  function reuseMeal(m: RecentMeal) {
    const items = [...(parsed?.items ?? []), ...m.items];
    setParsed((p) => ({ items, weight: p?.weight ?? null, waist: p?.waist ?? null, ex: p?.ex ?? null, adj: p?.adj ?? 0, mood: p?.mood ?? null }));
    setMsg({ ok: true, text: t('下のトレイに入れました。内容を確認して✓保存してください。') });
  }

  function titleOfItems(items: FoodItem[]): string {
    const names = items.slice(0, 3).map((it) => (it.qty && it.qty !== '×1' ? `${it.name} ${it.qty}` : it.name)).join('、');
    return names + (items.length > 3 ? t(' ほか{n}品', { n: items.length - 3 }) : '');
  }

  // トレイの内容を確定保存（成功したかを返す: セット同時登録の文言出し分けに使う）
  async function save(): Promise<boolean> {
    if (!uid || !parsed) return false;
    setSaving(true); setMsg(null);
    try {
      const items = parsed.items;   // setParsed(null)より前に控える（後段の学習で使う）
      // G8: AI解析で体重が載っているときも外れ値を確かめる（「52.8」を「528」と読む事故を保存前に止める）
      if (parsed.weight != null && !(await confirmOutlierWeight(latestWeight, Number(parsed.weight)))) {
        return false;   // トレイは残る。体重チップの×で外すか、値を直して再保存できる
      }
      // 食べた時間（トレイのチップ）。「いま」なら null → DBの now()。過去日は既定12:00か選んだ時刻が必ず入る
      const res = await saveParsed(uid, parsed, stagedNote, viewDate, mealAt);
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return false; }
      // 編集モードなら、新しい記録が入ったあとに元の記録を消す（この順なら失敗しても記録が消えない）
      let delFailed = false;
      if (editingId) {
        const { error } = await supabase.from('logs').delete().eq('id', editingId);
        if (error) delFailed = true;      // 新しい記録は入っているので、古い方が残ると二重になる
        else await syncEntriesForDate(uid, viewDate);
      }
      const wasEdit = editingId != null;
      // G2: 1回の食事が2,500kcal超のとき、保存後の一言だけを非審判の文言に差し替える
      // （赤の超過表示や計算はいじらない。過食直後の罪悪感で記録をやめさせないための一点）
      const savedKcal = items.length > 0 ? Math.round(sumItems(items).kcal) : 0;
      setParsed(null); setStagedNote(''); setFocusItem(null); setEditingId(null); setMealTime(null);
      editingDateRef.current = null;
      await load();
      setMsg(delFailed
        ? { ok: false, text: t('新しい内容は保存しましたが、元の記録を消せませんでした。重複した行を長押しで削除してください。') }
        : savedKcal > 2500
          ? { ok: true, text: t('記録できたこと自体が、大きな一歩です。明日、極端に減らす必要はありません。いつも通りで大丈夫。') }
          : { ok: true, text: wasEdit ? t('書き換えました。') : t('保存しました。') });

      invalidateStreak();   // 🔥チップを最新化
      refreshBadgeBand(true).catch(() => {});   // 保存で条件を満たしたバッジをその場で拾う
      // よく食べる食品の検出（保存が成功したときだけ学習する）
      try {
        await recordItems(items, viewDate);
        const s2 = await pickSuggestion(myFoods.map((f) => f.name), viewDate);
        if (s2) { setSuggest(s2); await markShown(viewDate); }
        else if (await shouldShowDietTip(dietProfile)) {
          // 食事の制約が未設定のまま解析を何度も使っている人にだけ、存在を知らせる
          setDietTip(true); await markDietTipShown();
        }
      } catch { /* 案内は本体機能に影響させない */ }
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function saveWeight() {
    // 入力は表示単位（kg/lb）。DBは常にkgで保存する
    const w = displayToKg(Number(wWeight), units.weight);
    if (!uid || !(w > 20 && w < 300)) { setMsg({ ok: false, text: t('体重の値を確認してください。') }); return; }
    // G8: 前回から±15%以上ずれた値は誤入力の可能性が高い。保存前に一度だけ確かめる
    if (!(await confirmOutlierWeight(latestWeight, w))) return;
    setSaving(true);
    try {
      await supabase.from('logs').insert({
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: Math.round(w * 10) / 10, ex: 'オフ', adj: 0, mood: '', text: '', photo_urls: [],
      });
      await syncEntriesForDate(uid, today);
      setWWeight('');
      await load();
      setMsg({ ok: true, text: t('体重 {w} を記録しました。', { w: fmtWeight(w) }) });
    } finally {
      setSaving(false);
    }
  }

  // ===== 週間・月間の収支（ヒーロー直下のカード） =====
  // 過去29日の日次サマリー（entries）＋今日はlogsの生値。維持kcalは当日の運動を含め、
  // 目標kcalは目標画面と同じ dailyAllowance（維持 − 赤字 + 調整）で日ごとに出す
  const [pastRows, setPastRows] = useState<{ date: string; intake: number | null; ex: string | null; adj: number | null }[]>([]);
  useEffect(() => {
    if (!profile) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from('entries').select('date,intake,ex,adj')
          .gte('date', shiftDate(today, -29)).lt('date', today)
          .order('date', { ascending: true });
        if (alive && data) setPastRows(data as typeof pastRows);
      } catch { /* ベストエフォート（カードは記録なし表示のまま） */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, today, dayLogs.length]);
  const balanceDays: BalanceDay[] = useMemo(() => {
    if (!profile) return [];
    const base = Math.round(bmr * Number(profile.life_factor));
    const req = plan ? plan.requiredDaily : 0;
    const byDate = new Map(pastRows.map((r) => [r.date, r]));
    const out: BalanceDay[] = [];
    for (let i = 29; i >= 1; i--) {
      const d = shiftDate(today, -i);
      const r = byDate.get(d);
      const maintenance = base + (r ? (EX_ADD[(r.ex as ExLevel) || 'オフ'] ?? 0) + (Number(r.adj) || 0) : 0);
      out.push({ date: d, intake: r?.intake == null ? null : Number(r.intake), maintenance, allowance: dailyAllowance(maintenance, req, Math.round(bmr), kcalAdjust) });
    }
    out.push({ date: today, intake: summary.intake == null ? null : Math.round(summary.intake), maintenance: target, allowance: goalKcal });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, pastRows, bmr, plan?.requiredDaily, kcalAdjust, today, summary.intake, target, goalKcal]);

  // ===== 過食リスクの事前検知（Web版と同一ロジック・AsyncStorageで今日1回スヌーズ） =====
  const [bingeRisk, setBingeRisk] = useState<BingeRisk | null>(null);
  // 今日のひとこと帯（データ由来・採点なし・その日は×で閉じられる）
  const [brief, setBrief] = useState<Brief | null>(null);
  useEffect(() => {
    if (!profile) return;
    (async () => {
      try {
        if (await AsyncStorage.getItem('bl-risk-snooze') === todayJST()) return;
        const t = todayJST();
        const { data } = await supabase.from('entries')
          .select('date,intake,p,ex,adj,mood,food_text')
          .gte('date', shiftDate(t, -28)).lt('date', t)
          .order('date', { ascending: true });
        if (!data || data.length < 5) return; // データが薄いうちは主張しない
        const base = Math.round(mifflinBMR(profile.sex, weightForBmr, Number(profile.height_cm), Number(profile.age)) * Number(profile.life_factor));
        const days: InsightDay[] = data.map((r) => {
          const dayTarget = base + (EX_ADD[(r.ex as ExLevel) || 'オフ'] ?? 0) + (Number(r.adj) || 0);
          const intake = r.intake == null ? null : Number(r.intake);
          return {
            date: String(r.date), intake,
            p: r.p == null ? null : Number(r.p),
            diff: intake == null ? null : Math.round(intake - dayTarget),
            mood: r.mood as string | null, text: r.food_text as string | null,
          };
        });
        const risk = assessBingeRisk(days, new Date(t + 'T00:00:00').getDay());
        if (risk.level !== 'low') setBingeRisk(risk);

        // 今日のひとこと帯（オフ設定・その日クローズ済みなら出さない）
        if ((await AsyncStorage.getItem('bl-brief-off')) !== '1'
          && (await AsyncStorage.getItem('bl-brief-closed')) !== t) {
          const { data: wRows } = await supabase.from('entries')
            .select('date,weight').not('weight', 'is', null)
            .gte('date', shiftDate(t, -28)).order('date', { ascending: true });
          const readRaw = await AsyncStorage.getItem('bl-columns-read');
          const read = new Set<string>(readRaw ? JSON.parse(readRaw) as string[] : []);
          const unread = getColumns().find((c) => !read.has(c.id)) ?? null;
          setBrief(buildDailyBrief(
            days,
            new Date(t + 'T00:00:00').getDay(),
            ((wRows ?? []) as { date: string; weight: number }[]),
            unread ? { title: unread.title, minutes: unread.minutes, lead: unread.lead } : null,
            Math.floor(Date.parse(t) / 86400000),
          ));
        }
      } catch { /* ベストエフォート */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // ===== B-7: Day12「最初の法則」の帯 =====
  // 記録12日到達＋法則1件以上を初検出したら、21:05の通知予約＋この帯を一度きり出す。
  // 判定・永続化はlib/laws側（'bl-day12-done'）。帯はタップ/×で消化され、以後は出ない
  const [firstLaw, setFirstLaw] = useState(false);
  useEffect(() => {
    checkFirstLawUnlock(scheduleFirstLawNotification).then(setFirstLaw).catch(() => {});
  }, []);
  function dismissFirstLaw(goSee: boolean) {
    consumeFirstLawBanner().catch(() => {});
    setFirstLaw(false);
    if (goSee) {
      Haptics.selectionAsync().catch(() => {});
      router.push('/laws' as never);
    }
  }

  // ===== バッジ獲得の帯 =====
  // 「獲得に気づけない」が最大の不満だったため、実績ページを開いていなくても
  // 食事タブで一度だけ知らせる（×またはタップで消化。判定はmaybeEvaluateBadgesが間隔付きで走る）
  const [badgeIds, setBadgeIds] = useState<string[]>([]);
  const refreshBadgeBand = useCallback(async (force = false) => {
    try {
      await maybeEvaluateBadges(force);
      setBadgeIds(await peekBadgeBanner());
    } catch { /* 帯が出ないだけ */ }
  }, []);
  // 画面に戻るたびに読み直す（実績ページで見たら帯は消えている）
  useFocusEffect(useCallback(() => { refreshBadgeBand(); }, [refreshBadgeBand]));
  function dismissBadgeBand(goSee: boolean) {
    consumeBadgeBanner().catch(() => {});
    setBadgeIds([]);
    if (goSee) {
      Haptics.selectionAsync().catch(() => {});
      router.push('/achievements' as never);
    }
  }

  // ===== 気づきアラート（§8）: 食事タブを開くたびに判定（特徴量は15分TTLのキャッシュ・保存後はsyncが無効化） =====
  // caution は既存の過食リスクカードと1枚に統合（二重に出さない）。positive は控えめな別カード。最大2枚
  const [insightAlerts, setInsightAlerts] = useState<InsightAlertState>({ cards: [], insightsById: new Map(), all: [] });
  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const st = await loadInsightAlerts();
      if (!alive) return;
      setInsightAlerts(st);
      // 朝の通知（smartのときだけ・1日1件・cautionのみ）。食事タブは起動時の最初のタブなので「起動時判定」を兼ねる
      maybeScheduleMorningNotification(st.all).catch(() => {});
    })();
    return () => { alive = false; };
  }, []));
  const cautionAlert: InsightAlert | null = insightAlerts.cards.find((a) => a.tone === 'caution') ?? null;
  const positiveAlerts = insightAlerts.cards.filter((a) => a.tone === 'positive');
  async function closeAlert(a: InsightAlert) {
    await closeInsightAlert(a.id);
    setInsightAlerts((prev) => ({ ...prev, cards: prev.cards.filter((c) => c.id !== a.id) }));
  }
  // 「この法則の解説を読む →」: ルール → 図鑑の kind（laws.tsx の openDetail と同じパラメータ）
  function openAlertLaw(a: InsightAlert) {
    const link = lawLinkForAlert(a, insightAlerts.insightsById.get(a.ruleId));
    if (!link) return;
    Haptics.selectionAsync().catch(() => {});
    router.push({ pathname: '/law-detail', params: { kind: link.kind, p: JSON.stringify(link.p), at: today } } as never);
  }

  // 統合カードの「気をつける」「+200kcal緩める」は、既存の過食リスクと今日の気づき（caution）をまとめて閉じる
  async function snoozeRisk() {
    try { await AsyncStorage.setItem('bl-risk-snooze', todayJST()); } catch { /* 無視 */ }
    setBingeRisk(null);
    if (cautionAlert) await closeAlert(cautionAlert);
  }

  // 1タップ予防: 今日だけ目標を+200kcal緩める（チートデイ吸収の仕組みに乗せる）
  async function addRecoveryEvent() {
    if (!uid) return;
    const { data: ev, error } = await supabase.from('events')
      .insert({ user_id: uid, date: today, title: t('🕊 リカバリー枠'), extra_kcal: 200 })
      .select('id,date,title,extra_kcal').single();
    if (error) { setMsg({ ok: false, text: t('設定に失敗しました。もう一度お試しください。') }); return; }
    setEvents((prev) => [...prev, ev as PlanEvent & { id: string }]);
    await snoozeRisk();
    setMsg({ ok: true, text: t('🕊 今日の目標を+200kcal緩めました。我慢しすぎないことが、結局いちばん速いです。') });
  }

  // ===== 昨日の穴埋め（未記録の爆食日を翌日に低摩擦で回収する・Web版と同一） =====
  // 文言は「昨日」ではなく実日付で言う。過去日を表示中のユーザーには
  // 「昨日」がどの日を指すのか分からなくなるため（βフィードバック 2026-08-30）
  const [backfill, setBackfill] = useState<{ date: string; binge: boolean } | null>(null);
  function dateLabelOf(date: string): string {
    const [yy, mm, dd] = date.split('-').map(Number);
    const wd = [t('日'), t('月'), t('火'), t('水'), t('木'), t('金'), t('土')];
    return t('{m}/{d}({w})', { m: mm, d: dd, w: wd[new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay()] });
  }
  // 「くわしく記録する」: その日へ移動して通常の入力ドック（つぶやき/写真/バーコード）で
  // 品目まで入れられるようにする。手軽さ（±0/食べすぎたの2択）はそのまま残す
  function backfillDetail() {
    if (!backfill) return;
    setViewDate(backfill.date);
    setBackfill(null); // 詳しく書きにいくので帯は畳む（未記録のままなら次回起動でまた出る）
    setTimeout(() => inputRef.current?.focus(), 400);
  }
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMore, setBackfillMore] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const t = todayJST();
        if (await AsyncStorage.getItem('bl-backfill-snooze') === t) return;
        const y = shiftDate(t, -1);
        const [entRes, firstRes, logRes] = await Promise.all([
          supabase.from('entries').select('intake,mood,food_text').eq('date', y).maybeSingle(),
          supabase.from('entries').select('date').order('date', { ascending: true }).limit(1),
          supabase.from('logs').select('id').eq('date', y).not('kcal', 'is', null).limit(1),
        ]);
        // 取得に1つでも失敗したら出さない（誤って「記録なし」と言うほうが害が大きい）
        if (entRes.error || firstRes.error || logRes.error) return;
        const e = entRes.data;
        const first = firstRes.data;
        if (!first || first.length === 0 || first[0].date > y) return; // 始めたばかり
        if (e?.intake != null) return; // 日次サマリーに食事あり
        if ((logRes.data?.length ?? 0) > 0) return; // 生ログに食事あり（サマリー同期ズレでも出さない）
        const binge = detectStruggle([String(e?.mood || ''), String(e?.food_text || '')]) === 'binge';
        setBackfill({ date: y, binge });
      } catch { /* 穴埋めは本体機能に影響させない */ }
    })();
  }, []);

  async function backfillSave(extra: number) {
    if (!backfill || !profile || !uid || backfillBusy) return;
    setBackfillBusy(true);
    try {
      const baseEst = Math.round(mifflinBMR(profile.sex, weightForBmr, Number(profile.height_cm), Number(profile.age)) * Number(profile.life_factor));
      const { error } = await supabase.from('logs').insert({
        user_id: uid, date: backfill.date, at: `${backfill.date}T21:00:00+09:00`,
        items: [], kcal: baseEst + extra, p: null, f: null, c: null, weight: null,
        ex: 'オフ', adj: 0, mood: '',
        text: extra > 0 ? `（あとから概算: 食べすぎ +${extra}kcal）` : t('（あとから確定: だいたい目安どおり）'),
        photo_urls: [],
      });
      if (error) { setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') }); return; }
      await syncEntriesForDate(uid, backfill.date);
      setBackfill(null);
      setMsg({
        ok: true,
        text: extra > 0
          ? t('{date}を「食べすぎ +{n}kcal」として記録しました。今日から立て直しましょう！', { date: dateLabelOf(backfill.date), n: extra.toLocaleString() })
          : t('{date}を「目安どおり（±0）」で確定しました。', { date: dateLabelOf(backfill.date) }),
      });
    } finally {
      setBackfillBusy(false);
    }
  }

  // 朝の気分カード: その日まだ気分が無ければ1タップで聞く（スキップはその日限り）
  const [moodSnoozed, setMoodSnoozed] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem('bl-mood-snooze').then((v) => setMoodSnoozed(v === todayJST())).catch(() => {});
  }, []);
  const [moodBusy, setMoodBusy] = useState(false);
  const hasMoodToday = dayLogs.some((l) => l.mood);
  const showMood = viewDate === todayJST() && profile != null && !hasMoodToday && !moodSnoozed;
  async function saveMood(n: number) {
    if (!uid || moodBusy) return;
    setMoodBusy(true);
    try {
      await saveParsed(uid, { items: [], weight: null, waist: null, ex: null, adj: 0, mood: `${n}/5` }, '', viewDate);
      await load();
    } finally { setMoodBusy(false); }
  }
  function moodSnooze() {
    AsyncStorage.setItem('bl-mood-snooze', todayJST()).catch(() => {});
    setMoodSnoozed(true);
    // 「今日は聞かないで」の意思は通知にも波及させる（今夜のリマインダーも黙る）
    skipTodayReminder().catch(() => {});
  }

  async function backfillSnooze() {
    try { await AsyncStorage.setItem('bl-backfill-snooze', todayJST()); } catch { /* 無視 */ }
    setBackfill(null);
  }


  const parsedTotal = parsed ? sumItems(parsed.items) : null;

  // ===== 食事の制約（B-18・docs/DIET-MODES.md §2 / §4 / §5） =====
  // 端末内の辞書判定（無料・オフラインでも動く）とAIのdietFlag（スタンダード以上）を合成する。
  // 警告は情報提供だけ: 保存はブロックしない・触覚も音も鳴らさない（不安を煽らないため）
  const dietProfile = useDiet();
  const dietGate = useGate();
  const dietPremium = !dietGate.gated('diet');
  const dietRules = useMemo(() => rulesFor(dietProfile.modes), [dietProfile.modes]);
  const dietAlerts: DietAlert[] = useMemo(() => {
    if (parsed == null || isDietOff(dietProfile)) return [];
    return mergeAlerts({
      // 分量文字列も判定に混ぜる（「(小麦粉入り)」のような但し書きを拾えるように）
      items: parsed.items.map((it) => ({ name: it.name, text: it.qty })),
      rules: dietRules, aiFlags: aiDietFlags, premium: dietPremium,
    });
  }, [parsed, dietProfile, dietRules, aiDietFlags, dietPremium]);
  // 品目チップの印を引くための索引（品目名→強さ）
  const dietLevelByName = useMemo(() => {
    const m = new Map<string, DietLevel>();
    for (const a of dietAlerts) if (!(m.get(a.name) === 'high')) m.set(a.name, a.level);
    return m;
  }, [dietAlerts]);
  // 制約を設定している人には、警告が無いときでも常設表記を出す（沈黙を保証と誤読させない・§6-4）
  const dietOn = !isDietOff(dietProfile);

  // 保存前ライブプレビュー: トレイ（未保存）の合計。バーのゴースト表示に使う
  const pulse = usePulse(parsed != null);
  // トレイで注目している食品（バー上でその寄与だけを光らせる）
  const [focusItem, setFocusItem] = useState<number | null>(null);
  // 編集中の記録ID: セットされている間、✓保存はこの記録を置き換える（新規追加ではない）
  const [editingId, setEditingId] = useState<string | null>(null);
  // 「食べた時間」チップ（§4）。null=未操作（今日なら「いま」・過去日なら12:00に解決）／'now'／'H:mm'。
  // 選んだ時刻は logs.at にクライアントから明示的に入れる（DB now() 任せだと過去日に嘘の時刻が入る）
  const [mealTime, setMealTime] = useState<string | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timeDraft, setTimeDraft] = useState<Date>(new Date());   // ピッカー内の仮の値（iOSは「決定」で確定）
  const isViewToday = viewDate === todayJST();
  const mealTimeResolved = resolveMealTime(mealTime, isViewToday);
  // 保存に使う at。「いま」は送らずDBの now() に任せる（いちばん正確）
  const mealAt = mealTimeResolved === MEAL_TIME_NOW ? null : buildAtJST(viewDate, mealTimeResolved);
  // よく食べる食品の登録案内（保存後に1件だけ出す）
  const [suggest, setSuggest] = useState<Suggestion | null>(null);
  // 食事の制約（除外アラート）の存在を知らせる案内。
  // 設定の奥にあって気づかれないので、未設定＋AI解析3回以上の人に**1回だけ**出す。
  // マイ食品の案内とは同時に出さない（Modalが重なる）ので、そちらが出ない回に譲る。
  const [dietTip, setDietTip] = useState(false);
  // 品目単位で操作するために展開している記録行（1回の食事＝1レコードのまま、中身を開く）
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [foodDraft, setFoodDraft] = useState<MyFoodDraft | null>(null);
  const chipsRef = useRef<View | null>(null);   // 案内でハイライトする対象
  // 編集を始めた日付。表示日を動かしたら編集を打ち切る（記録が別の日へ移るのを防ぐ）
  const editingDateRef = useRef<string | null>(null);
  useEffect(() => {
    // 日付を動かしたら時刻の選択は既定に戻す（今日=「いま」・過去日=12:00 は日付ごとに解決し直す）
    setMealTime(null);
    if (editingId && editingDateRef.current && editingDateRef.current !== viewDate) {
      setParsed(null); setStagedNote(''); setFocusItem(null); setEditingId(null);
      editingDateRef.current = null;
      setMsg({ ok: false, text: t('日付を移動したので書き換えを取り消しました。記録はそのまま残っています。') });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate]);
  const focused = focusItem != null ? parsed?.items[focusItem] ?? null : null;
  // 注目中の1品と、それ以外に分けた寄与量
  const split = (key: 'kcal' | 'p' | 'f' | 'c') => {
    const all = parsedTotal ? Math.round(parsedTotal[key]) : 0;
    const fv = focused ? Math.round(Number(focused[key]) || 0) : 0;
    return { others: Math.max(0, all - fv), focus: fv };
  };
  const stagedK = parsedTotal ? Math.round(parsedTotal.kcal) : 0;
  const stagedP = parsedTotal ? Math.round(parsedTotal.p) : 0;
  const stagedF = parsedTotal ? Math.round(parsedTotal.f) : 0;
  const stagedC = parsedTotal ? Math.round(parsedTotal.c) : 0;

  // 目標を「超える瞬間」に一度だけ振動（超えっぱなしでは鳴らさない）
  const prevOverRef = useRef('');
  useEffect(() => {
    if (!macros) return;
    const overs = [
      eatenP + stagedP > macros.p ? 'p' : '',
      eatenF + stagedF > macros.f ? 'f' : '',
      eatenC + stagedC > macros.c ? 'c' : '',
    ].join('');
    if (stagedK > 0 && overs.length > prevOverRef.current.length) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    prevOverRef.current = overs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedP, stagedF, stagedC]);

  // キーボード追従はKAVをやめreanimatedのUIスレッド追従に（βフィードバック 2026-09-02:
  // 日本語IMEの候補バーが1打鍵ごとに高さを変え、KAVの再レイアウトで画面全体が揺れる＋
  // タブバー高さぶん過剰に持ち上がってドック下に無駄な空白が出ていた）
  const kb = useAnimatedKeyboard();
  const dockLift = useAnimatedStyle(() => ({
    // 端末下端からの持ち上げ量。ドック自体が insets.bottom を持っているのでその分は相殺
    transform: [{ translateY: -Math.max(kb.height.value - insets.bottom, 0) }],
  }));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        ref={scrollRef}
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(e) => { scrollYNow.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={32}
      >
        <Animated.View style={[s.brandRow, enter[0], { justifyContent: 'space-between', marginRight: 38 }]}>
          <Text style={s.pageTitle}>{t('食事')}</Text>
          {editing ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Pressable onPress={() => setAddOpen(true)} style={s.addBtn} hitSlop={8}>
                <Plus size={ICON.md} color="#fff" strokeWidth={ICON.strokeBold} />
              </Pressable>
              <Pressable onPress={() => setEditing(false)} style={s.doneBtn} hitSlop={8}>
                <Text style={s.doneBtnT}>{t('完了')}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onLongPress={() => setEditing(true)} delayLongPress={450}>
              <DateStrip value={viewDate} onChange={setViewDate} />
            </Pressable>
          )}
        </Animated.View>

        {/* 🔥ストリーク常設チップ（タップで実績ページへ） */}
        <StreakChip />

        {/* B-7: 最初の法則の帯（一度きり。タップで法則図鑑へ・×は見ずに消化） */}
        {firstLaw && (
          <Pressable style={s.lawBand} onPress={() => dismissFirstLaw(true)}>
            <BookOpen size={16} color={C.teal} />
            <Text style={s.lawBandT}>{t('あなたの最初の法則が見つかりました')}</Text>
            <Text style={s.lawBandGo}>{t('見にいく')} →</Text>
            <Pressable hitSlop={10} onPress={() => dismissFirstLaw(false)}>
              <Text style={s.lawBandX}>×</Text>
            </Pressable>
          </Pressable>
        )}

        {/* 今日のひとこと帯（ヘッダーとヒーローの間・タップで展開・×でその日は閉じる） */}
        {brief && (
          <DailyBrief brief={brief} onClose={() => {
            setBrief(null);
            AsyncStorage.setItem('bl-brief-closed', todayJST()).catch(() => {});
          }} />
        )}

        {/* ヒーロー */}
        {vis('hero') && profile && (
          <Animated.View style={[s.hero, enter[1]]} ref={heroTarget} collapsable={false}>
            <MinusBadge editing={editing} onPress={() => cards.hide('hero')} />
            <Text style={s.heroL}>
              {isBulk
                // 増量: 残量はタスク（あと食べる）、使い切りは達成。減量の「オーバー赤」を出さない
                ? (left > 0 ? t('増量ノルマ・あと食べる') : t('今日のぶんは食べきった 🎉'))
                : overLv === 'none' ? t('あと食べられる')
                : overLv === 'mild' ? t('少し多め')
                : overLv === 'mid' ? t('多め。週で調整できます')
                : t('かなり多め')}
              {plan ? t('（計画）') : t('（維持）')}
            </Text>
            {/* ヒーローの大数字は文字サイズ拡大で崩れやすいため上限1.3（本文系は制限しない） */}
            <Text style={[s.heroN, isBulk ? { color: left > 0 ? C.amber : C.teal } : overColor != null && { color: overColor }]}
                  maxFontSizeMultiplier={1.3}>
              {Math.abs(heroLeft).toLocaleString()}<Text style={s.heroU}> kcal</Text>
            </Text>
            <View style={[s.hline, { flexDirection: 'row' }]}>
              <View style={[s.hfill, { width: `${previewFill(eaten, 0, goalKcal).basePct}%` }, left < 0 && { backgroundColor: isBulk ? C.teal : overBar }]} />
              <GhostPair eaten={eaten} others={split('kcal').others} focus={split('kcal').focus}
                         target={goalKcal} color={C.calorieBar} pulse={pulse} />
            </View>
            <View style={s.heroMeta}>
              <Text style={s.metaT}>{t('摂取')} {eaten.toLocaleString()}</Text>
              {/* 目標の数字から統合目標画面へ直行（P/F/Cバーのタップと同じ導線）。小さく「目標を調整 ›」で発見性を担保 */}
              <Pressable onPress={openGoalHub} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={s.metaT}>{t('目標')} <Text style={s.metaGoalN}>{goalKcal.toLocaleString()}</Text></Text>
                <Text style={s.metaAdjust}>{t('目標を調整')} ›</Text>
              </Pressable>
            </View>
            {/* 目標を黙って増やさない: アクティブ反映ONで上乗せが起きた日だけ内訳を1行出す。
                「なぜ今日は多いのか」が分からない増加はアプリへの信頼を削る */}
            {activeBonus > 0 && (
              <Text style={s.heroActive}>
                {heroBurn.source === 'steps'
                  ? t('歩いたぶん（推定） +{n}kcal', { n: activeBonus.toLocaleString() })   // 歩数からの推定＝実測と同じ顔をさせない
                  : t('歩いたぶん +{n}kcal', { n: activeBonus.toLocaleString() })}
              </Text>
            )}
            {/* 残りPFCプログレスバー（英字P/F/Cは初心者に伝わらないため日本語を主・英字は補助） */}
            {macros && (
              <View style={{ marginTop: 10, gap: 5 }}>
                {([
                  [PFC_LABEL.p, 'P', eatenP, macros.p, pfcColors().p, 'p'],
                  [PFC_LABEL.f, 'F', eatenF, macros.f, pfcColors().f, 'f'],
                  [PFC_LABEL.c, 'C', eatenC, macros.c, pfcColors().c, 'c'],
                ] as const).map(([ja, ab, eat, tgt, col, key]) => {
                  const over = eat > tgt;
                  // 増量ではPが主役: 埋まるのは良いこと（超過を赤にしない）＋達成率を小さく強調
                  const bulkP = isBulk && key === 'p';
                  // 食事ごとの寄与（バーに区切り線を引き、どの食事でどれだけ摂ったか見えるように）
                  const segs = dayLogs
                    .filter((l) => l.kcal != null && Number(l[key] ?? 0) > 0)
                    .map((l) => (Number(l[key]) / Math.max(1, tgt)) * 100);
                  const total = segs.reduce((a, b) => a + b, 0);
                  const scale = total > 100 ? 100 / total : 1;  // 超過時は全体を100%に収める
                  return (
                    <Pressable key={ab} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                               onPress={openGoalHub}>
                      <Text style={s.pfcL} numberOfLines={1}>{t(ja)}<Text style={s.pfcAb}> {ab}</Text></Text>
                      <View style={[s.pfcBar, { flexDirection: 'row' }]}>
                        {segs.length > 0 && segs.length <= 5 ? segs.map((w, i) => (
                          <View key={i} style={{
                            width: `${w * scale}%`, height: '100%',
                            backgroundColor: over ? (bulkP ? col : C.coral) : col,
                            // 区切り線はバーの下地（カード面）と同化させる。白固定だとダークで光る線になる
                            borderRightWidth: i < segs.length - 1 ? 1.5 : 0, borderRightColor: C.panel,
                          }} />
                        )) : (
                          <View style={[s.pfcFill, { width: `${Math.min(100, (eat / Math.max(1, tgt)) * 100)}%`, backgroundColor: over ? (bulkP ? col : C.coral) : col }]} />
                        )}
                        <GhostPair eaten={eat} others={split(key).others} focus={split(key).focus}
                                   target={tgt} color={col} pulse={pulse} />
                      </View>
                      {bulkP ? (
                        <Text style={[s.pfcT, { fontWeight: '800', color: eat >= tgt ? C.teal : C.ink }]}>
                          {t('{n}%達成', { n: Math.min(999, Math.round((eat / Math.max(1, tgt)) * 100)) })}
                        </Text>
                      ) : (
                        <Text style={[s.pfcT, over && { color: C.coral }]}>{over ? t('+{n}g超過', { n: eat - tgt }) : t('あと{n}g', { n: tgt - eat })}</Text>
                      )}
                    </Pressable>
                  );
                })}
                {/* 数字を「次の行動」に翻訳する一言（初心者がPFCの意味を調べなくても動ける） */}
                <View style={s.adviceBox}>
                  <Text style={s.adviceT}>
                    {pfcAdvice({ p: macros.p - eatenP, f: macros.f - eatenF, c: macros.c - eatenC, kcal: left })}
                  </Text>
                </View>
              </View>
            )}
          </Animated.View>
        )}

        {/* 週間・月間の収支カード: 「体重は1日ではなく週と月の合計で決まる」を数字で見せる。
            目標の週間赤字は目標画面の算出値（computePlan.requiredDaily）と同じ物差し */}
        {vis('balance') && profile && (
          <Animated.View style={[s.card, enter[1]]}>
            <MinusBadge editing={editing} onPress={() => cards.hide('balance')} />
            <BalanceCard days={balanceDays} perDayDeficit={plan ? plan.requiredDaily : 0} isBulk={isBulk} />
          </Animated.View>
        )}

        {/* バッジ獲得の帯（ヒーロー直下・一度きり。タップで実績ページへ・×は見ずに消化）。
            B-7の法則の帯と同じ「帯」の文法（面・枠・→の位置）を共有する */}
        {badgeIds.length > 0 && (
          <Pressable style={[s.lawBand, { marginTop: -8 }]} onPress={() => dismissBadgeBand(true)}>
            <BadgeIcon id={badgeIds[0]} size={30} earned />
            <Text style={s.lawBandT} numberOfLines={2}>
              {badgeIds.length > 1
                ? t('{n}つのバッジを獲得しました', { n: badgeIds.length })
                : t('「{name}」バッジを獲得しました', { name: badgeById(badgeIds[0])?.name ?? '' })}
            </Text>
            <Text style={s.lawBandGo}>{t('見にいく')} →</Text>
            <Pressable hitSlop={10} onPress={() => dismissBadgeBand(false)}>
              <Text style={s.lawBandX}>×</Text>
            </Pressable>
          </Pressable>
        )}

        {/* スタートチェックリスト（新規ユーザーの最初の1週間・登録14日以内だけ・自動判定） */}
        {vis('checklist') && (
          <StartChecklist
            editing={editing}
            onHide={() => cards.hide('checklist')}
            onFocusInput={() => inputRef.current?.focus()}
            onTakePhoto={takePhoto}
            onFocusWeight={() => wInputRef.current?.focus()}
            refreshKey={dayLogs.length}
          />
        )}

        {/* 昨日の穴埋めカード（責めないトーン） */}
        {backfill && (
          <View style={[s.card, { borderColor: C.amber, borderWidth: 1.5 }]}>
            <Text style={s.h2}>{backfill.binge
              ? t('🍃 {date}の分、ざっくりだけ記録しませんか', { date: dateLabelOf(backfill.date) })
              : t('📝 {date}の食事記録がありません', { date: dateLabelOf(backfill.date) })}</Text>
            <Text style={s.mutedT}>
              {backfill.binge
                ? t('食べすぎた日ほど、記録すると立て直しが速くなります。ざっくりでOK。誰にも見られません。')
                : t('ざっくりでOKです。未記録の日が続くと、収支の数字と現実が少しずつズレていきます。')}
            </Text>
            {!backfillMore ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <OptionButton style={{ flex: 1 }} label={t('目安どおり（±0）')} onPress={() => backfillSave(0)} busy={backfillBusy} />
                <OptionButton style={{ flex: 1 }} variant="tonal" label={t('食べすぎた…')} onPress={() => setBackfillMore(true)} disabled={backfillBusy} />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {[500, 1000, 2000].map((n) => (
                  <Chip key={n} label={t('+{n}kcal くらい', { n: n.toLocaleString() })} tone="ink" disabled={backfillBusy} onPress={() => backfillSave(n)} />
                ))}
              </View>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 22, marginTop: 10 }}>
              <Pressable onPress={backfillDetail} hitSlop={8} disabled={backfillBusy}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: C.accentInk, textDecorationLine: 'underline' }}>{t('くわしく記録する')}</Text>
              </Pressable>
              <Pressable onPress={backfillSnooze} hitSlop={8}>
                <Text style={[s.mutedT, { textDecorationLine: 'underline' }]}>{t('あとで')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* 過食リスクの事前アラート（理由つき・1タップ予防）。
            §8 気づきアラート（caution）が出た日はこの1枚に統合する: 見出しは「条件が{n}つそろっています」、
            箇条書きは本人の法則の条件（＋従来の理由）、ボタンは従来どおり、末尾に法則の解説へのリンク */}
        {(bingeRisk || cautionAlert) && (
          <View style={[s.card, { borderColor: bingeRisk?.level === 'high' ? C.coral : C.amber, borderWidth: 1.5 }]}>
            <View style={s.alertHead}>
              <Text style={[s.h2, { flex: 1, marginBottom: 0 }]}>
                {cautionAlert
                  ? t('今日は食べすぎが起きやすい条件が{n}つそろっています', { n: cautionAlert.factors.length })
                  : bingeRisk?.level === 'high' ? t('🌪 今日は食欲が爆発しやすい状態です') : t('🌤 今日は食欲が乱れやすいかも')}
              </Text>
              <Pressable hitSlop={10} onPress={snoozeRisk} accessibilityRole="button" accessibilityLabel={t('今日は閉じる')}>
                <Text style={s.alertX}>×</Text>
              </Pressable>
            </View>
            {cautionAlert?.factors.map((f) => (
              <Text key={f} style={[s.mutedT, { lineHeight: 20 }]}>・{f}</Text>
            ))}
            {bingeRisk?.reasons.filter((r) => !cautionAlert?.factors.includes(r.text)).map((r) => (
              <Text key={r.key} style={[s.mutedT, { lineHeight: 20 }]}>・{r.text}</Text>
            ))}
            {cautionAlert && (
              <Text style={s.alertNote}>{t('あなたの記録から見つかった法則にもとづく予報です（相関であり、原因とは限りません）')}</Text>
            )}
            <Text style={[s.mutedT, { marginTop: 6 }]}>
              {t('これは失敗のサインではなく、準備のサインです。たんぱく質多めの食事と「我慢しすぎない設定」が効きます。')}
            </Text>
            {plan && !todayEvent ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <OptionButton style={{ flex: 1 }} variant="teal" label={t('🕊 今日は+200kcal緩める')} onPress={addRecoveryEvent} />
                <OptionButton style={{ flex: 1 }} variant="tonal" label={t('大丈夫、気をつける')} onPress={snoozeRisk} />
              </View>
            ) : (
              <OptionButton style={{ marginTop: 10 }} variant="tonal" label={t('OK、気をつける')} onPress={snoozeRisk} />
            )}
            {cautionAlert && lawLinkForAlert(cautionAlert, insightAlerts.insightsById.get(cautionAlert.ruleId)) && (
              <Pressable onPress={() => openAlertLaw(cautionAlert)} hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: 10 }}
                         accessibilityRole="link">
                <Text style={s.alertLink}>{t('この法則の解説を読む →')}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* §8 ポジティブ側の気づき: 良い条件がそろった日は背中を押す（控えめなアクセント面・ボタン無し・×で今日は閉じる） */}
        {positiveAlerts.map((a) => (
          <View key={a.id} style={s.positiveCard}>
            <View style={s.alertHead}>
              <Sparkles size={16} color={C.teal} />
              <Text style={s.positiveTitle}>{a.text}</Text>
              <Pressable hitSlop={10} onPress={() => closeAlert(a)} accessibilityRole="button" accessibilityLabel={t('今日は閉じる')}>
                <Text style={s.alertX}>×</Text>
              </Pressable>
            </View>
            {a.factors.map((f) => (
              <Text key={f} style={s.positiveFactor}>・{f}</Text>
            ))}
          </View>
        ))}

        {/* 朝の気分カード（その日1回だけ・記録かスキップで消える） */}
        {vis('mood') && showMood && (
          <View style={s.card}>
            <MinusBadge editing={editing} onPress={() => cards.hide('mood')} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Smile size={16} color={C.teal} />
              <Text style={[s.h2, { marginBottom: 0 }]}>{t('いまの気分は？')}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              {([1, 2, 3, 4, 5] as const).map((lv) => (
                <Pressable key={lv} style={({ pressed }) => [s.moodBtn, pressed && { transform: [{ scale: 0.92 }], backgroundColor: C.segTrack }]}
                           disabled={moodBusy} onPress={() => saveMood(lv)}>
                  <MoodFace level={lv} size={30} />
                </Pressable>
              ))}
            </View>
            <Text style={s.mutedT}>{t('気分と食欲はつながっています。記録するとAIの過食予報が賢くなります。')}</Text>
            <Pressable onPress={moodSnooze} style={{ marginTop: 6, alignSelf: 'center' }} hitSlop={8}>
              <Text style={[s.mutedT, { textDecorationLine: 'underline' }]}>{t('今日は聞かないで')}</Text>
            </Pressable>
          </View>
        )}

        {/* 今日のフィード */}
        {vis('feed') && (
        <Animated.View style={[s.card, enter[2]]}>
          <MinusBadge editing={editing} onPress={() => cards.hide('feed')} />
          <Text style={s.h2}>{t('今日の記録')}<Text style={s.h2sub}>{t('— {n}件', { n: dayLogs.length })}</Text></Text>
          {dayLogs.length === 0 && <Text style={s.mutedT}>{t('まだ記録がありません。下から1回分ずつ記録しましょう。')}</Text>}
          {dayLogs.map((l) => (
            <View key={l.id}>
            <Pressable style={({ pressed }) => [s.feedRow, pressed && { opacity: 0.6 }]}
                       onPress={() => {
                         // 品目が2つ以上あるときだけ展開する意味がある
                         const n = ((l.items ?? []) as FoodItem[]).length;
                         if (n >= 2) setOpenLog((cur) => (cur === l.id ? null : l.id));
                       }}
                       onLongPress={() => confirmDeleteLog(l)} delayLongPress={450}>
              <Text style={s.feedTime}>{timeJST(l.at)}</Text>
              {moodLevelOf(l) == null && <Text style={{ fontSize: 15, marginRight: 2 }}>{logIcon(l)}</Text>}
              <View style={{ flex: 1 }}>
                {moodLevelOf(l) != null
                  ? <MoodInline level={moodLevelOf(l)!} />
                  : <Text style={[s.feedTitle, { flex: 0 }]} numberOfLines={2}>{logTitle(l)}</Text>}
                {l.kcal != null && l.p != null && (
                  <Text style={s.feedPfc}>
                    <Text style={{ color: pfcColors().p }}>P</Text> {Math.round(Number(l.p))}
                    {'  '}<Text style={{ color: pfcColors().f }}>F</Text> {Math.round(Number(l.f ?? 0))}
                    {'  '}<Text style={{ color: pfcColors().c }}>C</Text> {Math.round(Number(l.c ?? 0))}
                  </Text>
                )}
              </View>
              {l.kcal != null && <Text style={s.feedKcal}>{Math.round(Number(l.kcal)).toLocaleString()}<Text style={s.feedU}> kcal</Text></Text>}
            </Pressable>

            {/* 展開: 品目ごとに栄養素を出し、1品だけ消せるようにする
                （1回の食事というまとまりは保ったまま、中身を個別に扱う） */}
            {openLog === l.id && ((l.items ?? []) as FoodItem[]).map((it, ix) => (
              <View key={`${l.id}-${ix}`} style={s.itemRow}>
                <Text style={s.itemName} numberOfLines={1}>
                  {it.name}{it.qty && it.qty !== '×1' ? ` ${it.qty}` : ''}
                </Text>
                <Text style={s.itemPfc}>
                  <Text style={{ color: pfcColors().p }}>P</Text> {Math.round(Number(it.p) || 0)}
                  {'  '}<Text style={{ color: pfcColors().f }}>F</Text> {Math.round(Number(it.f) || 0)}
                  {'  '}<Text style={{ color: pfcColors().c }}>C</Text> {Math.round(Number(it.c) || 0)}
                </Text>
                <Text style={s.itemKcal}>{Math.round(Number(it.kcal) || 0)}</Text>
                <Pressable onPress={() => deleteOneItem(l, ix)} hitSlop={10}>
                  <Text style={s.itemX}>×</Text>
                </Pressable>
              </View>
            ))}
            </View>
          ))}
          {dayLogs.length > 0 && <Text style={s.hint}>{t('行を長押しで削除できます')}</Text>}
        </Animated.View>
        )}

        {/* 無料プラン向けバナー広告（課金有効ビルド×無料プランのときだけ高さが生まれる） */}
        <AdBanner />

        {/* 前の食事をもう一度（過去記録のitemsを再利用・AI解析不要） */}
        {vis('recent') && recentMeals.length > 0 && (
          <View style={s.card}>
            <MinusBadge editing={editing} onPress={() => cards.hide('recent')} />
            <Pressable style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                       onPress={() => setRecentOpen((v) => !v)} hitSlop={6}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <History size={16} color={C.teal} />
                <Text style={[s.h2, { marginBottom: 0 }]}>{t('前の食事をもう一度')}</Text>
                <Text style={s.h2sub}>{t('{n}件', { n: recentMeals.length })}</Text>
              </View>
              <Text style={{ color: C.sub, fontSize: 15, fontWeight: '800' }}>{recentOpen ? '▴ とじる' : t('▾ ひらく')}</Text>
            </Pressable>
            {recentOpen && (
              <>
                {recentMeals.map((m) => (
                  <View key={m.id} style={[s.feedRow, { alignItems: 'center' }]}>
                    <Text style={s.feedTime}>{m.date.slice(5).replace('-', '/')}</Text>
                    <Text style={s.feedTitle} numberOfLines={2}>{titleOfItems(m.items)}</Text>
                    <Text style={s.feedKcal}>{Math.round(Number(m.kcal)).toLocaleString()}<Text style={s.feedU}> kcal</Text></Text>
                    <Pressable style={s.reuseBtn} hitSlop={6} onPress={() => reuseMeal(m)}>
                      <Text style={s.reuseBtnT}>↺</Text>
                    </Pressable>
                  </View>
                ))}
                <Text style={[s.mutedT, { fontSize: 13, marginTop: 6 }]}>{t('↺で下のトレイに入ります。品目を×で外して量を調整してから✓保存してください。')}</Text>
              </>
            )}
          </View>
        )}

        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
        {msg?.upgrade && (
          // 上限到達（429 plan_limit）→ kindに応じた文脈見出しつきペイウォールへ（src=limit_*）
          <Pressable onPress={() => router.push(`/paywall?src=limit_${msg.kind ?? 'text'}` as never)} hitSlop={8}
            style={({ pressed }) => [{ alignSelf: 'flex-start', marginTop: 4, marginBottom: 6 }, pressed && { opacity: 0.7 }]}>
            <Text style={{ color: C.accentInk, fontWeight: '700', fontSize: 14 }}>{t('プランを見る →')}</Text>
          </Pressable>
        )}

        {/* 体重クイック入力 */}
        {vis('weight') && (
        <Animated.View style={[s.card, enter[2]]}>
          <MinusBadge editing={editing} onPress={() => cards.hide('weight')} />
          <View style={[s.wRow, { marginTop: 0 }]}>
            <TextInput ref={wInputRef} style={s.wInput} placeholder={latestWeight != null ? kgToDisplay(latestWeight, units.weight).toFixed(1) : '—'}
                       placeholderTextColor={C.faint} keyboardType="decimal-pad" value={wWeight} onChangeText={setWWeight} />
            <Text style={s.wUnit}>{units.weight}</Text>
            <OptionButton variant="tonal" label={t('体重を記録')} leading={<Weight size={15} color={C.ink} />}
                          onPress={saveWeight} busy={saving} disabled={!wWeight} />
          </View>
        </Animated.View>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ===== ボトム固定インプットドック（LINE風・キーボードに吸い付く） ===== */}
      <Reanimated.View style={dockLift}>
      <Animated.View style={[s.dockWrap, { paddingBottom: insets.bottom + 8 }, enter[3]]} ref={dockTarget} collapsable={false}>
        {/* いつの記録か（常時表示）: 過去日に書いていることへの気づき（今日以外はアンバー強調）。
            時刻は本人がトレイの「食べた時間」チップで選んだときだけ薄く添える
            （「いま」はDB側のnow()で決まるので出さない＝嘘の時刻を見せない） */}
        <Text style={[s.dockDate, !isViewToday && s.dockDatePast]}>
          {t('{date} の記録', { date: dateLabelOf(viewDate) })}
          {parsed != null && mealTimeResolved !== MEAL_TIME_NOW && (
            <Text style={s.dockTime}>{'  '}{mealTimeResolved}</Text>
          )}
        </Text>
        {/* 残量ストリップ（常設）: 入力欄を見た瞬間に「あと何kcal・PFC残」が必ず目に入る */}
        {profile != null && (() => {
          const addK = parsedTotal ? Math.round(parsedTotal.kcal) : 0;
          const pvLeft = left - addK;
          return (
            <View style={s.preview}>
              <Text style={[s.previewMain, pvLeft < 0 && { color: C.coral }]}>
                {parsed ? t('追加後 ') : ''}{pvLeft >= 0 ? t('残り {n}kcal', { n: pvLeft.toLocaleString() }) : t('{n}kcal 超過', { n: (-pvLeft).toLocaleString() })}
              </Text>
              {macros && (
                <View style={s.previewBars}>
                  {([
                    ['P', eatenP, stagedP, macros.p, pfcColors().p],
                    ['F', eatenF, stagedF, macros.f, pfcColors().f],
                    ['C', eatenC, stagedC, macros.c, pfcColors().c],
                  ] as const).map(([ab, eat2, stg, tgt2, col2]) => {
                    const leftG = tgt2 - eat2 - stg;
                    return (
                      <View key={ab} style={s.previewBarCol}>
                        <Text style={[s.previewBarAb, { color: leftG < 0 ? C.coral : col2 }]}>{ab}</Text>
                        <LiveBar eaten={eat2} staged={stg} target={tgt2} color={col2} pulse={pulse} height={5} />
                        <Text style={[s.previewBarV, leftG < 0 && { color: C.coral, fontWeight: '800' }]}>
                          {leftG >= 0 ? `${leftG}g` : `+${-leftG}g`}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })()}
        {photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }} keyboardShouldPersistTaps="handled">
            {photos.map((p, i) => (
              <View key={i} style={s.thumbWrap}>
                <Image source={{ uri: p.uri }} style={s.thumb} />
                <Pressable style={s.thumbX} hitSlop={6} onPress={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}>
                  <Text style={{ color: C.panel, fontSize: 13, fontWeight: '800' }}>×</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        {/* マイ食品チップ（タップ=トレイへ・−で減・長押しドラッグで並び替え。1行⇄全展開切替可）
            先頭にセット（複数品目）のチップ（皿アイコン＋アクセント面で区別・タップでセット全品目をトレイへ・
            長押しで削除→Undoスナックバー）。セットは常に先頭固定＝並び替えの保存対象は単品だけ */}
        {(myFoods.length > 0 || myMeals.length > 0) && (() => {
          const mealChipEl = (m: MyMeal) => (
            <Pressable key={m.id} style={s.mealChip}
                       onPress={() => tapMeal(m)}
                       onLongPress={() => deleteMealNow(m)} delayLongPress={450}>
              <UtensilsCrossed size={13} color={C.teal} />
              <Text style={s.mealChipT} numberOfLines={1}>{m.name}</Text>
            </Pressable>
          );
          /* 案内のハイライト対象。ScrollViewの外側のViewに付ける */
          const chipEl = (fd: MyFood) => {
            const cnt = parsed ? servingCount(parsed.items, fd) : null;
            return (
              <View key={fd.id} style={[s.chip, cnt != null && s.chipOn]}>
                <Pressable onPress={() => tapFood(fd)} onLongPress={() => quickSaveFood(fd)} delayLongPress={450} style={s.chipMain}>
                  <Text style={[s.chipT, cnt != null && { color: C.ink }]}>
                    {cnt == null ? '＋ ' : ''}{fd.name}{cnt != null ? ` ×${cnt % 1 === 0 ? cnt : cnt.toFixed(1)}` : ''}
                  </Text>
                </Pressable>
                {cnt != null && (
                  <Pressable onPress={() => decFood(fd)} style={s.chipMinus} hitSlop={4}>
                    <Text style={{ color: C.coral, fontWeight: '800', fontSize: 17 }}>−</Text>
                  </Pressable>
                )}
              </View>
            );
          };
          const orderedFoods = foodsOrder.map((id) => myFoods.find((f) => f.id === id)).filter(Boolean) as MyFood[];
          return (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }} ref={chipsRef} collapsable={false}>
              {foodsView === 'row' ? (
                <View style={{ flex: 1 }}>
                  <ReorderableChips
                    order={[...myMeals.map((m) => `meal:${m.id}`), ...foodsOrder]}
                    // 並び替えの永続化はマイ食品のidだけ（ミールは次の描画で先頭に戻る）
                    onOrderChange={(next) => persistFoodsOrder(next.filter((id) => !id.startsWith('meal:')))}
                    renderChip={(id) => {
                      if (id.startsWith('meal:')) {
                        const m = myMeals.find((x) => `meal:${x.id}` === id);
                        return m ? mealChipEl(m) : null;
                      }
                      const fd = myFoods.find((f) => f.id === id);
                      return fd ? chipEl(fd) : null;
                    }}
                  />
                </View>
              ) : (
                <ScrollView style={{ flex: 1, maxHeight: 150 }} keyboardShouldPersistTaps="handled">
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }}>{[...myMeals.map(mealChipEl), ...orderedFoods.map(chipEl)]}</View>
                </ScrollView>
              )}
              <Pressable onPress={toggleFoodsView} hitSlop={8} style={s.viewToggle}>
                <Text style={s.viewToggleT}>{foodsView === 'row' ? '▦' : '▬'}</Text>
              </Pressable>
            </View>
          );
        })()}
        {/* ステージングトレイ: チップ/AI解析の結果はここに積まれ、✓保存で初めてDBに書かれる */}
        {editingId != null && (
          <View style={s.editBanner}>
            <Text style={s.editBannerT}>{t('✏️ 記録を書き換え中')}</Text>
            <Pressable onPress={cancelEdit} hitSlop={8}>
              <Text style={s.editBannerCancel}>{t('やめる')}</Text>
            </Pressable>
          </View>
        )}
        {(parsed != null || pendingTexts.length > 0 || jobs.length > 0 || aiNote != null) && (
          <View style={s.tray}>
            <View style={{ flex: 1 }}>
            {aiNote && (
              <View style={s.aiNoteRow}>
                <Sparkles size={ICON.xs} color={C.teal} />
                <View style={{ flex: 1 }}>
                  {!!aiNote.reply && <Text style={s.aiNoteT}>{aiNote.reply}</Text>}
                  {aiNote.assumptions.map((a) => (
                    <Text key={a} style={s.aiNoteSub} numberOfLines={2}>・{a}</Text>
                  ))}
                  {aiNote.questions.length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                      {aiNote.questions.map((q) => (
                        <Pressable key={q} style={s.aiQChip} onPress={() => inputRef.current?.focus()}>
                          <Text style={s.aiQChipT} numberOfLines={2}>{q}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
                <Pressable hitSlop={8} onPress={() => setAiNote(null)}><Text style={s.trayX}>×</Text></Pressable>
              </View>
            )}
            {/* 食事の制約の警告行（§5）。トレイ上部・保存は止めない・免責を毎回添える */}
            <DietWarnRow alerts={dietAlerts} />
            {/* 食べた時間（§4）: 「いま」（今日だけ）／候補5つ／⏱で15分刻みのピッカー。
                選んだ時刻が logs.at に入る＝食べる時間帯の分析と特徴量が「保存した時刻」ではなく
                「食べた時刻」を見られるようになる。過去日は「いま」を出さず12:00を仮置き */}
            {parsed != null && (() => {
              const isPreset = mealTimeResolved === MEAL_TIME_NOW || MEAL_TIME_PRESETS.includes(mealTimeResolved);
              const chip = (key: string, label: string, on: boolean, onPress: () => void) => (
                <Pressable key={key} style={[s.timeChip, on && s.timeChipOn]} onPress={onPress} hitSlop={4}>
                  <Text style={[s.timeChipT, on && s.timeChipTOn]}>{label}</Text>
                </Pressable>
              );
              return (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.timeRow}>
                  {isViewToday && chip('now', t('いま'), mealTimeResolved === MEAL_TIME_NOW, () => setMealTime(MEAL_TIME_NOW))}
                  {MEAL_TIME_PRESETS.map((hm) => chip(hm, hm, mealTimeResolved === hm, () => setMealTime(hm)))}
                  {chip('pick', isPreset ? t('⏱ 時刻を選ぶ') : `⏱ ${mealTimeResolved}`, !isPreset, openTimePicker)}
                </ScrollView>
              );
            })()}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {parsed?.items.map((it, i) => {
                const on = focusItem === i;
                const dlv = dietLevelByName.get(it.name) ?? null;
                return (
                  <Pressable key={i} style={[s.trayChip, on && s.trayChipOn,
                                             dlv === 'high' && s.trayChipDietHigh, dlv === 'maybe' && s.trayChipDietMaybe]}
                             onPress={() => setFocusItem(on ? null : i)}>
                    {dlv && <View style={{ marginRight: 4 }}><DietMark level={dlv} /></View>}
                    <View style={{ flexShrink: 1 }}>
                      <Text style={s.trayChipT} numberOfLines={1}>
                        {it.name}{it.qty && it.qty !== '×1' ? ` ${it.qty}` : ''} <Text style={{ color: C.sub, fontSize: 11 }}>{Math.round(it.kcal)}kcal</Text>
                      </Text>
                      <Text style={s.trayChipPfc}>
                        <Text style={{ color: pfcColors().p }}>P</Text> {Math.round(it.p)}
                        {'  '}<Text style={{ color: pfcColors().f }}>F</Text> {Math.round(it.f)}
                        {'  '}<Text style={{ color: pfcColors().c }}>C</Text> {Math.round(it.c)}
                      </Text>
                    </View>
                    <Pressable hitSlop={8} onPress={() => removeTrayItem(i)}><Text style={s.trayX}>×</Text></Pressable>
                  </Pressable>
                );
              })}
              {parsed?.weight != null && (
                <View style={s.trayChip}>
                  <Weight size={ICON.xs} color={C.sub} />
                  <Text style={s.trayChipT}>{parsed.weight}kg</Text>
                  <Pressable hitSlop={8} onPress={() => setParsed((p) => (p && (p.items.length > 0 || p.ex) ? { ...p, weight: null } : null))}>
                    <Text style={s.trayX}>×</Text>
                  </Pressable>
                </View>
              )}
              {parsed?.ex && parsed.ex !== 'オフ' && (
                <View style={s.trayChip}>
                  <Activity size={ICON.xs} color={C.sub} />
                  <Text style={s.trayChipT}>{parsed.ex}</Text>
                </View>
              )}
              {pendingTexts.map((pt) => (
                <View key={`p${pt.id}`} style={s.trayChip}>
                  <ActivityIndicator size="small" color={C.teal} />
                  <Text style={[s.trayChipT, { marginLeft: 4 }]} numberOfLines={1}>{pt.text}</Text>
                </View>
              ))}
              {/* AI解析の送信ジョブ。解析中は待ち時間を、失敗は理由と次の一手（再試行/破棄）を
                  同じ位置に出す。黙って消えることが無いので「送れたのか」が常に分かる */}
              {jobs.map((j) => (j.state === 'failed' ? (
                <View key={j.id} style={[s.trayChip, s.trayChipFail]}>
                  <View style={{ flexShrink: 1 }}>
                    <Text style={s.trayFailT} numberOfLines={1}>{t('解析に失敗しました')}</Text>
                    {/* なぜ失敗したか（再試行が効くかどうかの判断材料）と、どの送信だったか */}
                    {!!j.error && <Text style={s.trayFailSub} numberOfLines={3}>{j.error}</Text>}
                    <Text style={s.trayFailWhat} numberOfLines={1}>{j.text || t('（写真）')}</Text>
                  </View>
                  <Pressable hitSlop={8} onPress={() => retryJob(j)}>
                    <Text style={s.trayRetryT}>{t('再試行')}</Text>
                  </Pressable>
                  <Pressable hitSlop={8} onPress={() => discardJob(j)}>
                    <Text style={s.trayDropT}>{t('破棄')}</Text>
                  </Pressable>
                </View>
              ) : (
                <View key={j.id} style={[s.trayChip, isSlow(j, nowMs) && s.trayChipWide]}>
                  <ActivityIndicator size="small" color={C.teal} />
                  <View style={{ flexShrink: 1, marginLeft: 4 }}>
                    <Text style={s.trayChipT} numberOfLines={1}>{j.text || t('（写真）')}</Text>
                    {isSlow(j, nowMs) && (
                      <Text style={s.trayWaitT} numberOfLines={2}>{t('混み合っています…そのまま離れてOK')}</Text>
                    )}
                  </View>
                </View>
              )))}
            </ScrollView>
            </View>
            {parsed != null && (
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Pressable onPress={clearTray} hitSlop={8}><Text style={s.trayClearT}>{t('破棄')}</Text></Pressable>
                {/* ✓保存の長押し=保存してマイ食品（セット）にも登録（書き換え中は保存の意味が変わるため出さない） */}
                <Pressable style={s.traySave} onPress={save} disabled={saving} delayLongPress={450}
                           onLongPress={() => {
                             if (!editingId && !saving && parsed.items.length > 0) setMealDraft({ items: parsed.items, alsoSave: true });
                           }}>
                  {saving ? <ActivityIndicator color="#fff" /> : (
                    <Text style={s.traySaveT}>{editingId ? t('✓ 書き換える') : t('✓ 保存')}{parsedTotal && parsed.items.length > 0 ? ` ${Math.round(parsedTotal.kcal).toLocaleString()}kcal` : ''}</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        )}
        {/* 食事の制約（§6-4）: 警告が出ていないときも必ず出す常設表記。
            沈黙を「対象なし」と誤読させないための最後の砦なので、条件を足して隠さない */}
        {dietOn && parsed != null && <DietSilenceNote />}
        {/* 量調整ポップ（トレイ直下にインライン展開・Modal不使用）: 品目チップのタップで開き、
            倍率チップ1タップでその品のkcal/PFCを再計算する。もう一度チップを押すと閉じる */}
        {parsed != null && focusItem != null && parsed.items[focusItem] != null && (
          <View style={s.adjustPop}>
            <Text style={s.adjustName} numberOfLines={1}>
              {t('「{name}」の量を補正', { name: parsed.items[focusItem].name })}
              <Text style={s.adjustHint}>  {t('半分だけ食べたら ×0.5')}</Text>
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 7 }}>
              {MULT_STEPS.map((mv) => {
                const on = Math.abs(currentMult(parsed.items[focusItem]) - mv) < 0.001;
                return (
                  <Pressable key={mv} style={[s.multChip, on && s.multChipOn]} onPress={() => adjustFocused(mv)}>
                    <Text style={[s.multChipT, on && s.multChipTOn]}>×{mv}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        <View style={s.dock}>
          {/* 発光レイヤ: 全開の縁と影を重ね、opacityだけをネイティブで往復させる */}
          <Animated.View pointerEvents="none" style={[s.dockGlow, { opacity: glow }]} />
          {/* 通常時=「ここが入力欄」のペンサイン / キーボード表示中=しまうボタン */}
          {kbVisible ? (
            <Pressable style={s.pencilBadge} onPress={() => Keyboard.dismiss()} hitSlop={6}>
              <ChevronDown color={C.teal} size={ICON.xl} strokeWidth={ICON.stroke} />
            </Pressable>
          ) : (
            <View style={s.pencilBadge}>
              <Pencil color={C.teal} size={ICON.md} strokeWidth={ICON.stroke} />
            </View>
          )}
          <TextInput
            ref={inputRef} multiline
            style={[s.dockInput, { height: Math.max(40, Math.min(132, inputH)) }]}
            placeholder={t('ここをタップして食事を入力…')} placeholderTextColor={C.sub}
            value={chat} onChangeText={setChat}
            onContentSizeChange={(e) => setInputH(e.nativeEvent.contentSize.height + 14)}
          />
          {/* 文字を打ち始めたら補助アイコンを畳み、テキストに全幅を渡す（LINE式）。
              5個のアイコンが同じ行にいると入力幅が半分になり、10文字弱で不自然に
              改行していた（βフィードバック 2026-09-02）。キーボードを閉じれば全部戻る */}
          {!(kbVisible && chat.trim().length > 0) && (<>
          {/* 音声入力（1500人監査Later群「入力が遅い層への救済」）: キーボードのマイクへの
              道しるべ。初回だけ使い方を案内し、以後は入力欄にフォーカスするだけ */}
          <VoiceHintButton onFocusInput={() => inputRef.current?.focus()} />
          {/* カメラ1本に統合（βフィードバック 2026-09-02: 成分表示ボタンも結局カメラが
              開くだけで体験が同一＝ややこしい）。料理も成分表示も同じ撮影でAIが読み分ける。
              長押し＝バーコードスキャン（旧・成分表示ボタンから引き継ぎ） */}
          <DockIconButton Icon={Camera} onPress={takePhoto} onLongPress={() => setScanOpen(true)}
                          disabled={photos.length >= 4} guideKey="dockCamera" />
          <DockIconButton Icon={Images} onPress={pickPhotos} disabled={photos.length >= 4} />
          {/* B-11 外食メニューおすすめ: ヒーローと同じ残量計算値を渡す。
              「これにする」は入力欄への充填まで（送信＝AI解析→トレイ→✓保存は本人の操作） */}
          {profile != null && (
            <MenuAdvisor
              remainingKcal={left}
              pRemain={macros ? Math.round(macros.p) - eatenP : null}
              onPick={(name) => { setChat(name); setTimeout(() => inputRef.current?.focus(), 500); }}
            />
          )}
          </>)}
          <Pressable style={[s.dockSend, !canSend && { opacity: 0.35 }]} onPress={sendQuick} disabled={!canSend}>
            <ArrowUp color="#fff" size={ICON.md} strokeWidth={ICON.strokeBold} />
          </Pressable>
        </View>
      </Animated.View>
      </Reanimated.View>

      {/* 食べた時間のピッカー（15分刻み）。iOSはスピナー＋「決定」、Androidは端末のダイアログで即確定 */}
      <Modal visible={timePickerOpen} transparent animationType="fade" onRequestClose={() => setTimePickerOpen(false)}>
        <Pressable style={s.timeBack} onPress={() => setTimePickerOpen(false)}>
          <Pressable style={s.timeCard} onPress={() => {}}>
            <Text style={s.timeTitle}>{t('食べた時間')}</Text>
            <DateTimePicker
              locale={apiLang()}
              value={timeDraft} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minuteInterval={MEAL_TIME_STEP_MIN}
              onChange={(ev, d) => {
                if (Platform.OS !== 'ios') {
                  // Androidはダイアログの「OK」で確定・戻るで取り消し（イベント1回で閉じる）
                  setTimePickerOpen(false);
                  if (ev.type === 'set' && d) commitTime(d);
                  return;
                }
                if (d) setTimeDraft(d);
              }}
            />
            {Platform.OS === 'ios' && (
              <View style={s.timeBtns}>
                <Pressable style={s.timeBtnGhost} onPress={() => setTimePickerOpen(false)} hitSlop={6}>
                  <Text style={s.timeBtnGhostT}>{t('キャンセル')}</Text>
                </Pressable>
                <Pressable style={s.timeBtn} onPress={() => { commitTime(timeDraft); setTimePickerOpen(false); }} hitSlop={6}>
                  <Text style={s.timeBtnT}>{t('決定')}</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      {/* 削除のUndoスナックバー（ドックの上に重ねる。触れない領域は素通し） */}
      {undoBar.element}
      <AddCardSheet
        visible={addOpen} onClose={() => setAddOpen(false)}
        hidden={cards.layout.hidden} shownKeys={cards.visible} labels={LOG_LABELS()} onShow={cards.show}
      />
      <SpotlightTip
        visible={suggest != null}
        targetRef={myFoods.length > 0 ? chipsRef : undefined}
        title={t('{name}をよく食べるようですね', { name: suggest?.name ?? '' })}
        text={t('直近{days}日で登場しました。マイ食品に登録すると、次からは1タップで足せます。', { days: suggest?.days ?? 0 })}
        primaryLabel={t('登録してみる')}
        onPrimary={() => {
          if (suggest) {
            setFoodDraft({
              name: suggest.name, unit: suggest.portion || undefined,
              kcal: suggest.kcal, p: suggest.p, f: suggest.f, c: suggest.c,
            });
          }
          setSuggest(null);
        }}
        secondaryLabel={t('あとで')}
        onSecondary={() => {
          if (suggest) markDeclined(suggest.key).catch(() => {});
          setSuggest(null);
        }}
      />
      {/* 食事の制約（除外アラート・B-18）の存在を知らせる案内。
          docs/DIET-MODES.md §3のとおりオンボーディングには入れず、食事入力の文脈で1回だけ。
          注記の免責は DietNotes.tsx の正本（「これは推定です」「安全確認には使えません」）と
          同じ内容を短くしたもの。この案内で機能を安全確認に使えると誤解させない（§6-3）。 */}
      <SpotlightTip
        visible={dietTip}
        title={t('苦手なもの・食べないものはありますか？')}
        text={t('登録しておくと、写真やメニューを読み取ったときに「これは対象かも」とAIが教えてくれます。ビーガン・グルテンフリー・アレルギーの気になる食材など。')}
        note={t('※ 表示は推定です。安全確認には使えません。')}
        primaryLabel={t('設定してみる')}
        onPrimary={() => {
          setDietTip(false);
          router.push({ pathname: '/settings', params: { open: 'diet', ts: String(Date.now()) } });
        }}
        secondaryLabel={t('いまはしない')}
        onSecondary={() => {
          setDietTip(false);
          markDietTipDeclined().catch(() => {});   // 一度断られたら二度と出さない
        }}
      />
      <AddFoodSheet
        visible={foodDraft != null} draft={foodDraft}
        onClose={() => setFoodDraft(null)}
        onSaved={() => { load(); setMsg({ ok: true, text: t('マイ食品に登録しました。下のチップから1タップで足せます。') }); }}
      />
      {/* マイ食品（セット）の登録シート（記録行の長押しメニュー/✓保存の長押しから。
          alsoSave=✓保存長押し経由: セット登録に続けてトレイの通常保存も行う） */}
      <SaveMealSheet
        visible={mealDraft != null} uid={uid} items={mealDraft?.items ?? []}
        onClose={() => setMealDraft(null)}
        onSaved={async (name) => {
          const alsoSave = mealDraft?.alsoSave === true;
          setMealDraft(null);
          setMyMeals(await listMyMeals());
          if (alsoSave) {
            const ok = await save();   // 失敗時はsave()側のエラーメッセージを残す（トレイも残る）
            if (ok) setMsg({ ok: true, text: t('保存して、マイ食品「{name}」にも登録しました。', { name }) });
          } else {
            setMsg({ ok: true, text: t('マイ食品「{name}」を登録しました。入力欄の上のチップから1タップで呼び出せます。', { name }) });
          }
        }}
      />
      {/* バーコードスキャナ（読み取り成功で即クローズ→公式DB照会→トレイ投入） */}
      <BarcodeScanner visible={scanOpen} onClose={() => setScanOpen(false)} onScanned={scannedBarcode} />
      {/* おかえりフロー: 発火判定はコンポーネント内で完結（マウント直後のみ→既存Modalと競合しない） */}
      <ComebackSheet onSaved={load} />
      <StatusBarMask />
      <HeaderGear />
    </View>
  );
}

const s = themed(() => ({
  scroll: { padding: SPACE.screen },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  // B-7: 最初の法則の帯（今日のひとこと帯と同じ「帯」の文法・アクセント面で一段目立たせる）
  lawBand: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: RADIUS.tile, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  lawBandT: { flex: 1, fontSize: 13, fontWeight: '800', color: C.ink, lineHeight: 18 },
  lawBandGo: { fontSize: 13, fontWeight: '800', color: C.accentInk },
  lawBandX: { fontSize: 17, color: C.faint, fontWeight: '700', paddingHorizontal: 2 },
  brand: { fontSize: 21, fontWeight: '900', color: C.ink, letterSpacing: -0.5 },
  addBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  doneBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.chip, backgroundColor: C.teal },
  doneBtnT: { color: '#fff', fontSize: 13, fontWeight: '800' },
  pageTitle: { ...HEAD.page, color: C.ink },
  hero: {
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: RADIUS.card, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 18,
    marginBottom: 20,   // 記録リストとの間だけ広くする（カード同士は12）
  },
  heroL: { fontSize: 13, fontWeight: '700', color: C.sub, letterSpacing: 0.5 },
  heroN: { fontSize: 44, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginVertical: 2 },
  heroU: { fontSize: 17, color: C.sub, fontWeight: '600' },
  // アクティブぶんの上乗せ内訳（目標が増えた理由の1行）。増加は良い知らせなのでアクセント色
  heroActive: { fontSize: 12, fontWeight: '800', color: C.accentInk, marginTop: 4 },
  hline: { height: 7, backgroundColor: C.track, borderRadius: 4, overflow: 'hidden', marginVertical: 8 },
  hfill: { height: 7, backgroundColor: C.calorieBar, borderRadius: 4 },
  heroMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, flexWrap: 'wrap' },
  metaT: { fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  // 目標の数字はタップできることが分かるよう濃く・下線。「目標を調整 ›」はアクセント色の小さな導線
  metaGoalN: { fontWeight: '800', color: C.ink, textDecorationLine: 'underline' },
  metaAdjust: { fontSize: 12, fontWeight: '800', color: C.accentInk },
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: RADIUS.card, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: SPACE.card, marginBottom: 12 },
  h2: { ...HEAD.card, color: C.ink, marginBottom: 8 },
  // 気づきアラート（§8）: 統合カードの見出し行・×・解説リンク・ポジティブ側の控えめな面
  alertHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  alertX: { fontSize: 20, lineHeight: 22, color: C.faint, paddingHorizontal: 4 },
  alertNote: { fontSize: 11, color: C.faint, lineHeight: 16, marginTop: 4 },
  alertLink: { fontSize: 13, fontWeight: '700', color: C.accentInk, textDecorationLine: 'underline' },
  positiveCard: { backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder, borderRadius: RADIUS.card, padding: SPACE.card, marginBottom: 12 },
  positiveTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: C.ink, lineHeight: 21 },
  positiveFactor: { fontSize: 13, color: C.sub, lineHeight: 19 },
  h2sub: { fontWeight: '400', color: C.sub },
  mutedT: { fontSize: 15, color: C.sub, lineHeight: 21 },
  // 展開した品目行。記録行より一段内側に置き、従属関係を見せる
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, paddingLeft: 48, paddingRight: 2,
    borderTopWidth: 0.5, borderTopColor: C.line,
  },
  itemName: { flex: 1, fontSize: 15, color: C.ink },
  itemPfc: { fontSize: 11, fontWeight: '800', color: C.sub, fontVariant: ['tabular-nums'] },
  itemKcal: { fontSize: 13, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'], minWidth: 34, textAlign: 'right' },
  itemX: { fontSize: 17, fontWeight: '800', color: C.coral, paddingHorizontal: 4 },
  feedRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 7, borderTopWidth: 0.5, borderTopColor: C.line, gap: 8 },
  feedTime: { fontSize: 13, color: C.faint, fontWeight: '700', width: 40, paddingTop: 2, fontVariant: ['tabular-nums'] },
  feedTitle: { flex: 1, fontSize: 15, color: C.ink, lineHeight: 21 },
  feedPfc: { fontSize: 11, fontWeight: '800', color: C.sub, marginTop: 2, fontVariant: ['tabular-nums'] },
  feedKcal: { fontSize: 15, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  feedU: { fontSize: 11, color: C.faint },
  msg: { fontSize: 15, fontWeight: '600', marginBottom: 10, paddingHorizontal: 4 },
  ta: {
    minHeight: 88, maxHeight: 180, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line,
    borderRadius: RADIUS.tile, padding: 12, fontSize: 17, color: C.ink, textAlignVertical: 'top',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel,
    borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, marginRight: 6, overflow: 'hidden',
  },
  chipOn: { borderColor: C.ink },
  // セット（複数品目）のチップ（単品のマイ食品と見た目で区別: 皿アイコン＋アクセント面・teal文字）
  mealChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.accentBadge, borderWidth: 1.5, borderColor: C.accentBorder,
    borderRadius: RADIUS.chip, paddingVertical: 9, paddingHorizontal: 13, marginRight: 6, maxWidth: 180,
  },
  mealChipT: { fontSize: 13, fontWeight: '800', color: C.accentInk },
  // 量調整ポップ（トレイ直下のインライン展開）
  adjustPop: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: RADIUS.tile, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 7,
  },
  adjustName: { fontSize: 13, fontWeight: '800', color: C.ink },
  adjustHint: { fontSize: 11, fontWeight: '600', color: C.sub },
  multChip: {
    flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: RADIUS.chip,
    borderWidth: 1.5, borderColor: C.line, backgroundColor: C.panel,
  },
  multChipOn: { borderColor: C.teal, backgroundColor: C.accentBadge },
  multChipT: { fontSize: 13, fontWeight: '800', color: C.sub, fontVariant: ['tabular-nums'] },
  multChipTOn: { color: C.accentInk },
  chipMain: { paddingVertical: 9, paddingLeft: 13, paddingRight: 11 },
  chipMinus: { paddingVertical: 9, paddingHorizontal: 12, borderLeftWidth: 1.5, borderLeftColor: C.line },
  chipT: { fontSize: 13, fontWeight: '700', color: C.sub },
  moodBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.tile,
    backgroundColor: C.chipBg, borderWidth: 1, borderColor: C.line, marginBottom: 8,
  },
  btnPrimary: { backgroundColor: C.ink, borderRadius: RADIUS.chip, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  btnPrimaryT: { color: C.panel, fontSize: 15, fontWeight: '800', letterSpacing: 1 },  // ink地（ダーク=明色）に追従
  wRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  wInput: {
    width: 90, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.input,
    padding: 10, fontSize: 17, color: C.ink, textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  wUnit: { fontSize: 15, color: C.sub, fontWeight: '600' },
  btnGhost: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhostT: { color: C.ink, fontSize: 15, fontWeight: '800' },
  chipBtn: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, paddingHorizontal: 13, paddingVertical: 9 },
  chipBtnT: { fontSize: 13, fontWeight: '700', color: C.sub },
  reuseBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  reuseBtnT: { color: C.panel, fontSize: 17, fontWeight: '800' },  // ink地（ダーク=明色）に追従
  dockWrap: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.line },
  // 「いつの記録か」の常設表示。過去日はアンバーで気づかせる（DateStripの過去表現と同系色）
  dockDate: { fontSize: 11, fontWeight: '700', color: C.faint, paddingHorizontal: 6, marginBottom: 3, fontVariant: ['tabular-nums'] },
  dockDatePast: { color: C.amber, fontWeight: '800' },  // 生HEX禁止（ダーク対応はCトークン経由）
  // 選んだ「食べた時間」を日付に薄く添える（本人が選んだ時刻なので出してよい・「いま」は出さない）
  dockTime: { color: C.faint, fontWeight: '700' },
  // 食べた時間チップ列（トレイ上部・警告行の下・品目チップの上）
  timeRow: { marginBottom: 6 },
  timeChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.chip, marginRight: 5,
    borderWidth: 1.5, borderColor: C.line, backgroundColor: C.panel,
  },
  timeChipOn: { borderColor: C.teal, backgroundColor: C.accentBadge },
  timeChipT: { fontSize: 12, fontWeight: '800', color: C.sub, fontVariant: ['tabular-nums'] },
  timeChipTOn: { color: C.accentInk },
  // 時刻ピッカー（DateStripの月カレンダーと同じ「透過背景＋角丸カード」の文法）
  timeBack: { flex: 1, backgroundColor: rgba(C.ink, 0.35), justifyContent: 'center', padding: 24 },
  timeCard: { backgroundColor: C.bg, borderRadius: 20, padding: 14 },
  timeTitle: { fontSize: 15, fontWeight: '800', color: C.ink, marginBottom: 4, marginLeft: 4 },
  timeBtns: { flexDirection: 'row', gap: 8, marginTop: 6 },
  timeBtnGhost: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: RADIUS.chip, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.panel },
  timeBtnGhostT: { fontSize: 15, fontWeight: '800', color: C.sub },
  timeBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: RADIUS.chip, backgroundColor: C.teal },
  timeBtnT: { fontSize: 15, fontWeight: '800', color: '#fff' },
  dock: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 4,
    backgroundColor: C.panel, borderWidth: 2.5, borderColor: C.accentBorder, borderRadius: 18,
    paddingHorizontal: 9, paddingVertical: 8,
    shadowColor: C.teal, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.12, elevation: 8,
  },
  dockGlow: {
    position: 'absolute', top: -2.5, left: -2.5, right: -2.5, bottom: -2.5,
    borderWidth: 2.5, borderColor: C.teal, borderRadius: 18,
    shadowColor: C.teal, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.25,
  },
  dockIconBtn: { padding: 4 },
  dockIcon: { fontSize: 21 },
  dockInput: { flex: 1, fontSize: 17, fontWeight: '600', color: C.ink, paddingVertical: 7, paddingHorizontal: 4 },
  pencilBadge: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  dockSend: { backgroundColor: C.teal, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dockSendT: { color: '#fff', fontSize: 17, fontWeight: '800' },
  viewToggle: { marginLeft: 6, width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel },
  viewToggleT: { fontSize: 13, color: C.sub, fontWeight: '700' },
  preview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 7, gap: 8 },
  aiNoteRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    paddingBottom: 6, marginBottom: 6, borderBottomWidth: 0.5, borderBottomColor: C.line,
  },
  aiNoteT: { fontSize: 12.5, color: C.ink, fontWeight: '600', lineHeight: 18 },
  aiNoteSub: { fontSize: 11, color: C.sub, lineHeight: 16 },
  aiQChip: {
    backgroundColor: C.accentBadge, borderRadius: RADIUS.chip, paddingHorizontal: 10, paddingVertical: 5,
    maxWidth: '100%',
  },
  aiQChipT: { fontSize: 12, color: C.accentInk, fontWeight: '700' },
  tray: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: RADIUS.tile, paddingHorizontal: 8, paddingVertical: 7, marginBottom: 7,
  },
  trayChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.chip,
    paddingHorizontal: 10, paddingVertical: 5, marginRight: 6, maxWidth: 190,
  },
  trayChipT: { fontSize: 13, fontWeight: '700', color: C.ink },
  // 食事の制約（B-18・§5）: high=赤縁＋⚠️ / maybe=アンバーの点。塗りは変えず縁だけ（責め色で埋めない）
  trayChipDietHigh: { borderColor: C.coral, borderWidth: 1.5 },
  trayChipDietMaybe: { borderColor: C.amber },
  // 混雑時の待ち文言（解析中チップの中に添える）。文言のぶんチップを広げる
  trayChipWide: { maxWidth: 260 },
  trayWaitT: { fontSize: 12, fontWeight: '600', color: C.sub, marginTop: 1 },
  // 失敗した送信。トークンで組むのでダークでも反転が効く（coralWeak地にcoral文字）。
  // 複数行になるのでピル型（999）ではなく角丸の面にする
  trayChipFail: { backgroundColor: C.coralWeak, borderColor: C.coral, borderRadius: RADIUS.tile, gap: 7, maxWidth: 280 },
  trayFailT: { fontSize: 13, fontWeight: '800', color: C.coral },
  trayFailSub: { fontSize: 11, fontWeight: '600', color: C.sub, marginTop: 1 },
  trayFailWhat: { fontSize: 11, fontWeight: '700', color: C.ink, marginTop: 1 },
  trayRetryT: { fontSize: 13, fontWeight: '800', color: C.accentInk, textDecorationLine: 'underline' },
  trayDropT: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  editBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.accentBadge, borderRadius: RADIUS.tile, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6,
  },
  editBannerT: { fontSize: 13, fontWeight: '800', color: C.accentInk },
  editBannerCancel: { fontSize: 13, fontWeight: '800', color: C.sub, textDecorationLine: 'underline' },
  trayChipOn: { borderColor: C.teal, borderWidth: 1.5, backgroundColor: C.accentBadge },
  trayChipPfc: { fontSize: 11, fontWeight: '800', color: C.sub, marginTop: 1, fontVariant: ['tabular-nums'] },
  trayX: { fontSize: 15, fontWeight: '800', color: C.coral, marginLeft: 2 },
  traySave: { backgroundColor: C.teal, borderRadius: RADIUS.chip, paddingHorizontal: 13, paddingVertical: 9 },
  traySaveT: { color: '#fff', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  trayClearT: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  previewMain: { fontSize: 13, fontWeight: '800', color: C.accentInk, fontVariant: ['tabular-nums'] },
  previewBars: { flexDirection: 'row', gap: 10, flex: 1, alignItems: 'center', marginLeft: 10 },
  previewBarCol: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  previewBarAb: { fontSize: 11, fontWeight: '900', width: 10, textAlign: 'center' },
  previewBarV: { fontSize: 11, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'], minWidth: 30, textAlign: 'right' },
  previewSub: { fontSize: 13, fontWeight: '600', color: C.sub, fontVariant: ['tabular-nums'] },
  pfcL: { width: 80, fontSize: 13, fontWeight: '800', color: C.ink },
  pfcAb: { fontSize: 11, fontWeight: '700', color: C.faint },
  adviceBox: {
    marginTop: 8, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: RADIUS.tile, paddingHorizontal: 12, paddingVertical: 9,
  },
  adviceT: { fontSize: 13, color: C.ink, lineHeight: 19, fontWeight: '500' },
  pfcBar: { flex: 1, height: 7, backgroundColor: C.track, borderRadius: 4, overflow: 'hidden' },
  pfcFill: { height: '100%', borderRadius: 4 },
  pfcT: { width: 96, fontSize: 13, fontWeight: '800', color: C.ink, textAlign: 'right', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 11, color: C.faint, textAlign: 'right', marginTop: 6 },
  thumbWrap: { marginRight: 8 },
  thumb: { width: 64, height: 64, borderRadius: RADIUS.input, borderWidth: 1, borderColor: C.line },
  thumbX: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
}));
