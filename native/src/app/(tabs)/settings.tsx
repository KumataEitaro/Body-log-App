// マイページ: iOS設定アプリ風のグループ化メニューリスト
// フォーム・一覧のベタ貼りを廃止し、各機能はモーダル（pageSheet）で開く
// 構成: ヘッダーサマリー → アカウント設定 → データ・連携 → アクション（ログアウト/削除）
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setDailyLogReminder, setWeeklyPhotoReminder } from '@/lib/notify';
import { SegmentedControl, OptionButton } from '@/components/ui/Selectable';
import { UserRound, Salad, HeartPulse, LogOut, Trash2, ChevronRight, CircleHelp, Target, Dumbbell, BookOpen, Languages, Palette } from 'lucide-react-native';
import ColumnReader from '@/components/ColumnReader';
import NotificationCenter, { useTodoBadge, TodoBadge } from '@/components/NotificationCenter';
import { BellRing } from 'lucide-react-native';
import { t, useLocale, setLocale, LOCALES, type LocaleCode } from '@/lib/i18n';
import { useUnits, setUnits, fmtWeight, fmtHeight } from '@/lib/units';
import { useTheme, setTheme, ACCENTS, PALETTES, PFC_SWATCHES } from '@/lib/theme';
import { SegmentedControl as Seg } from '@/components/ui/Selectable';
import { useGuide } from '@/components/GuideTour';
import GoalPanel from '@/components/GoalPanel';
import { supabase } from '@/lib/supabase';
import { useLocalSearchParams } from 'expo-router';
import { apiPost } from '@/lib/api';
import { C } from '@/lib/ui';
import { mifflinBMR } from '@/lib/calc';
import { healthAvailable, requestHealthAuth, importWeights } from '@/lib/health';
import StatusBarMask from '@/components/StatusBarMask';
import QuickLogFab from '@/components/QuickLogFab';
import ActivityLevelPicker from '@/components/ActivityLevelPicker';

type MyFoodLite = { id: string; name: string; kcal: number };
type Sheet = null | 'lang' | 'theme' | 'profile' | 'foods' | 'health' | 'delete' | 'goalW' | 'goalT' | 'columns';

export default function SettingsScreen() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('170');
  const [age, setAge] = useState('30');
  const [life, setLife] = useState('1.3');
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [foods, setFoods] = useState<MyFoodLite[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [delConfirm, setDelConfirm] = useState('');
  const guide = useGuide();

  // 相談タブ等からのディープリンク（/settings?open=goalW）で目的のシートを直接開く
  const { open } = useLocalSearchParams<{ open?: string }>();
  const consumedOpen = useRef<string | null>(null);
  useEffect(() => {
    if (!open || consumedOpen.current === open) return;
    consumedOpen.current = open;
    if (open === 'goalW' || open === 'goalT' || open === 'profile' || open === 'theme') openSheet(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const locale = useLocale();
  const units = useUnits();
  const theme = useTheme();
  const todo = useTodoBadge();
  const [noticeOpen, setNoticeOpen] = useState(false);

  function openSheet(v: Sheet) { setMsg(null); setDelConfirm(''); setSheet(v); }

  // 通知トグル（設定はAsyncStorageに永続化。OFF→ONで権限リクエスト）
  const [notifDaily, setNotifDaily] = useState(false);
  const [notifWeekly, setNotifWeekly] = useState(false);
  useEffect(() => {
    AsyncStorage.multiGet(['bl-notif-daily', 'bl-notif-weekly']).then((kv) => {
      setNotifDaily(kv[0]?.[1] === '1');
      setNotifWeekly(kv[1]?.[1] === '1');
    }).catch(() => {});
  }, []);
  async function toggleDaily(on: boolean) {
    setNotifDaily(on);
    const ok = await setDailyLogReminder(on);
    if (!ok && on) { setNotifDaily(false); Alert.alert(t('通知を許可してください'), t('iOSの設定 > BodyLog > 通知 から許可できます（Expo Goでは動作しません）。')); return; }
    AsyncStorage.setItem('bl-notif-daily', on ? '1' : '0').catch(() => {});
  }
  async function toggleWeekly(on: boolean) {
    setNotifWeekly(on);
    const ok = await setWeeklyPhotoReminder(on);
    if (!ok && on) { setNotifWeekly(false); Alert.alert(t('通知を許可してください'), t('iOSの設定 > BodyLog > 通知 から許可できます（Expo Goでは動作しません）。')); return; }
    AsyncStorage.setItem('bl-notif-weekly', on ? '1' : '0').catch(() => {});
  }

  async function saveProfile() {
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { error } = await supabase.from('profiles').update({
        display_name: name.trim(), sex,
        height_cm: Number(height) || 170, age: Number(age) || 30,
        life_factor: Number(life) || 1.3,
      }).eq('id', uid);
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
      setMsg({ ok: true, text: res.imported > 0 ? `体重を ${res.imported} 日分 取り込みました。「概要」タブのグラフに反映されます。` : t('新しく取り込める体重データはありませんでした。') });
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
  function SheetHeader({ title }: { title: string }) {
    return (
      <View style={s.sheetHead}>
        <Text style={s.sheetTitle}>{title}</Text>
        <Pressable onPress={() => setSheet(null)} hitSlop={8}><Text style={s.sheetClose}>{t('閉じる')}</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
      <Text style={s.h}>{t('マイページ')}</Text>

      {/* ヘッダーサマリーカード */}
      <View style={s.summary}>
        <View style={s.avatar}><Text style={{ fontSize: 26 }}>💪</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.sumName}>{name || t('ニックネーム未設定')}</Text>
          <Text style={s.sumMail}>{email || '—'}</Text>
          <Text style={s.sumMeta}>
            {fmtHeight(Number(height))}{latestWeight != null ? ` ・ ${fmtWeight(latestWeight)}` : ''} ・ 基礎代謝 約{Math.round(bmr)}kcal
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
        <Row icon={<UserRound color={C.teal} size={19} />} label="プロフィール編集" sub="表示名・性別・身長・年齢・活動量" onPress={() => openSheet('profile')} />
        <View style={s.sep} />
        <Row icon={<Salad color={C.teal} size={19} />} label="マイ食品の管理" sub={`${foods.length}件 登録済み`} onPress={() => openSheet('foods')} />
      </View>

      {/* 目標 */}
      <Text style={s.groupLabel}>{t('目標')}</Text>
      <View style={s.group}>
        <Row icon={<Target color={C.teal} size={19} />} label="体重の目標" sub="目標日・目標体重・PFC詳細" onPress={() => openSheet('goalW')} />
        <View style={s.sep} />
        <Row icon={<Dumbbell color={C.teal} size={19} />} label="運動の目標" sub="週の運動習慣・種目ごとの目標重量（RM換算）" onPress={() => openSheet('goalT')} />
      </View>

      {/* 見た目（テーマカラー・PFCの色） */}
      <Text style={s.groupLabel}>{t('見た目')}</Text>
      <View style={s.group}>
        <Row icon={<Palette color={C.teal} size={19} />} label={t('テーマカラー')}
             sub={ACCENTS.find((a) => a.key === theme.accent)?.label ?? ''}
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
        <View style={s.notifRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.notifLabel}>{t('記録リマインダー')}</Text>
            <Text style={s.notifSub}>{t('毎日21:00に「今日の記録」を通知')}</Text>
          </View>
          <Switch value={notifDaily} onValueChange={toggleDaily} trackColor={{ true: C.teal }} />
        </View>
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
        <Row icon={<HeartPulse color={C.teal} size={19} />} label="ヘルスケア連携"
             sub={healthAvailable() ? '体重の取込（Apple ヘルスケア）' : t('TestFlight版で有効になります')}
             onPress={() => openSheet('health')} />
      </View>

      {/* サポート */}
      <Text style={s.groupLabel}>{t('サポート')}</Text>
      <View style={s.group}>
        <Row icon={<CircleHelp color={C.teal} size={19} />} label="使い方ガイドをもう一度見る"
             sub="各画面の説明と初期設定をやり直せます"
             onPress={() => guide.start()} />
        <View style={s.sep} />
        <Row icon={<BookOpen color={C.teal} size={19} />} label="読みもの"
             sub="PFCバランス・カロリー収支・過食の心理など5本"
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
        <SheetHeader title="👤 プロフィール編集" />
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={s.label}>{t('表示名')}</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="表示名" placeholderTextColor={C.faint} />
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
          <OptionButton style={{ marginTop: 16 }} label="保存する" onPress={saveProfile} busy={busy} />
          {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

    {/* ===== テーマ選択モーダル ===== */}
    <Modal visible={sheet === 'theme'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader title={'🎨 ' + t('テーマカラー')} />
        <ScrollView>
          <Text style={s.label}>{t('アクセントカラー')}</Text>
          <View style={s.swatchRow}>
            {ACCENTS.map((a) => (
              <Pressable key={a.key} style={s.swatchWrap} onPress={() => setTheme({ accent: a.key })}>
                <View style={[s.swatch, { backgroundColor: PALETTES[a.key].bg, borderWidth: 1, borderColor: PALETTES[a.key].line }, theme.accent === a.key && s.swatchOn]}>
                  <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 16, backgroundColor: PALETTES[a.key].accentBadge }} />
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: a.color }} />
                  {theme.accent === a.key && <Text style={s.swatchCheck}>✓</Text>}
                </View>
                <Text style={[s.swatchT, theme.accent === a.key && { color: C.ink, fontWeight: '800' }]}>{t(a.label)}</Text>
              </Pressable>
            ))}
          </View>

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
        <SheetHeader title={"🌐 " + t("言語")} />
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
        <SheetHeader title="📖 読みもの" />
        <ScrollView><ColumnReader /></ScrollView>
      </View>
    </Modal>

    {/* ===== マイ食品管理モーダル ===== */}
    <Modal visible={sheet === 'foods'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader title="🍱 マイ食品の管理" />
        <ScrollView>
          {foods.length === 0 && <Text style={s.note}>{t('まだ登録がありません。食事タブでAI解析した品目が候補になります。')}</Text>}
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
        <SheetHeader title="⌚ ヘルスケア連携" />
        {!healthAvailable() ? (
          <Text style={s.note}>{t('この機能はTestFlight版で有効になります（Expo Goプレビューでは利用できません）。')}</Text>
        ) : (
          <>
            <Text style={s.note}>{t('Appleヘルスケアから体重を取り込みます。データは機能提供のみに使用し、広告等には一切使用しません。歩数・睡眠は「概要」タブで見られます。')}</Text>
            <Pressable style={[s.btnPrimary, { marginTop: 14 }]} onPress={healthImportWeights} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>{t('⚖️ 体重を取り込む（過去90日）')}</Text>}
            </Pressable>
          </>
        )}
        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
      </View>
    </Modal>

    {/* ===== 体重目標モーダル ===== */}
    <Modal visible={sheet === 'goalW'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetBody}>
        <SheetHeader title="🎯 体重の目標" />
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <GoalPanel mode="weight" weightSections="goal" />
          <Text style={s.note}>{t('チートデイの登録は「概要」タブのカードから行えます。')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

    {/* ===== 筋トレ目標モーダル ===== */}
    <Modal visible={sheet === 'goalT'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetBody}>
        <SheetHeader title="🏋️ 筋トレの目標" />
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <GoalPanel mode="training" />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

    {/* ===== アカウント削除モーダル ===== */}
    <Modal visible={sheet === 'delete'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader title="⚠️ アカウント削除" />
        <Text style={s.note}>{t('アカウントと全データ（記録・写真・目標・マイ食品）を完全に削除します。この操作は取り消せません。')}</Text>
        <Text style={s.label}>{t('確認のため「削除」と入力')}</Text>
        <TextInput style={s.input} value={delConfirm} onChangeText={setDelConfirm} placeholder="削除" placeholderTextColor={C.faint} />
        <Pressable style={[s.btnDanger, { marginTop: 14 }, delConfirm !== '削除' && { opacity: 0.4 }]}
                   onPress={confirmDelete} disabled={busy || delConfirm !== '削除'}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>{t('アカウントを完全に削除する')}</Text>}
        </Pressable>
        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
      </View>
    </Modal>

    <QuickLogFab />
    <NotificationCenter visible={noticeOpen} onClose={() => { setNoticeOpen(false); todo.refresh(); }} />
    <StatusBarMask />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 64, paddingBottom: 40 },
  h: { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 12 },
  // サマリー
  summary: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, marginBottom: 18,
  },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center' },
  sumName: { fontSize: 16, fontWeight: '800', color: C.ink },
  sumMail: { fontSize: 11.5, color: C.sub, marginTop: 1 },
  sumMeta: { fontSize: 11.5, color: C.sub, marginTop: 4, fontVariant: ['tabular-nums'] },
  // グループリスト
  groupLabel: { fontSize: 11, fontWeight: '700', color: C.sub, marginBottom: 6, marginLeft: 6, letterSpacing: 0.4 },
  macroBlock: { marginTop: 14 },
  macroHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  macroDot: { width: 12, height: 12, borderRadius: 6 },
  macroName: { fontSize: 14, fontWeight: '800', color: C.ink, width: 76 },
  macroBarTrack: { flex: 1, height: 6, backgroundColor: C.track, borderRadius: 3, overflow: 'hidden' },
  macroSwatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  macroSw: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  macroSwOn: { borderWidth: 3, borderColor: C.ink },
  macroCheck: { color: '#fff', fontSize: 15, fontWeight: '900' },
  dupWarn: { fontSize: 11.5, color: C.coral, marginTop: 12, lineHeight: 18 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4 },
  swatchWrap: { alignItems: 'center', width: 78 },
  swatch: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 3, borderColor: C.ink },
  swatchCheck: { color: '#fff', fontSize: 18, fontWeight: '900' },
  swatchT: { fontSize: 10.5, color: C.sub, marginTop: 5, fontWeight: '600', textAlign: 'center' },
  pfcRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1.5, borderColor: C.line, borderRadius: 14, marginTop: 8, backgroundColor: C.bg,
  },
  pfcRowOn: { borderColor: C.teal, backgroundColor: C.tealWeak },
  pfcName: { fontSize: 14, fontWeight: '800', color: C.ink },
  pfcNote: { fontSize: 11, color: C.sub, marginTop: 2 },
  pfcSample: { height: 6, backgroundColor: C.track, borderRadius: 3, overflow: 'hidden' },
  unitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 9 },
  unitLabel: { fontSize: 14, fontWeight: '700', color: C.ink },
  langRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: C.line },
  langT: { fontSize: 15, color: C.ink, fontWeight: '600' },
  notifRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  notifLabel: { fontSize: 14, fontWeight: '700', color: C.ink },
  notifSub: { fontSize: 11, color: C.sub, marginTop: 2 },
  notifNote: { fontSize: 10.5, color: C.faint, lineHeight: 16, paddingHorizontal: 14, paddingBottom: 10 },
  group: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14.5, fontWeight: '600', color: C.ink },
  rowSub: { fontSize: 11, color: C.sub, marginTop: 1 },
  sep: { height: 0.5, backgroundColor: C.line, marginLeft: 56 },
  // アクション
  logoutBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 13,
  },
  logoutT: { color: C.sub, fontSize: 13.5, fontWeight: '800' },
  deleteLink: { alignItems: 'center', marginTop: 18 },
  deleteLinkT: { color: C.coral, fontSize: 13, fontWeight: '700' },
  // モーダル
  sheetBody: { flex: 1, backgroundColor: C.bg, padding: 18 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: C.ink },
  sheetClose: { fontSize: 14, fontWeight: '700', color: C.teal },
  // フォーム
  label: { fontSize: 11, fontWeight: '700', color: C.sub, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 16, color: C.ink },
  segMini: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  segMiniOn: { backgroundColor: C.ink, borderColor: C.ink },
  segMiniT: { fontSize: 13, fontWeight: '700', color: C.sub },
  btnPrimary: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  btnPrimaryT: { color: '#fff', fontSize: 14, fontWeight: '800' },
  btnDanger: { backgroundColor: C.coral, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  note: { fontSize: 12, color: C.sub, lineHeight: 19 },
  msg: { fontSize: 13, fontWeight: '600', marginTop: 10 },
  foodRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: C.line },
  foodName: { flex: 1, fontSize: 14, color: C.ink, fontWeight: '600' },
  foodKcal: { fontSize: 12, color: C.sub, fontVariant: ['tabular-nums'] },
});
