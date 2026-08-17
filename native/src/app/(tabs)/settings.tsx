// マイページ: プロフィール・ヘルスケア連携（取込アクションのみ）・マイ食品管理・アカウント削除（審査必須 5.1.1(v)）
// 歩数・睡眠などのログ表示は「変化」タブへ移動済み（設定にログデータを混在させない）
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { apiPost } from '@/lib/api';
import { C } from '@/lib/ui';
import { mifflinBMR } from '@/lib/calc';
import { healthAvailable, requestHealthAuth, importWeights } from '@/lib/health';
import StatusBarMask from '@/components/StatusBarMask';
import QuickLogFab from '@/components/QuickLogFab';

type MyFoodLite = { id: string; name: string; kcal: number };

export default function SettingsScreen() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('170');
  const [age, setAge] = useState('30');
  const [life, setLife] = useState('1.3');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [delConfirm, setDelConfirm] = useState('');
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthMsg, setHealthMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [foods, setFoods] = useState<MyFoodLite[]>([]);

  useEffect(() => {
    (async () => {
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
    })();
  }, []);

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
      // アカウントはサーバー側で消滅済み。グローバルsignOutはdead sessionでエラーになり得るためローカルのみ確実に破棄
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    } finally { setBusy(false); }
  }

  async function healthImportWeights() {
    setHealthBusy(true); setHealthMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      if (!(await requestHealthAuth())) { setHealthMsg({ ok: false, text: 'ヘルスケアへのアクセスが許可されませんでした。' }); return; }
      const res = await importWeights(uid, 90);
      if ('error' in res) { setHealthMsg({ ok: false, text: res.error }); return; }
      setHealthMsg({ ok: true, text: res.imported > 0 ? `体重を ${res.imported} 日分 取り込みました。グラフに反映されます。` : '新しく取り込める体重データはありませんでした。' });
    } finally { setHealthBusy(false); }
  }

  async function removeFood(id: string, name: string) {
    Alert.alert(`「${name}」を削除しますか？`, '入力画面のチップから消えます（過去の記録は変わりません）。', [
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

  // 例示ではなく実測の最新体重で基礎代謝を出す（70kg固定の例は混乱のもと）
  const bmrW = latestWeight ?? 70;
  const bmrPreview = mifflinBMR(sex, bmrW, Number(height) || 0, Number(age) || 0);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text style={s.h}>マイページ</Text>

      {/* プロフィール */}
      <View style={s.card}>
        <Text style={s.h2}>👤 プロフィール</Text>
        <Text style={s.label}>アカウント</Text>
        <Text style={s.val}>{email || '—'}</Text>
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
        <Text style={s.note}>あなたの基礎代謝: 約 {Math.round(bmrPreview)} kcal{latestWeight != null ? `（最新体重 ${latestWeight.toFixed(1)}kg で計算）` : ''}</Text>
        <Pressable style={[s.btnPrimary, { marginTop: 12 }]} onPress={saveProfile} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>保存する</Text>}
        </Pressable>
      </View>

      {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}

      {/* ヘルスケア連携（取込アクションのみ。歩数・睡眠の閲覧は「変化」タブ） */}
      <View style={s.card}>
        <Text style={s.h2}>⌚ ヘルスケア連携</Text>
        {!healthAvailable() ? (
          <Text style={s.note}>この機能はTestFlight版で有効になります（Expo Goプレビューでは利用できません）。</Text>
        ) : (
          <>
            <Text style={s.note}>Appleヘルスケアから体重を取り込みます。データは機能提供のみに使用し、広告等には一切使用しません。歩数・睡眠は「変化」タブで見られます。</Text>
            <Pressable style={[s.btnGhost, { marginTop: 10 }]} onPress={healthImportWeights} disabled={healthBusy}>
              {healthBusy ? <ActivityIndicator color={C.ink} /> : <Text style={s.btnGhostT}>⚖️ 体重を取り込む（過去90日）</Text>}
            </Pressable>
          </>
        )}
        {healthMsg && <Text style={[s.msg, { color: healthMsg.ok ? C.teal : C.coral, marginTop: 8 }]}>{healthMsg.text}</Text>}
      </View>

      {/* マイ食品の管理 */}
      <View style={s.card}>
        <Text style={s.h2}>🍱 マイ食品の管理</Text>
        {foods.length === 0 && <Text style={s.note}>まだ登録がありません。食事タブでAI解析した品目が候補になります。</Text>}
        {foods.map((f) => (
          <View key={f.id} style={s.foodRow}>
            <Text style={s.foodName} numberOfLines={1}>{f.name}</Text>
            <Text style={s.foodKcal}>{Math.round(Number(f.kcal))}kcal</Text>
            <Pressable onPress={() => removeFood(f.id, f.name)} hitSlop={6}>
              <Text style={{ color: C.coral, fontWeight: '800', fontSize: 16 }}>×</Text>
            </Pressable>
          </View>
        ))}
      </View>

      {/* ログアウト */}
      <Pressable style={[s.btnGhost, { marginTop: 16 }]} onPress={() => supabase.auth.signOut()}>
        <Text style={s.btnGhostT}>ログアウト</Text>
      </Pressable>

      {/* アカウント削除（審査必須） */}
      <View style={[s.card, { borderColor: C.coral, marginTop: 24 }]}>
        <Text style={[s.h2, { color: C.coral }]}>⚠️ アカウント削除</Text>
        <Text style={s.note}>アカウントと全データ（記録・写真・目標・マイ食品）を完全に削除します。この操作は取り消せません。</Text>
        <Text style={s.label}>確認のため「削除」と入力</Text>
        <TextInput style={s.input} value={delConfirm} onChangeText={setDelConfirm} placeholder="削除" placeholderTextColor={C.faint} />
        <Pressable style={[s.btnDanger, { marginTop: 12 }, delConfirm !== '削除' && { opacity: 0.4 }]}
                   onPress={confirmDelete} disabled={busy || delConfirm !== '削除'}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>アカウントを完全に削除する</Text>}
        </Pressable>
      </View>
    </ScrollView>
    <QuickLogFab />
    <StatusBarMask />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 64, paddingBottom: 40 },
  h: { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 12 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 8 },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, marginBottom: 12 },
  label: { fontSize: 11, fontWeight: '700', color: C.sub, marginTop: 12, marginBottom: 4 },
  val: { fontSize: 14, color: C.ink, fontWeight: '600' },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 16, color: C.ink },
  segMini: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  segMiniOn: { backgroundColor: C.ink, borderColor: C.ink },
  segMiniT: { fontSize: 13, fontWeight: '700', color: C.sub },
  btnPrimary: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  btnPrimaryT: { color: '#fff', fontSize: 14, fontWeight: '800' },
  btnGhost: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  btnGhostT: { color: C.ink, fontSize: 13, fontWeight: '800' },
  btnDanger: { backgroundColor: C.coral, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  note: { fontSize: 11.5, color: C.sub, lineHeight: 18, marginTop: 4 },
  msg: { fontSize: 13, fontWeight: '600', marginBottom: 8, paddingHorizontal: 4 },
  foodRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 7, borderTopWidth: 0.5, borderTopColor: C.line },
  foodName: { flex: 1, fontSize: 13.5, color: C.ink, fontWeight: '600' },
  foodKcal: { fontSize: 12, color: C.sub, fontVariant: ['tabular-nums'] },
});
