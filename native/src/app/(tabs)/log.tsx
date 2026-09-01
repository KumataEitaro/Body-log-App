// 食事タブ（Phase 1コア）: ヒーロー・今日のフィード・AI解析コンポーザー・マイ食品チップ・体重クイック入力
// ロジックはWeb版のlib/*をそのまま移植して使用（データ・計算式は完全互換）
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, Image, Alert, Animated, Easing,
} from 'react-native';
import { Pencil, History, Camera, Images, Weight, Activity, ChevronDown, ArrowUp, Smile, Sparkles, ScanBarcode } from 'lucide-react-native';
import DockIconButton from '@/components/DockIconButton';
import AdBanner from '@/components/AdBanner';
import BarcodeScanner from '@/components/BarcodeScanner';
import { lookupBarcode, packageNutrition } from '@/lib/foodDb';
import DateStrip from '@/components/DateStrip';
import { LiveBar, GhostPair, usePulse } from '@/components/LivePreviewBar';
import SpotlightTip from '@/components/SpotlightTip';
import MyFoodForm, { type MyFoodDraft } from '@/components/MyFoodForm';
import MenuAdvisor from '@/components/MenuAdvisor';
import { recordItems, pickSuggestion, markShown, markDeclined, type Suggestion } from '@/lib/foodSuggest';
import { removeItemAt } from '@/lib/itemLog';
import { previewFill } from '@/lib/preview';
import * as Haptics from 'expo-haptics';
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
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { analyzeFood, saveParsed } from '@/lib/quicklog';
import { syncEntriesForDate } from '@/lib/sync';
import { C, rgba } from '@/lib/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mifflinBMR, EX_ADD, todayJST, type ExLevel } from '@/lib/calc';
import { assessBingeRisk, type BingeRisk, type InsightDay } from '@/lib/insights';
import { buildDailyBrief, type Brief } from '@/lib/dailyBrief';
import DailyBrief from '@/components/DailyBrief';
import { getColumns } from '@/content/columns';
import { detectStruggle } from '@/lib/adaptive';
import { summarizeDay, dayExerciseKcal, type LogRow } from '@/lib/day';
import { sumItems, type FoodItem } from '@/lib/items';
import { addServing, removeServing, servingCount, type MyFoodRow } from '@/lib/foods';
import { logIcon, logTitle, moodLevelOf } from '@/lib/feed';
import { skipTodayReminder, scheduleFirstLawNotification } from '@/lib/notify';
import { checkFirstLawUnlock, consumeFirstLawBanner } from '@/lib/laws';
import { BookOpen } from 'lucide-react-native';
import StatusBarMask from '@/components/StatusBarMask';
import { useGuide, useGuideTarget, useGuideScroller } from '@/components/GuideTour';
import { useLaunch } from '@/components/LaunchIntro';
import ReorderableChips from '@/components/ReorderableChips';
import HeaderGear from '@/components/HeaderGear';
import StreakChip from '@/components/StreakChip';
import MoodFace, { MoodInline } from '@/components/MoodFace';
import ComebackSheet from '@/components/ComebackSheet';
import StartChecklist from '@/components/StartChecklist';
import { invalidateStreak } from '@/lib/achievements';
import { computePlan, macroTargets, type Goal, type PlanEvent } from '@/lib/goal';
import { t } from '@/lib/i18n';
import { useReduceMotion, useCountUp } from '@/lib/motion';
import { consumePendingMeal } from '@/lib/pendingMeal';
import { usePurpose, purposeOf } from '@/lib/purpose';
import { setDayStatus } from '@/lib/dayStatus';
import { confirmOutlierWeight } from '@/lib/guard';

type Profile = { sex: 'male' | 'female'; height_cm: number; age: number; init_weight: number | null; life_factor: number; display_name: string };
type MyFood = MyFoodRow & { id: string };
type DayLog = LogRow & { id: string; at: string };
type Parsed = { items: FoodItem[]; weight: number | null; waist: number | null; ex: ExLevel | null; adj: number; mood: string | null };
const LOG_CARDS = ['hero', 'checklist', 'mood', 'feed', 'recent', 'weight'];
const LOG_LABELS = (): Record<string, string> => ({
  hero: t('あと食べられる量'), checklist: t('スタートチェックリスト'), mood: t('いまの気分は？'),
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

export default function LogScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [events, setEvents] = useState<(PlanEvent & { id: string })[]>([]);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [myFoods, setMyFoods] = useState<MyFood[]>([]);
  const [dayLogs, setDayLogs] = useState<DayLog[]>([]);
  const [chat, setChat] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; upgrade?: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [wWeight, setWWeight] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; base64: string }[]>([]);
  const [recentMeals, setRecentMeals] = useState<RecentMeal[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  // 解析中の行。連投できるため配列。idで管理し、完了した本人の分だけを消す
  // （以前は slice(1) で先頭を消していたため、2件目が先に終わると1件目の表示が残り続けた）
  const [pendingTexts, setPendingTexts] = useState<{ id: number; text: string }[]>([]);
  // AIの会話的な返し（一言・仮定・聞き返し）。表示のみでDBには書かない
  const [aiNote, setAiNote] = useState<{ reply: string; questions: string[]; assumptions: string[] } | null>(null);
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
    AsyncStorage.getItem('bl-guide-done').then((v) => {
      if (!v) setTimeout(() => guide.start(), 900);
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

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    setUid(userId);
    const [profRes, goalRes, evRes, wRes, foodRes, logRes, recentRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('goals').select('*').maybeSingle(),
      supabase.from('events').select('id,date,title,extra_kcal').order('date', { ascending: true }),
      supabase.from('entries').select('weight,date').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
      supabase.from('my_foods').select('id,name,kind,unit,kcal,p,f,c,serving_label,serving_ratio').order('created_at', { ascending: true }).limit(30),
      supabase.from('logs').select('*').eq('date', viewDate).order('at', { ascending: true }),
      supabase.from('logs').select('id,date,items,kcal')
        .lt('date', viewDate).not('kcal', 'is', null)
        .order('at', { ascending: false }).limit(40),
    ]);
    if (profRes.data) setProfile(profRes.data as Profile);
    if (goalRes.data) setGoal(goalRes.data as Goal);
    setEvents((evRes.data as (PlanEvent & { id: string })[]) || []);
    if (wRes.data?.length) setLatestWeight(Number(wRes.data[0].weight));
    setMyFoods((foodRes.data as MyFood[]) || []);
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
  const target = profile ? Math.round(bmr * Number(profile.life_factor)) + Math.round(dayExerciseKcal(dayLogs)) : 0;
  const plan = goal && profile ? computePlan(goal, today, weightForBmr, events, goal.absorb_days) : null;
  const todayEvent = events.find((e) => e.date === today) ?? null;
  const planIntakeBase = plan ? Math.max(target - plan.requiredDailyWithEvents, Math.round(bmr)) : null;
  const planIntake = planIntakeBase != null && todayEvent ? planIntakeBase + Math.round(Number(todayEvent.extra_kcal)) : planIntakeBase;
  const goalKcal = planIntake ?? target;
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

  async function sendQuick() {
    if (!canSend || !uid) return;
    const text = chat.trim();
    const imgs = photos.map((p) => ({ data: p.base64, mime: 'image/jpeg' }));
    setChat(''); setPhotos([]); setMsg(null);
    inputRef.current?.focus(); // キーボードを閉じずに次の入力へ（連投）
    const pid = ++pendingSeq.current;
    setPendingTexts((p) => [...p, { id: pid, text: text || t('（写真）') }]);
    try {
      const res = await analyzeFood(text, imgs, parseHistory.current);
      if (!res.ok) { setMsg({ ok: false, text: res.error, upgrade: res.upgrade }); setChat(text); return; }
      const r = res.result;
      const ex2 = res.extras;
      // 会話の記憶は直近1往復だけ（古い文脈を引きずると誤解釈のもと）
      const aiSaid = [ex2.reply, ...ex2.questions].filter(Boolean).join(' ');
      parseHistory.current = [
        { role: 'user' as const, text },
        ...(aiSaid ? [{ role: 'ai' as const, text: aiSaid }] : []),
      ];
      // AIの一言。何も抽出できなかったときも、ここが必ず何か言う（無言の禁止）
      setAiNote(ex2.reply || ex2.questions.length || ex2.assumptions.length ? ex2 : null);
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
      if (text && r.items.length > 0) setStagedNote((n) => (n ? `${n}、${text}` : text));
    } catch {
      // analyzeFoodは例外を投げない作りだが、想定外の失敗でも必ずここで拾う
      setMsg({ ok: false, text: t('通信に失敗しました。電波状況を確認してください。') });
      setChat(text);
    } finally {
      setPendingTexts((p) => p.filter((x) => x.id !== pid));   // 自分の分だけ消す
    }
  }

  // マイ食品チップ: 長押しで「1回分をそのまま即記録」（トレイを経由しない最短経路）
  async function quickSaveFood(fd: MyFood) {
    if (!uid || saving) return;
    setSaving(true);
    try {
      const items = addServing([], fd);
      const r = await saveParsed(uid, {
        items, weight: null, waist: null, ex: null, adj: 0, mood: null,
      }, fd.name, viewDate);
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
    setParsed(null); setStagedNote(''); setFocusItem(null);
    setAiNote(null); parseHistory.current = [];
  }

  // 記録の長押しメニュー: 書き換え（トレイへ戻す）と削除
  function confirmDeleteLog(l: DayLog) {
    const items = (l.items as FoodItem[] | null) ?? [];
    const canEdit = items.length > 0 || l.weight != null;
    Alert.alert(canEdit ? t('この記録をどうしますか？') : t('この記録を削除しますか？'), logTitle(l), [
      { text: t('キャンセル'), style: 'cancel' },
      ...(canEdit ? [{ text: t('書き換える'), onPress: () => startEditLog(l) }] : []),
      {
        text: t('削除する'), style: 'destructive' as const,
        onPress: async () => {
          await supabase.from('logs').delete().eq('id', l.id);
          if (uid) await syncEntriesForDate(uid, today);
          await load();
        },
      },
    ]);
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
    editingDateRef.current = viewDate;
    setMsg({ ok: true, text: t('下のトレイに戻しました。直して✓保存すると置き換わります。') });
  }

  // 編集をやめる（記録は元のまま残る）
  function cancelEdit() {
    setParsed(null); setStagedNote(''); setFocusItem(null); setEditingId(null);
    editingDateRef.current = null;
    setMsg(null);
  }

  // 記録から1品目だけを取り除く（合計は残りから再計算される）
  async function deleteOneItem(l: DayLog, index: number) {
    const items = (l.items ?? []) as FoodItem[];
    const name = items[index]?.name ?? '';
    Alert.alert(t('「{name}」を削除しますか？', { name }), t('この食事の他の品目は残ります。'), [
      { text: t('キャンセル'), style: 'cancel' },
      {
        text: t('削除する'), style: 'destructive',
        onPress: async () => {
          const r = removeItemAt(items, index);
          const q = r.kind === 'delete'
            ? supabase.from('logs').delete().eq('id', l.id)
            : supabase.from('logs').update({ items: r.items, kcal: r.kcal, p: r.p, f: r.f, c: r.c }).eq('id', l.id);
          const { error } = await q;
          if (error) { setMsg({ ok: false, text: t('削除に失敗しました。もう一度お試しください。') }); return; }
          if (uid) await syncEntriesForDate(uid, viewDate);   // 日次サマリーを合わせる
          await load();
        },
      },
    ]);
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

  // トレイの内容を確定保存
  async function save() {
    if (!uid || !parsed) return;
    setSaving(true); setMsg(null);
    try {
      const items = parsed.items;   // setParsed(null)より前に控える（後段の学習で使う）
      // G8: AI解析で体重が載っているときも外れ値を確かめる（「52.8」を「528」と読む事故を保存前に止める）
      if (parsed.weight != null && !(await confirmOutlierWeight(latestWeight, Number(parsed.weight)))) {
        return;   // トレイは残る。体重チップの×で外すか、値を直して再保存できる
      }
      const res = await saveParsed(uid, parsed, stagedNote, viewDate);
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
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
      setParsed(null); setStagedNote(''); setFocusItem(null); setEditingId(null);
      editingDateRef.current = null;
      await load();
      setMsg(delFailed
        ? { ok: false, text: t('新しい内容は保存しましたが、元の記録を消せませんでした。重複した行を長押しで削除してください。') }
        : savedKcal > 2500
          ? { ok: true, text: t('記録できたこと自体が、大きな一歩です。明日、極端に減らす必要はありません。いつも通りで大丈夫。') }
          : { ok: true, text: wasEdit ? t('書き換えました。') : t('保存しました。') });

      invalidateStreak();   // 🔥チップを最新化
      // よく食べる食品の検出（保存が成功したときだけ学習する）
      try {
        await recordItems(items, viewDate);
        const s2 = await pickSuggestion(myFoods.map((f) => f.name), viewDate);
        if (s2) { setSuggest(s2); await markShown(viewDate); }
      } catch { /* 案内は本体機能に影響させない */ }
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

  async function snoozeRisk() {
    try { await AsyncStorage.setItem('bl-risk-snooze', todayJST()); } catch { /* 無視 */ }
    setBingeRisk(null);
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

  // 保存前ライブプレビュー: トレイ（未保存）の合計。バーのゴースト表示に使う
  const pulse = usePulse(parsed != null);
  // トレイで注目している食品（バー上でその寄与だけを光らせる）
  const [focusItem, setFocusItem] = useState<number | null>(null);
  // 編集中の記録ID: セットされている間、✓保存はこの記録を置き換える（新規追加ではない）
  const [editingId, setEditingId] = useState<string | null>(null);
  // よく食べる食品の登録案内（保存後に1件だけ出す）
  const [suggest, setSuggest] = useState<Suggestion | null>(null);
  // 品目単位で操作するために展開している記録行（1回の食事＝1レコードのまま、中身を開く）
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [foodDraft, setFoodDraft] = useState<MyFoodDraft | null>(null);
  const chipsRef = useRef<View | null>(null);   // 案内でハイライトする対象
  // 編集を始めた日付。表示日を動かしたら編集を打ち切る（記録が別の日へ移るのを防ぐ）
  const editingDateRef = useRef<string | null>(null);
  useEffect(() => {
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

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        ref={scrollRef}
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
                <Plus size={16} color="#fff" strokeWidth={3} />
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
                : (left < 0 ? t('オーバー') : t('あと食べられる'))}
              {plan ? t('（計画）') : t('（維持）')}
            </Text>
            <Text style={[s.heroN, isBulk ? { color: left > 0 ? C.amber : C.teal } : left < 0 && { color: C.coral }]}>
              {Math.abs(heroLeft).toLocaleString()}<Text style={s.heroU}> kcal</Text>
            </Text>
            <View style={[s.hline, { flexDirection: 'row' }]}>
              <View style={[s.hfill, { width: `${previewFill(eaten, 0, goalKcal).basePct}%` }, left < 0 && { backgroundColor: isBulk ? C.teal : C.coral }]} />
              <GhostPair eaten={eaten} others={split('kcal').others} focus={split('kcal').focus}
                         target={goalKcal} color={C.calorieBar} pulse={pulse} />
            </View>
            <View style={s.heroMeta}>
              <Text style={s.metaT}>{t('摂取')} {eaten.toLocaleString()}</Text>
              <Text style={s.metaT}>{t('目標')} {goalKcal.toLocaleString()}</Text>
            </View>
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
                               onPress={() => router.push({ pathname: '/settings', params: { open: 'goalW', ts: String(Date.now()) } })}>
                      <Text style={s.pfcL} numberOfLines={1}>{t(ja)}<Text style={s.pfcAb}> {ab}</Text></Text>
                      <View style={[s.pfcBar, { flexDirection: 'row' }]}>
                        {segs.length > 0 && segs.length <= 5 ? segs.map((w, i) => (
                          <View key={i} style={{
                            width: `${w * scale}%`, height: '100%',
                            backgroundColor: over ? (bulkP ? col : C.coral) : col,
                            borderRightWidth: i < segs.length - 1 ? 1.5 : 0, borderRightColor: '#ffffff',
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
                <Text style={{ fontSize: 13, fontWeight: '700', color: C.teal, textDecorationLine: 'underline' }}>{t('くわしく記録する')}</Text>
              </Pressable>
              <Pressable onPress={backfillSnooze} hitSlop={8}>
                <Text style={[s.mutedT, { textDecorationLine: 'underline' }]}>{t('あとで')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* 過食リスクの事前アラート（理由つき・1タップ予防） */}
        {bingeRisk && (
          <View style={[s.card, { borderColor: bingeRisk.level === 'high' ? C.coral : C.amber, borderWidth: 1.5 }]}>
            <Text style={s.h2}>{bingeRisk.level === 'high' ? '🌪 今日は食欲が爆発しやすい状態です' : t('🌤 今日は食欲が乱れやすいかも')}</Text>
            {bingeRisk.reasons.map((r) => (
              <Text key={r.key} style={[s.mutedT, { lineHeight: 20 }]}>・{r.text}</Text>
            ))}
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
          </View>
        )}

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
          <Pressable onPress={() => router.push('/paywall' as never)} hitSlop={8}
            style={({ pressed }) => [{ alignSelf: 'flex-start', marginTop: 4, marginBottom: 6 }, pressed && { opacity: 0.7 }]}>
            <Text style={{ color: C.teal, fontWeight: '700', fontSize: 14 }}>{t('プランを見る →')}</Text>
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
      <Animated.View style={[s.dockWrap, { paddingBottom: insets.bottom + 8 }, enter[3]]} ref={dockTarget} collapsable={false}>
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
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>×</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        {/* マイ食品チップ（タップ=トレイへ・−で減・長押しドラッグで並び替え。1行⇄全展開切替可） */}
        {myFoods.length > 0 && (() => {
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
                    order={foodsOrder}
                    onOrderChange={persistFoodsOrder}
                    renderChip={(id) => {
                      const fd = myFoods.find((f) => f.id === id);
                      return fd ? chipEl(fd) : null;
                    }}
                  />
                </View>
              ) : (
                <ScrollView style={{ flex: 1, maxHeight: 150 }} keyboardShouldPersistTaps="handled">
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }}>{orderedFoods.map(chipEl)}</View>
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
        {(parsed != null || pendingTexts.length > 0 || aiNote != null) && (
          <View style={s.tray}>
            <View style={{ flex: 1 }}>
            {aiNote && (
              <View style={s.aiNoteRow}>
                <Sparkles size={12} color={C.teal} />
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {parsed?.items.map((it, i) => {
                const on = focusItem === i;
                return (
                  <Pressable key={i} style={[s.trayChip, on && s.trayChipOn]}
                             onPress={() => setFocusItem(on ? null : i)}>
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
                  <Weight size={12} color={C.sub} />
                  <Text style={s.trayChipT}>{parsed.weight}kg</Text>
                  <Pressable hitSlop={8} onPress={() => setParsed((p) => (p && (p.items.length > 0 || p.ex) ? { ...p, weight: null } : null))}>
                    <Text style={s.trayX}>×</Text>
                  </Pressable>
                </View>
              )}
              {parsed?.ex && parsed.ex !== 'オフ' && (
                <View style={s.trayChip}>
                  <Activity size={12} color={C.sub} />
                  <Text style={s.trayChipT}>{parsed.ex}</Text>
                </View>
              )}
              {pendingTexts.map((pt) => (
                <View key={`p${pt.id}`} style={s.trayChip}>
                  <ActivityIndicator size="small" color={C.teal} />
                  <Text style={[s.trayChipT, { marginLeft: 4 }]} numberOfLines={1}>{pt.text}</Text>
                </View>
              ))}
            </ScrollView>
            </View>
            {parsed != null && (
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Pressable onPress={clearTray} hitSlop={8}><Text style={s.trayClearT}>{t('破棄')}</Text></Pressable>
                <Pressable style={s.traySave} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : (
                    <Text style={s.traySaveT}>{editingId ? t('✓ 書き換える') : t('✓ 保存')}{parsedTotal && parsed.items.length > 0 ? ` ${Math.round(parsedTotal.kcal).toLocaleString()}kcal` : ''}</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        )}
        <View style={s.dock}>
          {/* 発光レイヤ: 全開の縁と影を重ね、opacityだけをネイティブで往復させる */}
          <Animated.View pointerEvents="none" style={[s.dockGlow, { opacity: glow }]} />
          {/* 通常時=「ここが入力欄」のペンサイン / キーボード表示中=しまうボタン */}
          {kbVisible ? (
            <Pressable style={s.pencilBadge} onPress={() => Keyboard.dismiss()} hitSlop={6}>
              <ChevronDown color={C.teal} size={19} strokeWidth={2.5} />
            </Pressable>
          ) : (
            <View style={s.pencilBadge}>
              <Pencil color={C.teal} size={16} strokeWidth={2.5} />
            </View>
          )}
          <TextInput
            ref={inputRef} multiline
            style={[s.dockInput, { height: Math.max(40, Math.min(132, inputH)) }]}
            placeholder={t('ここをタップして食事を入力…')} placeholderTextColor={C.sub}
            value={chat} onChangeText={setChat}
            onContentSizeChange={(e) => setInputH(e.nativeEvent.contentSize.height + 14)}
          />
          <DockIconButton Icon={Camera} onPress={takePhoto} disabled={photos.length >= 4} />
          <DockIconButton Icon={Images} onPress={pickPhotos} disabled={photos.length >= 4} />
          {/* バーコード→公式DB（ヒットすればAI枠を使わずトレイへ直行） */}
          <DockIconButton Icon={ScanBarcode} onPress={() => setScanOpen(true)} />
          {/* B-11 外食メニューおすすめ: ヒーローと同じ残量計算値を渡す。
              「これにする」は入力欄への充填まで（送信＝AI解析→トレイ→✓保存は本人の操作） */}
          {profile != null && (
            <MenuAdvisor
              remainingKcal={left}
              pRemain={macros ? Math.round(macros.p) - eatenP : null}
              onPick={(name) => { setChat(name); setTimeout(() => inputRef.current?.focus(), 500); }}
            />
          )}
          <Pressable style={[s.dockSend, !canSend && { opacity: 0.35 }]} onPress={sendQuick} disabled={!canSend}>
            <ArrowUp color="#fff" size={17} strokeWidth={3} />
          </Pressable>
        </View>
      </Animated.View>
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
      <MyFoodForm
        visible={foodDraft != null} draft={foodDraft}
        onClose={() => setFoodDraft(null)}
        onSaved={() => { load(); setMsg({ ok: true, text: t('マイ食品に追加しました。下のチップから1タップで足せます。') }); }}
      />
      {/* バーコードスキャナ（読み取り成功で即クローズ→公式DB照会→トレイ投入） */}
      <BarcodeScanner visible={scanOpen} onClose={() => setScanOpen(false)} onScanned={scannedBarcode} />
      {/* おかえりフロー: 発火判定はコンポーネント内で完結（マウント直後のみ→既存Modalと競合しない） */}
      <ComebackSheet onSaved={load} />
      <StatusBarMask />
      <HeaderGear />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  // B-7: 最初の法則の帯（今日のひとこと帯と同じ「帯」の文法・アクセント面で一段目立たせる）
  lawBand: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  lawBandT: { flex: 1, fontSize: 13, fontWeight: '800', color: C.ink, lineHeight: 18 },
  lawBandGo: { fontSize: 13, fontWeight: '800', color: C.teal },
  lawBandX: { fontSize: 17, color: C.faint, fontWeight: '700', paddingHorizontal: 2 },
  brand: { fontSize: 21, fontWeight: '900', color: C.ink, letterSpacing: -0.5 },
  addBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  doneBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: C.teal },
  doneBtnT: { color: '#fff', fontSize: 13, fontWeight: '800' },
  pageTitle: { fontSize: 26, fontWeight: '600', color: C.ink },
  hero: {
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(14,17,22,0.08)', borderRadius: 20, shadowColor: '#0e1116', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 18,
    marginBottom: 20,   // 記録リストとの間だけ広くする（カード同士は12）
  },
  heroL: { fontSize: 13, fontWeight: '700', color: C.sub, letterSpacing: 0.5 },
  heroN: { fontSize: 44, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginVertical: 2 },
  heroU: { fontSize: 17, color: C.sub, fontWeight: '600' },
  hline: { height: 7, backgroundColor: C.track, borderRadius: 4, overflow: 'hidden', marginVertical: 8 },
  hfill: { height: 7, backgroundColor: C.calorieBar, borderRadius: 4 },
  heroMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, flexWrap: 'wrap' },
  metaT: { fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(14,17,22,0.08)', borderRadius: 20, shadowColor: '#0e1116', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 16, marginBottom: 12 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink, letterSpacing: 0.8, marginBottom: 8 },
  h2sub: { fontWeight: '400', color: C.sub, letterSpacing: 0 },
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
    borderRadius: 14, padding: 12, fontSize: 17, color: C.ink, textAlignVertical: 'top',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel,
    borderWidth: 1.5, borderColor: C.line, borderRadius: 999, marginRight: 6, overflow: 'hidden',
  },
  chipOn: { borderColor: C.ink },
  chipMain: { paddingVertical: 9, paddingLeft: 13, paddingRight: 11 },
  chipMinus: { paddingVertical: 9, paddingHorizontal: 12, borderLeftWidth: 1.5, borderLeftColor: C.line },
  chipT: { fontSize: 13, fontWeight: '700', color: C.sub },
  moodBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14,
    backgroundColor: C.chipBg, borderWidth: 1, borderColor: C.line, marginBottom: 8,
  },
  btnPrimary: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  btnPrimaryT: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  wRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  wInput: {
    width: 90, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    padding: 10, fontSize: 17, color: C.ink, textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  wUnit: { fontSize: 15, color: C.sub, fontWeight: '600' },
  btnGhost: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhostT: { color: C.ink, fontSize: 15, fontWeight: '800' },
  chipBtn: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  chipBtnT: { fontSize: 13, fontWeight: '700', color: C.sub },
  reuseBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  reuseBtnT: { color: '#fff', fontSize: 17, fontWeight: '800' },
  dockWrap: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.line },
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
    backgroundColor: C.accentBadge, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
    maxWidth: '100%',
  },
  aiQChipT: { fontSize: 12, color: C.teal, fontWeight: '700' },
  tray: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: 14, paddingHorizontal: 8, paddingVertical: 7, marginBottom: 7,
  },
  trayChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5, marginRight: 6, maxWidth: 190,
  },
  trayChipT: { fontSize: 13, fontWeight: '700', color: C.ink },
  editBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.accentBadge, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6,
  },
  editBannerT: { fontSize: 13, fontWeight: '800', color: C.teal },
  editBannerCancel: { fontSize: 13, fontWeight: '800', color: C.sub, textDecorationLine: 'underline' },
  trayChipOn: { borderColor: C.teal, borderWidth: 1.5, backgroundColor: C.accentBadge },
  trayChipPfc: { fontSize: 11, fontWeight: '800', color: C.sub, marginTop: 1, fontVariant: ['tabular-nums'] },
  trayX: { fontSize: 15, fontWeight: '800', color: C.coral, marginLeft: 2 },
  traySave: { backgroundColor: C.teal, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  traySaveT: { color: '#fff', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  trayClearT: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  previewMain: { fontSize: 13, fontWeight: '800', color: C.teal, fontVariant: ['tabular-nums'] },
  previewBars: { flexDirection: 'row', gap: 10, flex: 1, alignItems: 'center', marginLeft: 10 },
  previewBarCol: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  previewBarAb: { fontSize: 11, fontWeight: '900', width: 10, textAlign: 'center' },
  previewBarV: { fontSize: 11, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'], minWidth: 30, textAlign: 'right' },
  previewSub: { fontSize: 13, fontWeight: '600', color: C.sub, fontVariant: ['tabular-nums'] },
  pfcL: { width: 80, fontSize: 13, fontWeight: '800', color: C.ink },
  pfcAb: { fontSize: 11, fontWeight: '700', color: C.faint },
  adviceBox: {
    marginTop: 8, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9,
  },
  adviceT: { fontSize: 13, color: C.ink, lineHeight: 19, fontWeight: '500' },
  pfcBar: { flex: 1, height: 7, backgroundColor: C.track, borderRadius: 4, overflow: 'hidden' },
  pfcFill: { height: '100%', borderRadius: 4 },
  pfcT: { width: 96, fontSize: 13, fontWeight: '800', color: C.ink, textAlign: 'right', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 11, color: C.faint, textAlign: 'right', marginTop: 6 },
  thumbWrap: { marginRight: 8 },
  thumb: { width: 64, height: 64, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  thumbX: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
});
