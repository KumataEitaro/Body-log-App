// 設定タブ（Phase 3）: プロフィール編集・アカウント削除（App Store審査必須 5.1.1(v)）・ログアウト
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { apiPost } from '@/lib/api';
import { C } from '@/lib/ui';
import { mifflinBMR } from '@/lib/calc';

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

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      setEmail(session?.user?.email ?? '');
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
      if (prof) {
        setName(prof.display_name || '');
        setSex(prof.sex); setHeight(String(prof.height_cm)); setAge(String(prof.age));
        setLife(String(prof.life_factor));
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
      await supabase.auth.signOut(); // 認証ゲートがログイン画面へ遷移させる
    } finally { setBusy(false); }
  }

  const bmrPreview = mifflinBMR(sex, 70, Number(height) || 0, Number(age) || 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <Text style={s.h}>設定</Text>

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
        <Text style={s.note}>基礎代謝は最新の体重で自動計算されます（体重70kgなら約 {Math.round(bmrPreview)} kcal）</Text>
        <Pressable style={[s.btnPrimary, { marginTop: 12 }]} onPress={saveProfile} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>保存する</Text>}
        </Pressable>
      </View>

      {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}

      <Text style={s.note}>通知・ヘルスケア連携・マイ食品管理・言語はPhase 3bで移植予定（現行アプリで設定可・データ共通）</Text>

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
});
