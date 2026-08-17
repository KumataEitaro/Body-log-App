// マイページ: iOS設定アプリ風のグループ化メニューリスト
// フォーム・一覧のベタ貼りを廃止し、各機能はモーダル（pageSheet）で開く
// 構成: ヘッダーサマリー → アカウント設定 → データ・連携 → アクション（ログアウト/削除）
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { UserRound, Salad, HeartPulse, LogOut, Trash2, ChevronRight } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { apiPost } from '@/lib/api';
import { C } from '@/lib/ui';
import { mifflinBMR } from '@/lib/calc';
import { healthAvailable, requestHealthAuth, importWeights } from '@/lib/health';
import StatusBarMask from '@/components/StatusBarMask';
import QuickLogFab from '@/components/QuickLogFab';

type MyFoodLite = { id: string; name: string; kcal: number };
type Sheet = null | 'profile' | 'foods' | 'health' | 'delete';

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

  function openSheet(v: Sheet) { setMsg(null); setDelConfirm(''); setSheet(v); }

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
      setMsg(error ? { ok: false, text: '保存に失敗しました。もう一度お試しください。' } : { ok: true, text: '保存しました。' });
    } finally { setBusy(false); }
  }

  async function healthImportWeights() {
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      if (!(await requestHealthAuth())) { setMsg({ ok: false, text: 'ヘルスケアへのアクセスが許可されませんでした。' }); return; }
      const res = await importWeights(uid, 90);
      if ('error' in res) { setMsg({ ok: false, text: res.error }); return; }
      setMsg({ ok: true, text: res.imported > 0 ? `体重を ${res.imported} 日分 取り込みました。「概要」タブのグラフに反映されます。` : '新しく取り込める体重データはありませんでした。' });
    } finally { setBusy(false); }
  }

  function removeFood(id: string, foodName: string) {
    Alert.alert(`「${foodName}」を削除しますか？`, '入力画面のチップから消えます（過去の記録は変わりません）。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する', style: 'destructive',
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
      'アカウントを完全に削除しますか？',
      '記録・写真・目標・マイ食品のすべてが削除されます。この操作は取り消せません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: '完全に削除する', style: 'destructive', onPress: deleteAccount },
      ],
    );
  }

  async function deleteAccount() {
    setBusy(true); setMsg(null);
    try {
      const { ok, json } = await apiPost<{ ok: boolean; error?: string }>('/api/account/delete', {});
      if (!ok || !json?.ok) { setMsg({ ok: false, text: json?.error || '削除に失敗しました。もう一度お試しください。' }); return; }
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    } finally { setBusy(false); }
  }

  const bmr = mifflinBMR(sex, latestWeight ?? 70, Number(height) || 0, Number(age) || 0);

  // 1行メニュー（アイコン＋ラベル＋chevron）
  function Row({ icon, label, sub, onPress, danger }: { icon: React.ReactNode; label: string; sub?: string; onPress: () => void; danger?: boolean }) {
    return (
      <Pressable style={({ pressed }) => [s.row, pressed && { backgroundColor: '#f1f3f0' }]} onPress={onPress}>
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
        <Pressable onPress={() => setSheet(null)} hitSlop={8}><Text style={s.sheetClose}>閉じる</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
      <Text style={s.h}>マイページ</Text>

      {/* ヘッダーサマリーカード */}
      <View style={s.summary}>
        <View style={s.avatar}><Text style={{ fontSize: 26 }}>💪</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.sumName}>{name || 'ニックネーム未設定'}</Text>
          <Text style={s.sumMail}>{email || '—'}</Text>
          <Text style={s.sumMeta}>
            {height}cm{latestWeight != null ? ` ・ ${latestWeight.toFixed(1)}kg` : ''} ・ 基礎代謝 約{Math.round(bmr)}kcal
          </Text>
        </View>
      </View>

      {/* アカウント設定 */}
      <Text style={s.groupLabel}>アカウント設定</Text>
      <View style={s.group}>
        <Row icon={<UserRound color={C.teal} size={19} />} label="プロフィール編集" sub="表示名・性別・身長・年齢・生活係数" onPress={() => openSheet('profile')} />
        <View style={s.sep} />
        <Row icon={<Salad color={C.teal} size={19} />} label="マイ食品の管理" sub={`${foods.length}件 登録済み`} onPress={() => openSheet('foods')} />
      </View>

      {/* データ・連携 */}
      <Text style={s.groupLabel}>データ・連携</Text>
      <View style={s.group}>
        <Row icon={<HeartPulse color={C.teal} size={19} />} label="ヘルスケア連携"
             sub={healthAvailable() ? '体重の取込（Apple ヘルスケア）' : 'TestFlight版で有効になります'}
             onPress={() => openSheet('health')} />
      </View>

      {/* アクション */}
      <View style={{ height: 16 }} />
      <Pressable style={s.logoutBtn} onPress={() => supabase.auth.signOut()}>
        <LogOut color={C.sub} size={16} />
        <Text style={s.logoutT}>ログアウト</Text>
      </Pressable>
      <Pressable style={s.deleteLink} onPress={() => openSheet('delete')} hitSlop={6}>
        <Text style={s.deleteLinkT}>アカウントを削除する</Text>
      </Pressable>
    </ScrollView>

    {/* ===== プロフィール編集モーダル ===== */}
    <Modal visible={sheet === 'profile'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetBody}>
        <SheetHeader title="👤 プロフィール編集" />
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={s.label}>表示名</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="表示名" placeholderTextColor={C.faint} />
          <Text style={s.label}>性別</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([['male', '男性'], ['female', '女性']] as const).map(([k, l]) => (
              <Pressable key={k} style={[s.segMini, sex === k && s.segMiniOn]} onPress={() => setSex(k)}>
                <Text style={[s.segMiniT, sex === k && { color: '#fff' }]}>{l}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>身長(cm)</Text>
              <TextInput style={s.input} keyboardType="number-pad" value={height} onChangeText={setHeight} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>年齢</Text>
              <TextInput style={s.input} keyboardType="number-pad" value={age} onChangeText={setAge} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>生活係数</Text>
              <TextInput style={s.input} keyboardType="decimal-pad" value={life} onChangeText={setLife} />
            </View>
          </View>
          <Pressable style={[s.btnPrimary, { marginTop: 16 }]} onPress={saveProfile} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>保存する</Text>}
          </Pressable>
          {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

    {/* ===== マイ食品管理モーダル ===== */}
    <Modal visible={sheet === 'foods'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader title="🍱 マイ食品の管理" />
        <ScrollView>
          {foods.length === 0 && <Text style={s.note}>まだ登録がありません。食事タブでAI解析した品目が候補になります。</Text>}
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
          <Text style={s.note}>この機能はTestFlight版で有効になります（Expo Goプレビューでは利用できません）。</Text>
        ) : (
          <>
            <Text style={s.note}>Appleヘルスケアから体重を取り込みます。データは機能提供のみに使用し、広告等には一切使用しません。歩数・睡眠は「概要」タブで見られます。</Text>
            <Pressable style={[s.btnPrimary, { marginTop: 14 }]} onPress={healthImportWeights} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>⚖️ 体重を取り込む（過去90日）</Text>}
            </Pressable>
          </>
        )}
        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
      </View>
    </Modal>

    {/* ===== アカウント削除モーダル ===== */}
    <Modal visible={sheet === 'delete'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <View style={s.sheetBody}>
        <SheetHeader title="⚠️ アカウント削除" />
        <Text style={s.note}>アカウントと全データ（記録・写真・目標・マイ食品）を完全に削除します。この操作は取り消せません。</Text>
        <Text style={s.label}>確認のため「削除」と入力</Text>
        <TextInput style={s.input} value={delConfirm} onChangeText={setDelConfirm} placeholder="削除" placeholderTextColor={C.faint} />
        <Pressable style={[s.btnDanger, { marginTop: 14 }, delConfirm !== '削除' && { opacity: 0.4 }]}
                   onPress={confirmDelete} disabled={busy || delConfirm !== '削除'}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>アカウントを完全に削除する</Text>}
        </Pressable>
        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
      </View>
    </Modal>

    <QuickLogFab />
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
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#e8f5f0', alignItems: 'center', justifyContent: 'center' },
  sumName: { fontSize: 16, fontWeight: '800', color: C.ink },
  sumMail: { fontSize: 11.5, color: C.sub, marginTop: 1 },
  sumMeta: { fontSize: 11.5, color: C.sub, marginTop: 4, fontVariant: ['tabular-nums'] },
  // グループリスト
  groupLabel: { fontSize: 11, fontWeight: '700', color: C.sub, marginBottom: 6, marginLeft: 6, letterSpacing: 0.4 },
  group: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#e8f5f0', alignItems: 'center', justifyContent: 'center' },
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
