// 食事タブ（Phase 1コア）: ヒーロー・今日のフィード・AI解析コンポーザー・マイ食品チップ・体重クイック入力
// ロジックはWeb版のlib/*をそのまま移植して使用（データ・計算式は完全互換）
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, Image, Alert, Animated, Easing,
} from 'react-native';
import { Pencil, History, Camera, Images, Weight, Activity, ChevronDown, ArrowUp } from 'lucide-react-native';
import DockIconButton from '@/components/DockIconButton';
import DateStrip from '@/components/DateStrip';
import { Chip, OptionButton } from '@/components/ui/Selectable';
import { pfcAdvice, PFC_LABEL, PFC_SHORT } from '@/lib/pfcAdvice';
import { pfcColors } from '@/lib/theme';
import { useUnits, displayToKg, kgToDisplay, fmtWeight } from '@/lib/units';
import { Keyboard } from 'react-native';
import { useKeyboardVisible } from '@/lib/useKeyboardVisible';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { analyzeFood, saveParsed } from '@/lib/quicklog';
import { syncEntriesForDate } from '@/lib/sync';
import { C } from '@/lib/ui';
import { mifflinBMR, EX_ADD, todayJST, type ExLevel } from '@/lib/calc';
import { assessBingeRisk, type BingeRisk, type InsightDay } from '@/lib/insights';
import { detectStruggle } from '@/lib/adaptive';
import { summarizeDay, dayExerciseKcal, type LogRow } from '@/lib/day';
import { sumItems, type FoodItem } from '@/lib/items';
import { addServing, removeServing, servingCount, type MyFoodRow } from '@/lib/foods';
import { logIcon, logTitle } from '@/lib/feed';
import StatusBarMask from '@/components/StatusBarMask';
import { useGuide, useGuideTarget, useGuideScroller } from '@/components/GuideTour';
import { useLaunch } from '@/components/LaunchIntro';
import ReorderableChips from '@/components/ReorderableChips';
import HeaderGear from '@/components/HeaderGear';
import { computePlan, macroTargets, type Goal, type PlanEvent } from '@/lib/goal';
import { t } from '@/lib/i18n';

type Profile = { sex: 'male' | 'female'; height_cm: number; age: number; init_weight: number | null; life_factor: number; display_name: string };
type MyFood = MyFoodRow & { id: string };
type DayLog = LogRow & { id: string; at: string };
type Parsed = { items: FoodItem[]; weight: number | null; waist: number | null; ex: ExLevel | null; adj: number; mood: string | null };
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
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [wWeight, setWWeight] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; base64: string }[]>([]);
  const [recentMeals, setRecentMeals] = useState<RecentMeal[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  const [pendingTexts, setPendingTexts] = useState<string[]>([]);
  const [stagedNote, setStagedNote] = useState(''); // トレイ確定時にlogs.textへ書く元テキストの蓄積
  const [foodsView, setFoodsView] = useState<'row' | 'grid'>('row');
  const [foodsOrder, setFoodsOrder] = useState<string[]>([]);
  const [inputH, setInputH] = useState(40);

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
  const kbVisible = useKeyboardVisible();

  useEffect(() => { AsyncStorage.getItem('bl-foods-view').then((v) => { if (v === 'grid') setFoodsView('grid'); }).catch(() => {}); }, []);

  // 入力ドックのパルス発光（画面を開いた瞬間に「ここが入力欄」と分かるように）
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1250, useNativeDriver: false }),
      Animated.timing(glow, { toValue: 0, duration: 1250, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [glow]);
  const glowBorder = glow.interpolate({ inputRange: [0, 1], outputRange: ['rgba(5,150,105,0.45)', 'rgba(5,150,105,1)'] });
  const glowShadow = glow.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.3] });
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
  const macros = profile ? macroTargets(weightForBmr, goalKcal, goal?.protein_per_kg, goal?.fat_per_kg, goal?.fat_max_g) : null;
  const eatenP = Math.round(summary.p ?? 0);
  const eatenF = Math.round(summary.f ?? 0);
  const eatenC = Math.round(summary.c ?? 0);

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
    const res = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (res.canceled || !res.assets?.length) return;
    const p = await compressToPayload(res.assets[0].uri);
    if (p) setPhotos((prev) => [...prev, p].slice(0, 4));
  }

  async function pickPhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg({ ok: false, text: t('写真ライブラリの許可が必要です（設定アプリ→BodyLog）。') }); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 4 - photos.length, quality: 1,
    });
    if (res.canceled || !res.assets?.length) return;
    const list = (await Promise.all(res.assets.map((a) => compressToPayload(a.uri)))).filter(Boolean) as { uri: string; base64: string }[];
    setPhotos((prev) => [...prev, ...list].slice(0, 4));
  }

  // ===== ボトムドックからの送信: AI解析→トレイに積む（保存は✓保存で確定・連投可） =====
  const canSend = chat.trim().length > 0 || photos.length > 0;

  async function sendQuick() {
    if (!canSend || !uid) return;
    const text = chat.trim();
    const imgs = photos.map((p) => ({ data: p.base64, mime: 'image/jpeg' }));
    setChat(''); setPhotos([]); setMsg(null);
    inputRef.current?.focus(); // キーボードを閉じずに次の入力へ（連投）
    setPendingTexts((p) => [...p, text || t('（写真）')]);
    try {
      const res = await analyzeFood(text, imgs);
      if (!res.ok) { setMsg({ ok: false, text: res.error }); setChat(text); return; }
      const r = res.result;
      setParsed((p) => ({
        items: [...(p?.items ?? []), ...r.items],
        weight: r.weight ?? p?.weight ?? null,
        waist: r.waist ?? p?.waist ?? null,
        ex: r.ex ?? p?.ex ?? null,
        adj: r.adj || p?.adj || 0,
        mood: r.mood ?? p?.mood ?? null,
      }));
      if (text) setStagedNote((n) => (n ? `${n}、${text}` : text));
    } catch {
      setMsg({ ok: false, text: t('通信に失敗しました。電波状況を確認してください。') });
      setChat(text);
    } finally {
      setPendingTexts((p) => p.slice(1));
    }
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
  }

  // トレイの個別削除
  function removeTrayItem(i: number) {
    if (!parsed) return;
    const items = parsed.items.filter((_, j) => j !== i);
    if (items.length === 0 && parsed.weight == null && !parsed.ex) setParsed(null);
    else setParsed({ ...parsed, items });
  }
  function clearTray() {
    setParsed(null); setStagedNote('');
  }

  // 記録の取り消し: フィード行を長押し→削除（チップ即時追加の押し間違い対策）
  function confirmDeleteLog(l: DayLog) {
    Alert.alert(t('この記録を削除しますか？'), logTitle(l), [
      { text: t('キャンセル'), style: 'cancel' },
      {
        text: t('削除する'), style: 'destructive',
        onPress: async () => {
          await supabase.from('logs').delete().eq('id', l.id);
          if (uid) await syncEntriesForDate(uid, today);
          await load();
        },
      },
    ]);
  }

  // 過去の食事の品目一式を保存前確認へ投入（AI解析なし・栄養素は記録済みの値をそのまま使う）
  function reuseMeal(m: RecentMeal) {
    const items = [...(parsed?.items ?? []), ...m.items];
    setParsed((p) => ({ items, weight: p?.weight ?? null, waist: p?.waist ?? null, ex: p?.ex ?? null, adj: p?.adj ?? 0, mood: p?.mood ?? null }));
    setMsg({ ok: true, text: t('下のトレイに入れました。内容を確認して✓保存してください。') });
  }

  function titleOfItems(items: FoodItem[]): string {
    const names = items.slice(0, 3).map((it) => (it.qty && it.qty !== '×1' ? `${it.name} ${it.qty}` : it.name)).join('、');
    return names + (items.length > 3 ? ` ほか${items.length - 3}品` : '');
  }

  // トレイの内容を確定保存
  async function save() {
    if (!uid || !parsed) return;
    setSaving(true); setMsg(null);
    try {
      const res = await saveParsed(uid, parsed, stagedNote, viewDate);
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      setParsed(null); setStagedNote('');
      await load();
      setMsg({ ok: true, text: t('保存しました。') });
    } finally {
      setSaving(false);
    }
  }

  async function saveWeight() {
    // 入力は表示単位（kg/lb）。DBは常にkgで保存する
    const w = displayToKg(Number(wWeight), units.weight);
    if (!uid || !(w > 20 && w < 300)) { setMsg({ ok: false, text: t('体重の値を確認してください。') }); return; }
    setSaving(true);
    try {
      await supabase.from('logs').insert({
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: Math.round(w * 10) / 10, ex: 'オフ', adj: 0, mood: '', text: '', photo_urls: [],
      });
      await syncEntriesForDate(uid, today);
      setWWeight('');
      await load();
      setMsg({ ok: true, text: `体重 ${fmtWeight(w)} を記録しました。` });
    } finally {
      setSaving(false);
    }
  }

  // ===== 過食リスクの事前検知（Web版と同一ロジック・AsyncStorageで今日1回スヌーズ） =====
  const [bingeRisk, setBingeRisk] = useState<BingeRisk | null>(null);
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
      } catch { /* ベストエフォート */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

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
  const [backfill, setBackfill] = useState<{ date: string; binge: boolean } | null>(null);
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
          ? `昨日を「食べすぎ +${extra.toLocaleString()}kcal」として記録しました。今日から立て直しましょう！`
          : t('昨日を「目安どおり（±0）」で確定しました。'),
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
  }

  async function backfillSnooze() {
    try { await AsyncStorage.setItem('bl-backfill-snooze', todayJST()); } catch { /* 無視 */ }
    setBackfill(null);
  }


  const parsedTotal = parsed ? sumItems(parsed.items) : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(e) => { scrollYNow.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={32}
      >
        <Animated.View style={[s.brandRow, enter[0], { justifyContent: 'space-between', marginRight: 38 }]}>
          <Text style={s.pageTitle}>{t('食事')}</Text>
          <DateStrip value={viewDate} onChange={setViewDate} />
        </Animated.View>

        {/* ヒーロー */}
        {profile && (
          <Animated.View style={[s.hero, enter[1]]} ref={heroTarget} collapsable={false}>
            <Text style={s.heroL}>{left < 0 ? 'オーバー' : t('あと食べられる')}{plan ? '（計画）' : t('（維持）')}</Text>
            <Text style={[s.heroN, left < 0 && { color: C.coral }]}>
              {Math.abs(left).toLocaleString()}<Text style={s.heroU}> kcal</Text>
            </Text>
            <View style={s.hline}><View style={[s.hfill, { width: `${Math.min(100, Math.max(0, (eaten / Math.max(1, goalKcal)) * 100))}%` }, left < 0 && { backgroundColor: C.coral }]} /></View>
            <View style={s.heroMeta}>
              <Text style={s.metaT}>摂取 {eaten.toLocaleString()}</Text>
              <Text style={s.metaT}>目標 {goalKcal.toLocaleString()}</Text>
            </View>
            {/* 残りPFCプログレスバー（英字P/F/Cは初心者に伝わらないため日本語を主・英字は補助） */}
            {macros && (
              <View style={{ marginTop: 10, gap: 5 }}>
                {([
                  [PFC_LABEL.p, 'P', eatenP, macros.p, pfcColors().p],
                  [PFC_LABEL.f, 'F', eatenF, macros.f, pfcColors().f],
                  [PFC_LABEL.c, 'C', eatenC, macros.c, pfcColors().c],
                ] as const).map(([ja, ab, eat, tgt, col]) => {
                  const over = eat > tgt;
                  return (
                    <View key={ab} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={s.pfcL} numberOfLines={1}>{ja}<Text style={s.pfcAb}> {ab}</Text></Text>
                      <View style={s.pfcBar}>
                        <View style={[s.pfcFill, { width: `${Math.min(100, (eat / Math.max(1, tgt)) * 100)}%`, backgroundColor: over ? C.coral : col }]} />
                      </View>
                      <Text style={[s.pfcT, over && { color: C.coral }]}>{over ? `+${eat - tgt}g超過` : `あと${tgt - eat}g`}</Text>
                    </View>
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

        {/* 昨日の穴埋めカード（責めないトーン） */}
        {backfill && (
          <View style={[s.card, { borderColor: C.amber, borderWidth: 1.5 }]}>
            <Text style={s.h2}>{backfill.binge ? '🍃 昨日の分、ざっくりだけ記録しませんか' : t('📝 昨日の食事記録がありません')}</Text>
            <Text style={s.mutedT}>
              {backfill.binge
                ? t('食べすぎた日ほど、記録すると立て直しが速くなります。ざっくりでOK。誰にも見られません。')
                : t('ざっくりでOKです。未記録の日が続くと、収支の数字と現実が少しずつズレていきます。')}
            </Text>
            {!backfillMore ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <OptionButton style={{ flex: 1 }} label="目安どおり（±0）" onPress={() => backfillSave(0)} busy={backfillBusy} />
                <OptionButton style={{ flex: 1 }} variant="tonal" label="食べすぎた…" onPress={() => setBackfillMore(true)} disabled={backfillBusy} />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {[500, 1000, 2000].map((n) => (
                  <Chip key={n} label={`+${n.toLocaleString()}kcal くらい`} tone="ink" disabled={backfillBusy} onPress={() => backfillSave(n)} />
                ))}
              </View>
            )}
            <Pressable onPress={backfillSnooze} style={{ marginTop: 8, alignSelf: 'center' }} hitSlop={8}>
              <Text style={[s.mutedT, { textDecorationLine: 'underline' }]}>{t('あとで')}</Text>
            </Pressable>
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
              これは失敗のサインではなく、準備のサインです。たんぱく質多めの食事と「我慢しすぎない設定」が効きます。
            </Text>
            {plan && !todayEvent ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <OptionButton style={{ flex: 1 }} variant="teal" label="🕊 今日は+200kcal緩める" onPress={addRecoveryEvent} />
                <OptionButton style={{ flex: 1 }} variant="tonal" label="大丈夫、気をつける" onPress={snoozeRisk} />
              </View>
            ) : (
              <OptionButton style={{ marginTop: 10 }} variant="tonal" label="OK、気をつける" onPress={snoozeRisk} />
            )}
          </View>
        )}

        {/* 朝の気分カード（その日1回だけ・記録かスキップで消える） */}
        {showMood && (
          <View style={s.card}>
            <Text style={s.h2}>{t('💭 いまの気分は？')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              {(['😫', '😕', '😐', '🙂', '😄'] as const).map((e, i) => (
                <Pressable key={e} style={({ pressed }) => [s.moodBtn, pressed && { transform: [{ scale: 0.92 }], backgroundColor: C.segTrack }]}
                           disabled={moodBusy} onPress={() => saveMood(i + 1)}>
                  <Text style={{ fontSize: 26 }}>{e}</Text>
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
        <Animated.View style={[s.card, enter[2]]}>
          <Text style={s.h2}>{t('今日の記録')}<Text style={s.h2sub}>— {dayLogs.length}件</Text></Text>
          {dayLogs.length === 0 && <Text style={s.mutedT}>{t('まだ記録がありません。下から1回分ずつ記録しましょう。')}</Text>}
          {dayLogs.map((l) => (
            <Pressable key={l.id} style={({ pressed }) => [s.feedRow, pressed && { opacity: 0.6 }]}
                       onLongPress={() => confirmDeleteLog(l)} delayLongPress={450}>
              <Text style={s.feedTime}>{timeJST(l.at)}</Text>
              <Text style={{ fontSize: 13, marginRight: 2 }}>{logIcon(l)}</Text>
              <Text style={s.feedTitle} numberOfLines={2}>{logTitle(l)}</Text>
              {l.kcal != null && <Text style={s.feedKcal}>{Math.round(Number(l.kcal)).toLocaleString()}<Text style={s.feedU}> kcal</Text></Text>}
            </Pressable>
          ))}
          {dayLogs.length > 0 && <Text style={s.hint}>{t('行を長押しで削除できます')}</Text>}
        </Animated.View>

        {/* 前の食事をもう一度（過去記録のitemsを再利用・AI解析不要） */}
        {recentMeals.length > 0 && (
          <View style={s.card}>
            <Pressable style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                       onPress={() => setRecentOpen((v) => !v)} hitSlop={6}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <History size={14} color={C.teal} />
                <Text style={[s.h2, { marginBottom: 0 }]}>{t('前の食事をもう一度')}</Text>
              </View>
              <Text style={{ color: C.sub, fontSize: 13, fontWeight: '800' }}>{recentOpen ? '▴ とじる' : t('▾ ひらく')}</Text>
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
                <Text style={[s.mutedT, { fontSize: 11.5, marginTop: 6 }]}>{t('↺で下のトレイに入ります。品目を×で外して量を調整してから✓保存してください。')}</Text>
              </>
            )}
          </View>
        )}

        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}

        {/* 体重クイック入力 */}
        <Animated.View style={[s.card, enter[2]]}>
          <View style={[s.wRow, { marginTop: 0 }]}>
            <TextInput style={s.wInput} placeholder={latestWeight != null ? kgToDisplay(latestWeight, units.weight).toFixed(1) : '—'}
                       placeholderTextColor={C.faint} keyboardType="decimal-pad" value={wWeight} onChangeText={setWWeight} />
            <Text style={s.wUnit}>{units.weight}</Text>
            <OptionButton variant="tonal" label="体重を記録" leading={<Weight size={15} color={C.ink} />}
                          onPress={saveWeight} busy={saving} disabled={!wWeight} />
          </View>
        </Animated.View>

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ===== ボトム固定インプットドック（LINE風・キーボードに吸い付く） ===== */}
      <Animated.View style={[s.dockWrap, enter[3]]} ref={dockTarget} collapsable={false}>
        {/* 残量ストリップ（常設）: 入力欄を見た瞬間に「あと何kcal・PFC残」が必ず目に入る */}
        {profile != null && (() => {
          const addK = parsedTotal ? Math.round(parsedTotal.kcal) : 0;
          const pvLeft = left - addK;
          const pv = macros ? {
            p: macros.p - eatenP - (parsedTotal ? Math.round(parsedTotal.p) : 0),
            f: macros.f - eatenF - (parsedTotal ? Math.round(parsedTotal.f) : 0),
            c: macros.c - eatenC - (parsedTotal ? Math.round(parsedTotal.c) : 0),
          } : null;
          const fmt = (v: number, lb: string) => (v >= 0 ? `${lb} ${v}g` : `${lb} ${-v}g超過`);
          return (
            <View style={s.preview}>
              <Text style={[s.previewMain, pvLeft < 0 && { color: C.coral }]}>
                {parsed ? '追加後 ' : ''}{pvLeft >= 0 ? `残り ${pvLeft.toLocaleString()}kcal` : `${(-pvLeft).toLocaleString()}kcal 超過`}
              </Text>
              {pv && (
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
                      style={[s.previewSub, (pv.p < 0 || pv.f < 0 || pv.c < 0) && { color: C.coral }]}>
                  残り {fmt(pv.p, PFC_SHORT.p)}・{fmt(pv.f, PFC_SHORT.f)}・{fmt(pv.c, PFC_SHORT.c)}
                </Text>
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
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>×</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        {/* マイ食品チップ（タップ=トレイへ・−で減・長押しドラッグで並び替え。1行⇄全展開切替可） */}
        {myFoods.length > 0 && (() => {
          const chipEl = (fd: MyFood) => {
            const cnt = parsed ? servingCount(parsed.items, fd) : null;
            return (
              <View key={fd.id} style={[s.chip, cnt != null && s.chipOn]}>
                <Pressable onPress={() => tapFood(fd)} style={s.chipMain}>
                  <Text style={[s.chipT, cnt != null && { color: C.ink }]}>
                    {cnt == null ? '＋ ' : ''}{fd.name}{cnt != null ? ` ×${cnt % 1 === 0 ? cnt : cnt.toFixed(1)}` : ''}
                  </Text>
                </Pressable>
                {cnt != null && (
                  <Pressable onPress={() => decFood(fd)} style={s.chipMinus} hitSlop={4}>
                    <Text style={{ color: C.coral, fontWeight: '800', fontSize: 15 }}>−</Text>
                  </Pressable>
                )}
              </View>
            );
          };
          const orderedFoods = foodsOrder.map((id) => myFoods.find((f) => f.id === id)).filter(Boolean) as MyFood[];
          return (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
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
        {(parsed != null || pendingTexts.length > 0) && (
          <View style={s.tray}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              {parsed?.items.map((it, i) => (
                <View key={i} style={s.trayChip}>
                  <Text style={s.trayChipT} numberOfLines={1}>
                    {it.name}{it.qty && it.qty !== '×1' ? ` ${it.qty}` : ''} <Text style={{ color: C.sub, fontSize: 10 }}>{Math.round(it.kcal)}kcal</Text>
                  </Text>
                  <Pressable hitSlop={8} onPress={() => removeTrayItem(i)}><Text style={s.trayX}>×</Text></Pressable>
                </View>
              ))}
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
              {pendingTexts.map((t, i) => (
                <View key={`p${i}`} style={s.trayChip}>
                  <ActivityIndicator size="small" color={C.teal} />
                  <Text style={[s.trayChipT, { marginLeft: 4 }]} numberOfLines={1}>{t}</Text>
                </View>
              ))}
            </ScrollView>
            {parsed != null && (
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Pressable onPress={clearTray} hitSlop={8}><Text style={s.trayClearT}>{t('破棄')}</Text></Pressable>
                <Pressable style={s.traySave} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : (
                    <Text style={s.traySaveT}>✓ 保存{parsedTotal && parsed.items.length > 0 ? ` ${Math.round(parsedTotal.kcal).toLocaleString()}kcal` : ''}</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        )}
        <Animated.View style={[s.dock, { borderColor: glowBorder, shadowOpacity: glowShadow }]}>
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
            style={[s.dockInput, { height: Math.max(38, Math.min(112, inputH)) }]}
            placeholder="ここをタップして食事を入力…" placeholderTextColor={C.sub}
            value={chat} onChangeText={setChat}
            onContentSizeChange={(e) => setInputH(e.nativeEvent.contentSize.height + 14)}
          />
          <DockIconButton Icon={Camera} onPress={takePhoto} disabled={photos.length >= 4} />
          <DockIconButton Icon={Images} onPress={pickPhotos} disabled={photos.length >= 4} />
          <Pressable style={[s.dockSend, !canSend && { opacity: 0.35 }]} onPress={sendQuick} disabled={!canSend}>
            <ArrowUp color="#fff" size={17} strokeWidth={3} />
          </Pressable>
        </Animated.View>
      </Animated.View>
      <StatusBarMask />
      <HeaderGear />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 64 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  brand: { fontSize: 21, fontWeight: '900', color: C.ink, letterSpacing: -0.5 },
  pageTitle: { fontSize: 21, fontWeight: '600', color: C.ink },
  betaPill: { backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  betaPillT: { fontSize: 9, fontWeight: '800', color: C.teal, letterSpacing: 0.8 },
  hero: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 18, marginBottom: 12 },
  heroL: { fontSize: 11, fontWeight: '700', color: C.sub, letterSpacing: 0.5 },
  heroN: { fontSize: 44, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginVertical: 2 },
  heroU: { fontSize: 15, color: C.sub, fontWeight: '600' },
  hline: { height: 7, backgroundColor: C.track, borderRadius: 4, overflow: 'hidden', marginVertical: 8 },
  hfill: { height: 7, backgroundColor: C.calorieBar, borderRadius: 4 },
  heroMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, flexWrap: 'wrap' },
  metaT: { fontSize: 12, color: C.sub, fontVariant: ['tabular-nums'] },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, marginBottom: 12 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink, letterSpacing: 0.8, marginBottom: 8 },
  h2sub: { fontWeight: '400', color: C.sub, letterSpacing: 0 },
  mutedT: { fontSize: 13, color: C.sub, lineHeight: 20 },
  feedRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 7, borderTopWidth: 0.5, borderTopColor: C.line, gap: 8 },
  feedTime: { fontSize: 11, color: C.faint, fontWeight: '700', width: 40, paddingTop: 2, fontVariant: ['tabular-nums'] },
  feedTitle: { flex: 1, fontSize: 14.5, color: C.ink, lineHeight: 20 },
  feedKcal: { fontSize: 14, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  feedU: { fontSize: 10, color: C.faint },
  msg: { fontSize: 13, fontWeight: '600', marginBottom: 10, paddingHorizontal: 4 },
  ta: {
    minHeight: 88, maxHeight: 180, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, padding: 12, fontSize: 16, color: C.ink, textAlignVertical: 'top',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel,
    borderWidth: 1.5, borderColor: C.line, borderRadius: 999, marginRight: 6, overflow: 'hidden',
  },
  chipOn: { borderColor: C.ink },
  chipMain: { paddingVertical: 9, paddingLeft: 13, paddingRight: 11 },
  chipMinus: { paddingVertical: 9, paddingHorizontal: 12, borderLeftWidth: 1.5, borderLeftColor: C.line },
  chipT: { fontSize: 12.5, fontWeight: '700', color: C.sub },
  moodBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14,
    backgroundColor: C.chipBg, borderWidth: 1, borderColor: C.line, marginBottom: 8,
  },
  btnPrimary: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  btnPrimaryT: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  wRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  wInput: {
    width: 90, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    padding: 10, fontSize: 16, color: C.ink, textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  wUnit: { fontSize: 13, color: C.sub, fontWeight: '600' },
  btnGhost: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhostT: { color: C.ink, fontSize: 13, fontWeight: '800' },
  chipBtn: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  chipBtnT: { fontSize: 12.5, fontWeight: '700', color: C.sub },
  reuseBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  reuseBtnT: { color: '#fff', fontSize: 16, fontWeight: '800' },
  dockWrap: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.line },
  dock: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 4,
    backgroundColor: '#ffffff', borderWidth: 2, borderColor: C.teal, borderRadius: 18,
    paddingHorizontal: 8, paddingVertical: 6,
    shadowColor: C.teal, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.18, elevation: 8,
  },
  dockIconBtn: { padding: 4 },
  dockIcon: { fontSize: 18 },
  dockInput: { flex: 1, fontSize: 16, fontWeight: '600', color: C.ink, paddingVertical: 7, paddingHorizontal: 4 },
  pencilBadge: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  dockSend: { backgroundColor: C.teal, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dockSendT: { color: '#fff', fontSize: 17, fontWeight: '800' },
  viewToggle: { marginLeft: 6, width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel },
  viewToggleT: { fontSize: 12, color: C.sub, fontWeight: '700' },
  preview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 7, gap: 8 },
  tray: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: 14, paddingHorizontal: 8, paddingVertical: 7, marginBottom: 7,
  },
  trayChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5, marginRight: 6, maxWidth: 190,
  },
  trayChipT: { fontSize: 11.5, fontWeight: '700', color: C.ink },
  trayX: { fontSize: 14, fontWeight: '800', color: C.coral, marginLeft: 2 },
  traySave: { backgroundColor: C.teal, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  traySaveT: { color: '#fff', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  trayClearT: { fontSize: 11, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  previewMain: { fontSize: 12.5, fontWeight: '800', color: C.teal, fontVariant: ['tabular-nums'] },
  previewSub: { fontSize: 11.5, fontWeight: '600', color: C.sub, fontVariant: ['tabular-nums'] },
  pfcL: { width: 74, fontSize: 11, fontWeight: '800', color: C.sub },
  pfcAb: { fontSize: 9.5, fontWeight: '700', color: C.faint },
  adviceBox: {
    marginTop: 8, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9,
  },
  adviceT: { fontSize: 12, color: C.ink, lineHeight: 19, fontWeight: '500' },
  pfcBar: { flex: 1, height: 6, backgroundColor: C.track, borderRadius: 3, overflow: 'hidden' },
  pfcFill: { height: 6, borderRadius: 3 },
  pfcT: { width: 86, fontSize: 10.5, color: C.sub, textAlign: 'right', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 10, color: C.faint, textAlign: 'right', marginTop: 6 },
  thumbWrap: { marginRight: 8 },
  thumb: { width: 64, height: 64, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  thumbX: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
});
