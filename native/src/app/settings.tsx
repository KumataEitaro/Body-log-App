// マイページ: iOS設定アプリ風のグループ化メニューリスト
// フォーム・一覧のベタ貼りを廃止し、各機能はモーダル（pageSheet）で開く
// 構成: ヘッダーサマリー → アカウント設定 → データ・連携 → アクション（ログアウト/削除）
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, Alert, Modal, Platform, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { setWeeklyPhotoReminder, setDailyReminderPrefs, getDailyReminderPrefs, ensureNotifPermission, cancelMealGapReminder, cancelInsightNotification, getInsightNotifyEnabled, setInsightNotifyEnabled, type DailyReminderMode } from '@/lib/notify';
// 起床時刻（「朝に出るもの」の窓の起点・lib/wakeTime.ts）
import { WAKE_STEP_MIN, setWakeTime, useWakeTime, wakeOrDefault } from '@/lib/wakeTime';
import { usePurpose } from '@/lib/purpose';
import { deleteConfirmMatches } from '@/lib/guard';
import { SegmentedControl, OptionButton } from '@/components/ui/Selectable';
import { ACTIVE_KCAL_TO_GOAL_KEY } from '@/lib/activeKcal';
import { isCycleEnabled, setCycleEnabled } from '@/lib/cycle';
import { UserRound, Salad, HeartPulse, LogOut, Trash2, ChevronRight, CircleHelp, Target, BookOpen, Languages, Palette, Crown, Award, Smile, Ticket, Pencil, UtensilsCrossed, Ban, Users, UserPlus, MessageSquare } from 'lucide-react-native';
import { listMyMeals, deleteMyMeal, renameMyMeal, mealKcal, type MyMeal } from '@/lib/meals';
import CouponSheet from '@/components/CouponSheet';
import FeedbackSheet from '@/components/FeedbackSheet';
import ColumnReader from '@/components/ColumnReader';
import { exportAllCsv } from '@/lib/exportCsv';
import AddFoodSheet from '@/components/AddFoodSheet';
import { renameMyFood, deleteMyFood } from '@/lib/foods';
import { AVATAR_GROUPS, useAvatar, setAvatar } from '@/lib/avatar';
import NotificationCenter, { useTodoBadge, TodoBadge } from '@/components/NotificationCenter';
import { BellRing, FileText, Droplet, Bug } from 'lucide-react-native';
import { shareMedicalReport } from '@/lib/medicalReport';
import { t, apiLang, useLocale, setLocale, LOCALES, type LocaleCode } from '@/lib/i18n';
import { useUnits, setUnits, fmtWeight, fmtHeight } from '@/lib/units';
import { useTheme, setTheme, ACCENTS, PALETTES, PFC_SWATCHES, PFC_PRESETS, BG_TINTS, paletteFor, darkPaletteFor, type PfcColors } from '@/lib/theme';
import { SegmentedControl as Seg } from '@/components/ui/Selectable';
import { useGuide } from '@/components/GuideTour';
import GoalPanel from '@/components/GoalPanel';
import { supabase } from '@/lib/supabase';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { apiPost } from '@/lib/api';
import { C, rgba, sheetTopPad, RADIUS, SPACE, ICON, HEAD, themed } from '@/lib/ui';
import { useGate } from '@/lib/gate';
import CrownBadge from '@/components/CrownBadge';
import { DIET_RULES } from '@/content/dietRules';
import { fromRow as dietFromRow, saveDiet, EMPTY_DIET, type DietProfile } from '@/lib/diet';
import { DietDisclaimerPanel, DietConsentCheck, dietModeLabel, dietModeSub } from '@/components/DietNotes';

// Androidリップル（Material 3の作法）。テーマ色の微透明・行のborderRadius内にクリップ。
// iOSはandroid_rippleを無視するため分岐不要
const ripple = () => ({ color: rgba(C.teal, 0.14), borderless: false as const });
import { mifflinBMR } from '@/lib/calc';
import { healthAvailable, ensureHealthAuth, importWeights, openHealthSettings, getPreferManualWeight, setPreferManualWeight, loadPreferManualWeight } from '@/lib/health';
import { useHealthLinkState, useHealthLastSync } from '@/lib/healthStore';
import { formatLastSync } from '@/lib/healthLink';
import { unseenBadgeCount } from '@/lib/achievements';
import { shareInvite } from '@/lib/invite';
import StatusBarMask from '@/components/StatusBarMask';
import ActivityLevelPicker from '@/components/ActivityLevelPicker';
import * as Clipboard from 'expo-clipboard';
import { readBootErrors, clearBootErrors, formatBootErrors, type BootError } from '@/lib/boot';

// マイ食品（単品）の一覧行。items は複数食材をAIで合算した登録の内訳（migration-31・列が無いDBでは undefined）
type MyFoodLite = { id: string; name: string; kcal: number; items?: unknown; created_at?: string | null };
// 管理シートの統合一覧: 単品（my_foods）とセット（my_meals）を同じリストに並べる。count=品目数（単品はnull）
type FoodEntry = { kind: 'food' | 'set'; id: string; name: string; kcal: number; count: number | null; createdAt: string };
type Sheet = null | 'lang' | 'theme' | 'profile' | 'foods' | 'health' | 'delete' | 'goal' | 'columns' | 'diet' | 'boot';

// テーマ変更でルートのツリーが作り直されるとき、次のマウントで開き直すシート。
// モジュール変数なので再マウントをまたいで残り、読んだ直後に消す（通常の初回マウントでは null）
let reopenSheet: Sheet = null;

// テーマ設定のプレビュー。いま効いているパレット（C）だけで描くので、選択→再マウントのたびに新しい配色になる。
// ヒーロー（アクセントの塗り面＋白文字）・P/F/Cバー・意味色（達成/注意/超過）・リンク文字（accentInk）を
// 1枚に収め、「塗り面のアクセント」と「文字のアクセント（濃い側）」の差もここで見える
function ThemePreview({ pfc }: { pfc: PfcColors }) {
  return (
    <View style={pv.card}>
      <View style={pv.hero}>
        {/* グラデーションの明端（accentHi）を右上に重ね、#4D7CFF→#6AA3FF の流れを擬似的に出す */}
        <View style={pv.heroHi} />
        <Text style={pv.heroLabel}>{t('あと食べられる')}</Text>
        <Text style={pv.heroN} maxFontSizeMultiplier={1.3}>1,240<Text style={pv.heroU}> kcal</Text></Text>
      </View>
      <View style={pv.bars}>
        {([[t('たんぱく質'), pfc.p, '72%'], [t('脂質'), pfc.f, '48%'], [t('炭水化物'), pfc.c, '88%']] as const).map(([label, col, w]) => (
          <View key={label} style={pv.barRow}>
            <Text style={pv.barL} numberOfLines={1}>{label}</Text>
            <View style={pv.track}><View style={[pv.fill, { width: w, backgroundColor: col }]} /></View>
          </View>
        ))}
      </View>
      <View style={pv.foot}>
        <View style={pv.pill}><Text style={pv.pillT}>{t('達成')}</Text></View>
        <Text style={pv.warn}>{t('注意')}</Text>
        <Text style={pv.over}>{t('超過')}</Text>
        <View style={{ flex: 1 }} />
        <Text style={pv.link}>{t('くわしく見る')} →</Text>
      </View>
    </View>
  );
}
const pv = themed(() => ({
  card: {
    backgroundColor: C.panel, borderRadius: RADIUS.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
    shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
    padding: 12, marginTop: 4, gap: 12,
  },
  hero: { backgroundColor: C.teal, borderRadius: RADIUS.panel, padding: 14, overflow: 'hidden' },
  heroHi: { position: 'absolute', right: -30, top: -40, width: 140, height: 140, borderRadius: 70, backgroundColor: C.accentHi, opacity: 0.55 },
  heroLabel: { fontSize: 12, fontWeight: '800', color: '#fff', opacity: 0.9 },   // アクセント地の上の白文字（固定色。テーマに追従させない）
  heroN: { fontSize: 28, fontWeight: '800', color: '#fff', marginTop: 2, fontVariant: ['tabular-nums'] },  // 同上
  heroU: { fontSize: 14, fontWeight: '700' },
  bars: { gap: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barL: { width: 64, fontSize: 12, fontWeight: '700', color: C.sub },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.track, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pill: { backgroundColor: C.successWeak, borderRadius: RADIUS.chip, paddingHorizontal: 9, paddingVertical: 3 },
  pillT: { fontSize: 11.5, fontWeight: '800', color: C.successInk },
  warn: { fontSize: 12, fontWeight: '800', color: C.amber },
  over: { fontSize: 12, fontWeight: '800', color: C.coral },
  link: { fontSize: 12.5, fontWeight: '800', color: C.accentInk },
}));

// 記録のCSVエクスポート（データは本人のもの、を形にする）
function ExportRow() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Pressable style={bt.row} android_ripple={ripple()} disabled={busy} onPress={async () => {
      setBusy(true); setErr('');
      const r = await exportAllCsv();
      if (!r.ok) setErr(r.error);
      setBusy(false);
    }}>
      <Text style={bt.label}>{t('記録をエクスポート（CSV）')}</Text>
      {busy ? <ActivityIndicator color={C.teal} /> : <Text style={{ color: C.accentInk, fontWeight: '800' }}>↗</Text>}
      {err ? <Text style={{ position: 'absolute', bottom: -16, left: 14, fontSize: 11, color: C.coral }}>{err}</Text> : null}
    </Pressable>
  );
}

// 「今日のひとこと帯」のオン/オフ（設計上、消せることが安心につながる）
function BriefToggle() {
  const [off, setOff] = useState(false);
  useEffect(() => { AsyncStorage.getItem('bl-brief-off').then((v) => setOff(v === '1')).catch(() => {}); }, []);
  return (
    <Pressable style={bt.row} android_ripple={ripple()} onPress={() => {
      const next = !off;
      setOff(next);
      AsyncStorage.setItem('bl-brief-off', next ? '1' : '0').catch(() => {});
    }}>
      <Text style={bt.label}>{t('今日のひとこと帯を表示')}</Text>
      <View style={[bt.track, !off && bt.trackOn]}><View style={[bt.knob, !off && bt.knobOn]} /></View>
    </Pressable>
  );
}
const bt = themed(() => ({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.panel, borderRadius: RADIUS.tile, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
  },
  label: { fontSize: 15, fontWeight: '600', color: C.ink },
  track: { width: 44, height: 26, borderRadius: 13, backgroundColor: C.line, padding: 3 },
  trackOn: { backgroundColor: C.teal },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
}));

export default function SettingsScreen() {
  const router2 = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('170');
  const [age, setAge] = useState('30');
  const [life, setLife] = useState('1.3');
  // G3: 妊娠・授乳フラグ。ONの間は減量目標の設定不可＋AI相談が維持・栄養最優先で答える
  const [maternity, setMaternity] = useState(false);
  // 制約プロフィール: AIに毎回伝える恒常的な前提（アレルギー・宗教・苦手・予算など）。
  // 自由記述1カラム（profiles.constraints_note・migration-22）＝構造化しないことで入力障壁を下げる
  const [constraintsNote, setConstraintsNote] = useState('');
  // 食事の制約（B-18・migration-26）: 警告の判定基準。上のconstraints_noteとは役割が違う
  // （あちらはAIへの好み、こちらは警告の基準＝誤検知のコストが桁違いなので混ぜない）
  const [diet, setDiet] = useState<DietProfile>(EMPTY_DIET);
  // 同意チェックボックスの状態。未同意（consentAt==null）のあいだONにできない鍵になる
  const [dietAgree, setDietAgree] = useState(false);
  const [dietBusy, setDietBusy] = useState(false);
  const [dietMsg, setDietMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [foods, setFoods] = useState<MyFoodLite[]>([]);
  // マイ食品（セット）。migration-24未適用のDBでは常に空＝一覧に単品だけ並ぶ
  const [meals, setMeals] = useState<MyMeal[]>([]);
  // 名前変更中の行（行がその場でTextInputに変わる。単品・セットのどちらも同じUI）
  const [renameEdit, setRenameEdit] = useState<{ kind: 'food' | 'set'; id: string; name: string } | null>(null);
  // テーマ変更でツリーが作り直されたときだけ、直前まで開いていたシートを引き継ぐ（reopenSheet 参照）
  const [sheet, setSheet] = useState<Sheet>(() => { const v = reopenSheet; reopenSheet = null; return v; });
  const dietScrollRef = useRef<ScrollView>(null); // 食事の制約シート: 自由記述欄へフォーカス時に末尾へスクロール
  const reopened = useRef(sheet !== null);
  // ヘルスケア連携の状態表示（連携中・最終同期）と「体重は手入力を優先」トグル
  const healthLink = useHealthLinkState();
  const healthLastSync = useHealthLastSync();
  const lastSyncLabel = formatLastSync(healthLastSync);
  const [preferManualW, setPreferManualW] = useState(getPreferManualWeight());
  useEffect(() => { loadPreferManualWeight().then(setPreferManualW).catch(() => {}); }, []);
  function togglePreferManualW(on: boolean) { setPreferManualW(on); setPreferManualWeight(on).catch(() => {}); }
  const [couponOpen, setCouponOpen] = useState(false); // クーポンコード入力（プラン行の隣の入口）
  const [feedbackOpen, setFeedbackOpen] = useState(false); // ご意見・不具合の報告（サポート節の入口）
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [delConfirm, setDelConfirm] = useState('');
  // 受診用レポート（PDF）の作成中フラグと失敗理由（行のsubに出す）
  const [reportBusy, setReportBusy] = useState(false);
  const [reportErr, setReportErr] = useState('');
  const guide = useGuide();
  const gate = useGate();

  // 相談タブ等からのディープリンク（/settings?open=goal）で目的のシートを直接開く
  const { open, ts } = useLocalSearchParams<{ open?: string; ts?: string }>();
  const consumedOpen = useRef<string | null>(null);
  useEffect(() => {
    const stamp = `${open}-${ts ?? ''}`;  // tsを含めると同じシートへの2回目の遷移でも開く
    if (!open || consumedOpen.current === stamp) return;
    consumedOpen.current = stamp;
    // 'diet' は警告行の「詳しく」リンクからの遷移先（免責の全文が読める場所）
    // 'goalW' / 'goalT' は統合前の旧リンク。どちらも統合目標画面へ向ける（古い通知・相談履歴から来ても迷子にしない）
    if (open === 'goal' || open === 'goalW' || open === 'goalT') openSheet('goal');
    else if (open === 'profile' || open === 'theme' || open === 'diet') openSheet(open);
    // 概要タブの設定ブロック「通知センター」行から（旧・右上⚙のバッジの行き先）
    else if (open === 'notice') { todo.refresh(); setNoticeOpen(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ts]);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    setEmail(session?.user?.email ?? '');
    const [{ data: prof }, wRes, fRes, mealsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('entries').select('weight').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
      // '*' で読む: items 列（migration-31）が無いDBでも列名エラーにならず一覧が出る
      supabase.from('my_foods').select('*').order('created_at', { ascending: true }).limit(50),
      listMyMeals(),   // テーブル未作成なら空（セットが並ばないだけ）
    ]);
    if (wRes.data?.length) setLatestWeight(Number(wRes.data[0].weight));
    setFoods((fRes.data as MyFoodLite[]) || []);
    setMeals(mealsRes);
    if (prof) {
      setName(prof.display_name || '');
      if (prof.sex) setSex(prof.sex);
      if (prof.height_cm != null) setHeight(String(prof.height_cm));
      if (prof.age != null) setAge(String(prof.age));
      if (prof.life_factor != null) setLife(String(prof.life_factor));
      setMaternity(prof.maternity === true);   // 列が無い旧DBではundefined → false扱い
      setConstraintsNote(prof.constraints_note ?? '');  // 列が無い旧DBではundefined → 空欄
      // migration-26未適用のDBでは3列ともundefined → 未設定のまま（節は出るが常にオフ）
      const d = dietFromRow(prof as Record<string, unknown>);
      setDiet(d);
      setDietAgree(d.consentAt != null);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const locale = useLocale();
  const units = useUnits();
  const theme = useTheme();
  const todo = useTodoBadge();
  // 未読バッジ数（実績行の赤ドット）。実績ページを開くと消えるので、戻るたびに読み直す
  const [unseenBadges, setUnseenBadges] = useState(0);
  useFocusEffect(useCallback(() => {
    let alive = true;
    unseenBadgeCount().then((n) => { if (alive) setUnseenBadges(n); }).catch(() => {});
    return () => { alive = false; };
  }, []));
  // 起動時のエラー記録（lib/boot.ts）。Androidの起動クラッシュはスタックトレースが
  // 手に入らないことがあるため、「どの初期化がコケたか」を本人の画面から読めるようにする。
  // 開くたびに読み直す（前回の起動ぶんが残っている）
  const [bootErrors, setBootErrors] = useState<BootError[]>([]);
  const [bootCopied, setBootCopied] = useState(false);
  const reloadBootErrors = useCallback(() => {
    readBootErrors().then(setBootErrors).catch(() => {});
  }, []);
  useEffect(() => { reloadBootErrors(); }, [reloadBootErrors]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [foodFormOpen, setFoodFormOpen] = useState(false);
  const avatar = useAvatar();
  const [avatarOpen, setAvatarOpen] = useState(false);

  function openSheet(v: Sheet) { setMsg(null); setDelConfirm(''); setSheet(v); }
  // テーマの変更は applyPalette → 世代更新 → ルートの Stack 再マウントを伴う。
  // この画面も作り直されるので、開いているテーマシートを次のマウントへ引き継いでから適用する
  function changeTheme(patch: Parameters<typeof setTheme>[0]) { reopenSheet = 'theme'; void setTheme(patch); }

  // 記録の週目標・歩数の週目標は統合目標画面（GoalPanel hub → HabitGoals）へ移設した

  // アクティブカロリーを目標に反映するか（既定OFF）。
  // 表示（運動タブの実測kcal）は常に出すが、目標=「あと食べられる量」を増やすかは本人の判断。
  // ONにすると歩いた分だけ食べられる量が増えるため、痩せにくくなる人が必ず出る＝黙って有効にしない
  const [activeToGoal, setActiveToGoal] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(ACTIVE_KCAL_TO_GOAL_KEY).then((v) => setActiveToGoal(v === '1')).catch(() => {});
  }, []);
  function toggleActiveToGoal(v: boolean) {
    setActiveToGoal(v);
    if (v) AsyncStorage.setItem(ACTIVE_KCAL_TO_GOAL_KEY, '1').catch(() => {});
    else AsyncStorage.removeItem(ACTIVE_KCAL_TO_GOAL_KEY).catch(() => {});
  }

  // 生理周期モード（既定OFF）。ONにした人にだけ概要「からだ」に記録カードが現れ、
  // 体重グラフに月経期間の帯が重なる。**記録しない人の画面には一切現れない**
  // （最も機微なデータなので、既定で見せない・OFFの間は問い合わせもしない）。
  // OFFに戻しても記録は消えない（消したい人はカード内の各行から自分で消せる）
  const [cycleOn, setCycleOn] = useState(false);
  useEffect(() => { isCycleEnabled().then(setCycleOn).catch(() => {}); }, []);
  function toggleCycle(v: boolean) {
    setCycleOn(v);
    setCycleEnabled(v).catch(() => {});
  }

  // 通知（設定はAsyncStorageに永続化。OFF→ONで権限リクエスト）
  const [remMode, setRemMode] = useState<DailyReminderMode>('off');
  const [remHour, setRemHour] = useState(21);
  const [notifWeekly, setNotifWeekly] = useState(false);
  const [notifGap, setNotifGap] = useState(false);
  // 気づきの通知（§8）: 既定ON。記録リマインダーが smart のときだけ実際に届く（それ以外はトグルを薄く見せる）
  const [notifInsight, setNotifInsight] = useState(true);
  const purpose = usePurpose(); // 食間リマインド行はbulk（増量）の人にだけ見せる
  useEffect(() => {
    getDailyReminderPrefs().then((p) => { setRemMode(p.mode); setRemHour(p.hour); }).catch(() => {});
    AsyncStorage.getItem('bl-notif-weekly').then((v) => setNotifWeekly(v === '1')).catch(() => {});
    AsyncStorage.getItem('bl-notif-gap').then((v) => setNotifGap(v === '1')).catch(() => {});
    getInsightNotifyEnabled().then(setNotifInsight).catch(() => {});
  }, []);
  function toggleInsight(on: boolean) {
    setNotifInsight(on);
    setInsightNotifyEnabled(on).catch(() => {});
  }

  // ===== 起床時刻（2026-09-04）=====
  // 「朝に出るもの」の窓の起点。端末内だけに持つ（DBにもAIにも送らない＝本人の生活リズムの情報）。
  // 記録の日付（1日の区切り）はこれでは動かない。動かすのは「出す/出さないの時間の窓」と、
  // 気づきの朝の通知の時刻・記録リマインダーの**未選択時の既定値**だけ
  const wake = useWakeTime();
  const [wakePickerOpen, setWakePickerOpen] = useState(false);
  const [wakeDraft, setWakeDraft] = useState<Date>(new Date());
  function openWakePicker() {
    const hm = wakeOrDefault(wake);
    const d = new Date();
    d.setHours(hm.h, hm.m, 0, 0);
    setWakeDraft(d);
    setWakePickerOpen(true);
  }
  function commitWake(d: Date) {
    setWakeTime({ h: d.getHours(), m: d.getMinutes() });
    // 予約済みの「気づきの朝の通知」は旧い起床時刻で組まれているので取り消す。
    // 次に食事タブを開いたときに新しい時刻で組み直される（1日1件の枠も一緒に戻す）
    cancelInsightNotification().catch(() => {});
    AsyncStorage.removeItem('bl-insight-alert-notified').catch(() => {});
  }
  async function changeReminder(mode: DailyReminderMode, hour: number) {
    setRemMode(mode); setRemHour(hour);
    const ok = await setDailyReminderPrefs(mode, hour);
    if (!ok && mode !== 'off') {
      setRemMode('off');
      Alert.alert(t('通知を許可してください'), t('iOSの設定 > BodyLog > 通知 から許可できます（Expo Goでは動作しません）。'));
    }
  }
  async function toggleWeekly(on: boolean) {
    setNotifWeekly(on);
    const ok = await setWeeklyPhotoReminder(on);
    if (!ok && on) { setNotifWeekly(false); Alert.alert(t('通知を許可してください'), t('iOSの設定 > BodyLog > 通知 から許可できます（Expo Goでは動作しません）。')); return; }
    AsyncStorage.setItem('bl-notif-weekly', on ? '1' : '0').catch(() => {});
  }
  // 食間リマインド（増量向け）: 予約自体は食事保存のたびにlib/syncが行う。
  // ここでは設定の永続化と、ONにする瞬間の権限確認だけを担う
  async function toggleGap(on: boolean) {
    setNotifGap(on);
    if (on && !(await ensureNotifPermission())) {
      setNotifGap(false);
      Alert.alert(t('通知を許可してください'), t('iOSの設定 > BodyLog > 通知 から許可できます（Expo Goでは動作しません）。'));
      return;
    }
    AsyncStorage.setItem('bl-notif-gap', on ? '1' : '0').catch(() => {});
    if (!on) cancelMealGapReminder().catch(() => {}); // OFFにしたら予約済みぶんも消す
  }

  async function saveProfile() {
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const base = {
        display_name: name.trim(), sex,
        height_cm: Number(height) || 170, age: Number(age) || 30,
        life_factor: Number(life) || 1.3,
      };
      // maternity/constraints_note列が無い旧DBでは列を減らして再実行し、プロフィール保存自体は成立させる
      let { error } = await supabase.from('profiles')
        .update({ ...base, maternity, constraints_note: constraintsNote.trim() || null }).eq('id', uid);
      if (error && /constraints_note|maternity|column|schema/i.test(error.message)) {
        // migration-22未適用: constraints_noteを外して再実行
        ({ error } = await supabase.from('profiles').update({ ...base, maternity }).eq('id', uid));
      }
      if (error && /maternity|column|schema/i.test(error.message)) {
        // migration-21も未適用: 基本項目だけで再実行
        ({ error } = await supabase.from('profiles').update(base).eq('id', uid));
      }
      setMsg(error ? { ok: false, text: t('保存に失敗しました。もう一度お試しください。') } : { ok: true, text: t('保存しました。') });
    } finally { setBusy(false); }
  }

  // ===== 食事の制約（B-18・docs/DIET-MODES.md §3 / §4 / §6） =====
  // AI判定・自由記述・メニュー判定だけが有料。端末内の辞書判定（黒）は無料でも動くので、
  // 無料ユーザーもプリセットをONにできる（安全に関わる最低限を有料の壁の裏に置かない）
  const dietGated = gate.gated('diet');

  /** 同意ゲート: 未同意のあいだはONにできない。断るときは必ず理由を言う */
  function requireDietConsent(): boolean {
    if (diet.consentAt != null || dietAgree) return true;
    setDietMsg({ ok: false, text: t('上の内容を読んで、同意のチェックを入れてからONにしてください。') });
    return false;
  }

  function toggleDietMode(key: string) {
    if (!requireDietConsent()) return;
    setDietMsg(null);
    setDiet((p) => ({
      ...p,
      modes: p.modes.includes(key) ? p.modes.filter((k) => k !== key) : [...p.modes, key],
    }));
  }

  async function saveDietSettings() {
    if (!requireDietConsent()) return;
    setDietBusy(true); setDietMsg(null);
    try {
      // 同意日時は初回だけ刻む（後日「いつ何に同意したか」を再現できるように・§6-7）
      const next: DietProfile = { ...diet, consentAt: diet.consentAt ?? new Date().toISOString() };
      const r = await saveDiet(next);
      if (r.ok) {
        setDiet(next);
        setDietMsg({ ok: true, text: t('保存しました。') });
      } else if (r.reason === 'no_column') {
        setDietMsg({ ok: false, text: t('この機能はまだ使えません（データベースの更新待ちです）。') });
      } else {
        setDietMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') });
      }
    } finally { setDietBusy(false); }
  }

  async function healthImportWeights() {
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      // 連携済みならダイアログは出ない。未連携ならここが初回連携になる（以後は自動同期）
      if (!(await ensureHealthAuth())) { setMsg({ ok: false, text: t('ヘルスケアへのアクセスが許可されませんでした。') }); return; }
      const res = await importWeights(uid, 90);
      if ('error' in res) { setMsg({ ok: false, text: res.error }); return; }
      setMsg({ ok: true, text: res.imported > 0 ? t('体重を {n} 日分 取り込みました。「概要」タブのグラフに反映されます。', { n: res.imported }) : t('新しく取り込める体重データはありませんでした。') });
    } finally { setBusy(false); }
  }

  // マイ食品の削除（単品・セット共通。設定側はUndoバーが無いので確認ダイアログ）
  function removeEntry(e: FoodEntry) {
    Alert.alert(t('「{name}」を削除しますか？', { name: e.name }), t('入力画面のチップから消えます（過去の記録は変わりません）。'), [
      { text: t('キャンセル'), style: 'cancel' },
      {
        text: t('削除する'), style: 'destructive',
        onPress: async () => {
          if (e.kind === 'food') {
            if (await deleteMyFood(e.id)) setFoods((prev) => prev.filter((f) => f.id !== e.id));
          } else {
            if (await deleteMyMeal(e.id)) setMeals((prev) => prev.filter((x) => x.id !== e.id));
          }
        },
      },
    ]);
  }

  // 名前変更を確定（単品は my_foods・セットは my_meals。同名があると unique 制約で失敗＝元の名前のまま）
  async function saveRename() {
    if (!renameEdit) return;
    const nm = renameEdit.name.trim();
    if (!nm) { setRenameEdit(null); return; }
    const ok = renameEdit.kind === 'food' ? await renameMyFood(renameEdit.id, nm) : await renameMyMeal(renameEdit.id, nm);
    if (ok) {
      if (renameEdit.kind === 'food') setFoods((prev) => prev.map((x) => (x.id === renameEdit.id ? { ...x, name: nm } : x)));
      else setMeals((prev) => prev.map((x) => (x.id === renameEdit.id ? { ...x, name: nm } : x)));
    } else {
      setMsg({ ok: false, text: t('名前を変更できませんでした。同じ名前の登録がないか確認してください。') });
    }
    setRenameEdit(null);
  }

  // 統合一覧: 単品とセットを登録順に1つのリストへ（セットは品目数バッジで区別）
  const foodEntries: FoodEntry[] = [
    ...foods.map((f): FoodEntry => ({
      kind: 'food', id: f.id, name: f.name, kcal: Math.round(Number(f.kcal)),
      count: Array.isArray(f.items) && f.items.length > 1 ? f.items.length : null,   // AI合算の登録は内訳の品目数
      createdAt: f.created_at ?? '',
    })),
    ...meals.map((m): FoodEntry => ({
      kind: 'set', id: m.id, name: m.name, kcal: mealKcal(m.items), count: m.items.length, createdAt: m.createdAt ?? '',
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  function confirmDelete() {
    if (!deleteConfirmMatches(delConfirm)) return;
    Alert.alert(
      t('アカウントを完全に削除しますか？'),
      t('記録・写真・目標・マイ食品のすべてが削除されます。この操作は取り消せません。'),
      [
        { text: t('キャンセル'), style: 'cancel' },
        { text: t('完全に削除する'), style: 'destructive', onPress: deleteAccount },
      ],
    );
  }

  async function deleteAccount() {
    setBusy(true); setMsg(null);
    try {
      const { ok, json } = await apiPost<{ ok: boolean; error?: string }>('/api/account/delete', {});
      if (!ok || !json?.ok) { setMsg({ ok: false, text: json?.error || t('削除に失敗しました。もう一度お試しください。') }); return; }
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    } finally { setBusy(false); }
  }

  const bmr = mifflinBMR(sex, latestWeight ?? 70, Number(height) || 0, Number(age) || 0);

  // 1行メニュー（アイコン＋ラベル＋chevron）
  function Row({ icon, label, sub, onPress, danger, badge }: { icon: React.ReactNode; label: string; sub?: string; onPress: () => void; danger?: boolean; badge?: number }) {
    return (
      <Pressable style={({ pressed }) => [s.row, pressed && { backgroundColor: C.pressed }]}
                 android_ripple={ripple()} onPress={onPress}>
        <View style={s.rowIcon}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={[s.rowLabel, danger && { color: C.coral }]}>{label}</Text>
          {sub != null && <Text style={s.rowSub}>{sub}</Text>}
        </View>
        <TodoBadge count={badge ?? 0} style={{ marginRight: 6 }} />
        <ChevronRight color={C.faint} size={ICON.lg} />
      </Pressable>
    );
  }

  // モーダル共通ヘッダー
  function SheetHeader({ title, icon }: { title: string; icon?: React.ReactNode }) {
    return (
      <View style={s.sheetHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          {icon}
          <Text style={s.sheetTitle}>{title}</Text>
        </View>
        <Pressable onPress={() => setSheet(null)} hitSlop={8}><Text style={s.sheetClose}>{t('閉じる')}</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    {/* タブ外のスタック画面になったため、戻る導線はネイティブヘッダーで出す（タイトルは本文側のまま） */}
    <Stack.Screen options={{
      headerShown: true, title: '', headerBackTitle: t('戻る'),
      headerTintColor: C.teal, headerShadowVisible: false, headerStyle: { backgroundColor: C.bg },
      // 大型タイトル領域もテーマに合わせる。ここが未指定だとダークで
      // 「戻る」の下に白い帯が残る（βフィードバック 2026-09-01）
      headerLargeStyle: { backgroundColor: C.bg },
      headerLargeTitleStyle: { color: C.ink },
    }} />
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1 }} contentContainerStyle={s.scroll}>
      <Text style={s.h}>{t('マイページ')}</Text>

      {/* ヘッダーサマリーカード */}
      <View style={s.summary}>
        <Pressable style={({ pressed }) => [s.avatar, pressed && { opacity: 0.7 }]}
                   onPress={() => setAvatarOpen(true)} hitSlop={6}>
          <Text style={{ fontSize: 26 }}>{avatar}</Text>
          <View style={s.avatarEdit}><Text style={s.avatarEditT}>✎</Text></View>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.sumName}>{name || t('ニックネーム未設定')}</Text>
          <Text style={s.sumMail}>{email || '—'}</Text>
          <Text style={s.sumMeta}>
            {fmtHeight(Number(height))}{latestWeight != null ? ` ・ ${fmtWeight(latestWeight)}` : ''} ・ {t('基礎代謝 約')}{Math.round(bmr)}kcal
          </Text>
        </View>
      </View>

      {/* 通知センター（メニュー最上部） */}
      <View style={[s.group, { marginBottom: 18 }]}>
        <Pressable style={({ pressed }) => [s.row, pressed && { backgroundColor: C.pressed }]}
                   android_ripple={ripple()} onPress={() => { todo.refresh(); setNoticeOpen(true); }}>
          <View style={s.rowIcon}><BellRing color={C.teal} size={ICON.xl} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>{t('通知センター')}</Text>
            <Text style={s.rowSub}>
              {todo.count > 0 ? t('入力すべき項目が{n}件あります', { n: todo.count }) : t('いま対応が必要な項目はありません')}
            </Text>
          </View>
          <TodoBadge count={todo.count} style={{ marginRight: 6 }} />
          <ChevronRight color={C.faint} size={ICON.lg} />
        </Pressable>
      </View>

      {/* アカウント設定 */}
      <Text style={s.groupLabel}>{t('アカウント設定')}</Text>
      <View style={s.group}>
        <Row icon={<Crown color={C.teal} size={ICON.xl} />} label={t('プラン')} sub={t('プランの確認・変更・購入の復元')} onPress={() => router2.push('/paywall' as never)} />
        <View style={s.sep} />
        {/* クーポン: プラン行の隣に置く（コード配布キャンペーンの入口。適用はサーバー直付与） */}
        <Row icon={<Ticket color={C.teal} size={ICON.xl} />} label={t('クーポンコード')} sub={t('コードを入力して機能を解放')} onPress={() => setCouponOpen(true)} />
        <View style={s.sep} />
        <Row icon={<Award color={C.teal} size={ICON.xl} />} label={t('実績')} sub={t('ストリーク・バッジ・ストーリー共有')} badge={unseenBadges} onPress={() => router2.push('/achievements' as never)} />
        <View style={s.sep} />
        <Row icon={<UserRound color={C.teal} size={ICON.xl} />} label={t('プロフィール編集')} sub={t('表示名・性別・身長・年齢・活動量')} onPress={() => openSheet('profile')} />
        <View style={s.sep} />
        <Row icon={<Salad color={C.teal} size={ICON.xl} />} label={t('マイ食品の管理')} sub={t('{n}件 登録済み', { n: foods.length + meals.length })} onPress={() => openSheet('foods')} />
      </View>

      {/* からだの記録。既定OFFの、本人が選んだときだけ現れる記録 */}
      <Text style={s.groupLabel}>{t('からだの記録')}</Text>
      <View style={s.group}>
        <View style={s.notifRow}>
          <View style={s.cycleRowText}>
            <View style={s.cycleLabelRow}>
              <Droplet color={C.teal} size={ICON.xl} />
              <Text style={s.notifLabel}>{t('生理周期を記録する')}</Text>
            </View>
            <Text style={s.notifSub}>{t('体重の増減が周期と重なっているかを見られます。記録しない人には表示されません')}</Text>
          </View>
          <Switch value={cycleOn} onValueChange={toggleCycle} trackColor={{ true: C.teal }} />
        </View>
        <Text style={s.notifNote}>{t('記録するのは開始日とメモだけです。あなたにだけ見え、次がいつ来るかの予測はしません（診断や避妊・妊活の判断には使えません）。')}</Text>
      </View>

      {/* 食事の制約（B-18）。オンボーディングには入れない（同意を流し読みさせたくないため） */}
      <Text style={s.groupLabel}>{t('食事の制約')}</Text>
      <View style={s.group}>
        <Row icon={<Ban color={C.teal} size={ICON.xl} />} label={t('食べないものを登録する')}
             sub={diet.modes.length > 0 || diet.custom.trim()
               ? t('{n}件を設定中。解析結果に該当の可能性を表示します', { n: diet.modes.length + (diet.custom.trim() ? 1 : 0) })
               : t('ビーガン・グルテンフリーなど。該当の可能性を警告します（推定）')}
             onPress={() => openSheet('diet')} />
      </View>

      {/* 目標: 体重・赤字・運動・習慣・食べられる量・PFCを1つの画面に統合（旧4行を1行へ） */}
      <Text style={s.groupLabel}>{t('目標')}</Text>
      <View style={s.group}>
        <Row icon={<Target color={C.teal} size={ICON.xl} />} label={t('目標')}
             sub={t('体重・必要な赤字・1日に食べられる量・運動・記録と歩数の週目標・PFC')} onPress={() => openSheet('goal')} />
      </View>

      {/* 見た目（テーマカラー・PFCの色） */}
      <Text style={s.groupLabel}>{t('見た目')}</Text>
      <View style={s.group}>
        <Row icon={<Palette color={C.teal} size={ICON.xl} />} label={t('テーマカラー')}
             sub={t(ACCENTS.find((a) => a.key === theme.accent)?.label ?? '')}
             onPress={() => openSheet('theme')} />
      </View>

      {/* 表示（言語・単位） */}
      <Text style={s.groupLabel}>{t('言語')} ・ {t('単位')}</Text>
      <View style={s.group}>
        <Row icon={<Languages color={C.teal} size={ICON.xl} />} label={t('言語')}
             sub={LOCALES.find((l) => l.code === locale)?.label ?? 'Japanese'}
             onPress={() => openSheet('lang')} />
        <View style={s.sep} />
        <View style={s.unitRow}>
          <Text style={s.unitLabel}>{t('体重の単位')}</Text>
          <View style={{ width: 150 }}>
            <Seg options={[{ key: 'kg', label: 'kg' }, { key: 'lb', label: 'lb' }]}
                 value={units.weight} onChange={(v) => setUnits({ weight: v })} />
          </View>
        </View>
        <View style={s.unitRow}>
          <Text style={s.unitLabel}>{t('身長の単位')}</Text>
          <View style={{ width: 150 }}>
            <Seg options={[{ key: 'cm', label: 'cm' }, { key: 'ft', label: 'ft / in' }]}
                 value={units.height} onChange={(v) => setUnits({ height: v })} />
          </View>
        </View>
        <View style={s.unitRow}>
          <Text style={s.unitLabel}>{t('距離の単位')}</Text>
          <View style={{ width: 150 }}>
            <Seg options={[{ key: 'km', label: 'km' }, { key: 'mi', label: 'mi' }]}
                 value={units.distance} onChange={(v) => setUnits({ distance: v })} />
          </View>
        </View>
      </View>

      {/* 通知 */}
      <Text style={s.groupLabel}>{t('通知')}</Text>
      <View style={s.group}>
        {/* 起床時刻（2026-09-04・グループ先頭）: 「朝に出るもの」の時間の窓を本人に決めてもらう。
            生活リズムは人によって違うので、固定時刻（旧: 朝の通知8:00・予定ヒアリング〜11時）では
            早起きの人にも夜勤の人にも合わない。深夜に翌日ぶんの気分・過食アラートが出る問題の直し方でもある。
            **記録の日付（1日の区切り）は動かさない**（docs/TODO.md B9） */}
        <View style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.notifLabel}>{t('起床時刻')}</Text>
            </View>
            <Pressable style={s.wakeChip} onPress={openWakePicker} accessibilityRole="button">
              <Text style={s.wakeChipT}>{wake}</Text>
            </Pressable>
          </View>
          <Text style={[s.notifSub, { marginTop: 6 }]}>
            {t('朝に出るもの（気分・今日の予定・気づき）は、この時刻より前には出しません。生活リズムに合わせて変えてください。')}
          </Text>
        </View>
        <View style={s.sep} />
        <View style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
          <Text style={s.notifLabel}>{t('記録リマインダー')}</Text>
          <Text style={[s.notifSub, { marginBottom: 10 }]}>
            {remMode === 'smart' ? t('その日なにか記録していれば通知しません。2週間ひらかないと自動で止まります。')
              : remMode === 'always' ? t('記録の有無にかかわらず、毎日決まった時刻に通知します。')
              : t('記録リマインダーは届きません。')}
          </Text>
          <SegmentedControl
            options={[
              { key: 'off', label: t('オフ') },
              { key: 'smart', label: t('記録がない日だけ') },
              { key: 'always', label: t('毎日') },
            ]}
            value={remMode} onChange={(m) => changeReminder(m as DailyReminderMode, remHour)}
          />
          {remMode !== 'off' && (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {[18, 19, 20, 21, 22, 23].map((h) => (
                <Pressable key={h} onPress={() => changeReminder(remMode, h)}
                           style={[s.hourChip, remHour === h && s.hourChipOn]}>
                  <Text style={[s.hourChipT, remHour === h && s.hourChipTOn]}>{h}:00</Text>
                </Pressable>
              ))}
            </View>
          )}
          {remMode !== 'off' && (
            <Text style={[s.notifSub, { marginTop: 8 }]}>{t('通知をタップするとそのまま入力できます。「今日は聞かないで」を押した日も静かになります。')}</Text>
          )}
        </View>
        {/* 気づきの通知（§8）: あなたの法則の条件がそろった朝に1件だけ。smart 以外のモードでは届かないので薄く見せる */}
        <View style={s.sep} />
        <View style={[s.notifRow, remMode !== 'smart' && { opacity: 0.5 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.notifLabel}>{t('気づきの通知')}</Text>
            <Text style={s.notifSub}>
              {remMode === 'smart'
                ? t('あなたの法則から「食べすぎが起きやすい条件」がそろった朝に、1件だけお知らせします。')
                : t('記録リマインダーが「記録がない日だけ」のときに届きます。')}
            </Text>
          </View>
          <Switch value={notifInsight} onValueChange={toggleInsight} trackColor={{ true: C.teal }} />
        </View>
        {/* 食間リマインドは増量（bulk）の人にだけ意味がある行なので、それ以外には見せない */}
        {purpose === 'bulk' && (
          <>
            <View style={s.sep} />
            <View style={s.notifRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.notifLabel}>{t('食間リマインド（増量向け）')}</Text>
                <Text style={s.notifSub}>{t('最後の食事から5時間あくとお知らせ（21:30〜翌7:00は通知しません）')}</Text>
              </View>
              <Switch value={notifGap} onValueChange={toggleGap} trackColor={{ true: C.teal }} />
            </View>
          </>
        )}
        <View style={s.sep} />
        <View style={s.notifRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.notifLabel}>{t('週1回の体写真')}</Text>
            <Text style={s.notifSub}>{t('日曜19:00に撮影リマインド')}</Text>
          </View>
          <Switch value={notifWeekly} onValueChange={toggleWeekly} trackColor={{ true: C.teal }} />
        </View>
        <Text style={s.notifNote}>{t('チートデイの前日20:00にも自動でお知らせします（登録時に設定・通知許可が必要）。Expo Goでは動作せず、TestFlight版で有効です。')}</Text>
      </View>

      {/* データ・連携 */}
      <Text style={s.groupLabel}>{t('データ・連携')}</Text>
      <View style={s.group}>
        {/* ヘルスケア行はiOSだけ（AndroidにHealthKitは無い。「ヘルスケア」の文言自体を出さない）。
            連携済みは状態表示（連携中・最終同期）。ボタンではなく状態＋見直し導線 */}
        {Platform.OS === 'ios' && (
          <>
            <Row icon={<HeartPulse color={C.teal} size={ICON.xl} />} label={t('ヘルスケア連携')}
                 sub={healthLink === 'linked'
                   ? (lastSyncLabel ? t('連携中・最終同期 {t}', { t: lastSyncLabel }) : t('連携中・全項目を自動で取り込みます'))
                   : healthLink === 'unlinked' ? t('体重・歩数・睡眠・消費kcalを自動で取り込む') : t('TestFlight版で有効になります')}
                 onPress={() => openSheet('health')} />
            <View style={s.sep} />
          </>
        )}
        {/* アクティブカロリーの目標反映（既定OFF）。
            表示（運動タブの実測kcal）は連携すれば常に出るが、目標を増やすかは別問題。
            トレードオフを隠さずサブ文言で正直に伝え、本人に選ばせる */}
        <View style={s.notifRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.notifLabel}>{t('アクティブカロリーを目標に反映する')}</Text>
            <Text style={s.notifSub}>{t('ONにすると、歩いた分だけ「あと食べられる量」が増えます。ヘルスケアの実測は日常の動きも含むため、増えやすくなります（体重が減りにくいと感じたらOFFに）')}</Text>
          </View>
          <Switch value={activeToGoal} onValueChange={toggleActiveToGoal} trackColor={{ true: C.teal }} />
        </View>
        <Text style={s.notifNote}>{t('反映するのは「いつもより多く動いたぶん」だけです（日常の動きは目標の生活係数に既に入っているため、二重に足しません）。')}</Text>
        <View style={s.sep} />
        {/* 受診用レポート（1500人監査Later群・中高年層の本丸）。
            診察室で見せるのはアプリ画面ではなくPDF。作成中は行が待ち状態になる */}
        <Row icon={reportBusy ? <ActivityIndicator color={C.teal} /> : <FileText color={C.teal} size={ICON.xl} />}
             label={t('受診用のレポートを作る（PDF）')}
             sub={reportErr || t('直近30日の体重・食事・血圧などを1枚にまとめて共有します')}
             onPress={async () => {
               if (reportBusy) return;
               setReportBusy(true); setReportErr('');
               const r = await shareMedicalReport();
               if (!r.ok) setReportErr(r.error);
               setReportBusy(false);
             }} />
      </View>

      {/* サポート */}
      <Text style={s.groupLabel}>{t('サポート')}</Text>
      <View style={s.group}>
        <Row icon={<CircleHelp color={C.teal} size={ICON.xl} />} label={t('使い方ガイド')}
             sub={t('5つの章に分かれています。見たい章だけどうぞ')}
             onPress={() => guide.start('menu')} />
        <View style={s.sep} />
        <Row icon={<BookOpen color={C.teal} size={ICON.xl} />} label={t('読みもの')}
             sub={t('PFCバランス・カロリー収支・過食の心理などのコラム')}
             onPress={() => openSheet('columns')} />
        <View style={s.sep} />
        {/* ご意見・不具合の報告。βで「不満を言う口がアプリに無い」状態を解消する入口。
            ここで受け止められなかった声は、そのままApp Storeの★1になる */}
        <Row icon={<MessageSquare color={C.teal} size={ICON.xl} />} label={t('ご意見・不具合の報告')}
             sub={t('不具合・要望を開発者に直接送れます（個別の返信はできません）')}
             onPress={() => setFeedbackOpen(true)} />
        <View style={s.sep} />
        {/* 友だちを誘う（feat/invite）。共有シートに紹介文＋招待リンクを渡す。
            リンク先は未ログインでも見える紹介ページ（/invite）で、名前は表示だけに使う */}
        <Row icon={<UserPlus color={C.teal} size={ICON.xl} />} label={t('友だちを誘う')}
             sub={t('紹介ページのリンクを共有します（Androidは準備中）')}
             onPress={() => { shareInvite(name).catch(() => {}); }} />
      </View>

      {/* アカウント */}
      <Text style={s.groupLabel}>{t('アカウント')}</Text>
      <View style={s.group}>
        <Row icon={<Users color={C.teal} size={ICON.xl} />} label={t('アカウントを切り替える')}
             sub={t('いまのアカウントからサインアウトして、ログイン画面に戻ります')}
             onPress={() => Alert.alert(
               t('アカウントを切り替える'),
               t('いまのアカウントからサインアウトします。記録は消えません。次の画面で、端末に保存済みのアカウントを選べます。'),
               [
                 { text: t('キャンセル'), style: 'cancel' },
                 // localスコープ: この端末のセッションだけ破棄する（他端末は残す）
                 { text: t('切り替える'), onPress: () => { supabase.auth.signOut({ scope: 'local' }).catch(() => {}); } },
               ],
             )} />
      </View>

      {/* アクション */}
      <View style={{ height: 16 }} />
      <Pressable style={s.logoutBtn} onPress={() => supabase.auth.signOut()}>
        <LogOut color={C.sub} size={ICON.md} />
        <Text style={s.logoutT}>{t('ログアウト')}</Text>
      </Pressable>
      <Pressable style={s.deleteLink} onPress={() => openSheet('delete')} hitSlop={6}>
        <Text style={s.deleteLinkT}>{t('アカウントを削除する')}</Text>
      </Pressable>

      {/* 開発者向け（最下部・目立たせない）: 起動時に失敗した初期化処理の記録。
          Androidの起動クラッシュはPlayのリリース前レポートが出ない経路だとスタックトレースが
          手に入らない。「どの初期化がコケたか」が端末に残っていれば、次に落ちても本人の画面から
          原因が読めてコピーして送れる（docs/ANDROID.md「起動クラッシュの調査手順」）。
          記録が0件のときも行は残す＝「見る場所がある」ことを覚えてもらうため */}
      <Pressable style={s.bootLink} onPress={() => { reloadBootErrors(); setBootCopied(false); openSheet('boot'); }} hitSlop={6}>
        <Text style={s.bootLinkT}>
          {bootErrors.length > 0
            ? t('起動時のエラー記録（{n}件）', { n: bootErrors.length })
            : t('起動時のエラー記録')}
        </Text>
      </Pressable>
    </ScrollView>

    {/* ===== プロフィール編集モーダル ===== */}
    <Modal visible={sheet === 'profile'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>{/* KAVはpageSheet内で誤計算するためScrollView側のインセット自動調整に統一（2026-09-03） */}
        <SheetHeader icon={<UserRound size={ICON.lg} color={C.teal} />} title={t("プロフィール編集")} />
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 24 }}>
          <Text style={s.label}>{t('表示名')}</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder={t('表示名')} placeholderTextColor={C.faint} />
          <Text style={s.label}>{t('性別')}</Text>
          <SegmentedControl
            options={[{ key: 'male', label: t('男性') }, { key: 'female', label: t('女性') }]}
            value={sex} onChange={setSex}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{t('身長(cm)')}</Text>
              <TextInput style={s.input} keyboardType="number-pad" value={height} onChangeText={setHeight} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{t('年齢')}</Text>
              <TextInput style={s.input} keyboardType="number-pad" value={age} onChangeText={setAge} />
            </View>
          </View>
          <Text style={s.label}>{t('日常の活動量')}<Text style={{ fontWeight: '400' }}>{t('— 消費カロリーの計算に使います')}</Text></Text>
          <ActivityLevelPicker value={Number(life) || 1.375} onChange={(v) => setLife(String(v))} />
          {/* G3: 妊娠・授乳フラグ。減量を促さないための安全ガード（収益より本人の安全を優先） */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, { marginTop: 0, marginBottom: 2 }]}>{t('妊娠中・授乳中')}</Text>
              <Text style={s.note}>{t('ONの間は減量目標を設定できなくなり、AI相談も維持と栄養を最優先に答えます。')}</Text>
            </View>
            <Switch value={maternity} onValueChange={setMaternity} trackColor={{ true: C.teal }} />
          </View>
          {/* 制約プロフィール: AI相談・献立提案が毎回尊重する「私の前提」。自分の言葉で書けばよい */}
          <Text style={[s.label, { marginTop: 16 }]}>{t('AIに伝えておく前提（アレルギー・苦手・宗教・予算など）')}</Text>
          <Text style={[s.note, { marginBottom: 4 }]}>{t('AI相談と献立提案は、ここに書いた前提を毎回守ります。')}</Text>
          <TextInput
            style={[s.input, { minHeight: 88, textAlignVertical: 'top' }]} multiline
            value={constraintsNote} onChangeText={setConstraintsNote}
            placeholder={t('例: えびアレルギー。豚肉は食べない。パクチー苦手。食費は1日1,000円まで。')}
            placeholderTextColor={C.faint}
          />
          <OptionButton style={{ marginTop: 16 }} label={t('保存する')} onPress={saveProfile} busy={busy} />
          {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
        </ScrollView>
      </View>
    </Modal>

    {/* ===== 食事の制約モーダル（B-18・docs/DIET-MODES.md §3） =====
        構成の順番そのものが防御になっている: ①免責 → ②同意 → ③トグル。
        免責より先にトグルを置く並べ替えをしないこと */}
    <Modal visible={sheet === 'diet'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      {/* KeyboardAvoidingView(padding)はpageSheet内でシートのオフセットぶん高さを誤計算し、長いフォーム末尾の
          自由記述欄がキーボードに隠れて「打っている文字が見えない」不具合になっていた（βフィードバック 2026-09-03）。
          ログイン画面と同じく ScrollView のキーボードインセット自動調整＋フォーカス時に末尾へスクロールで対処 */}
      <View style={s.sheetBody}>
        <SheetHeader icon={<Ban size={ICON.lg} color={C.teal} />} title={t('食事の制約')} />
        <ScrollView ref={dietScrollRef} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 24 }}>
          {/* §6-2: 免責は最上部。同意済みでも消さない（同意は薄れるので設定を触るたび読める場所に残す） */}
          <DietDisclaimerPanel />
          {diet.consentAt == null ? (
            <DietConsentCheck checked={dietAgree} onToggle={() => { setDietAgree((v) => !v); setDietMsg(null); }} />
          ) : (
            <Text style={s.note}>{t('{d} に上記を確認済みです。', { d: diet.consentAt.slice(0, 10) })}</Text>
          )}

          <Text style={[s.label, { marginTop: 16 }]}>{t('食べないもの')}</Text>
          <Text style={s.note}>{t('ONにすると、解析結果の品目に該当の可能性を表示します。記録そのものは止めません。')}</Text>
          {DIET_RULES.map((r) => (
            <View key={r.key} style={s.dietRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={s.dietName}>{dietModeLabel(r.key)}</Text>
                  {/* 王冠は行から機能を隠さない目印（無料でも内容は読めてONにできる） */}
                  {dietGated && (
                    <Pressable hitSlop={8} onPress={() => { setSheet(null); router2.push('/paywall?src=diet' as never); }}>
                      <CrownBadge size={14} />
                    </Pressable>
                  )}
                </View>
                <Text style={s.dietSub}>{dietModeSub(r.key)}</Text>
              </View>
              <Switch value={diet.modes.includes(r.key)} onValueChange={() => toggleDietMode(r.key)}
                      trackColor={{ true: C.teal }} />
            </View>
          ))}

          {/* §4: 無料でONにしたときの1行。何が動いていて何が有料かを隠さない */}
          {dietGated && diet.modes.length > 0 && (
            <Pressable style={s.dietUpsell} onPress={() => { setSheet(null); router2.push('/paywall?src=diet' as never); }}>
              <CrownBadge size={14} />
              <Text style={s.dietUpsellT}>
                {t('かんたん判定（辞書のみ）で動いています。AIによる読み取りとメニューの判定はスタンダード以上です。')}
              </Text>
            </Pressable>
          )}

          {/* その他（自由記述）: AIにそのまま渡す指定なのでスタンダード以上 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18 }}>
            <Text style={[s.label, { marginTop: 0 }]}>{t('その他（自由記述）')}</Text>
            {dietGated && <CrownBadge size={14} />}
          </View>
          <Text style={[s.note, { marginBottom: 4 }]}>{t('自分の言葉で書けます。AIが解析のときに読みます（スタンダード以上）。')}</Text>
          {dietGated ? (
            <Pressable onPress={() => { setSheet(null); router2.push('/paywall?src=diet' as never); }}>
              <View style={[s.input, s.dietInputLocked]}>
                <Text style={s.dietLockedT}>{t('例: えび・かにを避けています。パクチーも無理です。')}</Text>
              </View>
            </Pressable>
          ) : (
            <TextInput
              style={[s.input, { minHeight: 88, textAlignVertical: 'top' }]} multiline
              value={diet.custom}
              onChangeText={(v) => { setDiet((p) => ({ ...p, custom: v })); setDietMsg(null); }}
              placeholder={t('例: えび・かにを避けています。パクチーも無理です。')}
              placeholderTextColor={C.faint}
              onFocus={() => { setTimeout(() => dietScrollRef.current?.scrollToEnd({ animated: true }), 250); }}
            />
          )}

          <OptionButton style={{ marginTop: 16 }} label={t('保存する')} onPress={saveDietSettings} busy={dietBusy} />
          {dietMsg && <Text style={[s.msg, { color: dietMsg.ok ? C.teal : C.coral }]}>{dietMsg.text}</Text>}
          {/* §6-4の常設表記と同じ趣旨を、設定側にも置く */}
          <Text style={[s.note, { marginTop: 16 }]}>
            {t('表示のない品目も、対象を含む可能性があります。この機能は安全確認の代わりにはなりません。')}
          </Text>
          <Text style={[s.note, { marginTop: 8 }]}>
            {t('AI相談・献立提案への「前提」は、プロフィール編集の入力欄で別に設定できます。')}
          </Text>
          <View style={{ height: 32 }} />
        </ScrollView>
      </View>
    </Modal>

    {/* ===== テーマ選択モーダル =====
        構成（2026-09-02 刷新）: プレビュー → 明暗 → アクセント → 背景トーン → P/F/C（プリセット＋個別）。
        選択のたびにパレット世代が進みルートの Stack がツリーごと作り直されるため、この画面も再マウントされる。
        reopenSheet（モジュール変数）で「テーマシートを開いたまま」を引き継ぎ、再表示のときはスライドの
        アニメを省く（毎タップで下からせり上がるのを防ぐ） */}
    <Modal visible={sheet === 'theme'} animationType={reopened.current ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader icon={<Palette size={ICON.lg} color={C.teal} />} title={t('テーマカラー')} />
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* 1) プレビュー: いま効いている配色（C）でヒーロー風のミニカードを描く。選ぶと即時に変わる */}
          <Text style={s.label}>{t('プレビュー')}</Text>
          <ThemePreview pfc={theme.pfc} />

          {/* 2) 明暗 */}
          <Text style={[s.label, { marginTop: 22 }]}>{t('外観')}</Text>
          <Text style={s.note}>{t('「自動」は端末のダークモード設定に合わせて昼夜で切り替わります。')}</Text>
          <SegmentedControl
            options={[
              { key: 'system', label: t('自動') },
              { key: 'light', label: t('ライト') },
              { key: 'dark', label: t('ダーク') },
            ]}
            value={theme.mode}
            onChange={(m) => changeTheme({ mode: m as 'light' | 'dark' | 'system' })}
          />

          {/* 3) アクセント（先頭が新既定のエレクトリック） */}
          <Text style={[s.label, { marginTop: 22 }]}>{t('アクセントカラー')}</Text>
          <Text style={s.note}>{t('ボタンや選択中の印の色です。白地の文字に使うときは読みやすさのため自動で少し濃くなります。')}</Text>
          <View style={s.swatchRow}>
            {ACCENTS.map((a) => {
              // ダーク表示中はダーク版パレットでプレビュー（実際の見え方と一致させる）
              const pal = theme.scheme === 'dark' ? darkPaletteFor(a.key) : PALETTES[a.key];
              const on = theme.accent === a.key;
              return (
              <Pressable key={a.key} style={s.swatchWrap} onPress={() => changeTheme({ accent: a.key })}>
                <View style={[s.swatch, { backgroundColor: pal.bg, borderWidth: 1, borderColor: pal.line }, on && s.swatchOn]}>
                  <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 16, backgroundColor: pal.accentBadge }} />
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: pal.teal }} />
                  {on && <Text style={s.swatchCheck}>✓</Text>}
                </View>
                <Text style={[s.swatchT, on && { color: C.ink, fontWeight: '800' }]}>{t(a.label)}</Text>
              </Pressable>
              );
            })}
          </View>

          {/* 4) 背景トーン（ダークは Navy/Card Gray の2階調固定なので選択肢を出さない） */}
          {theme.scheme === 'dark' ? (
            <Text style={[s.note, { marginTop: 22 }]}>{t('「背景」の淡色設定はライト表示のときに使えます。')}</Text>
          ) : (
          <>
          <Text style={[s.label, { marginTop: 22 }]}>{t('背景')}</Text>
          <Text style={s.note}>{t('カードの外側の下地だけを薄く色づけます。カード自体は白のままです。')}</Text>
          <View style={s.bgRow}>
            {BG_TINTS.map((b) => {
              const pal = paletteFor(theme.accent, b.key);
              const on = theme.bg === b.key;
              return (
                <Pressable key={b.key} style={[s.bgCard, { backgroundColor: pal.bg }, on && s.bgCardOn]}
                           onPress={() => changeTheme({ bg: b.key })}>
                  {/* 下地の上に白いカードを重ね、実際の見え方をそのまま見せる */}
                  <View style={[s.bgMini, { borderColor: pal.line }]} />
                  <View style={[s.bgMini, { borderColor: pal.line, marginTop: 3 }]} />
                  <Text style={[s.bgCardT, on && { color: C.accentInk }]} numberOfLines={1}>{t(b.label)}</Text>
                </Pressable>
              );
            })}
          </View>
          </>
          )}

          {/* 5) P/F/C: プリセット3つ → 個別ピッカー */}
          <Text style={[s.label, { marginTop: 22 }]}>{t('P/F/Cバーの色')}</Text>
          <Text style={s.note}>{t('たんぱく質・脂質・炭水化物をそれぞれ好きな色にできます。目標を超えたバーは赤で表示されます。')}</Text>
          <View style={s.presetRow}>
            {PFC_PRESETS.map((p) => {
              const on = p.colors.p === theme.pfc.p && p.colors.f === theme.pfc.f && p.colors.c === theme.pfc.c;
              return (
                <Pressable key={p.key} style={[s.presetCard, on && s.presetCardOn]} onPress={() => changeTheme({ pfc: p.colors })}>
                  <View style={s.presetBars}>
                    {([p.colors.p, p.colors.f, p.colors.c] as const).map((col, i) => (
                      <View key={i} style={[s.presetBar, { backgroundColor: col, width: (['80%', '55%', '95%'] as const)[i] }]} />
                    ))}
                  </View>
                  <View style={s.presetFoot}>
                    <Text style={[s.presetT, on && { color: C.ink, fontWeight: '800' }]} numberOfLines={1}>{t(p.label)}</Text>
                    {on && <Text style={s.presetCheck}>✓</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={s.subLabel}>{t('個別に選ぶ')}</Text>

          {([
            ['p', t('たんぱく質')],
            ['f', t('脂質')],
            ['c', t('炭水化物')],
          ] as const).map(([macro, label]) => (
            <View key={macro} style={s.macroBlock}>
              <View style={s.macroHead}>
                <View style={[s.macroDot, { backgroundColor: theme.pfc[macro] }]} />
                <Text style={s.macroName}>{label}</Text>
                <View style={s.macroBarTrack}>
                  <View style={{ width: '70%', height: 6, borderRadius: 3, backgroundColor: theme.pfc[macro] }} />
                </View>
              </View>
              <View style={s.macroSwatches}>
                {PFC_SWATCHES.map((sw) => {
                  const selected = theme.pfc[macro] === sw.color;
                  const usedElsewhere = (['p', 'f', 'c'] as const)
                    .some((m) => m !== macro && theme.pfc[m] === sw.color);
                  return (
                    <Pressable key={sw.key} onPress={() => changeTheme({ pfc: { ...theme.pfc, [macro]: sw.color } })}>
                      <View style={[s.macroSw, { backgroundColor: sw.color }, selected && s.macroSwOn,
                                    usedElsewhere && !selected && { opacity: 0.28 }]}>
                        {selected && <Text style={s.macroCheck}>✓</Text>}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {(theme.pfc.p === theme.pfc.f || theme.pfc.f === theme.pfc.c || theme.pfc.p === theme.pfc.c) && (
            <Text style={s.dupWarn}>{t('同じ色が重複しています。見分けにくくなるので別の色をおすすめします。')}</Text>
          )}
          {/* ベリーは超過の赤（C.coral）と同じ値。選べるようにはするが、超過が見分けられなくなることは伝える */}
          {[theme.pfc.p, theme.pfc.f, theme.pfc.c].includes(C.coral) && (
            <Text style={s.dupWarn}>{t('超過の赤と同じ色が含まれています。目標を超えたときに見分けにくくなります。')}</Text>
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </Modal>

    {/* ===== 言語選択モーダル ===== */}
    <Modal visible={sheet === 'lang'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader icon={<Languages size={ICON.lg} color={C.teal} />} title={t("言語")} />
        <ScrollView>
          {LOCALES.map((l) => (
            <Pressable key={l.code} style={s.langRow} onPress={() => { setLocale(l.code as LocaleCode); setSheet(null); }}>
              <Text style={[s.langT, locale === l.code && { color: C.accentInk, fontWeight: '800' }]}>{l.label}</Text>
              {locale === l.code && <Text style={{ color: C.accentInk, fontWeight: '800' }}>✓</Text>}
            </Pressable>
          ))}
          <Text style={s.note}>{t('未翻訳の項目は日本語で表示されます。翻訳は順次追加していきます。')}</Text>
        </ScrollView>
      </View>
    </Modal>

    {/* ===== 読みもの（コラム）モーダル ===== */}
    <Modal visible={sheet === 'columns'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader title={t('読みもの')} />
        <ScrollView>
        <BriefToggle />
        <ExportRow />
        <ColumnReader />
        </ScrollView>
      </View>
    </Modal>

    {/* ===== マイ食品管理モーダル ===== */}
    <Modal visible={sheet === 'foods'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader icon={<Salad size={ICON.lg} color={C.teal} />} title={t("マイ食品の管理")} />
        <ScrollView keyboardShouldPersistTaps="handled">
          {/* 空状態: 何ができるかを一言で。ボタンは登録の有無にかかわらず同じ位置に出す */}
          {foodEntries.length === 0 && <Text style={[s.note, { marginBottom: 10 }]}>{t('よく食べるものを登録すると1タップで記録できます')}</Text>}
          <OptionButton style={{ marginBottom: 12 }} label={t('＋ 食品を追加')} onPress={() => setFoodFormOpen(true)} />
          <Text style={s.note}>{t('複数品目のセットは、食事タブで「今日の記録」の行を長押し、またはトレイの✓保存を長押ししても登録できます。')}</Text>
          {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}

          {/* 統合一覧: 単品とセットを同じリストに。セット（複数品目）は皿アイコン＋品目数バッジで区別 */}
          {foodEntries.map((e) => renameEdit?.id === e.id ? (
            // 名前変更中: 行がその場で入力欄に変わる
            <View key={`${e.kind}:${e.id}`} style={s.foodRow}>
              <TextInput
                style={[s.input, { flex: 1, paddingVertical: 8 }]} value={renameEdit.name}
                onChangeText={(v) => setRenameEdit({ kind: e.kind, id: e.id, name: v })}
                autoFocus maxLength={40} returnKeyType="done" onSubmitEditing={saveRename}
              />
              <Pressable onPress={saveRename} hitSlop={8}>
                <Text style={{ color: C.accentInk, fontWeight: '800', fontSize: 14 }}>{t('保存')}</Text>
              </Pressable>
              <Pressable onPress={() => setRenameEdit(null)} hitSlop={8}>
                <Text style={{ color: C.sub, fontWeight: '700', fontSize: 14 }}>{t('やめる')}</Text>
              </Pressable>
            </View>
          ) : (
            <View key={`${e.kind}:${e.id}`} style={s.foodRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[s.foodName, { flex: 0, flexShrink: 1 }]} numberOfLines={1}>{e.name}</Text>
                  {e.count != null && (
                    <View style={s.badge}>
                      <UtensilsCrossed size={ICON.xs} color={C.teal} />
                      <Text style={s.badgeT}>{t('{n}品', { n: e.count })}</Text>
                    </View>
                  )}
                </View>
                <Text style={s.foodKcal}>{e.count != null ? t('約{k}kcal', { k: e.kcal.toLocaleString() }) : `${e.kcal}kcal`}</Text>
              </View>
              <Pressable onPress={() => { setMsg(null); setRenameEdit({ kind: e.kind, id: e.id, name: e.name }); }} hitSlop={8}>
                <Pencil color={C.sub} size={ICON.md} />
              </Pressable>
              <Pressable onPress={() => removeEntry(e)} hitSlop={8}>
                <Trash2 color={C.coral} size={ICON.md} />
              </Pressable>
            </View>
          ))}
          <View style={{ height: 24 }} />
        </ScrollView>
        {/* 【重要】追加シートはこの pageSheet の内側に置く。iOSは表示中のシートの兄弟として
            別の Modal を出せないため、外に置くと「食品を追加」を押しても何も起きない
            （2026-09-02 まで別シート（アイコン選択）の内側に紛れ込んでいて無反応だった） */}
        <AddFoodSheet visible={foodFormOpen} draft={null}
                      onClose={() => setFoodFormOpen(false)} onSaved={load} />
      </View>
    </Modal>

    {/* ===== ヘルスケア連携モーダル ===== */}
    <Modal visible={sheet === 'health'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader title={"⌚ " + t("ヘルスケア連携")} />
        {!healthAvailable() ? (
          <Text style={s.note}>{t('この機能はTestFlight版で有効になります（Expo Goプレビューでは利用できません）。')}</Text>
        ) : healthLink === 'linked' ? (
          <>
            {/* 連携済み: 状態の表示＋見直し導線。ここに「連携する」ボタンは出さない（一度連携したら恒久） */}
            <Text style={s.note}>{lastSyncLabel ? t('連携中・最終同期 {t}', { t: lastSyncLabel }) : t('連携中・全項目を自動で取り込みます')}</Text>
            <Text style={[s.note, { marginTop: 8 }]}>{t('体重・歩数・睡眠・消費kcalは、ヘルスケア側の数値が変わったタイミングで自動的に取り込まれます（定時ではなく変更のたび）。データは機能提供のみに使用し、広告等には一切使用しません。')}</Text>
            <View style={[s.notifRow, { paddingHorizontal: 0, marginTop: 10 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.notifLabel}>{t('体重は手入力を優先')}</Text>
                <Text style={s.notifSub}>{t('OFFのときは、同じ日に手入力があってもヘルスケアの計測が新しければそちらに置き換えます')}</Text>
              </View>
              <Switch value={preferManualW} onValueChange={togglePreferManualW} trackColor={{ true: C.teal }} />
            </View>
            <Pressable style={[s.btnPrimary, { marginTop: 14 }]} onPress={openHealthSettings}>
              <Text style={s.btnPrimaryT}>{t('連携を見直す（iOS設定を開く）')}</Text>
            </Pressable>
            <Pressable style={{ marginTop: 14, alignItems: 'center' }} onPress={healthImportWeights} disabled={busy}>
              {busy ? <ActivityIndicator color={C.teal} /> : <Text style={[s.note, { color: C.accentInk, fontWeight: '700' }]}>{t('過去90日の体重をいま取り込む')}</Text>}
            </Pressable>
          </>
        ) : (
          <>
            {/* 未連携: ここが初回連携の入口（ensureHealthAuth→linkHealth）。成功後は上の表示に切り替わる */}
            <Text style={s.note}>{t('一度連携すると、体重・歩数・睡眠・消費kcalを自動で取り込みます。データは機能提供のみに使用し、広告等には一切使用しません。歩数・睡眠は「概要」タブで見られます。')}</Text>
            <Pressable style={[s.btnPrimary, { marginTop: 14 }]} onPress={healthImportWeights} disabled={busy}>
              {busy ? <ActivityIndicator color={C.panel} /> : <Text style={s.btnPrimaryT}>{t('ヘルスケアと連携する')}</Text>}
            </Pressable>
          </>
        )}
        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
      </View>
    </Modal>

    {/* ===== 統合目標モーダル（体重→赤字→運動→習慣→食べられる量→PFC） ===== */}
    <Modal visible={sheet === 'goal'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>{/* KAVはpageSheet内で誤計算するためScrollView側のインセット自動調整に統一（2026-09-03） */}
        <SheetHeader icon={<Target size={ICON.lg} color={C.teal} />} title={t("目標")} />
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 24 }}>
          <GoalPanel mode="hub" weightSections="goal" />
          <Text style={s.note}>{t('チートデイの登録は「概要」タブのカードから行えます。')}</Text>
          <View style={{ height: 30 }} />
        </ScrollView>
      </View>
    </Modal>

    {/* ===== アカウント削除モーダル ===== */}
    <Modal visible={sheet === 'delete'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader icon={<Trash2 size={ICON.lg} color={C.coral} />} title={t("アカウント削除")} />
        <Text style={s.note}>{t('アカウントと全データ（記録・写真・目標・マイ食品）を完全に削除します。この操作は取り消せません。')}</Text>
        <Text style={s.label}>{t('確認のため「削除」と入力')}</Text>
        <TextInput style={s.input} value={delConfirm} onChangeText={setDelConfirm} placeholder={t('削除')} placeholderTextColor={C.faint} />
        <Pressable style={[s.btnDanger, { marginTop: 14 }, !deleteConfirmMatches(delConfirm) && { opacity: 0.4 }]}
                   onPress={confirmDelete} disabled={busy || !deleteConfirmMatches(delConfirm)}>
          {busy ? <ActivityIndicator color={C.panel} /> : <Text style={s.btnPrimaryT}>{t('アカウントを完全に削除する')}</Text>}
        </Pressable>
        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
      </View>
    </Modal>    <Modal visible={avatarOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAvatarOpen(false)}>
      <View style={s.sheetBody}>
        <SheetHeader icon={<Smile size={ICON.lg} color={C.teal} />} title={t("アイコンを選ぶ")} />
        <ScrollView>
          {AVATAR_GROUPS.map((g) => (
            <View key={g.key}>
              <Text style={s.avatarGroupT}>{t(g.label)}</Text>
              <View style={s.avatarGrid}>
                {g.items.map((a) => (
                  <Pressable key={a} onPress={() => { setAvatar(a); setAvatarOpen(false); }}
                             style={({ pressed }) => [s.avatarCell, avatar === a && s.avatarCellOn, pressed && { opacity: 0.6 }]}>
                    <Text style={{ fontSize: 26 }}>{a}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </Modal>
    {/* ===== 起動時のエラー記録（開発者向け・docs/ANDROID.md） =====
        起動時の初期化（言語・テーマ・通知・ヘルスケア…）は safeBoot() で1つずつ独立に
        受け止めており、失敗はここに残る。トレースが取れないストア配布ビルドで
        「どの初期化がコケたか」を本人が読んで送れる、唯一の窓口 */}
    <Modal visible={sheet === 'boot'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader icon={<Bug size={ICON.lg} color={C.sub} />} title={t('起動時のエラー記録')} />
        <Text style={s.note}>
          {t('アプリの起動時に失敗した初期化処理の記録です（最大20件）。ここに何か出ていても、記録は失われていません。不具合の報告に貼り付けてください。')}
        </Text>
        {bootErrors.length === 0 ? (
          <Text style={[s.note, { marginTop: 16 }]}>{t('記録はありません（起動時のエラーは検出されていません）。')}</Text>
        ) : (
          <>
            <ScrollView style={s.bootBox} contentContainerStyle={{ padding: 12, gap: 10 }}>
              {bootErrors.map((e, i) => (
                <View key={`${e.name}-${e.at}-${i}`}>
                  <Text style={s.bootName}>
                    {e.name}{(e.count ?? 1) > 1 ? t('（{n}回）', { n: e.count ?? 1 }) : ''}
                  </Text>
                  <Text style={s.bootMsg}>{e.message}</Text>
                  <Text style={s.bootAt}>{e.at}</Text>
                </View>
              ))}
            </ScrollView>
            <OptionButton
              style={{ marginTop: 14 }}
              label={bootCopied ? t('コピーしました') : t('内容をコピーする')}
              onPress={() => {
                Clipboard.setStringAsync(formatBootErrors(bootErrors))
                  .then(() => setBootCopied(true))
                  .catch(() => {});
              }}
            />
            <Pressable style={s.deleteLink} onPress={() => { clearBootErrors().then(reloadBootErrors).catch(() => {}); }} hitSlop={6}>
              <Text style={s.deleteLinkT}>{t('記録を消す')}</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>

    <NotificationCenter visible={noticeOpen} onClose={() => { setNoticeOpen(false); todo.refresh(); }} />
    {/* クーポンコード入力（成功時はシート内で祝祭＋gateキャッシュ更新まで完結する） */}
    <CouponSheet visible={couponOpen} onClose={() => setCouponOpen(false)} />

    {/* ===== ご意見・不具合の報告（サポート節） ===== */}
    <FeedbackSheet visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

    {/* 起床時刻のピッカー（15分刻み）。iOSはスピナー＋「決定」、Androidは端末のダイアログで即確定
        （食事タブの「食べた時間」ピッカーと同じ作法） */}
    <Modal visible={wakePickerOpen} transparent animationType="fade" onRequestClose={() => setWakePickerOpen(false)}>
      <Pressable style={s.timeBack} onPress={() => setWakePickerOpen(false)}>
        <Pressable style={s.timeCard} onPress={() => {}}>
          <Text style={s.timeTitle}>{t('起床時刻')}</Text>
          <DateTimePicker
            locale={apiLang()}
            value={wakeDraft} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minuteInterval={WAKE_STEP_MIN}
            onChange={(ev, d) => {
              if (Platform.OS !== 'ios') {
                setWakePickerOpen(false);
                if (ev.type === 'set' && d) commitWake(d);
                return;
              }
              if (d) setWakeDraft(d);
            }}
          />
          {Platform.OS === 'ios' && (
            <View style={s.timeBtns}>
              <Pressable style={s.timeBtnGhost} onPress={() => setWakePickerOpen(false)} hitSlop={6}>
                <Text style={s.timeBtnGhostT}>{t('キャンセル')}</Text>
              </Pressable>
              <Pressable style={s.timeBtn} onPress={() => { commitWake(wakeDraft); setWakePickerOpen(false); }} hitSlop={6}>
                <Text style={s.timeBtnT}>{t('決定')}</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
    <StatusBarMask />
    </View>
  );
}

const s = themed(() => ({
  scroll: { padding: SPACE.screen, paddingTop: 12, paddingBottom: 40 },  // ネイティブヘッダーが上を確保するため控えめに
  h: { ...HEAD.page, color: C.ink, marginBottom: 12 },
  // サマリー
  summary: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: RADIUS.card, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: SPACE.card, marginBottom: 18,
  },
  avatarEdit: {
    position: 'absolute', bottom: -2, right: -2,
    width: 19, height: 19, borderRadius: 10, backgroundColor: C.teal,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.panel,
  },
  avatarEditT: { fontSize: 11, color: '#fff', fontWeight: '900' },
  avatarGroupT: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 16, marginBottom: 8 },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  avatarCell: {
    width: 52, height: 52, borderRadius: 15, backgroundColor: C.chipBg,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  avatarCellOn: { borderColor: C.teal, backgroundColor: C.accentBadge },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center' },
  sumName: { fontSize: 17, fontWeight: '800', color: C.ink },
  sumMail: { fontSize: 13, color: C.sub, marginTop: 1 },
  sumMeta: { fontSize: 13, color: C.sub, marginTop: 4, fontVariant: ['tabular-nums'] },
  // グループリスト
  groupLabel: { fontSize: 13, fontWeight: '700', color: C.sub, marginBottom: 6, marginLeft: 6, letterSpacing: 0.4 },
  bgRow: { flexDirection: 'row', gap: 7 },
  bgCard: {
    flex: 1, minWidth: 0, borderRadius: RADIUS.input, borderWidth: 1.5, borderColor: C.line,
    padding: 8, alignItems: 'stretch',
  },
  // P/F/Cプリセット（3枚横並び。中に3本のバーで配色をそのまま見せる）
  presetRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  presetCard: { flex: 1, minWidth: 0, borderRadius: RADIUS.tile, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.panel, padding: 10, gap: 8 },
  presetCardOn: { borderColor: C.teal, borderWidth: 2.5, backgroundColor: C.accentSoft },
  presetBars: { gap: 5 },
  presetBar: { height: 7, borderRadius: 4 },
  presetFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  presetT: { flex: 1, fontSize: 12, fontWeight: '700', color: C.sub },
  presetCheck: { fontSize: 13, fontWeight: '900', color: C.accentInk },
  subLabel: { fontSize: 13, fontWeight: '700', color: C.sub, marginTop: 16 },
  bgCardOn: { borderColor: C.teal, borderWidth: 2.5 },
  // 背景トーンの見本の中に置く「カード」。実際のカード面と同じトークンで塗る
  // （生の白のままだとダークで見本だけ白いカードが浮いてしまう）
  bgMini: { height: 11, borderRadius: 4, backgroundColor: C.panel, borderWidth: 1 },
  bgCardT: { fontSize: 11, fontWeight: '800', color: C.sub, marginTop: 7, textAlign: 'center' },
  macroBlock: { marginTop: 14 },
  macroHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  macroDot: { width: 12, height: 12, borderRadius: 6 },
  macroName: { fontSize: 15, fontWeight: '800', color: C.ink, width: 76 },
  macroBarTrack: { flex: 1, height: 6, backgroundColor: C.track, borderRadius: 3, overflow: 'hidden' },
  macroSwatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  macroSw: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  macroSwOn: { borderWidth: 3, borderColor: C.ink },
  macroCheck: { color: '#fff', fontSize: 17, fontWeight: '900' },
  dupWarn: { fontSize: 13, color: C.coral, marginTop: 12, lineHeight: 18 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4 },
  swatchWrap: { alignItems: 'center', width: 78 },
  swatch: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 3, borderColor: C.ink },
  swatchCheck: { color: '#fff', fontSize: 21, fontWeight: '900' },
  swatchT: { fontSize: 11, color: C.sub, marginTop: 5, fontWeight: '600', textAlign: 'center' },
  pfcRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.tile, marginTop: 8, backgroundColor: C.bg,
  },
  pfcRowOn: { borderColor: C.teal, backgroundColor: C.tealWeak },
  pfcName: { fontSize: 15, fontWeight: '800', color: C.ink },
  pfcNote: { fontSize: 13, color: C.sub, marginTop: 2 },
  pfcSample: { height: 6, backgroundColor: C.track, borderRadius: 3, overflow: 'hidden' },
  unitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 9 },
  unitLabel: { fontSize: 15, fontWeight: '700', color: C.ink },
  langRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: C.line },
  langT: { fontSize: 17, color: C.ink, fontWeight: '600' },
  notifRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  hourChip: { borderWidth: 1.5, borderColor: C.line, backgroundColor: C.panel, borderRadius: RADIUS.chip, paddingHorizontal: 13, paddingVertical: 7 },
  hourChipOn: { backgroundColor: C.ink, borderColor: C.ink },
  hourChipT: { fontSize: 13, fontWeight: '800', color: C.sub, fontVariant: ['tabular-nums'] },
  hourChipTOn: { color: C.panel },  // ink地の文字はダークで反転するため背景トークンで吸収
  notifLabel: { fontSize: 15, fontWeight: '700', color: C.ink },
  notifSub: { fontSize: 13, color: C.sub, marginTop: 2 },
  cycleRowText: { flex: 1 },
  cycleLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notifNote: { fontSize: 11, color: C.faint, lineHeight: 16, paddingHorizontal: 14, paddingBottom: 10 },
  group: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.panel, overflow: 'hidden', marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 15, fontWeight: '600', color: C.ink },
  rowSub: { fontSize: 13, color: C.sub, marginTop: 1 },
  sep: { height: 0.5, backgroundColor: C.line, marginLeft: 56 },
  // 起床時刻: 右端の時刻チップ＋15分刻みピッカー（食事タブの「食べた時間」と同じ見た目に揃える）
  wakeChip: {
    borderWidth: 1.5, borderColor: C.line, backgroundColor: C.chipBg,
    borderRadius: RADIUS.chip, paddingHorizontal: 14, paddingVertical: 7,
  },
  wakeChipT: { fontSize: 15, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  timeBack: { flex: 1, backgroundColor: rgba(C.ink, 0.35), justifyContent: 'center', padding: 24 },
  timeCard: { backgroundColor: C.bg, borderRadius: 20, padding: 14 },
  timeTitle: { fontSize: 15, fontWeight: '800', color: C.ink, marginBottom: 4, marginLeft: 4 },
  timeBtns: { flexDirection: 'row', gap: 8, marginTop: 6 },
  timeBtnGhost: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: RADIUS.chip, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.panel },
  timeBtnGhostT: { fontSize: 15, fontWeight: '800', color: C.sub },
  timeBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: RADIUS.chip, backgroundColor: C.teal },
  timeBtnT: { fontSize: 15, fontWeight: '800', color: C.accentInk },   // アクセント地の文字はCトークンで（生HEX禁止）
  // アクション
  logoutBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, paddingVertical: 13,
  },
  logoutT: { color: C.sub, fontSize: 15, fontWeight: '800' },
  deleteLink: { alignItems: 'center', marginTop: 18 },
  deleteLinkT: { color: C.coral, fontSize: 15, fontWeight: '700' },
  // 起動時のエラー記録（開発者向け・最下部。faintで「普段は見なくていい」ことを見た目で示す）
  bootLink: { alignItems: 'center', marginTop: 26 },
  bootLinkT: { color: C.faint, fontSize: 12, fontWeight: '600' },
  bootBox: {
    maxHeight: 380, marginTop: 14, backgroundColor: C.panel,
    borderRadius: RADIUS.tile, borderWidth: 1, borderColor: C.line,
  },
  bootName: { fontSize: 13, fontWeight: '800', color: C.coral },
  bootMsg: { fontSize: 12, color: C.ink, marginTop: 2, lineHeight: 17 },
  bootAt: { fontSize: 11, color: C.faint, marginTop: 2 },
  // モーダル
  sheetBody: { flex: 1, backgroundColor: C.bg, padding: 18, paddingTop: sheetTopPad(18) },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { ...HEAD.card, color: C.ink },
  sheetClose: { fontSize: 15, fontWeight: '700', color: C.accentInk },
  // フォーム
  label: { fontSize: 13, fontWeight: '700', color: C.sub, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.input, padding: 12, fontSize: 17, color: C.ink },
  segMini: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, paddingVertical: 10, alignItems: 'center' },
  segMiniOn: { backgroundColor: C.ink, borderColor: C.ink },
  segMiniT: { fontSize: 15, fontWeight: '700', color: C.sub },
  btnPrimary: { backgroundColor: C.ink, borderRadius: RADIUS.chip, paddingVertical: 14, alignItems: 'center' },
  btnPrimaryT: { color: C.panel, fontSize: 15, fontWeight: '800' },  // ink地（ダーク=明色）に追従
  btnDanger: { backgroundColor: C.coral, borderRadius: RADIUS.chip, paddingVertical: 14, alignItems: 'center' },
  note: { fontSize: 13, color: C.sub, lineHeight: 19 },
  msg: { fontSize: 15, fontWeight: '600', marginTop: 10 },

  // ===== 食事の制約（B-18） =====
  dietRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  dietName: { fontSize: 15, fontWeight: '700', color: C.ink },
  dietSub: { fontSize: 12, color: C.sub, lineHeight: 17, marginTop: 2 },
  dietUpsell: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    backgroundColor: C.chipBg, borderRadius: RADIUS.input, padding: 10,
  },
  dietUpsellT: { flex: 1, fontSize: 12, lineHeight: 17, color: C.sub },
  // 自由記述の有料ロック時: 入力できないことが見て分かる面（プレースホルダだけ見せる）
  dietInputLocked: { minHeight: 88, backgroundColor: C.chipBg, justifyContent: 'flex-start' },
  dietLockedT: { fontSize: 15, color: C.faint, lineHeight: 21 },
  foodRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: C.line },
  // セット（複数品目）の品目数バッジ（統合一覧で単品と見分ける印）
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.accentBadge, borderRadius: RADIUS.chip, paddingHorizontal: 7, paddingVertical: 2,
  },
  badgeT: { fontSize: 11, fontWeight: '800', color: C.accentInk, fontVariant: ['tabular-nums'] },
  foodName: { flex: 1, fontSize: 15, color: C.ink, fontWeight: '600' },
  foodKcal: { fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
}));
