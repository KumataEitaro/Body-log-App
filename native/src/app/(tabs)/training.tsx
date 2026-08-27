// 運動タブ: かんたん記録（散歩レベルの日常運動をMETs換算で1タップ記録）＋筋トレ
// 筋トレ勢だけでなくライトユーザーも「今日も動けた」を記録できるようにする
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Modal, Alert, Vibration } from 'react-native';
import { healthAvailable, requestHealthAuth, listWorkouts, importWorkouts, readActivitySummary, type HKWorkout, type HealthDaySummary } from '@/lib/health';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { usePurpose } from '@/lib/purpose';
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';
import { C } from '@/lib/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { todayJST } from '@/lib/calc';
import { ClipboardList, BookOpen, Timer, Footprints, Target, Flame, Activity } from 'lucide-react-native';
import GoalPanel from '@/components/GoalPanel';
import { bumpRestCount } from '@/lib/achievements';
import StatusBarMask from '@/components/StatusBarMask';
import { useGuideTarget, useGuideScroller } from '@/components/GuideTour';
import HeaderGear from '@/components/HeaderGear';
import QuickLogFab from '@/components/QuickLogFab';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateStrip from '@/components/DateStrip';
import LiftPicker from '@/components/LiftPicker';
import WeightDial from '@/components/WeightDial';
import { loadCustomLifts, bwRatioOf, isBodyweightLift, liftPartOf, liftPartLabel, LIFT_PARTS } from '@/lib/lifts';
import {
  groupLiftsByDay, removeLiftAt, liftSetLabel, parseLiftText, effectiveKg, weightLookup, volumeOf,
  type LiftEntry,
} from '@/lib/liftLog';
import {
  ACTIVITIES, ACTIVITY_GROUPS, activityById, activityName, activityKcal, DEFAULT_VISIBLE,
} from '@/lib/activities';
import { bumpFoodFreq, readFoodFreq, foodScores } from '@/lib/foods';
import { MinusBadge, AddCardSheet, useCardLayout } from '@/components/CardLayout';
import { Plus } from 'lucide-react-native';
import { Chip, OptionButton } from '@/components/ui/Selectable';
import { epley1RM, parse1RMs, repsNeededFor } from '@/lib/rm';
import { t } from '@/lib/i18n';

type TRow = { name: string; kg: string; reps: string; sets: string };

// 履歴の日見出し（例: 8/20(水)）。t()はモジュール読み込み時に評価すると言語切替に追従しないため関数内で呼ぶ
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const wd = [t('日'), t('月'), t('火'), t('水'), t('木'), t('金'), t('土')];
  const dow = wd[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return t('{m}/{d}({w})', { m, d, w: dow });
}
type HistRow = { id: string; date: string; text: string };

// 種目の定義は lib/activities.ts（54種・METsはCompendium 2011準拠）
const MINUTES = [10, 20, 30, 45, 60, 90] as const;
// レストの選択肢（秒）。30秒=追い込み / 90秒=標準 / 3〜5分=高重量 / 10分=神経系
const REST_OPTIONS = [30, 60, 90, 120, 180, 300, 600];

// レスト秒数の表示（60の倍数は「分」、90秒などはそのまま「秒」）
const fmtRest = (n: number) => (n >= 60 && n % 60 === 0 ? t('{n}分', { n: n / 60 }) : t('{n}秒', { n }));

// 表示/非表示できるカード（上から: きょうの動き→ゆる記録→筋トレ入力→履歴）
const EX_CARDS = ['move', 'quick', 'liftInput', 'liftHistory'];
const EX_LABELS = (): Record<string, string> => ({
  move: t('きょうの動き'),
  quick: t('今日の消費カロリーを記録'),
  liftInput: t('今日のトレーニングを記録'),
  liftHistory: t('筋トレ履歴'),
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
  // 履歴の部位フィルタ（nullなら全部）
  const [partFilter, setPartFilter] = useState<string | null>(null);
  // 履歴でひらいている日（食事と同じで、直近の日は最初からひらいておく）
  const [openDay, setOpenDay] = useState<string | null>(null);
  // 履歴に出す日数。ひと目で見渡せる量から始めて、必要なら遡れるようにする
  const [dayLimit, setDayLimit] = useState(10);
  // 書き換え中の記録。保存すると元の記録を置き換える（食事の「書き換える」と同じ考え方）
  const [rewriting, setRewriting] = useState<{ id: string; date: string } | null>(null);
  const trainInputTarget = useGuideTarget('trainInput');
  const trScrollRef = useRef<ScrollView>(null);
  const trY = useRef(0);
  useGuideScroller('/training', useCallback((delta: number) => {
    trScrollRef.current?.scrollTo({ y: Math.max(0, trY.current + delta), animated: true });
  }, []));

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
  const cards = useCardLayout('bl-cards-exercise', EX_CARDS);

  const vis = (k: string) => !cards.layout.hidden.includes(k);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // ===== きょうの動き（消費kcal・歩数・目標への逆算）=====
  // コンセプト: 食事タブの「あと食べられる量」と同じ文法で「動き」を見せる。
  // 消費が見えるから、目標に対してあと何歩かを逆算できる。
  const purpose = usePurpose();
  const [burnToday, setBurnToday] = useState(0);
  const [entryToday, setEntryToday] = useState<{ intake: number | null; target: number | null }>({ intake: null, target: null });
  const [healthDays, setHealthDays] = useState<HealthDaySummary[] | null>(null);
  const loadMove = useCallback(async (date: string) => {
    const [ls, en] = await Promise.all([
      supabase.from('logs').select('adj').eq('date', date),
      supabase.from('entries').select('intake,target').eq('date', date).maybeSingle(),
    ]);
    setBurnToday(((ls.data as { adj: number | null }[]) || []).reduce((sum, l) => sum + Math.max(0, Number(l.adj) || 0), 0));
    const e = en.data as { intake: number | null; target: number | null } | null;
    setEntryToday({
      intake: e?.intake != null ? Number(e.intake) : null,
      target: e?.target != null ? Number(e.target) : null,
    });
  }, []);
  useEffect(() => { loadMove(viewDate); }, [viewDate, loadMove]);
  const loadHealth = useCallback(async () => {
    if (!healthAvailable()) return;
    const r = await readActivitySummary(7);
    if (!('error' in r)) setHealthDays(r);
  }, []);
  useEffect(() => { loadHealth(); }, [loadHealth]);
  async function connectHealth() {
    if (!healthAvailable()) { setMsg({ ok: false, text: t('歩数の自動表示はTestFlight版でのみ使えます（Expo Goでは動きません）。') }); return; }
    if (await requestHealthAuth()) await loadHealth();
  }
  const stepsOfView = healthDays?.find((d) => d.date === viewDate)?.steps ?? null;

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
      if (!(await requestHealthAuth())) { setHkMsg(t('ヘルスケアへのアクセスが許可されませんでした。iOSの設定 > プライバシー > ヘルスケア から許可できます。')); return; }
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
      // v17列（ex_minutes/ex_km）が無い旧DBでも保存できるようフォールバック
      let { error } = await supabase.from('logs').insert({ ...base, ex_minutes: actMin, ex_km: km });
      if (error && /ex_minutes|ex_km|column|schema/i.test(error.message)) {
        ({ error } = await supabase.from('logs').insert(base));
      }
      if (error) { setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') }); return; }
      await syncEntriesForDate(uid, today);
      loadMove(today); // 「きょうの動き」の消費kcalと逆算を即時更新
      bumpFoodFreq('act:' + a.id);            // よく使う種目を前に出すため
      setActFreq(foodScores(readFoodFreq()));
      setActId(null); setActKm('');
      setMsg({ ok: true, text: t('{act}を記録しました。目標カロリーに+{kcal}kcal反映されます🎉', { act: `${activityName(a.id)} ${actMin}${t('分')}${km ? ` ${km}km` : ''}`, kcal }) });
    } finally { setActSaving(false); }
  }

  const setT = (i: number, patch: Partial<TRow>) => setTRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const load = useCallback(async () => {
    const { data } = await supabase.from('logs').select('id,date,text')
      .like('text', '🏋️%').order('at', { ascending: false }).limit(60);
    setHistory((data as HistRow[]) || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  // 履歴を日ごとにまとめる（食事の「その日の記録」と同じ見せ方にそろえる）
  const days = groupLiftsByDay(history, weightAt);
  // 直近の日は最初からひらく。ユーザーが開閉したらその選択を優先する
  const shownDay = openDay ?? days[0]?.date ?? null;
  const shownDays = days.slice(0, dayLimit);

  // 部位フィルタ。削除は元の並びのindexで行うため、entriesは絞らず描画時に飛ばす
  const matchPart = (e: LiftEntry) => partFilter == null || liftPartOf(e.name) === partFilter;
  // 日の見出しの数字は、フィルタ中はその部位ぶんだけで数え直す
  function dayStats(d: (typeof days)[number]) {
    if (partFilter == null) return { lifts: d.lifts, sets: d.sets, volume: d.volume, any: true };
    const w = weightAt(d.date);
    const names = new Set<string>();
    let sets = 0; let volume = 0; let any = false;
    for (const rec of d.records) for (const e of rec.entries) {
      if (!matchPart(e)) continue;
      any = true; names.add(e.name); sets += e.sets; volume += volumeOf(e, w);
    }
    return { lifts: names.size, sets, volume: Math.round(volume), any };
  }
  const visDays = partFilter == null ? shownDays : shownDays.filter((d) => dayStats(d).any);

  // 記録から1種目だけ取り除く（他の種目は残す）
  function deleteOneLift(rec: { id: string; entries: LiftEntry[] }, index: number, date: string) {
    const e = rec.entries[index];
    if (!e) return;
    Alert.alert(t('「{name}」を削除しますか？', { name: e.name }), t('この記録の他の種目は残ります。'), [
      { text: t('キャンセル'), style: 'cancel' },
      {
        text: t('削除する'),
        style: 'destructive' as const,
        onPress: async () => {
          const r = removeLiftAt(rec.entries, index);
          const q = r.kind === 'delete'
            ? supabase.from('logs').delete().eq('id', rec.id)
            : supabase.from('logs').update({ text: r.text }).eq('id', rec.id);
          const { error } = await q;
          if (error) { setMsg({ ok: false, text: t('削除に失敗しました。もう一度お試しください。') }); return; }
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user?.id) await syncEntriesForDate(session.user.id, date);
          if (rewriting?.id === rec.id) cancelRewrite();   // 書き換え中の記録が消えたら編集も解除
          await load();
        },
      },
    ]);
  }

  // 記録の長押しメニュー: 書き換え（入力欄へ戻す）と削除
  function confirmRecord(rec: { id: string; text: string; entries: LiftEntry[] }, date: string) {
    Alert.alert(t('この記録をどうしますか？'), rec.text.replace(/^🏋️ /, ''), [
      { text: t('キャンセル'), style: 'cancel' },
      ...(rec.entries.length > 0 ? [{ text: t('書き換える'), onPress: () => startEditRecord(rec, date) }] : []),
      {
        text: t('削除する'),
        style: 'destructive' as const,
        onPress: async () => {
          const { error } = await supabase.from('logs').delete().eq('id', rec.id);
          if (error) { setMsg({ ok: false, text: t('削除に失敗しました。もう一度お試しください。') }); return; }
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user?.id) await syncEntriesForDate(session.user.id, date);
          if (rewriting?.id === rec.id) cancelRewrite();
          await load();
        },
      },
    ]);
  }

  // 記録を入力欄へ戻して書き換え状態にする（保存すると元の記録を置き換える）
  function startEditRecord(rec: { id: string; entries: LiftEntry[] }, date: string) {
    setTRows(rec.entries.map((e) => ({
      name: e.name, kg: String(e.kg), reps: String(e.reps), sets: e.sets > 1 ? String(e.sets) : '',
    })));
    setRewriting({ id: rec.id, date });
    setMsg({ ok: true, text: t('入力欄に戻しました。直して保存すると置き換わります。') });
    trScrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  function cancelRewrite() {
    setRewriting(null);
    setTRows([{ name: '', kg: '', reps: '', sets: '' }]);
    setMsg(null);
  }

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
      // 書き換えのときは元の記録の日付を保つ（過去の記録を今日に移動させない）
      const today = rewriting?.date ?? viewDate;
      if (rewriting) {
        const { error: delErr } = await supabase.from('logs').delete().eq('id', rewriting.id);
        if (delErr) { setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') }); return; }
      }
      const { error } = await supabase.from('logs').insert({
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: null, ex: 'オフ', adj: 0, mood: '', text: tr, photo_urls: [],
      });
      if (error) { setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') }); return; }
      await syncEntriesForDate(uid, today);
      const wasEdit = rewriting != null;
      setRewriting(null);

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
      // 保存後も種目とkgは残して回数だけ空ける（書き換えのときはまっさらに戻す）
      const lastRow = wasEdit ? null : tRows.filter(rowReady).slice(-1)[0] ?? null;
      setTRows([lastRow ? { name: lastRow.name, kg: lastRow.kg, reps: '', sets: '' } : { name: '', kg: '', reps: '', sets: '' }]);
      await load();
      if (!wasEdit) { setRestLeft(restSec); bumpRestCount(); } // 保存でレストタイマー自動開始（長さは設定した値）
      setMsg({ ok: true, text: wasEdit ? t('書き換えました。') : fb });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <ScrollView
      ref={trScrollRef}
      style={{ flex: 1 }} contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      onScroll={(e) => { trY.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={32}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await Promise.all([load(), loadMove(viewDate), loadHealth()]); setRefreshing(false); }} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginRight: 38 }}>
        <Text style={[s.pageTitle, { marginBottom: 0 }]}>{t('運動')}</Text>
        {editing ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Pressable onPress={() => setAddOpen(true)} style={s.addBtn} hitSlop={8}>
              <Plus size={16} color="#fff" strokeWidth={3} />
            </Pressable>
            <Pressable onPress={() => setEditing(false)} style={s.doneBtn2} hitSlop={8}>
              <Text style={s.doneBtn2T}>{t('完了')}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onLongPress={() => setEditing(true)} delayLongPress={450}>
            <DateStrip value={viewDate} onChange={setViewDate} />
          </Pressable>
        )}
      </View>

      {/* 操作結果のメッセージ（どのカードの操作もここに出す） */}
      {msg && <Text style={[s.msg, { marginTop: 0, marginBottom: 10, color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}

      {/* ===== きょうの動き: 消費kcal・歩数・目標への逆算（食事の残量と同じ文法） ===== */}
      {vis('move') && (() => {
        const kcalPerStep = Math.max(0.02, myWeight * 0.0005); // 87kgで約0.044kcal/歩
        const walkKcalMin = 0.0613 * myWeight;                 // はや歩き3.5METs相当
        const target = entryToday.target;
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
          const steps = Math.ceil(over / kcalPerStep / 100) * 100;
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
            <MinusBadge editing={editing} onPress={() => cards.hide('move')} />
            <View style={s.h2Row}><Activity size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('きょうの動き')}</Text></View>
            <View style={s.mvRow}>
              <View style={s.mvStat}>
                <View style={s.mvLblRow}><Flame size={13} color={C.sub} /><Text style={s.mvLbl}>{t('消費（運動）')}</Text></View>
                <Text style={s.mvVal}>{Math.round(burnToday).toLocaleString()}<Text style={s.mvUnit}> kcal</Text></Text>
              </View>
              <View style={s.mvStat}>
                <View style={s.mvLblRow}><Footprints size={13} color={C.sub} /><Text style={s.mvLbl}>{t('歩数')}</Text></View>
                {stepsOfView != null ? (
                  <Text style={s.mvVal}>{stepsOfView.toLocaleString()}<Text style={s.mvUnit}> {t('歩')}</Text></Text>
                ) : (
                  <Pressable onPress={connectHealth} hitSlop={6}>
                    <Text style={s.mvLink}>{t('ヘルスケアと連携する')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
            {line && <Text style={[s.mvLine, { color: line.color }]}>{line.text}</Text>}
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
          </Animated.View>
        );
      })()}

      {/* ===== かんたん記録: 散歩レベルでもOK・1タップで消費kcalに反映 ===== */}
      {vis('quick') && (
        <View style={s.card} ref={trainInputTarget} collapsable={false}>
          <MinusBadge editing={editing} onPress={() => cards.hide('quick')} />
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
      )}

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

      {/* レストタイマー（保存で自動開始のほか、いつでも手動で起動できる独立タイマー） */}
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
            <Text style={s.restN}>
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

      {/* 入力 */}
      <View style={[s.card, !vis('liftInput') && { display: 'none' }]}>
        <MinusBadge editing={editing} onPress={() => cards.hide('liftInput')} />
        <View style={s.h2Row}><ClipboardList size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('今日のトレーニングを記録')}</Text></View>
        {rewriting && (
          <View style={s.editBanner}>
            <Text style={s.editBannerT}>{t('✏️ {date}の記録を書き換え中', { date: dayLabel(rewriting.date) })}</Text>
            <Pressable onPress={cancelRewrite} hitSlop={8}>
              <Text style={s.editBannerCancel}>{t('やめる')}</Text>
            </Pressable>
          </View>
        )}
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
          <OptionButton style={{ flex: 1 }} variant="tonal" label={rewriting ? t('やめる') : t('＋ 種目を追加')}
                        onPress={() => (rewriting ? cancelRewrite() : addLiftRow())} />
          <OptionButton style={{ flex: 1 }} label={rewriting ? t('✓ 書き換える') : t('保存する')} onPress={save} busy={saving} />
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

      <View style={[s.card, !vis('liftHistory') && { display: 'none' }]}>
        <MinusBadge editing={editing} onPress={() => cards.hide('liftHistory')} />
        <View style={s.h2Row}><BookOpen size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('筋トレ履歴')}</Text></View>
        {days.length === 0 && <Text style={s.muted}>{t('まだ記録がありません。今日の1セット目から始めましょう。')}</Text>}
        {/* 部位フィルタ: 「肩の日はいつだったか」を部位ごとに遡れるようにする */}
        {days.length > 0 && (() => {
          const present = new Set<string>();
          for (const d of days) for (const rec of d.records) for (const e of rec.entries) present.add(liftPartOf(e.name));
          const keys = [...LIFT_PARTS.map((x) => x.key), 'other'].filter((k) => present.has(k));
          if (keys.length < 2) return null;
          return (
            <View style={s.partRow}>
              <Chip label={t('全部')} selected={partFilter == null} onPress={() => setPartFilter(null)} />
              {keys.map((k) => (
                <Chip key={k} label={t(liftPartLabel(k))} selected={partFilter === k}
                      onPress={() => setPartFilter((cur) => (cur === k ? null : k))} />
              ))}
            </View>
          );
        })()}
        {visDays.map((d) => {
          const open = shownDay === d.date;
          const st = dayStats(d);
          return (
            <View key={d.date}>
              {/* 日の見出し: たたんだままでもその日の手応えが数字で分かる */}
              <Pressable style={s.dayHead} onPress={() => setOpenDay(open ? '' : d.date)} hitSlop={4}>
                <Text style={s.dayDate}>{dayLabel(d.date)}</Text>
                <Text style={s.daySum} numberOfLines={1}>
                  {t('{n}種目', { n: st.lifts })}・{t('{n}セット', { n: st.sets })}
                  {st.volume > 0 ? `・${st.volume.toLocaleString()}kg` : ''}
                </Text>
                <Text style={s.dayCaret}>{open ? '▴' : '▾'}</Text>
              </Pressable>
              {open && d.records
                .filter((rec) => partFilter == null || rec.entries.some(matchPart))
                .map((rec) => (
                <View key={rec.id}>
                  {rec.entries.length === 0 && partFilter == null && (
                    <Pressable style={s.liftRow} onLongPress={() => confirmRecord(rec, d.date)} delayLongPress={450}>
                      <Text style={s.liftName}>{rec.text.replace(/^🏋️ /, '')}</Text>
                    </Pressable>
                  )}
                  {rec.entries.map((e, ix) => (matchPart(e) ? (
                    <Pressable key={`${rec.id}-${ix}`} style={s.liftRow}
                               onLongPress={() => confirmRecord(rec, d.date)} delayLongPress={450}>
                      <Text style={s.liftName} numberOfLines={1}>{e.name}</Text>
                      <Text style={s.liftSet}>{liftSetLabel(e, t('自重'))}</Text>
                      <Pressable onPress={() => deleteOneLift(rec, ix, d.date)} hitSlop={10}>
                        <Text style={s.liftX}>×</Text>
                      </Pressable>
                    </Pressable>
                  ) : null))}
                </View>
              ))}
            </View>
          );
        })}
        {days.length > shownDays.length && (
          <Pressable style={s.moreBtn} onPress={() => setDayLimit((n) => n + 10)} hitSlop={6}>
            <Text style={s.moreBtnT}>{t('さらに前の{n}日を見る', { n: Math.min(10, days.length - shownDays.length) })}</Text>
          </Pressable>
        )}
        {days.length > 0 && <Text style={s.histHint}>{t('行を長押しで書き換え・削除、×でその種目だけ削除できます')}</Text>}
      </View>
    </ScrollView>
    <QuickLogFab />
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

const s = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 24 },   // 下端はinsets.bottom（タブバー高さ込み）を描画側で足す
  h: { fontSize: 21, fontWeight: '800', color: C.ink, marginBottom: 12 },
  addBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  doneBtn2: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: C.teal },
  doneBtn2T: { color: '#fff', fontSize: 13, fontWeight: '800' },
  pageTitle: { fontSize: 26, fontWeight: '600', color: C.ink, marginBottom: 12 },
  // きょうの動きカード
  mvRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  mvStat: { flex: 1, backgroundColor: C.bg, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  mvLblRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  mvLbl: { fontSize: 12, fontWeight: '700', color: C.sub },
  mvVal: { fontSize: 25, fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'] },
  mvUnit: { fontSize: 13, fontWeight: '700', color: C.sub },
  mvLink: { fontSize: 14, fontWeight: '800', color: C.teal, textDecorationLine: 'underline', paddingVertical: 6 },
  mvLine: { fontSize: 13.5, fontWeight: '700', lineHeight: 20, marginTop: 12 },
  mvBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 14 },
  mvBar: { width: '62%', borderRadius: 4, backgroundColor: C.line },
  mvBarL: { fontSize: 10.5, color: C.faint, fontWeight: '700' },
  segWrap: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  segBtn: {
    flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999,
    paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  segBtnOn: { backgroundColor: C.teal, borderColor: C.teal },
  segBtnT: { fontSize: 15, fontWeight: '800', color: C.sub },
  actGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actPickUsed: {
    fontSize: 11, fontWeight: '800', color: C.teal,
    backgroundColor: C.accentBadge, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2,
  },
  tDial: { justifyContent: 'center', alignItems: 'center' },
  tDialT: { fontSize: 15, color: C.ink, fontWeight: '700', fontVariant: ['tabular-nums'] },
  partRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 2 },
  tPick: { flex: 1, justifyContent: 'center' },
  tPickT: { fontSize: 15, color: C.ink, fontWeight: '600' },
  restRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' },
  restOpt: {
    borderWidth: 1, borderColor: C.line, backgroundColor: C.panel,
    borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6,
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
    width: '23%', backgroundColor: C.chipBg, borderWidth: 1.5, borderColor: C.line, borderRadius: 16,
    paddingVertical: 10, alignItems: 'center', gap: 3,
  },
  actChipOn: { borderColor: C.teal, backgroundColor: C.accentSoft },
  actChipT: { fontSize: 11, fontWeight: '700', color: C.sub, textAlign: 'center' },
  hkWrap: { flex: 1, backgroundColor: C.bg, padding: 16, paddingTop: 18 },
  hkHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hkTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  hkClose: { fontSize: 24, color: C.sub, fontWeight: '600', paddingHorizontal: 6 },
  hkSub: { fontSize: 13, color: C.sub, marginTop: 6, lineHeight: 18 },
  hkMsg: { fontSize: 13, fontWeight: '600', color: C.sub, marginTop: 16, textAlign: 'center' },
  hkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: C.line },
  hkCheck: { fontSize: 17, color: C.teal },
  hkDate: { width: 44, fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  hkName: { flex: 1, fontSize: 15, fontWeight: '700', color: C.ink },
  hkMeta: { fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  freeMin: {
    width: 72, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: C.ink, textAlign: 'center',
  },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink, marginBottom: 10 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  rest: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12,
    overflow: 'hidden',
  },
  restBarTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'transparent' },
  restBarFill: { height: 3, backgroundColor: C.teal, borderRadius: 2 },
  restStop: { fontSize: 11, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  restIdle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12,
  },
  restIdleT: { fontSize: 13, fontWeight: '700', color: C.sub },
  restIdleStart: { fontSize: 13, fontWeight: '800', color: C.teal },
  goalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12,
  },
  goalIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  goalRowT: { fontSize: 13.5, fontWeight: '800', color: C.ink },
  goalRowSub: { fontSize: 11.5, color: C.sub, marginTop: 1 },
  goalRowGo: { fontSize: 22, color: C.faint, fontWeight: '300' },
  restL: { fontSize: 13, fontWeight: '800', color: C.ink },
  restN: { fontSize: 21, fontWeight: '900', color: C.teal, fontVariant: ['tabular-nums'] },
  restHint: { fontSize: 11, color: C.sub },
  prevRef: { fontSize: 13, color: C.sub, marginTop: 4, lineHeight: 18 },
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(14,17,22,0.08)', borderRadius: 20, shadowColor: '#0e1116', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 14, marginBottom: 12 },
  tRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 },
  tIn: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, fontSize: 17, color: C.ink },
  tNum: { width: 56, textAlign: 'center' },
  btnPrimary: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  btnPrimaryT: { color: '#fff', fontSize: 15, fontWeight: '800' },
  btnGhost: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  btnGhostT: { color: C.ink, fontSize: 15, fontWeight: '800' },
  msg: { fontSize: 15, fontWeight: '600', marginTop: 8 },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontSize: 13, fontWeight: '700', color: C.sub },
  verdict: { fontSize: 13, fontWeight: '600', lineHeight: 19, marginTop: 4 },
  moveNote: { fontSize: 13, color: C.sub, marginBottom: 12, paddingHorizontal: 4, lineHeight: 18 },
  muted: { fontSize: 15, color: C.sub },
  dayHead: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 9, borderTopWidth: 0.5, borderTopColor: C.line,
  },
  dayDate: { fontSize: 13, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  daySum: { flex: 1, fontSize: 13, color: C.sub, fontWeight: '700' },
  dayCaret: { fontSize: 15, color: C.sub, fontWeight: '800' },
  liftRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 7, paddingLeft: 10, borderTopWidth: 0.5, borderTopColor: C.line,
  },
  liftName: { flex: 1, fontSize: 15, color: C.ink, fontWeight: '600' },
  liftSet: { fontSize: 15, color: C.sub, fontWeight: '700', fontVariant: ['tabular-nums'] },
  liftX: { fontSize: 17, color: C.coral, fontWeight: '800', paddingHorizontal: 2 },
  editBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.accentBadge, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, marginTop: 6,
  },
  editBannerT: { fontSize: 13, fontWeight: '800', color: C.teal },
  editBannerCancel: { fontSize: 13, fontWeight: '800', color: C.sub, textDecorationLine: 'underline' },
  bwNoteMuted: { fontSize: 13, color: C.faint, fontWeight: '600', marginTop: 2, marginBottom: 2, paddingLeft: 2 },
  favRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 2 },
  bwNote: { fontSize: 13, color: C.teal, fontWeight: '700', marginTop: 2, marginBottom: 2, paddingLeft: 2 },
  moreBtn: { alignSelf: 'center', paddingVertical: 9, paddingHorizontal: 14, marginTop: 6 },
  moreBtnT: { fontSize: 13, color: C.teal, fontWeight: '800' },
  histHint: { fontSize: 13, color: C.faint, marginTop: 8 },
});
