// 運動タブ: きょうの動き（ヘルスケア実測が主）＋ 運動を記録する（種目を毎回選ぶシート）＋ レストタイマー ＋ 筋トレを記録する（全画面）
// 筋トレ勢だけでなくライトユーザーも「今日も動けた」を記録できるようにする。
//
// 2026-09-02 再設計（熊田さんβFB）:
//   ・筋トレの入力はこのタブのカードから外し、全画面の記録画面（app/lift-session.tsx）へ。
//     ここには大きな主ボタン「筋トレを記録する」と、途中のセッションの再開導線だけを置く
//   ・「今日の消費カロリーを記録」の種目チップ列は廃止。基本はヘルスケア取り込みで、
//     手で足すときは「運動を記録する」→ 種目を毎回選ぶ → 時間ダイアル（components/ActivityLogSheet.tsx）
//   ・「きょうの動き」は1段小さく（順番は不変）。日付ストリップの行はスクロールしても上端に固定
import { useCallback, useEffect, useState } from 'react';
import { useThemeRefresh } from '@/lib/theme';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Modal, Vibration, AppState, Linking } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import TabHeader from '@/components/TabHeader';
import { healthAvailable, requestHealthAuth, linkHealth, ensureHealthAuth, activeEnergyAuthState, listWorkouts, importWorkouts, readActivitySummary, readHourlySteps, jstHourNow, invalidateActiveEnergyCache, type HKWorkout, type HealthDaySummary } from '@/lib/health';
import { useHealthLinkState, useHealthVersion } from '@/lib/healthStore';
import { activeKcalGoalBonus, useActiveKcalToGoal } from '@/lib/activeKcal';
import { resolveBurnKcal, stepsForKcal } from '@/lib/stepsKcal';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { usePurpose } from '@/lib/purpose';
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';
import { C, sheetTopPad, RADIUS, SPACE, ICON, HEAD, themed } from '@/lib/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { todayJST, mifflinBMR, LIFE_FACTOR_DEFAULT } from '@/lib/calc';
import { useTodayRollover } from '@/lib/rollover';
import { ClipboardList, Timer, Footprints, Target, Flame, Activity, Dumbbell, ChevronRight, Plus } from 'lucide-react-native';
import GoalPanel from '@/components/GoalPanel';
import { bumpRestCount } from '@/lib/achievements';
import { useGuide, useGuideTarget } from '@/components/GuideTour';
import ReorderableCards from '@/components/ReorderableCards';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateStrip from '@/components/DateStrip';
import WeekStepsBar, { useWeekStepsGoal } from '@/components/WeekStepsBar';
import RestDial, { fmtRest } from '@/components/RestDial';
import ActivityLogSheet from '@/components/ActivityLogSheet';
import { enqueue, flush, pendingCount, subscribePendingCount, isNetworkError } from '@/lib/offlineQueue';
import { LIFT_SESSION_KEY, REST_CHOICES, REST_DEFAULT_SEC, parseSessionState } from '@/lib/liftSession';
import { activityName, activityKcal, type Activity as ActivityKind } from '@/lib/activities';
import { bumpFoodFreq, readFoodFreq, foodScores } from '@/lib/foods';
import { AddCardSheet, useCardLayout, useCardOrder } from '@/components/CardLayout';
import { OptionButton } from '@/components/ui/Selectable';
import AdSlot from '@/components/AdSlot';
import { t } from '@/lib/i18n';

type HistRow = { id: string; date: string; text: string };

// 並び替え・表示/非表示できるカード（既定の並び: きょうの動き→運動を記録→レストタイマー→筋トレを記録）。
// 概要タブと同じ操作（日付ストリップ or カードの長押し→編集モード／ドラッグで並び替え／⊖で非表示／⊕で戻す）。
// 非表示は 'bl-cards-exercise'（useCardLayout）・並び順は 'bl-order-exercise'（useCardOrder）に別キーで保存。
// キー名（quick / liftInput）は保存済みの並び・非表示設定を壊さないため従来のまま
const EX_CARDS = ['move', 'quick', 'rest', 'liftInput'];
const EX_LABELS = (): Record<string, string> => ({
  move: t('きょうの動き'),
  quick: t('運動を記録する'),
  rest: t('レストタイマー'),
  liftInput: t('筋トレを記録する'),
});

export default function TrainingScreen() {
  useThemeRefresh(); // テーマ変更で再描画（再マウントはしない・lib/theme.ts）
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<HistRow[]>([]);
  const [restLeft, setRestLeft] = useState<number | null>(null); // レストタイマー残秒
  // レストの長さは人と種目で違う（高重量なら3分、追い込みなら45秒）。ダイアルで選んで記憶する（筋トレ記録画面と共有）
  const [restSec, setRestSec] = useState(REST_DEFAULT_SEC);
  const [restDial, setRestDial] = useState(false);
  const trainInputTarget = useGuideTarget('trainInput');
  const moveTarget = useGuideTarget('moveCard');   // ガイド章「食べる前に分かる」: きょうの動き（逆算の1行）
  const restTarget = useGuideTarget('restTimer');  // ガイド章「筋トレは全部無料」: レストタイマー
  const liftTarget = useGuideTarget('liftInput');  // ガイド章「筋トレは全部無料」: 筋トレを記録する
  const router = useRouter();
  // ガイドツアーの自動スクロールは ReorderableCards の onScroller 経由で登録する（概要タブと同じ）
  const guide = useGuide();

  // レストタイマーのカウントダウン（0になった瞬間にバイブで知らせる）
  useEffect(() => {
    if (restLeft == null || restLeft <= 0) return;
    const tm = setInterval(() => setRestLeft((v) => {
      if (v == null) return v;
      if (v <= 1) { try { Vibration.vibrate(500); } catch { /* 端末設定次第 */ } return 0; }
      return v - 1;
    }), 1000);
    return () => clearInterval(tm);
  }, [restLeft]);

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // 記録先の日付（既定=今日。過去日にも記録できる）
  const [viewDate, setViewDate] = useState(todayJST());
  // 日付跨ぎ（JST 0時）: 「今日」を見ていた人はタブに戻った/前景復帰したときに新しい今日へ追従（食事タブと同じ）
  useTodayRollover(viewDate, setViewDate);
  // 運動目標の編集モーダル
  const [goalOpen, setGoalOpen] = useState(false);
  // 表示/非表示（従来キー）と並び順（新キー）。編集モードの開始/確定/離脱時保存は useCardOrder が持つ
  const cards = useCardLayout('bl-cards-exercise', EX_CARDS);
  const orderCtl = useCardOrder('bl-order-exercise', EX_CARDS);
  const { editing, setEditing } = orderCtl;
  const hiddenCards = cards.layout.hidden;
  const visibleOrder = orderCtl.order.filter((k) => !hiddenCards.includes(k));
  // 表示中カードの並べ替え結果を、非表示カードの位置を保ったまま全体の順序へ戻す（概要タブと同じ）
  const setVisibleOrder = (nextVisible: string[]) => {
    let i = 0;
    orderCtl.setOrder(orderCtl.order.map((k) => (hiddenCards.includes(k) ? k : nextVisible[i++])));
  };
  // 最初の並び・表示に戻す
  function resetLayout() { cards.reset(); orderCtl.reset(); }
  const [addOpen, setAddOpen] = useState(false);

  // ===== オフラインキュー（ジム地下の圏外対策）=====
  // 圏外で保存に失敗した記録は端末に積まれる。ここはその「未同期件数」と自動送信の起点。
  const [pendingN, setPendingN] = useState(0);

  // ===== きょうの動き（消費kcal・歩数・目標への逆算）=====
  // コンセプト: 食事タブの「あと食べられる量」と同じ文法で「動き」を見せる。
  // 消費が見えるから、目標に対してあと何歩かを逆算できる。
  const purpose = usePurpose();
  const [burnToday, setBurnToday] = useState(0);
  const [entryToday, setEntryToday] = useState<{ intake: number | null; target: number | null }>({ intake: null, target: null });
  const [healthDays, setHealthDays] = useState<HealthDaySummary[] | null>(null);
  // 「アクティブカロリーを目標に反映する」（設定・既定OFF）。ONのときだけ逆算の目標に上乗せする
  const activeToGoal = useActiveKcalToGoal();
  // 上乗せ額の計算にはBMRと生活係数が必要（食事タブと同じ考え方＝二重計上を避ける式）
  const [prof, setProf] = useState<{ sex: 'male' | 'female'; height_cm: number; age: number; life_factor: number } | null>(null);
  const loadMove = useCallback(async (date: string) => {
    const [ls, en, pr] = await Promise.all([
      supabase.from('logs').select('adj').eq('date', date),
      supabase.from('entries').select('intake,target').eq('date', date).maybeSingle(),
      supabase.from('profiles').select('sex,height_cm,age,life_factor').maybeSingle(),
    ]);
    setBurnToday(((ls.data as { adj: number | null }[]) || []).reduce((sum, l) => sum + Math.max(0, Number(l.adj) || 0), 0));
    const e = en.data as { intake: number | null; target: number | null } | null;
    setEntryToday({
      intake: e?.intake != null ? Number(e.intake) : null,
      target: e?.target != null ? Number(e.target) : null,
    });
    setProf((pr.data as { sex: 'male' | 'female'; height_cm: number; age: number; life_factor: number } | null) ?? null);
  }, []);
  useEffect(() => { loadMove(viewDate); }, [viewDate, loadMove]);
  const loadHealth = useCallback(async (): Promise<HealthDaySummary[] | null> => {
    if (!healthAvailable()) return null;
    const r = await readActivitySummary(7);
    if ('error' in r) return null;
    setHealthDays(r);
    return r;
  }, []);
  // ヘルスケアの変更イベント（HKObserverQuery→healthStore）で世代が進むたびに読み直す＝
  // 定時ポーリングなしで「ヘルスケア側の数値が変わったきっかけで更新」になる
  const healthVer = useHealthVersion();
  const healthLink = useHealthLinkState();
  useEffect(() => { loadHealth(); }, [loadHealth, healthVer]);
  // 時間帯別の歩数（0-23時・ヘルスケア式バー）。HealthKitが無い環境ではnullのまま＝出さない
  const [hourlySteps, setHourlySteps] = useState<number[] | null>(null);
  const loadHourly = useCallback(async (date: string) => {
    if (!healthAvailable()) return;
    setHourlySteps(await readHourlySteps(date));
  }, []);
  useEffect(() => { loadHourly(viewDate); }, [viewDate, loadHourly, healthVer]);
  // 「ヘルスケアと連携する」（未連携のときだけ出る唯一の入口）。以後は自動同期なので二度と出ない
  async function connectHealth() {
    if (!healthAvailable()) { setMsg({ ok: false, text: t('歩数の自動表示はTestFlight版でのみ使えます（Expo Goでは動きません）。') }); return; }
    if (await linkHealth()) { await loadHealth(); loadHourly(viewDate); }
  }
  const dayOfView = healthDays?.find((d) => d.date === viewDate) ?? null;
  const stepsOfView = dayOfView?.steps ?? null;
  // 歩数の週目標（B-15・オフ=null）。日目標と違い1日サボっても取り返せる、ゆるい自己契約
  const weekStepsGoal = useWeekStepsGoal();

  // よく使う種目の実績（運動記録シートの「よく使う」並び）
  const [actFreq, setActFreq] = useState<Record<string, number>>({});
  useEffect(() => {
    setActFreq(foodScores(readFoodFreq()));
    AsyncStorage.getItem('bl-rest-sec').then((v) => {
      const n = Number(v);
      if (REST_CHOICES.includes(n)) setRestSec(n);
    }).catch(() => {});
  }, []);

  function pickRest(n: number) {
    setRestSec(n);
    AsyncStorage.setItem('bl-rest-sec', String(n)).catch(() => {});
    if (restLeft != null) setRestLeft(n);   // 動作中なら新しい長さで測り直す
    setRestDial(false);
  }

  // 途中の筋トレセッション（記録画面で保存せずに戻ってきた）。あれば「再開」導線を出す
  const [pendingSession, setPendingSession] = useState<{ sets: number; date: string } | null>(null);
  const readSession = useCallback(() => {
    AsyncStorage.getItem(LIFT_SESSION_KEY).then((raw) => {
      const st = parseSessionState(raw);
      setPendingSession(st && st.sets.length > 0 ? { sets: st.sets.length, date: st.date } : null);
    }).catch(() => {});
  }, []);
  const [actSheet, setActSheet] = useState(false);
  // 食事タブの＋シート「運動」から（/training?open=activity&ts=…）: 「運動を記録する」シートが開いた状態で着地する。
  // ts は同じ選択を続けて選んでも毎回開き直すためのノンス
  const { open: openParam, ts: openTs } = useLocalSearchParams<{ open?: string; ts?: string }>();
  useEffect(() => {
    if (openParam === 'activity') setActSheet(true);
  }, [openParam, openTs]);
  const [actSaving, setActSaving] = useState(false);
  const [myWeight, setMyWeight] = useState<number>(60);
  useEffect(() => {
    supabase.from('entries').select('date,weight').not('weight', 'is', null)
      .order('date', { ascending: false }).limit(1)
      .then(({ data }) => {
        const rows = (data as { date: string; weight: number | null }[] | null) ?? [];
        if (rows.length) setMyWeight(Number(rows[0].weight));
      });
  }, []);

  // ===== 消費kcalの出どころ（lib/stepsKcal.ts resolveBurnKcal に優先順位を固定） =====
  //   ① ヘルスケア実測（アクティブエネルギー）が >0 → それ
  //   ② 実測が 0/取れないが歩数 >0 → 歩数からの推定（歩数×0.0005×体重・「およそ」を明示）
  //   ③ どちらも無し → アプリ記録ぶん（logs adj）だけの従来表示
  const burn = resolveBurnKcal({
    measured: healthDays != null ? (dayOfView?.activeKcal ?? 0) : null,
    steps: stepsOfView,
    weightKg: myWeight,
    recorded: burnToday,
  });
  // 目標への上乗せに使える「アクティブ相当」。③は目標側にすでにadjで入っているので渡さない
  const activeOfView = burn.source !== 'recorded' ? burn.kcal : null;
  // アクティブエネルギーの読み取りが未許可らしい: 歩数は取れているのに直近7日の実測が全部0。
  const needsActiveAuth = healthDays != null && stepsOfView != null && !healthDays.some((d) => d.activeKcal > 0);
  const [authBusy, setAuthBusy] = useState(false);
  const [authHint, setAuthHint] = useState<string | null>(null);
  async function reauthActiveEnergy() {
    if (authBusy) return;
    setAuthBusy(true); setAuthHint(null);
    try {
      const st = await activeEnergyAuthState();
      if (st !== 'asked') {
        await requestHealthAuth();
        invalidateActiveEnergyCache();
        const r = await loadHealth();
        if (r && r.some((d) => d.activeKcal > 0)) return;   // 取れた。表示は①へ切り替わる
      }
      setAuthHint(t('許可のダイアログは一度しか出ません。iOSの「設定 > ヘルスケア > データアクセスとデバイス > BodyLoger」で「アクティブエネルギー」をオンにしてください（タップで設定を開く）。Apple Watchが無い場合は実測が無いことがあり、その間は歩数から推定します。'));
    } finally { setAuthBusy(false); }
  }

  // ヘルスケア取込モード（Apple Watch等のワークアウトを一括登録）
  const [hkOpen, setHkOpen] = useState(false);
  const [hkList, setHkList] = useState<HKWorkout[]>([]);
  const [hkSel, setHkSel] = useState<Set<string>>(new Set());
  const [hkBusy, setHkBusy] = useState(false);
  const [hkMsg, setHkMsg] = useState('');
  async function openHk() {
    if (!healthAvailable()) { setMsg({ ok: false, text: t('ヘルスケア取込はTestFlight版でのみ使えます（Expo Goでは動きません）。') }); return; }
    setHkOpen(true); setHkBusy(true); setHkMsg(''); setHkList([]);
    try {
      if (!(await ensureHealthAuth())) { setHkMsg(t('ヘルスケアへのアクセスが許可されませんでした。iOSの設定 > プライバシー > ヘルスケア から許可できます。')); return; }
      const r = await listWorkouts(30);
      if ('error' in r) { setHkMsg(r.error); return; }
      setHkList(r);
      setHkSel(new Set(r.map((w) => w.id)));
      if (r.length === 0) setHkMsg(t('直近30日のワークアウトが見つかりませんでした。'));
    } finally { setHkBusy(false); }
  }
  async function importSelected() {
    const items = hkList.filter((w) => hkSel.has(w.id));
    if (items.length === 0) return;
    setHkBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const r = await importWorkouts(uid, items);
      if ('error' in r) { setHkMsg(r.error); return; }
      setHkOpen(false);
      loadMove(viewDate);
      setMsg({ ok: true, text: t('⌚ {n}件を取り込みました{skip}。消費kcalが目標カロリーに反映されます。', { n: r.imported, skip: r.skipped > 0 ? t('（{n}件は取込済みでスキップ）', { n: r.skipped }) : '' }) });
    } finally { setHkBusy(false); }
  }

  /** 運動記録シートからの保存（種目・時間・距離はシートで決めてくる）。成功で true */
  async function saveActivity(a: ActivityKind, minutes: number, km: number | null): Promise<boolean> {
    setActSaving(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return false;
      const kcal = activityKcal(a, myWeight, minutes, km);
      const today = viewDate;
      const base = {
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: null, ex: 'オフ', adj: kcal, mood: '',
        // DBには canon（日本語固定）を書く。翻訳名を書くと言語切替で集計が分断される
        text: `🏃 ${a.canon} ${minutes}分${km ? ` ${km}km` : ''}（約${kcal}kcal消費）`, photo_urls: [],
      };
      // v17列（ex_minutes/ex_km）が無い旧DBでも保存できるようフォールバック
      let error: { message: string } | null = null;
      try {
        ({ error } = await supabase.from('logs').insert({ ...base, ex_minutes: minutes, ex_km: km }));
        if (error && /ex_minutes|ex_km|column|schema/i.test(error.message) && !isNetworkError(error)) {
          ({ error } = await supabase.from('logs').insert(base));
        }
      } catch (e) {
        error = { message: String((e as Error)?.message ?? e) };
      }
      if (error && isNetworkError(error)) {
        await enqueue({ ...base, ex_minutes: minutes, ex_km: km });
        bumpFoodFreq('act:' + a.id);
        setActFreq(foodScores(readFoodFreq()));
        setMsg({ ok: true, text: t('圏外のため端末に保存しました。電波が戻ったら自動で同期されます。') });
        return true;
      }
      if (error) { setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') }); return false; }
      await syncEntriesForDate(uid, today);
      loadMove(today); // 「きょうの動き」の消費kcalと逆算を即時更新
      bumpFoodFreq('act:' + a.id);
      setActFreq(foodScores(readFoodFreq()));
      setMsg({ ok: true, text: t('{act}を記録しました。目標カロリーに+{kcal}kcal反映されます🎉', { act: `${activityName(a.id)} ${minutes}${t('分')}${km ? ` ${km}km` : ''}`, kcal }) });
      doFlush().catch(() => {});
      return true;
    } finally { setActSaving(false); }
  }

  // 筋トレ履歴（フッターの導線の出し分けに使う。入力は記録画面へ移した）
  const load = useCallback(async () => {
    try {
      const { data } = await supabase.from('logs').select('id,date,text')
        .like('text', '🏋️%').order('at', { ascending: false }).limit(60);
      if (data) setHistory(data as HistRow[]);
    } catch { /* 圏外。手元のstateを保つ */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  // 記録画面（全画面）から戻ってきたとき: 途中セッションの有無・種目の実績・レストの長さ・
  // 保存したぶんの「きょうの動き」と履歴を読み直す
  useFocusEffect(useCallback(() => {
    readSession();
    setActFreq(foodScores(readFoodFreq()));
    AsyncStorage.getItem('bl-rest-sec').then((v) => { const n = Number(v); if (REST_CHOICES.includes(n)) setRestSec(n); }).catch(() => {});
    load(); loadMove(viewDate);
  }, [readSession, load, loadMove, viewDate]));

  // キューの自動送信。起点は ①タブのマウント ②アプリのフォアグラウンド復帰 ③保存成功時。
  const doFlush = useCallback(async () => {
    try {
      if ((await pendingCount()) === 0) return;
      const r = await flush();
      if (r.sent > 0) { await load(); loadMove(viewDate); }
    } catch { /* 次の起点で再試行される */ }
  }, [load, loadMove, viewDate]);
  useEffect(() => {
    pendingCount().then(setPendingN).catch(() => {});
    const off = subscribePendingCount(setPendingN);
    doFlush();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') doFlush(); });
    return () => { off(); sub.remove(); };
  }, [doFlush]);

  async function manualFlush() {
    setMsg(null);
    try {
      const r = await flush();
      if (r.sent > 0) { await load(); loadMove(viewDate); }
      if (r.left > 0) setMsg({ ok: false, text: t('まだ圏外のようです。電波が戻ったら自動で同期されます。') });
      else if (r.sent > 0) setMsg({ ok: true, text: t('{n}件を同期しました🎉', { n: r.sent }) });
    } catch {
      setMsg({ ok: false, text: t('まだ圏外のようです。電波が戻ったら自動で同期されます。') });
    }
  }

  /** 筋トレ記録画面（全画面）を開く。見ている日付を記録先として渡す */
  function openLiftSession() {
    // typed routesの生成型が新画面を知らないため as never（laws.tsx/changes.tsxと同じ流儀）
    router.push({ pathname: '/lift-session', params: { date: viewDate } } as never);
  }

  // ===== 固定ヘッダー（見出し＋日付ストリップ）: 食事・概要タブと共通の TabHeader（stickyHeaderIndices で上端に固定） =====
  // ステータスバー領域は TabHeader 自身の paddingTop（insets.top）で覆う（StatusBarMask は重ねない）
  const stickyJSX = (
    <TabHeader
      title={t('運動')}
      right={editing ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable onPress={() => setAddOpen(true)} style={s.addBtn} hitSlop={8}>
            <Plus size={ICON.md} color="#fff" strokeWidth={ICON.strokeBold} />
          </Pressable>
          <Pressable onPress={resetLayout} style={s.editBtn} hitSlop={8}><Text style={s.editBtnT}>{t('元に戻す')}</Text></Pressable>
          <Pressable onPress={orderCtl.finishEditing} style={s.doneBtn2} hitSlop={8}>
            <Text style={s.doneBtn2T}>{t('完了')}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onLongPress={() => setEditing(true)} delayLongPress={450}>
          <DateStrip value={viewDate} onChange={setViewDate} />
        </Pressable>
      )}
    />
  );

  // ===== ヘッダー（固定部の下・スクロールする部分: 編集ヒント・未同期チップ・メッセージ） =====
  const headerJSX = (
    <>
      {editing && <Text style={s.editHint}>{t('カードを長押し→そのままドラッグで並び替え。⊖で隠す。「完了」で保存します')}</Text>}
      {pendingN > 0 && (
        <Pressable style={s.syncChip} onPress={manualFlush} hitSlop={6}>
          <Text style={s.syncChipT}>{t('未同期 {n}件', { n: pendingN })}</Text>
          <Text style={s.syncChipSub}>{t('タップで同期')}</Text>
        </Pressable>
      )}
      {msg && <Text style={[s.msg, { marginTop: 0, marginBottom: 10, color: msg.ok ? C.successInk : C.coral }]}>{msg.text}</Text>}
    </>
  );

  // ===== 並び替え対象のカード（キー→JSX）。ReorderableCards が visibleOrder の順に描く =====
  function renderCard(key: string) {
    if (key === 'move') {
        // ===== きょうの動き: 消費kcal・歩数・目標への逆算（食事の残量と同じ文法）。2026-09-02に1段小さく =====
        const walkKcalMin = 0.0613 * myWeight;                 // はや歩き3.5METs相当
        const bmrOfMe = prof ? mifflinBMR(prof.sex, myWeight, Number(prof.height_cm), Number(prof.age)) : 0;
        const lifeFactor = prof?.life_factor != null ? Number(prof.life_factor) : LIFE_FACTOR_DEFAULT;
        const activeBonus = activeToGoal && activeOfView != null
          ? activeKcalGoalBonus(activeOfView, bmrOfMe, lifeFactor) : 0;
        const target = entryToday.target != null ? entryToday.target + activeBonus : null;
        const over = target != null ? Math.round((entryToday.intake ?? 0) - target) : null;
        let line: { text: string; color: string } | null = null;
        if (over == null) {
          line = { text: t('目標を設定すると「あと何歩で帳尻が合うか」がここに出ます'), color: C.sub };
        } else if (purpose === 'bulk') {
          line = over < 0
            ? { text: t('増量ノルマまで あと{n}kcal 食べる', { n: (-over).toLocaleString() }), color: C.amber }
            : { text: t('今日の増量ノルマ達成💪'), color: C.successInk };
        } else if (over > 0) {
          const steps = stepsForKcal(over, myWeight);
          const min = Math.max(5, Math.round(over / walkKcalMin / 5) * 5);
          line = { text: t('食べすぎぶんは あと約{s}歩（はや歩き{m}分）で帳尻が合います', { s: steps.toLocaleString(), m: min }), color: C.amber };
        } else {
          line = { text: t('収支は目標内。あと{n}kcal食べられます', { n: (-over).toLocaleString() }), color: C.successInk };
        }
        const last7 = (healthDays ?? []).slice(-7);
        const maxSteps = Math.max(1, ...last7.map((d) => d.steps));
        const wd = [t('日'), t('月'), t('火'), t('水'), t('木'), t('金'), t('土')];
        return (
          <>
          <Animated.View entering={FadeInDown.duration(320)} style={[s.card, s.cardCompact]}>
            <View ref={moveTarget} collapsable={false}>
            <View style={s.h2Row}><Activity size={ICON.sm} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('きょうの動き')}</Text></View>
            <View style={s.mvRow}>
              {/* 消費スタット: 出どころは burn.source（①実測 → ②歩数からの推定 → ③アプリ記録） */}
              <View style={s.mvStat}>
                <View style={s.mvLblRow}><Flame size={ICON.xs} color={C.sub} />
                  <Text style={s.mvLbl}>
                    {burn.source === 'measured' ? t('消費（運動）') : burn.source === 'steps' ? t('消費（歩数から推定）') : t('消費（記録）')}
                  </Text>
                </View>
                {/* 2スタットの大数字は横並び固定のため文字サイズ拡大は上限1.3 */}
                <Text style={s.mvVal} maxFontSizeMultiplier={1.3}>
                  {burn.kcal.toLocaleString()}
                  <Text style={s.mvUnit}> kcal</Text>
                </Text>
                {burn.source === 'measured' && (
                  <>
                    <Text style={s.mvStatSub}>{t('アクティブ（ヘルスケア実測）')}</Text>
                    <Text style={s.mvStatSub}>{t('うちアプリ記録ぶん {n}kcal', { n: Math.round(burnToday).toLocaleString() })}</Text>
                  </>
                )}
                {burn.source === 'steps' && (
                  <>
                    <Text style={s.mvStatSub}>{t('歩数からの推定（およそ）')}</Text>
                    {burnToday > 0 && (
                      <Text style={s.mvStatSub}>{t('ほかに、このアプリで記録した運動 {n}kcal', { n: Math.round(burnToday).toLocaleString() })}</Text>
                    )}
                  </>
                )}
                {needsActiveAuth && (
                  <Pressable onPress={reauthActiveEnergy} disabled={authBusy} hitSlop={6}>
                    <Text style={[s.mvAuthLink, authBusy && { opacity: 0.5 }]}>{t('消費カロリーの読み取りを許可する →')}</Text>
                  </Pressable>
                )}
              </View>
              <View style={s.mvStat}>
                <View style={s.mvLblRow}><Footprints size={ICON.xs} color={C.sub} /><Text style={s.mvLbl}>{t('歩数')}</Text></View>
                {stepsOfView != null ? (
                  <Text style={s.mvVal} maxFontSizeMultiplier={1.3}>{stepsOfView.toLocaleString()}<Text style={s.mvUnit}> {t('歩')}</Text></Text>
                ) : healthLink === 'unlinked' ? (
                  <Pressable onPress={connectHealth} hitSlop={6}>
                    <Text style={s.mvLink}>{t('ヘルスケアと連携する')}</Text>
                  </Pressable>
                ) : (
                  <Text style={s.mvVal} maxFontSizeMultiplier={1.3}>—</Text>
                )}
              </View>
            </View>
            {burn.source === 'measured' && (
              <Text style={s.mvNote}>{t('ヘルスケアの実測にはアプリ記録ぶんも含まれることがあります')}</Text>
            )}
            {burn.source === 'steps' && (
              <Text style={s.mvNote}>{t('歩数からの推定はおよその値です（歩幅・速度で変わります）。Apple Watchが無いと実測が無いことがあるため、歩数から出しています')}</Text>
            )}
            {authHint && (
              <Pressable onPress={() => Linking.openSettings().catch(() => {})} hitSlop={6}>
                <Text style={s.mvAuthHint}>{authHint}</Text>
              </Pressable>
            )}
            {line && <Text style={[s.mvLine, { color: line.color }]}>{line.text}</Text>}
            {activeBonus > 0 && (
              <Text style={s.mvNote}>
                {burn.source === 'steps'
                  ? t('歩いたぶん（推定）+{n}kcal を目標に上乗せしています', { n: activeBonus.toLocaleString() })
                  : t('歩いたぶん +{n}kcal を目標に上乗せしています', { n: activeBonus.toLocaleString() })}
              </Text>
            )}
            </View>
            {weekStepsGoal != null && (healthDays?.length ?? 0) > 0 && (
              <WeekStepsBar days={healthDays!} today={todayJST()} goal={weekStepsGoal} />
            )}
            {last7.length > 1 && (
              <View style={s.mvBars}>
                {last7.map((d) => {
                  const [y, m, dd] = d.date.split('-').map(Number);
                  const dow = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
                  const on = d.date === viewDate;
                  return (
                    <View key={d.date} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
                      <View style={[s.mvBar, { height: 5 + Math.round(24 * (d.steps / maxSteps)) }, on && { backgroundColor: C.teal }]} />
                      <Text style={[s.mvBarL, on && { color: C.accentInk, fontWeight: '800' }]}>{wd[dow]}</Text>
                    </View>
                  );
                })}
              </View>
            )}
            {/* 時間帯別の歩数（0-23時・ヘルスケア式）。高さは 44→32 に縮小 */}
            {hourlySteps != null && hourlySteps.some((v) => v > 0) && (() => {
              const nowH = jstHourNow();
              const isToday = viewDate === todayJST();
              const maxHr = Math.max(1, ...hourlySteps);
              return (
                <View style={s.hrWrap}>
                  <Text style={s.hrTitle}>{t('時間帯別の歩数')}</Text>
                  <View style={s.hrBars}>
                    {hourlySteps.map((v, h) => {
                      const future = isToday && h > nowH;
                      return (
                        <View key={h} style={s.hrCol}>
                          {future ? (
                            <View style={s.hrEmpty} />
                          ) : (
                            <View style={[s.hrBar, { height: v > 0 ? 3 + Math.round(29 * (v / maxHr)) : 2 }, v === 0 && { backgroundColor: C.line }]} />
                          )}
                        </View>
                      );
                    })}
                  </View>
                  <View style={s.hrAxis}>
                    {[0, 6, 12, 18].map((h) => (
                      <Text key={h} style={s.hrAxisT}>{t('{n}時', { n: h })}</Text>
                    ))}
                  </View>
                </View>
              );
            })()}
          </Animated.View>
          {/* 広告枠（運動タブ・1枠）: 「きょうの動き」＝閲覧領域の直下、記録カード群の手前に置く。
              記録ボタンの直上には置かない（誤タップ防止・審査上の配置判断）。
              並び替え中はドラッグの座標計算と視界を邪魔しないので非表示 */}
          {!editing && <AdSlot placement="training" />}
          </>
        );
    }

    if (key === 'quick') {
      // ===== 運動を記録する: 基本はヘルスケア取り込み。手で足すときは種目を毎回選ぶシート =====
      return (
        <View style={s.card} ref={trainInputTarget} collapsable={false}>
          <View style={s.h2Row}><Footprints size={ICON.md} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('運動を記録する')}</Text></View>
          <Text style={s.muted}>{t('消費カロリーはヘルスケアから自動で取り込みます。散歩やランニングを手で足すときは、種目を選んで時間を回すだけ。')}</Text>
          <OptionButton style={{ marginTop: 12 }} label={t('運動を記録する')} onPress={() => setActSheet(true)} busy={actSaving} />
          <OptionButton style={{ marginTop: 8 }} variant="tonal" label={t('ヘルスケアから取り込む（Apple Watch等）')} onPress={openHk} />
        </View>
      );
    }

    if (key === 'rest') {
      // レストタイマー（いつでも手動で起動できる独立タイマー。長さはダイアルで選ぶ）
      return (
      <View ref={restTarget} collapsable={false}>
      {(
        restLeft != null ? (
          <Pressable style={s.rest} onPress={() => setRestLeft(restSec)}>
            <View style={s.restBarTrack}>
              <View style={[s.restBarFill, { width: `${Math.max(0, Math.min(100, (restLeft / restSec) * 100))}%` }]} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Timer size={ICON.sm} color={C.teal} />
              <Text style={s.restL}>{t('レスト')}</Text>
            </View>
            {/* タイマーのMM:SSは1行固定のため文字サイズ拡大は上限1.3 */}
            <Text style={s.restN} maxFontSizeMultiplier={1.3}>
              {restLeft > 0
                ? `${String(Math.floor(restLeft / 60)).padStart(2, '0')}:${String(restLeft % 60).padStart(2, '0')}`
                : t('終了💪')}
            </Text>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={s.restHint}>{restLeft > 0 ? t('タップで{d}に戻す', { d: fmtRest(restSec) }) : t('次のセットへ！')}</Text>
              <Pressable onPress={() => setRestLeft(null)} hitSlop={10}>
                <Text style={s.restStop}>{t('とじる')}</Text>
              </Pressable>
            </View>
          </Pressable>
        ) : (
          <View style={s.restIdle}>
            <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }} onPress={() => { setRestLeft(restSec); bumpRestCount(); }}>
              <Timer size={ICON.sm} color={C.sub} />
              <Text style={s.restIdleT}>{t('レストタイマー')}</Text>
              <Text style={[s.restIdleStart, { marginLeft: 'auto' }]}>▶ {fmtRest(restSec)} {t('で開始')}</Text>
            </Pressable>
            {/* 長さはダイアルで（ボタン列は廃止） */}
            <Pressable style={s.restLenBtn} onPress={() => setRestDial(true)} hitSlop={8}>
              <Text style={s.restLenT}>{t('長さ')} ▾</Text>
            </Pressable>
          </View>
        )
      )}
      </View>
      );
    }

    if (key === 'liftInput') {
      // ===== 筋トレを記録する: 入力は全画面の記録画面へ（レストを見ながらセットを積む） =====
      return (
      <View style={s.card} ref={liftTarget} collapsable={false}>
        <View style={s.h2Row}>
          <ClipboardList size={ICON.md} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('筋トレを記録する')}</Text>
        </View>
        <Text style={s.liftIntro}>{t('本気で挙げる人向け。ボリューム・目標進捗・インターバルまで全部無料で管理できます。')}</Text>
        <Text style={s.muted}>{t('記録画面ではレストタイマーを見ながら、セットごとに重量と回数をダイアルで積んでいけます。懸垂の補助・加重も同じダイアルで。')}</Text>
        {pendingSession && (
          <Pressable style={s.resumeRow} onPress={openLiftSession}>
            <Dumbbell size={ICON.md} color={C.accentInk} />
            <Text style={s.resumeT}>{t('記録中のセッションがあります（{n}セット・{d}）', { n: pendingSession.sets, d: pendingSession.date.slice(5).replace('-', '/') })}</Text>
            <ChevronRight size={ICON.md} color={C.accentInk} />
          </Pressable>
        )}
        <OptionButton style={{ marginTop: 12 }} variant="teal" label={pendingSession ? t('セッションを再開する') : t('筋トレを記録する')} onPress={openLiftSession}
                      leading={<Dumbbell size={ICON.md} color="#fff" strokeWidth={ICON.strokeBold} />} />
      </View>
      );
    }
    return null;
  }

  // ===== 並び替え対象の下に置く固定要素（ReorderableCards の footer） =====
  const footerJSX = (
    <>
      {/* 「きょうの動き」カードを隠している人だけ、枠はカード群の下（導線の上）へ退避。
          いずれの場合も運動タブの枠は1つだけ */}
      {!editing && !visibleOrder.includes('move') && <AdSlot placement="training" />}
      {history.length > 0 && (
        <Text style={s.moveNote}>{t('挙上重量の推移グラフは「概要」タブ →「挙上重量の推移」で見られます')}</Text>
      )}
      <Pressable style={s.goalRow} onPress={() => setGoalOpen(true)}>
        <View style={s.goalIcon}><Target size={ICON.md} color={C.teal} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.goalRowT}>{t('目標を記録しましょう')}</Text>
          <Text style={s.goalRowSub}>{t('ベンチプレス100kgなど。成長グラフに目標線が引かれます。')}</Text>
        </View>
        <Text style={s.goalRowGo}>›</Text>
      </Pressable>
      {history.length > 0 && (
        <Pressable style={s.moveNoteRow} onPress={() => router.push('/(tabs)/changes')} hitSlop={6}>
          <Text style={s.moveNote}>{t('筋トレ履歴は「概要」タブ →「筋トレの成長」で見られます（タップで移動）')}</Text>
        </Pressable>
      )}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    {/* カードの並び替え（概要タブと同じ ReorderableCards）。見出し＋日付ストリップは stickyHeader で上端固定 */}
    <ReorderableCards
      editing={editing}
      order={visibleOrder}
      onOrderChange={setVisibleOrder}
      renderCard={renderCard}
      onHide={cards.hide}
      ghostLabel={(k) => EX_LABELS()[k] ?? k}
      stickyHeader={stickyJSX}
      header={headerJSX}
      footer={footerJSX}
      onEnterEdit={() => setEditing(true)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); invalidateActiveEnergyCache(); await Promise.all([load(), loadMove(viewDate), loadHealth(), loadHourly(viewDate)]); setRefreshing(false); }} />}
      contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 24 }]}
      onScroller={(fn) => guide.registerScroller('/training', fn)}
      scrollProps={{ keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag' }}
    />

    {/* ===== ヘルスケア取込モーダル ===== */}
    <Modal visible={hkOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setHkOpen(false)}>
      <View style={s.hkWrap}>
        <View style={s.hkHead}>
          <Text style={s.hkTitle}>{t('ヘルスケアから取り込む')}</Text>
          <Pressable onPress={() => setHkOpen(false)} hitSlop={10}><Text style={s.hkClose}>×</Text></Pressable>
        </View>
        <Text style={s.hkSub}>{t('直近30日のワークアウト。タップで取込対象を選べます（取込済みは自動でスキップ）。')}</Text>
        {hkBusy && hkList.length === 0 && <ActivityIndicator color={C.teal} style={{ marginTop: 30 }} />}
        {hkMsg !== '' && <Text style={s.hkMsg}>{hkMsg}</Text>}
        <ScrollView style={{ flex: 1, marginTop: 8 }}>
          {hkList.map((w) => {
            const on = hkSel.has(w.id);
            return (
              <Pressable key={w.id} style={[s.hkRow, !on && { opacity: 0.4 }]}
                         onPress={() => setHkSel((prev) => { const n = new Set(prev); if (n.has(w.id)) n.delete(w.id); else n.add(w.id); return n; })}>
                <Text style={s.hkCheck}>{on ? '☑' : '☐'}</Text>
                <Text style={s.hkDate}>{w.date.slice(5).replace('-', '/')}</Text>
                <Text style={s.hkName} numberOfLines={1}>{w.name}</Text>
                <Text style={s.hkMeta}>{w.minutes}{t('分')}{w.km ? ` ${w.km}km` : ''} ・ {w.kcal}kcal</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {hkList.length > 0 && (
          <OptionButton variant="teal" label={t('選択した{n}件を取り込む', { n: [...hkSel].length })}
                        onPress={importSelected} busy={hkBusy} disabled={hkSel.size === 0} />
        )}
      </View>
    </Modal>

    {/* 運動目標の編集モーダル */}
    <Modal visible={goalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setGoalOpen(false)}>
      <View style={s.hkWrap}>
        <View style={s.hkHead}>
          <Text style={s.hkTitle}>{t('運動の目標')}</Text>
          <Pressable onPress={() => setGoalOpen(false)} hitSlop={10}><Text style={s.hkClose}>×</Text></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          <GoalPanel mode="training" />
        </ScrollView>
      </View>
    </Modal>

    {/* 運動を記録するシート（種目を毎回選ぶ → 時間ダイアル → 保存） */}
    <ActivityLogSheet visible={actSheet} onClose={() => setActSheet(false)} weightKg={myWeight} freq={actFreq} busy={actSaving} onSave={saveActivity} />

    {/* レストの長さ（ダイアル） */}
    {restDial && <RestDial initial={restSec} onClose={() => setRestDial(false)} onPick={pickRest} />}

    {/* ⊕で非表示カードを戻すシート */}
    <AddCardSheet visible={addOpen} onClose={() => setAddOpen(false)} hidden={hiddenCards} labels={EX_LABELS()}
                  onShow={cards.show} shownKeys={visibleOrder} />

    {/* ステータスバー領域はスティッキーヘッダー（TabHeader）が覆うので StatusBarMask は置かない */}
    </View>
  );
}

const s = themed(() => ({
  scroll: { paddingHorizontal: SPACE.screen, paddingBottom: 24 },   // 上端の余白は固定ヘッダーが持つ。下端はinsets.bottomを描画側で足す
  addBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  doneBtn2: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.chip, backgroundColor: C.teal },
  doneBtn2T: { color: '#fff', fontSize: 13, fontWeight: '800' },   // アクセント塗り面の上の白文字は固定色
  editBtn: { borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.chip, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.panel },
  editBtnT: { fontSize: 13, fontWeight: '800', color: C.sub },
  editHint: { fontSize: 13, color: C.sub, marginBottom: 10, textAlign: 'center' },
  mvAuthLink: { fontSize: 11.5, fontWeight: '800', color: C.accentInk, marginTop: 6, lineHeight: 15 },
  mvAuthHint: { fontSize: 11.5, color: C.amber, fontWeight: '600', lineHeight: 16, marginTop: 8 },
  // きょうの動きカード（2026-09-02 1段小さく: 大数字 25→20・カード余白 16→12・チャート高 44→32）
  cardCompact: { padding: 12 },
  mvRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  mvStat: { flex: 1, backgroundColor: C.bg, borderRadius: RADIUS.tile, paddingVertical: 10, paddingHorizontal: 12 },
  mvLblRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  mvLbl: { fontSize: 11.5, fontWeight: '700', color: C.sub },
  mvVal: { fontSize: 20, fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'] },
  mvUnit: { fontSize: 12, fontWeight: '700', color: C.sub },
  mvLink: { fontSize: 13, fontWeight: '800', color: C.accentInk, textDecorationLine: 'underline', paddingVertical: 5 },
  mvStatSub: { fontSize: 11, fontWeight: '700', color: C.sub, marginTop: 2, lineHeight: 15 },
  mvNote: { fontSize: 11.5, color: C.faint, lineHeight: 16, marginTop: 6 },
  mvLine: { fontSize: 13, fontWeight: '700', lineHeight: 19, marginTop: 10 },
  mvBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 12 },
  mvBar: { width: '62%', borderRadius: 4, backgroundColor: C.line },
  mvBarL: { fontSize: 11, color: C.faint, fontWeight: '700' },
  hrWrap: { marginTop: 12, borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 10 },
  hrTitle: { fontSize: 11.5, fontWeight: '700', color: C.sub, marginBottom: 6 },
  hrBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 32 },
  hrCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  hrBar: { alignSelf: 'stretch', borderRadius: 2, backgroundColor: C.teal },
  hrEmpty: { alignSelf: 'stretch', height: 2, borderRadius: 2, backgroundColor: C.track },
  hrAxis: { flexDirection: 'row', marginTop: 4 },
  hrAxisT: { flex: 1, fontSize: 11, color: C.faint, fontWeight: '700', textAlign: 'left' },
  hkWrap: { flex: 1, backgroundColor: C.bg, padding: SPACE.screen, paddingTop: sheetTopPad(18) },
  hkHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hkTitle: { ...HEAD.card, color: C.ink },
  hkClose: { fontSize: 24, color: C.sub, fontWeight: '600', paddingHorizontal: 6 },
  hkSub: { fontSize: 13, color: C.sub, marginTop: 6, lineHeight: 18 },
  hkMsg: { fontSize: 13, fontWeight: '600', color: C.sub, marginTop: 16, textAlign: 'center' },
  hkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: C.line },
  hkCheck: { fontSize: 17, color: C.accentInk },
  hkDate: { width: 44, fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  hkName: { flex: 1, fontSize: 15, fontWeight: '700', color: C.ink },
  hkMeta: { fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  h2: { ...HEAD.card, color: C.ink, marginBottom: 10 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  rest: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: RADIUS.tile, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12,
    overflow: 'hidden',
  },
  restBarTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'transparent' },
  restBarFill: { height: 3, backgroundColor: C.teal, borderRadius: 2 },
  restStop: { fontSize: 11, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  restIdle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: RADIUS.tile, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12,
  },
  restIdleT: { fontSize: 13, fontWeight: '700', color: C.sub },
  restIdleStart: { fontSize: 13, fontWeight: '800', color: C.accentInk },
  restLenBtn: { borderWidth: 1, borderColor: C.line, backgroundColor: C.chipBg, borderRadius: RADIUS.chip, paddingHorizontal: 10, paddingVertical: 4 },
  restLenT: { fontSize: 11.5, fontWeight: '800', color: C.sub },
  goalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: RADIUS.tile, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12,
  },
  goalIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  goalRowT: { fontSize: 13.5, fontWeight: '800', color: C.ink },
  goalRowSub: { fontSize: 11.5, color: C.sub, marginTop: 1 },
  goalRowGo: { fontSize: 22, color: C.faint, fontWeight: '300' },
  restL: { fontSize: 13, fontWeight: '800', color: C.ink },
  restN: { fontSize: 21, fontWeight: '900', color: C.accentInk, fontVariant: ['tabular-nums'] },
  restHint: { fontSize: 11, color: C.sub },
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: RADIUS.card, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: SPACE.card, marginBottom: 12 },
  msg: { fontSize: 15, fontWeight: '600', marginTop: 8 },
  moveNote: { fontSize: 13, color: C.sub, marginBottom: 12, paddingHorizontal: 4, lineHeight: 18 },
  moveNoteRow: { paddingVertical: 2 },
  liftIntro: { fontSize: 13, color: C.sub, lineHeight: 18, marginBottom: 4 },
  muted: { fontSize: 14, color: C.sub, lineHeight: 20 },
  // 途中セッションの再開導線
  resumeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder, borderRadius: RADIUS.input,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  resumeT: { flex: 1, fontSize: 13, fontWeight: '800', color: C.accentInk },
  syncChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.chip,
    paddingHorizontal: 11, paddingVertical: 6, marginBottom: 10,
  },
  syncChipT: { fontSize: 12, fontWeight: '800', color: C.amber, fontVariant: ['tabular-nums'] },
  syncChipSub: { fontSize: 11, fontWeight: '700', color: C.faint },
}));
