// 運動タブ: かんたん記録（散歩レベルの日常運動をMETs換算で1タップ記録）＋筋トレ
// 筋トレ勢だけでなくライトユーザーも「今日も動けた」を記録できるようにする
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Modal, Vibration, AppState, Linking } from 'react-native';
import { useRouter } from 'expo-router';
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
import { ClipboardList, Timer, Footprints, Target, Flame, Activity } from 'lucide-react-native';
import GoalPanel from '@/components/GoalPanel';
import { bumpRestCount } from '@/lib/achievements';
import StatusBarMask from '@/components/StatusBarMask';
import { useGuide, useGuideTarget } from '@/components/GuideTour';
import ReorderableCards from '@/components/ReorderableCards';
import HeaderGear from '@/components/HeaderGear';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateStrip from '@/components/DateStrip';
import WeekStepsBar, { useWeekStepsGoal } from '@/components/WeekStepsBar';
import LiftPicker from '@/components/LiftPicker';
import WeightDial from '@/components/WeightDial';
import PlateCalc from '@/components/PlateCalc';
import { enqueue, flush, pendingCount, subscribePendingCount, isNetworkError } from '@/lib/offlineQueue';
import { loadCustomLifts, bwRatioOf, isBodyweightLift } from '@/lib/lifts';
import { liftSetLabel, parseLiftText, effectiveKg, weightLookup } from '@/lib/liftLog';
import {
  ACTIVITIES, ACTIVITY_GROUPS, activityById, activityName, activityKcal, DEFAULT_VISIBLE,
} from '@/lib/activities';
import { bumpFoodFreq, readFoodFreq, foodScores } from '@/lib/foods';
import { AddCardSheet, useCardLayout, useCardOrder } from '@/components/CardLayout';
import { Plus } from 'lucide-react-native';
import { Chip, OptionButton } from '@/components/ui/Selectable';
import { epley1RM, parse1RMs, repsNeededFor } from '@/lib/rm';
import { t } from '@/lib/i18n';

type TRow = { name: string; kg: string; reps: string; sets: string };

type HistRow = { id: string; date: string; text: string };

// 種目の定義は lib/activities.ts（54種・METsはCompendium 2011準拠）
const MINUTES = [10, 20, 30, 45, 60, 90] as const;
// レストの選択肢（秒）。30秒=追い込み / 90秒=標準 / 3〜5分=高重量 / 10分=神経系
const REST_OPTIONS = [30, 60, 90, 120, 180, 300, 600];

// レスト秒数の表示（60の倍数は「分」、90秒などはそのまま「秒」）
const fmtRest = (n: number) => (n >= 60 && n % 60 === 0 ? t('{n}分', { n: n / 60 }) : t('{n}秒', { n }));

// 並び替え・表示/非表示できるカード（既定の並び: きょうの動き→ゆる記録→レストタイマー→筋トレ入力）。
// 概要タブと同じ操作（日付ストリップ or カードの長押し→編集モード／ドラッグで並び替え／⊖で非表示／⊕で戻す）。
// 非表示は 'bl-cards-exercise'（useCardLayout）・並び順は 'bl-order-exercise'（useCardOrder）に別キーで保存。
// 筋トレ履歴カードは概要タブ「筋トレの成長」へ移設した（components/LiftHistoryCard.tsx）
const EX_CARDS = ['move', 'quick', 'rest', 'liftInput'];
const EX_LABELS = (): Record<string, string> => ({
  move: t('きょうの動き'),
  quick: t('今日の消費カロリーを記録'),
  rest: t('レストタイマー'),
  liftInput: t('今日のトレーニングを記録'),
});

export default function TrainingScreen() {
  const insets = useSafeAreaInsets();
  const [tRows, setTRows] = useState<TRow[]>([{ name: '', kg: '', reps: '', sets: '' }]);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [restLeft, setRestLeft] = useState<number | null>(null); // レストタイマー残秒
  // レストの長さは人と種目で違う（高重量なら3分、追い込みなら45秒）。選べるようにして記憶する
  const [restSec, setRestSec] = useState(90);
  // 種目ピッカーを開いている行（nullなら閉じている）
  const [liftPickRow, setLiftPickRow] = useState<number | null>(null);
  // 重量ダイアルを開いている行（nullなら閉じている）
  const [dialRow, setDialRow] = useState<number | null>(null);
  const trainInputTarget = useGuideTarget('trainInput');
  const moveTarget = useGuideTarget('moveCard');   // ガイド章「食べる前に分かる」: きょうの動き（逆算の1行）
  const restTarget = useGuideTarget('restTimer');  // ガイド章「筋トレは全部無料」: レストタイマー
  const liftTarget = useGuideTarget('liftInput');  // ガイド章「筋トレは全部無料」: 筋トレ入力カード
  const router = useRouter();
  // ガイドツアーの自動スクロールは ReorderableCards の onScroller 経由で登録する（概要タブと同じ）
  const guide = useGuide();

  // レストタイマーのカウントダウン（0になった瞬間にバイブで知らせる）
  useEffect(() => {
    if (restLeft == null || restLeft <= 0) return;
    const t = setInterval(() => setRestLeft((v) => {
      if (v == null) return v;
      if (v <= 1) { try { Vibration.vibrate(500); } catch { /* 端末設定次第 */ } return 0; }
      return v - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [restLeft]);

  // 前回参照: 同じ種目の直近記録を探す。
  // kgは実負荷（自重種目は体重込み）、rawKgは入力そのまま（ダイアルの初期位置に使う）
  function lastRecordOf(name: string): { text: string; kg: number; rawKg: number; date: string } | null {
    const nm = name.trim();
    if (!nm) return null;
    for (const h1 of history) {
      for (const e of parseLiftText(h1.text)) {
        if (e.name !== nm) continue;
        return { text: liftSetLabel(e, t('自重')), kg: effectiveKg(e, weightAt(h1.date)), rawKg: e.kg, date: h1.date };
      }
    }
    return null;
  }
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // 記録先の日付（既定=今日。過去日にも記録できる）
  const [viewDate, setViewDate] = useState(todayJST());
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
  // プレート計算機（重量ダイアルの補助。目標総重量→片側のプレート構成）
  const [plateOpen, setPlateOpen] = useState(false);

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

  // かんたん記録の状態
  const [actId, setActId] = useState<string | null>(null);
  // 表示する種目（54種すべて出すと毎日使うものが埋もれるため既定は8種）
  const [visibleIds, setVisibleIds] = useState<string[]>(DEFAULT_VISIBLE);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actFreq, setActFreq] = useState<Record<string, number>>({});

  // 表示する種目の設定を復元（未設定なら既定の8種）
  useEffect(() => {
    AsyncStorage.getItem('bl-act-visible').then((raw) => {
      if (!raw) return;
      try {
        const v = JSON.parse(raw) as string[];
        // 定義から消えたidは捨てる（種目を入れ替えても壊れない）
        const kept = v.filter((id) => activityById(id) != null);
        if (kept.length > 0) setVisibleIds(kept);
      } catch { /* 既定のまま */ }
    }).catch(() => {});
    setActFreq(foodScores(readFoodFreq()));   // よく使う種目を前に出すため
    loadCustomLifts();                       // ユーザーが追加した筋トレ種目
    AsyncStorage.getItem('bl-rest-sec').then((v) => {
      const n = Number(v);
      if (REST_OPTIONS.includes(n)) setRestSec(n);
    }).catch(() => {});
  }, []);

  function pickRest(n: number) {
    setRestSec(n);
    AsyncStorage.setItem('bl-rest-sec', String(n)).catch(() => {});
    if (restLeft != null) setRestLeft(n);   // 動作中なら新しい長さで測り直す
  }

  function saveVisible(ids: string[]) {
    // 全部外すとチップが空になり「記録できない画面」に見えてしまうため、最低1つは残す
    if (ids.length === 0) {
      setMsg({ ok: false, text: t('少なくとも1つは表示してください。') });
      return;
    }
    setVisibleIds(ids);
    AsyncStorage.setItem('bl-act-visible', JSON.stringify(ids)).catch(() => {});
    // 選択中の種目が非表示になったら選択を解除する（見えないものが選ばれ続けるのを防ぐ）
    if (actId && !ids.includes(actId)) setActId(null);
  }

  // 表示中の種目を、よく使う順に並べる（設定させずに最短で押せるようにする）
  // 表示順は「保存した実績」が主。選択中のものは並びを動かさない
  // （押した瞬間にチップが動くと、次に押したい場所が変わって迷う）
  const shownActs = visibleIds
    .map((id) => activityById(id))
    .filter((a): a is NonNullable<typeof a> => a != null)
    .map((a, i) => ({ a, i, c: actFreq['act:' + a.id] ?? 0 }))
    .sort((x, y) => (y.c - x.c) || (x.i - y.i))
    .map((x) => x.a);
  const [actMin, setActMin] = useState<number>(30);
  const [actKm, setActKm] = useState(''); // 距離（km・徒歩/ラン/自転車のみ任意入力）
  const [actSaving, setActSaving] = useState(false);
  const [myWeight, setMyWeight] = useState<number>(60);
  // 体重が本当に記録されているか。未記録の既定値60kgで「実負荷」と言い切らないため
  const [hasWeight, setHasWeight] = useState(false);
  // 自重種目の負荷は体重で変わるので、履歴の日付ごとに体重を引けるようにする
  const [weightRows, setWeightRows] = useState<{ date: string; weight: number | null }[]>([]);
  useEffect(() => {
    supabase.from('entries').select('date,weight').not('weight', 'is', null)
      .order('date', { ascending: false }).limit(400)
      .then(({ data }) => {
        const rows = (data as { date: string; weight: number | null }[] | null) ?? [];
        setWeightRows(rows);
        if (rows.length) { setMyWeight(Number(rows[0].weight)); setHasWeight(true); }
      });
  }, []);
  const weightAt = weightLookup(weightRows);

  // ===== 消費kcalの出どころ（lib/stepsKcal.ts resolveBurnKcal に優先順位を固定） =====
  //   ① ヘルスケア実測（アクティブエネルギー）が >0 → それ
  //   ② 実測が 0/取れないが歩数 >0 → 歩数からの推定（歩数×0.0005×体重・「およそ」を明示）
  //   ③ どちらも無し → アプリ記録ぶん（logs adj）だけの従来表示
  // 「10,013歩なのに 0kcal」（βFB）は、実測が無い環境（再許可されていない／Apple Watchなし）で
  // 従来表示に落ちていたのが原因。歩数が取れている限り②で必ず数字が出る
  const burn = resolveBurnKcal({
    measured: healthDays != null ? (dayOfView?.activeKcal ?? 0) : null,
    steps: stepsOfView,
    weightKg: myWeight,
    recorded: burnToday,
  });
  // 目標への上乗せに使える「アクティブ相当」。③は目標側にすでにadjで入っているので渡さない
  const activeOfView = burn.source !== 'recorded' ? burn.kcal : null;
  // アクティブエネルギーの読み取りが未許可らしい: 歩数は取れているのに直近7日の実測が全部0。
  // iOSは読み取りの許可状態を教えないので、これが唯一の手がかり（Watchなしで本当に0の人も含む）
  const needsActiveAuth = healthDays != null && stepsOfView != null && !healthDays.some((d) => d.activeKcal > 0);
  const [authBusy, setAuthBusy] = useState(false);
  // 再要求してもダイアログが出ない（すでに聞いた後）ときの設定アプリへの案内文
  const [authHint, setAuthHint] = useState<string | null>(null);
  async function reauthActiveEnergy() {
    if (authBusy) return;
    setAuthBusy(true); setAuthHint(null);
    try {
      const st = await activeEnergyAuthState();
      if (st !== 'asked') {
        // まだ聞いていない（READ_TYPESに型を足した後の既存ユーザー）→ iOSは追加した型だけ聞いてくれる
        await requestHealthAuth();
        invalidateActiveEnergyCache();
        const r = await loadHealth();
        if (r && r.some((d) => d.activeKcal > 0)) return;   // 取れた。表示は①へ切り替わる
      }
      // 一度拒否されると再ダイアログは出ない（iOSの仕様）。設定アプリの場所を案内する
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
      // 連携済みならダイアログは出ない（ensureHealthAuth は未連携のときだけ初回連携を行う）
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
  function actKcal(): number {
    if (actId == null) return 0;
    const a = activityById(actId);
    if (!a) return 0;
    // 距離が入っていれば距離ベースの推定に切り替わる（lib側で判定）
    return activityKcal(a, myWeight, actMin, Number(actKm) || null);
  }

  async function saveActivity() {
    if (actId == null) { setMsg({ ok: false, text: t('運動の種類を選んでください。') }); return; }
    setActSaving(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const a = activityById(actId);
      if (!a) return;
      const kcal = actKcal();
      const km = Number(actKm) > 0 && a.perKgKm != null ? Number(actKm) : null;
      const today = viewDate;
      const base = {
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: null, ex: 'オフ', adj: kcal, mood: '',
        // DBには canon（日本語固定）を書く。翻訳名を書くと言語切替で集計が分断される
        text: `🏃 ${a.canon} ${actMin}分${km ? ` ${km}km` : ''}（約${kcal}kcal消費）`, photo_urls: [],
      };
      // v17列（ex_minutes/ex_km）が無い旧DBでも保存できるようフォールバック。
      // fetch自体の例外（圏外）もerrorに畳んで、下でネットワーク起因かを判定する
      let error: { message: string } | null = null;
      try {
        ({ error } = await supabase.from('logs').insert({ ...base, ex_minutes: actMin, ex_km: km }));
        if (error && /ex_minutes|ex_km|column|schema/i.test(error.message) && !isNetworkError(error)) {
          ({ error } = await supabase.from('logs').insert(base));
        }
      } catch (e) {
        error = { message: String((e as Error)?.message ?? e) };
      }
      if (error && isNetworkError(error)) {
        // 圏外: 端末に積んで成功扱い（電波が戻ったら自動送信。列フォールバックはflush側にもある）
        await enqueue({ ...base, ex_minutes: actMin, ex_km: km });
        bumpFoodFreq('act:' + a.id);
        setActFreq(foodScores(readFoodFreq()));
        setActId(null); setActKm('');
        setMsg({ ok: true, text: t('圏外のため端末に保存しました。電波が戻ったら自動で同期されます。') });
        return;
      }
      if (error) { setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') }); return; }
      await syncEntriesForDate(uid, today);
      loadMove(today); // 「きょうの動き」の消費kcalと逆算を即時更新
      bumpFoodFreq('act:' + a.id);            // よく使う種目を前に出すため
      setActFreq(foodScores(readFoodFreq()));
      setActId(null); setActKm('');
      setMsg({ ok: true, text: t('{act}を記録しました。目標カロリーに+{kcal}kcal反映されます🎉', { act: `${activityName(a.id)} ${actMin}${t('分')}${km ? ` ${km}km` : ''}`, kcal }) });
      doFlush().catch(() => {});   // 保存が通った＝オンライン。積み残しがあれば一緒に送る
    } finally { setActSaving(false); }
  }

  const setT = (i: number, patch: Partial<TRow>) => setTRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.from('logs').select('id,date,text')
        .like('text', '🏋️%').order('at', { ascending: false }).limit(60);
      // 圏外での失敗（data=null）で既存の履歴を消さない。
      // 履歴が生きていれば「前回参照」も重量ダイアルの初期位置もオフラインのまま効く
      if (data) setHistory(data as HistRow[]);
    } catch { /* 圏外。手元のstateを保つ */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // キューの自動送信。起点は ①タブのマウント ②アプリのフォアグラウンド復帰 ③保存成功時。
  // NetInfoは使わない（依存を増やさない）。失敗＝まだ圏外として次の起点に任せる
  const doFlush = useCallback(async () => {
    try {
      if ((await pendingCount()) === 0) return;
      const r = await flush();
      if (r.sent > 0) { await load(); loadMove(viewDate); }   // 送れたぶんを画面に反映
    } catch { /* 次の起点（復帰・保存・手動タップ）で再試行される */ }
  }, [load, loadMove, viewDate]);
  useEffect(() => {
    pendingCount().then(setPendingN).catch(() => {});
    const off = subscribePendingCount(setPendingN);
    doFlush();   // マウント時に一度（前回セッションの積み残しを送る）
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') doFlush(); });
    return () => { off(); sub.remove(); };
  }, [doFlush]);

  // 未同期チップのタップ（手動flush）。結果はページ上部のメッセージ欄に出す
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

  // 筋トレ履歴のカードは概要タブ「筋トレの成長」へ移設した（components/LiftHistoryCard.tsx）。
  // history/load はここに残す: 「前回参照」と重量ダイアルの初期位置・RMフィードバックが依存している。
  // 履歴カードにあった「書き換える（入力欄へ戻す）」はこのタブの入力欄前提の機能だったため、
  // 移設にあわせて廃止した（概要側は削除のみ）。

  /** 入力1行が記録できる状態か。自重種目は加重なし（kg空欄）でも成立する */
  function rowReady(r: TRow): boolean {
    if (!r.name.trim() || !(Number(r.reps) > 0)) return false;
    return Number(r.kg) > 0 || isBodyweightLift(r.name);
  }

  // よく使う種目（保存の実績順）。ほかの運動と同じで、探さずに1タップで選べるようにする
  const favLifts = Object.entries(actFreq)
    .filter(([k]) => k.startsWith('lift:'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k.slice('lift:'.length));

  /** 行を足して、そのまま種目ピッカーを開く（追加→選択が1操作で済むように） */
  function addLiftRow() {
    setLiftPickRow(tRows.length);
    setTRows((rs) => [...rs, { name: '', kg: '', reps: '', sets: '' }]);
  }

  /** チップで選んだ種目を、名前が空の行（なければ末尾に足した行）に入れる */
  function pickLift(name: string) {
    setTRows((rs) => {
      const i = rs.findIndex((r) => !r.name.trim());
      if (i >= 0) return rs.map((r, j) => (j === i ? { ...r, name } : r));
      return [...rs, { name, kg: '', reps: '', sets: '' }];
    });
  }

  function trainingText(): string {
    const parts = tRows.filter(rowReady).map((r) => {
      const kg = Number(r.kg) || 0;
      const bw = isBodyweightLift(r.name);
      // 自重種目のkgは「加重」なので+を付けて残す（後で実負荷=体重+加重として読めるように）
      const w = bw ? (kg > 0 ? `+${kg}kg` : '自重') : `${kg}kg`;
      return `${r.name.trim()} ${w}×${Number(r.reps)}${Number(r.sets) > 1 ? `×${Number(r.sets)}` : ''}`;
    });
    return parts.length > 0 ? `🏋️ ${parts.join('、')}` : '';
  }

  async function save() {
    const tr = trainingText();
    if (!tr) { setMsg({ ok: false, text: t('種目と回数を入力してください。（加重しない自重種目はkg空欄でOK）') }); return; }
    setSaving(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const today = viewDate;
      const row = {
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: null, ex: 'オフ', adj: 0, mood: '', text: tr, photo_urls: [],
      };
      // fetch自体の例外（圏外）もerrorに畳んで、ネットワーク起因ならキューに退避する
      let error: { message: string } | null = null;
      try {
        ({ error } = await supabase.from('logs').insert(row));
      } catch (e) {
        error = { message: String((e as Error)?.message ?? e) };
      }
      if (error && isNetworkError(error)) {
        // 圏外: 端末に積んで成功扱い。オンライン保存と同じ後片付けをして、
        // レストタイマーも回す（圏外でもトレーニングは続く）。RMフィードバックは通信が要るので出さない
        await enqueue(row);
        for (const r of tRows.filter(rowReady)) bumpFoodFreq('lift:' + r.name.trim());
        setActFreq(foodScores(readFoodFreq()));
        const lastOff = tRows.filter(rowReady).slice(-1)[0] ?? null;
        setTRows([lastOff ? { name: lastOff.name, kg: lastOff.kg, reps: '', sets: '' } : { name: '', kg: '', reps: '', sets: '' }]);
        setRestLeft(restSec); bumpRestCount();
        setMsg({ ok: true, text: t('圏外のため端末に保存しました。電波が戻ったら自動で同期されます。') });
        return;
      }
      if (error) { setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') }); return; }
      await syncEntriesForDate(uid, today);

      // RMフィードバック: 推定1RM(Epley)を目標・自己ベストと照合して一言返す
      let fb = t('保存しました。継続が最強の種目です💪');
      try {
        const first = tRows.find(rowReady);
        if (first) {
          const name = first.name.trim();
          // 自重種目は体重が負荷の大半なので、加重だけで1RMを出すと実態と合わない
          const loadKg = effectiveKg(
            { name, kg: Number(first.kg) || 0, reps: Number(first.reps), sets: 1, mode: 'abs' },
            myWeight,
          );
          const est = Math.round(epley1RM(loadKg, Number(first.reps)));
          let bestPast = 0; // 保存前の履歴から同種目の過去最高1RM（同じく実負荷で比べる）
          for (const h1 of history) for (const p of parse1RMs(h1.text, weightAt(h1.date))) {
            if (p.name === name) bestPast = Math.max(bestPast, Math.round(p.est));
          }
          const { data: tg } = await supabase.from('training_goals').select('target_kg').eq('name', name).maybeSingle();
          const goalKg = tg ? Math.round(Number(tg.target_kg)) : null;
          if (goalKg && est >= goalKg) {
            fb = t('🎉 目標達成！{name} 推定MAX {est}kg（目標{goal}kg超え）。次の目標を設定しよう', { name, est, goal: goalKg });
          } else if (goalKg) {
            const need = repsNeededFor(goalKg, loadKg);
            fb = t('おしい！RM換算だとMAX {est}kg。目標{goal}kgまであと{left}kg', { est, goal: goalKg, left: goalKg - est }) + (need && need > Number(first.reps) ? t('（{kg}kgなら{need}回で到達）', { kg: loadKg, need }) : '');
          } else if (bestPast > 0 && est > bestPast) {
            fb = t('自己ベスト更新💪 {name} 推定MAX {est}kg（前回比 +{d}kg）', { name, est, d: est - bestPast });
          } else {
            fb = t('保存しました。{name} 推定MAX {est}kg（RM換算）', { name, est });
          }
        }
      } catch { /* フィードバックが取れなくても保存は成功している */ }

      // よく使う種目を前に出すため、保存した種目を数えておく（かんたん記録と同じ仕組み）
      for (const r of tRows.filter(rowReady)) bumpFoodFreq('lift:' + r.name.trim());
      setActFreq(foodScores(readFoodFreq()));
      // 同じ種目を重量やセットを変えながら重ねて記録する使い方が主流なので、
      // 保存後も種目とkgは残して回数だけ空ける
      const lastRow = tRows.filter(rowReady).slice(-1)[0] ?? null;
      setTRows([lastRow ? { name: lastRow.name, kg: lastRow.kg, reps: '', sets: '' } : { name: '', kg: '', reps: '', sets: '' }]);
      await load();
      setRestLeft(restSec); bumpRestCount(); // 保存でレストタイマー自動開始（長さは設定した値）
      setMsg({ ok: true, text: fb });
      doFlush().catch(() => {});   // 保存が通った＝オンライン。積み残しがあれば一緒に送る
    } finally {
      setSaving(false);
    }
  }

  // ===== ヘッダー（ReorderableCards の header: 見出し・編集ボタン・未同期チップ・メッセージ） =====
  // 編集モードの入口は概要タブと同じ「長押し」（日付ストリップ or カード本体）。
  // 編集中は日付ストリップの代わりに ⊕（戻す）／元に戻す／完了 を出す
  const headerJSX = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginRight: 38 }}>
        <Text style={[s.pageTitle, { marginBottom: 0 }]}>{t('運動')}</Text>
        {editing ? (
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
      </View>
      {editing && <Text style={s.editHint}>{t('カードを長押し→そのままドラッグで並び替え。⊖で隠す。「完了」で保存します')}</Text>}

      {/* 未同期バッジ: 圏外保存の積み残しがあるときだけ、控えめなチップで知らせる（タップで手動送信） */}
      {pendingN > 0 && (
        <Pressable style={s.syncChip} onPress={manualFlush} hitSlop={6}>
          <Text style={s.syncChipT}>{t('未同期 {n}件', { n: pendingN })}</Text>
          <Text style={s.syncChipSub}>{t('タップで同期')}</Text>
        </Pressable>
      )}

      {/* 操作結果のメッセージ（どのカードの操作もここに出す） */}
      {msg && <Text style={[s.msg, { marginTop: 0, marginBottom: 10, color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
    </>
  );

  // ===== 並び替え対象のカード（キー→JSX）。ReorderableCards が visibleOrder の順に描く =====
  // ⊖バッジ・長押しで編集開始・編集中の操作停止（pointerEvents）は ReorderableCards 側が付ける
  function renderCard(key: string) {
    if (key === 'move') {
        // ===== きょうの動き: 消費kcal・歩数・目標への逆算（食事の残量と同じ文法） =====
        const walkKcalMin = 0.0613 * myWeight;                 // はや歩き3.5METs相当
        // 目標への上乗せ（設定「アクティブカロリーを目標に反映する」がONのときだけ）。
        // アクティブ全量ではなく max(0, アクティブ − BMR×(生活係数−1)) を足す
        // ＝生活係数にすでに含まれる日常活動ぶんとの二重計上を避ける（根拠は lib/activeKcal.ts）
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
          // 増量目的では収支の意味が逆になる（不足が課題・超過が達成）
          line = over < 0
            ? { text: t('増量ノルマまで あと{n}kcal 食べる', { n: (-over).toLocaleString() }), color: C.amber }
            : { text: t('今日の増量ノルマ達成💪'), color: C.teal };
        } else if (over > 0) {
          // 歩数への逆算は消費推定と同じ係数（lib/stepsKcal.ts）＝表示の数字と往復しても食い違わない
          const steps = stepsForKcal(over, myWeight);
          const min = Math.max(5, Math.round(over / walkKcalMin / 5) * 5);
          line = { text: t('食べすぎぶんは あと約{s}歩（はや歩き{m}分）で帳尻が合います', { s: steps.toLocaleString(), m: min }), color: C.amber };
        } else {
          line = { text: t('収支は目標内。あと{n}kcal食べられます', { n: (-over).toLocaleString() }), color: C.teal };
        }
        const last7 = (healthDays ?? []).slice(-7);
        const maxSteps = Math.max(1, ...last7.map((d) => d.steps));
        const wd = [t('日'), t('月'), t('火'), t('水'), t('木'), t('金'), t('土')];
        return (
          <Animated.View entering={FadeInDown.duration(320)} style={s.card}>
            {/* ガイドの照射対象は上段（見出し・2スタット・逆算の1行）だけ。カード全体は縦に長く、
                スポットライトが画面からはみ出すため（レイアウトへの影響なし: 親はgap未使用） */}
            <View ref={moveTarget} collapsable={false}>
            <View style={s.h2Row}><Activity size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('きょうの動き')}</Text></View>
            <View style={s.mvRow}>
              {/* 消費スタット: 出どころは burn.source（①実測 → ②歩数からの推定 → ③アプリ記録）。
                  歩数10,013歩なのに消費0kcalという不合理（βFB 2026-09-01）は、実測が無い環境で
                  アプリに手で記録した運動（logs adj）だけに落ちていたのが原因。歩数が取れている限り
                  ②で必ず数字が出る。副に出どころとアプリ記録ぶんを小さく添え、どの数字かが分かるようにする */}
              <View style={s.mvStat}>
                <View style={s.mvLblRow}><Flame size={13} color={C.sub} />
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
                {/* 権限の再要求導線: 歩数は取れているのに実測が全部0＝アクティブエネルギーだけ未許可の可能性。
                    タップで requestAuthorization を再呼び出し（追加した型ぶんのダイアログが出る） */}
                {needsActiveAuth && (
                  <Pressable onPress={reauthActiveEnergy} disabled={authBusy} hitSlop={6}>
                    <Text style={[s.mvAuthLink, authBusy && { opacity: 0.5 }]}>{t('消費カロリーの読み取りを許可する →')}</Text>
                  </Pressable>
                )}
              </View>
              <View style={s.mvStat}>
                <View style={s.mvLblRow}><Footprints size={13} color={C.sub} /><Text style={s.mvLbl}>{t('歩数')}</Text></View>
                {stepsOfView != null ? (
                  <Text style={s.mvVal} maxFontSizeMultiplier={1.3}>{stepsOfView.toLocaleString()}<Text style={s.mvUnit}> {t('歩')}</Text></Text>
                ) : healthLink === 'unlinked' ? (
                  // 未連携のときだけ。連携済み（読み込み中・その日の歩数なし）は「—」で、ボタンは二度と出さない
                  <Pressable onPress={connectHealth} hitSlop={6}>
                    <Text style={s.mvLink}>{t('ヘルスケアと連携する')}</Text>
                  </Pressable>
                ) : (
                  <Text style={s.mvVal} maxFontSizeMultiplier={1.3}>—</Text>
                )}
              </View>
            </View>
            {/* 重複計上の注意: 同じランニングをアプリにも記録していれば、実測の中にも
                そのぶんが入っている。厳密な差分計算はしない（過剰に賢くしない）ので、
                「重なりうる」ことだけ正直に断る */}
            {burn.source === 'measured' && (
              <Text style={s.mvNote}>{t('ヘルスケアの実測にはアプリ記録ぶんも含まれることがあります')}</Text>
            )}
            {/* 推定のときは「およそ」であること・なぜ実測でないか（Watchなし等）を正直に断る */}
            {burn.source === 'steps' && (
              <Text style={s.mvNote}>{t('歩数からの推定はおよその値です（歩幅・速度で変わります）。Apple Watchが無いと実測が無いことがあるため、歩数から出しています')}</Text>
            )}
            {/* 再要求してもダイアログが出なかったとき: 設定アプリの場所を案内（タップで設定を開く） */}
            {authHint && (
              <Pressable onPress={() => Linking.openSettings().catch(() => {})} hitSlop={6}>
                <Text style={s.mvAuthHint}>{authHint}</Text>
              </Pressable>
            )}
            {line && <Text style={[s.mvLine, { color: line.color }]}>{line.text}</Text>}
            {/* 目標を黙って増やさない: ONで上乗せが起きた日は、その額をここに出す。
                推定ベースのときは（推定）を付けて、実測と同じ顔をさせない */}
            {activeBonus > 0 && (
              <Text style={s.mvNote}>
                {burn.source === 'steps'
                  ? t('歩いたぶん（推定）+{n}kcal を目標に上乗せしています', { n: activeBonus.toLocaleString() })
                  : t('歩いたぶん +{n}kcal を目標に上乗せしています', { n: activeBonus.toLocaleString() })}
              </Text>
            )}
            </View>
            {/* 週間歩数目標（B-15）: ミニバーの上に週プログレス1本。目標オフ/未連携時は出さない */}
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
                      <View style={[s.mvBar, { height: 6 + Math.round(34 * (d.steps / maxSteps)) }, on && { backgroundColor: C.teal }]} />
                      <Text style={[s.mvBarL, on && { color: C.teal, fontWeight: '800' }]}>{wd[dow]}</Text>
                    </View>
                  );
                })}
              </View>
            )}
            {/* ===== 時間帯別の歩数（A-7残・ヘルスケア式の0-23時バー） =====
                HealthKitが無い環境（Expo Go / Android）はhourlyStepsがnullのまま＝出さない。
                今日を見ているときは現在時刻より未来の時間帯を空にする（静的表示・タップ不要） */}
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
                            <View style={[s.hrBar, { height: v > 0 ? 3 + Math.round(41 * (v / maxHr)) : 2 }, v === 0 && { backgroundColor: C.line }]} />
                          )}
                        </View>
                      );
                    })}
                  </View>
                  {/* 目盛りは6時間おき（0・6・12・18時）。バー24本の下に等間隔で置く */}
                  <View style={s.hrAxis}>
                    {[0, 6, 12, 18].map((h) => (
                      <Text key={h} style={s.hrAxisT}>{t('{n}時', { n: h })}</Text>
                    ))}
                  </View>
                </View>
              );
            })()}
          </Animated.View>
        );
    }

    if (key === 'quick') {
      // ===== かんたん記録: 散歩レベルでもOK・1タップで消費kcalに反映 =====
      return (
        <View style={s.card} ref={trainInputTarget} collapsable={false}>
          <View style={s.h2Row}><Footprints size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('今日の消費カロリーを記録')}</Text></View>
          <Text style={s.muted}>{t('犬の散歩でも立派な運動。記録すると消費カロリーを計算して、今日の「あと食べられる量」に自動で上乗せします。')}</Text>
          <View style={s.actGrid}>
            {shownActs.map((a) => (
              <Pressable key={a.id} style={[s.actChip, actId === a.id && s.actChipOn]}
                         onPress={() => setActId(a.id)}
                         onLongPress={() => saveVisible(visibleIds.filter((x) => x !== a.id))}
                         delayLongPress={450}>
                <Text style={{ fontSize: 21 }}>{a.e}</Text>
                <Text style={[s.actChipT, actId === a.id && { color: C.teal }]} numberOfLines={1}>
                  {activityName(a.id)}
                </Text>
              </Pressable>
            ))}
            {/* 種目を足す入口。長押しで隠せることもここで伝える */}
            <Pressable style={[s.actChip, s.actChipAdd]} onPress={() => setPickerOpen(true)}>
              <Text style={{ fontSize: 21 }}>＋</Text>
              <Text style={[s.actChipT, { color: C.teal }]}>{t('種目を選ぶ')}</Text>
            </Pressable>
          </View>
          <Text style={[s.muted, { marginTop: 10, marginBottom: 4 }]}>{t('時間')}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {MINUTES.map((m) => (
              <Chip key={m} label={`${m}${t('分')}`} tone="ink" selected={actMin === m} onPress={() => setActMin(m)} />
            ))}
            <TextInput style={s.freeMin} placeholder={t('分')} placeholderTextColor={C.faint} keyboardType="number-pad"
                       value={MINUTES.includes(actMin as typeof MINUTES[number]) ? '' : String(actMin)}
                       onChangeText={(v) => { const n = Number(v); if (n > 0) setActMin(n); }} />
          </View>
          <Text style={s.actHint}>{t('長押しで非表示にできます。「＋種目を選ぶ」で戻せます。')}</Text>
          {actId != null && activityById(actId)?.perKgKm != null && (
            <>
              <Text style={[s.muted, { marginTop: 10, marginBottom: 4 }]}>{t('距離（km・任意。入れると消費kcalの精度が上がります）')}</Text>
              <TextInput style={[s.freeMin, { width: 110 }]} placeholder="5.0" placeholderTextColor={C.faint}
                         keyboardType="decimal-pad" value={actKm} onChangeText={setActKm} />
            </>
          )}
          <OptionButton
            style={{ marginTop: 14 }}
            label={actId == null ? t('運動を選んで記録') : t('記録する（約{n}kcal消費）', { n: actKcal() })}
            onPress={saveActivity} busy={actSaving} disabled={actId == null}
          />
          <OptionButton style={{ marginTop: 8 }} variant="tonal" label={t('ヘルスケアから取り込む（Apple Watch等）')} onPress={openHk} />
        </View>
      );
    }

    if (key === 'rest') {
      // レストタイマー（保存で自動開始のほか、いつでも手動で起動できる独立タイマー）
      // ガイドの照射対象: 稼働中/待機中どちらの見た目でも同じ枠で照らせるよう外側をViewで包む
      return (
      <View ref={restTarget} collapsable={false}>
      {(
        restLeft != null ? (
          <Pressable style={s.rest} onPress={() => setRestLeft(restSec)}>
            {/* 残り時間の進捗バー（面の下端。減っていくのが視覚で分かる） */}
            <View style={s.restBarTrack}>
              <View style={[s.restBarFill, { width: `${Math.max(0, Math.min(100, (restLeft / restSec) * 100))}%` }]} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Timer size={15} color={C.teal} />
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
          <Pressable style={s.restIdle} onPress={() => { setRestLeft(restSec); bumpRestCount(); }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Timer size={15} color={C.sub} />
              <Text style={s.restIdleT}>{t('レストタイマー')}</Text>
            </View>
            <Text style={s.restIdleStart}>▶ {fmtRest(restSec)} {t('で開始')}</Text>
          </Pressable>
        )
      )}
      </View>
      );
    }

    if (key === 'liftInput') {
      // ===== 筋トレ入力 =====
      return (
      <View style={s.card} ref={liftTarget} collapsable={false}>
        <View style={s.h2Row}>
          <ClipboardList size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('今日のトレーニングを記録')}</Text>
          {/* プレート計算機（重量ダイアル付近の小さな入口。目標総重量→片側のプレート構成） */}
          <Pressable style={s.plateBtn} onPress={() => setPlateOpen(true)} hitSlop={8}>
            <Text style={s.plateBtnT}>{t('プレート')}</Text>
          </Pressable>
        </View>
        {/* 誰向け・何ができるかの1行（β指摘対応）。押し付けずmutedトーンで */}
        <Text style={s.liftIntro}>{t('本気で挙げる人向け。ボリューム・目標進捗・インターバルまで全部無料で管理できます。')}</Text>
        {favLifts.length > 0 && (
          <View style={s.favRow}>
            {favLifts.map((n) => (
              <Chip key={n} label={n} selected={false} onPress={() => pickLift(n)} />
            ))}
          </View>
        )}
        {tRows.map((r, i) => {
          const bw = isBodyweightLift(r.name);
          return (
          <View key={i}>
          <View style={s.tRow}>
            <Pressable style={[s.tIn, s.tPick]} onPress={() => setLiftPickRow(i)}>
              <Text style={[s.tPickT, !r.name && { color: C.faint }]} numberOfLines={1}>
                {r.name || t('種目を選ぶ')}
              </Text>
            </Pressable>
            <Pressable style={[s.tIn, s.tNum, s.tDial]} onPress={() => setDialRow(i)}>
              <Text style={[s.tDialT, !r.kg && { color: C.faint, fontWeight: '600' }]} numberOfLines={1}>
                {r.kg || (bw ? t('加重') : 'kg')}
              </Text>
            </Pressable>
            <TextInput style={[s.tIn, s.tNum]} placeholder={t('回')} placeholderTextColor={C.faint} keyboardType="number-pad"
                       value={r.reps} onChangeText={(v) => setT(i, { reps: v })} />
            <TextInput style={[s.tIn, s.tNum]} placeholder="set" placeholderTextColor={C.faint} keyboardType="number-pad"
                       value={r.sets} onChangeText={(v) => setT(i, { sets: v })} />
            <Pressable onPress={() => setTRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))}>
              <Text style={{ color: C.coral, fontSize: 21, fontWeight: '800', padding: 4 }}>×</Text>
            </Pressable>
          </View>
          {/* 自重種目は入れたkgが加重なので、実際にかかる負荷をその場で示す */}
          {bw && (hasWeight ? (
            <Text style={s.bwNote}>
              {t('実負荷 約{n}kg', {
                n: effectiveKg({ name: r.name.trim(), kg: Number(r.kg) || 0, reps: 1, sets: 1, mode: 'abs' }, myWeight),
              })}
              {'　'}
              {bwRatioOf(r.name) < 1
                ? t('体重{w}kgの{p}% + 加重{a}kg', { w: myWeight, p: Math.round(bwRatioOf(r.name) * 100), a: Number(r.kg) || 0 })
                : t('体重{w}kg + 加重{a}kg', { w: myWeight, a: Number(r.kg) || 0 })}
            </Text>
          ) : (
            <Text style={s.bwNoteMuted}>
              {t('kgは加重ぶんです。体重を記録すると実負荷（体重＋加重）が出ます。')}
            </Text>
          ))}
          </View>
          );
        })}
        {/* 前回参照: 同種目の直近記録と更新判定 */}
        {(() => {
          const first = tRows.find((r) => r.name.trim());
          if (!first) return null;
          const prev = lastRecordOf(first.name);
          if (!prev) return null;
          const curKg = effectiveKg(
            { name: first.name.trim(), kg: Number(first.kg) || 0, reps: 1, sets: 1, mode: 'abs' },
            myWeight,
          );
          const diff = curKg > 0 ? Math.round((curKg - prev.kg) * 10) / 10 : null;
          return (
            <Text style={s.prevRef}>
              {t('前回: {name} {rec}（{date}）', {
                name: first.name.trim(), rec: prev.text, date: prev.date.slice(5).replace('-', '/'),
              })}
              {diff != null && diff > 0 && <Text style={{ color: C.teal, fontWeight: '800' }}>{' '}{t('→ +{n}kg 更新💪', { n: diff })}</Text>}
              {diff != null && diff < 0 && <Text style={{ color: C.sub }}>{' '}{t('→ {n}kg', { n: diff })}</Text>}
            </Text>
          );
        })()}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <OptionButton style={{ flex: 1 }} variant="tonal" label={t('＋ 種目を追加')} onPress={addLiftRow} />
          <OptionButton style={{ flex: 1 }} label={t('保存する')} onPress={save} busy={saving} />
        </View>
        <Text style={s.muted}>{t('レストの長さ')}</Text>
        <View style={s.restRow}>
          {REST_OPTIONS.map((n) => (
            <Pressable key={n} style={[s.restOpt, restSec === n && s.restOptOn]} onPress={() => pickRest(n)}>
              <Text style={[s.restOptT, restSec === n && s.restOptTOn]}>{fmtRest(n)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      );
    }
    return null;
  }

  // ===== 並び替え対象の下に置く固定要素（ReorderableCards の footer） =====
  const footerJSX = (
    <>
      {/* 挙上重量グラフは概要タブへ移設（入力と振り返りの役割分離） */}
      {history.length > 0 && (
        <Text style={s.moveNote}>{t('挙上重量の推移グラフは「概要」タブ →「挙上重量の推移」で見られます')}</Text>
      )}

      {/* 履歴 */}
      {/* 運動目標への導線（目標を置くとグラフに目標線が出る） */}
      {(
        <Pressable style={s.goalRow} onPress={() => setGoalOpen(true)}>
          <View style={s.goalIcon}><Target size={16} color={C.teal} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.goalRowT}>{t('目標を記録しましょう')}</Text>
            <Text style={s.goalRowSub}>{t('ベンチプレス100kgなど。成長グラフに目標線が引かれます。')}</Text>
          </View>
          <Text style={s.goalRowGo}>›</Text>
        </Pressable>
      )}

      {/* 筋トレ履歴カードは概要タブ「筋トレの成長」へ移設（入力は運動タブ・振り返りは概要タブ）。
          ここには小さな導線だけ残す。NativeTabsでもrouter.pushでタブ遷移できる（coach.tsxと同じ流儀） */}
      {history.length > 0 && (
        <Pressable style={s.moveNoteRow} onPress={() => router.push('/(tabs)/changes')} hitSlop={6}>
          <Text style={s.moveNote}>{t('筋トレ履歴は「概要」タブ →「筋トレの成長」で見られます（タップで移動）')}</Text>
        </Pressable>
      )}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    {/* カードの並び替え（概要タブと同じ ReorderableCards: 長押し→ジグル→ドラッグ・触覚・⊖）。
        ヘッダーとフッターは並び替え対象外の固定要素。編集中は pull-to-refresh を止める */}
    <ReorderableCards
      editing={editing}
      order={visibleOrder}
      onOrderChange={setVisibleOrder}
      renderCard={renderCard}
      onHide={cards.hide}
      ghostLabel={(k) => EX_LABELS()[k] ?? k}
      header={headerJSX}
      footer={footerJSX}
      onEnterEdit={() => setEditing(true)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); invalidateActiveEnergyCache(); await Promise.all([load(), loadMove(viewDate), loadHealth(), loadHourly(viewDate)]); setRefreshing(false); }} />}
      contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
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

    <Modal visible={pickerOpen} animationType="slide" presentationStyle="pageSheet"
           onRequestClose={() => setPickerOpen(false)}>
      <View style={s.hkWrap}>
        <View style={s.hkHead}>
          <Text style={s.hkTitle}>{t('記録できる種目を選ぶ')}</Text>
          <Pressable onPress={() => setPickerOpen(false)} hitSlop={10}>
            <Text style={s.actDone}>{t('完了')}</Text>
          </Pressable>
        </View>
        <Text style={s.muted}>
          {t('チェックした種目がチップに並びます。よく使うものが自動で前に出ます。')}
        </Text>
        <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
          {ACTIVITY_GROUPS.map((g) => (
            <View key={g.key}>
              <Text style={s.actGroupT}>{t(g.label)}</Text>
              {g.ids.map((id) => {
                const a = activityById(id);
                if (!a) return null;
                const on = visibleIds.includes(id);
                const used = (actFreq['act:' + id] ?? 0) > 0;   // 記録したことがある種目
                return (
                  <Pressable key={id} style={s.actPickRow}
                             onPress={() => saveVisible(on
                               ? visibleIds.filter((x) => x !== id)
                               : [...visibleIds, id])}>
                    <Text style={{ fontSize: 21 }}>{a.e}</Text>
                    <Text style={s.actPickT}>{activityName(id)}</Text>
                    {used && <Text style={s.actPickUsed}>{t('記録あり')}</Text>}
                    <Text style={s.actPickMets}>{a.mets} METs</Text>
                    <View style={[s.actCheck, on && s.actCheckOn]}>
                      {on && <Text style={s.actCheckT}>✓</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <Text style={[s.muted, { marginTop: 14 }]}>
            {t('消費カロリーの目安はCompendium of Physical Activities (2011) のMETs値をもとに計算しています。')}
          </Text>
        </ScrollView>
      </View>
    </Modal>

    {dialRow != null && tRows[dialRow] && (() => {
      const r = tRows[dialRow];
      const prev = lastRecordOf(r.name);
      const bw = isBodyweightLift(r.name);
      // 初期位置: 入力済み > 前回の入力kg > 40kg。前回から±で合わせるのが最短になる
      const init = Number(r.kg) > 0 ? Number(r.kg) : (prev ? prev.rawKg : 40);
      return (
        <WeightDial
          title={r.name.trim() || t('重量を選ぶ')}
          subtitle={prev ? t('前回: {name} {rec}（{date}）', {
            name: r.name.trim(), rec: prev.text, date: prev.date.slice(5).replace('-', '/'),
          }) : undefined}
          unitLabel={bw ? t('加重') : 'kg'}
          initial={init}
          allowZero={bw}
          hint={bw && hasWeight ? (v) => t('実負荷 約{n}kg', {
            n: effectiveKg({ name: r.name.trim(), kg: v, reps: 1, sets: 1, mode: 'abs' }, myWeight),
          }) : undefined}
          onClose={() => setDialRow(null)}
          onPick={(v) => {
            setT(dialRow, { kg: v === 0 ? '' : (v % 1 === 0 ? String(v) : v.toFixed(1)) });
            setDialRow(null);
          }}
        />
      );
    })()}

    {/* プレート計算機。初期値は入力中のkg（無ければ60kg=よくある発射台） */}
    {plateOpen && (
      <PlateCalc
        initial={tRows.map((r) => Number(r.kg)).find((n) => n > 0) ?? 60}
        onClose={() => setPlateOpen(false)}
      />
    )}

    <LiftPicker
      visible={liftPickRow != null}
      onClose={() => setLiftPickRow(null)}
      history={history.flatMap((h) => parseLiftText(h.text).map((x) => x.name))}
      onPick={(name) => { if (liftPickRow != null) setT(liftPickRow, { name }); }}
    />

    <StatusBarMask />
    <HeaderGear />
    </View>
  );
}

const s = themed(() => ({
  scroll: { padding: SPACE.screen, paddingBottom: 24 },   // 下端はinsets.bottom（タブバー高さ込み）を描画側で足す
  h: { ...HEAD.section, color: C.ink, marginBottom: 12 },
  addBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  doneBtn2: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.chip, backgroundColor: C.teal },
  doneBtn2T: { color: '#fff', fontSize: 13, fontWeight: '800' },
  // 編集モードの「元に戻す」とヒント（概要タブと同じ見た目）
  editBtn: { borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.chip, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.panel },
  editBtnT: { fontSize: 13, fontWeight: '800', color: C.sub },
  editHint: { fontSize: 13, color: C.sub, marginBottom: 10, textAlign: 'center' },
  pageTitle: { ...HEAD.page, color: C.ink, marginBottom: 12 },
  // 消費カロリーの読み取り許可への導線（スタット内の小さなリンク）と、設定アプリへの案内文
  mvAuthLink: { fontSize: 11.5, fontWeight: '800', color: C.teal, marginTop: 6, lineHeight: 15 },
  mvAuthHint: { fontSize: 11.5, color: C.amber, fontWeight: '600', lineHeight: 16, marginTop: 8 },
  // きょうの動きカード
  mvRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  mvStat: { flex: 1, backgroundColor: C.bg, borderRadius: RADIUS.tile, paddingVertical: 12, paddingHorizontal: 14 },
  mvLblRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  mvLbl: { fontSize: 12, fontWeight: '700', color: C.sub },
  mvVal: { fontSize: 25, fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'] },
  mvUnit: { fontSize: 13, fontWeight: '700', color: C.sub },
  mvLink: { fontSize: 14, fontWeight: '800', color: C.teal, textDecorationLine: 'underline', paddingVertical: 6 },
  // スタット内の副表示（実測の出どころ・アプリ記録ぶん）。主の数字を邪魔しない小ささに留める
  mvStatSub: { fontSize: 11, fontWeight: '700', color: C.sub, marginTop: 2, lineHeight: 15 },
  mvNote: { fontSize: 11.5, color: C.faint, lineHeight: 16, marginTop: 8 },
  mvLine: { fontSize: 13.5, fontWeight: '700', lineHeight: 20, marginTop: 12 },
  mvBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 14 },
  mvBar: { width: '62%', borderRadius: 4, backgroundColor: C.line },
  mvBarL: { fontSize: 10.5, color: C.faint, fontWeight: '700' },
  // 時間帯別の歩数（0-23時・ヘルスケア式）。バーは静的表示・未来の時間帯は空
  hrWrap: { marginTop: 14, borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 12 },
  hrTitle: { fontSize: 12, fontWeight: '700', color: C.sub, marginBottom: 8 },
  hrBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 44 },
  hrCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  hrBar: { alignSelf: 'stretch', borderRadius: 2, backgroundColor: C.teal },
  hrEmpty: { alignSelf: 'stretch', height: 2, borderRadius: 2, backgroundColor: C.track },
  hrAxis: { flexDirection: 'row', marginTop: 4 },
  hrAxisT: { flex: 1, fontSize: 11, color: C.faint, fontWeight: '700', textAlign: 'left' },
  segWrap: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  segBtn: {
    flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip,
    paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  segBtnOn: { backgroundColor: C.teal, borderColor: C.teal },
  segBtnT: { fontSize: 15, fontWeight: '800', color: C.sub },
  actGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actPickUsed: {
    fontSize: 11, fontWeight: '800', color: C.teal,
    backgroundColor: C.accentBadge, borderRadius: RADIUS.chip, paddingHorizontal: 6, paddingVertical: 2,
  },
  tDial: { justifyContent: 'center', alignItems: 'center' },
  tDialT: { fontSize: 15, color: C.ink, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tPick: { flex: 1, justifyContent: 'center' },
  tPickT: { fontSize: 15, color: C.ink, fontWeight: '600' },
  restRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' },
  restOpt: {
    borderWidth: 1, borderColor: C.line, backgroundColor: C.panel,
    borderRadius: RADIUS.chip, paddingHorizontal: 11, paddingVertical: 6,
  },
  restOptOn: { borderColor: C.teal, backgroundColor: C.accentBadge, borderWidth: 1.5 },
  restOptT: { fontSize: 13, fontWeight: '800', color: C.sub },
  restOptTOn: { color: C.teal },
  actHint: { fontSize: 11, color: C.faint, marginTop: 6 },
  actDone: { fontSize: 15, fontWeight: '800', color: C.teal },
  actGroupT: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 16, marginBottom: 4 },
  actPickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: C.line,
  },
  actPickT: { flex: 1, fontSize: 15, color: C.ink, fontWeight: '600' },
  actPickMets: { fontSize: 11, color: C.faint, fontWeight: '700' },
  actCheck: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center',
  },
  actCheckOn: { backgroundColor: C.teal, borderColor: C.teal },
  actCheckT: { color: '#fff', fontSize: 13, fontWeight: '900' },
  actChipAdd: { borderStyle: 'dashed', borderColor: C.accentBorder, backgroundColor: C.accentSoft },
  actChip: {
    width: '23%', backgroundColor: C.chipBg, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.panel,
    paddingVertical: 10, alignItems: 'center', gap: 3,
  },
  actChipOn: { borderColor: C.teal, backgroundColor: C.accentSoft },
  actChipT: { fontSize: 11, fontWeight: '700', color: C.sub, textAlign: 'center' },
  hkWrap: { flex: 1, backgroundColor: C.bg, padding: SPACE.screen, paddingTop: sheetTopPad(18) },
  hkHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hkTitle: { ...HEAD.card, color: C.ink },
  hkClose: { fontSize: 24, color: C.sub, fontWeight: '600', paddingHorizontal: 6 },
  hkSub: { fontSize: 13, color: C.sub, marginTop: 6, lineHeight: 18 },
  hkMsg: { fontSize: 13, fontWeight: '600', color: C.sub, marginTop: 16, textAlign: 'center' },
  hkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: C.line },
  hkCheck: { fontSize: 17, color: C.teal },
  hkDate: { width: 44, fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  hkName: { flex: 1, fontSize: 15, fontWeight: '700', color: C.ink },
  hkMeta: { fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  freeMin: {
    width: 72, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.chip,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: C.ink, textAlign: 'center',
  },
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: RADIUS.tile, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12,
  },
  restIdleT: { fontSize: 13, fontWeight: '700', color: C.sub },
  restIdleStart: { fontSize: 13, fontWeight: '800', color: C.teal },
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
  restN: { fontSize: 21, fontWeight: '900', color: C.teal, fontVariant: ['tabular-nums'] },
  restHint: { fontSize: 11, color: C.sub },
  prevRef: { fontSize: 13, color: C.sub, marginTop: 4, lineHeight: 18 },
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: RADIUS.card, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: SPACE.card, marginBottom: 12 },
  tRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 },
  tIn: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.input, padding: 10, fontSize: 17, color: C.ink },
  tNum: { width: 56, textAlign: 'center' },
  btnPrimary: { backgroundColor: C.ink, borderRadius: RADIUS.chip, paddingVertical: 12, alignItems: 'center' },
  btnPrimaryT: { color: C.panel, fontSize: 15, fontWeight: '800' },  // ink地（ダーク=明色）に追従
  btnGhost: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, paddingVertical: 12, alignItems: 'center' },
  btnGhostT: { color: C.ink, fontSize: 15, fontWeight: '800' },
  msg: { fontSize: 15, fontWeight: '600', marginTop: 8 },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontSize: 13, fontWeight: '700', color: C.sub },
  verdict: { fontSize: 13, fontWeight: '600', lineHeight: 19, marginTop: 4 },
  moveNote: { fontSize: 13, color: C.sub, marginBottom: 12, paddingHorizontal: 4, lineHeight: 18 },
  moveNoteRow: { paddingVertical: 2 },
  // 筋トレ入力カードの「誰向け・何ができる」1行（見出し直下・mutedトーン）
  liftIntro: { fontSize: 13, color: C.sub, lineHeight: 18, marginBottom: 4 },
  muted: { fontSize: 15, color: C.sub },
  bwNoteMuted: { fontSize: 13, color: C.faint, fontWeight: '600', marginTop: 2, marginBottom: 2, paddingLeft: 2 },
  favRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 2 },
  bwNote: { fontSize: 13, color: C.teal, fontWeight: '700', marginTop: 2, marginBottom: 2, paddingLeft: 2 },
  // 未同期チップ（圏外保存の積み残し）。責め色にしない・控えめに
  syncChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.chip,
    paddingHorizontal: 11, paddingVertical: 6, marginBottom: 10,
  },
  syncChipT: { fontSize: 12, fontWeight: '800', color: C.amber, fontVariant: ['tabular-nums'] },
  syncChipSub: { fontSize: 11, fontWeight: '700', color: C.faint },
  // プレート計算機の入口（筋トレ入力カードの見出し右端）
  plateBtn: {
    marginLeft: 'auto', borderWidth: 1, borderColor: C.line, backgroundColor: C.chipBg,
    borderRadius: RADIUS.chip, paddingHorizontal: 10, paddingVertical: 4,
  },
  plateBtnT: { fontSize: 11, fontWeight: '800', color: C.sub },
}));
