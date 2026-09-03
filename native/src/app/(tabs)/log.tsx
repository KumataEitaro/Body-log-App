// 食事タブ（Phase 1コア）: ヒーロー・今日のフィード・＋ボタン→入力シート（AI解析・マイ食品・写真）・体重クイック入力
// ロジックはWeb版のlib/*をそのまま移植して使用（データ・計算式は完全互換）
//
// 【入力の構成（2026-09-02 再設計）】
// 以前は画面下に固定の入力ドック（テキスト・カメラ・ライブラリ・送信）が常駐していたが、
// 「テキストボックスを下に固定する意味がなくなってきた」（熊田さん）ため廃止。
// Appleヘルスケアと同じく、右下の＋ボタン → 何を記録するか（食事／運動／体の写真／体重）→
// 食事なら入力方法（マイ食品／テキスト／写真を選ぶ／撮影）を選び、pageSheet の入力シートで
// 解析→トレイ→✓保存まで済ませる。ドックにあった機能（テキスト・写真・食べた時間チップ・トレイ・
// 残量ストリップ・マイ食品チップ・音声ヒント・外食おすすめ）はすべて入力シートの中に移した。
// バーコード読み取りは食品DBを持たないため置かない（AddFoodSheet の補助経路だけ残る）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, Image, Alert, Animated, Easing, Modal,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { History, Camera, Images, Weight, Activity, ArrowUp, Smile, Sparkles, UtensilsCrossed, X } from 'lucide-react-native';
import DockIconButton from '@/components/DockIconButton';
import VoiceHintButton from '@/components/VoiceHintButton';
import AdBanner from '@/components/AdBanner';
import DateStrip from '@/components/DateStrip';
import TabHeader, { STICKY_FIRST } from '@/components/TabHeader';
import PlusFab from '@/components/PlusFab';
import PlusSheet, { type PlusAction } from '@/components/PlusSheet';
import { FoodName, ItemsTitle, PfcInline, KcalCell } from '@/components/FoodRowText';
import { LiveBar, GhostPair, usePulse } from '@/components/LivePreviewBar';
import SpotlightTip from '@/components/SpotlightTip';
import AddFoodSheet, { type MyFoodDraft } from '@/components/AddFoodSheet';
import MenuAdvisor from '@/components/MenuAdvisor';
import WhatToEatSheet from '@/components/WhatToEatSheet';
import { recordItems, pickSuggestion, markShown, markDeclined, type Suggestion } from '@/lib/foodSuggest';
import { removeItemAt } from '@/lib/itemLog';
import { previewFill } from '@/lib/preview';
import * as Haptics from 'expo-haptics';
import { MinusBadge, AddCardSheet, useCardLayout } from '@/components/CardLayout';
import { Plus } from 'lucide-react-native';
import { Chip, OptionButton } from '@/components/ui/Selectable';
import { pfcAdvice, PFC_LABEL } from '@/lib/pfcAdvice';
import { pfcColors } from '@/lib/theme';
import { useUnits, displayToKg, kgToDisplay, fmtWeight } from '@/lib/units';
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
import { C, rgba, RADIUS, SPACE, ICON, HEAD, themed, sheetTopPad } from '@/lib/ui';
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
import { swapsFor, swapLine, emojiText, swapKcalDelta } from '@/lib/smartSwap';
import SaveMealSheet from '@/components/SaveMealSheet';
import { logIcon, logTitle, moodLevelOf } from '@/lib/feed';
import { skipTodayReminder, scheduleFirstLawNotification } from '@/lib/notify';
import { getFirstRunFlag } from '@/lib/firstrun';
import { checkFirstLawUnlock, consumeFirstLawBanner } from '@/lib/laws';
import { BookOpen } from 'lucide-react-native';
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
import { useCountUp } from '@/lib/motion';
import { consumePendingMeal } from '@/lib/pendingMeal';
import { usePurpose, purposeOf } from '@/lib/purpose';
import { setDayStatus } from '@/lib/dayStatus';
import { confirmOutlierWeight } from '@/lib/guard';
import { useUndoSnackbar } from '@/components/UndoSnackbar';
import { arbitrateAttention } from '@/lib/logCards';
import { useTodayRollover } from '@/lib/rollover';

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

// 入力シートの開き方（＋シートの2段目で選んだ入力方法）。'tray' は「前の食事↺」「書き換える」
// 「AIの献立」のようにトレイへ直接積む経路で、テキスト欄にフォーカスせずトレイを見せる
type InputMode = 'text' | 'myfood' | 'library' | 'camera' | 'tray';
const INPUT_MODE_LABEL = (): Record<InputMode, string> => ({
  text: t('テキストで入力'), myfood: t('マイ食品'), library: t('写真を選ぶ'), camera: t('撮影する'), tray: t('確認して保存'),
});

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
  // 削除のUndoスナックバー。右下の＋ボタン（56px）と重ならない高さに出す
  const undoBar = useUndoSnackbar(insets.bottom + 80);
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
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; upgrade?: boolean; kind?: 'text' | 'photo' | 'coach' } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [wWeight, setWWeight] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; base64: string }[]>([]);
  const [recentMeals, setRecentMeals] = useState<RecentMeal[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  // ===== ＋ボタン → 2段シート → 入力シート =====
  const [plusOpen, setPlusOpen] = useState(false);
  const [eatOpen, setEatOpen] = useState(false);   // 「何を食べる？」シート（components/WhatToEatSheet.tsx）
  const [inputOpen, setInputOpen] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('text');
  // 「撮影する／写真を選ぶ」で開いたとき、入力シートが出きってからピッカーを起動するための予約
  const pendingPick = useRef<'camera' | 'library' | null>(null);
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
  const [stagedNote, setStagedNote] = useState(''); // トレイ確定時にlogs.textへ書く元テキストの蓄積
  const [foodsView, setFoodsView] = useState<'row' | 'grid'>('row');
  const [foodsOrder, setFoodsOrder] = useState<string[]>([]);

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
  // iOS HIG標準「タブ再選択で先頭へ」: 食事タブ表示中にもう一度「食事」をタップ→最上部へ
  const navigation = useNavigation();
  useEffect(() => {
    const sub = (navigation as { addListener: (ev: string, cb: () => void) => () => void })
      .addListener('tabPress', () => { scrollRef.current?.scrollTo({ y: 0, animated: true }); });
    return sub;
  }, [navigation]);

  useEffect(() => { AsyncStorage.getItem('bl-foods-view').then((v) => { if (v === 'grid') setFoodsView('grid'); }).catch(() => {}); }, []);

  function toggleFoodsView() {
    const v = foodsView === 'row' ? 'grid' : 'row';
    setFoodsView(v);
    AsyncStorage.setItem('bl-foods-view', v).catch(() => {});
  }

  // ===== 入力シートの開閉 =====
  // ＋シート（PlusSheet）は透過のボトムシート、入力シートは pageSheet。iOSは表示中のModalの
  // 兄弟として別のModalを出せないため、PlusSheet が閉じ切ってから onAction が届く（PlusSheet側で保証）
  function openInput(mode: InputMode) {
    setInputMode(mode);
    setMsg(null);
    pendingPick.current = mode === 'camera' || mode === 'library' ? mode : null;
    setInputOpen(true);
  }
  function closeInput() { setInputOpen(false); }
  // 入力シートが閉じ切ってから出す案内（マイ食品の登録案内・食事の制約の案内）。
  // iOS: Modal の onDismiss で流す／Android: onDismiss が無いので閉じアニメ後のタイマー（二重発火は ref で防ぐ）
  const pendingTip = useRef<(() => void) | null>(null);
  function flushPendingTip() {
    const f = pendingTip.current;
    pendingTip.current = null;
    if (f) f();
  }
  function queueTip(show: () => void) {
    pendingTip.current = show;
    // iOSは onDismiss が先に拾う（タイマーは保険。シートが開いていなかった場合にも必ず出す）
    setTimeout(flushPendingTip, Platform.OS === 'ios' ? 900 : 400);
  }
  // シートが出きった瞬間: 写真経路なら即ピッカー、テキストなら即キーボード（autoFocusの取りこぼし対策）
  function onInputShown() {
    const p = pendingPick.current;
    pendingPick.current = null;
    if (p === 'camera') takePhoto();
    else if (p === 'library') pickPhotos();
    else if (inputMode === 'text') setTimeout(() => inputRef.current?.focus(), 60);
  }
  // ＋シートの1段目/2段目で選んだ行動の振り分け。運動・体の写真は既存の画面へ渡す
  function onPlusAction(a: PlusAction) {
    switch (a) {
      case 'meal:text': openInput('text'); break;
      case 'meal:myfood': openInput('myfood'); break;
      case 'meal:library': openInput('library'); break;
      case 'meal:camera': openInput('camera'); break;
      // 何を食べる？: 食事タブ内のAI相談シート（＋シートが閉じ切ってから届くので pageSheet を直接開ける）
      case 'meal:whattoeat': setEatOpen(true); break;
      // 運動: 運動タブへ移り、「運動を記録する」（種目を選ぶ→時間ダイアル）のシートが開いた状態で着地
      // （training.tsx が open=activity を受ける。筋トレは運動タブの「筋トレを記録する」から全画面へ）
      case 'exercise':
        router.navigate({ pathname: '/training', params: { open: 'activity', ts: String(Date.now()) } } as never);
        break;
      // 体の写真: 概要タブの体写真ページを開き、既存のカメラ→体脂肪率→保存の流れへ（changes.tsx が open=photos を受ける）
      case 'bodyphoto':
        router.navigate({ pathname: '/changes', params: { open: 'photos', shoot: '1', ts: String(Date.now()) } } as never);
        break;
    }
  }

  // ウィジェット/ディープリンク・通知タップ（bodylog://log?quick=1）→ 「食事 › テキストで入力」を直接開く
  const { quick } = useLocalSearchParams<{ quick?: string }>();
  useEffect(() => {
    if (quick) setTimeout(() => openInput('text'), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick]);

  // 初回ガイドツアー: 未実施なら自動起動（完了/スキップでbl-guide-doneが立つ）
  const guide = useGuide();
  const heroTarget = useGuideTarget('hero');
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

  // 起動時の時差入場（Withings風）: ヘッダー→ヒーロー→カード→＋ボタンの順にフェード＋スライドイン
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
  // 日付跨ぎ（JST 0時）: 「今日」を見ていた人はタブに戻った/前景復帰したときに新しい今日へ追従する
  // （タブは常駐するので、夜に開いたまま翌朝戻ると昨日のまま残り、朝食が昨日の12:00に入っていた）
  useTodayRollover(viewDate, setViewDate);
  // 「今日」のキー。日付跨ぎで変わると、その日1回系（気分の既読・穴埋め・過食リスク・ひとこと）を組み直す
  const todayKey = todayJST();
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

  // 表示日が変わったとき＋この画面に戻ってきたときに読み直す（useFocusEffect は初回フォーカス時にも走るので
  // マウント時の useEffect と二重にしない）。以前は [viewDate] だけだったため、運動タブで運動を記録して
  // 戻っても dayLogs が古いまま＝「運動を入れたのに消費kcalが目標に反映されない」ように見えた（2026-09-02 βFB）
  useFocusEffect(useCallback(() => { load(); }, [load]));

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
  // 手動調整（目標画面「きつければ自分で調整」・端末保存）が0なら従来の計算と完全に一致する。
  // 第5引数＝target に含まれている運動ぶん（アプリ記録の EX_ADD＋adj と、アクティブ反映の上乗せ）。
  // BMR下限は運動抜きの土台にだけ掛かり、運動ぶんは必ずその上に乗る（lib/deficit.ts の説明のとおり。
  // これが無いと赤字が大きい日に運動を記録しても目標が1kcalも動かなかった）
  const planIntakeBase = profile
    ? dailyAllowance(target, plan ? plan.requiredDailyWithEvents : 0, Math.round(bmr), kcalAdjust, Math.round(dayExerciseKcal(dayLogs)) + activeBonus)
    : 0;
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
  // ホームウィジェット（lib/widget.ts）が同じ残量を見せるため、計算結果を共有ストアへ置く。
  // ウィジェットの見出しは「今日の残り」なので、**過去日を表示中の数字は流さない**（別日を見ている間に
  // 3日前の残量が「今日」として書かれていた・2026-09-02 自己監査）。依存配列なしで毎レンダー走っていたのも直す
  const macroP = macros ? Math.round(macros.p) : 0;
  const macroF = macros ? Math.round(macros.f) : 0;
  const macroC = macros ? Math.round(macros.c) : 0;
  const hasMacros = macros != null;
  useEffect(() => {
    if (!profile || !hasMacros || viewDate !== todayKey) return;
    setDayStatus({
      goalKcal, eaten,
      p: { eaten: eatenP, target: macroP },
      f: { eaten: eatenF, target: macroF },
      c: { eaten: eatenC, target: macroC },
    });
  }, [profile, hasMacros, viewDate, todayKey, goalKcal, eaten, eatenP, eatenF, eatenC, macroP, macroF, macroC]);

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

  // ===== 入力シートからの送信: AI解析→トレイに積む（保存は✓保存で確定・連投可） =====
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
    const swapTarget = items.map((it) => it.name).find((name) => swapsFor(name, { mode: purposeKey === 'bulk' ? 'bulk' : 'cut' }).length > 0) ?? null;
    Alert.alert(canEdit ? t('この記録をどうしますか？') : t('この記録を削除しますか？'), logTitle(l), [
      { text: t('キャンセル'), style: 'cancel' },
      ...(canEdit ? [{ text: t('書き換える'), onPress: () => startEditLog(l) }] : []),
      // マイ食品（セット）: 品目内訳のある食事だけ登録できる（気分・体重だけの行では出さない）
      ...(items.length > 0 ? [{ text: t('マイ食品に登録'), onPress: () => setMealDraft({ items, alsoSave: false }) }] : []),
      // 食材ナビ: 品目のどれかに置き換え候補があるときだけ（栄養ランキング図鑑のその品目へ）
      ...(swapTarget ? [{ text: t('置き換え候補を見る'), onPress: () => router.push({ pathname: '/nutrient-rank', params: { food: swapTarget } } as never) }] : []),
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
    // トレイは入力シートの中にあるので、シートを開いて見せる（テキスト欄にはフォーカスしない）
    openInput('tray');
    setMsg({ ok: true, text: t('トレイに戻しました。直して✓保存すると置き換わります。') });
  }

  // 編集をやめる（記録は元のまま残る）。シートも閉じてフィードへ戻す
  function cancelEdit() {
    setParsed(null); setStagedNote(''); setFocusItem(null); setEditingId(null); setMealTime(null);
    editingDateRef.current = null;
    setMsg(null);
    closeInput();
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
    openInput('tray');
    setMsg({ ok: true, text: t('AIの献立をトレイに入れました。量を調整して✓保存してください。') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  // 「前の食事をもう一度」↺: 品目をトレイへ積み、入力シートを開いて確認→✓保存へ
  function reuseMeal(m: RecentMeal) {
    const items = [...(parsed?.items ?? []), ...m.items];
    setParsed((p) => ({ items, weight: p?.weight ?? null, waist: p?.waist ?? null, ex: p?.ex ?? null, adj: p?.adj ?? 0, mood: p?.mood ?? null }));
    openInput('tray');
    setMsg({ ok: true, text: t('トレイに入れました。内容を確認して✓保存してください。') });
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
      // 保存できたら入力シートを閉じてフィードへ戻す（残量が数え下がる瞬間と新しい行が見える）
      closeInput();
      await load();
      setMsg(delFailed
        ? { ok: false, text: t('新しい内容は保存しましたが、元の記録を消せませんでした。重複した行を長押しで削除してください。') }
        : savedKcal > 2500
          ? { ok: true, text: t('記録できたこと自体が、大きな一歩です。明日、極端に減らす必要はありません。いつも通りで大丈夫。') }
          : { ok: true, text: wasEdit ? t('書き換えました。') : t('保存しました。') });

      invalidateStreak();   // 🔥チップを最新化
      refreshBadgeBand(true).catch(() => {});   // 保存で条件を満たしたバッジをその場で拾う
      // よく食べる食品の検出（保存が成功したときだけ学習する）。
      // 案内（SpotlightTip＝透過Modal）は入力シート（pageSheet）が**閉じ切ってから**出す。
      // iOSは表示中/閉じかけのModalの兄弟に別のModalを出せないため、直後に出すと表示されないことがある
      try {
        await recordItems(items, viewDate);
        const s2 = await pickSuggestion(myFoods.map((f) => f.name), viewDate);
        if (s2) { queueTip(() => setSuggest(s2)); await markShown(viewDate); }
        else if (await shouldShowDietTip(dietProfile)) {
          // 食事の制約が未設定のまま解析を何度も使っている人にだけ、存在を知らせる
          queueTip(() => setDietTip(true)); await markDietTipShown();
        }
      } catch { /* 案内は本体機能に影響させない */ }
      return true;
    } finally {
      setSaving(false);
    }
  }

  // 体重の保存本体（体重カードと＋シートの「体重」の両方から呼ぶ）。
  // 戻り値: null=成功／文字列=エラー文（＋シートは自分の中に出す・カードは画面のメッセージ欄へ）
  async function saveWeightValue(text: string): Promise<string | null> {
    // 入力は表示単位（kg/lb）。DBは常にkgで保存する
    const w = displayToKg(Number(text), units.weight);
    if (!uid || !(w > 20 && w < 300)) return t('体重の値を確認してください。');
    // G8: 前回から±15%以上ずれた値は誤入力の可能性が高い。保存前に一度だけ確かめる
    if (!(await confirmOutlierWeight(latestWeight, w))) return '';   // 本人が取り消した＝メッセージ無し
    setSaving(true);
    try {
      const { error } = await supabase.from('logs').insert({
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: Math.round(w * 10) / 10, ex: 'オフ', adj: 0, mood: '', text: '', photo_urls: [],
      });
      if (error) return t('保存に失敗しました。もう一度お試しください。');
      await syncEntriesForDate(uid, today);
      await load();
      setMsg({ ok: true, text: t('体重 {w} を記録しました。', { w: fmtWeight(w) }) });
      return null;
    } finally {
      setSaving(false);
    }
  }
  // 体重カードのエラーはカードの中に出す（画面上部のメッセージ欄はカードから遠く、気づけない）
  const [wErr, setWErr] = useState<string | null>(null);
  async function saveWeight() {
    setWErr(null);
    const err = await saveWeightValue(wWeight);
    if (err !== null) { if (err) setWErr(err); return; }
    setWWeight('');
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
      // 第5引数＝その日の運動ぶん（maintenance − 土台）。ヒーローの目標と同じく、運動ぶんはBMR下限の上に乗せる
      out.push({ date: d, intake: r?.intake == null ? null : Number(r.intake), maintenance, allowance: dailyAllowance(maintenance, req, Math.round(bmr), kcalAdjust, maintenance - base) });
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
  }, [profile, todayKey]);

  // ===== B-7: Day12「最初の法則」の帯 =====
  // 記録12日到達＋法則1件以上を初検出したら、21:05の通知予約＋この帯を一度きり出す。
  // 判定・永続化はlib/laws側（'bl-day12-done'）。帯はタップ/×で消化され、以後は出ない
  const [firstLaw, setFirstLaw] = useState(false);
  // スタートチェックリストが表示条件（登録14日以内・未完了）を満たしているか（子から通知・調停の候補に使う）
  const [checklistLive, setChecklistLive] = useState(false);
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
  // 「くわしく記録する」: その日へ移動して入力シート（テキスト）を開き、品目まで入れられるようにする。
  // 手軽さ（±0/食べすぎたの2択）はそのまま残す
  function backfillDetail() {
    if (!backfill) return;
    setViewDate(backfill.date);
    setBackfill(null); // 詳しく書きにいくので帯は畳む（未記録のままなら次回起動でまた出る）
    setTimeout(() => openInput('text'), 300);
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
  }, [todayKey]);

  async function backfillSave(extra: number) {
    if (!backfill || !profile || !uid || backfillBusy) return;
    setBackfillBusy(true);
    try {
      const baseEst = Math.round(mifflinBMR(profile.sex, weightForBmr, Number(profile.height_cm), Number(profile.age)) * Number(profile.life_factor));
      const { error } = await supabase.from('logs').insert({
        user_id: uid, date: backfill.date, at: `${backfill.date}T21:00:00+09:00`,
        items: [], kcal: baseEst + extra, p: null, f: null, c: null, weight: null,
        ex: 'オフ', adj: 0, mood: '',
        text: extra > 0 ? t('（あとから概算: 食べすぎ +{n}kcal）', { n: extra }) : t('（あとから確定: だいたい目安どおり）'),
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
    AsyncStorage.getItem('bl-mood-snooze').then((v) => setMoodSnoozed(v === todayKey)).catch(() => {});
  }, [todayKey]);
  const [moodBusy, setMoodBusy] = useState(false);
  const hasMoodToday = dayLogs.some((l) => l.mood);
  const showMood = viewDate === todayKey && profile != null && !hasMoodToday && !moodSnoozed;
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
  const isViewToday = viewDate === todayKey;
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

  // ===== マイ食品チップ（入力シートの中） =====
  // タップ=トレイへ・−で減・長押しドラッグで並び替え。▦/▬で1行スクロール⇄全展開。
  // 先頭にセット（複数品目）のチップ（皿アイコン＋アクセント面で区別・タップでセット全品目をトレイへ・
  // 長押しで削除→Undoスナックバー）。セットは常に先頭固定＝並び替えの保存対象は単品だけ。
  // 「マイ食品」から開いたときは選ぶのが目的なので常に全展開にする（1行スクロールで探させない）
  const chipsGrid = foodsView === 'grid' || inputMode === 'myfood';
  const myFoodsSection = (myFoods.length > 0 || myMeals.length > 0) ? (() => {
    const mealChipEl = (m: MyMeal) => (
      <Pressable key={m.id} style={s.mealChip}
                 onPress={() => tapMeal(m)}
                 onLongPress={() => deleteMealNow(m)} delayLongPress={450}>
        <UtensilsCrossed size={13} color={C.teal} />
        <Text style={s.mealChipT} numberOfLines={1}>{m.name}</Text>
      </Pressable>
    );
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
      /* 案内（SpotlightTip）のハイライト対象。ScrollViewの外側のViewに付ける */
      <View style={s.sheetSection} ref={chipsRef} collapsable={false}>
        <View style={s.sheetSectionHead}>
          <Text style={s.sheetSectionT}>{t('マイ食品')}</Text>
          <Text style={s.sheetSectionSub} numberOfLines={1}>{t('タップでトレイへ・長押しで即記録')}</Text>
          {inputMode !== 'myfood' && (
            <Pressable onPress={toggleFoodsView} hitSlop={8} style={s.viewToggle}>
              <Text style={s.viewToggleT}>{foodsView === 'row' ? '▦' : '▬'}</Text>
            </Pressable>
          )}
        </View>
        {!chipsGrid ? (
          <ReorderableChips
            order={[...myMeals.map((m) => `meal:${m.id}`), ...foodsOrder]}
            // 並び替えの永続化はマイ食品のidだけ（セットは次の描画で先頭に戻る）
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
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>{[...myMeals.map(mealChipEl), ...orderedFoods.map(chipEl)]}</View>
        )}
      </View>
    );
  })() : null;

  // ===== ヒーロー直下の調停（lib/logCards.ts）: 何を何枚出すかは1か所で決める =====
  // カード最大2枚（caution > backfill > checklist > mood > positive）・帯最大2本（badge > firstLaw > brief）。
  // 過去日を表示中は「今日は〜」のもの（caution/backfill/mood/positive/brief）を候補から外す
  const attention = arbitrateAttention({
    isToday: isViewToday,
    candidates: {
      caution: bingeRisk || cautionAlert ? 1 : 0,
      backfill: backfill ? 1 : 0,
      checklist: vis('checklist') && checklistLive ? 1 : 0,
      mood: vis('mood') && showMood ? 1 : 0,
      positive: positiveAlerts.length,
      badge: badgeIds.length > 0 ? 1 : 0,
      firstLaw: firstLaw ? 1 : 0,
      brief: brief ? 1 : 0,
    },
  });
  const shownPositive = positiveAlerts.slice(0, attention.positive);

  // マイ食品（セット）の登録シート（記録行の長押しメニュー／✓保存の長押しから。
  // alsoSave=✓保存長押し経由: セット登録に続けてトレイの通常保存も行う）。
  // 透過Modalなので、入力シート（pageSheet）が開いている間はその**内側**で、閉じている間はルートで描く
  // （iOSは表示中のModalの兄弟として別のModalを出せない）。同時に2つはマウントされない
  const saveMealSheetEl = (
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
          setMsg({ ok: true, text: t('マイ食品「{name}」を登録しました。＋ → 食事 → マイ食品から1タップで呼び出せます。', { name }) });
        }
      }}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        ref={scrollRef}
        automaticallyAdjustKeyboardInsets
        // 上端の余白はスティッキーヘッダー自身が持つ（insets.top）。下端は＋ボタン（56px）の下を通れるぶん空ける
        contentContainerStyle={[s.scroll, { paddingTop: 0, paddingBottom: insets.bottom + 84 }]}
        stickyHeaderIndices={STICKY_FIRST}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(e) => { scrollYNow.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={32}
      >
        {/* タイトル＋日付ストリップは上端に貼り付く（「日付は下にスクロールしても固定表示」）。
            日付ストリップ長押しでカード編集モード（隠し操作）は従来どおり */}
        <TabHeader
          title={t('食事')}
          right={(
            <Animated.View style={enter[0]}>
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
          )}
        />

        {/* 🔥ストリーク常設チップ（タップで実績ページへ） */}
        <StreakChip />

        {/* 今日のひとこと帯（ヘッダーとヒーローの間・タップで展開・×でその日は閉じる）。帯の3本目なら出ない（調停） */}
        {brief && attention.brief > 0 && (
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
            {/* 「何を食べる？」の主導線: 残量が出ている＝いちばん悩む瞬間に1行で相談へ（components/WhatToEatSheet.tsx） */}
            <Pressable style={({ pressed }) => [s.eatBtn, pressed && { opacity: 0.8 }]} onPress={() => setEatOpen(true)}
                       accessibilityRole="button" accessibilityLabel={t('この残りで、何を食べる？')}>
              <Sparkles size={ICON.sm} color={C.accentInk} strokeWidth={ICON.stroke} />
              <Text style={s.eatBtnT}>{t('この残りで、何を食べる？')}</Text>
              <Text style={s.eatBtnArrow}>›</Text>
            </Pressable>
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
        {attention.badge > 0 && (
          <Pressable style={[s.lawBand, { marginTop: -8 }]} onPress={() => dismissBadgeBand(true)} accessibilityRole="button">
            <BadgeIcon id={badgeIds[0]} size={30} earned />
            <Text style={s.lawBandT} numberOfLines={2}>
              {badgeIds.length > 1
                ? t('{n}つのバッジを獲得しました', { n: badgeIds.length })
                : t('「{name}」バッジを獲得しました', { name: badgeById(badgeIds[0])?.name ?? '' })}
            </Text>
            <Text style={s.lawBandGo}>{t('見にいく')} →</Text>
            <Pressable hitSlop={10} onPress={() => dismissBadgeBand(false)} accessibilityRole="button" accessibilityLabel={t('閉じる')}>
              <Text style={s.lawBandX}>×</Text>
            </Pressable>
          </Pressable>
        )}

        {/* B-7: 最初の法則の帯（一度きり。タップで法則図鑑へ・×は見ずに消化）。
            バッジの帯と同じ位置・同じ文法（以前はヘッダーとヒーローの間にあり、帯が2か所に散っていた） */}
        {attention.firstLaw > 0 && (
          <Pressable style={[s.lawBand, attention.badge === 0 && { marginTop: -8 }]} onPress={() => dismissFirstLaw(true)} accessibilityRole="button">
            <BookOpen size={16} color={C.teal} />
            <Text style={s.lawBandT}>{t('あなたの最初の法則が見つかりました')}</Text>
            <Text style={s.lawBandGo}>{t('見にいく')} →</Text>
            <Pressable hitSlop={10} onPress={() => dismissFirstLaw(false)} accessibilityRole="button" accessibilityLabel={t('閉じる')}>
              <Text style={s.lawBandX}>×</Text>
            </Pressable>
          </Pressable>
        )}

        {/* スタートチェックリスト（新規ユーザーの最初の1週間・登録14日以内だけ・自動判定）。
            判定は子が続け（onVisible で候補になる）、枠が無い回は suppressed で描かない */}
        {vis('checklist') && (
          <StartChecklist
            editing={editing}
            onHide={() => cards.hide('checklist')}
            onFocusInput={() => openInput('text')}
            onTakePhoto={() => openInput('camera')}
            onFocusWeight={() => wInputRef.current?.focus()}
            refreshKey={dayLogs.length}
            onVisible={setChecklistLive}
            suppressed={attention.checklist === 0}
          />
        )}

        {/* 昨日の穴埋めカード（責めないトーン） */}
        {backfill && attention.backfill > 0 && (
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
        {attention.caution > 0 && (
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
        {shownPositive.map((a) => (
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
        {attention.mood > 0 && (
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

        {/* 操作の結果（保存・書き換え・削除・失敗）はフィードの直上に出す。
            以前はフィードと広告の下にあり、✓保存でシートが閉じた直後の「保存しました。」が
            画面外（記録が多い日ほど下）に出て見えなかった（2026-09-02 自己監査） */}
        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
        {msg?.upgrade && (
          // 上限到達（429 plan_limit）→ kindに応じた文脈見出しつきペイウォールへ（src=limit_*）
          <Pressable onPress={() => router.push(`/paywall?src=limit_${msg.kind ?? 'text'}` as never)} hitSlop={8}
            style={({ pressed }) => [{ alignSelf: 'flex-start', marginTop: -4, marginBottom: 10 }, pressed && { opacity: 0.7 }]}>
            <Text style={{ color: C.accentInk, fontWeight: '700', fontSize: 14 }}>{t('プランを見る →')}</Text>
          </Pressable>
        )}

        {/* 今日のフィード */}
        {vis('feed') && (
        <Animated.View style={[s.card, enter[2]]}>
          <MinusBadge editing={editing} onPress={() => cards.hide('feed')} />
          <Text style={s.h2}>{t('今日の記録')}<Text style={s.h2sub}>{t('— {n}件', { n: dayLogs.length })}</Text></Text>
          {dayLogs.length === 0 && <Text style={s.mutedT}>{t('まだ記録がありません。右下の＋から1回分ずつ記録しましょう。')}</Text>}
          {dayLogs.map((l) => {
            const items = (l.items ?? []) as FoodItem[];
            return (
            <View key={l.id}>
            {/* 記録行のタイポグラフィは components/FoodRowText.tsx に集約（品名15/700・量12.5/600・
                PFCラベル色＋数値・kcal右寄せ固定幅）。トレイの品目行とまったく同じ階層で読める */}
            <Pressable style={({ pressed }) => [s.feedRow, pressed && { opacity: 0.6 }]}
                       onPress={() => {
                         // 品目が2つ以上あるときだけ展開する意味がある
                         if (items.length >= 2) setOpenLog((cur) => (cur === l.id ? null : l.id));
                       }}
                       onLongPress={() => confirmDeleteLog(l)} delayLongPress={450}>
              <Text style={s.feedTime}>{timeJST(l.at)}</Text>
              {moodLevelOf(l) == null && <Text style={s.feedIcon}>{logIcon(l)}</Text>}
              <View style={{ flex: 1 }}>
                {moodLevelOf(l) != null
                  ? <MoodInline level={moodLevelOf(l)!} />
                  : items.length > 0
                    ? <ItemsTitle items={items} />
                    : <Text style={s.feedTitle} numberOfLines={2}>{logTitle(l)}</Text>}
                {l.kcal != null && l.p != null && (
                  <PfcInline p={Number(l.p)} f={Number(l.f ?? 0)} c={Number(l.c ?? 0)} />
                )}
              </View>
              {l.kcal != null && <KcalCell kcal={Number(l.kcal)} />}
            </Pressable>

            {/* 展開: 品目ごとに栄養素を出し、1品だけ消せるようにする
                （1回の食事というまとまりは保ったまま、中身を個別に扱う） */}
            {openLog === l.id && items.map((it, ix) => (
              <View key={`${l.id}-${ix}`} style={s.itemRow}>
                <View style={{ flex: 1 }}>
                  <FoodName name={it.name} qty={it.qty} />
                  <PfcInline p={Number(it.p) || 0} f={Number(it.f) || 0} c={Number(it.c) || 0} />
                </View>
                <KcalCell kcal={Number(it.kcal) || 0} unit={false} />
                <Pressable onPress={() => deleteOneItem(l, ix)} hitSlop={10}>
                  <Text style={s.itemX}>×</Text>
                </Pressable>
              </View>
            ))}
            </View>
            );
          })}
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
              <Text style={{ color: C.sub, fontSize: 15, fontWeight: '800' }}>{recentOpen ? t('▴ とじる') : t('▾ ひらく')}</Text>
            </Pressable>
            {recentOpen && (
              <>
                {recentMeals.map((m) => (
                  <View key={m.id} style={[s.feedRow, { alignItems: 'center' }]}>
                    <Text style={s.feedTime}>{m.date.slice(5).replace('-', '/')}</Text>
                    <View style={{ flex: 1 }}><ItemsTitle items={m.items} /></View>
                    <KcalCell kcal={Number(m.kcal)} />
                    <Pressable style={s.reuseBtn} hitSlop={6} onPress={() => reuseMeal(m)}>
                      <Text style={s.reuseBtnT}>↺</Text>
                    </Pressable>
                  </View>
                ))}
                <Text style={[s.mutedT, { fontSize: 13, marginTop: 6 }]}>{t('↺でトレイに入り、入力シートが開きます。品目を×で外して量を調整してから✓保存してください。')}</Text>
              </>
            )}
          </View>
        )}

        {/* 体重クイック入力。入力ミスの文言はカードの中に出す（画面上部のメッセージ欄は遠くて気づけない） */}
        {vis('weight') && (
        <Animated.View style={[s.card, enter[2]]}>
          <MinusBadge editing={editing} onPress={() => cards.hide('weight')} />
          <View style={[s.wRow, { marginTop: 0 }]}>
            <TextInput ref={wInputRef} style={s.wInput} placeholder={latestWeight != null ? kgToDisplay(latestWeight, units.weight).toFixed(1) : '—'}
                       placeholderTextColor={C.faint} keyboardType="decimal-pad" value={wWeight} onChangeText={setWWeight}
                       accessibilityLabel={t('体重を記録')} />
            <Text style={s.wUnit}>{units.weight}</Text>
            <OptionButton variant="tonal" label={t('体重を記録')} leading={<Weight size={15} color={C.ink} />}
                          onPress={saveWeight} busy={saving} disabled={!wWeight} />
          </View>
          {wErr && <Text style={[s.mutedT, { color: C.coral, fontSize: 13, marginTop: 8 }]}>{wErr}</Text>}
        </Animated.View>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ===== 右下の＋ボタン（唯一の入力の入口。旧・下部固定ドックは 2026-09-02 に廃止） =====
          起動時の時差入場の最後（enter[3]）で浮かび上がる。トレイに書きかけがあれば件数バッジ */}
      <Animated.View style={[StyleSheet.absoluteFill, enter[3]]} pointerEvents="box-none">
        <PlusFab onPress={() => { setMsg(null); setPlusOpen(true); }} badge={parsed?.items.length ?? 0} />
      </Animated.View>

      {/* 1段目「食事／運動／体の写真／体重」→ 2段目（食事: 入力方法4つ・体重: シート内で保存） */}
      <PlusSheet
        visible={plusOpen} onClose={() => setPlusOpen(false)} onAction={onPlusAction}
        onSaveWeight={saveWeightValue}
        weightUnit={units.weight}
        weightPlaceholder={latestWeight != null ? kgToDisplay(latestWeight, units.weight).toFixed(1) : '—'}
      />

      {/* 「何を食べる？」（食事タブ内のAI相談・pageSheet）。ヒーローの1行ボタンと＋シート1段目のタイルから開く。
          「これにする」はシートが閉じ切ってから届く → 入力欄に品名を充填してテキスト入力シートを開く（自動確定しない） */}
      <WhatToEatSheet
        visible={eatOpen} onClose={() => setEatOpen(false)}
        remaining={{
          kcal: left,
          p: macros ? Math.round(macros.p) - eatenP : null,
          f: macros ? Math.round(macros.f) - eatenF : null,
          c: macros ? Math.round(macros.c) - eatenC : null,
        }}
        myFoods={myFoods}
        onPick={(name) => { setChat(name); openInput('text'); }}
      />

      {/* ===== 入力シート（pageSheet）: 旧ドックの機能はすべてここに集約 =====
          上から: ヘッダー（食事 › 入力方法・いつの記録か・×）→ 残量ストリップ（常設）→
          スクロール領域（メッセージ・書き換え中バナー・トレイ・量調整・マイ食品）→ 下端のコンポーザー
          （写真サムネ・複数行テキスト・🎤/カメラ/ライブラリ/外食おすすめ・↑送信）。
          キーボードは KeyboardAvoidingView（pageSheet の中なら日本語IMEの候補バーで揺れる旧問題は起きにくい＝
          シート全体が持ち上がるだけで、下に固定ドックがあった頃のタブバー分の過剰リフトは無い） */}
      <Modal visible={inputOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeInput} onShow={onInputShown} onDismiss={flushPendingTip}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap}>
          <View style={[s.sheetHead, { paddingTop: sheetTopPad(14) }]}>
            <View style={{ flex: 1 }}>
              {/* 前の選択を見せる（「食事 › テキストで入力」）。＋シートの2段目で選んだ入力方法がそのまま見出しになる */}
              <Text style={s.sheetCrumb} numberOfLines={1}>
                <Text style={s.sheetCrumbPrev}>{t('食事')} › </Text>{INPUT_MODE_LABEL()[inputMode]}
              </Text>
              {/* いつの記録か（過去日はアンバー）。時刻は本人が「食べた時間」を選んだときだけ添える
                  （「いま」はDB側のnow()で決まるので出さない＝嘘の時刻を見せない） */}
              <Text style={[s.sheetDate, !isViewToday && s.sheetDatePast]}>
                {t('{date} の記録', { date: dateLabelOf(viewDate) })}
                {parsed != null && mealTimeResolved !== MEAL_TIME_NOW && (
                  <Text style={s.sheetTime}>{'  '}{mealTimeResolved}</Text>
                )}
              </Text>
            </View>
            <Pressable onPress={closeInput} hitSlop={10} style={s.sheetClose} accessibilityRole="button" accessibilityLabel={t('閉じる')}>
              <X size={ICON.lg} color={C.sub} strokeWidth={ICON.stroke} />
            </Pressable>
          </View>

          {/* 残量ストリップ（常設）: 入力欄を見た瞬間に「あと何kcal・PFC残」が必ず目に入る（旧ドックから移植） */}
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

          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.sheetScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
            {msg?.upgrade && (
              <Pressable onPress={() => { closeInput(); router.push(`/paywall?src=limit_${msg.kind ?? 'text'}` as never); }} hitSlop={8}
                style={({ pressed }) => [{ alignSelf: 'flex-start', marginTop: -4, marginBottom: 8 }, pressed && { opacity: 0.7 }]}>
                <Text style={{ color: C.accentInk, fontWeight: '700', fontSize: 14 }}>{t('プランを見る →')}</Text>
              </Pressable>
            )}

            {/* 「マイ食品」から開いたときは選ぶのが目的なので、チップ一覧を先頭に */}
            {inputMode === 'myfood' && myFoodsSection}

            {editingId != null && (
              <View style={s.editBanner}>
                <Text style={s.editBannerT}>{t('✏️ 記録を書き換え中')}</Text>
                <Pressable onPress={cancelEdit} hitSlop={8}>
                  <Text style={s.editBannerCancel}>{t('やめる')}</Text>
                </Pressable>
              </View>
            )}

            {/* ステージングトレイ: チップ/AI解析の結果はここに積まれ、✓保存で初めてDBに書かれる */}
            {(parsed != null || jobs.length > 0 || aiNote != null) && (
              <View style={s.tray}>
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

                {/* 品目行（フィードと同じタイポグラフィ: 品名15/700・量12.5/600・PFCラベル色＋数値・kcal右寄せ固定幅）。
                    以前は横スクロールのチップだったが、全画面のシートになって縦に並べられるので
                    「何を・どれだけ・栄養は」を1行で読める記録行の形に統一した。タップで注目（量調整）・×で外す */}
                {parsed?.items.map((it, i) => {
                  const on = focusItem === i;
                  const dlv = dietLevelByName.get(it.name) ?? null;
                  return (
                    <Pressable key={i} onPress={() => setFocusItem(on ? null : i)}
                               style={[s.trayRow, on && s.trayRowOn, dlv === 'high' && s.trayRowDietHigh, dlv === 'maybe' && s.trayRowDietMaybe]}>
                      {dlv && <DietMark level={dlv} />}
                      <View style={{ flex: 1 }}>
                        <FoodName name={it.name} qty={it.qty} />
                        <PfcInline p={it.p} f={it.f} c={it.c} />
                      </View>
                      <KcalCell kcal={it.kcal} />
                      <Pressable hitSlop={8} onPress={() => removeTrayItem(i)} style={s.trayRowX}><Text style={s.trayX}>×</Text></Pressable>
                    </Pressable>
                  );
                })}

                {/* 品目以外のチップ（体重・運動レベル・解析中/失敗の送信）。横に並べる */}
                {(parsed?.weight != null || (parsed?.ex && parsed.ex !== 'オフ') || jobs.length > 0) && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginTop: 6 }}>
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
                )}

                {parsed != null && (
                  <View style={s.trayActions}>
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
            {/* 量調整ポップ（トレイ直下にインライン展開・Modal不使用）: 品目行のタップで開き、
                倍率チップ1タップでその品のkcal/PFCを再計算する。もう一度行を押すと閉じる */}
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
                {/* 食材ナビ「かしこい置き換え」（2026-09-03）: この品目の得意な栄養素を、より少ない（増量なら多い）kcalで
                    取れる食材があるときだけ1行。「🍊×4 ≒ 🫑×1」の対比＋栄養素を限定した文（lib/smartSwap の規約）。
                    タップで栄養ランキング図鑑のその品目の置き換え候補へ。ヒーロー直下の調停（logCards）対象外＝トレイ内の行 */}
                {(() => {
                  const sw = swapsFor(parsed.items[focusItem].name, { mode: purposeKey === 'bulk' ? 'bulk' : 'cut' })[0];
                  if (!sw) return null;
                  const delta = swapKcalDelta(sw);
                  return (
                    <Pressable style={({ pressed }) => [s.swapRow, pressed && { opacity: 0.7 }]}
                               onPress={() => router.push({ pathname: '/nutrient-rank', params: { food: parsed.items[focusItem].name } } as never)}
                               accessibilityRole="button" accessibilityLabel={t('かしこい置き換え')}>
                      <Text style={s.swapLabel}>{t('かしこい置き換え')}</Text>
                      <Text style={s.swapT} numberOfLines={2}>
                        <Text style={s.swapEmoji}>{emojiText(sw.from)} ≒ {emojiText(sw.to)}</Text>{'  '}{swapLine(sw)}{delta ? `（${delta}）` : ''}
                      </Text>
                    </Pressable>
                  );
                })()}
              </View>
            )}

            {inputMode !== 'myfood' && myFoodsSection}

            {/* 何も無いときの一言（テキスト/写真経路の初回）。トレイもマイ食品も無い空白を放置しない */}
            {parsed == null && jobs.length === 0 && aiNote == null && myFoods.length === 0 && myMeals.length === 0 && (
              <Text style={s.sheetEmpty}>{t('「バナナと卵2個」のように書くか、写真を送ると、AIがカロリーとPFCを出してトレイに載せます。')}</Text>
            )}
          </ScrollView>

          {/* ===== コンポーザー（下端）: 写真サムネ・複数行テキスト・補助ボタン・↑送信 ===== */}
          <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            {photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} keyboardShouldPersistTaps="handled">
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
            <TextInput
              ref={inputRef} multiline
              style={s.composerInput}
              placeholder={t('ここをタップして食事を入力…')} placeholderTextColor={C.sub}
              value={chat} onChangeText={setChat}
            />
            <View style={s.composerBar}>
              {/* 音声入力（1500人監査Later群「入力が遅い層への救済」）: キーボードのマイクへの道しるべ */}
              <VoiceHintButton onFocusInput={() => inputRef.current?.focus()} />
              {/* カメラ1本で料理も成分表示も（AIが読み分ける）。ライブラリは複数選択 */}
              <DockIconButton Icon={Camera} onPress={takePhoto} disabled={photos.length >= 4} />
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
              <View style={{ flex: 1 }} />
              <Pressable style={[s.dockSend, !canSend && { opacity: 0.35 }]} onPress={sendQuick} disabled={!canSend}
                         accessibilityRole="button" accessibilityLabel={t('送信')}>
                <ArrowUp color="#fff" size={ICON.md} strokeWidth={ICON.strokeBold} />
              </Pressable>
            </View>
          </View>

          {/* 食べた時間のピッカー（15分刻み）。iOSはスピナー＋「決定」、Androidは端末のダイアログで即確定。
              入力シート（pageSheet）の内側に置く: iOSは表示中のModalの兄弟に別のModalを出せない */}
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
          {/* ✓保存の長押しからのセット登録は、シートの内側でだけ描く（同じ理由） */}
          {saveMealSheetEl}
        </KeyboardAvoidingView>
      </Modal>
      {/* 削除のUndoスナックバー（＋ボタンの上に重ねる。触れない領域は素通し） */}
      {undoBar.element}
      <AddCardSheet
        visible={addOpen} onClose={() => setAddOpen(false)}
        hidden={cards.layout.hidden} shownKeys={cards.visible} labels={LOG_LABELS()} onShow={cards.show}
      />
      <SpotlightTip
        visible={suggest != null}
        // チップは入力シートの中にあるので、シートが開いているときだけハイライトする（閉じていれば中央カード）
        targetRef={inputOpen && myFoods.length > 0 ? chipsRef : undefined}
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
      {/* マイ食品（セット）の登録シート: 記録行の長押しメニューから（入力シートが閉じているとき）。
          入力シートが開いている間は、その内側で同じ要素を描く（上の saveMealSheetEl） */}
      {!inputOpen && saveMealSheetEl}
      {/* おかえりフロー: 発火判定はコンポーネント内で完結（マウント直後のみ→既存Modalと競合しない） */}
      <ComebackSheet onSaved={load} />
      {/* ステータスバー領域はスティッキーヘッダー（TabHeader）が覆うので StatusBarMask は置かない */}
      <HeaderGear />
    </View>
  );
}

const s = themed(() => ({
  scroll: { padding: SPACE.screen },
  // B-7: 最初の法則の帯（今日のひとこと帯と同じ「帯」の文法・アクセント面で一段目立たせる）
  lawBand: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: RADIUS.tile, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  lawBandT: { flex: 1, fontSize: 13, fontWeight: '800', color: C.ink, lineHeight: 18 },
  lawBandGo: { fontSize: 13, fontWeight: '800', color: C.accentInk },
  lawBandX: { fontSize: 17, color: C.faint, fontWeight: '700', paddingHorizontal: 2 },
  addBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  doneBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.chip, backgroundColor: C.teal },
  doneBtnT: { color: '#fff', fontSize: 13, fontWeight: '800' },
  hero: {
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: RADIUS.card, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 18,
    marginBottom: 20,   // 記録リストとの間だけ広くする（カード同士は12）
  },
  heroL: { fontSize: 13, fontWeight: '700', color: C.sub, letterSpacing: 0.5 },
  heroN: { fontSize: 44, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginVertical: 2 },
  heroU: { fontSize: 17, color: C.sub, fontWeight: '600' },
  // アクティブぶんの上乗せ内訳（目標が増えた理由の1行）。増加は良い知らせなのでアクセント色
  heroActive: { fontSize: 12, fontWeight: '800', color: C.accentInk, marginTop: 4 },
  // 「この残りで、何を食べる？」（ヒーロー末尾の1行導線）: アクセントの薄い面に載せ、目標調整より一段目立たせる
  eatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: RADIUS.input,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder,
  },
  eatBtnT: { flex: 1, fontSize: 14, fontWeight: '800', color: C.accentInk },
  eatBtnArrow: { fontSize: 17, fontWeight: '700', color: C.accentInk },
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
  // 展開した品目行。記録行より一段内側に置き、従属関係を見せる（文字の階層は FoodRowText と共通）
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingLeft: 48, paddingRight: 2,
    borderTopWidth: 1, borderTopColor: C.hairline,
  },
  itemX: { fontSize: 17, fontWeight: '800', color: C.coral, paddingHorizontal: 4 },
  // 記録行（2026-09-02 視認性）: 上下12・区切りは C.hairline。品名/量/PFC/kcal は components/FoodRowText.tsx
  feedRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.hairline, gap: 8 },
  feedTime: { fontSize: 13, color: C.faint, fontWeight: '700', width: 40, paddingTop: 3, fontVariant: ['tabular-nums'] },
  feedIcon: { fontSize: 15, marginRight: 2, paddingTop: 1 },
  // 品目内訳の無い行（体重・運動・概算・メモ）の見出し。品名と同じ 15/700
  feedTitle: { fontSize: 15, fontWeight: '700', color: C.ink, lineHeight: 21 },
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
  // 食材ナビ「かしこい置き換え」（量調整ポップの下の1行）
  swapRow: { marginTop: 8, backgroundColor: C.chipBg, borderRadius: RADIUS.input, paddingHorizontal: 10, paddingVertical: 7 },
  swapLabel: { fontSize: 11, fontWeight: '800', color: C.accentInk, letterSpacing: 0.4 },
  swapT: { fontSize: 12.5, color: C.sub, lineHeight: 18, marginTop: 2 },
  swapEmoji: { fontSize: 13, fontWeight: '800', color: C.ink },
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
  // ===== 入力シート（pageSheet） =====
  sheetWrap: { flex: 1, backgroundColor: C.bg },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: SPACE.screen, paddingBottom: 8 },
  // 前の選択を含む見出し（「食事 › テキストで入力」）。前段は補助色で一段引く
  sheetCrumb: { fontSize: 20, fontWeight: '800', color: C.ink },
  sheetCrumbPrev: { color: C.sub, fontWeight: '700' },
  // 「いつの記録か」（旧ドック最上部から移植）。過去日はアンバーで気づかせる（DateStripの過去表現と同系色）
  sheetDate: { fontSize: 12, fontWeight: '700', color: C.faint, marginTop: 2, fontVariant: ['tabular-nums'] },
  sheetDatePast: { color: C.amber, fontWeight: '800' },  // 生HEX禁止（ダーク対応はCトークン経由）
  // 選んだ「食べた時間」を日付に薄く添える（本人が選んだ時刻なので出してよい・「いま」は出さない）
  sheetTime: { color: C.faint, fontWeight: '700' },
  sheetClose: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.chipBg },
  sheetScroll: { paddingHorizontal: SPACE.screen, paddingTop: 6, paddingBottom: 16 },
  sheetSection: { marginTop: 4, marginBottom: 10 },
  sheetSectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sheetSectionT: { fontSize: 15, fontWeight: '800', color: C.ink },
  sheetSectionSub: { flex: 1, fontSize: 11, fontWeight: '600', color: C.faint },
  sheetEmpty: { fontSize: 13, color: C.sub, lineHeight: 19, marginTop: 8 },
  // 下端のコンポーザー（旧ドック本体）。面は C.panel、上に薄い区切り
  composer: {
    backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.hairline,
    paddingHorizontal: SPACE.screen, paddingTop: 10,
  },
  composerInput: {
    minHeight: 44, maxHeight: 132, fontSize: 17, fontWeight: '600', color: C.ink,
    paddingVertical: 8, paddingHorizontal: 4, textAlignVertical: 'top',
  },
  composerBar: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  // 食べた時間チップ列（トレイ上部・警告行の下・品目行の上）
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
  dockSend: { backgroundColor: C.teal, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  viewToggle: { marginLeft: 6, width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel },
  viewToggleT: { fontSize: 13, color: C.sub, fontWeight: '700' },
  // 残量ストリップ（シート上部・常設）
  preview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACE.screen, paddingBottom: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: C.hairline },
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
  // ステージングトレイ（入力シートの中・縦積み）
  tray: {
    backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: RADIUS.tile, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8,
  },
  // 品目行（フィードの記録行と同じ文字階層。面は C.panel、注目中はアクセント縁）
  trayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.input,
    paddingVertical: 10, paddingHorizontal: 10, marginTop: 6,
  },
  trayRowOn: { borderColor: C.teal, borderWidth: 1.5 },
  // 食事の制約（B-18・§5）: high=赤縁＋⚠️ / maybe=アンバーの縁。塗りは変えず縁だけ（責め色で埋めない）
  trayRowDietHigh: { borderColor: C.coral, borderWidth: 1.5 },
  trayRowDietMaybe: { borderColor: C.amber },
  trayRowX: { paddingLeft: 4 },
  trayActions: { flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'flex-end', marginTop: 10 },
  trayChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.chip,
    paddingHorizontal: 10, paddingVertical: 5, marginRight: 6, maxWidth: 190,
  },
  trayChipT: { fontSize: 13, fontWeight: '700', color: C.ink },
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
  trayX: { fontSize: 15, fontWeight: '800', color: C.coral, marginLeft: 2 },
  traySave: { backgroundColor: C.teal, borderRadius: RADIUS.chip, paddingHorizontal: 18, paddingVertical: 11, minWidth: 150, alignItems: 'center' },
  traySaveT: { color: '#fff', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
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
