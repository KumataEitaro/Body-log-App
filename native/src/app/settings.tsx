// マイページ: iOS設定アプリ風のグループ化メニューリスト
// フォーム・一覧のベタ貼りを廃止し、各機能はモーダル（pageSheet）で開く
// 構成: ヘッダーサマリー → アカウント設定 → データ・連携 → アクション（ログアウト/削除）
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setWeeklyPhotoReminder, setDailyReminderPrefs, getDailyReminderPrefs, ensureNotifPermission, cancelMealGapReminder, type DailyReminderMode } from '@/lib/notify';
import { usePurpose } from '@/lib/purpose';
import { SegmentedControl, OptionButton } from '@/components/ui/Selectable';
import { UserRound, Salad, HeartPulse, LogOut, Trash2, ChevronRight, CircleHelp, Target, Dumbbell, BookOpen, Languages, Palette, Crown, Award, Smile } from 'lucide-react-native';
import ColumnReader from '@/components/ColumnReader';
import { exportAllCsv } from '@/lib/exportCsv';
import MyFoodForm from '@/components/MyFoodForm';
import { AVATAR_GROUPS, useAvatar, setAvatar } from '@/lib/avatar';
import NotificationCenter, { useTodoBadge, TodoBadge } from '@/components/NotificationCenter';
import { BellRing } from 'lucide-react-native';
import { t, useLocale, setLocale, LOCALES, type LocaleCode } from '@/lib/i18n';
import { useUnits, setUnits, fmtWeight, fmtHeight } from '@/lib/units';
import { useTheme, setTheme, ACCENTS, PALETTES, PFC_SWATCHES, BG_TINTS, paletteFor, darkPaletteFor } from '@/lib/theme';
import { SegmentedControl as Seg } from '@/components/ui/Selectable';
import { useGuide } from '@/components/GuideTour';
import GoalPanel from '@/components/GoalPanel';
import { supabase } from '@/lib/supabase';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { apiPost } from '@/lib/api';
import { C, sheetTopPad } from '@/lib/ui';
import { mifflinBMR } from '@/lib/calc';
import { healthAvailable, requestHealthAuth, importWeights } from '@/lib/health';
import { WEEK_GOAL_KEY } from '@/lib/achievements';
import StatusBarMask from '@/components/StatusBarMask';
import QuickLogFab from '@/components/QuickLogFab';
import ActivityLevelPicker from '@/components/ActivityLevelPicker';

type MyFoodLite = { id: string; name: string; kcal: number };
type Sheet = null | 'lang' | 'theme' | 'profile' | 'foods' | 'health' | 'delete' | 'goalW' | 'goalT' | 'columns';

// 記録のCSVエクスポート（データは本人のもの、を形にする）
function ExportRow() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Pressable style={bt.row} disabled={busy} onPress={async () => {
      setBusy(true); setErr('');
      const r = await exportAllCsv();
      if (!r.ok) setErr(r.error);
      setBusy(false);
    }}>
      <Text style={bt.label}>{t('記録をエクスポート（CSV）')}</Text>
      {busy ? <ActivityIndicator color={C.teal} /> : <Text style={{ color: C.teal, fontWeight: '800' }}>↗</Text>}
      {err ? <Text style={{ position: 'absolute', bottom: -16, left: 14, fontSize: 11, color: C.coral }}>{err}</Text> : null}
    </Pressable>
  );
}

// 「今日のひとこと帯」のオン/オフ（設計上、消せることが安心につながる）
function BriefToggle() {
  const [off, setOff] = useState(false);
  useEffect(() => { AsyncStorage.getItem('bl-brief-off').then((v) => setOff(v === '1')).catch(() => {}); }, []);
  return (
    <Pressable style={bt.row} onPress={() => {
      const next = !off;
      setOff(next);
      AsyncStorage.setItem('bl-brief-off', next ? '1' : '0').catch(() => {});
    }}>
      <Text style={bt.label}>{t('今日のひとこと帯を表示')}</Text>
      <View style={[bt.track, !off && bt.trackOn]}><View style={[bt.knob, !off && bt.knobOn]} /></View>
    </Pressable>
  );
}
const bt = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.panel, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(14,17,22,0.08)',
  },
  label: { fontSize: 15, fontWeight: '600', color: C.ink },
  track: { width: 44, height: 26, borderRadius: 13, backgroundColor: C.line, padding: 3 },
  trackOn: { backgroundColor: C.teal },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
});

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
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [foods, setFoods] = useState<MyFoodLite[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [delConfirm, setDelConfirm] = useState('');
  const guide = useGuide();

  // 相談タブ等からのディープリンク（/settings?open=goalW）で目的のシートを直接開く
  const { open, ts } = useLocalSearchParams<{ open?: string; ts?: string }>();
  const consumedOpen = useRef<string | null>(null);
  useEffect(() => {
    const stamp = `${open}-${ts ?? ''}`;  // tsを含めると同じシートへの2回目の遷移でも開く
    if (!open || consumedOpen.current === stamp) return;
    consumedOpen.current = stamp;
    if (open === 'goalW' || open === 'goalT' || open === 'profile' || open === 'theme') openSheet(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ts]);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    setEmail(session?.user?.email ?? '');
    const [{ data: prof }, wRes, fRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('entries').select('weight').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
      supabase.from('my_foods').select('id,name,kcal').order('created_at', { ascending: true }).limit(50),
    ]);
    if (wRes.data?.length) setLatestWeight(Number(wRes.data[0].weight));
    setFoods((fRes.data as MyFoodLite[]) || []);
    if (prof) {
      setName(prof.display_name || '');
      if (prof.sex) setSex(prof.sex);
      if (prof.height_cm != null) setHeight(String(prof.height_cm));
      if (prof.age != null) setAge(String(prof.age));
      if (prof.life_factor != null) setLife(String(prof.life_factor));
      setMaternity(prof.maternity === true);   // 列が無い旧DBではundefined → false扱い
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const locale = useLocale();
  const units = useUnits();
  const theme = useTheme();
  const todo = useTodoBadge();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [foodFormOpen, setFoodFormOpen] = useState(false);
  const avatar = useAvatar();
  const [avatarOpen, setAvatarOpen] = useState(false);

  function openSheet(v: Sheet) { setMsg(null); setDelConfirm(''); setSheet(v); }

  // 記録の週目標（ソフト週目標）。既定は「毎日」=現行と同じ意味なので、
  // 何もしない人の体験は一切変わらない。値は実績ページのバッジ判定と共有する
  const [weekGoal, setWeekGoal] = useState<'7' | '5' | '4' | '3'>('7');
  useEffect(() => {
    AsyncStorage.getItem(WEEK_GOAL_KEY).then((v) => {
      if (v === '7' || v === '5' || v === '4' || v === '3') setWeekGoal(v);
    }).catch(() => {});
  }, []);
  function changeWeekGoal(v: '7' | '5' | '4' | '3') {
    setWeekGoal(v);
    AsyncStorage.setItem(WEEK_GOAL_KEY, v).catch(() => {});
  }

  // 通知（設定はAsyncStorageに永続化。OFF→ONで権限リクエスト）
  const [remMode, setRemMode] = useState<DailyReminderMode>('off');
  const [remHour, setRemHour] = useState(21);
  const [notifWeekly, setNotifWeekly] = useState(false);
  const [notifGap, setNotifGap] = useState(false);
  const purpose = usePurpose(); // 食間リマインド行はbulk（増量）の人にだけ見せる
  useEffect(() => {
    getDailyReminderPrefs().then((p) => { setRemMode(p.mode); setRemHour(p.hour); }).catch(() => {});
    AsyncStorage.getItem('bl-notif-weekly').then((v) => setNotifWeekly(v === '1')).catch(() => {});
    AsyncStorage.getItem('bl-notif-gap').then((v) => setNotifGap(v === '1')).catch(() => {});
  }, []);
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
      // maternity列が無い旧DBでは列なしで再実行し、プロフィール保存自体は成立させる
      let { error } = await supabase.from('profiles').update({ ...base, maternity }).eq('id', uid);
      if (error && /maternity|column|schema/i.test(error.message)) {
        ({ error } = await supabase.from('profiles').update(base).eq('id', uid));
      }
      setMsg(error ? { ok: false, text: t('保存に失敗しました。もう一度お試しください。') } : { ok: true, text: t('保存しました。') });
    } finally { setBusy(false); }
  }

  async function healthImportWeights() {
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      if (!(await requestHealthAuth())) { setMsg({ ok: false, text: t('ヘルスケアへのアクセスが許可されませんでした。') }); return; }
      const res = await importWeights(uid, 90);
      if ('error' in res) { setMsg({ ok: false, text: res.error }); return; }
      setMsg({ ok: true, text: res.imported > 0 ? t('体重を {n} 日分 取り込みました。「概要」タブのグラフに反映されます。', { n: res.imported }) : t('新しく取り込める体重データはありませんでした。') });
    } finally { setBusy(false); }
  }

  function removeFood(id: string, foodName: string) {
    Alert.alert(`「${foodName}」を削除しますか？`, t('入力画面のチップから消えます（過去の記録は変わりません）。'), [
      { text: t('キャンセル'), style: 'cancel' },
      {
        text: t('削除する'), style: 'destructive',
        onPress: async () => {
          await supabase.from('my_foods').delete().eq('id', id);
          setFoods((prev) => prev.filter((f) => f.id !== id));
        },
      },
    ]);
  }

  function confirmDelete() {
    if (delConfirm !== '削除') return;
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
  function Row({ icon, label, sub, onPress, danger }: { icon: React.ReactNode; label: string; sub?: string; onPress: () => void; danger?: boolean }) {
    return (
      <Pressable style={({ pressed }) => [s.row, pressed && { backgroundColor: C.pressed }]} onPress={onPress}>
        <View style={s.rowIcon}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={[s.rowLabel, danger && { color: C.coral }]}>{label}</Text>
          {sub != null && <Text style={s.rowSub}>{sub}</Text>}
        </View>
        <ChevronRight color={C.faint} size={18} />
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
    }} />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
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
                   onPress={() => { todo.refresh(); setNoticeOpen(true); }}>
          <View style={s.rowIcon}><BellRing color={C.teal} size={19} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>{t('通知センター')}</Text>
            <Text style={s.rowSub}>
              {todo.count > 0 ? t('入力すべき項目が{n}件あります', { n: todo.count }) : t('いま対応が必要な項目はありません')}
            </Text>
          </View>
          <TodoBadge count={todo.count} style={{ marginRight: 6 }} />
          <ChevronRight color={C.faint} size={18} />
        </Pressable>
      </View>

      {/* アカウント設定 */}
      <Text style={s.groupLabel}>{t('アカウント設定')}</Text>
      <View style={s.group}>
        <Row icon={<Crown color={C.teal} size={19} />} label={t('プラン')} sub={t('プランの確認・変更・購入の復元')} onPress={() => router2.push('/paywall' as never)} />
        <View style={s.sep} />
        <Row icon={<Award color={C.teal} size={19} />} label={t('実績')} sub={t('ストリーク・バッジ・ストーリー共有')} onPress={() => router2.push('/achievements' as never)} />
        <View style={s.sep} />
        <Row icon={<UserRound color={C.teal} size={19} />} label={t('プロフィール編集')} sub={t('表示名・性別・身長・年齢・活動量')} onPress={() => openSheet('profile')} />
        <View style={s.sep} />
        <Row icon={<Salad color={C.teal} size={19} />} label={t('マイ食品の管理')} sub={t('{n}件 登録済み', { n: foods.length })} onPress={() => openSheet('foods')} />
      </View>

      {/* 目標 */}
      <Text style={s.groupLabel}>{t('目標')}</Text>
      <View style={s.group}>
        <Row icon={<Target color={C.teal} size={19} />} label={t('体重の目標')} sub={t('目標日・目標体重・PFC詳細')} onPress={() => openSheet('goalW')} />
        <View style={s.sep} />
        <Row icon={<Dumbbell color={C.teal} size={19} />} label={t('運動の目標')} sub={t('週の運動習慣・種目ごとの目標重量（RM換算）')} onPress={() => openSheet('goalT')} />
        <View style={s.sep} />
        {/* ソフト週目標: 「毎日」を強いない自己契約。達成の表示は実績ページの「今週」ブロック */}
        <View style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
          <Text style={s.notifLabel}>{t('記録の週目標')}</Text>
          <Text style={[s.notifSub, { marginBottom: 10 }]}>{t('毎日じゃなくていい。自分で決めたペースを守れたら、それは成功です。')}</Text>
          <SegmentedControl
            options={[
              { key: '7', label: t('毎日') },
              { key: '5', label: t('週5日') },
              { key: '4', label: t('週4日') },
              { key: '3', label: t('週3日') },
            ]}
            value={weekGoal} onChange={changeWeekGoal}
          />
        </View>
      </View>

      {/* 見た目（テーマカラー・PFCの色） */}
      <Text style={s.groupLabel}>{t('見た目')}</Text>
      <View style={s.group}>
        <Row icon={<Palette color={C.teal} size={19} />} label={t('テーマカラー')}
             sub={t(ACCENTS.find((a) => a.key === theme.accent)?.label ?? '')}
             onPress={() => openSheet('theme')} />
      </View>

      {/* 表示（言語・単位） */}
      <Text style={s.groupLabel}>{t('言語')} ・ {t('単位')}</Text>
      <View style={s.group}>
        <Row icon={<Languages color={C.teal} size={19} />} label={t('言語')}
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
        <Row icon={<HeartPulse color={C.teal} size={19} />} label={t('ヘルスケア連携')}
             sub={healthAvailable() ? '体重の取込（Apple ヘルスケア）' : t('TestFlight版で有効になります')}
             onPress={() => openSheet('health')} />
      </View>

      {/* サポート */}
      <Text style={s.groupLabel}>{t('サポート')}</Text>
      <View style={s.group}>
        <Row icon={<CircleHelp color={C.teal} size={19} />} label={t('使い方ガイドをもう一度見る')}
             sub={t('各画面の説明と初期設定をやり直せます')}
             onPress={() => guide.start()} />
        <View style={s.sep} />
        <Row icon={<BookOpen color={C.teal} size={19} />} label={t('読みもの')}
             sub={t('PFCバランス・カロリー収支・過食の心理などのコラム')}
             onPress={() => openSheet('columns')} />
      </View>

      {/* アクション */}
      <View style={{ height: 16 }} />
      <Pressable style={s.logoutBtn} onPress={() => supabase.auth.signOut()}>
        <LogOut color={C.sub} size={16} />
        <Text style={s.logoutT}>{t('ログアウト')}</Text>
      </Pressable>
      <Pressable style={s.deleteLink} onPress={() => openSheet('delete')} hitSlop={6}>
        <Text style={s.deleteLinkT}>{t('アカウントを削除する')}</Text>
      </Pressable>
    </ScrollView>

    {/* ===== プロフィール編集モーダル ===== */}
    <Modal visible={sheet === 'profile'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetBody}>
        <SheetHeader icon={<UserRound size={18} color={C.teal} />} title={t("プロフィール編集")} />
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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
          <OptionButton style={{ marginTop: 16 }} label={t('保存する')} onPress={saveProfile} busy={busy} />
          {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

    {/* ===== テーマ選択モーダル ===== */}
    <Modal visible={sheet === 'theme'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader icon={<Palette size={18} color={C.teal} />} title={t('テーマカラー')} />
        <ScrollView>
          <Text style={s.label}>{t('外観')}</Text>
          <Text style={s.note}>{t('「自動」は端末のダークモード設定に合わせて昼夜で切り替わります。')}</Text>
          <SegmentedControl
            options={[
              { key: 'light', label: t('ライト') },
              { key: 'dark', label: t('ダーク') },
              { key: 'system', label: t('自動') },
            ]}
            value={theme.mode}
            onChange={(m) => setTheme({ mode: m as 'light' | 'dark' | 'system' })}
          />

          <Text style={[s.label, { marginTop: 22 }]}>{t('アクセントカラー')}</Text>
          <View style={s.swatchRow}>
            {ACCENTS.map((a) => {
              // ダーク表示中はダーク版パレットでプレビュー（実際の見え方と一致させる）
              const pal = theme.scheme === 'dark' ? darkPaletteFor(a.key) : PALETTES[a.key];
              return (
              <Pressable key={a.key} style={s.swatchWrap} onPress={() => setTheme({ accent: a.key })}>
                <View style={[s.swatch, { backgroundColor: pal.bg, borderWidth: 1, borderColor: pal.line }, theme.accent === a.key && s.swatchOn]}>
                  <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 16, backgroundColor: pal.accentBadge }} />
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: pal.teal }} />
                  {theme.accent === a.key && <Text style={s.swatchCheck}>✓</Text>}
                </View>
                <Text style={[s.swatchT, theme.accent === a.key && { color: C.ink, fontWeight: '800' }]}>{t(a.label)}</Text>
              </Pressable>
              );
            })}
          </View>

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
                           onPress={() => setTheme({ bg: b.key })}>
                  {/* 下地の上に白いカードを重ね、実際の見え方をそのまま見せる */}
                  <View style={[s.bgMini, { borderColor: pal.line }]} />
                  <View style={[s.bgMini, { borderColor: pal.line, marginTop: 3 }]} />
                  <Text style={[s.bgCardT, on && { color: C.teal }]}>{t(b.label)}</Text>
                </Pressable>
              );
            })}
          </View>
          </>
          )}

          <Text style={[s.label, { marginTop: 22 }]}>{t('P/F/Cバーの色')}</Text>
          <Text style={s.note}>{t('たんぱく質・脂質・炭水化物をそれぞれ好きな色にできます。目標を超えたバーは赤で表示されます。')}</Text>

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
                    <Pressable key={sw.key} onPress={() => setTheme({ pfc: { ...theme.pfc, [macro]: sw.color } })}>
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
          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </Modal>

    {/* ===== 言語選択モーダル ===== */}
    <Modal visible={sheet === 'lang'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader icon={<Languages size={18} color={C.teal} />} title={t("言語")} />
        <ScrollView>
          {LOCALES.map((l) => (
            <Pressable key={l.code} style={s.langRow} onPress={() => { setLocale(l.code as LocaleCode); setSheet(null); }}>
              <Text style={[s.langT, locale === l.code && { color: C.teal, fontWeight: '800' }]}>{l.label}</Text>
              {locale === l.code && <Text style={{ color: C.teal, fontWeight: '800' }}>✓</Text>}
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
        <SheetHeader icon={<Salad size={18} color={C.teal} />} title={t("マイ食品の管理")} />
        <ScrollView>
          {foods.length === 0 && <Text style={s.note}>{t('まだ登録がありません。食事タブでAI解析した品目が候補になります。')}</Text>}
          <OptionButton style={{ marginBottom: 12 }} label={t('＋ 食品を追加')} onPress={() => setFoodFormOpen(true)} />
          {foods.map((f) => (
            <View key={f.id} style={s.foodRow}>
              <Text style={s.foodName} numberOfLines={1}>{f.name}</Text>
              <Text style={s.foodKcal}>{Math.round(Number(f.kcal))}kcal</Text>
              <Pressable onPress={() => removeFood(f.id, f.name)} hitSlop={8}>
                <Trash2 color={C.coral} size={17} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>

    {/* ===== ヘルスケア連携モーダル ===== */}
    <Modal visible={sheet === 'health'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader title={"⌚ " + t("ヘルスケア連携")} />
        {!healthAvailable() ? (
          <Text style={s.note}>{t('この機能はTestFlight版で有効になります（Expo Goプレビューでは利用できません）。')}</Text>
        ) : (
          <>
            <Text style={s.note}>{t('Appleヘルスケアから体重を取り込みます。データは機能提供のみに使用し、広告等には一切使用しません。歩数・睡眠は「概要」タブで見られます。')}</Text>
            <Pressable style={[s.btnPrimary, { marginTop: 14 }]} onPress={healthImportWeights} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>{t('体重を取り込む（過去90日）')}</Text>}
            </Pressable>
          </>
        )}
        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
      </View>
    </Modal>

    {/* ===== 体重目標モーダル ===== */}
    <Modal visible={sheet === 'goalW'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetBody}>
        <SheetHeader icon={<Target size={18} color={C.teal} />} title={t("体重の目標")} />
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <GoalPanel mode="weight" weightSections="goal" />
          <Text style={s.note}>{t('チートデイの登録は「概要」タブのカードから行えます。')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

    {/* ===== 筋トレ目標モーダル ===== */}
    <Modal visible={sheet === 'goalT'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetBody}>
        <SheetHeader icon={<Dumbbell size={18} color={C.teal} />} title={t("筋トレの目標")} />
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <GoalPanel mode="training" />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

    {/* ===== アカウント削除モーダル ===== */}
    <Modal visible={sheet === 'delete'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader icon={<Trash2 size={18} color={C.coral} />} title={t("アカウント削除")} />
        <Text style={s.note}>{t('アカウントと全データ（記録・写真・目標・マイ食品）を完全に削除します。この操作は取り消せません。')}</Text>
        <Text style={s.label}>{t('確認のため「削除」と入力')}</Text>
        <TextInput style={s.input} value={delConfirm} onChangeText={setDelConfirm} placeholder={t('削除')} placeholderTextColor={C.faint} />
        <Pressable style={[s.btnDanger, { marginTop: 14 }, delConfirm !== '削除' && { opacity: 0.4 }]}
                   onPress={confirmDelete} disabled={busy || delConfirm !== '削除'}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>{t('アカウントを完全に削除する')}</Text>}
        </Pressable>
        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
      </View>
    </Modal>

    <QuickLogFab />
    <Modal visible={avatarOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAvatarOpen(false)}>
      <View style={s.sheetBody}>
        <SheetHeader icon={<Smile size={18} color={C.teal} />} title={t("アイコンを選ぶ")} />
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
        {/* 【重要】このフォームはpageSheetの内側に置く。外（兄弟）に置くと
            iOSでは表示中のシートの上にモーダルを出せず、ボタンが無反応になる */}
        <MyFoodForm visible={foodFormOpen} draft={null}
                    onClose={() => setFoodFormOpen(false)} onSaved={load} />
      </View>
    </Modal>
    <NotificationCenter visible={noticeOpen} onClose={() => { setNoticeOpen(false); todo.refresh(); }} />
    <StatusBarMask />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 12, paddingBottom: 40 },  // ネイティブヘッダーが上を確保するため控えめに
  h: { fontSize: 21, fontWeight: '800', color: C.ink, marginBottom: 12 },
  // サマリー
  summary: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(14,17,22,0.08)', borderRadius: 20, shadowColor: '#0e1116', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 16, marginBottom: 18,
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
    flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: C.line,
    padding: 8, alignItems: 'stretch',
  },
  bgCardOn: { borderColor: C.teal, borderWidth: 2.5 },
  bgMini: { height: 11, borderRadius: 4, backgroundColor: '#ffffff', borderWidth: 1 },
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
    borderWidth: 1.5, borderColor: C.line, borderRadius: 14, marginTop: 8, backgroundColor: C.bg,
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
  hourChip: { borderWidth: 1.5, borderColor: C.line, backgroundColor: C.panel, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  hourChipOn: { backgroundColor: C.ink, borderColor: C.ink },
  hourChipT: { fontSize: 13, fontWeight: '800', color: C.sub, fontVariant: ['tabular-nums'] },
  hourChipTOn: { color: '#fff' },
  notifLabel: { fontSize: 15, fontWeight: '700', color: C.ink },
  notifSub: { fontSize: 13, color: C.sub, marginTop: 2 },
  notifNote: { fontSize: 11, color: C.faint, lineHeight: 16, paddingHorizontal: 14, paddingBottom: 10 },
  group: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 15, fontWeight: '600', color: C.ink },
  rowSub: { fontSize: 13, color: C.sub, marginTop: 1 },
  sep: { height: 0.5, backgroundColor: C.line, marginLeft: 56 },
  // アクション
  logoutBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 13,
  },
  logoutT: { color: C.sub, fontSize: 15, fontWeight: '800' },
  deleteLink: { alignItems: 'center', marginTop: 18 },
  deleteLinkT: { color: C.coral, fontSize: 15, fontWeight: '700' },
  // モーダル
  sheetBody: { flex: 1, backgroundColor: C.bg, padding: 18, paddingTop: sheetTopPad(18) },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  sheetClose: { fontSize: 15, fontWeight: '700', color: C.teal },
  // フォーム
  label: { fontSize: 13, fontWeight: '700', color: C.sub, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 17, color: C.ink },
  segMini: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  segMiniOn: { backgroundColor: C.ink, borderColor: C.ink },
  segMiniT: { fontSize: 15, fontWeight: '700', color: C.sub },
  btnPrimary: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  btnPrimaryT: { color: '#fff', fontSize: 15, fontWeight: '800' },
  btnDanger: { backgroundColor: C.coral, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  note: { fontSize: 13, color: C.sub, lineHeight: 19 },
  msg: { fontSize: 15, fontWeight: '600', marginTop: 10 },
  foodRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: C.line },
  foodName: { flex: 1, fontSize: 15, color: C.ink, fontWeight: '600' },
  foodKcal: { fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
});
